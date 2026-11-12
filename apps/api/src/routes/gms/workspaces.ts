// SPDX-License-Identifier: AGPL-3.0-only
// /gms/workspaces and team routes. Each handler parses input, builds the ServiceContext and calls
// one service function; authorization lives in the service.
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../../app.ts";
import { authenticate, requireUser } from "../../auth/middleware.ts";
import { MemoryKv } from "@gms/mcp";
import { ApiError, created, ok, pageInfo, paginated } from "../../lib/errors.ts";
import { clientAddress, WORKSPACE_CREATION_LIMITS, windowCounters } from "../../lib/rate-limit.ts";
import { bareUuid } from "../../lib/ids.ts";
import { parse } from "../../lib/input.ts";
import * as passport from "../../services/passport-link.ts";
import * as profile from "../../services/profile.ts";
import * as workspaces from "../../services/workspaces.ts";
import { jsonBody, svc, userSvc } from "../http.ts";

export const workspaceRoutes = new Hono<AppEnv>();
const ws = (c: { req: { param(name: string): string | undefined } }) => bareUuid(c.req.param("workspaceId"), "Workspace");

workspaceRoutes.get("/workspaces", requireUser(), async (c) => c.json(ok(await workspaces.listMyWorkspaces(userSvc(c)))));
const fallbackKv = new MemoryKv();
/**
 * Creating a workspace is capped per person and per network address per day
 * (WORKSPACE_CREATION_LIMITS). Only creations that succeed are counted, so a taken handle
 * does not use up the day.
 */
workspaceRoutes.post("/workspaces", requireUser(), async (c) => {
  const input = parse(workspaces.createWorkspaceInput, await jsonBody(c));
  const deps = c.get("deps");
  const address = clientAddress((name) => c.req.header(name));
  const L = WORKSPACE_CREATION_LIMITS;
  const counter = windowCounters(deps.kv?.(c.env) ?? fallbackKv, deps.now().getTime(), L.windowSeconds, [
    { key: `workspace-create:user:${c.get("user").userId}`, limit: L.perUserPerDay },
    ...(address ? [{ key: `workspace-create:addr:${address}`, limit: L.perAddressPerDay }] : []),
  ]);
  if (!(await counter.allowed())) throw new ApiError(429, "too_many_workspaces", "You have created as many workspaces as we allow in one day. Try again tomorrow, or ask an admin of an existing workspace to invite you");
  const out = await workspaces.createWorkspace(userSvc(c), input);
  await counter.hit();
  return c.json(created(out), 201);
});
workspaceRoutes.post("/invitations/accept", requireUser(), async (c) => {
  const { token } = parse(z.object({ token: z.string().min(10).max(200) }).strict(), await jsonBody(c));
  return c.json(ok(await workspaces.acceptInvitation(userSvc(c), token)));
});

workspaceRoutes.use("/workspaces/:workspaceId/*", authenticate());
workspaceRoutes.use("/workspaces/:workspaceId", authenticate());

workspaceRoutes.get("/workspaces/:workspaceId", async (c) => c.json(ok(await workspaces.getWorkspace(await svc(c), ws(c)))));
workspaceRoutes.patch("/workspaces/:workspaceId/profile", async (c) => c.json(ok(await profile.updateProfile(await svc(c), ws(c), parse(profile.profilePatchInput, await jsonBody(c))))));
workspaceRoutes.patch("/workspaces/:workspaceId", async (c) => c.json(ok(await workspaces.updateWorkspace(await svc(c), ws(c), parse(workspaces.updateWorkspaceInput, await jsonBody(c))))));

// A list envelope like every other list: `items` + `paginationInfo` (one page; a workspace's team is small).
workspaceRoutes.get("/workspaces/:workspaceId/members", async (c) => {
  const items = await workspaces.listMembers(await svc(c), ws(c));
  return c.json(paginated(items, pageInfo(1, Math.max(items.length, 1), items.length)));
});
workspaceRoutes.post("/workspaces/:workspaceId/members", async (c) => c.json(created(await workspaces.addMember(await svc(c), ws(c), parse(workspaces.memberInput, await jsonBody(c)))), 201));
workspaceRoutes.patch("/workspaces/:workspaceId/members/:userId", async (c) =>
  c.json(ok(await workspaces.updateMember(await svc(c), ws(c), bareUuid(c.req.param("userId"), "Member"), parse(workspaces.memberPatch, await jsonBody(c))))),
);
// Registered before `/:userId` so "me" is never read as a member id.
workspaceRoutes.delete("/workspaces/:workspaceId/members/me", async (c) => c.json(ok(await workspaces.leaveWorkspace(await svc(c), ws(c)))));
workspaceRoutes.delete("/workspaces/:workspaceId/members/:userId", async (c) => {
  await workspaces.removeMember(await svc(c), ws(c), bareUuid(c.req.param("userId"), "Member"));
  return c.json(ok({ removed: true }));
});
workspaceRoutes.post("/workspaces/:workspaceId/invitations", async (c) => c.json(created(await workspaces.createInvitation(await svc(c), ws(c), parse(workspaces.invitationInput, await jsonBody(c)))), 201));

workspaceRoutes.post("/workspaces/:workspaceId/passport/link", async (c) => c.json(created(await passport.linkPassport(await svc(c), ws(c), parse(passport.linkInput, await jsonBody(c)))), 201));
workspaceRoutes.get("/workspaces/:workspaceId/passport/status", async (c) => c.json(ok(await passport.passportStatus(await svc(c), ws(c)))));
workspaceRoutes.delete("/workspaces/:workspaceId/passport/link", async (c) => c.json(ok(await passport.unlinkPassport(await svc(c), ws(c)))));

// ---- the funder's named contacts (settings.contacts) ----
workspaceRoutes.get("/contacts", authenticate(), async (c) => c.json(ok(await workspaces.getContacts(await svc(c)))));
workspaceRoutes.put("/contacts", authenticate(), async (c) => c.json(ok(await workspaces.putContacts(await svc(c), parse(workspaces.contactsInput, await jsonBody(c))))));
