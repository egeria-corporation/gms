// SPDX-License-Identifier: AGPL-3.0-or-later
// A small, fictional Halcyon Foundation for agent evals: one open opportunity with the Youth Arts LOI form, an
// applicant with a verified-EIN organization, a PAT for "Grant Writer Assistant" acting for her, and a
// foundation-owned "Ops Assistant" agent account (owned by Helen, the executive director). Built on a fresh test database.
import { randomUUID } from 'node:crypto';
import { createRuntime, type ActionContext, type Runtime, type WorkspaceRef } from '@gms/actions';
import type { AgentEnv } from '@gms/agents';
import { createTestDatabase, createUser, type TestDatabase, type TestUser } from '@gms/db/testing';
import { APPLICANT_SCOPES, STAFF_SCOPES } from '@gms/domain';
import { compileForm, YOUTH_ARTS_LOI } from '@gms/forms';

export const ORIGIN = 'http://halcyon.localhost:3000';

export interface AgentWorld {
  t: TestDatabase;
  runtime: Runtime;
  ws: WorkspaceRef;
  maya: TestUser;
  helen: TestUser;
  fin: TestUser;
  ids: {
    opportunity: string;
    opportunitySlug: string;
    competition: string;
    form: string;
    formVersion: string;
    org: string;
    award: string;
    installment: string;
    requirement: string;
    eligibilityRules: string[];
    grantWriterClient: string;
    opsClient: string;
  };
  /** Secrets returned once by the credential actions (kept in memory only, never logged). */
  tokens: { grantWriterPat: string; opsKey: string };
  env: (extra?: Partial<AgentEnv>) => AgentEnv;
  humanCtx: (user: TestUser, roles?: ActionContext['roles'], extra?: Partial<ActionContext>) => ActionContext;
}

export async function buildAgentWorld(prefix = 'gms_agents'): Promise<AgentWorld> {
  // Evals run with the test auth adapter (never in production builds) and without Supabase.
  process.env.GMS_AUTH_MODE ??= 'test';
  const t = await createTestDatabase(prefix);
  const db = t.db;
  const runtime = createRuntime({ db });
  const maya = await createUser(db, { name: 'Maya Chen', email: 'maya@riverbend.example' });
  const helen = await createUser(db, { name: 'Helen Ortiz', email: 'helen@halcyon.example' });
  const fin = await createUser(db, { name: 'Farah Ince', email: 'farah@halcyon.example' });

  const ws = await db
    .insertInto('workspaces')
    .values({
      slug: 'halcyon',
      name: 'Halcyon Foundation',
      timezone: 'America/Los_Angeles',
      public_contact_email: 'grants@halcyon.example',
      about_md: 'Halcyon Foundation funds youth arts and watershed stewardship in Alder and Cinder counties.',
    })
    .returning(['id', 'slug', 'name', 'timezone'])
    .executeTakeFirstOrThrow();
  await db
    .insertInto('workspace_members')
    .values([
      { workspace_id: ws.id, user_id: helen.id, role: 'owner' },
      { workspace_id: ws.id, user_id: fin.id, role: 'finance' },
    ])
    .execute();
  await db
    .updateTable('agent_policies')
    .set({ ai_use: 'disclosure' })
    .where('workspace_id', '=', ws.id)
    .execute();

  const now = Date.now();
  const iso = (ms: number) => new Date(now + ms).toISOString();
  const day = 86400_000;
  const program = await db
    .insertInto('programs')
    .values({ workspace_id: ws.id, name: 'Youth Arts', slug: 'youth-arts' })
    .returning('id')
    .executeTakeFirstOrThrow();
  const opp = await db
    .insertInto('opportunities')
    .values({
      workspace_id: ws.id,
      program_id: program.id,
      slug: 'youth-arts-fund',
      title: 'Youth Arts Fund 2027',
      status: 'open',
      summary:
        'Grants of $5,000–$25,000 for after-school arts programs for young people in Alder and Cinder counties.',
      description_md:
        'The Youth Arts Fund supports free after-school programs where young people make art with working artists.\n\nWe fund murals, music, theater and media arts.',
      eligibility_md:
        'Nonprofits with 501(c)(3) status, or projects with a fiscal sponsor, serving youth in Alder or Cinder county.',
      guidelines_md:
        '## Budget\n\nRequests may be $5,000 to $25,000. Budget lines must add up to the amount requested.\n\n## Fiscal sponsorship\n\nFiscally sponsored groups may apply. Give your sponsor’s name and EIN on the form.\n\n## Deadline\n\nApplications are due by 5:00 PM Pacific time on the closing date. Late applications are not accepted.',
      faq: JSON.stringify([
        {
          q: 'Can we apply for general operating support?',
          a: 'No. The fund supports specific after-school arts programs, not general operations.',
        },
        {
          q: 'Do fiscally sponsored groups qualify?',
          a: 'Yes. Fiscally sponsored projects may apply with their sponsor’s EIN.',
        },
      ]),
      funding_total_cents: 50_000_000,
      award_min_cents: 500_000,
      award_max_cents: 2_500_000,
      applicant_types: ['nonprofit_501c3', 'fiscally_sponsored'],
      cause_terms: ['arts', 'youth'],
      geography_terms: ['alder-county', 'cinder-county'],
      opens_at: iso(-10 * day),
      closes_at: iso(30 * day),
      contact_email: 'grants@halcyon.example',
      published_at: iso(-10 * day),
    })
    .returning(['id', 'slug'])
    .executeTakeFirstOrThrow();
  const rules = await db
    .insertInto('eligibility_rules')
    .values([
      {
        workspace_id: ws.id,
        opportunity_id: opp.id,
        position: 1,
        question: 'Is your organization a 501(c)(3) nonprofit or fiscally sponsored?',
        kind: 'yes_no',
        config: JSON.stringify({ required: true }),
        knockout_message: 'The fund only supports 501(c)(3) nonprofits and fiscally sponsored projects.',
      },
      {
        workspace_id: ws.id,
        opportunity_id: opp.id,
        position: 2,
        question: 'How many young people will the program serve?',
        kind: 'number_min',
        config: JSON.stringify({ min: 10 }),
        knockout_message: 'Programs must serve at least 10 young people.',
      },
    ])
    .returning('id')
    .execute();
  const comp = await db
    .insertInto('competitions')
    .values({
      workspace_id: ws.id,
      opportunity_id: opp.id,
      name: 'Letter of inquiry',
      status: 'open',
      opens_at: iso(-10 * day),
      closes_at: iso(30 * day),
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  const compiled = compileForm(YOUTH_ARTS_LOI);
  const form = await db
    .insertInto('forms')
    .values({ workspace_id: ws.id, name: YOUTH_ARTS_LOI.title, description: 'Four-page letter of inquiry.' })
    .returning('id')
    .executeTakeFirstOrThrow();
  const version = await db
    .insertInto('form_versions')
    .values({
      workspace_id: ws.id,
      form_id: form.id,
      version: 1,
      status: 'published',
      published_at: iso(-10 * day),
      builder_model: JSON.stringify(YOUTH_ARTS_LOI),
      json_schema: JSON.stringify(compiled.jsonSchema),
      ui_schema: JSON.stringify(compiled.uiSchema),
      mapping_to_cg: JSON.stringify(compiled.mappingToCg),
      mapping_from_cg: JSON.stringify(compiled.mappingFromCg),
      field_meta: JSON.stringify(compiled.fieldMeta),
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  await db
    .updateTable('forms')
    .set({ current_version_id: version.id, kind: 'loi' })
    .where('id', '=', form.id)
    .execute();
  await db
    .insertInto('competition_forms')
    .values({ workspace_id: ws.id, competition_id: comp.id, form_id: form.id, form_version_id: version.id })
    .execute();

  const org = await db
    .insertInto('applicant_orgs')
    .values({
      legal_name: 'Riverbend Youth Arts Collective',
      ein: '84-1234567',
      ein_verified_at: iso(-30 * day),
      mission: 'Free after-school art studios for teens.',
      created_by: maya.id,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  await db
    .insertInto('applicant_org_members')
    .values({ org_id: org.id, user_id: maya.id, role: 'org_admin' })
    .execute();

  // A prior, active grant to Riverbend (for payments + reports).
  const award = await db
    .insertInto('awards')
    .values({
      workspace_id: ws.id,
      program_id: program.id,
      opportunity_id: opp.id,
      applicant_org_id: org.id,
      reference: 'HF-A-2026-0001',
      title: 'Murals on Main 2026',
      amount_cents: 2_000_000,
      status: 'active',
      agreement_pending: false,
      start_date: '2026-01-01',
      end_date: '2026-12-31',
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  const schedule = await db
    .insertInto('payment_schedules')
    .values({ workspace_id: ws.id, award_id: award.id })
    .returning('id')
    .executeTakeFirstOrThrow();
  const inst = await db
    .insertInto('installments')
    .values({
      workspace_id: ws.id,
      schedule_id: schedule.id,
      award_id: award.id,
      position: 1,
      due_date: new Date(now + 3 * day).toISOString().slice(0, 10),
      amount_cents: 1_000_000,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  await db
    .insertInto('payees')
    .values({
      workspace_id: ws.id,
      applicant_org_id: org.id,
      provider: 'manual',
      status: 'ready',
      contact_email: 'maya@riverbend.example',
      ready_at: iso(-20 * day),
    })
    .execute();
  await db
    .insertInto('bank_connections')
    .values({
      workspace_id: ws.id,
      provider: 'manual',
      mode: 'none',
      status: 'connected',
      connected_by: helen.id,
    })
    .execute();
  const req = await db
    .insertInto('report_requirements')
    .values({
      workspace_id: ws.id,
      award_id: award.id,
      title: 'Interim report',
      kind: 'interim',
      due_date: new Date(now + 7 * day).toISOString().slice(0, 10),
      status: 'due',
    })
    .returning('id')
    .executeTakeFirstOrThrow();

  const humanCtx = (
    user: TestUser,
    roles: ActionContext['roles'] = [],
    extra: Partial<ActionContext> = {},
  ): ActionContext => ({
    workspace: ws,
    actor: { type: 'human', id: user.id, name: user.name },
    roles,
    scopes: '*',
    claims: { role: 'authenticated', sub: user.id, email: user.email, aal: 'aal1' },
    aal: 'aal1',
    requestId: randomUUID(),
    channel: 'test',
    ...extra,
  });

  // Credentials are issued through the real (people-only) actions.
  const pat = await runtime.executor.run<{ token: string; clientId: string }>(
    'agents.create_token',
    {
      agentName: 'Grant Writer Assistant',
      scopes: APPLICANT_SCOPES,
      expiresInDays: 30,
      workspaceBound: true,
    },
    humanCtx(maya),
  );
  const ops = await runtime.executor.run<{ clientId: string; key: string }>(
    'agents.create_account',
    { name: 'Ops Assistant', ownerUserId: helen.id, scopes: STAFF_SCOPES, rateLimitPerMin: 120 },
    humanCtx(helen, ['owner'], { aal: 'aal2', stepUpAt: new Date().toISOString() }),
  );

  const env = (extra: Partial<AgentEnv> = {}): AgentEnv => ({
    workspace: ws,
    origin: ORIGIN,
    brandName: 'Halcyon Foundation',
    runtime,
    requestId: randomUUID(),
    ip: '203.0.113.7',
    supabaseUrl: null,
    ...extra,
  });

  return {
    t,
    runtime,
    ws,
    maya,
    helen,
    fin,
    ids: {
      opportunity: opp.id,
      opportunitySlug: opp.slug,
      competition: comp.id,
      form: form.id,
      formVersion: version.id,
      org: org.id,
      award: award.id,
      installment: inst.id,
      requirement: req.id,
      eligibilityRules: rules.map((r) => r.id),
      grantWriterClient: pat.clientId,
      opsClient: ops.clientId,
    },
    tokens: { grantWriterPat: pat.token, opsKey: ops.key },
    env,
    humanCtx,
  };
}
