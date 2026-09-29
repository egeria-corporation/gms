// SPDX-License-Identifier: AGPL-3.0-or-later
// Scenario: an MCP client connects through GMS's built-in OAuth 2.1 server (discovery → DCR/CIMD → authorize
// with PKCE + resource → consent → token → MCP), and the protections around it.
import { createHash, randomBytes } from 'node:crypto';
import { completeAuthorization, getPendingAuthorization, handleDiscovery, type AgentEnv } from '@gms/agents';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildAgentWorld, mcpRequest, oauth, ORIGIN, type AgentWorld } from '../src';

let w: AgentWorld;
const REDIRECT = 'http://127.0.0.1:43110/callback';

beforeAll(async () => {
  w = await buildAgentWorld('gms_eval_oauth');
}, 180_000);
afterAll(async () => {
  await w?.t.drop();
});

function pkce() {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

async function authorizeAndConsent(
  env: AgentEnv,
  clientId: string,
  resource: string,
  scope = 'opportunities:read applications:read applications:write',
) {
  const p = pkce();
  const state = randomBytes(8).toString('hex');
  const a = await oauth(env, 'authorize', {
    method: 'GET',
    query: {
      response_type: 'code',
      client_id: clientId,
      redirect_uri: REDIRECT,
      scope,
      state,
      code_challenge: p.challenge,
      code_challenge_method: 'S256',
      resource,
    },
  });
  expect(a.status, JSON.stringify(a.body)).toBe(302);
  const consent = new URL(a.location!);
  expect(consent.pathname).toBe('/oauth/consent');
  const requestId = consent.searchParams.get('request')!;
  const pending = await getPendingAuthorization(env, requestId);
  expect(pending?.scopes.map((s) => s.scope)).toEqual(scope.split(' '));
  const done = await completeAuthorization(env, {
    requestId,
    person: w.humanCtx(w.maya),
    approvedScopes: scope.split(' '),
  });
  const back = new URL(done.redirectUrl);
  expect(back.searchParams.get('state')).toBe(state);
  expect(back.searchParams.get('iss')).toBe(ORIGIN);
  return { code: back.searchParams.get('code')!, ...p };
}

describe('OAuth fallback authorization server', () => {
  it('publishes RFC 9728 and RFC 8414 metadata', async () => {
    const prm = await handleDiscovery(
      new Request(`${ORIGIN}/.well-known/oauth-protected-resource/mcp`),
      w.env(),
    );
    const prmBody = (await prm!.json()) as Record<string, unknown>;
    expect(prmBody.resource).toBe(`${ORIGIN}/mcp`);
    expect(prmBody.authorization_servers).toEqual([ORIGIN]);
    expect(prmBody.bearer_methods_supported).toEqual(['header']);
    const as = (await (await handleDiscovery(
      new Request(`${ORIGIN}/.well-known/oauth-authorization-server`),
      w.env(),
    ))!.json()) as Record<string, unknown>;
    expect(as.issuer).toBe(ORIGIN);
    expect(as.code_challenge_methods_supported).toEqual(['S256']);
    expect(as.client_id_metadata_document_supported).toBe(true);
    expect(as.authorization_response_iss_parameter_supported).toBe(true);
    expect(as.registration_endpoint).toBe(`${ORIGIN}/oauth/register`);
  });

  it('DCR → authorize (PKCE + resource) → consent → token → MCP; wrong verifier and wrong resource fail', async () => {
    const env = w.env();
    const reg = await oauth(env, 'register', {
      method: 'POST',
      json: {
        client_name: 'Desk Research Agent',
        redirect_uris: [REDIRECT],
        token_endpoint_auth_method: 'none',
      },
    });
    expect(reg.status).toBe(201);
    const clientId = String(reg.body!.client_id);

    // A wrong code_verifier fails (and burns the code).
    const bad = await authorizeAndConsent(env, clientId, `${ORIGIN}/mcp`);
    const wrong = await oauth(env, 'token', {
      method: 'POST',
      form: {
        grant_type: 'authorization_code',
        code: bad.code,
        redirect_uri: REDIRECT,
        client_id: clientId,
        code_verifier: pkce().verifier,
      },
    });
    expect(wrong.status).toBe(400);
    expect(wrong.body!.error).toBe('invalid_grant');
    const replay = await oauth(env, 'token', {
      method: 'POST',
      form: {
        grant_type: 'authorization_code',
        code: bad.code,
        redirect_uri: REDIRECT,
        client_id: clientId,
        code_verifier: bad.verifier,
      },
    });
    expect(replay.body!.error).toBe('invalid_grant');

    // The happy path.
    const good = await authorizeAndConsent(env, clientId, `${ORIGIN}/mcp`);
    const tok = await oauth(env, 'token', {
      method: 'POST',
      form: {
        grant_type: 'authorization_code',
        code: good.code,
        redirect_uri: REDIRECT,
        client_id: clientId,
        code_verifier: good.verifier,
        resource: `${ORIGIN}/mcp`,
      },
    });
    expect(tok.status, JSON.stringify(tok.body)).toBe(200);
    expect(tok.res.headers.get('cache-control')).toBe('no-store');
    const access = String(tok.body!.access_token);
    expect(access.startsWith('gms_oat_')).toBe(true);
    expect(tok.body!.token_type).toBe('Bearer');

    const consent = await w.t.db
      .selectFrom('audit_log')
      .select(['actor_type', 'actor_id', 'action'])
      .where('action', '=', 'oauth.grant_consent')
      .where('actor_id', '=', w.maya.id)
      .execute();
    expect(consent.length).toBeGreaterThan(0);
    expect(consent[0]!.actor_type).toBe('human');

    const tools = await mcpRequest<{ tools: { name: string }[] }>(w.env(), 'tools/list', {}, access);
    expect(tools.status).toBe(200);
    const names = tools.body!.result!.tools.map((t) => t.name);
    expect(names).toContain('start_application');
    expect(names).not.toContain('request_submission'); // applications:submit was not granted
    const status = await mcpRequest<{ isError?: boolean }>(
      w.env(),
      'tools/call',
      { name: 'get_status', arguments: {} },
      access,
    );
    expect(status.body!.result!.isError).toBeFalsy();

    // Refresh rotates; reusing the old refresh token revokes everything.
    const refreshed = await oauth(env, 'token', {
      method: 'POST',
      form: {
        grant_type: 'refresh_token',
        refresh_token: String(tok.body!.refresh_token),
        client_id: clientId,
      },
    });
    expect(refreshed.status).toBe(200);
    const reuse = await oauth(env, 'token', {
      method: 'POST',
      form: {
        grant_type: 'refresh_token',
        refresh_token: String(tok.body!.refresh_token),
        client_id: clientId,
      },
    });
    expect(reuse.body!.error).toBe('invalid_grant');
    const afterReuse = await mcpRequest(w.env(), 'tools/list', {}, String(refreshed.body!.access_token));
    expect(afterReuse.status).toBe(401);

    // A token issued for /a2a is rejected at /mcp.
    const a2a = await authorizeAndConsent(env, clientId, `${ORIGIN}/a2a`);
    const a2aTok = await oauth(env, 'token', {
      method: 'POST',
      form: {
        grant_type: 'authorization_code',
        code: a2a.code,
        redirect_uri: REDIRECT,
        client_id: clientId,
        code_verifier: a2a.verifier,
      },
    });
    expect(a2aTok.status).toBe(200);
    const atMcp = await mcpRequest(w.env(), 'tools/list', {}, String(a2aTok.body!.access_token));
    expect(atMcp.status).toBe(401);
    expect(atMcp.res.headers.get('www-authenticate')).toContain('error="invalid_token"');
  });

  it('refuses unknown scopes, missing PKCE, missing resource and unregistered redirect URIs', async () => {
    const env = w.env();
    const reg = await oauth(env, 'register', {
      method: 'POST',
      json: { client_name: 'Strict test', redirect_uris: [REDIRECT] },
    });
    const clientId = String(reg.body!.client_id);
    const p = pkce();
    const base = {
      response_type: 'code',
      client_id: clientId,
      redirect_uri: REDIRECT,
      code_challenge: p.challenge,
      code_challenge_method: 'S256',
      resource: `${ORIGIN}/mcp`,
      state: 's',
    };
    const r3 = await oauth(env, 'authorize', {
      method: 'GET',
      query: { ...base, scope: 'payments:approve' },
    });
    expect(new URL(r3.location!).searchParams.get('error')).toBe('invalid_scope');
    const plain = await oauth(env, 'authorize', {
      method: 'GET',
      query: { ...base, scope: 'opportunities:read', code_challenge_method: 'plain' },
    });
    expect(new URL(plain.location!).searchParams.get('error')).toBe('invalid_request');
    const { resource: _r, ...noResource } = base;
    const nr = await oauth(env, 'authorize', {
      method: 'GET',
      query: { ...noResource, scope: 'opportunities:read' },
    });
    expect(new URL(nr.location!).searchParams.get('error')).toBe('invalid_target');
    const evil = await oauth(env, 'authorize', {
      method: 'GET',
      query: { ...base, redirect_uri: 'https://evil.example/cb', scope: 'opportunities:read' },
    });
    expect(evil.status).toBe(400);
    expect(evil.location).toBeNull();
  });

  it('accepts a Client ID Metadata Document client and refuses private-network client_id URLs', async () => {
    const cimdUrl = 'https://agent.example/oauth/client.json';
    const env = w.env({
      fetchClientMetadata: async (url) => ({
        client_id: url,
        client_name: 'Example Agent',
        redirect_uris: [REDIRECT],
        token_endpoint_auth_method: 'none',
        scope: 'opportunities:read applications:read',
      }),
    });
    const flow = await authorizeAndConsent(
      env,
      cimdUrl,
      `${ORIGIN}/api/v1`,
      'opportunities:read applications:read',
    );
    const tok = await oauth(env, 'token', {
      method: 'POST',
      form: {
        grant_type: 'authorization_code',
        code: flow.code,
        redirect_uri: REDIRECT,
        client_id: cimdUrl,
        code_verifier: flow.verifier,
      },
    });
    expect(tok.status).toBe(200);
    const row = await w.t.db
      .selectFrom('agent_clients')
      .select(['registration', 'name', 'workspace_id'])
      .where('client_id', '=', cimdUrl)
      .executeTakeFirstOrThrow();
    expect(row).toEqual({ registration: 'cimd', name: 'Example Agent', workspace_id: null });

    const ssrf = await oauth(w.env(), 'authorize', {
      method: 'GET',
      query: { response_type: 'code', client_id: 'https://127.0.0.1/client.json', redirect_uri: REDIRECT },
    });
    expect(ssrf.status).toBe(400);
    expect(ssrf.body!.error).toBe('invalid_client');
  });
});
