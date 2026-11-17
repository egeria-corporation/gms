// SPDX-License-Identifier: AGPL-3.0-only
// Intermediaries (E4, loop 3). A funder workspace that runs at least MIN_NAMED_FUNDS funds (C3's
// funds; the default fund is not counted) is an intermediary here. It gets:
//   - a co-branded onboarding link (`/join/<token>`) for its funds' grantees and affiliated
//     funders: the page names it and its funds and shows a logo it uploads, with alt text. Colours
//     come only from the theme. Recipients go on into the normal sign-up and workspace setup, and a
//     workspace made from the link is counted for it (referrals.ts);
//   - a listing in the partner directory (`/partners`) when it asks for one and an operator
//     approves it: name, region, number of funds and a link to its public page. It can withdraw at
//     any time.
// Every change here is a signed-in admin's (links, logo, listing) or a moderator's (decisions), on
// every surface: agents and API clients are refused, and no MCP tool makes one. Moderators are the
// operators in DIRECTORY_MODERATORS, or in GALLERY_MODERATORS while that is not set.
// Listing moves run guard → write → ledger (`changeStatus`).
import { sha256Hex } from "@gms/documents";
import { z } from "zod";
import { ApiError, notFound } from "../lib/errors.ts";
import { humanOnly } from "./awards.ts";
import { audit, authorize, changeStatus, required, type ServiceContext } from "./context.ts";
import { isModerator, type Moderator } from "./gallery.ts";
import { verificationOf } from "./profile.ts";
import type { PublicContext } from "./public.ts";
import { ensureLink, joinCounts, liveLink } from "./referrals.ts";
import type { Row } from "./repos/types.ts";

type Link = Row<"referral_links">;
type Listing = Row<"directory_listings">;

/** Funds besides the default a workspace runs to count as an intermediary. One place to relax. */
export const MIN_NAMED_FUNDS = 2;
/** The largest logo an intermediary uploads, and the kinds of image it may be (never SVG: it can carry script). */
export const LOGO_MAX_BYTES = 256 * 1024;
export const LOGO_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;

const ADMIN = { scope: "workspace:admin", kind: "funder", roles: ["admin"] } as const;

/** A signed-in admin of this funder workspace, never an agent or API client. */
export async function admin(ctx: ServiceContext, what: string) {
  const ws = await authorize(ctx, { ...ADMIN, person: true });
  if (ctx.actor.kind !== "user") throw humanOnly(what);
  return ws;
}

/** The workspace's funds other than the default, by name. */
export async function namedFundsOf(ctx: Pick<ServiceContext, "repos">, workspaceId: string) {
  return (await ctx.repos.table("funds").find({ workspace_id: workspaceId }, { orderBy: "name" })).filter((f) => !f.is_default);
}

async function eligibility(ctx: Pick<ServiceContext, "repos">, workspaceId: string) {
  const funds = await namedFundsOf(ctx, workspaceId);
  return { funds, eligible: funds.length >= MIN_NAMED_FUNDS };
}

function assertEligible(e: { eligible: boolean }) {
  if (!e.eligible) throw new ApiError(409, "not_an_intermediary", `Onboarding links and the partner directory are for workspaces that run ${MIN_NAMED_FUNDS} or more funds. Add your funds in Settings, Funds`);
}

// ------------------------------------------------------------------------------------ the onboarding link

const logoOf = (ctx: Pick<ServiceContext, "config">, l: Link) => (l.logo_path ? { url: `${ctx.config.baseUrl}/gms/public/join/${l.token}/logo?v=${l.logo_sha256!.slice(0, 12)}`, alt: l.logo_alt! } : null);
const linkView = (ctx: Pick<ServiceContext, "config">, l: Link, joined: number) => ({ token: l.token, url: `${ctx.config.webBaseUrl}/join/${l.token}`, logo: logoOf(ctx, l), joined, createdAt: l.created_at });

/** The settings card: whether this workspace is an intermediary, its link and logo, and its directory listing. */
export async function getPartnerSettings(ctx: ServiceContext) {
  const ws = await authorize(ctx, ADMIN);
  const e = await eligibility(ctx, ws.id);
  const link = await ctx.repos.table("referral_links").one({ workspace_id: ws.id, kind: "onboarding", revoked_at: null });
  const joined = link ? ((await joinCounts(ctx, { links: [link.id] })).get(link.id) ?? 0) : 0;
  const listing = await ctx.repos.table("directory_listings").one({ workspace_id: ws.id });
  return {
    eligible: e.eligible,
    minFunds: MIN_NAMED_FUNDS,
    funds: e.funds.map((f) => ({ id: f.id, name: f.name })),
    link: link ? linkView(ctx, link, joined) : null,
    listing: listing ? listingView(listing) : null,
    canChange: ctx.actor.kind === "user",
  };
}

/** Make the onboarding link (the same one when it exists). */
export async function createOnboardingLink(ctx: ServiceContext) {
  const ws = await admin(ctx, "Making an onboarding link");
  assertEligible(await eligibility(ctx, ws.id));
  const existed = await ctx.repos.table("referral_links").one({ workspace_id: ws.id, kind: "onboarding", revoked_at: null });
  const link = await ensureLink(ctx, ws.id, "onboarding");
  if (!existed) await audit(ctx, "referral_link.created", "referral_link", link.id, { kind: "onboarding" });
  return getPartnerSettings(ctx);
}

/** Turn the link off; with `replace`, a new link (and the logo moves to it). Old links stop working at once. */
export async function revokeOnboardingLink(ctx: ServiceContext, replace: boolean) {
  const ws = await admin(ctx, replace ? "Replacing the onboarding link" : "Turning the onboarding link off");
  const link = required(await ctx.repos.table("referral_links").one({ workspace_id: ws.id, kind: "onboarding", revoked_at: null }), "Onboarding link");
  await ctx.repos.table("referral_links").update({ id: link.id, revoked_at: null }, { revoked_at: ctx.now().toISOString() });
  await audit(ctx, "referral_link.revoked", "referral_link", link.id, { kind: "onboarding", replaced: replace });
  if (replace) {
    assertEligible(await eligibility(ctx, ws.id));
    const fresh = await ensureLink(ctx, ws.id, "onboarding");
    if (link.logo_path) await ctx.repos.table("referral_links").update({ id: fresh.id }, { logo_storage: link.logo_storage, logo_path: link.logo_path, logo_mime: link.logo_mime, logo_sha256: link.logo_sha256, logo_alt: link.logo_alt });
    await audit(ctx, "referral_link.created", "referral_link", fresh.id, { kind: "onboarding", replaces: link.id });
  }
  return getPartnerSettings(ctx);
}

export const logoInput = z
  .object({
    mime: z.enum(LOGO_TYPES),
    contentBase64: z.string().min(8).max(Math.ceil((LOGO_MAX_BYTES * 4) / 3) + 8),
    /** What the logo shows, read aloud by screen readers. */
    alt: z.string().trim().min(1).max(200),
  })
  .strict();
export const logoAltInput = z.object({ alt: z.string().trim().min(1).max(200) }).strict();

/** The first bytes each image kind starts with: the file must be what it says. */
const MAGIC: Record<(typeof LOGO_TYPES)[number], (b: Uint8Array) => boolean> = {
  "image/png": (b) => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  "image/jpeg": (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  "image/webp": (b) => b.length > 12 && String.fromCharCode(...b.subarray(0, 4)) === "RIFF" && String.fromCharCode(...b.subarray(8, 12)) === "WEBP",
};

/** Upload the logo shown on the onboarding page, with its alt text. */
export async function putOnboardingLogo(ctx: ServiceContext, input: z.output<typeof logoInput>) {
  const ws = await admin(ctx, "Changing the onboarding logo");
  const link = required(await ctx.repos.table("referral_links").one({ workspace_id: ws.id, kind: "onboarding", revoked_at: null }), "Onboarding link");
  if (!ctx.ports.storage) throw new ApiError(503, "storage_unavailable", "File storage is not configured on this server");
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(input.contentBase64), (c) => c.charCodeAt(0));
  } catch {
    throw new ApiError(400, "bad_request", "contentBase64 is not valid base64");
  }
  if (bytes.byteLength > LOGO_MAX_BYTES) throw new ApiError(413, "logo_too_large", `A logo can be up to ${LOGO_MAX_BYTES / 1024} KB`);
  if (!MAGIC[input.mime](bytes)) throw new ApiError(422, "logo_not_an_image", "That file is not a PNG, JPEG or WebP image", [{ code: "logo_not_an_image", field: "contentBase64" }]);
  const sha256 = await sha256Hex(bytes);
  const stored = await ctx.ports.storage.put(`onboarding-logos/${ws.id}/${sha256}`, bytes, input.mime);
  await ctx.repos.table("referral_links").update({ id: link.id }, { logo_storage: stored.storage, logo_path: stored.path, logo_mime: input.mime, logo_sha256: sha256, logo_alt: input.alt });
  await audit(ctx, "referral_link.logo_set", "referral_link", link.id, { sha256, bytes: bytes.byteLength, mime: input.mime });
  return getPartnerSettings(ctx);
}

/** Change only the logo's alt text. */
export async function putOnboardingLogoAlt(ctx: ServiceContext, input: z.output<typeof logoAltInput>) {
  const ws = await admin(ctx, "Changing the onboarding logo");
  const link = required(await ctx.repos.table("referral_links").one({ workspace_id: ws.id, kind: "onboarding", revoked_at: null }), "Onboarding link");
  if (!link.logo_path) throw notFound("Logo");
  await ctx.repos.table("referral_links").update({ id: link.id }, { logo_alt: input.alt });
  await audit(ctx, "referral_link.logo_alt_set", "referral_link", link.id, {});
  return getPartnerSettings(ctx);
}

export async function removeOnboardingLogo(ctx: ServiceContext) {
  const ws = await admin(ctx, "Removing the onboarding logo");
  const link = required(await ctx.repos.table("referral_links").one({ workspace_id: ws.id, kind: "onboarding", revoked_at: null }), "Onboarding link");
  if (link.logo_path) {
    await ctx.repos.table("referral_links").update({ id: link.id }, { logo_storage: null, logo_path: null, logo_mime: null, logo_sha256: null, logo_alt: null });
    await audit(ctx, "referral_link.logo_removed", "referral_link", link.id, {});
  }
  return getPartnerSettings(ctx);
}

/** The co-branded page: the intermediary's name, its funds, its logo. 404 for a turned-off link or one that no longer runs enough funds. */
export async function onboardingPage(ctx: PublicContext, token: string) {
  const link = await liveLink(ctx, token, "onboarding");
  const w = link ? await ctx.repos.table("workspaces").one({ id: link.workspace_id, kind: "funder" }) : null;
  if (!link || !w || w.status !== "active") throw notFound("Onboarding link");
  const e = await eligibility(ctx, w.id);
  if (!e.eligible) throw notFound("Onboarding link");
  return { intermediary: { name: w.display_name, handle: w.handle, verification: verificationOf(w) }, funds: e.funds.map((f) => f.name), logo: logoOf(ctx, link) };
}

/** The logo's bytes for the page, or 404. */
export async function onboardingLogo(ctx: PublicContext & { ports?: ServiceContext["ports"] }, token: string) {
  const link = await liveLink(ctx, token, "onboarding");
  if (!link?.logo_path || !ctx.ports?.storage) throw notFound("Logo");
  const bytes = await ctx.ports.storage.get({ storage: link.logo_storage as "r2" | "supabase", path: link.logo_path });
  if (!bytes) throw notFound("Logo");
  return { bytes, mime: link.logo_mime!, sha256: link.logo_sha256! };
}

// ------------------------------------------------------------------------------------ the directory

const listingView = (l: Listing) => ({
  status: l.status as "pending" | "approved" | "rejected" | "withdrawn",
  region: l.region,
  submittedAt: l.submitted_at,
  decidedAt: l.decided_at,
  decisionReason: l.status === "rejected" ? l.decision_reason : null,
  withdrawnAt: l.withdrawn_at,
});

export const listingInput = z.object({ region: z.string().trim().min(2).max(100) }).strict();

/** One move of a listing: guard → write (only if the status is still the one read) → ledger. */
async function move(ctx: ServiceContext, row: Listing, event: string, from: readonly string[], to: Listing["status"], patch: Partial<Listing>, data: Record<string, unknown> = {}) {
  let saved: Listing | undefined;
  const inWorkspace = { ...ctx, workspace: { id: row.workspace_id, kind: "funder" as const, role: ctx.workspace?.role ?? null, memberScope: ctx.workspace?.memberScope ?? null } };
  await changeStatus(inWorkspace, {
    event,
    subjectType: "directory_listing",
    subjectId: row.id,
    current: row.status,
    from,
    to,
    write: async () => {
      [saved] = await ctx.repos.table("directory_listings").update({ id: row.id, status: row.status }, { ...patch, status: to });
      if (!saved) throw new ApiError(409, "conflict", "This listing changed while you were working on it. Reload it and try again");
    },
    data,
  });
  return saved!;
}

/** Ask to be listed (or ask again after withdrawing or a decline). Nothing is public until a moderator approves it. */
export async function requestListing(ctx: ServiceContext, input: z.output<typeof listingInput>) {
  const ws = await admin(ctx, "Asking to be listed in the partner directory");
  assertEligible(await eligibility(ctx, ws.id));
  const at = ctx.now().toISOString();
  const row = await ctx.repos.table("directory_listings").one({ workspace_id: ws.id });
  if (row?.status === "pending") throw new ApiError(409, "listing_pending", "Your request is waiting for a moderator. Withdraw it first to change it");
  if (row?.status === "approved") throw new ApiError(409, "already_listed", "You are listed already. Withdraw the listing first to change it");
  if (!row) {
    const made = await ctx.repos.table("directory_listings").insert({ workspace_id: ws.id, region: input.region, status: "pending", submitted_by: ctx.actor.userId!, submitted_at: at });
    await audit(ctx, "directory_listing.requested", "directory_listing", made.id, { region: made.region });
    return listingView(made);
  }
  const fresh = { region: input.region, submitted_by: ctx.actor.userId!, submitted_at: at, decided_at: null, decided_by: null, decision_reason: null, withdrawn_at: null };
  return listingView(await move(ctx, row, "directory_listing.requested", ["withdrawn", "rejected"], "pending", fresh, { region: input.region }));
}

/** Take the listing back at any time: a pending request leaves the queue, a listed one leaves /partners at once. */
export async function withdrawListing(ctx: ServiceContext) {
  const ws = await admin(ctx, "Withdrawing from the partner directory");
  const row = required(await ctx.repos.table("directory_listings").one({ workspace_id: ws.id }), "Listing");
  return listingView(await move(ctx, row, "directory_listing.withdrawn", ["pending", "approved"], "withdrawn", { withdrawn_at: ctx.now().toISOString() }));
}

/** DIRECTORY_MODERATORS, else GALLERY_MODERATORS: comma-separated user ids or email addresses. */
export const directoryModerators = (env: { DIRECTORY_MODERATORS?: string; GALLERY_MODERATORS?: string }): string | null => (env.DIRECTORY_MODERATORS?.trim() ? env.DIRECTORY_MODERATORS : (env.GALLERY_MODERATORS ?? null));

export function assertModerator(ctx: ServiceContext, raw: string | null, who: Moderator) {
  if (ctx.actor.kind !== "user" || ctx.actor.userId !== who.userId) throw humanOnly("Moderating the partner directory");
  if (!isModerator(raw, who)) throw new ApiError(403, "not_a_directory_moderator", "Only the partner directory's moderators can review listings");
}

export const isDirectoryModerator = (raw: string | null, who: Moderator) => isModerator(raw, who);

/** The queue: pending requests, oldest first, with what the directory would show. */
export async function listingQueue(ctx: ServiceContext, moderators: string | null, who: Moderator) {
  assertModerator(ctx, moderators, who);
  const rows = await ctx.repos.table("directory_listings").find({ status: "pending" }, { orderBy: "submitted_at" });
  const out = [];
  for (const r of rows) {
    const w = await ctx.repos.table("workspaces").one({ id: r.workspace_id });
    const e = await eligibility(ctx, r.workspace_id);
    out.push({ id: r.id, ...listingView(r), partner: w ? { name: w.display_name, handle: w.handle, verification: verificationOf(w) } : null, funds: e.funds.length, eligible: e.eligible });
  }
  return out;
}

export const rejectListingInput = z.object({ reason: z.string().trim().min(3).max(2000) }).strict();

export async function approveListing(ctx: ServiceContext, moderators: string | null, who: Moderator, id: string) {
  assertModerator(ctx, moderators, who);
  const row = required(await ctx.repos.table("directory_listings").one({ id }), "Listing");
  if (row.status === "pending") assertEligible(await eligibility(ctx, row.workspace_id));
  return { id: row.id, ...listingView(await move(ctx, row, "directory_listing.approved", ["pending"], "approved", { decided_at: ctx.now().toISOString(), decided_by: ctx.actor.userId! })) };
}

export async function rejectListing(ctx: ServiceContext, moderators: string | null, who: Moderator, id: string, input: z.output<typeof rejectListingInput>) {
  assertModerator(ctx, moderators, who);
  const row = required(await ctx.repos.table("directory_listings").one({ id }), "Listing");
  return { id: row.id, ...listingView(await move(ctx, row, "directory_listing.rejected", ["pending"], "rejected", { decided_at: ctx.now().toISOString(), decided_by: ctx.actor.userId!, decision_reason: input.reason })) };
}

/**
 * `/partners`: approved listings of intermediaries that still run enough funds, by name. Name,
 * region, number of funds, how verified, and a link to their public page. Nothing else.
 */
export async function partnerDirectory(ctx: PublicContext) {
  const rows = await ctx.repos.table("directory_listings").find({ status: "approved" }, { limit: 1000 });
  const items = [];
  for (const r of rows) {
    const w = await ctx.repos.table("workspaces").one({ id: r.workspace_id, kind: "funder" });
    if (!w || w.status !== "active") continue;
    const e = await eligibility(ctx, w.id);
    if (!e.eligible) continue;
    items.push({ name: w.display_name, handle: w.handle, region: r.region, funds: e.funds.length, page: `${ctx.config.webBaseUrl}/f/${w.handle}`, verification: verificationOf(w) });
  }
  return items.sort((a, b) => a.name.localeCompare(b.name));
}
