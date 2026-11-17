// SPDX-License-Identifier: AGPL-3.0-only
// /gms routes for award sharing (v1.9.0): the "Share this award" panel for the funder and the
// grantee, the funder's confidential switch, the grantee's "Don't list us publicly", and the
// funder's listing settings and program defaults. Every change is a signed-in person's: agent and
// API-client tokens are refused (403 human_only), and no MCP tool makes them.
// v1.12.0: the federal share on an award, the carousel PDF, and each workspace's share-kit settings
// (its social page, consent to be tagged, and a funder's credit wording and description).
// v1.13.0: a use of the kit (the press release copied, the portrait card saved), counted only.
import { Hono, type Context, type MiddlewareHandler } from "hono";
import type { AppEnv } from "../../app.ts";
import { authenticate } from "../../auth/middleware.ts";
import { ok } from "../../lib/errors.ts";
import { bareUuid, uuidOf } from "../../lib/ids.ts";
import { parse } from "../../lib/input.ts";
import * as sharing from "../../services/award-sharing.ts";
import { jsonBody, svc } from "../http.ts";

export const awardSharingRoutes = new Hono<AppEnv>();

type C = Context<AppEnv>;
const awardId = (c: C) => uuidOf("award", c.req.param("id"), "Award");

/** Authenticates unless an earlier router on the same path already did. */
const signedIn: MiddlewareHandler<AppEnv> = async (c, next) => (c.get("principal") ? next() : authenticate()(c, next));
for (const path of ["/awards/:id/sharing", "/awards/:id/confidential", "/my/awards/:id/sharing", "/my/awards/:id/listing", "/award-sharing/settings", "/programs/:id/award-sharing", "/awards/:id/federal-funding", "/awards/:id/sharing/carousel.pdf", "/my/awards/:id/sharing/carousel.pdf", "/share-kit/profile", "/awards/:id/sharing/uses", "/my/awards/:id/sharing/uses"]) awardSharingRoutes.use(path, signedIn);

/** The carousel PDF: kept by nobody along the way, saved by the person under its name. */
const carousel = (out: { bytes: Uint8Array; fileName: string }) =>
  new Response(out.bytes as Uint8Array<ArrayBuffer>, { status: 200, headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${out.fileName}"`, "Content-Length": String(out.bytes.byteLength), "Cache-Control": "private, no-store" } });

// The funder's side.
awardSharingRoutes.get("/awards/:id/sharing", async (c) => c.json(ok(await sharing.awardSharing(await svc(c), awardId(c), "funder"))));
awardSharingRoutes.put("/awards/:id/confidential", async (c) => c.json(ok(await sharing.setAwardConfidential(await svc(c), awardId(c), parse(sharing.confidentialInput, await jsonBody(c))))));
awardSharingRoutes.get("/award-sharing/settings", async (c) => c.json(ok(await sharing.getListingSettings(await svc(c)))));
awardSharingRoutes.put("/award-sharing/settings", async (c) => c.json(ok(await sharing.updateListingSettings(await svc(c), parse(sharing.listingSettingsInput, await jsonBody(c))))));
awardSharingRoutes.put("/awards/:id/federal-funding", async (c) => c.json(ok(await sharing.setFederalFunding(await svc(c), awardId(c), parse(sharing.federalInput, await jsonBody(c))))));
awardSharingRoutes.get("/awards/:id/sharing/carousel.pdf", async (c) => carousel(await sharing.carouselPdf(await svc(c), awardId(c), "funder")));
awardSharingRoutes.post("/awards/:id/sharing/uses", async (c) => c.json(ok(await sharing.recordKitUse(await svc(c), awardId(c), "funder", parse(sharing.kitUseInput, await jsonBody(c))))));
awardSharingRoutes.put("/programs/:id/award-sharing", async (c) => c.json(ok(await sharing.setProgramConfidentialDefault(await svc(c), bareUuid(c.req.param("id"), "Program"), parse(sharing.programDefaultInput, await jsonBody(c))))));

// The grantee's side.
awardSharingRoutes.get("/my/awards/:id/sharing", async (c) => c.json(ok(await sharing.awardSharing(await svc(c), awardId(c), "grantee"))));
awardSharingRoutes.put("/my/awards/:id/listing", async (c) => c.json(ok(await sharing.setRecipientUnlisted(await svc(c), awardId(c), parse(sharing.unlistedInput, await jsonBody(c))))));
awardSharingRoutes.get("/my/awards/:id/sharing/carousel.pdf", async (c) => carousel(await sharing.carouselPdf(await svc(c), awardId(c), "grantee")));
awardSharingRoutes.post("/my/awards/:id/sharing/uses", async (c) => c.json(ok(await sharing.recordKitUse(await svc(c), awardId(c), "grantee", parse(sharing.kitUseInput, await jsonBody(c))))));

// Either side: the workspace's own share-kit settings.
awardSharingRoutes.get("/share-kit/profile", async (c) => c.json(ok(await sharing.getShareProfile(await svc(c)))));
awardSharingRoutes.put("/share-kit/profile", async (c) => c.json(ok(await sharing.updateShareProfile(await svc(c), parse(sharing.shareProfileInput, await jsonBody(c))))));
