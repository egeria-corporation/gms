// SPDX-License-Identifier: AGPL-3.0-only
// Award sharing (v1.8.0): what of an award may be public, and the share kit and badge built from
// it. `isPubliclyListable` is the one rule every public path applies (the funder's grants-awarded
// pages, past awards on its funder page, the sitemap, share cards, the badge, the share kit) and
// the open-data export should apply too. An award is public only when:
//   * it is not confidential (the funder's flag, or its program's default for new awards);
//   * it went to an organization, never an individual;
//   * it is accepted, active or completed;
//   * the funder turned on "List awards on my public page" (off by default);
//   * the grantee did not choose "Don't list us publicly".
// Public views carry public fields only: the funder's public name, the recipient's own workspace
// name (never a Passport record it shares only with its funders), the award's title as its
// purpose, the program, the year, and the amount unless the funder hides amounts.
import { z } from "zod";
import { ApiError, notFound } from "../lib/errors.ts";
import { humanOnly, STAFF_ROLES } from "./awards.ts";
import { audit, authorize, type ServiceContext } from "./context.ts";
import { namesOf, verificationOf } from "./profile.ts";
import type { Row } from "./repos/types.ts";

type Award = Row<"awards">;
type Ws = Row<"workspaces">;
type Money = { amount: string; currency: string };

/** Award statuses that may be listed: accepted or later, and not suspended or cancelled. */
export const LISTABLE_STATUSES = ["accepted", "active", "completed"] as const;
/** Amounts show on listed awards unless the funder hides them. */
export const AMOUNTS_SHOWN_BY_DEFAULT = true;
/** The most awards one funder's public pages read. */
export const LIST_LIMIT = 1000;
/** How long the "Funded by" badge is cached (seconds). */
export const BADGE_TTL_SECONDS = 3600;

// ------------------------------------------------------------------------------------ settings

export interface ListingSettings {
  /** "List awards on my public page". */
  listAwards: boolean;
  /** Show award amounts on the public pages, cards, badge text and share kit. */
  showAmounts: boolean;
}

/** `settings.awardSharing`, written only by `updateListingSettings` (not a PATCH /workspaces key). */
export function listingSettingsOf(w: Pick<Ws, "settings"> | null | undefined): ListingSettings {
  // The older `settings.transparency` switch is retired (v1.9.0) and never lists anything.
  const s = (w?.settings ?? {}) as { awardSharing?: { listAwards?: unknown; showAmounts?: unknown } };
  const listAwards = s.awardSharing?.listAwards === true;
  const showAmounts = typeof s.awardSharing?.showAmounts === "boolean" ? s.awardSharing.showAmounts : AMOUNTS_SHOWN_BY_DEFAULT;
  return { listAwards, showAmounts };
}

// ------------------------------------------------------------------------------------ the rule

/** Why an award is not public. In the order they are checked: the first that applies is given. */
export type NotListedReason = "confidential" | "individual" | "not_accepted" | "funder_unavailable" | "listing_off" | "recipient_unlisted";
export type Listability = { listable: true } | { listable: false; reason: NotListedReason };

/** The award's other parties, as loaded by the caller. */
export interface Parties {
  funder: Ws | null | undefined;
  recipient: Ws | null | undefined;
}

type ListableFields = Pick<Award, "workspace_id" | "recipient_workspace_id" | "recipient_individual" | "status"> & Partial<Pick<Award, "confidential" | "recipient_unlisted">>;

/**
 * An award to a person: named directly (`recipient_individual`), or to a workspace that is not an
 * applicant organization or says it is an individual. Never public, never exported.
 */
export function isIndividualRecipient(award: Pick<Award, "recipient_workspace_id" | "recipient_individual">, recipient: Ws | null | undefined): boolean {
  if (award.recipient_individual !== null || !award.recipient_workspace_id) return true;
  if (!recipient || recipient.id !== award.recipient_workspace_id || recipient.kind !== "applicant") return true;
  const declared = (recipient.self_declared_profile ?? null) as { orgType?: unknown } | null;
  const projected = (recipient.org_projection ?? null) as { orgType?: unknown } | null;
  return declared?.orgType === "individual" || projected?.orgType === "individual";
}

export function listability(award: ListableFields, parties: Parties): Listability {
  const no = (reason: NotListedReason): Listability => ({ listable: false, reason });
  // Anything but an explicit false (a row read before 0037, a missing column) counts as confidential.
  if (award.confidential !== false) return no("confidential");
  if (isIndividualRecipient(award, parties.recipient)) return no("individual");
  if (!(LISTABLE_STATUSES as readonly string[]).includes(award.status)) return no("not_accepted");
  const f = parties.funder;
  if (!f || f.id !== award.workspace_id || f.kind !== "funder" || f.status !== "active") return no("funder_unavailable");
  if (!listingSettingsOf(f).listAwards) return no("listing_off");
  if (award.recipient_unlisted !== false) return no("recipient_unlisted");
  return { listable: true };
}

/** The one rule for anything public about an award. See the file header. */
export const isPubliclyListable = (award: ListableFields, parties: Parties): boolean => listability(award, parties).listable;

/** Loads the parties of these awards: workspaces by id. */
async function partiesOf(ctx: Pick<ServiceContext, "repos">, awards: Award[]): Promise<Map<string, Ws>> {
  const ids = [...new Set(awards.flatMap((a) => [a.workspace_id, a.recipient_workspace_id]).filter((x): x is string => !!x))];
  const rows: Ws[] = [];
  for (let i = 0; i < ids.length; i += 100) rows.push(...(await ctx.repos.table("workspaces").find({ id: ids.slice(i, i + 100) })));
  return new Map(rows.map((w) => [w.id, w]));
}

/** For callers that hold only an award id (the open-data export, the social composer). */
export async function awardIsPubliclyListable(ctx: Pick<ServiceContext, "repos">, awardId: string): Promise<boolean> {
  const a = await ctx.repos.table("awards").one({ id: awardId });
  if (!a) return false;
  const ws = await partiesOf(ctx, [a]);
  return isPubliclyListable(a, { funder: ws.get(a.workspace_id), recipient: a.recipient_workspace_id ? ws.get(a.recipient_workspace_id) : null });
}

// ------------------------------------------------------------------------------------ public views

/** Control, formatting and direction characters: dropped from public text so a name cannot hide or reorder words. */
const control = (c: number) => c < 0x20 || (c >= 0x7f && c <= 0x9f) || c === 0x2028 || c === 0x2029;
const invisible = (c: number) => c === 0xad || (c >= 0x200b && c <= 0x200f) || (c >= 0x202a && c <= 0x202e) || (c >= 0x2060 && c <= 0x206f) || c === 0xfeff;
const cleanText = (s: string) =>
  [...s.normalize("NFC")]
    .map((ch) => (control(ch.codePointAt(0)!) ? " " : invisible(ch.codePointAt(0)!) ? "" : ch))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
const clip = (s: string, max: number) => {
  const t = cleanText(s);
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,.;:-]+$/, "")}…`;
};

/** Lowercase letters, digits and hyphens from a name, for the readable part of an address. */
export function nameSlug(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
}

const TOKEN = /^[a-z0-9]{8,32}$/;
/**
 * The token at the end of an award's public slug (`{recipient-name}-{token}`). The name part is
 * only for reading: an award is found by its token, so a link keeps working after a rename.
 */
export function tokenOf(slug: string | undefined): string | null {
  if (!slug || slug.length > 120 || !/^[a-z0-9-]+$/.test(slug)) return null;
  const token = slug.slice(slug.lastIndexOf("-") + 1);
  return TOKEN.test(token) ? token : null;
}

/** The recipient as the public sees it: the organization's own name in the GMS. */
export const publicRecipientName = (recipient: Ws): string => cleanText(recipient.display_name);
/** The funder as the public sees it, as on its funder page. */
export const publicFunderName = (funder: Ws): string => cleanText(namesOf(funder).name);
/** "Verified" on a badge or card: the funder's workspace is linked to Passport. */
export const funderVerified = (funder: Ws): boolean => verificationOf(funder).source === "passport";

export interface PublicAward {
  /** `{recipient-name}-{token}`: the award page and badge address. */
  slug: string;
  recipient: { name: string };
  /** The award's title: what it is for. */
  purpose: string;
  /** The program, else the published opportunity it came from; null when neither. */
  program: string | null;
  year: number;
  awardDate: string;
  /** Null when the funder hides amounts. */
  amount: Money | null;
  links: { page: string; image: string; badge: string };
}

const awardDateOf = (a: Award): string => {
  const d = ((a.key_dates ?? {}) as { awardDate?: { date?: unknown } }).awardDate?.date;
  return typeof d === "string" && /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(0, 10) : a.created_at.slice(0, 10);
};
const awardedOf = (a: Award): Money | null => {
  const m = ((a.funding ?? {}) as { awardedAmount?: { amount?: unknown; currency?: unknown } }).awardedAmount;
  return m && typeof m.amount === "string" && typeof m.currency === "string" && /^\d+(\.\d+)?$/.test(m.amount) && /^[A-Z]{3}$/.test(m.currency) ? { amount: m.amount, currency: m.currency } : null;
};

export const awardLinks = (web: string, handle: string, slug: string) => ({
  page: `${web}/f/${handle}/awards/${slug}`,
  image: `${web}/og/f/${handle}/awards/${slug}.png`,
  badge: `${web}/badge/${slug}.svg`,
});

function publicAwardView(ctx: Pick<ServiceContext, "config">, a: Award, funder: Ws, recipient: Ws, program: string | null): PublicAward {
  const name = publicRecipientName(recipient);
  const prefix = nameSlug(name);
  const slug = prefix ? `${prefix}-${a.public_slug}` : a.public_slug;
  const awardDate = awardDateOf(a);
  return {
    slug,
    recipient: { name },
    purpose: clip(a.title, 300),
    program: program ? clip(program, 200) : null,
    year: Number(awardDate.slice(0, 4)),
    awardDate,
    amount: listingSettingsOf(funder).showAmounts ? awardedOf(a) : null,
    links: awardLinks(ctx.config.webBaseUrl, funder.handle, slug),
  };
}

/** Program names (or, without a program, published opportunity titles) for these awards. */
async function programNames(ctx: Pick<ServiceContext, "repos">, awards: Award[]): Promise<(a: Award) => string | null> {
  const programIds = [...new Set(awards.map((a) => a.program_id).filter((x): x is string => !!x))];
  const oppIds = [...new Set(awards.filter((a) => !a.program_id).map((a) => a.opportunity_id).filter((x): x is string => !!x))];
  const programs = programIds.length ? await ctx.repos.table("programs").find({ id: programIds }) : [];
  const opps = oppIds.length ? (await ctx.repos.table("opportunities").find({ id: oppIds }, { notNull: ["published_at"] })) : [];
  return (a) => (a.program_id ? (programs.find((p) => p.id === a.program_id && p.workspace_id === a.workspace_id)?.name ?? null) : (opps.find((o) => o.id === a.opportunity_id && o.workspace_id === a.workspace_id)?.title ?? null));
}

export interface ListedAward extends PublicAward {
  /** The award's last change, for the sitemap. */
  updatedAt: string;
}

/**
 * The funder's listed awards, newest award date first. Empty unless the funder lists awards. Only
 * awards that pass `isPubliclyListable` are returned.
 */
export async function listedAwardsOf(ctx: Pick<ServiceContext, "repos" | "config">, funder: Ws): Promise<ListedAward[]> {
  if (!listingSettingsOf(funder).listAwards) return [];
  const rows = await ctx.repos.table("awards").find({ workspace_id: funder.id, status: [...LISTABLE_STATUSES] }, { orderBy: "created_at", ascending: false, limit: LIST_LIMIT });
  const ws = await partiesOf(ctx, rows);
  const listed = rows.filter((a) => isPubliclyListable(a, { funder, recipient: a.recipient_workspace_id ? ws.get(a.recipient_workspace_id) : null }));
  const program = await programNames(ctx, listed);
  return listed
    .map((a) => ({ ...publicAwardView(ctx, a, funder, ws.get(a.recipient_workspace_id!)!, program(a)), updatedAt: a.updated_at }))
    .sort((x, y) => (x.awardDate === y.awardDate ? x.recipient.name.localeCompare(y.recipient.name) : x.awardDate < y.awardDate ? 1 : -1));
}

/** One listed award by its public slug, with its funder. Null for anything not public. */
export async function listedAwardBySlug(ctx: Pick<ServiceContext, "repos" | "config">, slug: string | undefined): Promise<{ award: PublicAward; funder: Ws } | null> {
  const token = tokenOf(slug);
  if (!token) return null;
  const a = await ctx.repos.table("awards").one({ public_slug: token });
  if (!a) return null;
  const ws = await partiesOf(ctx, [a]);
  const funder = ws.get(a.workspace_id);
  const recipient = a.recipient_workspace_id ? ws.get(a.recipient_workspace_id) : null;
  if (!funder || !recipient || !isPubliclyListable(a, { funder, recipient })) return null;
  const program = await programNames(ctx, [a]);
  return { award: publicAwardView(ctx, a, funder, recipient, program(a)), funder };
}

// ------------------------------------------------------------------------------------ words

/** `$150,000`, or `€1,250.50`: whole amounts without cents. */
export function formatAmount(m: Money): string {
  const value = Number(m.amount);
  const whole = Number.isInteger(value);
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: m.currency, minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 }).format(value);
  } catch {
    return `${m.currency} ${m.amount}`;
  }
}

/** "a $150,000 grant", "an $80,000 grant", "a grant". */
export function aGrant(amount: string | null): string {
  if (!amount) return "a grant";
  const lead = amount.replace(/^[^0-9]*/, "").split(/[,.]/)[0] ?? "";
  const an = lead.startsWith("8") || lead === "11" || lead === "18";
  return `${an ? "an" : "a"} ${amount} grant`;
}

export interface ShareKit {
  /** Ready to edit: nothing is posted from the GMS. */
  posts: { linkedin: string; short: string; newsletter: string };
  links: { page: string; awards: string; image: string; badge: string };
  /** `svg` is the badge itself, as /badge/{slug}.svg serves it, for a preview that loads nothing. */
  badge: { verified: boolean; text: string; snippet: string; svg: string };
  award: PublicAward;
}

/** The longest short post: an X post, counting the link in full. */
export const SHORT_POST_MAX = 280;

const attr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export const badgeText = (funderName: string, verified: boolean) => `Funded by ${funderName}${verified ? " · verified" : ""}`;

/** The posts, links and badge for a listed award, from its public fields only. */
export function buildShareKit(ctx: Pick<ServiceContext, "config">, award: PublicAward, funder: Ws, audience: ShareAudience): ShareKit {
  const funderName = publicFunderName(funder);
  const recipient = award.recipient.name;
  const amount = award.amount ? formatAmount(award.amount) : null;
  const grant = aGrant(amount);
  const purpose = `“${award.purpose}”`;
  const awards = `${ctx.config.webBaseUrl}/f/${funder.handle}/awards`;
  const throughIts = award.program ? ` through its ${award.program} program` : "";
  const throughOur = award.program ? ` through our ${award.program} program` : "";
  const page = award.links.page;
  const short = (make: (p: string) => string) => {
    // Shorten the purpose until the post fits.
    let p = award.purpose;
    while (make(`“${p}”`).length > SHORT_POST_MAX && p.length > 20) p = clip(p, Math.max(20, p.length - 10));
    return make(`“${p}”`);
  };
  const posts =
    audience === "grantee"
      ? {
          linkedin: `We are grateful to ${funderName} for ${grant}${throughIts}. It funds our work on ${purpose}.\n\nThank you to the ${funderName} team for backing this work.\n\n${page}`,
          short: short((p) => `Thank you, ${funderName}, for ${grant} for ${p}. ${page}`),
          newsletter: `${recipient} has received ${grant} from ${funderName}${throughIts}. The grant funds ${purpose}. We thank ${funderName} for its support. Read more: ${page}`,
        }
      : {
          linkedin: `We are proud to support ${recipient} with ${grant}${throughOur}. The grant funds ${purpose}.\n\nCongratulations to the ${recipient} team.\n\n${page}`,
          short: short((p) => `Congratulations to ${recipient} on ${grant} from ${funderName} for ${p}. ${page}`),
          newsletter: `${funderName} has awarded ${recipient} ${grant}${throughIts}. The grant funds ${purpose}. See every grant we have awarded: ${awards}`,
        };
  const verified = funderVerified(funder);
  const text = badgeText(funderName, verified);
  const size = badgeSize(text);
  return {
    posts,
    links: { page, awards, image: award.links.image, badge: award.links.badge },
    badge: { verified, text, svg: badgeSvg(funderName, verified), snippet: `<a href="${attr(page)}"><img src="${attr(award.links.badge)}" alt="${attr(verified ? `Funded by ${funderName}, verified` : `Funded by ${funderName}`)}" width="${size.width}" height="${size.height}"></a>` },
    award,
  };
}

// ------------------------------------------------------------------------------------ the badge

/** Approximate advance widths of an 11px sans (Verdana-like) for laying out the badge. */
function textWidth(s: string): number {
  let w = 0;
  for (const ch of s) {
    if ("iIl.,:;|!'·".includes(ch)) w += 3.6;
    else if ("fjrt()[] -".includes(ch)) w += 4.6;
    else if ("mwMW@".includes(ch)) w += 10.2;
    else if (/[A-Z0-9&%#]/.test(ch)) w += 7.6;
    else w += 6.6;
  }
  return Math.ceil(w);
}

const BADGE_HEIGHT = 20;
const BADGE_PAD = 8;
const BADGE_LEFT = "Funded by";
/** Badge colours: theme tokens --og-navy-dark (label) and --og-teal-dark (funder), white text. */
export const BADGE_COLOURS = { label: "#0D2A43", value: "#145450", text: "#FFFFFF" } as const;

const badgeParts = (text: string) => {
  const right = text.startsWith(`${BADGE_LEFT} `) ? text.slice(BADGE_LEFT.length + 1) : text;
  const lw = textWidth(BADGE_LEFT) + BADGE_PAD * 2;
  const rw = textWidth(right) + BADGE_PAD * 2;
  return { right, lw, rw };
};
export const badgeSize = (text: string) => {
  const p = badgeParts(text);
  return { width: p.lw + p.rw, height: BADGE_HEIGHT };
};

const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

/** The "Funded by" badge: two labelled panels, text only, no logos and no script. */
export function badgeSvg(funderName: string, verified: boolean): string {
  const name = clip(funderName, 60);
  const text = badgeText(name, verified);
  const { right, lw, rw } = badgeParts(text);
  const w = lw + rw;
  const label = verified ? `Funded by ${name}, verified` : `Funded by ${name}`;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${BADGE_HEIGHT}" viewBox="0 0 ${w} ${BADGE_HEIGHT}" role="img" aria-label="${xml(label)}">`,
    `<title>${xml(label)}</title>`,
    `<clipPath id="r"><rect width="${w}" height="${BADGE_HEIGHT}" rx="3"/></clipPath>`,
    `<g clip-path="url(#r)"><rect width="${lw}" height="${BADGE_HEIGHT}" fill="${BADGE_COLOURS.label}"/><rect x="${lw}" width="${rw}" height="${BADGE_HEIGHT}" fill="${BADGE_COLOURS.value}"/></g>`,
    `<g fill="${BADGE_COLOURS.text}" font-family="Verdana,DejaVu Sans,Geneva,sans-serif" font-size="11" text-anchor="middle">`,
    `<text x="${lw / 2}" y="14" textLength="${lw - BADGE_PAD * 2}" lengthAdjust="spacingAndGlyphs">${BADGE_LEFT}</text>`,
    `<text x="${lw + rw / 2}" y="14" textLength="${rw - BADGE_PAD * 2}" lengthAdjust="spacingAndGlyphs">${xml(right)}</text>`,
    `</g></svg>`,
  ].join("");
}

/** The badge for a public slug, or null for anything not public (the route answers a neutral 404). */
export async function badgeFor(ctx: Pick<ServiceContext, "repos" | "config">, slug: string | undefined): Promise<string | null> {
  const found = await listedAwardBySlug(ctx, slug);
  return found ? badgeSvg(publicFunderName(found.funder), funderVerified(found.funder)) : null;
}

// ------------------------------------------------------------------------------------ the panel

export type ShareAudience = "funder" | "grantee";

/** The award, read from one side: the funder's staff (`funder`) or the recipient's members (`grantee`). */
async function sideAward(ctx: ServiceContext, awardId: string, audience: ShareAudience, scope: "awards:read" | "awards:write", roles?: readonly string[]) {
  const ws = await authorize(ctx, { scope, kind: audience === "funder" ? "funder" : "applicant", ...(roles ? { roles } : {}) });
  const award = await ctx.repos.table("awards").one({ id: awardId });
  const mine = award && (audience === "funder" ? award.workspace_id === ws.id : award.recipient_workspace_id === ws.id);
  if (!award || !mine) throw notFound("Award");
  return { ws, award };
}

/**
 * The share kit for an award, for the funder (`funder`) or the grantee (`grantee`). Null when the
 * award is not public: nothing is offered for a confidential, unlisted or not yet accepted award.
 * Nothing is posted from here.
 */
export async function shareKit(ctx: ServiceContext, awardId: string, audience: ShareAudience): Promise<ShareKit | null> {
  const { award } = await sideAward(ctx, awardId, audience, "awards:read");
  const found = await listedAwardBySlug(ctx, award.public_slug);
  return found ? buildShareKit(ctx, found.award, found.funder, audience) : null;
}

export interface AwardSharing {
  /** Whether the award is on the funder's public pages now, and if not, why. */
  listed: boolean;
  reason: NotListedReason | null;
  confidential: boolean;
  recipientUnlisted: boolean;
  /** The funder's "List awards on my public page" setting. */
  listingOn: boolean;
  amountsShown: boolean;
  /** Whether the caller may change this side's switch (confidential for the funder, unlisted for the grantee). */
  canChange: boolean;
  /** The funder's grants-awarded page, while it lists awards. */
  awardsPage: string | null;
  kit: ShareKit | null;
}

const FUNDER_CHANGE_ROLES: readonly string[] = STAFF_ROLES;
const GRANTEE_CHANGE_ROLES: readonly string[] = ["admin"];

/** What the "Share this award" panel shows, for either side. */
export async function awardSharing(ctx: ServiceContext, awardId: string, audience: ShareAudience): Promise<AwardSharing> {
  const { ws, award } = await sideAward(ctx, awardId, audience, "awards:read");
  const parties = await partiesOf(ctx, [award]);
  const funder = parties.get(award.workspace_id);
  const recipient = award.recipient_workspace_id ? parties.get(award.recipient_workspace_id) : null;
  const l = listability(award, { funder, recipient });
  const settings = listingSettingsOf(funder);
  const found = l.listable ? await listedAwardBySlug(ctx, award.public_slug) : null;
  const roles = audience === "funder" ? FUNDER_CHANGE_ROLES : GRANTEE_CHANGE_ROLES;
  return {
    listed: l.listable,
    reason: l.listable ? null : l.reason,
    confidential: award.confidential !== false,
    recipientUnlisted: award.recipient_unlisted === true,
    listingOn: settings.listAwards,
    amountsShown: settings.showAmounts,
    canChange: ctx.actor.kind === "user" && ws.role !== null && roles.includes(ws.role) && ctx.scopes.includes("awards:write"),
    awardsPage: settings.listAwards && funder ? `${ctx.config.webBaseUrl}/f/${funder.handle}/awards` : null,
    kit: found ? buildShareKit(ctx, found.award, found.funder, audience) : null,
  };
}

// ------------------------------------------------------------------------------------ changes (people only)

export const confidentialInput = z.object({ confidential: z.boolean() }).strict();
export const unlistedInput = z.object({ unlisted: z.boolean() }).strict();
export const listingSettingsInput = z.object({ listAwards: z.boolean().optional(), showAmounts: z.boolean().optional() }).strict();
export const programDefaultInput = z.object({ awardsConfidential: z.boolean() }).strict();

const conflict = () => new ApiError(409, "conflict", "This record changed while you were working. Reload and try again");

/**
 * The funder marks an award confidential, or not. A person only: making an award public is never an
 * agent's or API client's call, so neither direction has a token path or an MCP tool.
 */
export async function setAwardConfidential(ctx: ServiceContext, awardId: string, input: z.output<typeof confidentialInput>): Promise<AwardSharing> {
  const { award } = await sideAward(ctx, awardId, "funder", "awards:write", FUNDER_CHANGE_ROLES);
  if (ctx.actor.kind !== "user") throw humanOnly("Changing whether an award is confidential");
  if (award.confidential !== input.confidential) {
    // Compare and set on the flag itself: a change made meanwhile by someone else is a conflict.
    const [row] = await ctx.repos.table("awards").update({ id: award.id, confidential: !input.confidential }, { confidential: input.confidential });
    if (!row) throw conflict();
    await audit(ctx, input.confidential ? "award.made_confidential" : "award.confidential_removed", "award", award.id, { confidential: input.confidential });
  }
  return awardSharing(ctx, awardId, "funder");
}

/** The grantee's "Don't list us publicly", per award. A grantee admin, in person. */
export async function setRecipientUnlisted(ctx: ServiceContext, awardId: string, input: z.output<typeof unlistedInput>): Promise<AwardSharing> {
  const { award } = await sideAward(ctx, awardId, "grantee", "awards:write", GRANTEE_CHANGE_ROLES);
  if (ctx.actor.kind !== "user") throw humanOnly("Changing whether your award is listed publicly");
  if ((award.recipient_unlisted === true) !== input.unlisted) {
    const [row] = await ctx.repos.table("awards").update({ id: award.id, recipient_unlisted: !input.unlisted }, { recipient_unlisted: input.unlisted });
    if (!row) throw conflict();
    // The funder's ledger, as for every change to an award, from whichever side.
    await audit(ctx, input.unlisted ? "award.recipient_unlisted" : "award.recipient_listed", "award", award.id, { unlisted: input.unlisted }, award.workspace_id);
  }
  return awardSharing(ctx, awardId, "grantee");
}

export interface ListingSettingsView extends ListingSettings {
  /** The grants-awarded page. It answers 404 while listing is off. */
  awardsPage: string;
  /** How many awards are listed now, and how many are kept off and why. */
  counts: { listed: number; confidential: number; recipientUnlisted: number };
  programs: { id: string; name: string; awardsConfidential: boolean }[];
}

async function listingView(ctx: ServiceContext, w: Ws): Promise<ListingSettingsView> {
  const settings = listingSettingsOf(w);
  const [awards, programs] = await Promise.all([
    ctx.repos.table("awards").find({ workspace_id: w.id, status: [...LISTABLE_STATUSES] }, { limit: LIST_LIMIT }),
    ctx.repos.table("programs").find({ workspace_id: w.id }, { orderBy: "name" }),
  ]);
  const listed = await listedAwardsOf(ctx, w);
  return {
    ...settings,
    awardsPage: `${ctx.config.webBaseUrl}/f/${w.handle}/awards`,
    counts: { listed: listed.length, confidential: awards.filter((a) => a.confidential !== false).length, recipientUnlisted: awards.filter((a) => a.confidential === false && a.recipient_unlisted === true).length },
    programs: programs.map((p) => ({ id: p.id, name: p.name, awardsConfidential: p.awards_confidential === true })),
  };
}

/** Settings › Public page: the award listing switches and the program defaults. Any funder staff may read. */
export async function getListingSettings(ctx: ServiceContext): Promise<ListingSettingsView> {
  const ws = await authorize(ctx, { scope: "awards:read", kind: "funder" });
  const w = await ctx.repos.table("workspaces").one({ id: ws.id });
  if (!w) throw notFound("Workspace");
  return listingView(ctx, w);
}

/** "List awards on my public page" and "Show award amounts". A workspace admin, in person. */
export async function updateListingSettings(ctx: ServiceContext, input: z.output<typeof listingSettingsInput>): Promise<ListingSettingsView> {
  const ws = await authorize(ctx, { scope: "workspace:admin", kind: "funder", roles: ["admin"], person: true });
  if (ctx.actor.kind !== "user") throw humanOnly("Changing what your public page lists");
  const w = await ctx.repos.table("workspaces").one({ id: ws.id });
  if (!w) throw notFound("Workspace");
  const current = (w.settings ?? {}) as Record<string, unknown>;
  const before = listingSettingsOf(w);
  const next = { listAwards: input.listAwards ?? before.listAwards, showAmounts: input.showAmounts ?? before.showAmounts };
  if (next.listAwards !== before.listAwards || next.showAmounts !== before.showAmounts || !current.awardSharing) {
    // Read, merge this one key, write: as PATCH /workspaces does for the keys it owns.
    const [row] = await ctx.repos.table("workspaces").update({ id: w.id }, { settings: { ...current, awardSharing: next } as Ws["settings"] });
    if (!row) throw conflict();
    await audit(ctx, "workspace.award_listing_changed", "workspace", w.id, { ...next });
    return listingView(ctx, row);
  }
  return listingView(ctx, w);
}

/** Whether new awards in a program start confidential. Funder admins and program officers, in person. */
export async function setProgramConfidentialDefault(ctx: ServiceContext, programId: string, input: z.output<typeof programDefaultInput>): Promise<ListingSettingsView> {
  const ws = await authorize(ctx, { scope: "programs:write", kind: "funder", roles: FUNDER_CHANGE_ROLES, person: true });
  if (ctx.actor.kind !== "user") throw humanOnly("Changing a program's confidential default");
  const p = await ctx.repos.table("programs").one({ id: programId });
  if (!p || p.workspace_id !== ws.id) throw notFound("Program");
  if ((p.awards_confidential === true) !== input.awardsConfidential) {
    await ctx.repos.table("programs").update({ id: p.id }, { awards_confidential: input.awardsConfidential });
    await audit(ctx, "program.awards_confidential_changed", "program", p.id, { awardsConfidential: input.awardsConfidential });
  }
  const w = await ctx.repos.table("workspaces").one({ id: ws.id });
  return listingView(ctx, w!);
}
