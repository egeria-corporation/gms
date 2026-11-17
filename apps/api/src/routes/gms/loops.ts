// SPDX-License-Identifier: AGPL-3.0-only
// /gms routes of the funder loops (E4, docs/loops.md):
//   GET  /gms/public/for-funders, /gms/public/partners, /gms/public/join/{token}(/logo)   no token
//   POST /gms/referrals/claim                                              a signed-in person
//   /gms/peer-invitations*                                                  a funder workspace's admins
//   /gms/partner-settings*                                                  a funder workspace's admins
//   /gms/partners/moderation/*                                              DIRECTORY_MODERATORS, signed in
//   GET  /gms/reusable-profile                                              an applicant workspace
// Each handler builds the context and calls one service function, where the authorization lives.
// Sending, links, logos, listings and moderation are a person's: who may is checked before the
// body is read, so a caller who may not learns nothing from validation.
import { Hono, type Context, type MiddlewareHandler } from "hono";
import type { AppEnv } from "../../app.ts";
import { authenticate, requireUser } from "../../auth/middleware.ts";
import { cameThroughSso } from "../../auth/session.ts";
import { ok, pageInfo, paginated } from "../../lib/errors.ts";
import { bareUuid } from "../../lib/ids.ts";
import { parse } from "../../lib/input.ts";
import * as forFunders from "../../services/for-funders.ts";
import * as partners from "../../services/partners.ts";
import * as peers from "../../services/peer-invites.ts";
import * as referrals from "../../services/referrals.ts";
import { profileForFunders } from "../../services/reusable-profile.ts";
import { jsonBody, publicCtx, svc, userSvc } from "../http.ts";

type C = Context<AppEnv>;
export const loopRoutes = new Hono<AppEnv>();

const signedIn: MiddlewareHandler<AppEnv> = async (c, next) => (c.get("principal") ? next() : authenticate()(c, next));
for (const prefix of ["peer-invitations", "partner-settings", "reusable-profile"]) {
  loopRoutes.use(`/${prefix}`, signedIn);
  loopRoutes.use(`/${prefix}/*`, signedIn);
}
const withPorts = (c: C) => ({ ...publicCtx(c), ports: c.get("deps").ports?.(c.env) ?? {} });
const moderator = (c: C) => ({ userId: c.get("user").userId, email: c.get("user").email ?? null, viaSso: cameThroughSso(c.get("user")) });
const moderators = (c: C) => partners.directoryModerators(c.env);
const noStore = (c: C) => c.header("Cache-Control", "no-store");

// ---- public pages ----
loopRoutes.get("/public/for-funders", async (c) => {
  // The page differs per link and its count changes; never shared between visitors.
  c.header("Cache-Control", "private, max-age=60");
  return c.json(ok(await forFunders.forFundersPage(withPorts(c), { ref: c.req.query("ref"), invite: c.req.query("invite") })));
});
loopRoutes.get("/public/partners", async (c) => {
  c.header("Cache-Control", "public, max-age=60");
  const items = await partners.partnerDirectory(publicCtx(c));
  return c.json(paginated(items, pageInfo(1, Math.max(items.length, 1), items.length)));
});
loopRoutes.get("/public/join/:token", async (c) => {
  c.header("Cache-Control", "public, max-age=60");
  return c.json(ok(await partners.onboardingPage(publicCtx(c), c.req.param("token"))));
});
loopRoutes.get("/public/join/:token/logo", async (c) => {
  const logo = await partners.onboardingLogo(withPorts(c), c.req.param("token"));
  return new Response(logo.bytes as Uint8Array<ArrayBuffer>, {
    status: 200,
    headers: { "Content-Type": logo.mime, "Content-Length": String(logo.bytes.byteLength), "Cache-Control": "public, max-age=300", ETag: `"${logo.sha256}"`, "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox" },
  });
});

// ---- a person claims their new workspace for the link they came from ----
loopRoutes.post("/referrals/claim", requireUser(), async (c) => c.json(ok(await referrals.claimReferral(userSvc(c), parse(referrals.claimInput, await jsonBody(c))))));

// ---- peer invitations ----
loopRoutes.get("/peer-invitations", async (c) => c.json(ok(await peers.listPeerInvitations(await svc(c)))));
loopRoutes.post("/peer-invitations/preview", async (c) => {
  noStore(c);
  const ctx = await svc(c);
  await peers.assertMayInvite(ctx);
  return c.json(ok(await peers.previewPeerInvite(ctx, parse(peers.inviteInput, await jsonBody(c)))));
});
loopRoutes.post("/peer-invitations", async (c) => {
  const ctx = await svc(c);
  await peers.assertMayInvite(ctx);
  return c.json(ok(await peers.sendPeerInvite(ctx, parse(peers.sendInput, await jsonBody(c)))));
});

// ---- an intermediary's onboarding link and directory listing ----
const asAdmin = async (c: C, what: string) => {
  const ctx = await svc(c);
  await partners.admin(ctx, what);
  return ctx;
};
loopRoutes.get("/partner-settings", async (c) => c.json(ok(await partners.getPartnerSettings(await svc(c)))));
loopRoutes.post("/partner-settings/onboarding-link", async (c) => c.json(ok(await partners.createOnboardingLink(await svc(c)))));
loopRoutes.post("/partner-settings/onboarding-link/replace", async (c) => c.json(ok(await partners.revokeOnboardingLink(await svc(c), true))));
loopRoutes.delete("/partner-settings/onboarding-link", async (c) => c.json(ok(await partners.revokeOnboardingLink(await svc(c), false))));
loopRoutes.put("/partner-settings/onboarding-link/logo", async (c) => {
  const ctx = await asAdmin(c, "Changing the onboarding logo");
  return c.json(ok(await partners.putOnboardingLogo(ctx, parse(partners.logoInput, await jsonBody(c)))));
});
loopRoutes.patch("/partner-settings/onboarding-link/logo", async (c) => {
  const ctx = await asAdmin(c, "Changing the onboarding logo");
  return c.json(ok(await partners.putOnboardingLogoAlt(ctx, parse(partners.logoAltInput, await jsonBody(c)))));
});
loopRoutes.delete("/partner-settings/onboarding-link/logo", async (c) => c.json(ok(await partners.removeOnboardingLogo(await svc(c)))));
loopRoutes.put("/partner-settings/listing", async (c) => {
  const ctx = await asAdmin(c, "Asking to be listed in the partner directory");
  return c.json(ok(await partners.requestListing(ctx, parse(partners.listingInput, await jsonBody(c)))));
});
loopRoutes.post("/partner-settings/listing/withdraw", async (c) => c.json(ok(await partners.withdrawListing(await svc(c)))));

// ---- directory moderation ----
const listingId = (c: C) => bareUuid(c.req.param("id"), "Listing");
loopRoutes.get("/partners/moderation/me", requireUser(), (c) => c.json(ok({ moderator: partners.isDirectoryModerator(moderators(c), moderator(c)) })));
loopRoutes.get("/partners/moderation/queue", requireUser(), async (c) => {
  const items = await partners.listingQueue(userSvc(c), moderators(c), moderator(c));
  return c.json(paginated(items, pageInfo(1, Math.max(items.length, 1), items.length)));
});
loopRoutes.post("/partners/moderation/listings/:id/approve", requireUser(), async (c) => c.json(ok(await partners.approveListing(userSvc(c), moderators(c), moderator(c), listingId(c)))));
loopRoutes.post("/partners/moderation/listings/:id/reject", requireUser(), async (c) => {
  const ctx = userSvc(c);
  // A moderator only, before the body is read.
  partners.assertModerator(ctx, moderators(c), moderator(c));
  return c.json(ok(await partners.rejectListing(ctx, moderators(c), moderator(c), listingId(c), parse(partners.rejectListingInput, await jsonBody(c)))));
});

// ---- the applicant's reusable profile ----
loopRoutes.get("/reusable-profile", async (c) => c.json(ok(await profileForFunders(await svc(c)))));
