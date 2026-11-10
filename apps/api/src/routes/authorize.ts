// SPDX-License-Identifier: AGPL-3.0-only
// Authorization code flow with PKCE, in three steps:
//   1. GET  /oauth/authorize           the client's request is validated, signed, and the person is
//                                      sent to the web consent screen (`/oauth/consent?req=…`)
//   2. GET  /oauth/authorize/request   what that screen shows: client, scopes, gated actions, workspaces
//   3. POST /oauth/authorize/decision  the person's answer; returns where to send the browser
// The person chooses one workspace; the token is bound to user + workspace + scopes (build spec §10.9).
import { record } from "@gms/ledger";
import { Hono } from "hono";
import type { AppEnv } from "../app.ts";
import { CHALLENGE, generateAuthCode, sha256b64url } from "../auth/crypto.ts";
import { requireUser } from "../auth/middleware.ts";
import { APPROVALS_BYPASS_SCOPE, DEFAULT_GATED_TOOLS, SCOPE_DESCRIPTIONS, isScope, parseScopeString, roleRequiresMfa, scopesForRole, type Scope } from "../auth/scopes.ts";
import type { OAuthClient } from "../auth/stores.ts";
import { CODE_TTL_SEC, readConsentRequest, signConsentRequest } from "../auth/tokens.ts";
import { trimSlash } from "../env.ts";
import { ApiError, ok } from "../lib/errors.ts";
import { keyRing } from "../lib/keys.ts";

/** Errors before the redirect URI is validated must not redirect (RFC 6749 §4.1.2.1). */
const authorizeError = (description: string) => new ApiError(400, "invalid_request", description);

export function redirectWith(uri: string, params: Record<string, string | undefined>): string {
  const u = new URL(uri);
  for (const [k, v] of Object.entries(params)) if (v !== undefined) u.searchParams.set(k, v);
  return u.toString();
}

/** A client may ask for any scope it is allowed; `approvals:bypass` can never be obtained through consent. */
const consentable = (client: OAuthClient, s: string) => isScope(s) && client.allowedScopes.includes(s);

export const authorize = new Hono<AppEnv>();

authorize.get("/authorize", async (c) => {
  const { auth, now } = c.get("deps");
  const q = (k: string) => c.req.query(k);
  const redirectUri = q("redirect_uri") ?? "";
  const client = await auth.getClient(q("client_id") ?? "");
  if (!client || client.revokedAt || !client.grantTypes.includes("authorization_code")) throw authorizeError("Unknown client, or the client may not use the authorization code flow");
  if (!client.redirectUris.includes(redirectUri)) throw authorizeError("redirect_uri does not exactly match a registered URI");

  const state = q("state");
  const fail = (error: string, description: string) => c.redirect(redirectWith(redirectUri, { error, error_description: description, state }), 302);
  if (q("response_type") !== "code") return fail("unsupported_response_type", "response_type must be code");
  if (q("code_challenge_method") !== "S256" || !CHALLENGE.test(q("code_challenge") ?? "")) return fail("invalid_request", "PKCE with S256 is required");
  const scopes = parseScopeString(q("scope"));
  if (!scopes.length || scopes.some((s) => !consentable(client, s))) return fail("invalid_scope", "Requested scope is not allowed for this client");

  const req = await signConsentRequest(
    c.env,
    await keyRing(c.env),
    { client_id: client.id, redirect_uri: redirectUri, scope: scopes.join(" "), code_challenge: q("code_challenge")!, ...(state !== undefined ? { state } : {}) },
    now(),
  );
  return c.redirect(`${trimSlash(c.env.WEB_BASE_URL)}/oauth/consent?req=${encodeURIComponent(req)}`, 302);
});

async function loadRequest(c: { env: AppEnv["Bindings"]; get: (k: "deps") => AppEnv["Variables"]["deps"] }, token: string | undefined) {
  const expired = new ApiError(400, "invalid_consent_request", "This connection request has expired. Start again from the application.");
  if (!token) throw new ApiError(400, "bad_request", "Missing consent request");
  const req = await readConsentRequest(c.env, await keyRing(c.env), token, c.get("deps").now());
  if (!req) throw expired;
  const client = await c.get("deps").auth.getClient(req.client_id);
  // Re-check against the client as it is now: it may have been revoked or edited since step 1.
  if (!client || client.revokedAt || !client.redirectUris.includes(req.redirect_uri)) throw expired;
  return { req, client };
}

authorize.get("/authorize/request", requireUser(), async (c) => {
  const { req, client } = await loadRequest(c, c.req.query("req"));
  const user = c.get("user");
  const requested = parseScopeString(req.scope);
  const nowMs = c.get("deps").now().getTime();
  const memberships = (await c.get("deps").members.listForUser(user.userId)).filter((m) => !m.expiresAt || Date.parse(m.expiresAt) > nowMs);
  return c.json(
    ok({
      client: { id: client.id, name: client.name, dynamicallyRegistered: client.dynamic, redirectHost: new URL(req.redirect_uri).host },
      scopes: requested.map((s) => ({ scope: s, description: SCOPE_DESCRIPTIONS[s as Scope] ?? s })),
      gatedActions: client.gatedTools ?? [...DEFAULT_GATED_TOOLS],
      // Per workspace: which of the requested scopes this person's role can actually grant.
      workspaces: memberships.map((m) => {
        const role = new Set<string>(scopesForRole(m.workspaceKind, m.role));
        return {
          id: m.workspaceId,
          name: m.workspaceName,
          kind: m.workspaceKind,
          role: m.role,
          grantableScopes: requested.filter((s) => role.has(s)),
          requiresMfa: roleRequiresMfa(m.workspaceKind, m.role) && user.aal !== "aal2",
        };
      }),
    }),
  );
});

authorize.post("/authorize/decision", requireUser(), async (c) => {
  const body = (await c.req.json().catch(() => null)) as { req?: string; approve?: boolean; workspaceId?: string; scopes?: string[] } | null;
  const { req, client } = await loadRequest(c, body?.req);
  const user = c.get("user");
  const { auth, members, ledger, now } = c.get("deps");

  if (body?.approve !== true) {
    return c.json(ok({ redirectTo: redirectWith(req.redirect_uri, { error: "access_denied", error_description: "The request was declined", state: req.state }) }));
  }
  if (!body.workspaceId) throw new ApiError(400, "bad_request", "Choose a workspace to connect", [{ code: "required", field: "workspaceId" }]);
  const m = await members.getMembership(body.workspaceId, user.userId);
  const at = now();
  if (!m || (m.expiresAt && Date.parse(m.expiresAt) <= at.getTime())) throw new ApiError(403, "workspace_mismatch", "You are not a member of this workspace");
  if (roleRequiresMfa(m.workspaceKind, m.role) && user.aal !== "aal2") throw new ApiError(403, "mfa_required", "Verify with your authenticator app before connecting an agent to this workspace");

  // Granted = requested ∩ (what the person kept ticked) ∩ (what their role allows). Never more.
  const requested = parseScopeString(req.scope);
  const kept = Array.isArray(body.scopes) ? requested.filter((s) => body.scopes!.includes(s)) : requested;
  const role = new Set<string>(scopesForRole(m.workspaceKind, m.role));
  const granted = kept.filter((s) => role.has(s) && s !== APPROVALS_BYPASS_SCOPE);
  if (!granted.length) throw new ApiError(403, "nothing_to_grant", "Your role in this workspace cannot grant any of the requested permissions");

  const code = generateAuthCode();
  await auth.saveCode({
    codeHash: await sha256b64url(code),
    clientId: client.id,
    userId: user.userId,
    workspaceId: m.workspaceId,
    scopes: granted,
    redirectUri: req.redirect_uri,
    codeChallenge: req.code_challenge,
    expiresAt: new Date(at.getTime() + CODE_TTL_SEC * 1000).toISOString(),
    usedAt: null,
  });
  await record(
    ledger,
    { workspaceId: m.workspaceId, actor: { kind: "user", userId: user.userId }, eventType: "access.agent_consent_granted", subjectType: "oauth_client", subjectId: client.id, data: { clientName: client.name, scopes: granted } },
    { now },
  );
  return c.json(ok({ redirectTo: redirectWith(req.redirect_uri, { code, state: req.state }) }));
});
