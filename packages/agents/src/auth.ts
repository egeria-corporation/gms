// SPDX-License-Identifier: AGPL-3.0-only
// Bearer-token resolution shared by /api/v1, /mcp, /a2a and the CommonGrants write routes.
//
// Accepted credentials (Authorization: Bearer <token> only; never query strings):
//   gms_pat_…  personal access token a person created for an agent   → personal_access_tokens
//   gms_oat_…  access token issued by GMS's built-in OAuth server     → personal_access_tokens (+ active agent_grant)
//   gms_ak_…   foundation agent-account key                           → api_keys (agent_client_id set)
//   gms_sk_…   workspace API key                                      → api_keys (no agent client)
//   <JWT>      Supabase OAuth 2.1 access token (when SUPABASE_URL is set) → verified via JWKS
//
// Decision: EVERY bearer credential resolves to an *agent* actor acting on behalf of a person (the token's user,
// the agent account's owner, or the workspace key's owner). A bearer token is never a person at a keyboard, so
// R2 actions always become approval requests and R3 actions are always refused, even for workspace API keys.
import { loadRoles, type ActionContext, type Channel } from '@gms/actions';
import { sql, type Database } from '@gms/db';
import { isScope, parseScopes, SCOPES, type Scope } from '@gms/domain';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import {
  HttpError,
  now,
  resourceMetadataUrl,
  resourceUrl,
  safeEqual,
  sha256Hex,
  trimOrigin,
  type AgentEnv,
  type HeaderMap,
  type ResourceKind,
} from './env';

export type PrincipalKind = 'pat' | 'oauth' | 'agent_account' | 'workspace_key' | 'supabase';

export interface AgentPrincipal {
  kind: PrincipalKind;
  /** personal_access_tokens.id / api_keys.id (null for Supabase JWTs). */
  credentialId: string | null;
  /** agent_clients.id (null for plain workspace API keys). */
  clientId: string | null;
  /** agent_clients.client_id — the public OAuth client identifier. */
  clientRef: string | null;
  clientName: string;
  /** The person the agent acts for. */
  userId: string;
  userName: string | null;
  userEmail: string | null;
  /** Effective scopes: token ∩ client (∩ consent grant). */
  scopes: Scope[];
  /** Resources the token is valid for (short names or absolute URLs); empty = any GMS resource. */
  audience: string[];
  toolAllowlist: string[] | null;
  rateLimitPerMin: number;
}

export interface RateInfo {
  limit: number;
  remaining: number;
  resetSeconds: number;
  policy: string;
}

export interface AuthResult {
  principal: AgentPrincipal | null;
  ctx: ActionContext;
  rate: RateInfo;
}

/** Marker stored in personal_access_tokens.audience for OAuth refresh tokens (never valid as access tokens). */
export const REFRESH_AUDIENCE = 'urn:gms:oauth:refresh';

const ANON_SCOPES: Scope[] = ['opportunities:read'];
const DEFAULT_ANON_LIMIT = 30;

// ---------------------------------------------------------------------------------------------------------
// Challenges (RFC 6750 + RFC 9728)
// ---------------------------------------------------------------------------------------------------------
function quote(v: string): string {
  return `"${v.replace(/["\\]/g, '')}"`;
}

export function bearerChallenge(
  env: AgentEnv,
  resource: ResourceKind,
  opts: { error?: 'invalid_token' | 'insufficient_scope' | 'invalid_request'; description?: string; scopes?: readonly string[] } = {},
): string {
  const parts = [`resource_metadata=${quote(resourceMetadataUrl(env, resource))}`];
  if (opts.error) parts.unshift(`error=${quote(opts.error)}`);
  if (opts.description) parts.push(`error_description=${quote(opts.description)}`);
  if (opts.scopes?.length) parts.push(`scope=${quote([...new Set(opts.scopes)].join(' '))}`);
  return `Bearer ${parts.join(', ')}`;
}

/** 401: no token, or the token is invalid/expired/revoked. */
export function unauthorized(env: AgentEnv, resource: ResourceKind, description?: string, scopes?: readonly string[]): HttpError {
  const hasToken = description !== undefined;
  return new HttpError(
    401,
    'unauthenticated',
    'Sign in required',
    description ?? 'This needs an access token. Discover the authorization server from the resource metadata, then send Authorization: Bearer <token>.',
    { 'www-authenticate': bearerChallenge(env, resource, { ...(hasToken ? { error: 'invalid_token', description } : {}), scopes }) },
    { resourceMetadata: resourceMetadataUrl(env, resource) },
  );
}

/** 403 insufficient_scope listing EVERY scope the operation needs (RFC 6750 §3.1). */
export function insufficientScope(env: AgentEnv, resource: ResourceKind, required: readonly string[], granted: readonly string[] = []): HttpError {
  const missing = required.filter((s) => !granted.includes(s));
  return new HttpError(
    403,
    'insufficient_scope',
    'The token is missing a required scope',
    `This needs the scope(s): ${required.join(' ')}. Ask the person to reconnect the agent with those permissions.`,
    { 'www-authenticate': bearerChallenge(env, resource, { error: 'insufficient_scope', scopes: required, description: `Missing: ${missing.join(' ')}` }) },
    { requiredScopes: [...required], missingScopes: missing },
  );
}

// ---------------------------------------------------------------------------------------------------------
// Token parsing
// ---------------------------------------------------------------------------------------------------------
export function bearerToken(req: Request): string | null {
  const h = req.headers.get('authorization');
  if (!h) return null;
  const m = /^Bearer\s+([A-Za-z0-9._~+/=-]+)\s*$/i.exec(h);
  return m ? m[1]! : '';
}

export function audienceAllows(audience: readonly string[], env: Pick<AgentEnv, 'origin'>, resource: ResourceKind): boolean {
  const aud = audience.filter((a) => a !== REFRESH_AUDIENCE);
  if (!aud.length) return !audience.includes(REFRESH_AUDIENCE);
  const target = resourceUrl(env, resource);
  return aud.some((a) => {
    const v = trimOrigin(a);
    return v === resource || v === target || v === trimOrigin(env.origin);
  });
}

function isExpired(expiresAt: string | null, at: Date): boolean {
  return expiresAt !== null && new Date(expiresAt).getTime() <= at.getTime();
}

function intersect(...lists: readonly (readonly string[] | null | undefined)[]): Scope[] {
  const present = lists.filter((l): l is readonly string[] => Array.isArray(l));
  if (!present.length) return [];
  const [first, ...rest] = present;
  return parseScopes(first!.filter((s) => rest.every((l) => l.includes(s))));
}

// ---------------------------------------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------------------------------------
async function profileOf(db: Database, userId: string): Promise<{ name: string | null; email: string | null } | null> {
  const p = await db.selectFrom('profiles').select(['full_name', 'email']).where('id', '=', userId).executeTakeFirst();
  return p ? { name: p.full_name, email: p.email } : null;
}

async function touch(db: Database, table: 'personal_access_tokens' | 'api_keys' | 'agent_grants', id: string, lastUsed: string | null, at: Date) {
  if (lastUsed && at.getTime() - new Date(lastUsed).getTime() < 60_000) return;
  try {
    await db.updateTable(table).set({ last_used_at: at.toISOString() }).where('id', '=', id).execute();
  } catch {
    // Bookkeeping only; never fail a request because last_used_at could not be written.
  }
}

async function resolveTokenRow(env: AgentEnv, token: string, resource: ResourceKind, prefix: 'gms_pat' | 'gms_oat'): Promise<AgentPrincipal> {
  const db = env.runtime.db;
  const at = now(env);
  const hash = sha256Hex(token);
  const row = await db.selectFrom('personal_access_tokens').selectAll().where('token_hash', '=', hash).executeTakeFirst();
  if (!row || !safeEqual(row.token_hash, hash) || !row.prefix.startsWith(`${prefix}_`)) throw unauthorized(env, resource, 'The access token is not valid.');
  if (row.revoked_at) throw unauthorized(env, resource, 'The access token was revoked.');
  if (isExpired(row.expires_at, at)) throw unauthorized(env, resource, 'The access token expired.');
  if (row.audience.includes(REFRESH_AUDIENCE)) throw unauthorized(env, resource, 'A refresh token cannot be used as an access token.');
  if (row.workspace_id && row.workspace_id !== env.workspace.id) throw unauthorized(env, resource, 'This token belongs to a different foundation.');
  if (!audienceAllows(row.audience, env, resource)) throw unauthorized(env, resource, `This token was issued for a different resource, not ${resourceUrl(env, resource)}.`);

  const client = row.agent_client_id
    ? await db.selectFrom('agent_clients').selectAll().where('id', '=', row.agent_client_id).executeTakeFirst()
    : undefined;
  if (row.agent_client_id && !client) throw unauthorized(env, resource, 'The agent for this token no longer exists.');
  if (client && client.status !== 'active') throw unauthorized(env, resource, `This agent is ${client.status}.`);
  if (client?.workspace_id && client.workspace_id !== env.workspace.id) throw unauthorized(env, resource, 'This agent belongs to a different foundation.');

  let scopes = intersect(row.scopes, client?.scopes ?? row.scopes);
  if (prefix === 'gms_oat') {
    if (!client) throw unauthorized(env, resource, 'The access token is not valid.');
    const grant = await db
      .selectFrom('agent_grants')
      .selectAll()
      .where('client_id', '=', client.id)
      .where('user_id', '=', row.user_id)
      .where('status', '=', 'active')
      .orderBy('created_at', 'desc')
      .executeTakeFirst();
    if (!grant || isExpired(grant.expires_at, at) || (grant.workspace_id && grant.workspace_id !== env.workspace.id)) {
      throw unauthorized(env, resource, 'The person withdrew or paused this agent’s access.');
    }
    scopes = intersect(scopes, grant.scopes);
    await touch(db, 'agent_grants', grant.id, grant.last_used_at, at);
  }
  const person = await profileOf(db, row.user_id);
  if (!person) throw unauthorized(env, resource, 'The person this token acts for no longer exists.');
  await touch(db, 'personal_access_tokens', row.id, row.last_used_at, at);
  return {
    kind: prefix === 'gms_oat' ? 'oauth' : 'pat',
    credentialId: row.id,
    clientId: client?.id ?? null,
    clientRef: client?.client_id ?? null,
    clientName: client?.name ?? row.name,
    userId: row.user_id,
    userName: person.name,
    userEmail: person.email,
    scopes,
    audience: row.audience,
    toolAllowlist: client?.tool_allowlist ?? null,
    rateLimitPerMin: client?.rate_limit_per_min ?? 60,
  };
}

async function resolveApiKey(env: AgentEnv, token: string, resource: ResourceKind): Promise<AgentPrincipal> {
  const db = env.runtime.db;
  const at = now(env);
  const hash = sha256Hex(token);
  const row = await db.selectFrom('api_keys').selectAll().where('key_hash', '=', hash).executeTakeFirst();
  if (!row || !safeEqual(row.key_hash, hash)) throw unauthorized(env, resource, 'The API key is not valid.');
  if (row.revoked_at) throw unauthorized(env, resource, 'The API key was revoked.');
  if (isExpired(row.expires_at, at)) throw unauthorized(env, resource, 'The API key expired.');
  if (row.workspace_id !== env.workspace.id) throw unauthorized(env, resource, 'This key belongs to a different foundation.');
  const isAgentKey = token.startsWith('gms_ak_');
  if (isAgentKey !== Boolean(row.agent_client_id)) throw unauthorized(env, resource, 'The API key is not valid.');
  const client = row.agent_client_id ? await db.selectFrom('agent_clients').selectAll().where('id', '=', row.agent_client_id).executeTakeFirst() : undefined;
  if (row.agent_client_id && (!client || client.kind !== 'agent_account')) throw unauthorized(env, resource, 'The agent account no longer exists.');
  if (client && client.status !== 'active') throw unauthorized(env, resource, `This agent account is ${client.status}.`);
  const ownerId = row.owner_id ?? client?.owner_user_id ?? null;
  if (!ownerId) throw unauthorized(env, resource, 'This key has no owner, so it cannot act for anyone.');
  const person = await profileOf(db, ownerId);
  if (!person) throw unauthorized(env, resource, 'The owner of this key no longer exists.');
  await touch(db, 'api_keys', row.id, row.last_used_at, at);
  return {
    kind: client ? 'agent_account' : 'workspace_key',
    credentialId: row.id,
    clientId: client?.id ?? null,
    clientRef: client?.client_id ?? null,
    clientName: client?.name ?? `${row.name} (API key)`,
    userId: ownerId,
    userName: person.name,
    userEmail: person.email,
    scopes: intersect(row.scopes, client?.scopes ?? row.scopes),
    audience: [],
    toolAllowlist: client?.tool_allowlist ?? null,
    rateLimitPerMin: client?.rate_limit_per_min ?? 60,
  };
}

const jwksCache = new Map<string, JWTVerifyGetKey>();

export function supabaseUrlFor(env: AgentEnv): string | null {
  const url = env.supabaseUrl === undefined ? (process.env.SUPABASE_URL ?? null) : env.supabaseUrl;
  return url ? trimOrigin(url) : null;
}

async function resolveSupabaseJwt(env: AgentEnv, token: string, resource: ResourceKind): Promise<AgentPrincipal> {
  const base = supabaseUrlFor(env);
  if (!base) throw unauthorized(env, resource, 'The access token is not valid.');
  const issuer = `${base}/auth/v1`;
  let jwks = env.supabaseJwks ?? jwksCache.get(issuer);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`), { timeoutDuration: 5000, cooldownDuration: 30_000 });
    jwksCache.set(issuer, jwks);
  }
  let payload: Record<string, unknown>;
  try {
    ({ payload } = await jwtVerify(token, jwks, { issuer, algorithms: ['RS256', 'ES256'], clockTolerance: 30 }));
  } catch {
    throw unauthorized(env, resource, 'The access token is not valid or expired.');
  }
  const sub = typeof payload.sub === 'string' ? payload.sub : null;
  const clientRef = typeof payload.client_id === 'string' ? payload.client_id : null;
  if (!sub || !clientRef) throw unauthorized(env, resource, 'This is not an OAuth access token issued to an agent (no client_id).');
  // RFC 8707: the token must be bound to this resource (or this tenant). Supabase's generic "authenticated"
  // audience is only accepted when the operator explicitly opts in (see agents.md: known gaps).
  const aud = Array.isArray(payload.aud) ? payload.aud.map(String) : typeof payload.aud === 'string' ? [payload.aud] : [];
  const resourceBound = aud.some((a) => a.startsWith('http') && audienceAllows([a], env, resource));
  const genericOk = process.env.GMS_SUPABASE_ALLOW_UNBOUND_AUDIENCE === '1' && aud.includes('authenticated');
  if (!resourceBound && !genericOk) throw unauthorized(env, resource, `This token's audience does not include ${resourceUrl(env, resource)}.`);

  const db = env.runtime.db;
  let client = await db.selectFrom('agent_clients').selectAll().where('client_id', '=', clientRef).executeTakeFirst();
  if (!client) {
    // Mirror the Supabase-registered client so audit rows and approval requests can reference it.
    client = await db
      .insertInto('agent_clients')
      .values({ client_id: clientRef, name: clientRef.slice(0, 100), kind: 'oauth_client', registration: 'supabase', scopes: Object.keys(SCOPES), workspace_id: null })
      .onConflict((oc) => oc.column('client_id').doNothing())
      .returningAll()
      .executeTakeFirst();
    client ??= await db.selectFrom('agent_clients').selectAll().where('client_id', '=', clientRef).executeTakeFirstOrThrow();
  }
  if (client.status !== 'active') throw unauthorized(env, resource, `This agent is ${client.status}.`);
  if (client.workspace_id && client.workspace_id !== env.workspace.id) throw unauthorized(env, resource, 'This agent belongs to a different foundation.');
  const grant = await db
    .selectFrom('agent_grants')
    .selectAll()
    .where('client_id', '=', client.id)
    .where('user_id', '=', sub)
    .orderBy('created_at', 'desc')
    .executeTakeFirst();
  if (grant && grant.status !== 'active') throw unauthorized(env, resource, 'The person withdrew or paused this agent’s access.');
  const person = await profileOf(db, sub);
  if (!person) throw unauthorized(env, resource, 'The person this token acts for does not exist here.');
  const tokenScopes = parseScopes(typeof payload.scope === 'string' ? payload.scope : '');
  return {
    kind: 'supabase',
    credentialId: null,
    clientId: client.id,
    clientRef,
    clientName: client.name,
    userId: sub,
    userName: person.name,
    userEmail: person.email,
    scopes: intersect(tokenScopes, client.scopes, grant?.scopes),
    audience: aud,
    toolAllowlist: client.tool_allowlist,
    rateLimitPerMin: client.rate_limit_per_min,
  };
}

/** Resolves a bearer token to a principal, or throws a 401 HttpError with the resource-metadata challenge. */
export async function resolvePrincipal(env: AgentEnv, token: string, resource: ResourceKind): Promise<AgentPrincipal> {
  if (!token) throw unauthorized(env, resource, 'Malformed Authorization header. Use: Authorization: Bearer <token>.');
  if (token.startsWith('gms_pat_')) return resolveTokenRow(env, token, resource, 'gms_pat');
  if (token.startsWith('gms_oat_')) return resolveTokenRow(env, token, resource, 'gms_oat');
  if (token.startsWith('gms_ak_') || token.startsWith('gms_sk_')) return resolveApiKey(env, token, resource);
  if (/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) return resolveSupabaseJwt(env, token, resource);
  throw unauthorized(env, resource, 'The access token is not valid.');
}

// ---------------------------------------------------------------------------------------------------------
// Contexts
// ---------------------------------------------------------------------------------------------------------
export function anonymousContext(env: AgentEnv, channel: Channel, req?: Request): ActionContext {
  return {
    workspace: env.workspace,
    actor: { type: 'agent', id: null, name: 'Anonymous agent' },
    roles: [],
    scopes: ANON_SCOPES,
    claims: { role: 'anon' },
    aal: 'aal1',
    requestId: env.requestId,
    channel,
    ip: env.ip ?? null,
    userAgent: req?.headers.get('user-agent')?.slice(0, 300) ?? null,
  };
}

export async function contextFor(env: AgentEnv, p: AgentPrincipal, channel: Channel, req?: Request): Promise<ActionContext> {
  const roles = await loadRoles(env.runtime.db, env.workspace.id, p.userId);
  return {
    workspace: env.workspace,
    actor: {
      type: 'agent',
      id: p.clientId,
      name: p.clientName,
      agentClientId: p.clientId,
      onBehalfOf: p.userId,
      onBehalfOfName: p.userName ?? p.userEmail,
    },
    roles,
    scopes: p.scopes,
    claims: {
      role: 'authenticated',
      sub: p.userId,
      ...(p.userEmail ? { email: p.userEmail } : {}),
      aal: 'aal1',
      ...(p.clientRef || p.clientId ? { client_id: p.clientRef ?? p.clientId ?? undefined } : {}),
      scope: p.scopes.join(' '),
    },
    aal: 'aal1',
    requestId: env.requestId,
    channel,
    ip: env.ip ?? null,
    userAgent: req?.headers.get('user-agent')?.slice(0, 300) ?? null,
  };
}

// ---------------------------------------------------------------------------------------------------------
// Rate limiting: sliding-window counter over two fixed one-minute buckets in rate_limit_buckets.
// ---------------------------------------------------------------------------------------------------------
const WINDOW_MS = 60_000;

export async function consumeRateLimit(db: Database, key: string, limit: number, at: Date): Promise<RateInfo & { limited: boolean }> {
  const t = at.getTime();
  const curStart = Math.floor(t / WINDOW_MS) * WINDOW_MS;
  const prevStart = curStart - WINDOW_MS;
  const r = await sql<{ count: number }>`
    insert into public.rate_limit_buckets as b (key, window_start, count)
    values (${`${key}@${curStart}`}, ${new Date(curStart).toISOString()}::timestamptz, 1)
    on conflict (key) do update set count = b.count + 1
    returning b.count`.execute(db);
  const cur = Number(r.rows[0]?.count ?? 1);
  const prev = await db.selectFrom('rate_limit_buckets').select('count').where('key', '=', `${key}@${prevStart}`).executeTakeFirst();
  const weight = 1 - (t - curStart) / WINDOW_MS;
  const used = (prev?.count ?? 0) * weight + cur;
  if (Math.random() < 0.02) {
    await db.deleteFrom('rate_limit_buckets').where('window_start', '<', new Date(t - 10 * WINDOW_MS).toISOString()).where('key', 'like', 'rl:%').execute();
  }
  const resetSeconds = Math.max(1, Math.ceil((curStart + WINDOW_MS - t) / 1000));
  return { limit, remaining: Math.max(0, Math.floor(limit - used)), resetSeconds, policy: `"gms";q=${limit};w=60`, limited: used > limit };
}

export function rateLimitHeaders(r: RateInfo): HeaderMap {
  return { 'ratelimit-policy': r.policy, ratelimit: `"gms";r=${r.remaining};t=${r.resetSeconds}` };
}

async function limitFor(env: AgentEnv, key: string, limit: number): Promise<RateInfo> {
  const r = await consumeRateLimit(env.runtime.db, key, limit, now(env));
  if (r.limited) {
    throw new HttpError(
      429,
      'rate_limited',
      'Too many requests',
      `Slow down: the limit is ${limit} requests per minute. Retry after ${r.resetSeconds} seconds.`,
      { ...rateLimitHeaders(r), 'retry-after': String(r.resetSeconds) },
      { retryAfterSeconds: r.resetSeconds },
    );
  }
  return { limit: r.limit, remaining: r.remaining, resetSeconds: r.resetSeconds, policy: r.policy };
}

export function principalRateKey(p: AgentPrincipal): string {
  if (p.clientId) return `rl:client:${p.clientId}:${p.userId}`;
  return `rl:key:${p.credentialId ?? p.userId}`;
}

/**
 * Authenticates a request for `resource`. Without an Authorization header the caller is anonymous (public tools
 * only) unless `required`; an invalid token is always a 401 (never silently downgraded to anonymous).
 */
export async function authenticate(
  req: Request,
  env: AgentEnv,
  resource: ResourceKind,
  opts: { required?: boolean; channel: Channel },
): Promise<AuthResult> {
  const token = bearerToken(req);
  if (token === null) {
    if (opts.required) throw unauthorized(env, resource);
    const anonLimit = Number(process.env.GMS_ANON_RATE_LIMIT_PER_MIN ?? DEFAULT_ANON_LIMIT) || DEFAULT_ANON_LIMIT;
    const rate = await limitFor(env, `rl:ip:${env.ip ?? 'unknown'}`, anonLimit);
    return { principal: null, ctx: anonymousContext(env, opts.channel, req), rate };
  }
  const principal = await resolvePrincipal(env, token, resource);
  const rate = await limitFor(env, principalRateKey(principal), principal.rateLimitPerMin);
  return { principal, ctx: await contextFor(env, principal, opts.channel, req), rate };
}

/** Kill switches from agent_policies (mcp_enabled / a2a_enabled). */
export async function channelEnabled(env: AgentEnv, channel: 'mcp' | 'a2a'): Promise<boolean> {
  const row = await env.runtime.db
    .selectFrom('agent_policies')
    .select(['mcp_enabled', 'a2a_enabled'])
    .where('workspace_id', '=', env.workspace.id)
    .executeTakeFirst();
  if (!row) return true;
  return channel === 'mcp' ? row.mcp_enabled : row.a2a_enabled;
}

export function channelDisabled(env: AgentEnv, channel: 'mcp' | 'a2a'): HttpError {
  return new HttpError(
    503,
    'unavailable',
    'Service unavailable',
    `${env.brandName} has turned off ${channel === 'mcp' ? 'the MCP server' : 'the A2A endpoint'} for now. People can still use the website.`,
  );
}

/** Scopes that a list of required scopes lacks, for a context. */
export function missingScopes(ctx: Pick<ActionContext, 'scopes'>, required: readonly string[]): string[] {
  if (ctx.scopes === '*') return [];
  const granted = ctx.scopes as readonly string[];
  return required.filter((s) => !granted.includes(s));
}

export { isScope };
