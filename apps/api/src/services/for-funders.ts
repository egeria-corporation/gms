// SPDX-License-Identifier: AGPL-3.0-only
// "For funders" (E4, loop 2: applicant demand pulls in funders). The send-to-funder package's
// footer (send-package.ts) links to `/for-funders?ref=<token>`, the token of the applicant
// workspace's package link (referral_links, kind `package`). A funder who opens it sees the
// applicant's region and "N organizations in {region} already keep their applications here",
// then "Receive applications here, free" leads into funder setup, and a funder workspace made from
// it is counted for the link (referrals.ts).
//
// The count is aggregate only. It is shown only when N is at least REGION_COUNT_FLOOR, and below
// that the page is told nothing about N. No organization is ever named, the applicant included.
import type { JsonObject } from "@gms/forms";
import { packageFooterWithLink } from "@gms/notify";
import { DEFAULT_LOCALE, type Locale } from "@gms/i18n";
import type { ServiceContext } from "./context.ts";
import { invitationLanding } from "./peer-invites.ts";
import { orgFacts } from "./profile.ts";
import type { PublicContext } from "./public.ts";
import { ensureLink, liveLink } from "./referrals.ts";
import type { Repos, Row } from "./repos/types.ts";

type Ws = Row<"workspaces">;

/** The fewest organizations the page counts out loud. Below it, no number is given. One place to relax. */
export const REGION_COUNT_FLOOR = 10;
/**
 * An organization counts when it keeps at least one application here (on the GMS or one it tracks
 * itself), not merely when it has a workspace: the stricter reading of "keep their applications
 * here". Set to false to count every active applicant workspace in the region.
 */
export const COUNT_ONLY_WITH_AN_APPLICATION = true;
/** How long one isolate keeps a region's count. */
export const REGION_COUNT_TTL_MS = 10 * 60 * 1000;

const US_STATES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware", DC: "District of Columbia", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", PR: "Puerto Rico", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
};
const STATE_BY_NAME = new Map(Object.entries(US_STATES).map(([code, name]) => [name.toLowerCase(), code]));

export interface Region {
  /** `US:OR`, or `<country>:<region in lower case>`: what two organizations must share to be counted together. */
  key: string;
  /** How the page names it: a US state's name, else the region as the organization wrote it. */
  name: string;
}

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.replace(/\s+/g, " ").trim() : null);

/** The region an organization's profile gives (its Passport record, or what it declared), or null. */
export function regionOf(ws: Ws): Region | null {
  const facts = orgFacts(ws);
  const primary = ((facts.org as JsonObject).addresses as { primary?: Record<string, unknown> } | undefined)?.primary;
  const raw = text(primary?.stateOrProvince);
  if (!raw || raw.length > 100) return null;
  const country = (text(primary?.country) ?? "").toUpperCase();
  const state = /^[A-Za-z]{2}$/.test(raw) && US_STATES[raw.toUpperCase()] ? raw.toUpperCase() : STATE_BY_NAME.get(raw.toLowerCase());
  if (state && (country === "" || country === "US" || country === "USA")) return { key: `US:${state}`, name: US_STATES[state]! };
  return { key: `${country || "?"}:${raw.toLowerCase()}`, name: raw };
}

const cache = new WeakMap<Repos, Map<string, { at: number; count: number }>>();

/** Active applicant workspaces in a region that keep an application here. Undercounts rather than overcounts. */
async function countInRegion(ctx: Pick<PublicContext, "repos" | "now">, key: string): Promise<number> {
  const byRepos = cache.get(ctx.repos) ?? new Map<string, { at: number; count: number }>();
  cache.set(ctx.repos, byRepos);
  const hit = byRepos.get(key);
  if (hit && ctx.now().getTime() - hit.at < REGION_COUNT_TTL_MS) return hit.count;
  const ids: string[] = [];
  for (let offset = 0; offset < 50_000; offset += 1000) {
    const page = await ctx.repos.table("workspaces").find({ kind: "applicant", status: "active" }, { orderBy: "id", limit: 1000, offset });
    for (const w of page) if (regionOf(w)?.key === key) ids.push(w.id);
    if (page.length < 1000) break;
  }
  let count = ids.length;
  if (COUNT_ONLY_WITH_AN_APPLICATION && ids.length) {
    const keeping = new Set<string>();
    for (let i = 0; i < ids.length; i += 100) {
      const chunk = ids.slice(i, i + 100);
      for (const o of await ctx.repos.table("outside_applications").find({ workspace_id: chunk }, { limit: 1000 })) keeping.add(o.workspace_id);
      const rest = chunk.filter((id) => !keeping.has(id));
      if (rest.length) for (const a of await ctx.repos.table("applications").find({ applicant_workspace_id: rest }, { limit: 1000 })) keeping.add(a.applicant_workspace_id);
    }
    count = keeping.size;
  }
  byRepos.set(key, { at: ctx.now().getTime(), count });
  return count;
}

/**
 * Data for `/for-funders`: with `ref`, the applicant's region and how many organizations there keep
 * their applications here (only from REGION_COUNT_FLOOR); with `invite`, who invited the funder.
 * An unknown or revoked token reads as none, so the page is the same generic page.
 */
export async function forFundersPage(ctx: PublicContext & { ports?: ServiceContext["ports"] }, q: { ref?: string | null; invite?: string | null }) {
  const link = await liveLink(ctx, q.ref, "package");
  const applicant = link ? await ctx.repos.table("workspaces").one({ id: link.workspace_id, kind: "applicant" }) : null;
  const region = applicant && applicant.status === "active" ? regionOf(applicant) : null;
  const count = region ? await countInRegion(ctx, region.key) : 0;
  return {
    ref: link && applicant ? { region: region ? { name: region.name } : null, organizations: region && count >= REGION_COUNT_FLOOR ? count : null } : null,
    invitation: await invitationLanding(ctx, q.invite),
    floor: REGION_COUNT_FLOOR,
  };
}

/** The applicant workspace's "for funders" link, made on first use. For the package footer. */
export async function forFundersLink(ctx: Pick<ServiceContext, "repos" | "actor" | "config">, applicantWorkspaceId: string): Promise<string> {
  const link = await ensureLink(ctx, applicantWorkspaceId, "package");
  return `${ctx.config.webBaseUrl}/for-funders?ref=${link.token}`;
}

/** The package footer line with that link, in a language (send-package.ts). */
export async function packageFooterFor(ctx: Pick<ServiceContext, "repos" | "actor" | "config">, applicantWorkspaceId: string, locale: Locale = DEFAULT_LOCALE): Promise<string> {
  return packageFooterWithLink(await forFundersLink(ctx, applicantWorkspaceId), locale);
}
