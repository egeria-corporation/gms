// SPDX-License-Identifier: AGPL-3.0-only
// /gms routes. Handlers build a ServiceContext and call the service layer (src/services); the
// routes for later phases answer 501 in the CommonGrants error shape. See docs/api-surface.md.
import { Hono } from "hono";
import type { AppEnv } from "../app.ts";
import { authenticate, requireRole, requireUser } from "../auth/middleware.ts";
import { forbidden } from "../auth/verify.ts";
import { secondStepVerified } from "../auth/second-step.ts";
import { LEDGER_ROLES } from "../auth/scopes.ts";
import { ApiError, notImplemented, ok, pageInfo, paginated, parsePagination } from "../lib/errors.ts";
import { bareUuid } from "../lib/ids.ts";
import { confirmPassportLink } from "../services/passport-signin.ts";
import * as sessions from "../services/sessions.ts";
import { myLocale, setMyPreferences } from "../services/preferences.ts";
import { fundScopeOf } from "../services/context.ts";
import { listMyWorkspaces } from "../services/workspaces.ts";
import { applicationRoutes } from "./gms/applications.ts";
import { awardSharingRoutes } from "./gms/award-sharing.ts";
import { approvalRoutes } from "./gms/approvals.ts";
import { assistRoutes } from "./gms/assist.ts";
import { fundRoutes } from "./gms/funds.ts";
import { designRoutes } from "./gms/design.ts";
import { digestRoutes } from "./gms/digests.ts";
import { adminRoutes } from "./gms/admin.ts";
import { grantRoutes } from "./gms/grants.ts";
import { importRoutes } from "./gms/imports.ts";
import { importAdapterRoutes } from "./gms/import-adapters.ts";
import { insightRoutes } from "./gms/insights.ts";
import { inviteRoutes } from "./gms/invites.ts";
import { moneyRoutes } from "./gms/money.ts";
import { keepRoutes } from "./gms/keep.ts";
import { openDataRoutes } from "./gms/open-data.ts";
import { outsideRoutes } from "./gms/outside.ts";
import { migrationRequestRoutes } from "./gms/migration-request.ts";
import { reportRoutes } from "./gms/reports.ts";
import { reviewParityRoutes } from "./gms/reviews.ts";
import { galleryRoutes } from "./gallery.ts";
import { socialRoutes } from "./gms/social.ts";
import { sendPackageRoutes } from "./gms/send-package.ts";
import { guestReviewRoutes } from "./gms/guest-review.ts";
import { connectedAppRoutes } from "./gms/connected-apps.ts";
import { config, userSvc } from "./http.ts";
import { workspaceRoutes } from "./gms/workspaces.ts";
import { embedPages } from "./embed.ts";
import { ssoRoutes } from "./gms/sso.ts";
import { publicPages } from "./public.ts";
// Syndication (E2): the public open-call feeds and the "Share this call" panel (docs/syndication.md).
import { feedRoutes } from "./feeds.ts";
import { syndicationRoutes } from "./gms/syndication.ts";

export const gms = new Hono<AppEnv>();

/** What this server has switched on. No token: the web app reads it before sign-in to decide which controls to show. */
const features = (c: Parameters<typeof config>[0]) => {
  const cfg = config(c);
  const ports = c.get("deps").ports?.(c.env) ?? {};
  // Each Passport control is offered only where it can work: a base URL, the GMS's own Passport
  // client and the key that seals its tokens; sign-in also needs the account port, payments the
  // PAYMENTS_FACILITATED switch. Without them the app is used with self-declared profiles.
  const passportReady = !!cfg.passportBaseUrl && !!cfg.passportClient && !!cfg.credentialsKey;
  return {
    passport: { signIn: passportReady && !!ports.identity, linking: passportReady, payments: passportReady && !!cfg.facilitatedPayments },
    facilitatedPayments: !!cfg.facilitatedPayments,
    assistantEnabled: !!cfg.assistantEnabled,
    // Which optional connections this server can actually make, so the app offers a control only
    // where it can work. Each is true only when what it needs (a key, a port) is present.
    available: {
      openGrants: !!ports.openGrants && !!c.env.OPENGRANTS_API_KEY,
      assistant: !!cfg.assistantEnabled && !!ports.llm,
      googleWorkspace: !!ports.workspaceApps,
      // Import sources through Composio (CSV and XLSX are always on).
      googleSheets: !!ports.sheets,
      airtable: !!ports.airtable,
      mercury: !!ports.bank && !!cfg.credentialsKey,
      customMcp: !!ports.mcpDirectory && !!cfg.credentialsKey,
      // Social posting through Zernio: ZERNIO_API_KEY and ZERNIO_WEBHOOK_SECRET.
      social: !!cfg.zernio,
      // Connected apps through Composio (v1.12.0), each only with its own auth config.
      slack: !!ports.slack,
      googleCalendar: !!ports.calendar,
      googleDrive: !!ports.drive,
      salesforce: !!ports.salesforce,
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
  const svc = userSvc(c);
  const [mine, locale] = await Promise.all([listMyWorkspaces(svc), myLocale(svc).catch(() => null)]);
  return c.json(
    ok({
      userId: user.userId,
      email: user.email,
      displayName: displayNameOf(user.name, user.email),
      // The language the person chose (docs/i18n.md); null when they never did.
      locale,
      // A session that holds Passport's second step was started at Passport; any other by emailed code.
      signInMethod: user.passportStep ? "passport" : "email",
      mfaVerified,
      features: features(c),
      workspaces: mine.map((w) => ({ id: w.id, handle: w.handle, name: w.displayName, displayName: w.displayName, kind: w.kind, role: w.role, brand: w.brand, requiresMfa: w.requiresMfa, passportOrgId: w.passportOrgId, verificationLevel: w.verificationLevel, profileSource: w.profileSource, verification: w.verification })),
    }),
  );
});

/** The signed-in person's own preferences (their language). A person only, never an agent or API client. */
gms.put("/me/preferences", requireUser(), async (c) => c.json(ok(await setMyPreferences(userSvc(c), await c.req.json().catch(() => null)))));

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
  // The workspace ledger reads the whole workspace: never a member limited to some funds (a fund
  // advisor reads their funds' activity on each record instead).
  if (fundScopeOf({ kind: "funder", role: p.role, memberScope: p.memberScope })) throw forbidden("fund_scope", "The workspace ledger is for admins and auditors of every fund");
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
// The embeddable apply widget's data, also public.
gms.route("/public", embedPages);
// Open-call feeds and the OpenGrants index feed, also public (docs/syndication.md).
gms.route("/public", feedRoutes);
// Opt-in content digests; their one-click unsubscribe needs no token, so they come before the routers below.
gms.route("/", digestRoutes);
// Registered first: its paths are more specific than the routers below (`/templates/usage` before `/templates/:id`).
gms.route("/", insightRoutes);
gms.route("/", workspaceRoutes);
gms.route("/", inviteRoutes);
gms.route("/", designRoutes);
gms.route("/", applicationRoutes);
gms.route("/", outsideRoutes);
gms.route("/", keepRoutes);
gms.route("/", approvalRoutes);
gms.route("/", grantRoutes);
gms.route("/", reviewParityRoutes);
gms.route("/", moneyRoutes);
gms.route("/", importRoutes);
gms.route("/", importAdapterRoutes);
gms.route("/", adminRoutes);
gms.route("/", assistRoutes);
// The switch pages' free migration request: no token needed, never an API or agent token.
gms.route("/", migrationRequestRoutes);
// Open data exports, and the public 360Giving feed (`/open-data/{handle}/360giving.json`, no token).
gms.route("/", openDataRoutes);
// The report builder (docs/reports.md).
gms.route("/", reportRoutes);
// Single sign-on for funder workspaces (docs/sso.md).
gms.route("/", ssoRoutes);
// The template gallery: public reads, moderation, and a funder workspace's copy and share.
gms.route("/", galleryRoutes);
// Award sharing (v1.9.0): the share panel, confidential and unlisted switches, listing settings.
gms.route("/", awardSharingRoutes);
gms.route("/", socialRoutes);
// Funds (v1.9.0).
gms.route("/", fundRoutes);
// Send to the funder, and the guest reviewer loop (C4).
gms.route("/", sendPackageRoutes);
gms.route("/", guestReviewRoutes);
// Connected apps (v1.12.0): Slack alerts, Google Calendar, Google Drive.
gms.route("/", connectedAppRoutes);
// Share this call: feeds, the OpenGrants index and Philanthropy News Digest (E2).
gms.route("/", syndicationRoutes);

gms.all("*", (c) => {
  throw notImplemented(`${c.req.method} ${new URL(c.req.url).pathname}`);
});
