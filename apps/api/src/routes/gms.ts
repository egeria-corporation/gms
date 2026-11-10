// SPDX-License-Identifier: AGPL-3.0-only
// /gms routes. Handlers build a ServiceContext and call the service layer (src/services); the
// routes for later phases answer 501 in the CommonGrants error shape. See docs/api-surface.md.
import { Hono } from "hono";
import type { AppEnv } from "../app.ts";
import { authenticate, requireRole, requireUser } from "../auth/middleware.ts";
import { LEDGER_ROLES } from "../auth/scopes.ts";
import { ApiError, notImplemented, ok, pageInfo, paginated, parsePagination } from "../lib/errors.ts";
import { listMyWorkspaces } from "../services/workspaces.ts";
import { applicationRoutes } from "./gms/applications.ts";
import { approvalRoutes } from "./gms/approvals.ts";
import { designRoutes } from "./gms/design.ts";
import { userSvc } from "./http.ts";
import { workspaceRoutes } from "./gms/workspaces.ts";
import { publicPages } from "./public.ts";

export const gms = new Hono<AppEnv>();

/** The signed-in person and the workspaces they can open (workspace switcher, routing by handle). */
gms.get("/me", requireUser(), async (c) => {
  const user = c.get("user");
  const mine = await listMyWorkspaces(userSvc(c));
  return c.json(
    ok({
      userId: user.userId,
      email: user.email,
      mfaVerified: user.aal === "aal2",
      workspaces: mine.map((w) => ({ id: w.id, handle: w.handle, name: w.displayName, displayName: w.displayName, kind: w.kind, role: w.role, brand: w.brand, requiresMfa: w.requiresMfa, passportOrgId: w.passportOrgId, verificationLevel: w.verificationLevel })),
    }),
  );
});

/** What this caller is, in this workspace: the same answer for a person, an API client and an agent. */
gms.get("/whoami", authenticate(), (c) => {
  const p = c.get("principal");
  return c.json(ok({ kind: p.kind, userId: p.userId, clientId: p.clientId, workspaceId: p.workspaceId, role: p.role, scopes: p.scopes }));
});

/** Workspace-visible audit ledger: admins and auditors; API clients need `workspace:admin`. */
gms.get("/ledger", requireRole(LEDGER_ROLES, "workspace:admin"), async (c) => {
  const p = c.get("principal");
  const { page, pageSize, offset } = parsePagination({ page: c.req.query("page"), pageSize: c.req.query("pageSize") });
  const iso = (k: "from" | "to") => {
    const v = c.req.query(k);
    if (v === undefined) return undefined;
    if (Number.isNaN(Date.parse(v))) throw new ApiError(400, "bad_request", `${k} must be an ISO 8601 timestamp`, [{ code: "invalid_parameter", field: k }]);
    return new Date(v).toISOString();
  };
  // The workspace always comes from the principal, never from the query string.
  const query = { workspaceId: p.workspaceId, subjectType: c.req.query("subjectType"), subjectId: c.req.query("subjectId"), eventType: c.req.query("eventType"), from: iso("from"), to: iso("to") };
  const { ledger } = c.get("deps");
  const [items, total] = await Promise.all([ledger.list({ ...query, limit: pageSize, offset }), ledger.count(query)]);
  return c.json(paginated(items, pageInfo(page, pageSize, total)));
});

// Published data for the funder pages: no token.
gms.route("/public", publicPages);
gms.route("/", workspaceRoutes);
gms.route("/", designRoutes);
gms.route("/", applicationRoutes);
gms.route("/", approvalRoutes);

gms.all("*", (c) => {
  throw notImplemented(`${c.req.method} ${new URL(c.req.url).pathname}`);
});
