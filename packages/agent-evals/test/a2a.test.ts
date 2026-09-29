// SPDX-License-Identifier: AGPL-3.0-or-later
// Scenario: another agent talks to the foundation over A2A v1.0 (JSON-RPC).
import { agentCard, type A2aTask } from '@gms/agents';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { a2aRequest, buildAgentWorld, ORIGIN, userMessage, type AgentWorld } from '../src';

let w: AgentWorld;

beforeAll(async () => {
  w = await buildAgentWorld('gms_eval_a2a');
}, 180_000);
afterAll(async () => {
  await w?.t.drop();
});

function dataOf(task: A2aTask): Record<string, unknown> {
  const part = task.status.message?.parts.find((p) => p.kind === 'data');
  return part && part.kind === 'data' ? part.data : {};
}

describe('A2A', () => {
  it('publishes a valid, foundation-branded agent card', () => {
    const card = agentCard(w.env()) as Record<string, unknown> & {
      skills: { id: string; name: string; description: string; tags: string[] }[];
    };
    expect(card.name).toContain('Halcyon Foundation');
    expect(card.url).toBe(`${ORIGIN}/a2a`);
    expect(card.provider).toEqual({ organization: 'Halcyon Foundation', url: ORIGIN });
    expect(typeof card.version).toBe('string');
    expect(card.defaultInputModes).toContain('text/plain');
    expect(card.defaultOutputModes).toContain('application/json');
    expect((card.capabilities as Record<string, unknown>).pushNotifications).toBe(false);
    expect(Object.keys(card.securitySchemes as object)).toEqual(expect.arrayContaining(['oauth2', 'bearer']));
    expect(card.skills.map((s) => s.id).sort()).toEqual([
      'answer_opportunity_question',
      'check_eligibility',
      'find_opportunities',
    ]);
    for (const s of card.skills) {
      expect(s.name && s.description && s.tags.length).toBeTruthy();
    }
    const extended = agentCard(w.env(), { extended: true }) as { skills: { id: string }[] };
    expect(extended.skills.map((s) => s.id)).toEqual(
      expect.arrayContaining([
        'start_application',
        'application_status',
        'submit_report',
        'request_extension',
      ]),
    );
  });

  it('finds opportunities anonymously', async () => {
    const r = await a2aRequest<A2aTask>(
      w.env(),
      'message/send',
      userMessage([{ text: 'Find open grants for youth arts programs' }]),
    );
    expect(r.status).toBe(200);
    const task = r.body!.result!;
    expect(task.kind).toBe('task');
    expect(task.status.state).toBe('TASK_STATE_COMPLETED');
    expect((dataOf(task).opportunities as { id: string }[])[0]!.id).toBe(w.ids.opportunity);
    expect(task.artifacts[0]!.name).toBe('opportunities');

    const again = await a2aRequest<A2aTask>(w.env(), 'tasks/get', { id: task.id });
    expect(again.body!.result!.status.state).toBe('TASK_STATE_COMPLETED');
  });

  it('checks eligibility over several turns (INPUT_REQUIRED until answered)', async () => {
    const [r1, r2] = w.ids.eligibilityRules;
    const first = await a2aRequest<A2aTask>(
      w.env(),
      'message/send',
      userMessage([{ data: { opportunityId: w.ids.opportunity } }], {
        metadata: { skill: 'check_eligibility' },
      }),
    );
    const t1 = first.body!.result!;
    expect(t1.status.state).toBe('TASK_STATE_INPUT_REQUIRED');
    expect((dataOf(t1).missing as { ruleId: string }[]).map((m) => m.ruleId)).toEqual([r1, r2]);

    const second = await a2aRequest<A2aTask>(
      w.env(),
      'message/send',
      userMessage([{ data: { answers: { [r1!]: true } } }], { taskId: t1.id, contextId: t1.contextId }),
    );
    const t2 = second.body!.result!;
    expect(t2.id).toBe(t1.id);
    expect(t2.status.state).toBe('TASK_STATE_INPUT_REQUIRED');
    expect((dataOf(t2).missing as { ruleId: string }[]).map((m) => m.ruleId)).toEqual([r2]);

    const third = await a2aRequest<A2aTask>(
      w.env(),
      'SendMessage',
      userMessage([{ data: { answers: { [r2!]: 40 } } }], { taskId: t1.id }),
    );
    const t3 = third.body!.result!;
    expect(t3.status.state).toBe('TASK_STATE_COMPLETED');
    expect(dataOf(t3).eligible).toBe(true);
    expect(t3.history.length).toBeGreaterThanOrEqual(6);

    const closed = await a2aRequest(
      w.env(),
      'message/send',
      userMessage([{ data: { answers: {} } }], { taskId: t1.id }),
    );
    expect(closed.body!.error?.code).toBe(-32004);
  });

  it('answers questions from the published guidelines with citations (no LLM configured → verbatim passages)', async () => {
    const r = await a2aRequest<A2aTask>(
      w.env(),
      'message/send',
      userMessage([{ text: 'Can fiscally sponsored groups apply?' }]),
    );
    const task = r.body!.result!;
    expect(task.status.state).toBe('TASK_STATE_COMPLETED');
    const data = dataOf(task);
    expect(data.answeredBy).toBe('retrieval');
    const citations = data.citations as { source: string; quote: string; url: string }[];
    expect(citations.length).toBeGreaterThan(0);
    expect(citations.some((c) => /fiscal/i.test(c.quote))).toBe(true);
    expect(citations[0]!.url).toContain(`${ORIGIN}/opportunities/youth-arts-fund#`);
    const text = task.status.message!.parts.find((p) => p.kind === 'text');
    expect(text && text.kind === 'text' ? text.text : '').toMatch(/No language model is configured/);
  });

  it('challenges authenticated skills without a token', async () => {
    const r = await a2aRequest(
      w.env(),
      'message/send',
      userMessage([{ text: 'What is the status of my application?' }], {
        metadata: { skill: 'application_status' },
      }),
    );
    expect(r.status).toBe(401);
    expect(r.res.headers.get('www-authenticate')).toContain(
      `resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/a2a"`,
    );
    expect(r.body!.error).toBeTruthy();
    const card = await a2aRequest(w.env(), 'agent/getAuthenticatedExtendedCard', {});
    expect(card.status).toBe(401);
  });

  it('serves the extended card and authenticated skills to a token holder', async () => {
    const token = w.tokens.grantWriterPat;
    const card = await a2aRequest<{ skills: { id: string }[] }>(
      w.env(),
      'agent/getAuthenticatedExtendedCard',
      {},
      token,
    );
    expect(card.body!.result!.skills.map((s) => s.id)).toContain('submit_report');

    const status = await a2aRequest<A2aTask>(
      w.env(),
      'message/send',
      userMessage([{ text: 'status please' }], { metadata: { skill: 'application_status' } }),
      token,
    );
    expect(status.body!.result!.status.state).toBe('TASK_STATE_COMPLETED');

    // Submitting a report is consequential: the task waits for the person (AUTH_REQUIRED + confirmUrl).
    const report = await a2aRequest<A2aTask>(
      w.env(),
      'message/send',
      userMessage([{ data: { requirementId: w.ids.requirement } }], { metadata: { skill: 'submit_report' } }),
      token,
    );
    const t1 = report.body!.result!;
    expect(t1.status.state).toBe('TASK_STATE_INPUT_REQUIRED');
    const t2 = (
      await a2aRequest<A2aTask>(
        w.env(),
        'message/send',
        userMessage([{ data: { attestation: { typedName: 'Maya Chen', agreed: true } } }], { taskId: t1.id }),
        token,
      )
    ).body!.result!;
    expect(t2.status.state).toBe('TASK_STATE_AUTH_REQUIRED');
    expect(String(dataOf(t2).confirmUrl)).toContain('/portal/confirm/');
    const req = await w.t.db
      .selectFrom('report_requirements')
      .select('status')
      .where('id', '=', w.ids.requirement)
      .executeTakeFirstOrThrow();
    expect(req.status).toBe('due');

    // Another caller cannot read the person's task.
    const other = await a2aRequest(w.env(), 'tasks/get', { id: t2.id });
    expect(other.body!.error?.code).toBe(-32001);

    const cancelled = await a2aRequest<A2aTask>(w.env(), 'tasks/cancel', { id: t2.id }, token);
    expect(cancelled.body!.result!.status.state).toBe('TASK_STATE_CANCELLED');
  });

  it('streams a single event for message/stream', async () => {
    const r = await a2aRequest<A2aTask>(
      w.env(),
      'message/stream',
      userMessage([{ text: 'Find watershed grants' }]),
    );
    expect(r.res.headers.get('content-type')).toContain('text/event-stream');
    expect(r.body!.result!.status.state).toBe('TASK_STATE_COMPLETED');
  });

  it('honors the A2A kill switch', async () => {
    await w.t.db
      .updateTable('agent_policies')
      .set({ a2a_enabled: false })
      .where('workspace_id', '=', w.ws.id)
      .execute();
    try {
      const r = await a2aRequest(w.env(), 'message/send', userMessage([{ text: 'Find grants' }]));
      expect(r.status).toBe(503);
    } finally {
      await w.t.db
        .updateTable('agent_policies')
        .set({ a2a_enabled: true })
        .where('workspace_id', '=', w.ws.id)
        .execute();
    }
  });
});
