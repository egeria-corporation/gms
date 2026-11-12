// SPDX-License-Identifier: AGPL-3.0-only
// Discovery documents: JWKS (RFC 7517), authorization server metadata (RFC 8414), protected
// resource metadata (RFC 9728, what an MCP client reads first), and the agent card.
import { Hono } from "hono";
import type { AppEnv } from "../app.ts";
import { DEFAULT_GATED_TOOLS, SCOPES } from "../auth/scopes.ts";
import { trimSlash } from "../env.ts";
import { keyRing } from "../lib/keys.ts";

export const wellknown = new Hono<AppEnv>();

wellknown.get("/jwks.json", async (c) => {
  c.header("Cache-Control", "public, max-age=300");
  return c.json((await keyRing(c.env)).jwks);
});

// Proof of control for Passport's instance registration (docs/self-host.md section 5): the deploy
// tool sets the secret for the few minutes the approval takes and deletes it afterwards.
wellknown.get("/opengrants-passport-challenge", (c) => {
  const challenge = c.env.PASSPORT_REGISTRATION_CHALLENGE;
  if (!challenge) return c.text("Not found", 404, { "Cache-Control": "no-store" });
  return c.text(challenge, 200, { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" });
});

wellknown.get("/oauth-authorization-server", (c) => {
  const base = trimSlash(c.env.GMS_BASE_URL);
  c.header("Cache-Control", "public, max-age=300");
  return c.json({
    issuer: c.env.OAUTH_ISSUER,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/oauth/token`,
    registration_endpoint: `${base}/oauth/register`,
    jwks_uri: `${base}/.well-known/jwks.json`,
    scopes_supported: SCOPES,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token", "client_credentials"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_basic", "client_secret_post"],
    code_challenge_methods_supported: ["S256"],
    service_documentation: `${base}/llms.txt`,
  });
});

const protectedResource = (base: string, issuer: string, resource: string) => ({
  resource,
  authorization_servers: [issuer],
  jwks_uri: `${base}/.well-known/jwks.json`,
  scopes_supported: SCOPES,
  bearer_methods_supported: ["header"],
  resource_name: "OpenGrants GMS",
  resource_documentation: `${base}/llms.txt`,
});

wellknown.get("/oauth-protected-resource", (c) => {
  const base = trimSlash(c.env.GMS_BASE_URL);
  c.header("Cache-Control", "public, max-age=300");
  return c.json(protectedResource(base, c.env.OAUTH_ISSUER, base));
});

// RFC 9728 §3.1: metadata for a resource at a path lives at /.well-known/oauth-protected-resource/<path>.
wellknown.get("/oauth-protected-resource/mcp", (c) => {
  const base = trimSlash(c.env.GMS_BASE_URL);
  c.header("Cache-Control", "public, max-age=300");
  return c.json(protectedResource(base, c.env.OAUTH_ISSUER, `${base}/mcp`));
});

wellknown.get("/agent.json", (c) => {
  const base = trimSlash(c.env.GMS_BASE_URL);
  c.header("Cache-Control", "public, max-age=300");
  return c.json({
    name: "OpenGrants GMS",
    description:
      "Grants management for funders and applicants on the CommonGrants protocol. Funders publish opportunities, review, decide, award and pay through OpenGrants Passport; applicants apply from their Passport record, report and get paid to a verified destination.",
    url: base,
    documentation: `${base}/llms.txt`,
    auth: {
      type: "oauth2",
      authorization_server: `${base}/.well-known/oauth-authorization-server`,
      protected_resource: `${base}/.well-known/oauth-protected-resource`,
      pkce: "S256",
      dynamic_client_registration: `${base}/oauth/register`,
    },
    capabilities: ["mcp", "commongrants:0.5.0"],
    endpoints: { mcp: `${base}/mcp`, commonGrants: `${base}/common-grants`, openapi: `${base}/openapi.json` },
    humanGatedActions: DEFAULT_GATED_TOOLS,
  });
});
