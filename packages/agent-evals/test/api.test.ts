// SPDX-License-Identifier: AGPL-3.0-or-later
// Scenario: the Platform API (/api/v1) — REST aliases, problem+json, idempotency, ETags, 202 approvals.
import { LOI_VALID_RESPONSE } from '@gms/forms';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { api, buildAgentWorld, ORIGIN, type AgentWorld } from '../src';

let w: AgentWorld;

beforeAll(async () => {
  w = await buildAgentWorld('gms_eval_api');
}, 180_000);
afterAll(async () => {
  await w?.t.drop();
});

describe('/api/v1', () => {
  it('serves OpenAPI 3.1 and Arazzo', async () => {
    const o = await api(w.env(), 'GET', '/openapi.json');
    expect(o.status).toBe(200);
    expect(o.body.openapi).toBe('3.1.0');
    const a = await handleText('/workflows.arazzo.yaml');
    expect((parse(a) as { arazzo: string }).arazzo).toMatch(/^1\.0/);
  });

  it('answers public reads anonymously and returns problem+json for errors', async () => {
    const list = await api(w.env(), 'GET', '/opportunities?q=youth');
    expect(list.status).toBe(200);
    expect(list.res.headers.get('ratelimit')).toMatch(/^"gms";r=\d+;t=\d+$/);
    expect((list.body.opportunities as { slug: string }[])[0]!.slug).toBe('youth-arts-fund');
    const bySlug = await api(w.env(), 'GET', '/opportunities/youth-arts-fund');
    expect(bySlug.body.id).toBe(w.ids.opportunity);
    const missing = await api(w.env(), 'GET', '/nope');
    expect(missing.status).toBe(404);
    expect(missing.res.headers.get('content-type')).toContain('application/problem+json');
    expect(missing.body).toMatchObject({
      status: 404,
      code: 'not_found',
      type: expect.any(String),
      title: expect.any(String),
    });
    const anonApps = await api(w.env(), 'GET', '/applications');
    expect(anonApps.status).toBe(401);
    expect(anonApps.res.headers.get('www-authenticate')).toContain(
      `resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/api/v1"`,
    );
  });

  it('replays Idempotency-Key, enforces If-Match with form etags, and returns 202 for submissions', async () => {
    const token = w.tokens.grantWriterPat;
    const headers = { 'idempotency-key': 'start-riverbend-1' };
    const s1 = await api(w.env(), 'POST', '/applications', {
      token,
      body: { competitionId: w.ids.competition, applicantOrgId: w.ids.org },
      headers,
    });
    expect(s1.status, JSON.stringify(s1.body)).toBe(200);
    const s2 = await api(w.env(), 'POST', '/applications', {
      token,
      body: { competitionId: w.ids.competition, applicantOrgId: w.ids.org },
      headers,
    });
    expect(s2.body.applicationId).toBe(s1.body.applicationId);
    const mismatch = await api(w.env(), 'POST', '/applications', {
      token,
      body: { competitionId: w.ids.competition },
      headers,
    });
    expect(mismatch.status).toBe(422);
    expect(mismatch.body.code).toBe('idempotency_mismatch');
    const applicationId = String(s1.body.applicationId);

    const view = await api(w.env(), 'GET', `/applications/${applicationId}`, { token });
    expect(view.status).toBe(200);
    const appEtag = view.res.headers.get('etag')!;
    expect(appEtag).toMatch(/^"[0-9a-f]{32}"$/);
    const notModified = await api(w.env(), 'GET', `/applications/${applicationId}`, {
      token,
      headers: { 'if-none-match': appEtag },
    });
    expect(notModified.status).toBe(304);

    const path = `/applications/${applicationId}/forms/${w.ids.form}`;
    const stale = await api(w.env(), 'PATCH', path, {
      token,
      body: { answers: { project_title: 'x' } },
      headers: { 'if-match': '"999"' },
    });
    expect(stale.status).toBe(412);
    expect(stale.body.code).toBe('precondition_failed');
    const saved = await api(w.env(), 'PATCH', path, {
      token,
      body: { answers: LOI_VALID_RESPONSE },
      headers: { 'if-match': '"0"' },
    });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.res.headers.get('etag')).toBe(`"${String(saved.body.etag)}"`);

    const submit = await api(w.env(), 'POST', `/applications/${applicationId}/submit`, {
      token,
      body: {
        attestation: { typedName: 'Maya Chen', agreed: true },
        aiDisclosure: 'Drafted with an assistant.',
      },
    });
    expect(submit.status).toBe(202);
    expect(submit.body.status).toBe('approval_required');
    expect(submit.res.headers.get('location')).toBe(
      `${ORIGIN}/api/v1/approval-requests/${String(submit.body.approvalRequestId)}`,
    );
    const poll = await api(w.env(), 'GET', `/approval-requests/${String(submit.body.approvalRequestId)}`, {
      token,
    });
    expect(poll.body.status).toBe('awaiting_confirmation');
  });

  it('refuses scope-less and system actions with clear problems', async () => {
    const token = w.tokens.grantWriterPat;
    const ui = await api(w.env(), 'POST', '/actions/brand.update', { token, body: {} });
    expect(ui.status).toBe(403);
    const r3 = await api(w.env(), 'POST', '/actions/agreements.sign', { token, body: {} });
    expect(r3.body.code).toBe('human_only');
    const role = await api(w.env(), 'POST', '/actions/payments.propose_batch', { token, body: {} });
    expect(role.status).toBe(403);
    expect(role.body.code).toBe('forbidden');

    const readOnly = await w.runtime.executor.run<{ token: string }>(
      'agents.create_token',
      {
        agentName: 'Read-only helper',
        scopes: ['opportunities:read', 'applications:read'],
        expiresInDays: 1,
      },
      w.humanCtx(w.maya),
    );
    const scope = await api(w.env(), 'POST', '/actions/applications.start', {
      token: readOnly.token,
      body: { competitionId: w.ids.competition },
    });
    expect(scope.status).toBe(403);
    expect(scope.body.code).toBe('insufficient_scope');
    expect(scope.res.headers.get('www-authenticate')).toContain('error="insufficient_scope"');
    expect(scope.res.headers.get('www-authenticate')).toContain('scope="applications:write"');
  });
});

async function handleText(path: string): Promise<string> {
  const { handleApiV1 } = await import('@gms/agents');
  const res = await handleApiV1(new Request(`${ORIGIN}/api/v1${path}`), w.env());
  return res.text();
}
