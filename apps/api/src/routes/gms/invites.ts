// SPDX-License-Identifier: AGPL-3.0-only
// /gms routes for inviting someone into a draft (v1.7.0) and the one-time notes a member can
// dismiss. Each handler parses input, builds the ServiceContext and calls one service function.
import { Hono } from "hono";
import type { AppEnv } from "../../app.ts";
import { authenticate } from "../../auth/middleware.ts";
import { created, ok } from "../../lib/errors.ts";
import { parse } from "../../lib/input.ts";
import * as invites from "../../services/draft-invitations.ts";
import { jsonBody, svc } from "../http.ts";

export const inviteRoutes = new Hono<AppEnv>();
inviteRoutes.use("/draft-invitations", authenticate());
inviteRoutes.use("/me/notes", authenticate());
inviteRoutes.use("/me/notes/*", authenticate());

inviteRoutes.post("/draft-invitations", async (c) => c.json(created(await invites.createDraftInvitation(await svc(c), parse(invites.draftInvitationInput, await jsonBody(c)))), 201));
inviteRoutes.get("/draft-invitations", async (c) => c.json(ok(await invites.listDraftInvitations(await svc(c), parse(invites.draftInvitationQuery, { kind: c.req.query("kind"), id: c.req.query("id") })))));

inviteRoutes.get("/me/notes", async (c) => c.json(ok(await invites.listDismissedNotes(await svc(c)))));
inviteRoutes.post("/me/notes/dismiss", async (c) => c.json(ok(await invites.dismissNote(await svc(c), parse(invites.noteInput, await jsonBody(c))))));
