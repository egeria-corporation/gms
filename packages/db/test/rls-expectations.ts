// SPDX-License-Identifier: AGPL-3.0-only
// The RLS matrix: for every public table (and the public_awards view), which principals may
// select / insert / update / delete the workspace-A row seeded by world.ts. Everyone not listed
// must be denied. Used by rls-matrix.db.test.ts and scripts/rls-report.ts.
//
// Adding a table = one entry in MATRIX (the coverage test fails until you do).
import { PRINCIPALS, STAFF_ROLE, type Principal, type World } from './world';

export const OPS = ['select', 'insert', 'update', 'delete'] as const;
export type Op = (typeof OPS)[number];
export type Row = Record<string, unknown>;

export interface TableSpec {
  table: string;
  kind?: 'table' | 'view';
  /** Principals allowed per op; all others must be denied. Views only use select. */
  allow: Record<Op, readonly Principal[]>;
  /** Adjusts the cloned row for insert probes (unique columns, alternate parents). */
  clone?: (row: Row, w: World) => Row;
  /** Columns set to the probing principal's user id in the clone (who is "doing" the insert). */
  actor?: readonly string[];
  /** SET clause for update probes (a harmless change). Default: last_modified_at = now(). */
  update?: string;
  /** Service-role SQL run (inside the probe transaction) before an insert / delete probe. */
  prepInsert?: (w: World) => string;
  prepDelete?: (w: World) => string;
  /** Why the expectations look the way they do (shown in docs/rls-coverage.md). */
  note?: string;
}

// ---------------------------------------------------------------------------------------------
// Principal groups
// ---------------------------------------------------------------------------------------------
const byRole = (...roles: string[]): Principal[] => PRINCIPALS.filter((p) => roles.includes(STAFF_ROLE[p] ?? ''));
export const ALL: readonly Principal[] = PRINCIPALS;
export const SIGNED_IN: readonly Principal[] = PRINCIPALS.filter((p) => p !== 'anon');
const NONE: readonly Principal[] = [];
/** gms.is_staff(): owner, admin, program_officer, finance, auditor. */
const STAFF = byRole('owner', 'admin', 'program_officer', 'finance', 'auditor');
const OA = byRole('owner', 'admin');
const OAP = byRole('owner', 'admin', 'program_officer');
const OAF = byRole('owner', 'admin', 'finance');
const OAPF = byRole('owner', 'admin', 'program_officer', 'finance');
const FIN_READ = byRole('owner', 'admin', 'finance', 'auditor');
const ADMIN_READ = byRole('owner', 'admin', 'auditor');
const REVIEW_READ = byRole('owner', 'admin', 'program_officer', 'auditor', 'reviewer');
const WS_MEMBERS = byRole('owner', 'admin', 'program_officer', 'finance', 'reviewer', 'board', 'auditor');
const APPLICANT_SIDE: Principal[] = ['applicant', 'collaborator'];

const allow = (select: readonly Principal[], insert: readonly Principal[] = NONE, update = insert, del = insert): TableSpec['allow'] => ({
  select,
  insert,
  update,
  delete: del,
});
const staffTable = (read: readonly Principal[], write: readonly Principal[] | null): TableSpec['allow'] => allow(read, write ?? NONE);
const readOnly = (read: readonly Principal[]) => allow(read, NONE, NONE, NONE);

export const MATRIX: readonly TableSpec[] = [
  // --- tenancy & identity -------------------------------------------------------------------
  { table: 'workspaces', allow: allow(ALL, NONE, OA, NONE), clone: (r) => ({ ...r, slug: 'rls-a-clone' }), note: 'Active workspaces are public (site/branding).' },
  {
    table: 'workspace_settings',
    allow: allow(byRole('owner', 'admin', 'program_officer', 'finance', 'auditor'), NONE, OA, NONE),
    prepInsert: (w) => `delete from public.workspace_settings where workspace_id = '${w.wsA}'`,
    note: 'One row per workspace, created by trigger.',
  },
  { table: 'workspace_domains', allow: staffTable(ADMIN_READ, OA), clone: (r) => ({ ...r, hostname: 'clone.a.rls.example' }) },
  {
    table: 'profiles',
    allow: allow(['applicant', ...STAFF], NONE, ['applicant'], NONE),
    update: 'full_name = full_name',
    clone: (r, w) => ({ ...r, id: w.users.ghostId, email: 'ghost@rls.example' }),
    note: "Seeded row is the applicant's profile: visible to self and to staff of workspaces the applicant applied to; never to reviewers.",
  },
  {
    table: 'workspace_members',
    allow: allow(WS_MEMBERS, OA),
    clone: (r, w) => ({ ...r, user_id: w.users.spare.id }),
    note: "Seeded row is reviewerA2's membership.",
  },
  {
    table: 'invitations',
    allow: allow([...ADMIN_READ, 'outsider'], OA),
    clone: (r) => ({ ...r, token_hash: 'inv-hash-clone' }),
    note: 'The invitee (outsider, matched by email) sees their pending invitation.',
  },
  {
    table: 'workspace_brand',
    allow: allow(ALL, OA, OA, NONE),
    prepInsert: (w) => `delete from public.workspace_brand where workspace_id = '${w.wsA}'`,
  },
  { table: 'api_keys', allow: staffTable(ADMIN_READ, OA), clone: (r) => ({ ...r, key_hash: 'apikey-hash-clone' }) },
  {
    table: 'platform_operators',
    allow: readOnly(NONE),
    update: 'role = role',
    clone: (r, w) => ({ ...r, user_id: w.users.spare.id }),
    note: 'Operators see only their own row; managed by service.',
  },
  { table: 'support_access_grants', allow: staffTable(ADMIN_READ, OA) },

  // --- applicant commons ------------------------------------------------------------------------
  {
    table: 'applicant_orgs',
    allow: allow(['applicant', ...STAFF], SIGNED_IN, ['applicant'], NONE),
    actor: ['created_by'],
    clone: (r) => ({ ...r, ein: null }),
    note: 'Anyone signed in can create an org (as its creator).',
  },
  {
    table: 'applicant_org_members',
    allow: allow(['applicant', ...STAFF], ['applicant']),
    clone: (r, w) => ({ ...r, user_id: w.users.spare.id, role: 'collaborator' }),
  },
  { table: 'org_addresses', allow: allow(['applicant', ...STAFF], ['applicant']), clone: (r) => ({ ...r, kind: 'physical' }) },
  { table: 'org_documents', allow: allow(['applicant', ...STAFF], ['applicant']), actor: ['uploaded_by'] },

  // --- platform --------------------------------------------------------------------------------
  { table: 'audit_log', allow: readOnly(STAFF), update: 'action = action', note: 'Append-only; written via gms_private.append_audit.' },
  { table: 'outbox', allow: readOnly(NONE), update: 'attempts = attempts', note: 'Service only.' },
  { table: 'dev_outbox', allow: readOnly(NONE), update: 'subject = subject', note: 'Service only.' },
  {
    table: 'idempotency_keys',
    allow: readOnly(NONE),
    update: 'response = response',
    clone: (r) => ({ ...r, key: 'idem-clone' }),
    note: 'Service only (written via gms_private.store_idempotency).',
  },
  { table: 'rate_limit_buckets', allow: readOnly(NONE), update: 'count = count', clone: (r) => ({ ...r, key: 'clone' }), note: 'Service only.' },
  { table: 'webhook_endpoints', allow: staffTable(ADMIN_READ, OA) },
  { table: 'webhook_deliveries', allow: readOnly(ADMIN_READ) },
  { table: 'exports', allow: allow([...ADMIN_READ, 'programOfficerA'], STAFF, NONE, NONE), actor: ['requested_by'] },
  { table: 'custom_field_definitions', allow: staffTable(STAFF, OA), clone: (r) => ({ ...r, key: 'regionClone' }) },
  { table: 'saved_views', allow: allow(STAFF, STAFF, ['programOfficerA'], ['programOfficerA']), actor: ['user_id'] },
  { table: 'notifications', allow: allow(['programOfficerA'], NONE, ['programOfficerA'], NONE), update: 'read_at = now()' },
  { table: 'internal_notes', allow: staffTable(STAFF, OAPF), actor: ['author_id'] },
  {
    table: 'grantee_profiles',
    allow: staffTable(STAFF, OAP),
    prepInsert: (w) => `delete from public.grantee_profiles where id = '${w.ids.granteeProfile1}'`,
    note: "The workspace's own CRM data about an applicant organization (tags, relationship owner).",
  },
  {
    table: 'application_duplicate_dismissals',
    allow: staffTable(STAFF, OAP),
    actor: ['dismissed_by'],
    prepInsert: (w) => `delete from public.application_duplicate_dismissals where id = '${w.ids.dupDismiss1}'`,
    note: '"Not a duplicate" decisions made on the pipeline.',
  },

  // --- agents ------------------------------------------------------------------------------------
  {
    table: 'agent_clients',
    allow: allow([...STAFF, 'applicant'], OA, OA, NONE),
    clone: (r) => ({ ...r, client_id: 'client-a-clone' }),
    note: 'Applicant sees the client through their agent_grant.',
  },
  { table: 'agent_grants', allow: allow(['applicant', ...ADMIN_READ], SIGNED_IN, ['applicant'], NONE), actor: ['user_id'] },
  {
    table: 'personal_access_tokens',
    allow: allow(['programOfficerA'], SIGNED_IN, ['programOfficerA'], NONE),
    actor: ['user_id'],
    clone: (r) => ({ ...r, token_hash: 'pat-hash-clone' }),
  },
  {
    table: 'oauth_authorization_codes',
    allow: readOnly(NONE),
    update: 'used_at = used_at',
    clone: (r) => ({ ...r, code_hash: 'code-hash-clone' }),
    note: 'Service only.',
  },
  { table: 'oauth_pending_authorizations', allow: readOnly(NONE), update: 'state = state', note: 'Service only.' },
  { table: 'agent_tasks', allow: readOnly(['applicant', ...STAFF]) },
  {
    table: 'approval_requests',
    allow: allow(['applicant', ...ADMIN_READ], SIGNED_IN, NONE, NONE),
    actor: ['on_behalf_of'],
    note: 'Anyone may file a request on their own behalf; decisions (confirm/reject/expire) are recorded by the service only.',
  },
  {
    table: 'agent_policies',
    allow: allow(ALL, NONE, OA, NONE),
    prepInsert: (w) => `delete from public.agent_policies where workspace_id = '${w.wsA}'`,
    note: 'Anon can read every column except llm_key_ref.',
  },

  // --- programs, forms, opportunities -------------------------------------------------------------
  { table: 'programs', allow: staffTable([...STAFF, 'boardA'], OAP), clone: (r) => ({ ...r, slug: 'arts-clone' }) },
  { table: 'program_budgets', allow: staffTable([...STAFF, 'boardA'], OAF), clone: (r) => ({ ...r, fiscal_year: 2027 }) },
  { table: 'taxonomy_terms', allow: allow(ALL, OA), clone: (r) => ({ ...r, code: 'arts-clone' }) },
  {
    table: 'forms',
    allow: allow(ALL, OAP, OAP, NONE),
    prepDelete: (w) =>
      `delete from public.competition_forms where form_id = '${w.ids.form1}'; delete from public.form_responses where form_id = '${w.ids.form1}'`,
    note: 'Attached to a public competition, so public. Deleting cascades into its published version, which is immutable.',
  },
  {
    table: 'form_versions',
    allow: allow(ALL, OAP, NONE, NONE),
    clone: (r) => ({ ...r, version: 2 }),
    note: 'Seeded version is published: immutable for everyone (only published -> retired with identical content).',
  },
  { table: 'question_bank_items', allow: staffTable(STAFF, OAP) },
  { table: 'form_templates', allow: staffTable(STAFF, OAP) },
  { table: 'opportunities', allow: allow(ALL, OAP), clone: (r) => ({ ...r, slug: 'leaf-clone' }) },
  { table: 'competitions', allow: allow(ALL, OAP), clone: (r) => ({ ...r, stage_order: 2 }) },
  {
    table: 'competition_forms',
    allow: allow(ALL, OAP),
    clone: (r, w) => ({ ...r, form_id: w.ids.form2, form_version_id: null }),
  },
  { table: 'competition_invites', allow: allow([...byRole('owner', 'admin', 'program_officer', 'auditor'), 'applicant'], OAP) },
  { table: 'eligibility_rules', allow: allow(ALL, OAP) },

  // --- applications ---------------------------------------------------------------------------------
  {
    table: 'applications',
    allow: allow([...STAFF, ...APPLICANT_SIDE, 'reviewerA', 'boardA'], ['applicant'], [...OAP, ...APPLICANT_SIDE], NONE),
    actor: ['applicant_user_id'],
    clone: (r) => ({ ...r, reference_number: 'RLS-2026-CLONE', status: 'in_progress', submitted_at: null }),
    note: 'app1 is under_review. Cleared reviewerA and board (non-draft) can see the row; content is separate.',
  },
  {
    table: 'form_responses',
    allow: allow([...STAFF, ...APPLICANT_SIDE], NONE, NONE, NONE),
    clone: (r, w) => ({ ...r, form_id: w.ids.form2 }),
    note: 'Editable only while in_progress; reviewers read content via gms.reviewer_submission().',
  },
  {
    table: 'application_submissions',
    allow: allow([...STAFF, ...APPLICANT_SIDE], NONE, NONE, NONE),
    update: 'receipt_number = receipt_number',
    actor: ['submitted_by'],
    clone: (r) => ({ ...r, receipt_number: 'RCPT-CLONE' }),
    note: 'Append-only; new snapshots only while the application is in_progress (fix 0700).',
  },
  {
    table: 'application_collaborators',
    allow: allow([...STAFF, ...APPLICANT_SIDE], APPLICANT_SIDE),
    clone: (r) => ({ ...r, email: 'clone-collab@rls.example', user_id: null }),
  },
  { table: 'application_comments', allow: allow(APPLICANT_SIDE, APPLICANT_SIDE, APPLICANT_SIDE, NONE), actor: ['author_id'] },
  {
    table: 'attachments',
    allow: allow([...STAFF, ...APPLICANT_SIDE, 'reviewerA'], NONE, OAP, NONE),
    actor: ['uploaded_by'],
    clone: (r) => ({ ...r, storage_path: 'apps/app1/clone.pdf' }),
    note: 'app1 is no longer editable, so applicants cannot add or modify its attachments.',
  },
  {
    table: 'eligibility_results',
    allow: allow([...STAFF, ...APPLICANT_SIDE], [...APPLICANT_SIDE, ...OAP], NONE, NONE),
    update: 'passed = passed',
  },
  {
    table: 'status_history',
    allow: allow([...STAFF, ...APPLICANT_SIDE], OAP, NONE, NONE),
    update: 'reason = reason',
    actor: ['actor_id'],
    note: 'Append-only. Applicant editors may only record their own submitted/withdrawn transition (fix 0700).',
  },
  {
    table: 'applicant_extensions',
    allow: allow([...byRole('owner', 'admin', 'program_officer', 'auditor'), ...APPLICANT_SIDE], OAP),
    update: 'new_deadline = new_deadline',
  },
  {
    table: 'demographic_responses',
    allow: allow(APPLICANT_SIDE, APPLICANT_SIDE, APPLICANT_SIDE, NONE),
    note: 'Never readable row-by-row by staff.',
  },

  // --- review -----------------------------------------------------------------------------------------
  { table: 'rubrics', allow: staffTable(REVIEW_READ, OAP) },
  { table: 'rubric_criteria', allow: staffTable(REVIEW_READ, OAP) },
  { table: 'review_stages', allow: staffTable(REVIEW_READ, OAP) },
  {
    table: 'review_assignments',
    allow: allow([...byRole('owner', 'admin', 'program_officer', 'auditor'), 'reviewerA'], OAP, [...OAP, 'reviewerA'], OAP),
    clone: (r, w) => ({ ...r, reviewer_id: w.users.reviewerA2.id }),
  },
  {
    table: 'coi_declarations',
    allow: allow([...byRole('owner', 'admin', 'program_officer', 'auditor'), 'reviewerA'], ['reviewerA'], NONE, NONE),
    update: 'explanation = explanation',
    actor: ['reviewer_id'],
    clone: (r, w) => ({ ...r, assignment_id: w.ids.assignment2 }),
  },
  {
    table: 'reviews',
    allow: allow([...byRole('owner', 'admin', 'program_officer', 'auditor'), 'reviewerA'], ['reviewerA'], ['reviewerA'], NONE),
    clone: (r, w) => ({ ...r, assignment_id: w.ids.assignment2 }),
  },
  {
    table: 'review_scores',
    allow: allow([...byRole('owner', 'admin', 'program_officer', 'auditor'), 'reviewerA'], ['reviewerA']),
    clone: (r, w) => ({ ...r, criterion_id: w.ids.criterion2 }),
  },
  { table: 'panels', allow: staffTable(REVIEW_READ, OAP) },
  {
    table: 'panel_notes',
    allow: allow([...byRole('owner', 'admin', 'program_officer', 'auditor'), 'reviewerA'], [...OAP, 'reviewerA'], OAP, OAP),
    actor: ['author_id'],
  },

  // --- decisions & awards ---------------------------------------------------------------------------------
  { table: 'decisions', allow: allow([...STAFF, 'boardA', ...APPLICANT_SIDE], OAP), note: 'Applicants see final decisions.' },
  { table: 'dockets', allow: staffTable([...STAFF, 'boardA'], OAP) },
  { table: 'docket_items', allow: staffTable([...STAFF, 'boardA'], OAP), clone: (r, w) => ({ ...r, docket_id: w.ids.docket3 }) },
  {
    table: 'votes',
    allow: allow([...byRole('owner', 'admin', 'program_officer', 'auditor'), 'boardA'], ['boardA'], ['boardA'], NONE),
    update: 'vote = vote',
    note: 'Board members vote (and may change their own vote) only while the docket is in session.',
    actor: ['voter_id'],
    clone: (r, w) => ({ ...r, docket_item_id: w.ids.item2 }),
  },
  {
    table: 'awards',
    allow: allow([...STAFF, 'boardA', 'applicant'], OAPF),
    clone: (r) => ({ ...r, reference: 'AWD-CLONE' }),
    note: 'Grantee org members see their non-draft awards.',
  },
  { table: 'award_conditions', allow: allow([...STAFF, 'applicant'], OAP) },
  {
    table: 'agreements',
    allow: allow([...STAFF, 'applicant'], OAP, [...OAP, 'applicant'], OAP),
    note: 'Grantee org admin may only sign (sent -> signed); content changes are blocked (fix 0700).',
  },
  {
    table: 'signatures',
    allow: allow([...STAFF, 'applicant'], ['applicant'], NONE, NONE),
    update: 'typed_name = typed_name',
    actor: ['signer_id'],
    clone: (r, w) => ({ ...r, agreement_id: w.ids.agreement3 }),
    note: 'Append-only.',
  },

  // --- money (finance-only) ----------------------------------------------------------------------------------
  { table: 'bank_connections', allow: staffTable(FIN_READ, OAF) },
  { table: 'bank_accounts', allow: staffTable(FIN_READ, OAF), clone: (r) => ({ ...r, provider_account_id: 'acct-clone' }) },
  { table: 'program_accounts', allow: staffTable(FIN_READ, OAF), clone: (r, w) => ({ ...r, program_id: w.ids.program2 }) },
  { table: 'payees', allow: allow([...FIN_READ, 'applicant'], OAF), clone: (r) => ({ ...r, provider: 'manual' }), note: 'Grantee sees its own payee.' },
  {
    table: 'payment_schedules',
    allow: staffTable([...FIN_READ, 'programOfficerA'], [...OAF, 'programOfficerA']),
    clone: (r, w) => ({ ...r, award_id: w.ids.award2 }),
  },
  {
    table: 'installments',
    allow: allow([...FIN_READ, 'programOfficerA', 'applicant'], [...OAF, 'programOfficerA']),
    clone: (r) => ({ ...r, position: 2 }),
  },
  {
    table: 'payment_batches',
    allow: staffTable(FIN_READ, OAF),
    actor: ['created_by'],
    note: 'Approval columns can only follow recorded payment_approvals (fix 0700).',
  },
  {
    table: 'payments',
    allow: allow([...FIN_READ, 'applicant'], OAF),
    clone: (r) => ({ ...r, idempotency_key: 'idem-pay-clone' }),
    note: 'Grantee sees its own payments.',
  },
  {
    table: 'payment_approvals',
    allow: allow(FIN_READ, OA, NONE, NONE),
    update: 'note = note',
    actor: ['approver_id'],
    clone: (r, w) => ({ ...r, batch_id: w.ids.batch3 }),
    note: 'Append-only; aal2 required; financeA created batch3 so maker-checker denies it.',
  },
  { table: 'rail_events', allow: readOnly(FIN_READ), update: 'error = error', clone: (r) => ({ ...r, event_id: 'evt-clone' }) },
  { table: 'bank_transactions', allow: staffTable(FIN_READ, OAF), clone: (r) => ({ ...r, provider_transaction_id: 'tx-clone' }) },
  { table: 'recon_exceptions', allow: staffTable(FIN_READ, OAF) },

  // --- post-award ------------------------------------------------------------------------------------------------
  { table: 'report_requirements', allow: allow([...STAFF, 'applicant'], OAP) },
  { table: 'report_submissions', allow: allow([...STAFF, 'applicant'], [...OAP, 'applicant'], [...OAP, 'applicant'], OAP) },
  { table: 'indicators', allow: staffTable([...STAFF, 'boardA'], OAP) },
  { table: 'indicator_values', allow: allow([...STAFF, 'boardA', 'applicant'], [...OAP, 'applicant'], OAP, OAP) },
  { table: 'site_visits', allow: staffTable(byRole('owner', 'admin', 'program_officer', 'auditor'), OAP) },
  { table: 'change_requests', allow: allow([...STAFF, 'applicant'], [...OAP, 'applicant'], OAP, OAP), actor: ['requested_by'] },

  // --- communications -----------------------------------------------------------------------------------------------
  {
    table: 'threads',
    allow: allow([...STAFF, ...APPLICANT_SIDE], [...OAPF, ...APPLICANT_SIDE], [...OAPF, ...APPLICANT_SIDE], OAPF),
    actor: ['created_by'],
  },
  {
    table: 'messages',
    allow: allow([...STAFF, ...APPLICANT_SIDE], OAPF, [...OAPF, ...APPLICANT_SIDE], OAPF),
    update: 'read_by_applicant_at = now()',
    actor: ['author_id'],
    note: "Seeded message is staff-authored; applicants may only mark it read (fix 0700).",
  },
  { table: 'email_templates', allow: staffTable(STAFF, OAP), clone: (r) => ({ ...r, key: 'award_letter_clone' }) },
  { table: 'notification_rules', allow: staffTable(byRole('owner', 'admin', 'program_officer', 'auditor'), OA) },
  { table: 'bulk_messages', allow: staffTable(byRole('owner', 'admin', 'program_officer', 'auditor'), OAP) },
  { table: 'email_deliveries', allow: readOnly(byRole('owner', 'admin', 'program_officer', 'auditor')) },
  {
    table: 'email_events',
    allow: readOnly(byRole('owner', 'admin', 'program_officer', 'auditor')),
    update: 'payload = payload',
    clone: (r) => ({ ...r, provider_event_id: 'ev-clone' }),
  },

  // --- compliance -------------------------------------------------------------------------------------------------------
  { table: 'irs_exempt_orgs', allow: readOnly(ALL), update: 'name = name', clone: (r) => ({ ...r, ein: '11-1111111' }) },
  {
    table: 'sanctions_entries',
    allow: readOnly([...STAFF, 'adminB']),
    update: 'name = name',
    clone: (r) => ({ ...r, source_uid: 'sdn-clone' }),
    note: 'Global list readable by staff of any workspace.',
  },
  { table: 'sanctions_screenings', allow: staffTable(STAFF, OAPF) },
  { table: 'diligence_checks', allow: staffTable(STAFF, OAPF) },

  {
    table: 'opportunity_subscriptions',
    allow: allow([...byRole('owner', 'admin', 'program_officer', 'auditor'), 'applicant'], SIGNED_IN.filter((p) => p !== 'anon'), NONE, ['applicant']),
    actor: ['user_id'],
    // The seeded row is the applicant's subscription to opp1; probe inserts target another public opportunity.
    clone: (r, w) => ({ ...r, opportunity_id: w.ids.oppLeaf }),
    update: 'notified_at = notified_at',
    note: 'People subscribe themselves to a public forecasted opportunity; staff can see subscriber counts.',
  },

  // --- views ----------------------------------------------------------------------------------------------------------------
  {
    table: 'public_awards',
    kind: 'view',
    allow: allow(ALL, NONE, NONE, NONE),
    note: 'Column-limited public transparency view (bypasses RLS by design).',
  },
  {
    table: 'public_programs',
    kind: 'view',
    allow: allow(ALL, NONE, NONE, NONE),
    note: 'Names of active programs that have a published opportunity (public site, CommonGrants customFields).',
  },

  // --- analytics (M8): read-only views over analytics.* matviews, filtered by gms.is_staff(workspace_id) ------
  ...[
    'analytics_pipeline_funnel',
    'analytics_time_in_stage',
    'analytics_budget_by_program',
    'analytics_cashflow_forecast',
    'analytics_portfolio_by_cause',
    'analytics_portfolio_by_county',
    'analytics_outcomes',
    'analytics_demographics',
  ].map(
    (table): TableSpec => ({
      table,
      kind: 'view',
      allow: allow(STAFF, NONE, NONE, NONE),
      note: 'Aggregates only (demographics suppress n < 5). Staff of the workspace; the matviews themselves are not readable by request roles.',
    }),
  ),
];

export function specFor(table: string): TableSpec | undefined {
  return MATRIX.find((s) => s.table === table);
}

/** Number of individual allow/deny assertions the matrix makes. */
export function assertionCount(): number {
  return MATRIX.reduce((n, s) => n + (s.kind === 'view' ? 1 : OPS.length) * PRINCIPALS.length, 0);
}
