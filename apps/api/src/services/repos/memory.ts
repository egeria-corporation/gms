// SPDX-License-Identifier: AGPL-3.0-only
// In-memory repositories for unit tests. They apply the column defaults and the unique
// constraints the services rely on, so a service that passes here behaves the same on Postgres.
import type { TableName } from "@gms/db";
import { RepoError, type FindOptions, type Insert, type Repos, type Row, type TableRepo, type Update, type Where } from "./types.ts";

type AnyRow = Record<string, unknown>;

/** Column defaults from supabase/migrations, for the tables the services write. */
const DEFAULTS: Partial<Record<TableName, () => AnyRow>> = {
  workspaces: () => ({ passport_org_id: null, legal_name: null, ein: null, brand: {}, settings: {}, org_projection: null, org_projection_at: null, profile_projection: null, profile_projection_at: null, profile_source: "none", self_declared_profile: null, verification_level: null, status: "active" }),
  workspace_members: () => ({ scope: {}, expires_at: null, mfa_enrolled_at: null, invited_by: null, notification_preferences: {}, notifications_read_at: null, notifications_read_ids: [] }),
  invitations: () => ({ scope: {}, invited_by: null, accepted_at: null }),
  passport_links: () => ({ client_id: null, client_secret_enc: null, refresh_token_enc: null, access_token_enc: null, access_token_expires_at: null, token_version: 0, scopes: [], linked_by_user_id: null, revoked_at: null, last_ok_at: null }),
  consents: () => ({ scopes: [], granted_by: null, revoked_at: null }),
  programs: () => ({ description: null, fiscal_year: null, budget_amount_minor: null, currency: "USD", defaults: {} }),
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
  competitions: () => ({ description: null, instructions: null, status: "draft", key_dates: {}, stages: [], forms: {}, validation: {}, accepted_applicant_types: [], cg: null }),
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
  documents: () => ({ subject_type: null, subject_id: null, passport_document_id: null, scan_status: "not_scanned", uploaded_by: null }),
  answers: () => ({ body: "", version: 1, used_in: [] }),
  discover_saved: () => ({ url: null, listing: {}, gms_opportunity_id: null, saved_by: null }),
  templates: () => ({ workspace_id: null, version: 1 }),
  approvals: () => ({ input: {}, summary: null, impact: null, subject_type: null, subject_id: null, status: "pending", side: "funder", error: null, decided_by: null, decided_at: null, decision_note: null, result: null, expires_at: null }),
  awards: () => ({ recipient_workspace_id: null, recipient_individual: null, application_id: null, opportunity_id: null, program_id: null, parent_award_id: null, description: null, status: "offered", cg_status: "awarded", funding: {}, key_dates: {}, conditions: [], passport_award_id: null, passport_synced_at: null, disbursed_at: null, cg: null }),
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
};

/** Unique constraints (`columns`, optionally only among rows where `whereNull` is NULL). */
const UNIQUE: Partial<Record<TableName, { columns: string[]; whereNull?: string }[]>> = {
  workspaces: [{ columns: ["handle"] }],
  workspace_members: [{ columns: ["workspace_id", "user_id"] }],
  invitations: [{ columns: ["token_hash"] }],
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
};

/** Tables whose primary key is not a generated `id` alone. */
const NO_GENERATED_ID = new Set<TableName>(["oauth_refresh_tokens"]);

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
      const clash = this.rows.find((r) => r !== self && (!u.whereNull || (r[u.whereNull] ?? null) === null) && u.columns.every((c) => r[c] === candidate[c]));
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
    const full: AnyRow = { ...(NO_GENERATED_ID.has(this.name) ? {} : { id: crypto.randomUUID() }), ...(DEFAULTS[this.name]?.() ?? {}), created_at: at, updated_at: at };
    for (const [k, v] of Object.entries(row as AnyRow)) if (v !== undefined) full[k] = v;
    this.assertUnique(full);
    this.assertSameWorkspace(full);
    this.rows.push(structuredClone(full));
    return structuredClone(full) as Row<T>;
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
