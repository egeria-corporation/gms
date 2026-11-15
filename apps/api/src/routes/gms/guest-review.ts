// SPDX-License-Identifier: AGPL-3.0-only
// /gms routes for the guest reviewer loop (C4): the welcome after accepting an invitation to
// review, the done screen after the last review, and the offer's events. A person only, an
// external reviewer of the funder workspace named in X-GMS-Workspace; no MCP tool.
import { Hono } from "hono";
import type { AppEnv } from "../../app.ts";
import { authenticate } from "../../auth/middleware.ts";
import { ok } from "../../lib/errors.ts";
import { parse } from "../../lib/input.ts";
import * as guest from "../../services/guest-reviewer.ts";
import { jsonBody, svc } from "../http.ts";

export const guestReviewRoutes = new Hono<AppEnv>();
guestReviewRoutes.use("/guest-review/*", authenticate());

guestReviewRoutes.get("/guest-review/welcome", async (c) => c.json(ok(await guest.guestWelcome(await svc(c)))));
guestReviewRoutes.get("/guest-review/done", async (c) => c.json(ok(await guest.guestDone(await svc(c)))));
guestReviewRoutes.post("/guest-review/offer", async (c) => c.json(ok(await guest.recordOfferEvent(await svc(c), parse(guest.offerEventInput, await jsonBody(c))))));
