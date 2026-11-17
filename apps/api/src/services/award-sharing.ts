// SPDX-License-Identifier: AGPL-3.0-only
// Award sharing (v1.9.0): what of an award may be public, and the share kit and badge built from
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
//
// The kit, plus (v1.12.0): the portrait card's words, a 6-10 page carousel PDF with each page's
// alt text, a press release with the funder's credit wording ("funded by" or "supported by", never
// "sponsored"), each side's social page to tag (only with that side's consent), the federal share
// statement (the Stevens Amendment, only when the funder entered both the amount and the
// percentage), and "Meet our grantees" (a program's listable awards, for one post).
import { DEFAULT_LOCALE, formatCurrency, formatDateIn, formatNumber, INTL_LOCALE, type Locale } from "@gms/i18n";
import { serverTranslator } from "@gms/i18n/server";
import { renderCarouselPdf, type CarouselPage } from "@gms/documents";
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

export interface BaseShareKit {
  /** Ready to edit: nothing is posted from the GMS. */
  posts: { linkedin: string; short: string; newsletter: string };
  links: { page: string; awards: string; image: string; badge: string };
  /** `svg` is the badge itself, as /badge/{slug}.svg serves it, for a preview that loads nothing. */
  badge: { verified: boolean; text: string; snippet: string; svg: string };
  award: PublicAward;
}

/** The share kit: the posts, link, card and badge, and (v1.12.0) the extras built with them. */
export interface ShareKit extends BaseShareKit, KitExtras {}

/** The longest short post: an X post, counting the link in full. */
export const SHORT_POST_MAX = 280;

const attr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export const badgeText = (funderName: string, verified: boolean) => `Funded by ${funderName}${verified ? " · verified" : ""}`;

/** The posts, links and badge for a listed award, from its public fields only. */
export function buildShareKit(ctx: Pick<ServiceContext, "config">, award: PublicAward, funder: Ws, audience: ShareAudience): BaseShareKit {
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
  return found ? fullKit(ctx, award, found, audience) : null;
}

/** The kit with its extras, for an award that is public. */
async function fullKit(ctx: ServiceContext, row: Award, found: { award: PublicAward; funder: Ws }, audience: ShareAudience): Promise<ShareKit> {
  return { ...buildShareKit(ctx, found.award, found.funder, audience), ...(await kitExtras(ctx, row, found, audience)) };
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
  /** The federal share, as the funder entered it, and whether this caller may change it (funder staff). */
  federal: FederalFunding & { canChange: boolean };
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
    kit: found ? await fullKit(ctx, award, found, audience) : null,
    federal: { ...federalView(ctx.locale ?? DEFAULT_LOCALE, award), canChange: audience === "funder" && ctx.actor.kind === "user" && ws.role !== null && FUNDER_CHANGE_ROLES.includes(ws.role) && ctx.scopes.includes("awards:write") },
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

// ------------------------------------------------------------------------------------ the kit, plus (v1.12.0)

const emailT = (locale: Locale) => serverTranslator(locale, "email");

/** The platforms a social page link may be on, by host (with or without `www.`). */
export const SOCIAL_PAGE_PLATFORMS = ["linkedin", "facebook", "instagram", "x", "bluesky", "threads"] as const;
export type SocialPagePlatform = (typeof SOCIAL_PAGE_PLATFORMS)[number];
const PAGE_HOSTS: Record<string, SocialPagePlatform> = { "linkedin.com": "linkedin", "facebook.com": "facebook", "instagram.com": "instagram", "x.com": "x", "twitter.com": "x", "bsky.app": "bluesky", "threads.net": "threads", "threads.com": "threads" };
const HANDLE = /^[A-Za-z0-9._-]{1,100}$/;

/** A workspace's social page, read from the link it gave: the platform and the handle to tag. */
export interface SocialPage {
  url: string;
  platform: SocialPagePlatform;
  /** What a post writes to tag the page, e.g. `@alder-creek-family-services`. */
  handle: string;
}

/**
 * An organization's page on a known platform, or null. LinkedIn takes company, school and showcase
 * pages only (never a person's profile); Bluesky `/profile/{handle}`; Threads `/@{name}`; the others
 * `/{name}`. The stored link is rebuilt from what was read, so nothing else of the address is kept.
 */
export function socialPageOf(raw: string | null | undefined): SocialPage | null {
  if (!raw) return null;
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.username || u.password || u.port) return null;
  const host = u.hostname.toLowerCase().replace(/^(www|m|mobile)\./, "");
  const platform = PAGE_HOSTS[host];
  if (!platform) return null;
  const parts = u.pathname.split("/").filter(Boolean);
  let name: string | undefined;
  let path: string;
  if (platform === "linkedin") {
    if (!["company", "school", "showcase"].includes(parts[0] ?? "")) return null;
    name = parts[1];
    path = `${parts[0]}/${name}`;
  } else if (platform === "bluesky") {
    if (parts[0] !== "profile") return null;
    name = parts[1];
    path = `profile/${name}`;
  } else if (platform === "threads") {
    name = parts[0]?.replace(/^@/, "");
    path = `@${name}`;
  } else {
    name = parts[0]?.replace(/^@/, "");
    path = `${name}`;
  }
  if (!name || !HANDLE.test(name) || (platform !== "linkedin" && platform !== "bluesky" && parts.length > 1)) return null;
  const canonical = platform === "x" ? "x.com" : platform === "bluesky" ? "bsky.app" : platform === "threads" ? "www.threads.net" : `www.${host}`;
  return { url: `https://${canonical}/${path}`, platform, handle: `@${name}` };
}

// ---- share-kit settings (share_kit_profiles, 0048)

/** The press release's credit wording. "Sponsored" is never one: a grant is not a sponsorship. */
export const CREDIT_WORDINGS = ["funded_by", "supported_by"] as const;
export type CreditWording = (typeof CREDIT_WORDINGS)[number];
/** Who changes a workspace's share-kit settings: its admins, in person (consent is theirs to give). */
export const SHARE_PROFILE_ROLES: readonly string[] = ["admin"];

export interface ShareProfile {
  /** The social page link, as stored, and what was read from it. */
  pageUrl: string | null;
  page: SocialPage | null;
  /** Whether the other side may tag this page. Without it the page is never tagged. */
  tagConsent: boolean;
  consentedAt: string | null;
  /** A funder's: "funded by" (the default) or "supported by". */
  creditWording: CreditWording;
  /** A funder's standard description, for the press release ("About ..."). */
  standardDescription: string | null;
  canChange: boolean;
}

type ProfileRow = Row<"share_kit_profiles">;
const creditOf = (r: ProfileRow | null | undefined): CreditWording => (r?.credit_wording === "supported_by" ? "supported_by" : "funded_by");
/** The page another side may tag: only with this side's consent, and only a page we can read. */
const taggable = (r: ProfileRow | null | undefined): SocialPage | null => (r && r.tag_consent === true ? socialPageOf(r.page_url) : null);

function profileView(r: ProfileRow | null | undefined, canChange: boolean): ShareProfile {
  return { pageUrl: r?.page_url ?? null, page: socialPageOf(r?.page_url), tagConsent: r?.tag_consent === true, consentedAt: r?.consented_at ?? null, creditWording: creditOf(r), standardDescription: r?.standard_description ?? null, canChange };
}

const profilesOf = async (ctx: Pick<ServiceContext, "repos">, ids: string[]): Promise<Map<string, ProfileRow>> => {
  const rows = ids.length ? await ctx.repos.table("share_kit_profiles").find({ workspace_id: [...new Set(ids)] }) : [];
  return new Map(rows.map((r) => [r.workspace_id, r]));
};

export const shareProfileInput = z
  .object({
    pageUrl: z.string().trim().max(300).nullable().optional(),
    tagConsent: z.boolean().optional(),
    creditWording: z.enum(CREDIT_WORDINGS).optional(),
    standardDescription: z.string().trim().max(1500).nullable().optional(),
  })
  .strict();

/** The workspace's share-kit settings. Any member who reads awards may read them. */
export async function getShareProfile(ctx: ServiceContext): Promise<ShareProfile> {
  const ws = await authorize(ctx, { scope: "awards:read" });
  const row = await ctx.repos.table("share_kit_profiles").one({ workspace_id: ws.id });
  return profileView(row, ctx.actor.kind === "user" && ws.role !== null && SHARE_PROFILE_ROLES.includes(ws.role) && ctx.scopes.includes("workspace:admin"));
}

const invalid = (field: string, message: string) => new ApiError(422, "validation_failed", message, [{ code: "invalid", field, detail: message }]);

/**
 * Change the share-kit settings: a workspace admin, in person. Consent to be tagged is the
 * organization's own, so no agent or API client gives it (403 human_only), and no MCP tool does.
 */
export async function updateShareProfile(ctx: ServiceContext, input: z.output<typeof shareProfileInput>): Promise<ShareProfile> {
  const ws = await authorize(ctx, { scope: "workspace:admin", roles: SHARE_PROFILE_ROLES, person: true });
  if (ctx.actor.kind !== "user") throw humanOnly("Changing your share-kit settings");
  if (ws.kind !== "funder" && (input.creditWording !== undefined || input.standardDescription !== undefined)) throw invalid("creditWording", "Only a funder sets the press release's credit wording and description");
  const before = await ctx.repos.table("share_kit_profiles").one({ workspace_id: ws.id });
  let pageUrl = input.pageUrl === undefined ? (before?.page_url ?? null) : input.pageUrl || null;
  if (pageUrl !== null) {
    const page = socialPageOf(pageUrl);
    if (!page) throw invalid("pageUrl", "Give the https address of your organization's page on LinkedIn, Facebook, Instagram, X, Bluesky or Threads");
    pageUrl = page.url;
  }
  // Consent follows the link: a new link needs consent again, and no link means no consent.
  const linkChanged = pageUrl !== (before?.page_url ?? null);
  const wanted = input.tagConsent ?? (linkChanged ? false : before?.tag_consent === true);
  if (wanted && !pageUrl) throw invalid("tagConsent", "Give your page's link before you agree to be tagged");
  const keepConsent = wanted && before?.tag_consent === true && !linkChanged;
  const description = input.standardDescription === undefined ? (before?.standard_description ?? null) : input.standardDescription || null;
  const next = {
    page_url: pageUrl,
    tag_consent: wanted,
    consented_at: wanted ? (keepConsent ? before!.consented_at : ctx.now().toISOString()) : null,
    consented_by: wanted ? (keepConsent ? before!.consented_by : ctx.actor.userId) : null,
    credit_wording: input.creditWording ?? creditOf(before),
    standard_description: description,
    updated_by: ctx.actor.userId,
  };
  const row = before ? (await ctx.repos.table("share_kit_profiles").update({ workspace_id: ws.id }, next))[0]! : await ctx.repos.table("share_kit_profiles").insert({ workspace_id: ws.id, ...next });
  if (!before || before.page_url !== row.page_url || before.tag_consent !== row.tag_consent || before.credit_wording !== row.credit_wording || before.standard_description !== row.standard_description) {
    // The ledger names what changed, never the text of the description.
    await audit(ctx, "workspace.share_kit_changed", "workspace", ws.id, { pageUrl: row.page_url, tagConsent: row.tag_consent, creditWording: row.credit_wording, description: row.standard_description !== null });
  }
  return profileView(row, true);
}

// ---- the federal share (the Stevens Amendment)

export interface FederalFunding {
  funded: boolean;
  /** Federal dollars, e.g. "80000.00". */
  amount: string | null;
  /** The federal share of the project's total costs, in percent, as entered (never computed). */
  percent: number | null;
  /** The federal agency, as the funder named it. */
  source: string | null;
  /** The statement of the federal share, or null until both the amount and the percentage are entered. */
  statement: string | null;
}

const toAmount = (n: number | string | null | undefined): string | null => (n === null || n === undefined || Number.isNaN(Number(n)) ? null : Number(n).toFixed(2));

/** "62.5", "100", "33.33" in the language. */
const percentText = (locale: Locale, p: number) => formatNumber(locale, p, { maximumFractionDigits: 2 });

/**
 * The statement of the federal share of costs, as HHS's grants policy asks of every statement,
 * press release and publication about a project paid for in whole or in part with federal money
 * (the Stevens Amendment; docs/award-sharing.md cites the rule). Only with both numbers: a
 * percentage is never guessed or worked out from other figures.
 */
export function federalStatement(locale: Locale, f: { funded: boolean; amount: string | null; percent: number | null; source: string | null }): string | null {
  if (!f.funded || f.amount === null || f.percent === null) return null;
  const t = emailT(locale);
  const amount = formatCurrency(locale, Number(f.amount), "USD", Number.isInteger(Number(f.amount)) ? 0 : 2);
  const percent = percentText(locale, f.percent);
  return f.source ? t("kit.federal.statement.agency", { agency: cleanText(f.source), amount, percent }) : t("kit.federal.statement.noAgency", { amount, percent });
}

export function federalView(locale: Locale, a: Pick<Award, "federally_funded" | "federal_amount" | "federal_percent" | "federal_source">): FederalFunding {
  const f = { funded: a.federally_funded === true, amount: toAmount(a.federal_amount), percent: a.federal_percent === null || a.federal_percent === undefined ? null : Number(a.federal_percent), source: a.federal_source ?? null };
  return { ...f, statement: federalStatement(locale, f) };
}

const twoDecimals = (n: number) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6;
export const federalInput = z
  .object({
    federallyFunded: z.boolean(),
    amount: z
      .string()
      .regex(/^\d{1,12}(\.\d{1,2})?$/, "A dollar amount, such as 80000 or 80000.50")
      .refine((v) => Number(v) > 0, "More than zero")
      .nullable()
      .optional(),
    percent: z.number().gt(0).lte(100).refine(twoDecimals, "At most two decimals").nullable().optional(),
    source: z.string().trim().min(1).max(200).nullable().optional(),
  })
  .strict();

/**
 * The funder marks an award as federally funded, with the federal amount and percentage (and,
 * optionally, the agency). Funder admins and program officers, in person. Unmarking clears the
 * numbers. Either number may be left empty: the statement then does not appear.
 */
export async function setFederalFunding(ctx: ServiceContext, awardId: string, input: z.output<typeof federalInput>): Promise<AwardSharing> {
  const { award } = await sideAward(ctx, awardId, "funder", "awards:write", FUNDER_CHANGE_ROLES);
  if (ctx.actor.kind !== "user") throw humanOnly("Changing an award's federal funding");
  const next = input.federallyFunded
    ? { federally_funded: true, federal_amount: input.amount === undefined ? award.federal_amount : input.amount === null ? null : Number(input.amount), federal_percent: input.percent === undefined ? award.federal_percent : input.percent, federal_source: input.source === undefined ? award.federal_source : input.source || null }
    : { federally_funded: false, federal_amount: null, federal_percent: null, federal_source: null };
  const same = next.federally_funded === award.federally_funded && toAmount(next.federal_amount) === toAmount(award.federal_amount) && Number(next.federal_percent ?? -1) === Number(award.federal_percent ?? -1) && (next.federal_source ?? null) === (award.federal_source ?? null);
  if (!same) {
    await ctx.repos.table("awards").update({ id: award.id }, next);
    await audit(ctx, "award.federal_funding_changed", "award", award.id, { federallyFunded: next.federally_funded, amount: toAmount(next.federal_amount), percent: next.federal_percent, source: next.federal_source });
  }
  return awardSharing(ctx, awardId, "funder");
}

// ---- the extras

export interface SocialTag extends SocialPage {
  /** Whose page it is. */
  name: string;
}

export interface KitExtras {
  /** "Funded by Riverbend Community Foundation" or "Supported by ...", the funder's choice. */
  creditLine: string;
  /** A press release to edit: the funder's standard description, the credit wording, the federal statement. Bracketed parts are for the person to fill in. */
  pressRelease: string;
  /** The statement of the federal share, when the funder entered both numbers; otherwise null. */
  federalStatement: string | null;
  /** The pages of the carousel PDF and their alt text; `path` downloads it (signed in). */
  carousel: { pages: { heading: string; alt: string }[]; path: string; fileName: string };
  /** What the portrait card (1080 × 1350) shows; the amount is null when the funder hides amounts. */
  portrait: { funder: string; recipient: string; program: string | null; purpose: string; year: number; amount: Money | null; verified: boolean };
  /** The other side's page to tag, only when that side gave the link and agreed to be tagged. */
  tags: { funder: SocialTag | null; grantee: SocialTag | null };
}

interface KitWords {
  locale: Locale;
  funder: string;
  recipient: string;
  amount: string | null;
  date: string;
  wording: CreditWording;
  credit: string;
  federal: string | null;
  description: string | null;
}

async function wordsFor(ctx: ServiceContext, row: Award, found: { award: PublicAward; funder: Ws }): Promise<KitWords & { profiles: Map<string, ProfileRow> }> {
  const locale = ctx.locale ?? DEFAULT_LOCALE;
  const t = emailT(locale);
  const funder = publicFunderName(found.funder);
  const a = found.award;
  const profiles = await profilesOf(ctx, [row.workspace_id, ...(row.recipient_workspace_id ? [row.recipient_workspace_id] : [])]);
  const fp = profiles.get(row.workspace_id);
  // The funder's own description, else the mission on its public page.
  const mission = (() => {
    const org = (found.funder.self_declared_profile ?? found.funder.org_projection ?? null) as { mission?: unknown } | null;
    return typeof org?.mission === "string" && org.mission.trim() ? cleanText(org.mission) : null;
  })();
  return {
    locale,
    funder,
    recipient: a.recipient.name,
    amount: a.amount ? formatCurrency(locale, Number(a.amount.amount), a.amount.currency, Number.isInteger(Number(a.amount.amount)) ? 0 : 2) : null,
    date: formatDateIn(locale, a.awardDate, "medium") ?? a.awardDate,
    wording: creditOf(fp),
    credit: creditOf(fp) === "supported_by" ? t("kit.credit.supportedBy", { funder }) : t("kit.credit.fundedBy", { funder }),
    federal: federalView(locale, row).statement,
    description: fp?.standard_description ? cleanText(fp.standard_description) : mission,
    profiles,
  };
}

/** The press release, for the funder's announcement or the grantee's. */
export function pressRelease(w: KitWords, a: PublicAward, audience: ShareAudience): string {
  const t = emailT(w.locale);
  const v = { funder: w.funder, recipient: w.recipient, amount: w.amount ?? "", program: a.program ?? "", purpose: a.purpose, date: w.date, hasAmount: w.amount ? "yes" : "no", hasProgram: a.program ? "yes" : "no" };
  const parts = [
    audience === "funder" ? t("kit.press.headline.funder", v) : t("kit.press.headline.grantee", v),
    t("kit.press.release"),
    audience === "funder" ? t("kit.press.lead.funder", v) : t("kit.press.lead.grantee", v),
    w.wording === "supported_by" ? t("kit.press.credit.supportedBy", v) : t("kit.press.credit.fundedBy", v),
    t("kit.press.quote"),
    ...(w.federal ? [w.federal] : []),
    t("kit.press.about", { name: w.funder }),
    w.description ?? t("kit.press.aboutPlaceholder", { name: w.funder }),
    t("kit.press.about", { name: w.recipient }),
    t("kit.press.aboutPlaceholder", { name: w.recipient }),
    t("kit.press.contact"),
    t("kit.press.more", { link: a.links.page }),
  ];
  return parts.join("\n\n");
}

/** The carousel's pages, worded in the request's language: 6 without the amount or a federal statement, up to 8 with both. */
export function carouselPages(w: KitWords, a: PublicAward, audience: ShareAudience, awardsPage: string): CarouselPage[] {
  const t = emailT(w.locale);
  const v = { funder: w.funder, recipient: w.recipient, purpose: a.purpose, program: a.program ?? "", date: w.date, amount: w.amount ?? "" };
  const pages: Omit<CarouselPage, "alt">[] = [
    { eyebrow: t("kit.carousel.cover.eyebrow"), heading: t("kit.carousel.cover.heading", v), body: [a.purpose] },
    { eyebrow: t("kit.carousel.funds.eyebrow"), heading: a.purpose, body: [a.program ? t("kit.carousel.funds.program", v) : t("kit.carousel.funds.date", v)] },
    { eyebrow: t("kit.carousel.grantee.eyebrow"), heading: w.recipient, body: [t("kit.carousel.grantee.body", v)] },
    ...(w.amount ? [{ eyebrow: t("kit.carousel.amount.eyebrow"), heading: w.amount, body: [t("kit.carousel.amount.body", v)] }] : []),
    { eyebrow: t("kit.carousel.funder.eyebrow"), heading: w.funder, body: [w.description ?? t("kit.carousel.funder.fallback", v)] },
    ...(w.federal ? [{ eyebrow: t("kit.carousel.federal.eyebrow"), heading: t("kit.carousel.federal.heading"), body: [w.federal] }] : []),
    { eyebrow: null, heading: audience === "funder" ? t("kit.carousel.thanks.funder", v) : t("kit.carousel.thanks.grantee", v), body: [w.credit] },
    { eyebrow: t("kit.carousel.more.eyebrow"), heading: t("kit.carousel.more.heading"), body: [a.links.page, t("kit.carousel.more.awards", { funder: w.funder, link: awardsPage })] },
  ];
  return pages.map((p, i) => ({ ...p, alt: t("kit.carousel.alt", { page: i + 1, total: pages.length, heading: p.heading, text: p.body.join(" ") }) }));
}

const tagOf = (r: ProfileRow | undefined, name: string): SocialTag | null => {
  const page = taggable(r);
  return page ? { ...page, name } : null;
};

async function kitExtras(ctx: ServiceContext, row: Award, found: { award: PublicAward; funder: Ws }, audience: ShareAudience): Promise<KitExtras> {
  const w = await wordsFor(ctx, row, found);
  const a = found.award;
  const awardsPage = `${ctx.config.webBaseUrl}/f/${found.funder.handle}/awards`;
  const id = `awd_${row.id}`;
  return {
    creditLine: w.credit,
    pressRelease: pressRelease(w, a, audience),
    federalStatement: w.federal,
    carousel: { pages: carouselPages(w, a, audience, awardsPage).map((p) => ({ heading: p.heading, alt: p.alt })), path: audience === "funder" ? `/gms/awards/${id}/sharing/carousel.pdf` : `/gms/my/awards/${id}/sharing/carousel.pdf`, fileName: `${a.slug}-carousel.pdf` },
    portrait: { funder: w.funder, recipient: w.recipient, program: a.program, purpose: a.purpose, year: a.year, amount: a.amount, verified: funderVerified(found.funder) },
    tags: { funder: tagOf(w.profiles.get(row.workspace_id), w.funder), grantee: row.recipient_workspace_id ? tagOf(w.profiles.get(row.recipient_workspace_id), w.recipient) : null },
  };
}

/** The carousel PDF for a public award, from the side asking; 404 for an award that is not public. */
export async function carouselPdf(ctx: ServiceContext, awardId: string, audience: ShareAudience): Promise<{ bytes: Uint8Array; fileName: string }> {
  const { award } = await sideAward(ctx, awardId, audience, "awards:read");
  const found = await listedAwardBySlug(ctx, award.public_slug);
  if (!found) throw new ApiError(409, "not_public", "This award is not listed publicly, so it has no carousel");
  const w = await wordsFor(ctx, award, found);
  const pages = carouselPages(w, found.award, audience, `${ctx.config.webBaseUrl}/f/${found.funder.handle}/awards`);
  const t = emailT(w.locale);
  const bytes = await renderCarouselPdf({ title: t("kit.carousel.cover.heading", { funder: w.funder, recipient: w.recipient }), pages, footer: found.award.links.page.replace(/^https?:\/\//, ""), createdAt: ctx.now().toISOString(), lang: INTL_LOCALE[w.locale] });
  return { bytes, fileName: `${found.award.slug}-carousel.pdf` };
}

// ---- "Meet our grantees"

/** The most awards one "Meet our grantees" post lists. */
export const MEET_GRANTEES_MAX = 10;

export interface MeetGrantee {
  awardId: string;
  recipient: string;
  purpose: string;
  link: string;
  /** The grantee's page, only when it gave the link and agreed to be tagged. */
  tag: SocialTag | null;
}

/**
 * The awards of one of the funder's programs that may be public, newest first, for one post. An
 * award is in it only when `isPubliclyListable` says so: never a confidential award, never one the
 * funder does not list, never one whose grantee chose "Don't list us publicly".
 */
export async function meetOurGrantees(ctx: ServiceContext, programId: string): Promise<{ program: { id: string; name: string }; grantees: MeetGrantee[]; awardsPage: string }> {
  const ws = await authorize(ctx, { scope: "awards:read", kind: "funder" });
  const program = await ctx.repos.table("programs").one({ id: programId });
  if (!program || program.workspace_id !== ws.id) throw notFound("Program");
  const funder = await ctx.repos.table("workspaces").one({ id: ws.id });
  if (!funder) throw notFound("Workspace");
  const rows = await ctx.repos.table("awards").find({ workspace_id: ws.id, program_id: program.id, status: [...LISTABLE_STATUSES] }, { orderBy: "created_at", ascending: false, limit: LIST_LIMIT });
  const parties = await partiesOf(ctx, rows);
  const listed = rows
    .filter((a) => isPubliclyListable(a, { funder, recipient: a.recipient_workspace_id ? parties.get(a.recipient_workspace_id) : null }))
    .map((a) => ({ row: a, view: publicAwardView(ctx, a, funder, parties.get(a.recipient_workspace_id!)!, program.name) }))
    .sort((x, y) => (x.view.awardDate === y.view.awardDate ? x.view.recipient.name.localeCompare(y.view.recipient.name) : x.view.awardDate < y.view.awardDate ? 1 : -1))
    .slice(0, MEET_GRANTEES_MAX);
  const profiles = await profilesOf(ctx, listed.map((x) => x.row.recipient_workspace_id!));
  const grantees: MeetGrantee[] = listed.map(({ row, view }) => ({ awardId: `awd_${row.id}`, recipient: view.recipient.name, purpose: view.purpose, link: view.links.page, tag: tagOf(profiles.get(row.recipient_workspace_id!), view.recipient.name) }));
  return { program: { id: program.id, name: cleanText(program.name) }, grantees, awardsPage: `${ctx.config.webBaseUrl}/f/${funder.handle}/awards` };
}
