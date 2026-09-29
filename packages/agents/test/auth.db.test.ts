// SPDX-License-Identifier: AGPL-3.0-or-later
import { createHash } from 'node:crypto';
import { exportJWK, generateKeyPair, SignJWT, createLocalJWKSet } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { authenticate, resolvePrincipal, type AgentEnv } from '../src';
import { HttpError } from '../src/env';
import { ORIGIN, setup, type Setup } from './helpers';

let s: Setup;
let pat: { token: string; clientId: string; tokenId: string };
let agentKey: { clientId: string; key: string };

const sha = (v: string) => createHash('sha256').update(v).digest('hex');

async function expect401(p: Promise<unknown>, match?: RegExp): Promise<HttpError> {
  try {
    await p;
  } catch (err) {
    expect(err).toBeInstanceOf(HttpError);
    const e = err as HttpError;
    expect(e.status).toBe(401);
    expect(e.headers['www-authenticate']).toContain('resource_metadata="');
    if (match) expect(e.message).toMatch(match);
    return e;
  }
  throw new Error('expected a 401');
}

async function insertToken(opts: {
  prefix: string;
  userId: string;
  workspaceId?: string | null;
  clientId?: string | null;
  scopes?: string[];
  audience?: string[];
  expiresAt?: string | null;
  revokedAt?: string | null;
}) {
  const token = `${opts.prefix}_${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
  await s.t.db
    .insertInto('personal_access_tokens')
    .values({
      user_id: opts.userId,
      workspace_id: opts.workspaceId ?? null,
      agent_client_id: opts.clientId ?? null,
      name: 'test',
      prefix: token.slice(0, opts.prefix.length + 7),
      token_hash: sha(token),
      scopes: opts.scopes ?? ['opportunities:read', 'applications:read'],
      audience: opts.audience ?? [],
      expires_at: opts.expiresAt ?? null,
      revoked_at: opts.revokedAt ?? null,
    })
    .execute();
  return token;
}

beforeAll(async () => {
  s = await setup('gms_agents_auth');
  pat = await s.runtime.executor.run(
    'agents.create_token',
    {
      agentName: 'Grant Writer Assistant',
      scopes: ['opportunities:read', 'applications:read', 'applications:write'],
      expiresInDays: 30,
      workspaceBound: true,
    },
    s.human(s.applicant, s.wsA),
  );
  agentKey = await s.runtime.executor.run(
    'agents.create_account',
    {
      name: 'Ops Assistant',
      ownerUserId: s.owner.id,
      scopes: ['pipeline:read', 'payments:read', 'payments:propose'],
      rateLimitPerMin: 60,
    },
    s.human(s.owner, s.wsA, ['owner'], { aal: 'aal2', stepUpAt: new Date().toISOString() }),
  );
}, 120_000);
afterAll(async () => {
  await s?.t.drop();
});

describe('bearer token resolution', () => {
  it('resolves a PAT to an agent acting for the person, with RLS claims as the person', async () => {
    const p = await resolvePrincipal(s.env(), pat.token, 'mcp');
    expect(p.kind).toBe('pat');
    expect(p.clientName).toBe('Grant Writer Assistant');
    expect(p.userId).toBe(s.applicant.id);
    expect(p.scopes.sort()).toEqual(['applications:read', 'applications:write', 'opportunities:read']);
    const r = await authenticate(
      new Request(`${ORIGIN}/mcp`, { headers: { authorization: `Bearer ${pat.token}` } }),
      s.env(),
      'mcp',
      { channel: 'mcp' },
    );
    expect(r.ctx.actor).toMatchObject({
      type: 'agent',
      name: 'Grant Writer Assistant',
      agentClientId: pat.clientId,
      onBehalfOf: s.applicant.id,
      onBehalfOfName: 'Maya Chen',
    });
    expect(r.ctx.claims).toMatchObject({
      role: 'authenticated',
      sub: s.applicant.id,
      client_id: expect.any(String),
    });
    expect(r.ctx.claims.scope).toContain('applications:write');
    const row = await s.t.db
      .selectFrom('personal_access_tokens')
      .select('last_used_at')
      .where('id', '=', pat.tokenId)
      .executeTakeFirstOrThrow();
    expect(row.last_used_at).not.toBeNull();
  });

  it('binds workspace-bound tokens to their workspace', async () => {
    await expect401(resolvePrincipal(s.env(s.wsB), pat.token, 'mcp'), /different foundation/);
  });

  it('intersects token scopes with the client’s scopes', async () => {
    await s.t.db
      .updateTable('agent_clients')
      .set({ scopes: ['opportunities:read'] })
      .where('id', '=', pat.clientId)
      .execute();
    try {
      const p = await resolvePrincipal(s.env(), pat.token, 'mcp');
      expect(p.scopes).toEqual(['opportunities:read']);
    } finally {
      await s.t.db
        .updateTable('agent_clients')
        .set({ scopes: ['opportunities:read', 'applications:read', 'applications:write'] })
        .where('id', '=', pat.clientId)
        .execute();
    }
  });

  it('rejects paused clients, revoked and expired tokens, and unknown tokens', async () => {
    await s.t.db
      .updateTable('agent_clients')
      .set({ status: 'paused' })
      .where('id', '=', pat.clientId)
      .execute();
    await expect401(resolvePrincipal(s.env(), pat.token, 'mcp'), /paused/);
    await s.t.db
      .updateTable('agent_clients')
      .set({ status: 'active' })
      .where('id', '=', pat.clientId)
      .execute();

    const expired = await insertToken({
      prefix: 'gms_pat',
      userId: s.applicant.id,
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    await expect401(resolvePrincipal(s.env(), expired, 'mcp'), /expired/);
    const revoked = await insertToken({
      prefix: 'gms_pat',
      userId: s.applicant.id,
      revokedAt: new Date().toISOString(),
    });
    await expect401(resolvePrincipal(s.env(), revoked, 'mcp'), /revoked/);
    const e = await expect401(resolvePrincipal(s.env(), 'gms_pat_nope', 'mcp'));
    expect(e.headers['www-authenticate']).toContain('error="invalid_token"');
    await expect401(resolvePrincipal(s.env(), 'something-else', 'mcp'));
  });

  it('checks the audience (RFC 8707 resource) of tokens', async () => {
    const mcpOnly = await insertToken({ prefix: 'gms_pat', userId: s.applicant.id, audience: ['mcp'] });
    await expect(resolvePrincipal(s.env(), mcpOnly, 'mcp')).resolves.toMatchObject({ kind: 'pat' });
    await expect401(resolvePrincipal(s.env(), mcpOnly, 'a2a'), /different resource/);
    const full = await insertToken({
      prefix: 'gms_pat',
      userId: s.applicant.id,
      audience: [`${ORIGIN}/api/v1`],
    });
    await expect(resolvePrincipal(s.env(), full, 'api')).resolves.toBeTruthy();
    await expect401(resolvePrincipal(s.env(), full, 'mcp'));
    const tenantWide = await insertToken({ prefix: 'gms_pat', userId: s.applicant.id, audience: [ORIGIN] });
    await expect(resolvePrincipal(s.env(), tenantWide, 'a2a')).resolves.toBeTruthy();
    const refresh = await insertToken({
      prefix: 'gms_pat',
      userId: s.applicant.id,
      audience: ['urn:gms:oauth:refresh', `${ORIGIN}/mcp`],
    });
    await expect401(resolvePrincipal(s.env(), refresh, 'mcp'));
  });

  it('requires an active consent grant for OAuth access tokens', async () => {
    const client = await s.t.db
      .insertInto('agent_clients')
      .values({
        client_id: 'dcr_test',
        name: 'OAuth Agent',
        kind: 'oauth_client',
        registration: 'dcr',
        workspace_id: s.wsA.id,
        scopes: ['opportunities:read', 'applications:read'],
        redirect_uris: ['https://agent.example/cb'],
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const oat = await insertToken({
      prefix: 'gms_oat',
      userId: s.applicant.id,
      workspaceId: s.wsA.id,
      clientId: client.id,
      audience: [`${ORIGIN}/mcp`],
    });
    await expect401(resolvePrincipal(s.env(), oat, 'mcp'), /withdrew/);
    const grant = await s.t.db
      .insertInto('agent_grants')
      .values({
        client_id: client.id,
        user_id: s.applicant.id,
        workspace_id: s.wsA.id,
        scopes: ['opportunities:read'],
        status: 'active',
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const p = await resolvePrincipal(s.env(), oat, 'mcp');
    expect(p.kind).toBe('oauth');
    expect(p.scopes).toEqual(['opportunities:read']); // token ∩ client ∩ grant
    await s.t.db.updateTable('agent_grants').set({ status: 'revoked' }).where('id', '=', grant.id).execute();
    await expect401(resolvePrincipal(s.env(), oat, 'mcp'));
    // A PAT-prefixed lookup of an OAuth token row is refused (prefix and row must agree).
    await expect401(resolvePrincipal(s.env(), oat.replace('gms_oat_', 'gms_pat_'), 'mcp'));
  });

  it('resolves agent-account keys and workspace keys to agents acting for the owner', async () => {
    const p = await resolvePrincipal(s.env(), agentKey.key, 'api');
    expect(p).toMatchObject({ kind: 'agent_account', clientName: 'Ops Assistant', userId: s.owner.id });
    const r = await authenticate(
      new Request(`${ORIGIN}/api/v1`, { headers: { authorization: `Bearer ${agentKey.key}` } }),
      s.env(),
      'api',
      { channel: 'api' },
    );
    expect(r.ctx.roles).toEqual(['owner']);
    expect(r.ctx.actor.type).toBe('agent');
    await expect401(resolvePrincipal(s.env(s.wsB), agentKey.key, 'api'), /different foundation/);

    const sk = `gms_sk_${'x'.repeat(40)}`;
    await s.t.db
      .insertInto('api_keys')
      .values({
        workspace_id: s.wsA.id,
        name: 'CI',
        prefix: sk.slice(0, 13),
        key_hash: sha(sk),
        scopes: ['pipeline:read'],
        owner_id: s.owner.id,
      })
      .execute();
    const k = await resolvePrincipal(s.env(), sk, 'api');
    expect(k).toMatchObject({
      kind: 'workspace_key',
      clientId: null,
      clientName: 'CI (API key)',
      userId: s.owner.id,
      scopes: ['pipeline:read'],
    });
    // A workspace key must not masquerade as an agent-account key (or vice versa).
    await expect401(resolvePrincipal(s.env(), sk.replace('gms_sk_', 'gms_ak_'), 'api'));
  });

  it('verifies Supabase OAuth 2.1 JWTs (issuer, signature, client_id, resource-bound audience)', async () => {
    const { publicKey, privateKey } = await generateKeyPair('ES256');
    const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'ES256' };
    const supa = 'https://proj.supabase.example';
    const env: AgentEnv = s.env(s.wsA, {
      supabaseUrl: supa,
      supabaseJwks: createLocalJWKSet({ keys: [jwk] }),
    });
    const sign = (claims: Record<string, unknown>, iss = `${supa}/auth/v1`) =>
      new SignJWT(claims)
        .setProtectedHeader({ alg: 'ES256', kid: 'k1' })
        .setIssuer(iss)
        .setSubject(s.applicant.id)
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(privateKey);
    const good = await sign({
      client_id: 'supa-client-1',
      aud: [`${ORIGIN}/mcp`],
      scope: 'opportunities:read applications:read payments:approve',
    });
    const p = await resolvePrincipal(env, good, 'mcp');
    expect(p.kind).toBe('supabase');
    expect(p.userId).toBe(s.applicant.id);
    expect(p.scopes.sort()).toEqual(['applications:read', 'opportunities:read']);
    await expect401(
      resolvePrincipal(env, await sign({ client_id: 'supa-client-1', aud: ['authenticated'] }), 'mcp'),
      /audience/,
    );
    await expect401(resolvePrincipal(env, await sign({ aud: [`${ORIGIN}/mcp`] }), 'mcp'), /client_id/);
    await expect401(
      resolvePrincipal(
        env,
        await sign({ client_id: 'x', aud: [`${ORIGIN}/mcp`] }, 'https://evil.example/auth/v1'),
        'mcp',
      ),
    );
    await expect401(resolvePrincipal(env, await sign({ client_id: 'x', aud: [`${ORIGIN}/a2a`] }), 'mcp'));
  });
});

describe('rate limiting', () => {
  it('limits per client and returns RateLimit headers and Retry-After', async () => {
    const fresh = await s.runtime.executor.run<{ token: string; clientId: string }>(
      'agents.create_token',
      {
        agentName: 'Rate Test Agent',
        scopes: ['opportunities:read'],
        expiresInDays: 1,
        workspaceBound: true,
      },
      s.human(s.applicant, s.wsA),
    );
    await s.t.db
      .updateTable('agent_clients')
      .set({ rate_limit_per_min: 2 })
      .where('id', '=', fresh.clientId)
      .execute();
    const req = () => new Request(`${ORIGIN}/mcp`, { headers: { authorization: `Bearer ${fresh.token}` } });
    const first = await authenticate(req(), s.env(), 'mcp', { channel: 'mcp' });
    expect(first.rate.limit).toBe(2);
    expect(first.rate.policy).toBe('"gms";q=2;w=60');
    await authenticate(req(), s.env(), 'mcp', { channel: 'mcp' });
    try {
      await authenticate(req(), s.env(), 'mcp', { channel: 'mcp' });
      throw new Error('expected 429');
    } catch (err) {
      const e = err as HttpError;
      expect(e.status).toBe(429);
      expect(Number(e.headers['retry-after'])).toBeGreaterThan(0);
      expect(e.headers.ratelimit).toMatch(/^"gms";r=0;t=\d+$/);
      expect(e.headers['ratelimit-policy']).toBe('"gms";q=2;w=60');
    }
    // Other agents are unaffected.
    await expect(
      authenticate(
        new Request(`${ORIGIN}/mcp`, { headers: { authorization: `Bearer ${pat.token}` } }),
        s.env(),
        'mcp',
        { channel: 'mcp' },
      ),
    ).resolves.toBeTruthy();
  });

  it('limits anonymous callers per IP', async () => {
    const prev = process.env.GMS_ANON_RATE_LIMIT_PER_MIN;
    process.env.GMS_ANON_RATE_LIMIT_PER_MIN = '1';
    try {
      const env = s.env(s.wsA, { ip: '192.0.2.44' });
      const ok = await authenticate(new Request(`${ORIGIN}/mcp`), env, 'mcp', { channel: 'mcp' });
      expect(ok.principal).toBeNull();
      expect(ok.ctx.claims.role).toBe('anon');
      await expect(
        authenticate(new Request(`${ORIGIN}/mcp`), env, 'mcp', { channel: 'mcp' }),
      ).rejects.toMatchObject({ status: 429 });
      // Another IP is unaffected.
      await expect(
        authenticate(new Request(`${ORIGIN}/mcp`), s.env(s.wsA, { ip: '192.0.2.45' }), 'mcp', {
          channel: 'mcp',
        }),
      ).resolves.toBeTruthy();
    } finally {
      if (prev === undefined) delete process.env.GMS_ANON_RATE_LIMIT_PER_MIN;
      else process.env.GMS_ANON_RATE_LIMIT_PER_MIN = prev;
    }
  });

  it('401s a required-auth request without a token, with the challenge', async () => {
    await expect(
      authenticate(new Request(`${ORIGIN}/api/v1`), s.env(), 'api', { channel: 'api', required: true }),
    ).rejects.toMatchObject({
      status: 401,
      headers: {
        'www-authenticate': `Bearer resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/api/v1"`,
      },
    });
  });
});
