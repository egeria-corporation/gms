// SPDX-License-Identifier: AGPL-3.0-only
// OAuth discovery (RFC 9728 protected-resource metadata, RFC 8414 AS metadata) and GMS's built-in OAuth 2.1
// authorization server, used when the Supabase OAuth 2.1 server is not available.
//
//   /oauth/authorize  authorization code + PKCE (S256 only) + RFC 8707 resource indicators + RFC 9207 `iss`
//   /oauth/token      authorization_code and refresh_token (rotating, reuse-detecting) grants
//   /oauth/register   RFC 7591 dynamic client registration (supported, but CIMD is preferred)
//   client_id = https URL → Client ID Metadata Document (fetched SSRF-safely, cached as agent_clients row)
//
// The OAuth tables (oauth_pending_authorizations, oauth_authorization_codes) are service-only by design (RLS on,
// no policies): the token endpoint is unauthenticated, so the AS writes them with the service connection. The
// person's consent itself is the `oauth.grant_consent` action; completeAuthorization() only records a grant when
// that action has not (see agents.md, "known gaps").
import { createHash, randomUUID } from 'node:crypto';
import { sql, type Database } from '@gms/db';
import { ALL_SCOPES, parseScopes, SCOPES, STAFF_ROLES, type Scope } from '@gms/domain';
import { loadRoles } from '@gms/actions';
import { REFRESH_AUDIENCE, consumeRateLimit, supabaseUrlFor } from './auth';
import {
  CimdError,
  fetchClientMetadataSafely,
  isAllowedRedirectUri,
  parseClientMetadataDocument,
  redirectUriMatches,
  validateClientIdUrl,
} from './cimd';
import {
  HttpError,
  isRecord,
  json,
  newSecret,
  now,
  resourceUrl,
  safeEqual,
  sha256Hex,
  trimOrigin,
  type AgentEnv,
  type ResourceKind,
} from './env';

export const ACCESS_TOKEN_TTL_S = 3600;
export const REFRESH_TOKEN_TTL_S = 30 * 86400;
export const CODE_TTL_S = 120;
export const CIMD_CACHE_S = 24 * 3600;
export const GRANT_TTL_DAYS = 90;

// ---------------------------------------------------------------------------------------------------------
// Discovery documents
// ---------------------------------------------------------------------------------------------------------
export function issuer(env: AgentEnv): string {
  return trimOrigin(env.origin);
}

/** RFC 9728 metadata. `resource` null = the tenant-wide document at /.well-known/oauth-protected-resource. */
export function protectedResourceMetadata(env: AgentEnv, resource: ResourceKind | null): Record<string, unknown> {
  const servers = [issuer(env)];
  const supa = supabaseUrlFor(env);
  if (supa && process.env.GMS_SUPABASE_OAUTH_SERVER === '1') servers.push(`${supa}/auth/v1`);
  return {
    resource: resource ? resourceUrl(env, resource) : issuer(env),
    authorization_servers: servers,
    scopes_supported: [...ALL_SCOPES],
    bearer_methods_supported: ['header'],
    resource_name: `${env.brandName}${resource === 'mcp' ? ' MCP server' : resource === 'a2a' ? ' A2A agent' : resource === 'api' ? ' Platform API' : ''}`,
    resource_documentation: `${issuer(env)}/agents.md`,
    ...(resource === null
      ? { 'x-gms-resources': (['mcp', 'a2a', 'api'] as const).map((k) => resourceUrl(env, k)) }
      : {}),
  };
}

/** RFC 8414 metadata for the built-in authorization server. */
export function authorizationServerMetadata(env: AgentEnv): Record<string, unknown> {
  const iss = issuer(env);
  return {
    issuer: iss,
    authorization_endpoint: `${iss}/oauth/authorize`,
    token_endpoint: `${iss}/oauth/token`,
    registration_endpoint: `${iss}/oauth/register`,
    scopes_supported: [...ALL_SCOPES],
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
    code_challenge_methods_supported: ['S256'],
    authorization_response_iss_parameter_supported: true,
    client_id_metadata_document_supported: true,
    resource_indicators_supported: true,
    service_documentation: `${iss}/agents.md`,
    op_policy_uri: `${iss}/agents.md#rules`,
  };
}

// ---------------------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------------------
type ClientRow = {
  id: string;
  client_id: string;
  client_secret_hash: string | null;
  name: string;
  logo_url: string | null;
  homepage_url: string | null;
  cimd_url: string | null;
  workspace_id: string | null;
  kind: string;
  registration: string;
  redirect_uris: string[];
  scopes: string[];
  status: string;
  last_modified_at: string;
};

function oauthError(status: number, error: string, description: string, headers: Record<string, string> = {}): Response {
  return json({ error, error_description: description }, status, { pragma: 'no-cache', ...headers });
}

function b64urlSha256(v: string): string {
  return createHash('sha256').update(v).digest('base64url');
}

const PKCE_RE = /^[A-Za-z0-9._~-]{43,128}$/;

/** Which resource kinds a resource indicator grants. The tenant origin covers all three. */
export function resourceKindsFor(env: AgentEnv, resource: string): ResourceKind[] | null {
  const r = trimOrigin(resource);
  if (r === issuer(env)) return ['mcp', 'a2a', 'api'];
  for (const k of ['mcp', 'a2a', 'api'] as const) if (r === resourceUrl(env, k)) return [k];
  return null;
}

async function clientByRef(env: AgentEnv, clientRef: string): Promise<ClientRow | null> {
  const db = env.runtime.db;
  if (/^https:\/\//i.test(clientRef)) return cimdClient(env, clientRef);
  const row = await db.selectFrom('agent_clients').selectAll().where('client_id', '=', clientRef).executeTakeFirst();
  if (!row) return null;
  if (row.workspace_id && row.workspace_id !== env.workspace.id) return null;
  if (row.kind !== 'oauth_client') return null;
  return row;
}

/** Resolves (and caches for 24 h) a Client ID Metadata Document client. */
async function cimdClient(env: AgentEnv, url: string): Promise<ClientRow | null> {
  validateClientIdUrl(url);
  const db = env.runtime.db;
  const cached = await db.selectFrom('agent_clients').selectAll().where('client_id', '=', url).executeTakeFirst();
  if (cached && cached.registration !== 'cimd') return null;
  if (cached && now(env).getTime() - new Date(cached.last_modified_at).getTime() < CIMD_CACHE_S * 1000) return cached;
  const fetcher = env.fetchClientMetadata ?? ((u: string) => fetchClientMetadataSafely(u));
  const meta = parseClientMetadataDocument(url, await fetcher(url));
  const scopes = meta.scopes.length ? meta.scopes : [...ALL_SCOPES];
  const row = await db
    .insertInto('agent_clients')
    .values({
      client_id: url,
      cimd_url: url,
      name: meta.name,
      logo_url: meta.logoUri,
      homepage_url: meta.clientUri,
      kind: 'oauth_client',
      registration: 'cimd',
      redirect_uris: meta.redirectUris,
      scopes,
      workspace_id: null,
    })
    .onConflict((oc) =>
      oc.column('client_id').doUpdateSet({
        name: meta.name,
        logo_url: meta.logoUri,
        homepage_url: meta.clientUri,
        redirect_uris: meta.redirectUris,
        scopes,
        last_modified_at: sql`now()`,
      }),
    )
    .returningAll()
    .executeTakeFirstOrThrow();
  return row;
}

function redirectWith(base: string, params: Record<string, string | null | undefined>): string {
  const u = new URL(base);
  for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined) u.searchParams.set(k, v);
  return u.toString();
}

function redirect(location: string): Response {
  return new Response(null, { status: 302, headers: { location, 'cache-control': 'no-store' } });
}

// ---------------------------------------------------------------------------------------------------------
// Authorization endpoint
// ---------------------------------------------------------------------------------------------------------
/** GET /oauth/authorize — validates the request and hands off to the consent screen (/oauth/consent?request=…). */
export async function authorize(req: Request, env: AgentEnv): Promise<Response> {
  const q = new URL(req.url).searchParams;
  const clientRef = q.get('client_id') ?? '';
  const redirectUri = q.get('redirect_uri') ?? '';
  const state = q.get('state');
  if (!clientRef) return oauthError(400, 'invalid_request', 'client_id is required.');
  let client: ClientRow | null;
  try {
    client = await clientByRef(env, clientRef);
  } catch (err) {
    if (err instanceof CimdError) return oauthError(400, 'invalid_client', err.message);
    throw err;
  }
  if (!client) return oauthError(400, 'invalid_client', 'Unknown client_id. Register with /oauth/register or use a client ID metadata document URL.');
  if (client.status !== 'active') return oauthError(400, 'unauthorized_client', `This agent is ${client.status}.`);
  // Never redirect to an unregistered URI: errors about the redirect URI are shown here instead.
  if (!redirectUri || !redirectUriMatches(client.redirect_uris, redirectUri)) {
    return oauthError(400, 'invalid_request', 'redirect_uri is missing or not registered for this client.');
  }
  const fail = (error: string, description: string) =>
    redirect(redirectWith(redirectUri, { error, error_description: description, state, iss: issuer(env) }));

  if (q.get('response_type') !== 'code') return fail('unsupported_response_type', 'Only response_type=code is supported.');
  const challenge = q.get('code_challenge') ?? '';
  if (!PKCE_RE.test(challenge)) return fail('invalid_request', 'PKCE is required: send code_challenge (S256).');
  if ((q.get('code_challenge_method') ?? 'plain') !== 'S256') return fail('invalid_request', 'Only code_challenge_method=S256 is supported.');
  const resource = q.get('resource');
  if (!resource) return fail('invalid_target', `Send a resource indicator (RFC 8707), e.g. resource=${resourceUrl(env, 'mcp')}.`);
  if (q.getAll('resource').length > 1 || !resourceKindsFor(env, resource)) {
    return fail('invalid_target', `Unknown resource. Use ${resourceUrl(env, 'mcp')}, ${resourceUrl(env, 'a2a')} or ${resourceUrl(env, 'api')}.`);
  }
  const rawScopes = (q.get('scope') ?? '').split(/\s+/).filter(Boolean);
  const unknown = rawScopes.filter((s) => !(s in SCOPES));
  // Only known scopes are ever accepted — and no scope exists for a people-only (R3) action.
  if (unknown.length) return fail('invalid_scope', `Unknown scope(s): ${unknown.join(' ')}.`);
  let scopes = parseScopes(rawScopes);
  if (!scopes.length) scopes = parseScopes(client.scopes);
  scopes = scopes.filter((s) => client.scopes.includes(s));
  if (!scopes.length) return fail('invalid_scope', 'None of the requested scopes are allowed for this client.');

  const row = await env.runtime.db
    .insertInto('oauth_pending_authorizations')
    .values({
      client_id: client.id,
      workspace_id: env.workspace.id,
      redirect_uri: redirectUri,
      scopes,
      resource: trimOrigin(resource),
      state: state ? state.slice(0, 500) : null,
      code_challenge: challenge,
      expires_at: new Date(now(env).getTime() + 15 * 60_000).toISOString(),
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return redirect(`${issuer(env)}/oauth/consent?request=${row.id}`);
}

export interface PendingAuthorization {
  id: string;
  client: { id: string; clientId: string; name: string; logoUrl: string | null; homepageUrl: string | null; registration: string };
  redirectHost: string;
  resource: string | null;
  scopes: { scope: Scope; label: string; audience: string }[];
  expiresAt: string;
}

/** Data for the consent screen (O-01). Returns null when the request is unknown or expired. */
export async function getPendingAuthorization(env: AgentEnv, requestId: string): Promise<PendingAuthorization | null> {
  if (!/^[0-9a-f-]{36}$/i.test(requestId)) return null;
  const p = await env.runtime.db
    .selectFrom('oauth_pending_authorizations as p')
    .innerJoin('agent_clients as c', 'c.id', 'p.client_id')
    .select(['p.id', 'p.redirect_uri', 'p.resource', 'p.scopes', 'p.expires_at', 'p.workspace_id', 'c.id as cid', 'c.client_id', 'c.name', 'c.logo_url', 'c.homepage_url', 'c.registration'])
    .where('p.id', '=', requestId)
    .executeTakeFirst();
  if (!p || p.workspace_id !== env.workspace.id || new Date(p.expires_at) <= now(env)) return null;
  return {
    id: p.id,
    client: { id: p.cid, clientId: p.client_id, name: p.name, logoUrl: p.logo_url, homepageUrl: p.homepage_url, registration: p.registration },
    redirectHost: new URL(p.redirect_uri).host,
    resource: p.resource,
    scopes: parseScopes(p.scopes).map((s) => ({ scope: s, label: SCOPES[s].label, audience: SCOPES[s].audience })),
    expiresAt: p.expires_at,
  };
}

/**
 * Called by the app after the person approved on the consent screen (and `oauth.grant_consent` ran). Issues a
 * one-time authorization code bound to the client, redirect URI, PKCE challenge, scopes and resource, and returns
 * the redirect URL (`code`, `state`, `iss`).
 */
export async function completeAuthorization(
  env: AgentEnv,
  input: { requestId: string; userId: string; approvedScopes: readonly string[] },
): Promise<{ redirectUrl: string }> {
  const db = env.runtime.db;
  const at = now(env);
  const p = await db.selectFrom('oauth_pending_authorizations').selectAll().where('id', '=', input.requestId).executeTakeFirst();
  if (!p || p.workspace_id !== env.workspace.id) throw new HttpError(404, 'not_found', 'Not found', 'This authorization request was not found.');
  if (new Date(p.expires_at) <= at) {
    await db.deleteFrom('oauth_pending_authorizations').where('id', '=', p.id).execute();
    throw new HttpError(409, 'conflict', 'Expired', 'This authorization request expired. Start again from the agent.');
  }
  const roles = await loadRoles(db, env.workspace.id, input.userId);
  const isStaff = roles.some((r) => STAFF_ROLES.includes(r));
  // Approved ⊆ requested; staff scopes only for staff. Scopes outside the registry are dropped by parseScopes.
  let scopes = parseScopes(input.approvedScopes).filter((s) => p.scopes.includes(s) && (isStaff || SCOPES[s].audience !== 'staff'));
  const grant = await db
    .selectFrom('agent_grants')
    .selectAll()
    .where('client_id', '=', p.client_id)
    .where('user_id', '=', input.userId)
    .where('status', '=', 'active')
    .orderBy('created_at', 'desc')
    .executeTakeFirst();
  if (grant && (!grant.expires_at || new Date(grant.expires_at) > at)) {
    scopes = scopes.filter((s) => grant.scopes.includes(s));
  } else if (scopes.length) {
    await db
      .insertInto('agent_grants')
      .values({ client_id: p.client_id, user_id: input.userId, workspace_id: env.workspace.id, scopes, status: 'active', expires_at: new Date(at.getTime() + GRANT_TTL_DAYS * 86400_000).toISOString() })
      .execute();
  }
  await db.deleteFrom('oauth_pending_authorizations').where('id', '=', p.id).execute();
  if (!scopes.length) {
    return { redirectUrl: redirectWith(p.redirect_uri, { error: 'access_denied', error_description: 'No permissions were approved.', state: p.state, iss: issuer(env) }) };
  }
  const code = newSecret('gms_ac');
  await db
    .insertInto('oauth_authorization_codes')
    .values({
      code_hash: code.hash,
      client_id: p.client_id,
      user_id: input.userId,
      workspace_id: env.workspace.id,
      redirect_uri: p.redirect_uri,
      scopes,
      resource: p.resource,
      code_challenge: p.code_challenge,
      code_challenge_method: 'S256',
      expires_at: new Date(at.getTime() + CODE_TTL_S * 1000).toISOString(),
    })
    .execute();
  return { redirectUrl: redirectWith(p.redirect_uri, { code: code.token, state: p.state, iss: issuer(env) }) };
}

/** The person said no. */
export async function denyAuthorization(env: AgentEnv, input: { requestId: string }): Promise<{ redirectUrl: string }> {
  const db = env.runtime.db;
  const p = await db.selectFrom('oauth_pending_authorizations').selectAll().where('id', '=', input.requestId).executeTakeFirst();
  if (!p || p.workspace_id !== env.workspace.id) throw new HttpError(404, 'not_found', 'Not found', 'This authorization request was not found.');
  await db.deleteFrom('oauth_pending_authorizations').where('id', '=', p.id).execute();
  return { redirectUrl: redirectWith(p.redirect_uri, { error: 'access_denied', error_description: 'The person declined.', state: p.state, iss: issuer(env) }) };
}

// ---------------------------------------------------------------------------------------------------------
// Token endpoint
// ---------------------------------------------------------------------------------------------------------
async function formParams(req: Request): Promise<URLSearchParams> {
  const type = req.headers.get('content-type') ?? '';
  const raw = await req.text();
  if (raw.length > 20_000) throw new HttpError(413, 'validation_failed', 'Request too large', 'The request is too large.');
  if (type.includes('application/json')) {
    const obj = JSON.parse(raw || '{}') as unknown;
    const p = new URLSearchParams();
    if (isRecord(obj)) for (const [k, v] of Object.entries(obj)) if (typeof v === 'string') p.set(k, v);
    return p;
  }
  return new URLSearchParams(raw);
}

/** Authenticates the client at the token endpoint (public clients send only client_id). */
async function tokenClient(env: AgentEnv, req: Request, p: URLSearchParams): Promise<ClientRow | Response> {
  let clientRef = p.get('client_id');
  let secret = p.get('client_secret');
  const basic = /^Basic\s+(.+)$/i.exec(req.headers.get('authorization') ?? '');
  if (basic) {
    const decoded = Buffer.from(basic[1]!, 'base64').toString('utf8');
    const i = decoded.indexOf(':');
    if (i < 0) return oauthError(401, 'invalid_client', 'Malformed Basic credentials.', { 'www-authenticate': 'Basic realm="gms"' });
    clientRef = decodeURIComponent(decoded.slice(0, i));
    secret = decodeURIComponent(decoded.slice(i + 1));
  }
  if (!clientRef) return oauthError(401, 'invalid_client', 'client_id is required.');
  let client: ClientRow | null;
  try {
    client = await clientByRef(env, clientRef);
  } catch (err) {
    if (err instanceof CimdError) return oauthError(401, 'invalid_client', err.message);
    throw err;
  }
  if (!client || client.status !== 'active') return oauthError(401, 'invalid_client', 'Unknown or inactive client.');
  if (client.client_secret_hash) {
    if (!secret || !safeEqual(sha256Hex(secret), client.client_secret_hash)) {
      return oauthError(401, 'invalid_client', 'Client authentication failed.', basic ? { 'www-authenticate': 'Basic realm="gms"' } : {});
    }
  }
  return client;
}

async function issueTokens(
  db: Database,
  env: AgentEnv,
  t: { client: ClientRow; userId: string; workspaceId: string | null; scopes: Scope[]; resource: string },
): Promise<Record<string, unknown>> {
  const at = now(env).getTime();
  const access = newSecret('gms_oat');
  const refresh = newSecret('gms_ort');
  await db
    .insertInto('personal_access_tokens')
    .values([
      {
        user_id: t.userId,
        workspace_id: t.workspaceId,
        agent_client_id: t.client.id,
        name: `${t.client.name} (OAuth)`,
        prefix: access.prefix,
        token_hash: access.hash,
        scopes: t.scopes,
        audience: [t.resource],
        expires_at: new Date(at + ACCESS_TOKEN_TTL_S * 1000).toISOString(),
      },
      {
        user_id: t.userId,
        workspace_id: t.workspaceId,
        agent_client_id: t.client.id,
        name: `${t.client.name} (OAuth refresh)`,
        prefix: refresh.prefix,
        token_hash: refresh.hash,
        scopes: t.scopes,
        audience: [REFRESH_AUDIENCE, t.resource],
        expires_at: new Date(at + REFRESH_TOKEN_TTL_S * 1000).toISOString(),
      },
    ])
    .execute();
  return { access_token: access.token, token_type: 'Bearer', expires_in: ACCESS_TOKEN_TTL_S, refresh_token: refresh.token, scope: t.scopes.join(' ') };
}

async function activeGrant(db: Database, env: AgentEnv, clientId: string, userId: string) {
  const g = await db
    .selectFrom('agent_grants')
    .selectAll()
    .where('client_id', '=', clientId)
    .where('user_id', '=', userId)
    .where('status', '=', 'active')
    .orderBy('created_at', 'desc')
    .executeTakeFirst();
  if (!g || (g.expires_at && new Date(g.expires_at) <= now(env))) return null;
  return g;
}

const NO_STORE = { 'cache-control': 'no-store', pragma: 'no-cache' };

/** POST /oauth/token */
export async function token(req: Request, env: AgentEnv): Promise<Response> {
  if (req.method !== 'POST') return oauthError(405, 'invalid_request', 'Use POST.', { allow: 'POST' });
  let p: URLSearchParams;
  try {
    p = await formParams(req);
  } catch {
    return oauthError(400, 'invalid_request', 'Send application/x-www-form-urlencoded parameters.');
  }
  const client = await tokenClient(env, req, p);
  if (client instanceof Response) return client;
  const db = env.runtime.db;
  const grantType = p.get('grant_type');

  if (grantType === 'authorization_code') {
    const code = p.get('code') ?? '';
    const verifier = p.get('code_verifier') ?? '';
    if (!code || !PKCE_RE.test(verifier)) return oauthError(400, 'invalid_request', 'code and a valid code_verifier are required.');
    // One-time use: mark used atomically, then validate. A replayed code never yields a token.
    const row = await db
      .updateTable('oauth_authorization_codes')
      .set({ used_at: now(env).toISOString() })
      .where('code_hash', '=', sha256Hex(code))
      .where('used_at', 'is', null)
      .returningAll()
      .executeTakeFirst();
    if (!row) return oauthError(400, 'invalid_grant', 'The authorization code is invalid or was already used.');
    if (new Date(row.expires_at) <= now(env)) return oauthError(400, 'invalid_grant', 'The authorization code expired.');
    if (row.client_id !== client.id) return oauthError(400, 'invalid_grant', 'The code was issued to a different client.');
    if (row.workspace_id && row.workspace_id !== env.workspace.id) return oauthError(400, 'invalid_grant', 'The code was issued by a different foundation.');
    if ((p.get('redirect_uri') ?? '') !== row.redirect_uri) return oauthError(400, 'invalid_grant', 'redirect_uri does not match the authorization request.');
    if (!safeEqual(b64urlSha256(verifier), row.code_challenge)) return oauthError(400, 'invalid_grant', 'PKCE verification failed (code_verifier does not match).');
    const resource = p.get('resource') ? trimOrigin(p.get('resource')!) : row.resource;
    if (!resource || resource !== row.resource) return oauthError(400, 'invalid_target', 'The resource must match the one that was authorized.');
    if (!(await activeGrant(db, env, client.id, row.user_id))) return oauthError(400, 'invalid_grant', 'The person withdrew consent.');
    const body = await issueTokens(db, env, { client, userId: row.user_id, workspaceId: row.workspace_id, scopes: parseScopes(row.scopes), resource });
    return json(body, 200, NO_STORE);
  }

  if (grantType === 'refresh_token') {
    const presented = p.get('refresh_token') ?? '';
    if (!presented.startsWith('gms_ort_')) return oauthError(400, 'invalid_grant', 'The refresh token is invalid.');
    const hash = sha256Hex(presented);
    const row = await db.selectFrom('personal_access_tokens').selectAll().where('token_hash', '=', hash).executeTakeFirst();
    if (!row || !row.audience.includes(REFRESH_AUDIENCE) || row.agent_client_id !== client.id) return oauthError(400, 'invalid_grant', 'The refresh token is invalid.');
    if (row.revoked_at) {
      // Reuse of a rotated refresh token: assume theft and revoke every OAuth token of this client for this person.
      await db
        .updateTable('personal_access_tokens')
        .set({ revoked_at: now(env).toISOString() })
        .where('agent_client_id', '=', client.id)
        .where('user_id', '=', row.user_id)
        .where('revoked_at', 'is', null)
        .execute();
      return oauthError(400, 'invalid_grant', 'The refresh token was already used. All tokens for this agent were revoked; reconnect it.');
    }
    if (row.expires_at && new Date(row.expires_at) <= now(env)) return oauthError(400, 'invalid_grant', 'The refresh token expired.');
    if (row.workspace_id && row.workspace_id !== env.workspace.id) return oauthError(400, 'invalid_grant', 'The refresh token belongs to a different foundation.');
    const grant = await activeGrant(db, env, client.id, row.user_id);
    if (!grant) return oauthError(400, 'invalid_grant', 'The person withdrew consent.');
    const original = row.audience.find((a) => a !== REFRESH_AUDIENCE) ?? '';
    const resource = p.get('resource') ? trimOrigin(p.get('resource')!) : original;
    if (resource !== original) return oauthError(400, 'invalid_target', 'The resource must match the original authorization.');
    const requested = p.get('scope') ? p.get('scope')!.split(/\s+/).filter(Boolean) : row.scopes;
    if (requested.some((s) => !row.scopes.includes(s))) return oauthError(400, 'invalid_scope', 'A refresh cannot add scopes.');
    const scopes = parseScopes(requested).filter((s) => grant.scopes.includes(s));
    const rotated = await db
      .updateTable('personal_access_tokens')
      .set({ revoked_at: now(env).toISOString() })
      .where('id', '=', row.id)
      .where('revoked_at', 'is', null)
      .executeTakeFirst();
    if (!Number(rotated.numUpdatedRows)) return oauthError(400, 'invalid_grant', 'The refresh token was already used.');
    const body = await issueTokens(db, env, { client, userId: row.user_id, workspaceId: row.workspace_id, scopes, resource });
    return json(body, 200, NO_STORE);
  }

  return oauthError(400, 'unsupported_grant_type', 'Use authorization_code or refresh_token.');
}

// ---------------------------------------------------------------------------------------------------------
// Dynamic client registration (RFC 7591)
// ---------------------------------------------------------------------------------------------------------
/** POST /oauth/register */
export async function register(req: Request, env: AgentEnv): Promise<Response> {
  if (req.method !== 'POST') return oauthError(405, 'invalid_request', 'Use POST.', { allow: 'POST' });
  const limit = await consumeRateLimit(env.runtime.db, `rl:dcr:${env.ip ?? 'unknown'}`, Number(process.env.GMS_DCR_RATE_LIMIT_PER_MIN ?? 10) || 10, now(env));
  if (limit.limited) return oauthError(429, 'slow_down', 'Too many registrations. Try again later.', { 'retry-after': String(limit.resetSeconds) });
  let body: unknown;
  try {
    const raw = await req.text();
    if (raw.length > 20_000) return oauthError(400, 'invalid_client_metadata', 'The registration request is too large.');
    body = JSON.parse(raw) as unknown;
  } catch {
    return oauthError(400, 'invalid_client_metadata', 'Send the client metadata as a JSON object.');
  }
  if (!isRecord(body)) return oauthError(400, 'invalid_client_metadata', 'Send the client metadata as a JSON object.');
  const uris = body.redirect_uris;
  if (!Array.isArray(uris) || !uris.length || uris.length > 20 || !uris.every(isAllowedRedirectUri)) {
    return oauthError(400, 'invalid_redirect_uri', 'redirect_uris must be https URIs, loopback http URIs, or private-use scheme URIs.');
  }
  const auth = typeof body.token_endpoint_auth_method === 'string' ? body.token_endpoint_auth_method : 'none';
  if (!['none', 'client_secret_post', 'client_secret_basic'].includes(auth)) return oauthError(400, 'invalid_client_metadata', 'Unsupported token_endpoint_auth_method.');
  const grants = Array.isArray(body.grant_types) ? body.grant_types : ['authorization_code', 'refresh_token'];
  if (!grants.every((g) => g === 'authorization_code' || g === 'refresh_token')) return oauthError(400, 'invalid_client_metadata', 'grant_types may only be authorization_code and refresh_token.');
  const responseTypes = Array.isArray(body.response_types) ? body.response_types : ['code'];
  if (!responseTypes.every((t) => t === 'code')) return oauthError(400, 'invalid_client_metadata', 'response_types may only be "code".');
  const rawScopes = typeof body.scope === 'string' ? body.scope.split(/\s+/).filter(Boolean) : [];
  const unknown = rawScopes.filter((s) => !(s in SCOPES));
  if (unknown.length) return oauthError(400, 'invalid_client_metadata', `Unknown scope(s): ${unknown.join(' ')}.`);
  const scopes = rawScopes.length ? parseScopes(rawScopes) : [...ALL_SCOPES];
  const https = (v: unknown): string | null => {
    if (typeof v !== 'string') return null;
    try {
      return new URL(v).protocol === 'https:' ? v.slice(0, 500) : null;
    } catch {
      return null;
    }
  };
  const name = typeof body.client_name === 'string' && body.client_name.trim() ? body.client_name.trim().slice(0, 100) : 'Unnamed agent';
  const secret = auth === 'none' ? null : newSecret('gms_cs');
  const clientRef = `dcr_${randomUUID()}`;
  const row = await env.runtime.db
    .insertInto('agent_clients')
    .values({
      workspace_id: env.workspace.id,
      client_id: clientRef,
      client_secret_hash: secret?.hash ?? null,
      name,
      logo_url: https(body.logo_uri),
      homepage_url: https(body.client_uri),
      kind: 'oauth_client',
      registration: 'dcr',
      redirect_uris: uris as string[],
      scopes,
    })
    .returning(['id', 'created_at'])
    .executeTakeFirstOrThrow();
  return json(
    {
      client_id: clientRef,
      client_id_issued_at: Math.floor(new Date(row.created_at).getTime() / 1000),
      ...(secret ? { client_secret: secret.token, client_secret_expires_at: 0 } : {}),
      client_name: name,
      redirect_uris: uris,
      grant_types: grants,
      response_types: ['code'],
      token_endpoint_auth_method: auth,
      scope: scopes.join(' '),
    },
    201,
    NO_STORE,
  );
}

export type OAuthRoute = 'authorize' | 'token' | 'register';

/** Dispatcher for the built-in AS endpoints. */
export async function handleOAuth(req: Request, env: AgentEnv, route: OAuthRoute): Promise<Response> {
  try {
    if (route === 'authorize') {
      if (req.method !== 'GET') return oauthError(405, 'invalid_request', 'Use GET.', { allow: 'GET' });
      return await authorize(req, env);
    }
    if (route === 'token') return await token(req, env);
    return await register(req, env);
  } catch (err) {
    if (err instanceof HttpError) return oauthError(err.status, err.status === 413 ? 'invalid_request' : 'server_error', err.message);
    console.error('[oauth] unexpected error', (err as Error).message);
    return oauthError(500, 'server_error', 'Something went wrong.');
  }
}
