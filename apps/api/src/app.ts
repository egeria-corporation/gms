// SPDX-License-Identifier: AGPL-3.0-only
// The GMS API Worker: /common-grants/*, /gms/*, /oauth/*, /.well-known/*, /mcp, /webhooks/*.
// `createApp` takes a dependency factory so tests run the real routes over in-memory stores.
import type { LedgerStore } from "@gms/ledger";
import type { FetchLike } from "@gms/passport-client";
import type { WebhookStore } from "@gms/webhooks";
import { Hono } from "hono";
import type { JWTVerifyGetKey } from "jose";
import type { Principal } from "./auth/middleware.ts";
import type { SessionUser } from "./auth/session.ts";
import type { AuthStore, MembershipStore } from "./auth/stores.ts";
import { trimSlash, type Env } from "./env.ts";
import { ApiError, errorResponse, notFound, notImplemented } from "./lib/errors.ts";
import { log, loggablePath } from "./lib/log.ts";
import { agentdocs } from "./routes/agentdocs.ts";
import { cgApplications } from "./routes/apply.ts";
import { cgAwards } from "./routes/awards.ts";
import { authorize } from "./routes/authorize.ts";
import { gms } from "./routes/gms.ts";
import { mcp } from "./routes/mcp.ts";
import { OAuthError, oauth, oauthErrorResponse } from "./routes/oauth.ts";
import { cgOrgs } from "./routes/orgs.ts";
import { inboundWebhooks } from "./routes/webhooks.ts";
import { commonGrants, sitemap } from "./routes/public.ts";
import { register } from "./routes/register.ts";
import { wellknown } from "./routes/wellknown.ts";
import type { KvPort } from "@gms/mcp";
import type { ServicePorts } from "./services/context.ts";
import type { Repos } from "./services/repos/types.ts";

export interface Deps {
  auth: AuthStore;
  members: MembershipStore;
  ledger: LedgerStore;
  /** The service layer's data access; the only way routes reach tables beyond the auth stores. */
  repos: Repos;
  webhooks: WebhookStore;
  now: () => Date;
  /** Overrides the Supabase project's published session keys (tests). */
  sessionKeys?: JWTVerifyGetKey;
  /** Recorded Passport responses in tests; the platform fetch otherwise. */
  passportFetch?: FetchLike;
  /** Mail, file storage and the OpenGrants discovery client; absent ports degrade (no mail sent, no upload). */
  ports?: (env: Env) => ServicePorts;
  /** Rate-limit counters for MCP tokens (Workers KV in production). */
  kv?: (env: Env) => KvPort;
  /** The compiled OpenAPI document (a static asset of the Worker); null when it has not been built. */
  openapi?: (env: Env) => Promise<unknown | null>;
}

export type AppEnv = {
  Bindings: Env;
  Variables: { deps: Deps; principal: Principal; user: SessionUser; requestId: string };
};

/** Null when the Worker has no database configured: routes that need one answer 503. */
export type DepsFactory = (env: Env) => Deps | null;

const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
};

const CORS_HEADERS = "Authorization, Content-Type, Idempotency-Key, X-GMS-Workspace, Mcp-Session-Id, Mcp-Protocol-Version";

export function createApp(makeDeps: DepsFactory) {
  const app = new Hono<AppEnv>();

  // Request log (method, path, status, duration; never bodies, never query values) + security headers.
  app.use("*", async (c, next) => {
    const started = Date.now();
    const requestId = c.req.header("CF-Ray") ?? crypto.randomUUID();
    c.set("requestId", requestId);
    await next();
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) c.res.headers.set(k, v);
    c.res.headers.set("X-Request-Id", requestId);
    // 501 is a route that does not exist yet, not a fault: it is not logged as an error.
    log(c.res.status >= 500 && c.res.status !== 501 ? "error" : "info", "request", { requestId, method: c.req.method, path: loggablePath(c.req.url), status: c.res.status, ms: Date.now() - started });
  });

  // CORS. Public discovery and protocol reads are open to any origin; everything that carries a
  // bearer is limited to the web app's origin (browser-based MCP clients use the token endpoint and
  // /mcp cross-origin with a bearer, never cookies, so `*` is safe there).
  app.use("*", async (c, next) => {
    const origin = c.req.header("Origin");
    const path = new URL(c.req.url).pathname;
    const open = path.startsWith("/.well-known/") || path.startsWith("/gms/public/") || path === "/sitemap.xml" || path.startsWith("/oauth/token") || path.startsWith("/oauth/register") || path.startsWith("/mcp") || path.startsWith("/common-grants/") || path === "/llms.txt" || path === "/llms-full.txt" || path === "/openapi.json";
    const allow = open ? "*" : origin && c.env.WEB_BASE_URL && origin === trimSlash(c.env.WEB_BASE_URL) ? origin : null;
    if (c.req.method === "OPTIONS") {
      const res = new Response(null, { status: 204 });
      if (allow) {
        res.headers.set("Access-Control-Allow-Origin", allow);
        res.headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
        res.headers.set("Access-Control-Allow-Headers", CORS_HEADERS);
        res.headers.set("Access-Control-Max-Age", "600");
        res.headers.set("Vary", "Origin");
      }
      return res;
    }
    await next();
    if (allow) {
      c.res.headers.set("Access-Control-Allow-Origin", allow);
      c.res.headers.set("Access-Control-Expose-Headers", "WWW-Authenticate, Mcp-Session-Id, X-Request-Id");
      c.res.headers.append("Vary", "Origin");
    }
  });

  app.get("/health", (c) => c.json({ status: "ok", service: "gms-api", database: makeDeps(c.env) ? "configured" : "not_configured" }));

  // Discovery and agent docs need keys and config only, never the database.
  app.route("/.well-known", wellknown);
  app.route("/", agentdocs);

  app.use("*", async (c, next) => {
    const deps = makeDeps(c.env);
    if (!deps) throw new ApiError(503, "database_unavailable", "Database is not configured");
    c.set("deps", deps);
    await next();
  });

  app.route("/oauth", oauth);
  app.route("/oauth", authorize);
  app.route("/oauth", register);
  app.route("/gms", gms);

  // Protocol reads that are implemented; every other protocol route answers 501 until its phase lands.
  app.route("/common-grants", commonGrants);
  app.route("/common-grants", cgApplications);
  app.route("/common-grants", cgAwards);
  app.route("/common-grants", cgOrgs);
  app.get("/sitemap.xml", sitemap);
  app.get("/openapi.json", async (c) => {
    const doc = await c.get("deps").openapi?.(c.env);
    if (!doc) throw new ApiError(503, "openapi_unavailable", "The OpenAPI document has not been built for this deployment");
    c.header("Cache-Control", "public, max-age=300");
    return c.json(doc as Record<string, unknown>);
  });

  // Seams for later phases. Each answers 501 in the CommonGrants error shape.
  const placeholder = (what: string) => {
    const r = new Hono<AppEnv>();
    r.all("*", (c) => {
      throw notImplemented(`${what} (${c.req.method} ${new URL(c.req.url).pathname})`);
    });
    return r;
  };
  app.route("/common-grants", placeholder("This CommonGrants protocol route"));
  app.route("/mcp", mcp);
  app.route("/webhooks", inboundWebhooks);

  app.notFound(() => {
    throw notFound("Route");
  });

  app.onError((err, c) => {
    if (err instanceof OAuthError) return oauthErrorResponse(c, err);
    if (err instanceof ApiError) return errorResponse(c, err);
    log("error", "unhandled", { requestId: c.get("requestId"), name: err.name, message: err.message });
    return errorResponse(c, new ApiError(500, "internal_error", "Something went wrong on our side"));
  });

  return app;
}
