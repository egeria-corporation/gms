// SPDX-License-Identifier: AGPL-3.0-only
// Dynamic client registration (RFC 7591) for MCP clients. Registered clients are public: no secret,
// PKCE S256 required, authorization_code + refresh_token only. Redirects must be loopback or on the
// host allow-list. Responses use the RFC 7591 shapes.
import { Hono } from "hono";
import type { AppEnv } from "../app.ts";
import { DYNAMIC_CLIENT_SCOPES, parseScopeString } from "../auth/scopes.ts";
import type { Env } from "../env.ts";

/** Hosts of well-known MCP clients. Self-hosters extend this with OAUTH_DCR_REDIRECT_HOSTS. */
export const KNOWN_REDIRECT_HOSTS = ["claude.ai", "claude.com"] as const;
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);
const MAX_REDIRECTS = 10;

export { DYNAMIC_CLIENT_SCOPES };

export function redirectAllowed(uri: string, env: Pick<Env, "OAUTH_DCR_REDIRECT_HOSTS">): boolean {
  let u: URL;
  try {
    u = new URL(uri);
  } catch {
    return false;
  }
  if (u.hash || u.username || u.password) return false;
  if (LOOPBACK.has(u.hostname)) return u.protocol === "http:" || u.protocol === "https:";
  if (u.protocol !== "https:") return false;
  const extra = (env.OAUTH_DCR_REDIRECT_HOSTS ?? "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);
  return [...KNOWN_REDIRECT_HOSTS, ...extra].includes(u.hostname.toLowerCase());
}

const invalid = (error: "invalid_redirect_uri" | "invalid_client_metadata", description: string) => ({ error, error_description: description });

export const register = new Hono<AppEnv>();

register.post("/register", async (c) => {
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return c.json(invalid("invalid_client_metadata", "Body must be a JSON object"), 400);

  const uris = body.redirect_uris;
  if (!Array.isArray(uris) || uris.length === 0 || uris.length > MAX_REDIRECTS || uris.some((u) => typeof u !== "string")) {
    return c.json(invalid("invalid_redirect_uri", `redirect_uris must list 1 to ${MAX_REDIRECTS} URIs`), 400);
  }
  const rejected = (uris as string[]).filter((u) => !redirectAllowed(u, c.env));
  if (rejected.length) return c.json(invalid("invalid_redirect_uri", "Redirect URIs must be loopback (localhost) or on a host this server allows"), 400);

  const method = body.token_endpoint_auth_method ?? "none";
  if (method !== "none") return c.json(invalid("invalid_client_metadata", "Only public clients can register: token_endpoint_auth_method must be none"), 400);
  const grants = (body.grant_types as unknown[] | undefined) ?? ["authorization_code", "refresh_token"];
  if (!Array.isArray(grants) || grants.some((g) => g !== "authorization_code" && g !== "refresh_token") || !grants.includes("authorization_code")) {
    return c.json(invalid("invalid_client_metadata", "grant_types may contain authorization_code and refresh_token"), 400);
  }
  const responses = (body.response_types as unknown[] | undefined) ?? ["code"];
  if (!Array.isArray(responses) || responses.length !== 1 || responses[0] !== "code") return c.json(invalid("invalid_client_metadata", "response_types must be [code]"), 400);

  const rawName = typeof body.client_name === "string" ? body.client_name : "";
  // Shown on the consent screen: printable characters only, bounded.
  const name = rawName.replace(/[^\P{C}]/gu, "").trim().slice(0, 80) || "Unnamed MCP client";
  const asked = parseScopeString(typeof body.scope === "string" ? body.scope : null);
  const allowedScopes = asked.length ? asked.filter((s) => DYNAMIC_CLIENT_SCOPES.includes(s)) : DYNAMIC_CLIENT_SCOPES;

  const id = crypto.randomUUID();
  const issuedAt = c.get("deps").now();
  await c.get("deps").auth.createDynamicClient({
    id,
    name,
    workspaceId: null,
    clientSecretHash: null,
    allowedScopes,
    grantTypes: ["authorization_code"],
    redirectUris: uris as string[],
    gatedTools: null,
    dynamic: true,
    revokedAt: null,
  });
  c.header("Cache-Control", "no-store");
  return c.json(
    {
      client_id: id,
      client_id_issued_at: Math.floor(issuedAt.getTime() / 1000),
      client_name: name,
      redirect_uris: uris,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: allowedScopes.join(" "),
    },
    201,
  );
});
