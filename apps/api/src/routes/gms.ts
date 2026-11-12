// SPDX-License-Identifier: AGPL-3.0-only
// /gms routes. Handlers build a ServiceContext and call the service layer (src/services); the
// routes for later phases answer 501 in the CommonGrants error shape. See docs/api-surface.md.
import { Hono } from "hono";
import type { AppEnv } from "../app.ts";
import { authenticate, requireRole, requireUser } from "../auth/middleware.ts";
import { secondStepVerified } from "../auth/second-step.ts";
import { LEDGER_ROLES } from "../auth/scopes.ts";
import { ApiError, notImplemented, ok, pageInfo, paginated, parsePagination } from "../lib/errors.ts";
import { bareUuid } from "../lib/ids.ts";
import { confirmPassportLink } from "../services/passport-signin.ts";
import * as sessions from "../services/sessions.ts";
import { listMyWorkspaces } from "../services/workspaces.ts";
import { applicationRoutes } from "./gms/applications.ts";
import { approvalRoutes } from "./gms/approvals.ts";
import { assistRoutes } from "./gms/assist.ts";
import { designRoutes } from "./gms/design.ts";
import { adminRoutes } from "./gms/admin.ts";
import { grantRoutes } from "./gms/grants.ts";
import { insightRoutes } from "./gms/insights.ts";
import { moneyRoutes } from "./gms/money.ts";
import { config, userSvc } from "./http.ts";
import { workspaceRoutes } from "./gms/workspaces.ts";
import { publicPages } from "./public.ts";

export const gms = new Hono<AppEnv>();

/** What this server has switched on. No token: the web app reads it before sign-in to decide which controls to show. */
const features = (c: Parameters<typeof config>[0]) => {
  const cfg = config(c);
  const ports = c.get("deps").ports?.(c.env) ?? {};
  return {
    facilitatedPayments: !!cfg.facilitatedPayments,
    assistantEnabled: !!cfg.assistantEnabled,
    // Which optional connections this server can actually make, so the app offers a control only
    // where it can work. Each is true only when what it needs (a key, a port) is present.
    available: {
      openGrants: !!ports.openGrants && !!c.env.OPENGRANTS_API_KEY,
      assistant: !!cfg.assistantEnabled && !!ports.llm,
      googleWorkspace: !!ports.workspaceApps,
      mercury: !!ports.bank && !!cfg.credentialsKey,
      customMcp: !!ports.mcpDirectory && !!cfg.credentialsKey,
    },
  };
};

/** What to call someone on screen: the name on their account, else the part of their address before the @. */
export function displayNameOf(name: string | null | undefined, email: string | null): string | null {
  if (name?.trim()) return name.trim();
  const local = email?.split("@")[0]?.replace(/[._+-]+/g, " ").trim();
  return local ? local.replace(/\b\p{L}/gu, (ch) => ch.toUpperCase()) : null;
}
gms.get("/config", (c) => c.json(ok(features(c))));

/** The signed-in person and the workspaces they can open (workspace switcher, routing by handle). */
gms.get("/me", requireUser(), async (c) => {
  const user = c.get("user");
  const mfaVerified = await secondStepVerified(c, user);
  // A session that has passed this account's own second step may have a first Passport sign-in
  // waiting on it: the link is recorded here, once. Never for a session verified by Passport.
  if (user.aal === "aal2") await confirmPassportLink(userSvc(c), user.sessionId ?? null, user.email).catch(() => false);
  const mine = await listMyWorkspaces(userSvc(c));
  return c.json(
    ok({
      userId: user.userId,
      email: user.email,
      displayName: displayNameOf(user.name, user.email),
      // A session that holds Passport's second step was started at Passport; any other by emailed code.
      signInMethod: user.passportStep ? "passport" : "email",
      mfaVerified,
      features: features(c),
      workspaces: mine.map((w) => ({ id: w.id, handle: w.handle, name: w.displayName, displayName: w.displayName, kind: w.kind, role: w.role, brand: w.brand, requiresMfa: w.requiresMfa, passportOrgId: w.passportOrgId, verificationLevel: w.verificationLevel })),
    }),
  );
});

/** The signed-in person's own sessions. No workspace: a session belongs to the person. */
gms.get("/me/sessions", requireUser(), async (c) => c.json(ok(await sessions.listMySessions(userSvc(c), c.get("user").sessionId ?? null))));
gms.delete("/me/sessions/:id", requireUser(), async (c) => c.json(ok(await sessions.endMySession(userSvc(c), bareUuid(c.req.param("id"), "Session"), c.get("user").sessionId ?? null))));

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
// Registered first: its paths are more specific than the routers below (`/templates/usage` before `/templates/:id`).
gms.route("/", insightRoutes);
gms.route("/", workspaceRoutes);
gms.route("/", designRoutes);
gms.route("/", applicationRoutes);
gms.route("/", approvalRoutes);
gms.route("/", grantRoutes);
gms.route("/", moneyRoutes);
gms.route("/", adminRoutes);
gms.route("/", assistRoutes);

gms.all("*", (c) => {
  throw notImplemented(`${c.req.method} ${new URL(c.req.url).pathname}`);
});
