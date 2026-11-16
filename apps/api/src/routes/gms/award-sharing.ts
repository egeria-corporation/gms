// SPDX-License-Identifier: AGPL-3.0-only
// /gms routes for award sharing (v1.9.0): the "Share this award" panel for the funder and the
// grantee, the funder's confidential switch, the grantee's "Don't list us publicly", and the
// funder's listing settings and program defaults. Every change is a signed-in person's: agent and
// API-client tokens are refused (403 human_only), and no MCP tool makes them.
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
for (const path of ["/awards/:id/sharing", "/awards/:id/confidential", "/my/awards/:id/sharing", "/my/awards/:id/listing", "/award-sharing/settings", "/programs/:id/award-sharing"]) awardSharingRoutes.use(path, signedIn);

// The funder's side.
awardSharingRoutes.get("/awards/:id/sharing", async (c) => c.json(ok(await sharing.awardSharing(await svc(c), awardId(c), "funder"))));
awardSharingRoutes.put("/awards/:id/confidential", async (c) => c.json(ok(await sharing.setAwardConfidential(await svc(c), awardId(c), parse(sharing.confidentialInput, await jsonBody(c))))));
awardSharingRoutes.get("/award-sharing/settings", async (c) => c.json(ok(await sharing.getListingSettings(await svc(c)))));
awardSharingRoutes.put("/award-sharing/settings", async (c) => c.json(ok(await sharing.updateListingSettings(await svc(c), parse(sharing.listingSettingsInput, await jsonBody(c))))));
awardSharingRoutes.put("/programs/:id/award-sharing", async (c) => c.json(ok(await sharing.setProgramConfidentialDefault(await svc(c), bareUuid(c.req.param("id"), "Program"), parse(sharing.programDefaultInput, await jsonBody(c))))));

// The grantee's side.
awardSharingRoutes.get("/my/awards/:id/sharing", async (c) => c.json(ok(await sharing.awardSharing(await svc(c), awardId(c), "grantee"))));
awardSharingRoutes.put("/my/awards/:id/listing", async (c) => c.json(ok(await sharing.setRecipientUnlisted(await svc(c), awardId(c), parse(sharing.unlistedInput, await jsonBody(c))))));
