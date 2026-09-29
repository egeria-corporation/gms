// SPDX-License-Identifier: AGPL-3.0-or-later
// Agents: Maya's "Grant Writer Assistant" (personal access token), the foundation's "Ops Assistant" (agent
// account with an API key), the "Halcyon Intake Agent" (A2A peer). Their requests go through the executor,
// so the six pending approval requests carry real previews and audit entries.
import { APPLICANT_SCOPES, type Scope } from '@gms/domain';
import { json, type SeedContext } from '../context';
import { hexOf } from '../ids';
import type { Apps } from './applications';
import type { Awards } from './awards';
import { flagshipStatus, type Catalog } from './catalog';

export const OPS_SCOPES: readonly Scope[] = ['pipeline:read', 'payments:read', 'payments:propose', 'analytics:read', 'awards:draft'];
export const OPS_TOOLS = [
  'applications.advance',
  'applications.request_info',
  'applications.tag',
  'competitions.invite_applicants',
  'awards.draft',
  'awards.set_hold',
  'payments.propose_batch',
  'exports.request',
];

export interface AgentsOut {
  grantWriter: { clientId: string; tokenId: string; token: string };
  ops: { clientId: string; key: string };
  intake: { clientId: string };
  pendingApprovals: string[];
}

export async function agents(ctx: SeedContext, cat: Catalog, apps: Apps, aw: Awards, mayaRequirementId: string): Promise<AgentsOut> {
  const c = ctx.clock;
  const hal = ctx.ws('halcyon');

  // Grant Writer Assistant: Maya connects it with a personal access token (applicant scopes only).
  const gw = await ctx.run<{ tokenId: string; token: string; clientId: string }>(
    'agents.create_token',
    { agentName: 'Grant Writer Assistant', scopes: APPLICANT_SCOPES, expiresInDays: 90, workspaceBound: true },
    ctx.asPerson('maya', 'halcyon', []),
  );
  await ctx.db.updateTable('agent_clients').set({ homepage_url: 'https://grant-writer-assistant.example' }).where('id', '=', gw.clientId).execute();

  // Ops Assistant: a foundation-owned agent account owned by Jordan, created by Helen (step-up).
  const ops = await ctx.run<{ clientId: string; key: string }>(
    'agents.create_account',
    { name: 'Ops Assistant', ownerUserId: ctx.person('jordan').id, scopes: OPS_SCOPES, toolAllowlist: OPS_TOOLS, rateLimitPerMin: 30, homepageUrl: 'https://ops-assistant.example' },
    ctx.asPerson('helen', 'halcyon', ['owner'], { aal2: true }),
  );

  // Halcyon Intake Agent: the foundation's A2A peer for intake questions (no user credentials).
  const intakeId = ctx.id('agent:halcyon-intake');
  await ctx.insert('agent_clients', [
    {
      id: intakeId,
      workspace_id: hal.id,
      client_id: 'halcyon-intake-agent',
      client_secret_hash: hexOf('halcyon-intake-agent:secret'),
      name: 'Halcyon Intake Agent',
      homepage_url: 'https://intake.halcyonridge.example',
      owner_user_id: ctx.person('jordan').id,
      kind: 'a2a_peer',
      registration: 'manual',
      redirect_uris: [],
      scopes: ['opportunities:read', 'pipeline:read'],
      tool_allowlist: ['opportunities.check_eligibility'],
      rate_limit_per_min: 60,
      status: 'active',
      created_at: c.iso(-120),
    },
  ]);
  ctx.audit({ workspace: 'halcyon', at: c.iso(-120), actor: ctx.human('helen'), action: 'agents.create_account', entityType: 'agent_client', entityId: intakeId, after: { name: 'Halcyon Intake Agent', kind: 'a2a_peer' }, riskTier: 'R3' });
  await ctx.insert(
    'agent_tasks',
    [0, 1, 2].map((i) => ({
      id: ctx.id(`agent-task:intake:${i}`),
      workspace_id: hal.id,
      client_id: intakeId,
      protocol: 'a2a',
      skill: 'check_eligibility',
      context_id: `ctx-intake-${i + 1}`,
      state: i === 2 ? 'input_required' : 'completed',
      input: json({ opportunity: 'youth-arts-fund-2027', answers: { nonprofit: true, servesYouth: true } }),
      output: i === 2 ? null : json({ eligible: i === 0, message: i === 0 ? 'Eligible. Letters of inquiry open November 3.' : 'This fund is for programs in Alder, Bramble and Cinder Counties.' }),
      history: json([{ role: 'user', text: 'Are we eligible for the Youth Arts Fund?' }]),
      created_at: c.iso(-10 + i * 3),
      last_modified_at: c.iso(-10 + i * 3),
    })),
  );

  const gwAgent = { clientId: gw.clientId, name: 'Grant Writer Assistant', scopes: APPLICANT_SCOPES };
  const opsAgent = { clientId: ops.clientId, name: 'Ops Assistant', scopes: OPS_SCOPES };
  const mayaName = ctx.person('maya').name;
  const gwActor = { type: 'agent' as const, clientId: gw.clientId, name: 'Grant Writer Assistant', onBehalfOf: ctx.person('maya').id, onBehalfOfName: mayaName };

  // History of the assistant's drafting (read as "Grant Writer Assistant, acting for Maya Chen").
  if (apps.mayaLoi) {
    const start = Date.parse(apps.mayaLoi.createdAt);
    ctx.audit({ workspace: 'halcyon', at: new Date(start).toISOString(), actor: gwActor, action: 'applications.start', entityType: 'application', entityId: apps.mayaLoi.id, after: { reference: apps.mayaLoi.ref } });
    for (const [i, page] of ['about_org', 'project', 'budget', 'attachments'].entries()) {
      ctx.audit({ workspace: 'halcyon', at: new Date(start + (i + 1) * 3_600_000).toISOString(), actor: gwActor, action: 'applications.save_answers', entityType: 'application', entityId: apps.mayaLoi.id, after: { page } });
    }
  }

  // The assistant drafts Maya's year-two interim report (R1 runs directly under Maya's RLS).
  const draft = await ctx.run<{ submissionId: string; errors: unknown[] }>(
    'reports.save',
    {
      requirementId: mayaRequirementId,
      answers: {
        progress_narrative:
          'Year two is off to a strong start. We added a second beginner strings section on Saturdays, and 12 former students now serve as paid section coaches. In September the orchestra played at the Larkspur harvest festival for about 400 neighbors.',
        youth_served_to_date: 71,
        milestone_status: { recruitment: 'ahead', programming: 'on_track', staffing: 'on_track' },
        budget_to_actual: [
          { item: 'Teaching artist fees', budgeted: 1_200_000, spent: 540_000 },
          { item: 'Instrument repair and strings', budgeted: 450_000, spent: 210_000, note: 'Donated violas lowered costs' },
          { item: 'Section coach stipends', budgeted: 600_000, spent: 300_000 },
        ],
        challenges: 'Two of our rehearsal rooms flooded in August. The library let us use its community room for six weeks while repairs were made.',
        attestation: { agreed: true, name: mayaName },
      },
    },
    ctx.asAgent(gwAgent, 'maya', 'halcyon', []),
  );
  if (draft.errors.length) throw new Error(`Maya's report draft is not valid: ${JSON.stringify(draft.errors)}`);

  // Six pending approval requests (R2 actions requested by agents; a person confirms them in GMS).
  const pending: string[] = [];
  const request = async (actionId: string, input: unknown, ctxFor: Parameters<SeedContext['run']>[2]) => {
    const r = await ctx.runtime.executor.execute(actionId, input, ctxFor);
    if (r.status !== 'approval_required') throw new Error(`${actionId} should have required approval`);
    pending.push(r.approvalRequestId);
  };
  const mayaAsAgent = ctx.asAgent(gwAgent, 'maya', 'halcyon', []);
  await request('reports.submit', { requirementId: mayaRequirementId, attestation: { typedName: mayaName, agreed: true } }, mayaAsAgent);
  // Maya's agent asks to submit her LOI only while the flagship LOI window is open (a request that couldn't
  // succeed when confirmed is refused up front).
  const mayaSubmitRequested = Boolean(apps.mayaLoi) && flagshipStatus(ctx.clock.anchor) === 'open';
  if (apps.mayaLoi && mayaSubmitRequested) {
    await request(
      'applications.submit',
      { applicationId: apps.mayaLoi.id, attestation: { typedName: mayaName, agreed: true }, aiDisclosure: String(apps.mayaLoi.data.ai_disclosure ?? '') },
      ctx.asAgent(gwAgent, 'maya', 'halcyon', []),
    );
  }
  const opsCtx = () => ctx.asAgent(opsAgent, 'jordan', 'halcyon', ['program_officer'], 'api');
  const submitted = apps.byOpp.flagship.filter((a) => a.status === 'submitted');
  await request('applications.advance', { applicationIds: submitted.slice(0, 3).map((a) => a.id), reason: 'Complete and eligible; ready for community review.' }, opsCtx());
  await request('applications.request_info', { applicationId: submitted[3]!.id, note: 'Could you share the number of young people you expect to serve in each age group?', reopenForEdits: false }, opsCtx());
  const flag = cat.opps.flagship!;
  const strong = apps.byOpp.flagship.filter((a) => a.status === 'under_review').slice(-2);
  await request('competitions.invite_applicants', { competitionId: flag.stages[1]!.id, applicationIds: strong.map((a) => a.id), message: 'Congratulations! We would like to invite you to submit a full proposal.' }, opsCtx());
  const mismatch = aw.nfs.find((a) => a.installments[0]!.plan === 'exception')!;
  await request('awards.set_hold', { awardId: mismatch.id, onHold: true, reason: 'The bank shows a different amount for the first installment. Pausing payments until finance reconciles it.' }, opsCtx());
  const expectedPending = mayaSubmitRequested ? 6 : 5;
  if (pending.length !== expectedPending) throw new Error(`expected ${expectedPending} pending approvals, made ${pending.length}`);
  ctx.bump('approval_requests', pending.length);

  return { grantWriter: gw, ops, intake: { clientId: intakeId }, pendingApprovals: pending };
}
