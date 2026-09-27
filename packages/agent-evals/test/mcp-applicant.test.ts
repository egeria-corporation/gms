// SPDX-License-Identifier: AGPL-3.0-only
// Scenario: "Grant Writer Assistant" (a PAT Maya created) prepares and asks to submit her application over MCP.
import { decideApproval } from '@gms/actions';
import { createAjv, LOI_VALID_RESPONSE } from '@gms/forms';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildAgentWorld, callTool, mcpRequest, ORIGIN, type AgentWorld } from '../src';

let w: AgentWorld;

beforeAll(async () => {
  w = await buildAgentWorld('gms_eval_mcp');
}, 180_000);
afterAll(async () => {
  await w?.t.drop();
});

const APPLICANT_TOOLS = [
  'search_opportunities',
  'get_opportunity',
  'check_eligibility',
  'get_application_form',
  'start_application',
  'save_answers',
  'validate_application',
  'upload_attachment',
  'request_submission',
  'get_status',
  'list_requests',
  'submit_report',
  'get_payment_status',
];
const STAFF_TOOLS = [
  'query_pipeline',
  'get_application',
  'screen_eligibility',
  'assign_reviewers',
  'get_review_progress',
  'draft_message',
  'send_message',
  'draft_award',
  'propose_payment_batch',
  'list_overdue_reports',
  'search_grantees',
  'run_report',
  'get_portfolio_metrics',
  'get_approval_requests',
];

interface ToolInfo {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  _meta?: Record<string, unknown>;
}

describe('MCP: applicant agent', () => {
  it('initializes statelessly (no session id) and negotiates 2026-07-28', async () => {
    const r = await mcpRequest<{ protocolVersion: string; serverInfo: { name: string } }>(
      w.env(),
      'initialize',
      {
        protocolVersion: '2026-07-28',
        capabilities: {},
        clientInfo: { name: 'eval', version: '1.0.0' },
      },
    );
    expect(r.status).toBe(200);
    expect(r.body?.result?.protocolVersion).toBe('2026-07-28');
    expect(r.res.headers.get('mcp-session-id')).toBeNull();
    const older = await mcpRequest<{ protocolVersion: string }>(w.env(), 'initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'eval', version: '1' },
    });
    expect(older.body?.result?.protocolVersion).toBe('2025-06-18');
  });

  it('lists only the public tools to anonymous callers', async () => {
    const r = await mcpRequest<{ tools: ToolInfo[] }>(w.env(), 'tools/list');
    expect(r.body?.result?.tools.map((t) => t.name).sort()).toEqual([
      'check_eligibility',
      'get_opportunity',
      'search_opportunities',
    ]);
  });

  it('challenges anonymous calls to authenticated tools with the resource metadata URL', async () => {
    const r = await callTool(w.env(), 'get_status', {});
    expect(r.status).toBe(401);
    expect(r.res.headers.get('www-authenticate')).toContain(
      `resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/mcp"`,
    );
  });

  it('rejects an invalid token with 401 invalid_token (never downgrades to anonymous)', async () => {
    const r = await mcpRequest(w.env(), 'tools/list', {}, 'gms_pat_not-a-real-token');
    expect(r.status).toBe(401);
    expect(r.res.headers.get('www-authenticate')).toContain('error="invalid_token"');
  });

  it('gives the applicant token the applicant tools only, with good descriptions and valid schemas', async () => {
    const r = await mcpRequest<{ tools: ToolInfo[] }>(w.env(), 'tools/list', {}, w.tokens.grantWriterPat);
    expect(r.status).toBe(200);
    expect(r.res.headers.get('ratelimit-policy')).toContain('q=60');
    const tools = r.body!.result!.tools;
    const names = tools.map((t) => t.name);
    for (const t of APPLICANT_TOOLS) expect(names, t).toContain(t);
    for (const t of STAFF_TOOLS) expect(names, t).not.toContain(t);
    const ajv = createAjv();
    for (const t of tools) {
      expect(t.description.length, `${t.name} description`).toBeGreaterThanOrEqual(40);
      expect(t.inputSchema.type, t.name).toBe('object');
      expect(ajv.validateSchema(t.inputSchema), `${t.name} inputSchema: ${JSON.stringify(ajv.errors)}`).toBe(
        true,
      );
      expect(() => ajv.compile(t.inputSchema), t.name).not.toThrow();
      if (t.outputSchema) expect(() => ajv.compile(t.outputSchema!), `${t.name} outputSchema`).not.toThrow();
      expect(t._meta?.['gms/riskTier']).not.toBe('R3');
    }
  });

  it('runs the whole application flow; submission waits for Maya to confirm', async () => {
    const env = () => w.env();
    const token = w.tokens.grantWriterPat;

    const search = await callTool(env(), 'search_opportunities', { query: 'youth arts' }, token);
    expect(search.isError).toBe(false);
    const opps = search.structured!.opportunities as { id: string; closesAtLocal: string }[];
    expect(opps[0]!.id).toBe(w.ids.opportunity);
    expect(opps[0]!.closesAtLocal).toMatch(/P[SD]T/);

    const form = await callTool(env(), 'get_application_form', { opportunityId: w.ids.opportunity }, token);
    expect(form.isError).toBe(false);
    const f0 = (
      form.structured!.forms as {
        formId: string;
        jsonSchema: unknown;
        fields: { id: string; maxWords?: number; commonGrants?: { path: string } }[];
      }[]
    )[0]!;
    expect(f0.formId).toBe(w.ids.form);
    expect(f0.fields.find((f) => f.id === 'org_ein')?.commonGrants?.path).toBe('organization.ein');
    expect(f0.fields.some((f) => typeof f.maxWords === 'number')).toBe(true);

    const started = await callTool(
      env(),
      'start_application',
      { competitionId: w.ids.competition, applicantOrgId: w.ids.org },
      token,
    );
    expect(started.isError, started.text).toBe(false);
    const applicationId = (started.structured!.result as { applicationId: string }).applicationId;

    const current = await callTool(env(), 'get_application_form', { applicationId }, token);
    const etag = (current.structured!.forms as { etag: string }[])[0]!.etag;

    // A bad EIN comes back as a JSON Pointer error with a fix-it hint.
    const bad = await callTool(
      env(),
      'save_answers',
      { applicationId, formId: w.ids.form, etag, answers: { ...LOI_VALID_RESPONSE, org_ein: '84-12' } },
      token,
    );
    expect(bad.isError).toBe(false);
    const badResult = bad.structured!.result as {
      etag: string;
      errors: { pointer: string; message: string; hint: string }[];
    };
    const einError = badResult.errors.find((e) => e.pointer === '/org_ein');
    expect(einError?.message).toMatch(/12-3456789/);
    expect(einError?.hint).toMatch(/save_answers/);
    expect(bad.text).toContain('/org_ein');

    const good = await callTool(
      env(),
      'save_answers',
      { applicationId, formId: w.ids.form, etag: badResult.etag, answers: { org_ein: '84-1234567' } },
      token,
    );
    expect((good.structured!.result as { errors: unknown[] }).errors).toEqual([]);

    const valid = await callTool(env(), 'validate_application', { applicationId }, token);
    expect(valid.isError, valid.text).toBe(false);
    expect(
      (valid.structured!.result as { ready: boolean; errors: unknown[] }).ready,
      JSON.stringify(valid.structured),
    ).toBe(true);

    const submit = await callTool(
      env(),
      'request_submission',
      {
        applicationId,
        attestation: { typedName: 'Maya Chen', agreed: true },
        aiDisclosure: 'Drafted with Grant Writer Assistant; Maya reviewed every answer.',
      },
      token,
    );
    expect(submit.isError, submit.text).toBe(false);
    expect(submit.structured!.status).toBe('approval_required');
    const confirmUrl = String(submit.structured!.confirmUrl);
    expect(confirmUrl).toContain(`${ORIGIN}/portal/confirm/`);
    expect(submit.text).toContain(confirmUrl.split('?')[0]!);

    // Nothing was submitted yet.
    const before = await w.t.db
      .selectFrom('applications')
      .select('status')
      .where('id', '=', applicationId)
      .executeTakeFirstOrThrow();
    expect(before.status).toBe('in_progress');
    const pending = await callTool(env(), 'list_requests', {}, token);
    expect(
      (pending.structured!.confirmations as { approvalRequestId: string }[]).map((c) => c.approvalRequestId),
    ).toContain(submit.structured!.approvalRequestId);

    // Maya confirms inside GMS.
    const decided = await decideApproval(
      w.runtime.executor,
      w.t.db,
      { approvalRequestId: String(submit.structured!.approvalRequestId), decision: 'confirm' },
      w.humanCtx(w.maya),
    );
    expect(decided.status, decided.error).toBe('confirmed');

    const status = await callTool(env(), 'get_status', { applicationId }, token);
    const app = (status.structured!.applications as { status: string; statusLabel: string }[])[0]!;
    expect(app.status).toBe('submitted');
    expect(app.statusLabel).toBe('Submitted');

    const audit = await w.t.db
      .selectFrom('audit_log')
      .selectAll()
      .where('entity_id', '=', applicationId)
      .where('action', '=', 'applications.submit')
      .executeTakeFirstOrThrow();
    expect(audit.actor_type).toBe('agent');
    expect(audit.actor_name).toBe('Grant Writer Assistant');
    expect(audit.agent_client_id).toBe(w.ids.grantWriterClient);
    expect(audit.on_behalf_of).toBe(w.maya.id);
    expect(audit.on_behalf_of_name).toBe('Maya Chen');
    const history = await w.t.db
      .selectFrom('status_history')
      .select('actor_name')
      .where('application_id', '=', applicationId)
      .where('to_status', '=', 'submitted')
      .executeTakeFirstOrThrow();
    expect(history.actor_name).toBe('Grant Writer Assistant, acting for Maya Chen');
  });

  it('never exposes staff tools to the applicant, even by name', async () => {
    const r = await callTool(w.env(), 'query_pipeline', {}, w.tokens.grantWriterPat);
    expect(r.status).toBe(403);
    expect(r.res.headers.get('www-authenticate')).toContain('error="insufficient_scope"');
    expect(r.res.headers.get('www-authenticate')).toContain('scope="pipeline:read"');
  });
});
