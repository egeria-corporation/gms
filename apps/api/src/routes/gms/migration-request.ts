// SPDX-License-Identifier: AGPL-3.0-only
// /gms routes for "Request a free migration" on the switch pages. No token is needed: anonymous
// visitors may send. A person's own session is accepted (and must be valid); an API client's or an
// agent's token is refused on every route here, and there is no MCP tool, so only a person in a
// browser can send one. Each handler parses input and calls one service function.
import { MemoryKv, type KvPort } from "@gms/mcp";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import type { AppEnv } from "../../app.ts";
import { personSession } from "../../auth/middleware.ts";
import { isSessionToken } from "../../auth/session.ts";
import { forbidden } from "../../auth/verify.ts";
import { ok } from "../../lib/errors.ts";
import { requestLocale } from "../../lib/locale.ts";
import { parse } from "../../lib/input.ts";
import { addressKey } from "../../lib/rate-limit.ts";
import * as migration from "../../services/migration-request.ts";
import { config, jsonBody } from "../http.ts";

type C = Context<AppEnv>;
export const migrationRequestRoutes = new Hono<AppEnv>();

/** Nobody, or a signed-in person: never an API or agent token. */
const peopleOnly = (): MiddlewareHandler<AppEnv> => async (c, next) => {
  const m = /^Bearer\s+(\S+)$/i.exec(c.req.header("Authorization") ?? "");
  if (c.req.header("Authorization") !== undefined && !m) throw forbidden("person_only", "A person sends a migration request from the switch page. API and agent tokens cannot");
  if (m) {
    if (!isSessionToken(m[1]!, c.env.SUPABASE_URL)) throw forbidden("person_only", "A person sends a migration request from the switch page. API and agent tokens cannot");
    // A session that does not verify, or a single sign-on session for an address its provider was
    // not registered for, is refused like anywhere else (401, 403 sso_domain_mismatch).
    await personSession(c, m[1]!);
  }
  c.header("Cache-Control", "no-store");
  await next();
};
migrationRequestRoutes.use("/migration-requests", peopleOnly());
migrationRequestRoutes.use("/migration-requests/*", peopleOnly());

const fallbackKv = new MemoryKv();
function ctxOf(c: C): migration.MigrationRequestContext {
  const deps = c.get("deps");
  const cfg = config(c);
  return {
    now: deps.now,
    kv: (deps.kv?.(c.env) ?? fallbackKv) as KvPort,
    mailer: deps.ports?.(c.env).mailer ?? null,
    mailFrom: cfg.mailFrom,
    requestTo: cfg.consultingRequestTo ?? null,
    webBaseUrl: cfg.webBaseUrl,
    formKey: () => migration.formKeyFrom(c.env.OAUTH_SIGNING_KEY_JWK),
    locale: requestLocale({ url: c.req.url, header: (n) => c.req.header(n) }),
  };
}

migrationRequestRoutes.get("/migration-requests/form", async (c) => c.json(ok(await migration.issueFormToken(ctxOf(c)))));
migrationRequestRoutes.post("/migration-requests/preview", async (c) => c.json(ok(migration.previewMigrationRequest(ctxOf(c), parse(migration.migrationRequestInput, await jsonBody(c))))));
migrationRequestRoutes.post("/migration-requests", async (c) => {
  const input = parse(migration.migrationRequestInput, await jsonBody(c));
  return c.json(ok(await migration.sendMigrationRequest(ctxOf(c), input, addressKey((name) => c.req.header(name), c.env.TRUSTED_PROXY === "true"))));
});
