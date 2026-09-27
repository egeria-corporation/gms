// SPDX-License-Identifier: AGPL-3.0-only
// Deterministic RLS "world": two workspaces, every principal the RLS model knows about, and at least
// one workspace-A row in every public table. Built with the service connection (bypasses RLS).
//
// Ids are derived from names (detId), emails use the reserved .example TLD, and nothing depends on
// wall-clock ordering, so every run produces the same world.
import { createHash } from 'node:crypto';
import { sql, type Database, type RequestClaims } from '../src/client';
import { createUser, type TestUser } from '../src/testing';

/** Stable UUID derived from a name (sha256, formatted as a v4-shaped UUID). */
export function detId(name: string): string {
  const h = createHash('sha256').update(`gms-rls-world:${name}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export const PRINCIPALS = [
  'ownerA',
  'adminA',
  'programOfficerA',
  'financeA',
  'reviewerA',
  'reviewerA2',
  'boardA',
  'auditorA',
  'applicant',
  'collaborator',
  'otherApplicant',
  'outsider',
  'adminB',
  'anon',
] as const;
export type Principal = (typeof PRINCIPALS)[number];
export type SignedInPrincipal = Exclude<Principal, 'anon'>;

/** Workspace A staff roles (one role per membership). */
export const STAFF_ROLE: Partial<Record<Principal, string>> = {
  ownerA: 'owner',
  adminA: 'admin',
  programOfficerA: 'program_officer',
  financeA: 'finance',
  reviewerA: 'reviewer',
  reviewerA2: 'reviewer',
  boardA: 'board',
  auditorA: 'auditor',
};

/** Marker for jsonb values (plain JS arrays would otherwise be sent as Postgres arrays). */
export class Json {
  constructor(readonly value: unknown) {}
}
export const json = (v: unknown): Json => new Json(v);

export interface World {
  wsA: string;
  wsB: string;
  users: Record<SignedInPrincipal, TestUser> & { operator: TestUser; spare: TestUser; ghostId: string };
  /** Named ids of everything seeded. */
  ids: Record<string, string>;
  /** Primary-key values of the workspace-A row the RLS matrix probes, per table. */
  rows: Record<string, Record<string, string>>;
  claims: (p: Principal) => RequestClaims;
  userId: (p: Principal) => string | null;
}

function param(v: unknown) {
  if (v instanceof Json) return JSON.stringify(v.value);
  if (v !== null && typeof v === 'object' && typeof (v as { toOperationNode?: unknown }).toOperationNode === 'function') return v;
  if (v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) return JSON.stringify(v);
  return v;
}

/** Service insert of one row (column defaults apply to omitted columns). */
export async function put(db: Database, table: string, row: Record<string, unknown>): Promise<void> {
  const cols = Object.keys(row);
  await sql`insert into ${sql.table(`public.${table}`)} (${sql.join(cols.map((c) => sql.ref(c)))}) values (${sql.join(
    cols.map((c) => param(row[c])),
  )})`.execute(db);
}

export async function buildWorld(db: Database): Promise<World> {
  const ids: Record<string, string> = {};
  const id = (name: string): string => (ids[name] ??= detId(name));
  const rows: Record<string, Record<string, string>> = {};
  /** Inserts a row with a named id and (optionally) marks it as the table's matrix row. */
  const seed = async (table: string, name: string, row: Record<string, unknown>, matrix = false) => {
    await put(db, table, { id: id(name), ...row });
    if (matrix) rows[table] = { id: id(name) };
  };

  // --- principals --------------------------------------------------------------------------
  const mk = (key: string, name: string) => createUser(db, { id: id(`user:${key}`), email: `${key.toLowerCase()}@rls.example`, name });
  const users = {
    ownerA: await mk('ownerA', 'Olive Owner'),
    adminA: await mk('adminA', 'Adam Admin'),
    programOfficerA: await mk('programOfficerA', 'Pat Officer'),
    financeA: await mk('financeA', 'Fin Ance'),
    reviewerA: await mk('reviewerA', 'Rita Reviewer'),
    reviewerA2: await mk('reviewerA2', 'Ray Reviewer'),
    boardA: await mk('boardA', 'Bea Board'),
    auditorA: await mk('auditorA', 'Aud Itor'),
    applicant: await mk('applicant', 'Maya Applicant'),
    collaborator: await mk('collaborator', 'Cole Laborator'),
    otherApplicant: await mk('otherApplicant', 'Otto Other'),
    outsider: await mk('outsider', 'Out Sider'),
    adminB: await mk('adminB', 'Bob AdminB'),
    operator: await mk('operator', 'Opal Operator'),
    spare: await mk('spare', 'Spare User'),
    ghostId: id('user:ghost'),
  };
  // A signed-up auth user without a profile row (target for profile insert probes).
  await sql`insert into auth.users (id, email, email_confirmed_at) values (${users.ghostId}, 'ghost@rls.example', now())`.execute(db);
  await sql`delete from public.profiles where id = ${users.ghostId}`.execute(db);
  const u = (p: SignedInPrincipal | 'operator' | 'spare') => users[p].id;

  // --- tenancy -------------------------------------------------------------------------------
  const wsA = id('ws:A');
  const wsB = id('ws:B');
  await put(db, 'workspaces', { id: wsA, slug: 'rls-a', name: 'RLS Foundation A', public_contact_email: 'grants@a.rls.example' });
  await put(db, 'workspaces', { id: wsB, slug: 'rls-b', name: 'RLS Foundation B' });
  rows.workspaces = { id: wsA };
  rows.workspace_settings = { workspace_id: wsA };
  rows.workspace_brand = { workspace_id: wsA };
  rows.agent_policies = { workspace_id: wsA };

  for (const [p, role] of Object.entries(STAFF_ROLE) as [SignedInPrincipal, string][]) {
    await seed('workspace_members', `member:${p}`, { workspace_id: wsA, user_id: u(p), role }, p === 'reviewerA2');
  }
  await seed('workspace_members', 'member:adminB', { workspace_id: wsB, user_id: u('adminB'), role: 'admin' });

  await seed('workspace_domains', 'domain:A', { workspace_id: wsA, hostname: 'grants.a.rls.example' }, true);
  await seed(
    'invitations',
    'invitation:A',
    { workspace_id: wsA, email: users.outsider.email, role: 'reviewer', token_hash: 'inv-hash-a', invited_by: u('adminA') },
    true,
  );
  await seed('api_keys', 'apikey:A', { workspace_id: wsA, name: 'CI key', prefix: 'gms_a', key_hash: 'apikey-hash-a', owner_id: u('adminA') }, true);
  await put(db, 'platform_operators', { user_id: u('operator'), role: 'operator' });
  rows.platform_operators = { user_id: u('operator') };
  await seed(
    'support_access_grants',
    'support:A',
    { workspace_id: wsA, operator_user_id: u('operator'), granted_by: u('ownerA'), reason: 'Ticket 42', expires_at: sql`now() + interval '1 day'` },
    true,
  );
  rows.profiles = { id: u('applicant') };

  // --- applicant commons -----------------------------------------------------------------------
  await seed('applicant_orgs', 'org1', { legal_name: 'Riverbend Arts Collective', ein: '12-3456789', created_by: u('applicant') }, true);
  await seed('applicant_orgs', 'org2', { legal_name: 'Other Org', ein: '98-7654321', created_by: u('otherApplicant') });
  await seed('applicant_org_members', 'orgmember:applicant', { org_id: id('org1'), user_id: u('applicant'), role: 'org_admin' }, true);
  await seed('applicant_org_members', 'orgmember:other', { org_id: id('org2'), user_id: u('otherApplicant'), role: 'org_admin' });
  await seed(
    'org_addresses',
    'address:org1',
    { org_id: id('org1'), kind: 'mailing', line1: '1 River Rd', city: 'Halcyon', state: 'CA', postal_code: '94000', county: 'Alameda' },
    true,
  );
  await seed(
    'org_documents',
    'orgdoc:org1',
    { org_id: id('org1'), doc_type: 'w9', title: 'W-9', storage_path: 'orgs/org1/w9.pdf', content_type: 'application/pdf', size_bytes: 1000, uploaded_by: u('applicant') },
    true,
  );

  // --- platform ---------------------------------------------------------------------------------
  await seed('audit_log', 'audit:A', { workspace_id: wsA, actor_type: 'human', actor_id: u('adminA'), action: 'program.create' }, true);
  const outbox = await sql<{ id: number }>`insert into public.outbox (workspace_id, event_type) values (${wsA}, 'test.event') returning id`.execute(db);
  rows.outbox = { id: String(outbox.rows[0]!.id) };
  await seed('dev_outbox', 'devmail:A', { workspace_id: wsA, to_email: 'x@rls.example', from_email: 'gms@rls.example', subject: 'Hi' }, true);
  await put(db, 'idempotency_keys', { key: 'idem-a', workspace_id: wsA, actor_id: u('adminA'), action_id: 'program.create', request_hash: 'h' });
  rows.idempotency_keys = { action_id: 'program.create', key: 'idem-a' };
  await put(db, 'rate_limit_buckets', { key: `ws:${wsA}`, window_start: sql`now()`, count: 1 });
  rows.rate_limit_buckets = { key: `ws:${wsA}` };
  await seed('webhook_endpoints', 'webhook:A', { workspace_id: wsA, url: 'https://hooks.a.rls.example/in', secret_ref: 'secret:wh', created_by: u('adminA') }, true);
  await seed(
    'webhook_deliveries',
    'delivery:A',
    { workspace_id: wsA, endpoint_id: id('webhook:A'), event_id: 'evt-1', event_type: 'application.submitted', payload: json({}) },
    true,
  );
  await seed('exports', 'export:A', { workspace_id: wsA, kind: 'applications', requested_by: u('programOfficerA') }, true);
  await seed(
    'custom_field_definitions',
    'cfd:A',
    { workspace_id: wsA, entity: 'application', key: 'region', label: 'Region', field_type: 'text' },
    true,
  );
  await seed('saved_views', 'view:A', { workspace_id: wsA, user_id: u('programOfficerA'), surface: 'applications', name: 'Mine', shared: true }, true);
  await seed('notifications', 'notification:A', { workspace_id: wsA, user_id: u('programOfficerA'), kind: 'info', title: 'Hello' }, true);
  await seed(
    'internal_notes',
    'note:A',
    { workspace_id: wsA, entity_type: 'org', entity_id: id('org1'), author_id: u('programOfficerA'), body: 'Strong partner.' },
    true,
  );

  // --- agents -----------------------------------------------------------------------------------
  await seed(
    'agent_clients',
    'client:A',
    { workspace_id: wsA, client_id: 'client-a', name: 'Workspace bot', owner_user_id: u('adminA'), kind: 'agent_account' },
    true,
  );
  await seed('agent_grants', 'grant:A', { client_id: id('client:A'), user_id: u('applicant'), workspace_id: wsA, scopes: ['applications:read'] }, true);
  await seed(
    'personal_access_tokens',
    'pat:A',
    { user_id: u('programOfficerA'), workspace_id: wsA, name: 'CLI', prefix: 'gms_pat', token_hash: 'pat-hash-a' },
    true,
  );
  await put(db, 'oauth_authorization_codes', {
    code_hash: 'code-hash-a',
    client_id: id('client:A'),
    user_id: u('applicant'),
    workspace_id: wsA,
    redirect_uri: 'https://bot.rls.example/cb',
    scopes: ['applications:read'],
    code_challenge: 'challenge',
    expires_at: sql`now() + interval '5 minutes'`,
  });
  rows.oauth_authorization_codes = { code_hash: 'code-hash-a' };
  await seed(
    'oauth_pending_authorizations',
    'pending:A',
    { client_id: id('client:A'), workspace_id: wsA, redirect_uri: 'https://bot.rls.example/cb', scopes: ['applications:read'], code_challenge: 'c' },
    true,
  );
  await seed('agent_tasks', 'task:A', { workspace_id: wsA, client_id: id('client:A'), user_id: u('applicant'), protocol: 'mcp', skill: 'draft' }, true);
  await seed(
    'approval_requests',
    'approval:A',
    {
      workspace_id: wsA,
      action_id: 'application.submit',
      input: json({}),
      preview: json({}),
      risk_tier: 'R2',
      requested_by_client_id: id('client:A'),
      requester_name: 'Workspace bot',
      on_behalf_of: u('applicant'),
    },
    true,
  );

  // --- programs, forms, opportunities ---------------------------------------------------------------
  await seed('programs', 'program1', { workspace_id: wsA, name: 'Arts', slug: 'arts', lead_user_id: u('programOfficerA') }, true);
  await seed('programs', 'program2', { workspace_id: wsA, name: 'Youth', slug: 'youth' });
  await seed('program_budgets', 'budget1', { workspace_id: wsA, program_id: id('program1'), fiscal_year: 2026, amount_cents: 10_000_000 }, true);
  await seed('taxonomy_terms', 'term1', { workspace_id: wsA, kind: 'cause', code: 'arts', label: 'Arts' }, true);
  await seed('forms', 'form1', { workspace_id: wsA, name: 'Application', kind: 'application', created_by: u('programOfficerA') }, true);
  await seed('forms', 'form2', { workspace_id: wsA, name: 'Spare form', kind: 'application' });
  await seed(
    'form_versions',
    'fv1',
    {
      workspace_id: wsA,
      form_id: id('form1'),
      version: 1,
      status: 'published',
      json_schema: json({ type: 'object' }),
      field_meta: json({ name: { blind: true } }),
      published_at: sql`now()`,
    },
    true,
  );
  await sql`update public.forms set current_version_id = ${id('fv1')} where id = ${id('form1')}`.execute(db);
  await seed('question_bank_items', 'qbank:A', { workspace_id: wsA, label: 'Mission', field: json({ type: 'string' }) }, true);
  await seed('form_templates', 'template:A', { workspace_id: wsA, name: 'Basic', builder_model: json({}) }, true);
  const oppBase = { workspace_id: wsA, program_id: id('program1'), status: 'open', opens_at: sql`now() - interval '1 day'`, closes_at: sql`now() + interval '30 days'` };
  await seed('opportunities', 'opp1', { ...oppBase, slug: 'arts-2026', title: 'Arts 2026' });
  await seed('opportunities', 'oppLeaf', { ...oppBase, slug: 'leaf-2026', title: 'Leaf 2026' }, true);
  await seed('opportunities', 'oppDraft', { ...oppBase, status: 'draft', slug: 'draft-2026', title: 'Draft 2026' });
  await seed('competitions', 'comp1', { workspace_id: wsA, opportunity_id: id('opp1'), name: 'Round 1', status: 'open' });
  await seed('competitions', 'compLeaf', { workspace_id: wsA, opportunity_id: id('oppLeaf'), name: 'Leaf round', status: 'open' }, true);
  await seed('competitions', 'compDraft', { workspace_id: wsA, opportunity_id: id('oppDraft'), name: 'Draft round', status: 'draft' });
  await seed('competition_forms', 'cf1', { workspace_id: wsA, competition_id: id('comp1'), form_id: id('form1'), form_version_id: id('fv1') }, true);
  await seed('competition_invites', 'invite1', { workspace_id: wsA, competition_id: id('comp1'), applicant_org_id: id('org1'), invited_by: u('programOfficerA') }, true);
  await seed(
    'eligibility_rules',
    'rule1',
    { workspace_id: wsA, opportunity_id: id('opp1'), question: 'Are you a nonprofit?', kind: 'yes_no', knockout_message: 'Sorry.' },
    true,
  );

  // --- applications ---------------------------------------------------------------------------------
  await seed(
    'applications',
    'app1',
    {
      workspace_id: wsA,
      opportunity_id: id('opp1'),
      competition_id: id('comp1'),
      applicant_org_id: id('org1'),
      applicant_user_id: u('applicant'),
      reference_number: 'RLS-2026-0001',
      title: 'Murals for the river',
      status: 'under_review',
      requested_amount_cents: 2_500_000,
      submitted_at: sql`now() - interval '1 day'`,
    },
    true,
  );
  await seed(
    'form_responses',
    'response1',
    { workspace_id: wsA, application_id: id('app1'), form_id: id('form1'), form_version_id: id('fv1'), data: json({ name: 'Maya', mission: 'Murals' }) },
    true,
  );
  await seed(
    'application_submissions',
    'submission1',
    {
      workspace_id: wsA,
      application_id: id('app1'),
      competition_id: id('comp1'),
      submitted_by: u('applicant'),
      responses: json({ [id('form1')]: { name: 'Maya', mission: 'Murals' } }),
      org_profile: json({ legalName: 'Riverbend Arts Collective' }),
      form_versions: json([{ formVersionId: id('fv1') }]),
      receipt_number: 'RCPT-0001',
      content_hash: 'sha256:abc',
    },
    true,
  );
  await seed(
    'application_collaborators',
    'collab1',
    { workspace_id: wsA, application_id: id('app1'), user_id: u('collaborator'), email: users.collaborator.email, role: 'editor', status: 'active', invited_by: u('applicant') },
    true,
  );
  await seed('application_comments', 'comment1', { workspace_id: wsA, application_id: id('app1'), author_id: u('applicant'), body: 'Check budget' }, true);
  await seed(
    'attachments',
    'attachment1',
    {
      workspace_id: wsA,
      application_id: id('app1'),
      file_name: 'budget.pdf',
      content_type: 'application/pdf',
      size_bytes: 2048,
      storage_path: 'apps/app1/budget.pdf',
      status: 'uploaded',
      uploaded_by: u('applicant'),
    },
    true,
  );
  await seed(
    'eligibility_results',
    'elig1',
    { workspace_id: wsA, application_id: id('app1'), rule_id: id('rule1'), question: 'Are you a nonprofit?', passed: true, answer: json(true) },
    true,
  );
  await seed(
    'status_history',
    'history1',
    { workspace_id: wsA, application_id: id('app1'), from_status: 'submitted', to_status: 'under_review', actor_id: u('programOfficerA'), actor_name: 'Pat Officer' },
    true,
  );
  await seed(
    'applicant_extensions',
    'extension1',
    { workspace_id: wsA, application_id: id('app1'), new_deadline: sql`now() + interval '40 days'`, granted_by: u('programOfficerA') },
    true,
  );
  await seed(
    'demographic_responses',
    'demo1',
    { workspace_id: wsA, application_id: id('app1'), applicant_org_id: id('org1'), data: json({ bipoc_led: true }) },
    true,
  );

  // --- review -----------------------------------------------------------------------------------------
  await seed('rubrics', 'rubric1', { workspace_id: wsA, name: 'Standard', status: 'active' }, true);
  await seed('rubric_criteria', 'criterion1', { workspace_id: wsA, rubric_id: id('rubric1'), position: 1, label: 'Impact', weight_pct: 60 }, true);
  await seed('rubric_criteria', 'criterion2', { workspace_id: wsA, rubric_id: id('rubric1'), position: 2, label: 'Feasibility', weight_pct: 40 });
  await seed('review_stages', 'stage1', { workspace_id: wsA, competition_id: id('comp1'), rubric_id: id('rubric1'), name: 'Panel', blind: true, status: 'active' }, true);
  await seed('review_stages', 'stage2', { workspace_id: wsA, competition_id: id('comp1'), rubric_id: id('rubric1'), name: 'Second look', position: 2, status: 'active' });
  await seed(
    'review_assignments',
    'assignment1',
    { workspace_id: wsA, stage_id: id('stage1'), application_id: id('app1'), reviewer_id: u('reviewerA'), status: 'in_progress', assigned_by: u('programOfficerA') },
    true,
  );
  // Second assignment for reviewerA (no COI yet, no review yet): target for clone probes.
  await seed('review_assignments', 'assignment2', {
    workspace_id: wsA,
    stage_id: id('stage2'),
    application_id: id('app1'),
    reviewer_id: u('reviewerA'),
    assigned_by: u('programOfficerA'),
  });
  await seed(
    'coi_declarations',
    'coi1',
    { workspace_id: wsA, assignment_id: id('assignment1'), reviewer_id: u('reviewerA'), has_conflict: false },
    true,
  );
  await seed('reviews', 'review1', { workspace_id: wsA, assignment_id: id('assignment1'), status: 'in_progress', overall_comment: 'Promising' }, true);
  await seed('review_scores', 'score1', { workspace_id: wsA, review_id: id('review1'), criterion_id: id('criterion1'), score: 4 }, true);
  await seed('panels', 'panel1', { workspace_id: wsA, stage_id: id('stage1'), name: 'Arts panel' }, true);
  await seed('panel_notes', 'panelnote1', { workspace_id: wsA, panel_id: id('panel1'), application_id: id('app1'), author_id: u('programOfficerA'), body: 'Discuss' }, true);

  // --- decisions, dockets, awards -------------------------------------------------------------------------
  await seed(
    'decisions',
    'decision1',
    { workspace_id: wsA, application_id: id('app1'), outcome: 'approve', is_final: true, recorded_by: u('programOfficerA'), recommended_amount_cents: 2_000_000 },
    true,
  );
  await seed('dockets', 'docket1', { workspace_id: wsA, name: 'October board', status: 'in_session', created_by: u('programOfficerA') }, true);
  await seed('dockets', 'docket2', { workspace_id: wsA, name: 'November board', status: 'in_session', created_by: u('programOfficerA') });
  await seed('docket_items', 'item1', { workspace_id: wsA, docket_id: id('docket1'), application_id: id('app1'), recommended_amount_cents: 2_000_000 }, true);
  await seed('docket_items', 'item2', { workspace_id: wsA, docket_id: id('docket2'), application_id: id('app1') });
  await seed('dockets', 'docket3', { workspace_id: wsA, name: 'December board', status: 'draft', created_by: u('programOfficerA') });
  await seed('votes', 'vote1', { workspace_id: wsA, docket_item_id: id('item1'), voter_id: u('boardA'), vote: 'approve' }, true);

  const awardBase = {
    workspace_id: wsA,
    program_id: id('program1'),
    opportunity_id: id('opp1'),
    applicant_org_id: id('org1'),
    status: 'active',
    created_by: u('programOfficerA'),
  };
  await seed('awards', 'award1', { ...awardBase, application_id: id('app1'), reference: 'AWD-0001', title: 'Murals for the river', amount_cents: 2_000_000 });
  await seed('awards', 'award2', { ...awardBase, reference: 'AWD-0002', title: 'Spare award', amount_cents: 500_000 });
  await seed('awards', 'awardLeaf', { ...awardBase, reference: 'AWD-0003', title: 'Leaf award', amount_cents: 100_000 }, true);
  rows.public_awards = { id: id('award1') };
  rows.public_programs = { id: id('program1') };
  await seed('opportunity_subscriptions', 'oppSub1', { workspace_id: wsA, opportunity_id: id('opp1'), user_id: u('applicant') }, true);
  await seed('award_conditions', 'condition1', { workspace_id: wsA, award_id: id('award1'), body: 'Send a W-9' }, true);
  const agreementBase = { workspace_id: wsA, award_id: id('award1'), status: 'sent', document_hash: 'sha256:agreement', body_md: 'Terms', created_by: u('programOfficerA') };
  await seed('agreements', 'agreement1', agreementBase);
  await seed('agreements', 'agreementLeaf', agreementBase, true);
  await seed('agreements', 'agreement3', agreementBase);
  await seed(
    'signatures',
    'signature1',
    {
      workspace_id: wsA,
      agreement_id: id('agreement1'),
      signer_id: u('applicant'),
      signer_role: 'grantee',
      typed_name: 'Maya Applicant',
      attestation: 'I agree',
      document_hash: 'sha256:agreement',
    },
    true,
  );

  // --- money -------------------------------------------------------------------------------------------------
  await seed('bank_connections', 'bankconn1', { workspace_id: wsA, provider: 'mercury', connected_by: u('financeA') }, true);
  await seed('bank_accounts', 'bankacct1', { workspace_id: wsA, connection_id: id('bankconn1'), provider_account_id: 'acct-1', name: 'Operating', mask: '1234' }, true);
  await seed('program_accounts', 'progacct1', { workspace_id: wsA, program_id: id('program1'), bank_account_id: id('bankacct1') }, true);
  await seed('payees', 'payee1', { workspace_id: wsA, applicant_org_id: id('org1'), status: 'ready', contact_email: 'pay@org1.rls.example' }, true);
  await seed('payment_schedules', 'schedule1', { workspace_id: wsA, award_id: id('award1'), created_by: u('financeA') }, true);
  await seed(
    'installments',
    'installment1',
    { workspace_id: wsA, schedule_id: id('schedule1'), award_id: id('award1'), position: 1, due_date: '2026-10-01', amount_cents: 1_000_000 },
    true,
  );
  const batchBase = { workspace_id: wsA, method: 'ach', status: 'awaiting_approval', created_by: u('financeA'), total_cents: 1000 };
  await seed('payment_batches', 'batch1', { ...batchBase, name: 'Batch 1' }, true);
  await seed('payment_batches', 'batch2', { ...batchBase, name: 'Batch 2' });
  await seed('payment_batches', 'batch3', { ...batchBase, name: 'Batch 3' });
  await seed(
    'payments',
    'payment1',
    { workspace_id: wsA, award_id: id('award1'), installment_id: id('installment1'), amount_cents: 1000, status: 'scheduled', created_by: u('financeA') },
    true,
  );
  await seed('payment_approvals', 'approval:batch2', { workspace_id: wsA, batch_id: id('batch2'), approver_id: u('adminA'), decision: 'approve', aal: 'aal2' }, true);
  await seed(
    'rail_events',
    'railevent1',
    { workspace_id: wsA, provider: 'mercury', event_id: 'evt-a-1', event_type: 'transaction.updated', payload: json({}), signature_valid: true },
    true,
  );
  await seed(
    'bank_transactions',
    'banktx1',
    { workspace_id: wsA, bank_account_id: id('bankacct1'), provider_transaction_id: 'tx-a-1', amount_cents: -1000, status: 'sent', payment_id: id('payment1') },
    true,
  );
  await seed(
    'recon_exceptions',
    'recon1',
    { workspace_id: wsA, kind: 'amount_mismatch', bank_transaction_id: id('banktx1'), payment_id: id('payment1'), details: 'Off by 1' },
    true,
  );

  // --- post-award, comms, compliance ---------------------------------------------------------------------------
  await seed('report_requirements', 'requirement1', { workspace_id: wsA, award_id: id('award1'), title: 'Interim report', due_date: '2027-01-31' }, true);
  await seed(
    'report_submissions',
    'report1',
    { workspace_id: wsA, requirement_id: id('requirement1'), award_id: id('award1'), data: json({ summary: 'Going well' }), status: 'draft', submitted_by: u('applicant') },
    true,
  );
  await seed('indicators', 'indicator1', { workspace_id: wsA, program_id: id('program1'), name: 'Murals painted' }, true);
  await seed('indicator_values', 'indval1', { workspace_id: wsA, indicator_id: id('indicator1'), award_id: id('award1'), value: 3 }, true);
  await seed(
    'site_visits',
    'visit1',
    { workspace_id: wsA, applicant_org_id: id('org1'), award_id: id('award1'), visited_on: '2026-09-01', visited_by: u('programOfficerA'), summary: 'Good' },
    true,
  );
  await seed(
    'change_requests',
    'change1',
    { workspace_id: wsA, award_id: id('award1'), kind: 'extension', reason: 'Weather', requested_by: u('applicant') },
    true,
  );
  await seed('threads', 'thread1', { workspace_id: wsA, application_id: id('app1'), subject: 'Budget question', created_by: u('programOfficerA') }, true);
  await seed(
    'messages',
    'message1',
    { workspace_id: wsA, thread_id: id('thread1'), author_id: u('programOfficerA'), author_side: 'staff', body: 'Can you clarify line 4?' },
    true,
  );
  await seed('email_templates', 'template-email1', { workspace_id: wsA, key: 'award_letter', name: 'Award letter', subject: 'Congrats', body_md: 'Hi' }, true);
  await seed('notification_rules', 'rule-notify1', { workspace_id: wsA, event_type: 'application.submitted', channel: 'email', audience: 'program_officer' }, true);
  await seed('bulk_messages', 'bulk1', { workspace_id: wsA, subject: 'Reminder', body_md: 'Deadline soon', created_by: u('programOfficerA') }, true);
  await seed(
    'email_deliveries',
    'delivery-email1',
    { workspace_id: wsA, bulk_message_id: id('bulk1'), to_email: 'maya@rls.example', subject: 'Reminder', provider: 'dev' },
    true,
  );
  await seed(
    'email_events',
    'emailevent1',
    { workspace_id: wsA, delivery_id: id('delivery-email1'), provider: 'dev', provider_event_id: 'ev-a-1', event: 'delivered' },
    true,
  );
  await put(db, 'irs_exempt_orgs', { ein: '12-3456789', name: 'RIVERBEND ARTS COLLECTIVE', status: 'active', pub78: true });
  rows.irs_exempt_orgs = { ein: '12-3456789' };
  await seed('sanctions_entries', 'sanction1', { source_uid: 'sdn-1', name: 'Bad Actor LLC', name_normalized: 'bad actor' }, true);
  await seed(
    'sanctions_screenings',
    'screening1',
    { workspace_id: wsA, applicant_org_id: id('org1'), award_id: id('award1'), context: 'award', query_name: 'Riverbend Arts Collective', status: 'clear' },
    true,
  );
  await seed(
    'diligence_checks',
    'diligence1',
    { workspace_id: wsA, applicant_org_id: id('org1'), award_id: id('award1'), kind: 'irs_status', status: 'pass' },
    true,
  );

  const userId = (p: Principal): string | null => (p === 'anon' ? null : users[p].id);
  const claims = (p: Principal): RequestClaims => {
    if (p === 'anon') return { role: 'anon' };
    const user = users[p];
    // Staff sessions are MFA'd (workspace_members.mfa_required); applicants are aal1.
    return { role: 'authenticated', sub: user.id, email: user.email, aal: STAFF_ROLE[p] || p === 'adminB' ? 'aal2' : 'aal1' };
  };
  return { wsA, wsB, users, ids, rows, claims, userId };
}
