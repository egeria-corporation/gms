// SPDX-License-Identifier: AGPL-3.0-only
// In-memory repositories for unit tests. They apply the column defaults and the unique
// constraints the services rely on, so a service that passes here behaves the same on Postgres.
import type { TableName } from "@gms/db";
import { RepoError, type FindOptions, type Insert, type Repos, type Row, type TableRepo, type Update, type Where } from "./types.ts";

type AnyRow = Record<string, unknown>;

/** Column defaults from supabase/migrations, for the tables the services write (`at`: the insert's now()). */
const DEFAULTS: Partial<Record<TableName, (at: string) => AnyRow>> = {
  workspaces: () => ({ passport_org_id: null, legal_name: null, ein: null, brand: {}, settings: {}, org_projection: null, org_projection_at: null, profile_projection: null, profile_projection_at: null, profile_source: "none", self_declared_profile: null, verification_level: null, status: "active" }),
  workspace_members: () => ({ scope: {}, expires_at: null, mfa_enrolled_at: null, invited_by: null, notification_preferences: {}, notifications_read_at: null, notifications_read_ids: [], dismissed_notes: [] }),
  invitations: () => ({ scope: {}, invited_by: null, accepted_at: null }),
  passport_links: () => ({ client_id: null, client_secret_enc: null, refresh_token_enc: null, access_token_enc: null, access_token_expires_at: null, token_version: 0, scopes: [], linked_by_user_id: null, revoked_at: null, last_ok_at: null }),
  consents: () => ({ scopes: [], granted_by: null, revoked_at: null }),
  programs: () => ({ description: null, fiscal_year: null, budget_amount_minor: null, currency: "USD", defaults: {}, awards_confidential: false, fund_id: null }),
  funds: () => ({ description: null, brand: {}, budgets: [], is_default: false }),
  forms: () => ({
    version: 1,
    workspace_id: null,
    description: null,
    instructions: null,
    json_schema: { type: "object", properties: {} },
    ui_schema: { type: "VerticalLayout", elements: [] },
    mapping_from_cg: {},
    mapping_to_cg: {},
    field_meta: {},
    translations: {},
    purpose: "application",
    published_at: null,
    supersedes_form_version: null,
  }),
  rubrics: () => ({ version: 1, workspace_id: null, criteria: [], overall: {} }),
  opportunities: () => ({
    program_id: null,
    description: "",
    status: "forecasted",
    funding: {},
    key_dates: {},
    accepted_applicant_types: [],
    eligibility_rules: { all: [] },
    publish: { publicPage: true, openGrantsIndex: true, sitemap: true },
    custom_fields: {},
    cg: null,
    published_at: null,
  }),
  competitions: () => ({ description: null, instructions: null, status: "draft", key_dates: {}, stages: [], forms: {}, validation: {}, accepted_applicant_types: [], cg: null, coi_policy_required: true }),
  applications: () => ({
    title: "",
    status: "draft",
    cg_status: "inProgress",
    cg_custom_value: null,
    submitted_at: null,
    verification_level_at_submit: null,
    attestation_url: null,
    eligibility: null,
    requested_amount_minor: null,
    currency: "USD",
    tags: [],
    assigned_to_user_id: null,
    withdrawn_at: null,
    decision_id: null,
    cg: null,
  }),
  form_responses: () => ({ application_id: null, submission_id: null, stage: null, response: {}, status: "notStarted", validation_errors: [], provenance: {}, section_assignments: {}, locked_at: null }),
  application_events: () => ({ from_stage: null, to_stage: null, from_status: null, to_status: null, payload: {} }),
  decisions: () => ({ stage: null, amount_minor: null, currency: "USD", conditions: [], rationale: null, letter_template_id: null, proposed_by: null, decided_by: null, committed_at: null }),
  review_assignments: () => ({ status: "assigned", coi: {}, due_at: null }),
  threads: () => ({ funder_workspace_id: null, applicant_workspace_id: null, visibility: "shared", title: null }),
  messages: () => ({ author_user_id: null, attachments: [], email_message_id: null, field_ref: null, resolved_at: null, resolved_by: null }),
  tasks: () => ({ subject_type: null, subject_id: null, assignee_user_id: null, due_at: null, done_at: null, created_by: null }),
  documents: () => ({ subject_type: null, subject_id: null, passport_document_id: null, scan_status: "not_scanned", uploaded_by: null, doc_type: null, expires_on: null }),
  answers: () => ({ body: "", version: 1, used_in: [], last_verified_at: null, variants: {}, tags: [] }),
  discover_saved: () => ({ url: null, listing: {}, gms_opportunity_id: null, saved_by: null }),
  templates: () => ({ workspace_id: null, version: 1 }),
  approvals: () => ({ input: {}, summary: null, impact: null, subject_type: null, subject_id: null, status: "pending", side: "funder", error: null, decided_by: null, decided_at: null, decision_note: null, result: null, expires_at: null }),
  award_invitations: () => ({ message: null, sent_count: 1, accepted_at: null, accepted_by: null, accepted_workspace_id: null, declined_at: null, decline_reason: null, revoked_at: null }),
  awards: () => ({ recipient_workspace_id: null, recipient_individual: null, application_id: null, opportunity_id: null, program_id: null, parent_award_id: null, description: null, status: "offered", cg_status: "awarded", funding: {}, key_dates: {}, conditions: [], passport_award_id: null, passport_synced_at: null, disbursed_at: null, cg: null, confidential: false, recipient_unlisted: false, public_slug: crypto.randomUUID().replace(/-/g, "").slice(0, 12), federally_funded: false, federal_amount: null, federal_percent: null, federal_source: null }),
  agreements: () => ({ template_id: null, version: 1, status: "draft", rendered_pdf_path: null, document_sha256: null, grantee_signature: null, funder_signature: null, executed_at: null }),
  payment_schedules: () => ({ currency: "USD", notes: null }),
  tranches: () => ({ currency: "USD", condition: { type: "manual" }, status: "scheduled", due_at: null, released_by: null, released_at: null, mode: null, passport_disbursement_id: null, passport_status: null, external: null, hold_reason: null, idempotency_key: null }),
  requirements: () => ({ form_id: null, form_version: null, due_at: null, recurrence: null, grace_days: 0, reminder_plan: [], status: "scheduled", waived_by: null, releases_tranche_id: null }),
  reviews: () => ({ scores: {}, narrative: null, recommendation: null, submitted_at: null, visibility: "panel" }),
  amendments: () => ({ request: {}, status: "requested", requested_by: null, decided_by: null, decided_at: null, child_award_id: null }),
  submissions: () => ({ requirement_id: null, award_id: null, status: "draft", submitted_at: null, submitted_by: null, reviewed_by: null, review_note: null, shared_from_submission_id: null, shared_fields: null }),
  budgets: () => ({ application_id: null, award_id: null, categories: [], lines: [], currency: "USD", source: "user", period_start: null, period_end: null }),
  grantee_records: () => ({ owner_user_id: null, tags: [], notes: null, pending_org_changes: [], last_synced_at: null }),
  org_change_inbox: () => ({ patch: {}, status: "pending", decided_at: null, decided_by: null }),
  bank_transactions: () => ({ currency: "USD", counterparty_name: null, memo: null, matched_tranche_id: null, matched_at: null, matched_by: null }),
  connector_accounts: () => ({ external_id: null, scopes: [], secret_enc: null, status: "active", last_sync_at: null }),
  custom_mcp_servers: () => ({ auth: null, allowed_tools: [], read_only: true, created_by: null }),
  mcp_connections: () => ({ grant_id: null, scopes: [], last_used_at: null, revoked_at: null }),
  api_clients: () => ({ allowed_scopes: [], gated_tools: null, created_by: null, last_used_at: null, revoked_at: null }),
  inbound_events: () => ({ payload: {}, processed_at: null, error: null }),
  reminder_sends: () => ({ email_message_id: null }),
  ledger_archives: () => ({ events: 0, first_event: null, last_event: null, prev_sha256: null }),
  funder_records: () => ({ website: null, notes: null, contacts: [], portal_url: null, portal_login_holder: null, created_by: null }),
  outside_applications: () => ({
    program_name: null,
    funder_record_id: null,
    funder_name: null,
    source: "manual",
    source_ref: null,
    listing: {},
    listing_url: null,
    portal_url: null,
    stage: "drafting",
    previous_stage: null,
    currency: "USD",
    ask_amount_minor: null,
    ask_by_year: [],
    loi_due: null,
    full_due: null,
    internal_due: null,
    rolling: false,
    submitted_at: null,
    submission_method: null,
    confirmation_ref: null,
    receipt_document_id: null,
    snapshot_document_id: null,
    snapshot_sha256: null,
    decided_at: null,
    awarded_amount_minor: null,
    award_by_year: [],
    grant_start: null,
    grant_end: null,
    decision_notes: null,
    next_cycle_on: null,
    owner_user_id: null,
    custom_fields: {},
    archived_at: null,
    created_by: null,
    required_documents: [],
    go_no_go: null,
    closed_out_at: null,
  }),
  outside_questions: () => ({ phase: "full", section: null, position: 0, guidance: null, limit_kind: null, limit_value: null, required: false, assignee_user_id: null, status: "empty", obligation_id: null }),
  outside_answers: () => ({ body: "", library_answer_id: null, created_by: null }),
  calendar_feeds: () => ({ created_by: null, rotated_at: null }),
  consulting_requests: () => ({ sent_at: null, fields_sent: [] }),
  outside_obligation_series: () => ({ amount_minor: null, notes: null, created_by: null }),
  outside_obligations: () => ({ due_on: null, amount_minor: null, status: "upcoming", series_id: null, customized: false, notes: null, submitted_at: null, confirmation_ref: null, document_id: null, snapshot_sha256: null, completed_on: null, created_by: null }),
  application_summaries: () => ({ generated_by: null }),
  import_mappings: () => ({ updated_by: null }),
  import_runs: () => ({ source_label: null, source_ref: null, dropped_columns: [], reconciliation: {}, created_by: null, committed_by: null, committed_at: null, finished_at: null }),
  import_rows: () => ({ reason: null, problems: [], record: null, subtitle: null, entity_type: null, entity_id: null, written_at: null }),
  // 0033 (review parity): conflict-of-interest policies and signatures.
  coi_policies: () => ({ is_default: false, created_by: null }),
  coi_signatures: () => ({ declared_org_ids: [], declared_orgs: [] }),
  // 0034 (report builder), 0035 (single sign-on domains), 0036 (template gallery).
  report_views: () => ({ description: null, visibility: "private" }),
  report_schedules: (at) => ({ active: true, weekday: null, day_of_month: null, last_period: null, last_sent_at: null, starts_at: at, stopped_reason: null }),
  report_files: () => ({ schedule_id: null, sent_at: null, sent_count: 0, truncated: false }),
  workspace_sso_domains: () => ({ status: "pending", require_sso: false, provider_id: null, verified_at: null, last_checked_at: null, last_check_result: null, activated_at: null, created_by: null }),
  gallery_items: (at) => ({ author_workspace_id: null, licence: "CC-BY-4.0", status: "approved", version: 1, tags: { fieldOfWork: [], grantSize: [], audience: [] }, uses_count: 0, published_at: at, withdrawn_at: null }),
  gallery_submissions: () => ({ status: "pending", tags: { fieldOfWork: [], grantSize: [], audience: [] }, stripped: [], decided_at: null, decided_by: null, decision_reason: null, item_id: null, withdrawn_at: null }),
  social_profiles: () => ({ created_by: null }),
  social_accounts: () => ({ username: null, status: "active", connected_by: null, disconnected_at: null }),
  social_posts: () => ({ zernio_post_id: null, targets: [], status: "sending", scheduled_at: null, timezone: null, error: null, metrics: {}, metrics_at: null, sent_at: null }),
  package_sends: () => ({ sent_at: null }),
  // 0041: opt-in content digests (all off until a person turns one on) and what was sent.
  digest_subscriptions: () => ({ new_matches: false, deadlines: false, funder_activity: false, prompt_dismissed_at: null }),
  digest_sends: () => ({ item_keys: [], message_id: null }),
  // 0044: connected apps (Slack alerts, calendar links).
  alert_subscriptions: (at) => ({ provider: "slack", events: [], enabled: true, locale: "en", alerts_from: at, created_by: null }),
  alert_deliveries: () => ({ status: "sending", attempts: 1, slack_ts: null }),
  calendar_links: () => ({ status: "pending", calendar_id: null, calendar_name: null, event_map: {}, last_sync_at: null }),
  // 0045: a call's submission to a listing service (Philanthropy News Digest).
  syndication_sends: () => ({ message_id: null, sent_at: null }),
  // 0051: QuickBooks sync (off until a person turns it on) and one entry per payment.
  accounting_links: () => ({ provider: "quickbooks", expense_ref: null, expense_name: null, paid_from_ref: null, paid_from_name: null, tracking: "none", program_map: {}, vendor_map: {}, vendor_policy: "create", currency: "USD", sync_enabled: false, sync_from: null, locale: "en", updated_by: null }),
  accounting_entries: () => ({ provider: "quickbooks", status: "posting", reason: null, external_id: null, vendor_ref: null, vendor_name: null, attempts: 1, posted_at: null, attention: null, attention_at: null, handled_by: null, handled_at: null }),
  // 0046: imported history (past applications, reviews and reports), written by the import only.
  history_applications: () => ({ organization_workspace_id: null, award_id: null, program_id: null, program_name: null, call_title: null, submitted_on: null, outcome_label: null, currency: "USD", requested_amount_minor: null, awarded_amount_minor: null, answers: [], source_key: null, source_system: null, import_run_id: null }),
  history_reviews: () => ({ application_id: null, application_key: null, application_title: null, organization_name: null, reviewer_name: null, scores: [], total_score: null, recommendation: null, comment: null, reviewed_on: null, source_key: null, source_system: null, import_run_id: null }),
  history_reports: () => ({ award_id: null, organization_workspace_id: null, award_title: null, organization_name: null, due_on: null, submitted_on: null, report_state_label: null, source_key: null, source_system: null, import_run_id: null }),
  // 0047: funder loops (E4).
  peer_invitations: () => ({ status: "sending", sent_at: null, joined_count: 0, first_joined_at: null }),
  referral_links: () => ({ logo_storage: null, logo_path: null, logo_mime: null, logo_sha256: null, logo_alt: null, revoked_at: null, created_by: null }),
  referral_joins: () => ({ source_workspace_id: null, peer_invitation_id: null, referral_link_id: null }),
  directory_listings: (at) => ({ status: "pending", submitted_at: at, decided_by: null, decided_at: null, decision_reason: null, withdrawn_at: null }),
  // 0048: share-kit settings and the "Two weeks left" prompt.
  share_kit_profiles: () => ({ page_url: null, tag_consent: false, consented_at: null, consented_by: null, credit_wording: "funded_by", standard_description: null, updated_by: null }),
  social_reminder_prompts: (at) => ({ prompted_at: at, dismissed_at: null, dismissed_by: null }),
  // 0050: a session's pass to a draft's live channel (co-editing).
  presence_passes: () => ({ can_write: false }),
  // 0052: the operators' Search Console property (one row, id always true).
  operator_settings: () => ({ id: true, search_console_site: null, updated_by: null }),
};

/** Unique constraints (`columns`, optionally only among rows where `whereNull` is NULL, `whereNotNull` is not, or every `whereEquals` column has its value: a partial unique index). */
const UNIQUE: Partial<Record<TableName, { columns: string[]; whereNull?: string; whereNotNull?: string; whereEquals?: AnyRow }[]>> = {
  workspaces: [{ columns: ["handle"] }],
  workspace_members: [{ columns: ["workspace_id", "user_id"] }],
  invitations: [{ columns: ["token_hash"] }],
  award_invitations: [{ columns: ["award_id"] }, { columns: ["token_hash"] }],
  passport_links: [{ columns: ["workspace_id", "mode"], whereNull: "revoked_at" }],
  opportunities: [{ columns: ["workspace_id", "slug"] }],
  forms: [{ columns: ["id", "version"] }],
  rubrics: [{ columns: ["id", "version"] }],
  answers: [{ columns: ["workspace_id", "key", "version"] }],
  discover_saved: [{ columns: ["workspace_id", "source", "external_id"] }],
  review_assignments: [{ columns: ["application_id", "stage", "reviewer_user_id"] }],
  agreements: [{ columns: ["award_id", "version"] }],
  tranches: [{ columns: ["award_id", "seq"] }],
  inbound_events: [{ columns: ["provider", "external_id"] }],
  bank_transactions: [{ columns: ["external_txn_id"] }],
  reminder_sends: [{ columns: ["requirement_id", "due_at", "offset_days"] }],
  org_change_inbox: [{ columns: ["workspace_id", "change_id"] }],
  connector_accounts: [{ columns: ["workspace_id", "provider"] }],
  ledger_archives: [{ columns: ["day"] }],
  grantee_records: [{ columns: ["workspace_id", "applicant_workspace_id"] }],
  outside_answers: [{ columns: ["question_id", "version"] }],
  calendar_feeds: [{ columns: ["workspace_id"] }, { columns: ["token_sha256"] }],
  application_summaries: [{ columns: ["application_id", "response_version"] }],
  import_mappings: [{ columns: ["workspace_id", "target", "source", "source_ref"] }],
  import_rows: [{ columns: ["run_id", "line"] }, { columns: ["workspace_id", "target", "row_key"], whereNotNull: "entity_id" }],
  coi_policies: [{ columns: ["competition_id", "version"] }],
  coi_signatures: [{ columns: ["competition_id", "reviewer_user_id", "policy_version"] }],
  report_schedules: [{ columns: ["view_id"] }],
  report_files: [{ columns: ["view_id", "period_key"] }],
  // A domain may be pending for many workspaces but active for one (workspace_sso_domains_active_domain).
  workspace_sso_domains: [{ columns: ["workspace_id", "domain"] }, { columns: ["domain"], whereEquals: { status: "active" } }],
  gallery_items: [{ columns: ["slug"] }],
  // One pending submission per source record (gallery_submissions_one_pending_idx).
  gallery_submissions: [{ columns: ["workspace_id", "source_type", "source_id"], whereEquals: { status: "pending" } }],
  social_profiles: [{ columns: ["workspace_id"] }, { columns: ["zernio_profile_id"] }],
  social_accounts: [{ columns: ["zernio_id"] }],
  social_posts: [{ columns: ["workspace_id", "idempotency_key"] }, { columns: ["zernio_post_id"], whereNotNull: "zernio_post_id" }],
  // `funds (workspace_id) where is_default` is kept by services/funds.ts, which creates the default once.
  funds: [{ columns: ["workspace_id", "slug"] }],
  package_sends: [{ columns: ["outside_application_id", "day", "slot"] }],
  digest_subscriptions: [{ columns: ["member_id"] }],
  digest_sends: [{ columns: ["workspace_id", "user_id", "digest", "iso_week"] }],
  alert_subscriptions: [{ columns: ["workspace_id", "provider"] }],
  alert_deliveries: [{ columns: ["subscription_id", "event_key"] }],
  calendar_links: [{ columns: ["workspace_id", "user_id"] }],
  // One submission per call and listing service (0045).
  syndication_sends: [{ columns: ["opportunity_id", "target"] }],
  // 0051: one mapping per workspace and provider; one entry per payment, and the GMS reference once per workspace.
  accounting_links: [{ columns: ["workspace_id", "provider"] }],
  accounting_entries: [{ columns: ["workspace_id", "tranche_id"], whereNotNull: "tranche_id" }, { columns: ["workspace_id", "doc_number"] }],
  // 0047: one invitation per address per workspace, the weekly places, one live link of each kind.
  peer_invitations: [{ columns: ["workspace_id", "email_hash"] }, { columns: ["workspace_id", "week_start", "slot"] }, { columns: ["token_hash"] }],
  referral_links: [{ columns: ["token"] }, { columns: ["workspace_id", "kind"], whereNull: "revoked_at" }],
  referral_joins: [{ columns: ["joined_workspace_id"] }],
  directory_listings: [{ columns: ["workspace_id"] }],
  share_kit_profiles: [{ columns: ["workspace_id"] }],
  social_reminder_prompts: [{ columns: ["opportunity_id"] }],
  // 0050: one pass per session and draft channel.
  presence_passes: [{ columns: ["user_id", "session_id", "topic"] }],
  operator_settings: [{ columns: ["id"] }],
  // `funder_records (workspace_id, lower(btrim(name)))` and `outside_applications (workspace_id,
  // source_ref) where source = 'opengrants'` are checked by the services before writing.
};

/**
 * A child row belongs to the workspace of the row it hangs off (migration 0020,
 * `gms.same_workspace_as_parent`): column → parent table. A row that names a parent in another
 * workspace is refused, here as in the database, whoever writes it.
 */
export const SAME_WORKSPACE: Partial<Record<TableName, Record<string, TableName>>> = {
  opportunities: { program_id: "programs" },
  competitions: { opportunity_id: "opportunities" },
  applications: { competition_id: "competitions", opportunity_id: "opportunities" },
  form_responses: { application_id: "applications", submission_id: "submissions" },
  application_events: { application_id: "applications" },
  review_assignments: { application_id: "applications" },
  reviews: { assignment_id: "review_assignments" },
  decisions: { application_id: "applications", competition_id: "competitions" },
  awards: { application_id: "applications", opportunity_id: "opportunities", program_id: "programs", parent_award_id: "awards" },
  agreements: { award_id: "awards" },
  payment_schedules: { award_id: "awards" },
  tranches: { award_id: "awards", schedule_id: "payment_schedules" },
  requirements: { award_id: "awards", releases_tranche_id: "tranches" },
  submissions: { requirement_id: "requirements", award_id: "awards" },
  budgets: { award_id: "awards", application_id: "applications" },
  amendments: { award_id: "awards", child_award_id: "awards" },
  bank_transactions: { matched_tranche_id: "tranches" },
  award_invitations: { award_id: "awards" },
  outside_applications: { funder_record_id: "funder_records", receipt_document_id: "documents", snapshot_document_id: "documents" },
  outside_questions: { outside_application_id: "outside_applications", obligation_id: "outside_obligations" },
  outside_answers: { question_id: "outside_questions", library_answer_id: "answers" },
  consulting_requests: { outside_application_id: "outside_applications" },
  outside_obligation_series: { outside_application_id: "outside_applications" },
  outside_obligations: { outside_application_id: "outside_applications", series_id: "outside_obligation_series", document_id: "documents" },
  // 0032 checks this one with its own trigger (gms.application_summary_same_workspace).
  application_summaries: { application_id: "applications" },
  coi_policies: { competition_id: "competitions" },
  coi_signatures: { competition_id: "competitions" },
  // 0034 checks these with its own trigger (gms.report_rows_check).
  report_schedules: { view_id: "report_views" },
  report_files: { view_id: "report_views", schedule_id: "report_schedules" },
  programs: { fund_id: "funds" },
  // 0040 checks this one with its own trigger (gms.package_sends_same_workspace).
  package_sends: { outside_application_id: "outside_applications" },
  // 0041 checks this one with its own trigger (gms.digest_subscription_check), with the person too.
  digest_subscriptions: { member_id: "workspace_members" },
  // 0045 checks this one with its own trigger (gms.syndication_sends_same_workspace).
  syndication_sends: { opportunity_id: "opportunities" },
  // 0046 checks these with its own trigger (gms.history_same_workspace), with the funder kind too.
  history_applications: { award_id: "awards", program_id: "programs", import_run_id: "import_runs" },
  history_reviews: { application_id: "history_applications", import_run_id: "import_runs" },
  history_reports: { award_id: "awards", import_run_id: "import_runs" },
};

/** Tables whose primary key is not a generated `id` alone. */
const NO_GENERATED_ID = new Set<TableName>(["oauth_refresh_tokens", "share_kit_profiles", "operator_settings"]);

function matches(row: AnyRow, where: AnyRow, notNull: readonly string[] = []): boolean {
  for (const [k, v] of Object.entries(where)) {
    if (v === undefined) continue;
    const actual = row[k] ?? null;
    if (Array.isArray(v)) {
      if (!v.includes(actual)) return false;
    } else if (actual !== v) return false;
  }
  return notNull.every((k) => (row[k] ?? null) !== null);
}

class MemoryTable<T extends TableName> implements TableRepo<T> {
  readonly rows: AnyRow[] = [];
  constructor(
    private readonly name: T,
    private readonly now: () => Date,
    /** The workspace of a row of another table, or undefined when there is no such row. */
    private readonly workspaceOf: (table: TableName, id: unknown) => unknown = () => undefined,
  ) {}

  private assertSameWorkspace(candidate: AnyRow) {
    for (const [column, parent] of Object.entries(SAME_WORKSPACE[this.name] ?? {}) as [string, TableName][]) {
      const id = candidate[column] ?? null;
      if (id === null) continue;
      const owner = this.workspaceOf(parent, id);
      if (owner !== undefined && owner !== candidate.workspace_id) throw new RepoError("invalid", `${this.name}: ${column} names a row of another workspace`);
    }
  }

  private assertUnique(candidate: AnyRow, self?: AnyRow) {
    for (const u of UNIQUE[this.name] ?? []) {
      if (u.whereNull && (candidate[u.whereNull] ?? null) !== null) continue;
      if (u.whereNotNull && (candidate[u.whereNotNull] ?? null) === null) continue;
      if (u.whereEquals && !matches(candidate, u.whereEquals)) continue;
      const clash = this.rows.find((r) => r !== self && (!u.whereNull || (r[u.whereNull] ?? null) === null) && (!u.whereNotNull || (r[u.whereNotNull] ?? null) !== null) && (!u.whereEquals || matches(r, u.whereEquals)) && u.columns.every((c) => r[c] === candidate[c]));
      if (clash) throw new RepoError("conflict", `${this.name}: ${u.columns.join(", ")} already exists`);
    }
  }

  async find(where: Where<T>, opts: FindOptions<T> = {}) {
    let out = this.rows.filter((r) => matches(r, where as AnyRow, opts.notNull));
    if (opts.orderBy) {
      const key = opts.orderBy;
      const dir = opts.ascending === false ? -1 : 1;
      out = [...out].sort((a, b) => (String(a[key] ?? "") < String(b[key] ?? "") ? -dir : String(a[key] ?? "") > String(b[key] ?? "") ? dir : 0));
    }
    const offset = opts.offset ?? 0;
    return structuredClone(out.slice(offset, opts.limit === undefined ? undefined : offset + opts.limit)) as Row<T>[];
  }
  async count(where: Where<T>, opts: Pick<FindOptions<T>, "notNull"> = {}) {
    return this.rows.filter((r) => matches(r, where as AnyRow, opts.notNull)).length;
  }
  async one(where: Where<T>) {
    return (await this.find(where, { limit: 1 }))[0] ?? null;
  }
  async insert(row: Insert<T>) {
    const at = this.now().toISOString();
    const full: AnyRow = { ...(NO_GENERATED_ID.has(this.name) ? {} : { id: crypto.randomUUID() }), ...(DEFAULTS[this.name]?.(at) ?? {}), created_at: at, updated_at: at };
    for (const [k, v] of Object.entries(row as AnyRow)) if (v !== undefined) full[k] = v;
    this.assertUnique(full);
    this.assertSameWorkspace(full);
    this.rows.push(structuredClone(full));
    return structuredClone(full) as Row<T>;
  }
  async insertMany(rows: Insert<T>[]) {
    const before = this.rows.length;
    try {
      for (const r of rows) await this.insert(r);
    } catch (e) {
      // All or none, as one Postgres statement.
      this.rows.length = before;
      throw e;
    }
    return rows.length;
  }
  async update(where: Where<T>, patch: Update<T>) {
    const at = this.now().toISOString();
    const hit = this.rows.filter((r) => matches(r, where as AnyRow));
    for (const r of hit) {
      const next: AnyRow = { ...r };
      for (const [k, v] of Object.entries(patch as AnyRow)) if (v !== undefined) next[k] = v;
      next.updated_at = at;
      this.assertUnique(next, r);
      this.assertSameWorkspace(next);
      Object.assign(r, structuredClone(next));
    }
    return structuredClone(hit) as Row<T>[];
  }
  async remove(where: Where<T>) {
    const keep = this.rows.filter((r) => !matches(r, where as AnyRow));
    const removed = this.rows.length - keep.length;
    this.rows.length = 0;
    this.rows.push(...keep);
    return removed;
  }
}

export class MemoryRepos implements Repos {
  private readonly tables = new Map<TableName, MemoryTable<TableName>>();
  constructor(private readonly now: () => Date = () => new Date()) {}

  table<T extends TableName>(name: T): TableRepo<T> {
    let t = this.tables.get(name);
    if (!t) {
      const workspaceOf = (table: TableName, id: unknown) => (this.tables.get(table)?.rows.find((r) => r.id === id) as { workspace_id?: unknown } | undefined)?.workspace_id;
      t = new MemoryTable(name, this.now, workspaceOf) as unknown as MemoryTable<TableName>;
      this.tables.set(name, t);
    }
    return t as unknown as TableRepo<T>;
  }
}
