// SPDX-License-Identifier: AGPL-3.0-only
// /gms routes of the template gallery:
//   GET  /gms/gallery, /gms/gallery/{slug}                         public reads, no token
//   /gms/gallery/moderation/*                                       the operators in GALLERY_MODERATORS, signed in
//   /gms/workspaces/{workspaceId}/gallery/*                         a funder workspace: copy, share, withdraw
// Each handler parses input, builds the context and calls one function of services/gallery.ts,
// where the authorization lives. Sharing, withdrawing and moderating take a signed-in person.
import { Hono, type Context, type MiddlewareHandler } from "hono";
import type { AppEnv } from "../app.ts";
import { authenticate, requireUser } from "../auth/middleware.ts";
import { cameThroughSso } from "../auth/session.ts";
import { created, ok, pageInfo, paginated } from "../lib/errors.ts";
import { bareUuid } from "../lib/ids.ts";
import { parse } from "../lib/input.ts";
import * as gallery from "../services/gallery.ts";
import { jsonBody, page, publicCtx, svc, userSvc } from "./http.ts";

type C = Context<AppEnv>;
export const galleryRoutes = new Hono<AppEnv>();

/** Authenticate unless an earlier router (the workspace routes) already did. */
const signedIn: MiddlewareHandler<AppEnv> = async (c, next) => (c.get("principal") ? next() : authenticate()(c, next));
const moderator = (c: C): gallery.Moderator => ({ userId: c.get("user").userId, email: c.get("user").email ?? null, viaSso: cameThroughSso(c.get("user")) });
const moderators = (c: C) => c.env.GALLERY_MODERATORS ?? null;
const submissionId = (c: C) => bareUuid(c.req.param("id"), "Submission");

// ---- moderation (registered before /gallery/:slug) ----
galleryRoutes.get("/gallery/moderation/me", requireUser(), (c) => c.json(ok({ moderator: gallery.isModerator(moderators(c), moderator(c)) })));
galleryRoutes.get("/gallery/moderation/queue", requireUser(), async (c) => {
  const items = await gallery.moderationQueue(userSvc(c), moderators(c), moderator(c));
  return c.json(paginated(items, pageInfo(1, Math.max(items.length, 1), items.length)));
});
galleryRoutes.post("/gallery/moderation/submissions/:id/approve", requireUser(), async (c) => c.json(ok(await gallery.approveSubmission(userSvc(c), moderators(c), moderator(c), submissionId(c), parse(gallery.approveInput, await jsonBody(c))))));
galleryRoutes.post("/gallery/moderation/submissions/:id/reject", requireUser(), async (c) => c.json(ok(await gallery.rejectSubmission(userSvc(c), moderators(c), moderator(c), submissionId(c), parse(gallery.rejectInput, await jsonBody(c))))));

// ---- public reads ----
galleryRoutes.get("/gallery", async (c) => {
  const p = page(c);
  const filter = parse(gallery.listQuery, { kind: c.req.query("kind"), tag: c.req.query("tag"), q: c.req.query("q") });
  const { items, total, tags } = await gallery.listGallery(publicCtx(c), filter, p);
  c.header("Cache-Control", "public, max-age=60");
  return c.json({ ...paginated(items, pageInfo(p.page, p.pageSize, total)), tags });
});
galleryRoutes.get("/gallery/:slug", async (c) => {
  c.header("Cache-Control", "public, max-age=60");
  return c.json(ok(await gallery.getGalleryItem(publicCtx(c), c.req.param("slug"))));
});

// ---- a funder workspace ----
galleryRoutes.use("/workspaces/:workspaceId/gallery/*", signedIn);
galleryRoutes.post("/workspaces/:workspaceId/gallery/items/:slug/copy", async (c) => c.json(created(await gallery.copyGalleryItem(await svc(c), c.req.param("slug"))), 201));
galleryRoutes.post("/workspaces/:workspaceId/gallery/preview", async (c) => c.json(ok(await gallery.previewSubmission(await svc(c), parse(gallery.previewInput, await jsonBody(c))))));
galleryRoutes.get("/workspaces/:workspaceId/gallery/submissions", async (c) => {
  const items = await gallery.listSubmissions(await svc(c));
  return c.json(paginated(items, pageInfo(1, Math.max(items.length, 1), items.length)));
});
galleryRoutes.post("/workspaces/:workspaceId/gallery/submissions", async (c) => c.json(created(await gallery.submitToGallery(await svc(c), parse(gallery.submissionInput, await jsonBody(c)))), 201));
galleryRoutes.post("/workspaces/:workspaceId/gallery/submissions/:id/withdraw", async (c) => c.json(ok(await gallery.withdrawSubmission(await svc(c), submissionId(c)))));
