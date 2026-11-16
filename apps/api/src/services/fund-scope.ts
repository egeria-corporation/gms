// SPDX-License-Identifier: AGPL-3.0-only
// What a fund advisor's requests read and write through. A member whose scope names `fundIds`
// (see `fundScopeOf` in context.ts) sees and acts on those funds' programs and everything under
// them, and nothing else, on every route and MCP tool. `authorize()` installs this view on the
// caller's context, so every service reads through it without knowing it exists:
//
//   * every table is classified below (the type makes a new table a compile error until it is):
//     `open` holds nothing of a fund; `parent` rows belong to the fund of the row a column names;
//     `check` rows are decided one by one (a subject, a thread, an award or an application);
//     `closed` rows are never shown to a fund advisor and cannot be written by one;
//   * reads return only the rows in scope, updates and deletes touch only those, and an insert or
//     update that would put a row outside the scope is refused (404 naming the parent, or 422 when
//     no parent is named at all);
//   * the ledger reads only events about records in scope;
//   * the one transactional store that writes awards past the repositories (direct awards) is held
//     to the same rule.
//
// Rows of other workspaces pass through untouched: the services' own workspace checks apply to them.
import type { TableName } from "@gms/db";
import type { LedgerEvent, LedgerQuery, LedgerStore } from "@gms/ledger";
import { forbidden } from "../auth/verify.ts";
import { ApiError, notFound } from "../lib/errors.ts";
import { fundScopeOf, type ServiceContext } from "./context.ts";
import type { DirectAwardStore } from "./direct-award-store.ts";
import type { FindOptions, Insert, Repos, Row, TableRepo, Update, Where } from "./repos/types.ts";

type AnyRow = Record<string, unknown>;

/** The record sets a fund scope reaches, each computed once per request when first needed. */
type SetKey = "funds" | "programs" | "opportunities" | "competitions" | "applications" | "awards" | "review_assignments" | "tranches" | "agreements" | "requirements" | "submissions" | "amendments" | "decisions" | "threads" | "grantees";

type Rule =
  | { kind: "open" }
  | { kind: "closed" }
  /** The row belongs to the fund of the `set` record its `col` names; `what` names that record in a 404. */
  | { kind: "parent"; col: string; set: SetKey; what: string }
  /** Decided per row. `inWorkspace` says whether the row is this workspace's at all (default: `workspace_id`). */
  | { kind: "check"; allowed: (row: AnyRow, v: FundView) => Promise<boolean>; inWorkspace?: (row: AnyRow, v: FundView) => Promise<boolean> };

const OPEN: Rule = { kind: "open" };
const CLOSED: Rule = { kind: "closed" };
const parent = (col: string, set: SetKey, what: string): Rule => ({ kind: "parent", col, set, what });
const has = async (v: FundView, set: SetKey, id: unknown) => typeof id === "string" && (await v.set(set)).has(id);

/** Ledger and record subjects, by `subject_type`. A subject of any other type is outside every fund. */
const SUBJECTS: Record<string, SetKey> = {
  fund: "funds",
  program: "programs",
  opportunity: "opportunities",
  competition: "competitions",
  application: "applications",
  award: "awards",
  review_assignment: "review_assignments",
  decision: "decisions",
  tranche: "tranches",
  agreement: "agreements",
  requirement: "requirements",
  submission: "submissions",
  amendment: "amendments",
  thread: "threads",
  // A file imported from another grants system for an award (import-files.ts) is that award's.
  imported_award_file: "awards",
};
const subjectInScope = async (v: FundView, type: unknown, id: unknown) => typeof type === "string" && type in SUBJECTS && has(v, SUBJECTS[type]!, id);
const SUBJECT: Rule = { kind: "check", allowed: (r, v) => subjectInScope(v, r.subject_type, r.subject_id) };

/**
 * Every table, classified. `open`: no row says anything about a fund (workspace settings, members,
 * the form and rubric library, an applicant's own records, sign-in state). Admin-only tables are
 * open here because the role already keeps a fund advisor out of them.
 */
const RULES: { [T in TableName]: Rule } = {
  agreements: parent("award_id", "awards", "Award"),
  amendments: parent("award_id", "awards", "Award"),
  answers: OPEN,
  api_clients: OPEN,
  application_events: parent("application_id", "applications", "Application"),
  application_summaries: parent("application_id", "applications", "Application"),
  applications: parent("opportunity_id", "opportunities", "Opportunity"),
  // An approval about a record of the funds, or one the advisor's own agent filed about no record.
  approvals: { kind: "check", allowed: async (r, v) => (r.subject_id ? subjectInScope(v, r.subject_type, r.subject_id) : !!v.userId && typeof r.requested_by === "string" && (r.requested_by === `user:${v.userId}` || r.requested_by.startsWith(`user:${v.userId}/`))) },
  assist_calls: OPEN,
  award_invitation_sends: OPEN,
  award_invitations: parent("award_id", "awards", "Award"),
  awards: parent("program_id", "programs", "Program"),
  // An unmatched bank transaction is the whole workspace's money: never a fund advisor's.
  bank_transactions: parent("matched_tranche_id", "tranches", "Payment"),
  budgets: { kind: "check", allowed: async (r, v) => (r.award_id ? has(v, "awards", r.award_id) : has(v, "applications", r.application_id)) },
  calendar_feeds: OPEN,
  // 0033: a competition's conflict-of-interest policy and its reviewers' signatures are that competition's.
  coi_policies: parent("competition_id", "competitions", "Competition"),
  coi_signatures: parent("competition_id", "competitions", "Competition"),
  competitions: parent("opportunity_id", "opportunities", "Opportunity"),
  connector_accounts: OPEN,
  consents: OPEN,
  consulting_requests: OPEN,
  custom_mcp_servers: OPEN,
  decisions: parent("competition_id", "competitions", "Competition"),
  discover_saved: OPEN,
  // 0041: a person's own digest choices and what was sent to them (match keys, never a record of a
  // fund). What a digest says is built under the person's own fund scope (content-digests.ts).
  digest_sends: OPEN,
  digest_subscriptions: OPEN,
  documents: SUBJECT,
  form_responses: { kind: "check", allowed: async (r, v) => (r.application_id ? has(v, "applications", r.application_id) : has(v, "submissions", r.submission_id)) },
  forms: OPEN,
  funder_records: OPEN,
  funds: parent("id", "funds", "Fund"),
  // 0036: the gallery holds forms, rubrics and email templates (the library is open); sharing is an admin's.
  gallery_items: OPEN,
  gallery_submissions: OPEN,
  grantee_records: parent("applicant_workspace_id", "grantees", "Grantee"),
  import_mappings: CLOSED,
  import_rows: CLOSED,
  import_runs: CLOSED,
  inbound_events: OPEN,
  invitations: OPEN,
  ledger_archives: OPEN,
  ledger_events: SUBJECT,
  mcp_connections: OPEN,
  // A message is its thread's.
  messages: { kind: "check", allowed: (r, v) => v.threadAllowed(r.thread_id), inWorkspace: (r, v) => v.threadInWorkspace(r.thread_id) },
  oauth_clients_dynamic: OPEN,
  oauth_codes: OPEN,
  oauth_grants: OPEN,
  oauth_refresh_tokens: OPEN,
  opportunities: parent("program_id", "programs", "Program"),
  org_change_inbox: CLOSED,
  outside_answers: OPEN,
  outside_applications: OPEN,
  outside_obligation_series: OPEN,
  outside_obligations: OPEN,
  outside_questions: OPEN,
  // 0040: an applicant's own sends of its outside applications (funder workspaces have none).
  package_sends: OPEN,
  passport_account_links: OPEN,
  passport_link_requests: OPEN,
  passport_links: OPEN,
  passport_second_steps: OPEN,
  payment_schedules: parent("award_id", "awards", "Award"),
  programs: parent("fund_id", "funds", "Fund"),
  reminder_sends: parent("requirement_id", "requirements", "Requirement"),
  // 0034: a scheduled report is computed for the whole workspace by the jobs Worker, so a fund
  // advisor neither schedules one nor receives its files (they also are not eligible recipients in
  // report-builder.ts). Of saved views they see their own; running any view reads through this scope.
  report_files: CLOSED,
  report_schedules: CLOSED,
  report_views: { kind: "check", allowed: async (r, v) => !!v.userId && r.owner_user_id === v.userId },
  requirements: parent("award_id", "awards", "Award"),
  review_assignments: parent("application_id", "applications", "Application"),
  reviews: parent("assignment_id", "review_assignments", "Review assignment"),
  rubrics: OPEN,
  // 0038: connected accounts and the Zernio profile are the workspace's (connecting is an admin's);
  // a post is its subject's (an opportunity or an award).
  social_accounts: OPEN,
  social_posts: SUBJECT,
  social_profiles: OPEN,
  submissions: parent("award_id", "awards", "Award"),
  tasks: SUBJECT,
  templates: OPEN,
  threads: { kind: "check", allowed: SUBJECT.allowed, inWorkspace: async (r, v) => r.workspace_id === v.workspaceId || r.funder_workspace_id === v.workspaceId },
  tranches: parent("award_id", "awards", "Award"),
  webhook_deliveries: CLOSED,
  webhook_subscriptions: OPEN,
  workspace_creation_counts: OPEN,
  workspace_members: OPEN,
  // 0035: single sign-on domains say nothing of a fund (admins only).
  workspace_sso_domains: OPEN,
  workspaces: OPEN,
};

/** The table a set is read from, and its parent column and set. */
const SOURCES: Record<Exclude<SetKey, "funds" | "threads" | "grantees">, { table: TableName; col: string; from: SetKey }> = {
  programs: { table: "programs", col: "fund_id", from: "funds" },
  opportunities: { table: "opportunities", col: "program_id", from: "programs" },
  competitions: { table: "competitions", col: "opportunity_id", from: "opportunities" },
  applications: { table: "applications", col: "opportunity_id", from: "opportunities" },
  awards: { table: "awards", col: "program_id", from: "programs" },
  review_assignments: { table: "review_assignments", col: "application_id", from: "applications" },
  decisions: { table: "decisions", col: "competition_id", from: "competitions" },
  tranches: { table: "tranches", col: "award_id", from: "awards" },
  agreements: { table: "agreements", col: "award_id", from: "awards" },
  requirements: { table: "requirements", col: "award_id", from: "awards" },
  submissions: { table: "submissions", col: "award_id", from: "awards" },
  amendments: { table: "amendments", col: "award_id", from: "awards" },
};
const SET_OF_TABLE = new Map<TableName, SetKey>([["funds", "funds"], ["threads", "threads"], ...Object.entries(SOURCES).map(([k, s]) => [s.table, k as SetKey] as [TableName, SetKey])]);

/** Ids sent in one `IN (…)` filter. Above it a list is filtered here instead, so no request grows too long. */
export const PUSH_DOWN_MAX = 150;
/** How many rows a filtered-here read looks at, and how many recent ledger events a fund advisor's activity reads from. */
const READ_CAP = 5000;
const EMPTY = Symbol("empty");

/** One request's view of the data through a fund scope. */
export class FundView {
  private readonly memo = new Map<SetKey, Promise<Set<string>>>();
  private readonly threads = new Map<string, Promise<AnyRow | null>>();

  constructor(
    readonly base: Repos,
    readonly workspaceId: string,
    readonly fundIds: readonly string[],
    /** The person the advisor is: their own approval requests stay theirs to read. */
    readonly userId: string | null = null,
  ) {}

  set(key: SetKey): Promise<Set<string>> {
    let p = this.memo.get(key);
    if (!p) {
      p = this.compute(key);
      this.memo.set(key, p);
      // A failed read is not remembered: the next call tries again.
      p.catch(() => this.memo.delete(key));
    }
    return p;
  }

  /** After a write to a table a set is read from, the sets are read again when next needed. */
  forget(table: TableName): void {
    if (SET_OF_TABLE.has(table) || table === "applications" || table === "awards") this.memo.clear();
    if (table === "threads") this.threads.clear();
  }

  /** A row just inserted through the view (already checked to be in scope) joins its set. */
  async remember(table: TableName, id: unknown): Promise<void> {
    const key = SET_OF_TABLE.get(table);
    if (!key || typeof id !== "string") return;
    const p = this.memo.get(key);
    if (p) (await p.catch(() => new Set<string>())).add(id);
    // Grantees follow applications and awards; read them again.
    this.memo.delete("grantees");
  }

  private async ids(table: TableName, col: string, values: Set<string>): Promise<AnyRow[]> {
    if (!values.size) return [];
    const list = [...values];
    const out: AnyRow[] = [];
    for (let i = 0; i < list.length; i += PUSH_DOWN_MAX) {
      out.push(...((await this.base.table(table).find({ workspace_id: this.workspaceId, [col]: list.slice(i, i + PUSH_DOWN_MAX) } as never, { limit: READ_CAP * 4 })) as unknown as AnyRow[]));
    }
    return out;
  }

  private async compute(key: SetKey): Promise<Set<string>> {
    if (key === "funds") {
      const rows = this.fundIds.length ? await this.base.table("funds").find({ workspace_id: this.workspaceId, id: [...this.fundIds] }) : [];
      return new Set(rows.map((r) => r.id));
    }
    if (key === "grantees") {
      const [apps, awards] = await Promise.all([this.set("opportunities").then((o) => this.ids("applications", "opportunity_id", o)), this.set("programs").then((p) => this.ids("awards", "program_id", p))]);
      return new Set([...apps.map((a) => a.applicant_workspace_id), ...awards.map((a) => a.recipient_workspace_id)].filter((x): x is string => typeof x === "string"));
    }
    if (key === "threads") {
      const [own, shared] = await Promise.all([this.base.table("threads").find({ workspace_id: this.workspaceId }, { limit: READ_CAP }), this.base.table("threads").find({ funder_workspace_id: this.workspaceId }, { limit: READ_CAP })]);
      const out = new Set<string>();
      for (const t of [...own, ...shared]) if (await subjectInScope(this, t.subject_type, t.subject_id)) out.add(t.id);
      return out;
    }
    const s = SOURCES[key];
    return new Set((await this.ids(s.table, s.col, await this.set(s.from))).map((r) => r.id as string));
  }

  private thread(id: unknown): Promise<AnyRow | null> {
    if (typeof id !== "string") return Promise.resolve(null);
    let p = this.threads.get(id);
    if (!p) this.threads.set(id, (p = this.base.table("threads").one({ id }) as Promise<AnyRow | null>));
    return p;
  }
  async threadInWorkspace(id: unknown): Promise<boolean> {
    const t = await this.thread(id);
    return !!t && (t.workspace_id === this.workspaceId || t.funder_workspace_id === this.workspaceId);
  }
  async threadAllowed(id: unknown): Promise<boolean> {
    const t = await this.thread(id);
    return !!t && (await subjectInScope(this, t.subject_type, t.subject_id));
  }

  /** Whether a row may be seen and written by the fund advisor. */
  async allowed(rule: Rule, row: AnyRow): Promise<boolean> {
    if (rule.kind === "open") return true;
    const mine = rule.kind === "check" && rule.inWorkspace ? await rule.inWorkspace(row, this) : row.workspace_id === this.workspaceId;
    if (!mine) return true;
    if (rule.kind === "closed") return false;
    if (rule.kind === "parent") return has(this, rule.set, row[rule.col]);
    return rule.allowed(row, this);
  }
}

/** The refusal for a write that would put a row outside the fund scope. */
function outside(rule: Rule, row: AnyRow): ApiError {
  if (rule.kind === "parent") return row[rule.col] === null || row[rule.col] === undefined ? new ApiError(422, "fund_required", `Choose ${rule.what === "Fund" ? "a fund" : `a ${rule.what.toLowerCase()} in a fund`} you work on`) : notFound(rule.what);
  if (rule.kind === "closed") return forbidden("fund_scope", "This is not open to fund advisors. Ask a workspace admin");
  const names = row.subject_id ?? row.application_id ?? row.award_id ?? row.submission_id ?? row.thread_id;
  return names ? notFound("Record") : new ApiError(422, "fund_required", "Link this to a record in a fund you work on");
}

class ScopedTable<T extends TableName> implements TableRepo<T> {
  constructor(
    private readonly view: FundView,
    private readonly name: T,
    private readonly inner: TableRepo<T>,
    private readonly rule: Rule,
  ) {}

  /** The `where` with the scope pushed into it, EMPTY when nothing can match, or null to filter here. */
  private async narrow(where: Where<T>): Promise<Where<T> | typeof EMPTY | null> {
    const rule = this.rule;
    if (rule.kind === "closed" && (where as AnyRow).workspace_id === this.view.workspaceId) return EMPTY;
    if (rule.kind !== "parent" || (where as AnyRow).workspace_id !== this.view.workspaceId) return null;
    const set = await this.view.set(rule.set);
    const asked = (where as AnyRow)[rule.col];
    if (asked === null) return EMPTY;
    if (Array.isArray(asked)) {
      const kept = asked.filter((x) => set.has(x as string));
      return kept.length ? ({ ...where, [rule.col]: kept } as Where<T>) : EMPTY;
    }
    if (asked !== undefined) return set.has(asked as string) ? where : EMPTY;
    if (!set.size) return EMPTY;
    return set.size <= PUSH_DOWN_MAX ? ({ ...where, [rule.col]: [...set] } as Where<T>) : null;
  }

  private async keep(rows: Row<T>[]): Promise<Row<T>[]> {
    const out: Row<T>[] = [];
    for (const r of rows) if (await this.view.allowed(this.rule, r as AnyRow)) out.push(r);
    return out;
  }

  async find(where: Where<T>, opts: FindOptions<T> = {}): Promise<Row<T>[]> {
    if (this.rule.kind === "open") return this.inner.find(where, opts);
    const narrowed = await this.narrow(where);
    if (narrowed === EMPTY) return [];
    if (narrowed) return this.inner.find(narrowed, opts);
    // Filtered here: read without the page, keep what is in scope, then page.
    const { limit, offset, ...rest } = opts;
    const rows = await this.keep(await this.inner.find(where, { ...rest, limit: READ_CAP }));
    const from = offset ?? 0;
    return limit === undefined ? rows.slice(from) : rows.slice(from, from + limit);
  }

  async count(where: Where<T>, opts: Pick<FindOptions<T>, "notNull"> = {}): Promise<number> {
    if (this.rule.kind === "open") return this.inner.count(where, opts);
    const narrowed = await this.narrow(where);
    if (narrowed === EMPTY) return 0;
    if (narrowed) return this.inner.count(narrowed, opts);
    return (await this.find(where, opts)).length;
  }

  async one(where: Where<T>): Promise<Row<T> | null> {
    return (await this.find(where, { limit: 1 }))[0] ?? null;
  }

  private async assertInsertable(row: AnyRow): Promise<void> {
    if (!(await this.view.allowed(this.rule, row))) throw outside(this.rule, row);
  }

  async insert(row: Insert<T>): Promise<Row<T>> {
    await this.assertInsertable(row as AnyRow);
    const saved = await this.inner.insert(row);
    await this.view.remember(this.name, (saved as AnyRow).id);
    return saved;
  }

  async insertMany(rows: Insert<T>[]): Promise<number> {
    for (const r of rows) await this.assertInsertable(r as AnyRow);
    const n = await this.inner.insertMany(rows);
    this.view.forget(this.name);
    return n;
  }

  /** The `where` limited to the rows in scope it matches, or EMPTY. Each kept row, as the patch would leave it, must stay in scope. */
  private async writable(where: Where<T>, patch?: Update<T>): Promise<Where<T> | typeof EMPTY> {
    if (this.rule.kind === "open") return where;
    const raw = await this.inner.find(where, { limit: READ_CAP });
    const kept = await this.keep(raw);
    if (!kept.length) return EMPTY;
    if (patch) for (const r of kept) if (!(await this.view.allowed(this.rule, { ...(r as AnyRow), ...(patch as AnyRow) }))) throw outside(this.rule, { ...(r as AnyRow), ...(patch as AnyRow) });
    return kept.length === raw.length ? where : ({ ...where, id: kept.map((r) => (r as AnyRow).id) } as Where<T>);
  }

  async update(where: Where<T>, patch: Update<T>): Promise<Row<T>[]> {
    const w = await this.writable(where, patch);
    if (w === EMPTY) return [];
    const rows = await this.inner.update(w, patch);
    this.view.forget(this.name);
    return rows;
  }

  async remove(where: Where<T>): Promise<number> {
    const w = await this.writable(where);
    if (w === EMPTY) return 0;
    const n = await this.inner.remove(w);
    this.view.forget(this.name);
    return n;
  }
}

class ScopedRepos implements Repos {
  private readonly tables = new Map<TableName, TableRepo<TableName>>();
  constructor(readonly view: FundView) {}
  table<T extends TableName>(name: T): TableRepo<T> {
    let t = this.tables.get(name);
    if (!t) this.tables.set(name, (t = new ScopedTable(this.view, name, this.view.base.table(name), RULES[name]) as unknown as TableRepo<TableName>));
    return t as unknown as TableRepo<T>;
  }
}

/** The ledger through a fund scope: events about records in scope, from the most recent READ_CAP. */
class ScopedLedger implements LedgerStore {
  constructor(
    private readonly view: FundView,
    private readonly inner: LedgerStore,
  ) {}
  append(event: LedgerEvent): Promise<void> {
    return this.inner.append(event);
  }
  private async visible(query: LedgerQuery): Promise<LedgerEvent[]> {
    const { limit: _l, offset: _o, ...q } = query;
    const total = await this.inner.count(q);
    const events = await this.inner.list({ ...q, offset: Math.max(0, total - READ_CAP), limit: READ_CAP });
    const out: LedgerEvent[] = [];
    for (const e of events) if (e.workspaceId !== this.view.workspaceId || (await subjectInScope(this.view, e.subjectType, e.subjectId))) out.push(e);
    return out;
  }
  async list(query: LedgerQuery): Promise<LedgerEvent[]> {
    if (query.workspaceId && query.workspaceId !== this.view.workspaceId) return this.inner.list(query);
    const all = await this.visible(query);
    const from = query.offset ?? 0;
    return query.limit === undefined ? all.slice(from) : all.slice(from, from + query.limit);
  }
  async count(query: LedgerQuery): Promise<number> {
    if (query.workspaceId && query.workspaceId !== this.view.workspaceId) return this.inner.count(query);
    return (await this.visible(query)).length;
  }
}

/** Direct awards are written in one transaction past the repositories: the award's program must be in scope too. */
function scopedDirectAwards(view: FundView, inner: DirectAwardStore): DirectAwardStore {
  return {
    async create(input, now) {
      const award = input.plan.award as AnyRow;
      if (!(await view.allowed(RULES.awards, award))) throw outside(RULES.awards, award);
      return inner.create(input, now);
    },
    claim: (input, now) => inner.claim(input, now),
  };
}

const SCOPED = Symbol("fund-scoped");

/**
 * Puts the caller's context behind the fund scope: its repositories, its ledger and the direct-award
 * store. Called by `authorize()` for a fund advisor; once per context.
 */
export function scopeToFunds(ctx: ServiceContext, workspaceId: string, fundIds: readonly string[]): void {
  const marked = ctx as ServiceContext & { [SCOPED]?: string };
  if (marked[SCOPED] === workspaceId) return;
  const view = new FundView(ctx.repos instanceof ScopedRepos ? ctx.repos.view.base : ctx.repos, workspaceId, fundIds, ctx.actor.userId);
  ctx.repos = new ScopedRepos(view);
  ctx.ledger = new ScopedLedger(view, ctx.ledger);
  if (ctx.ports.directAwards) ctx.ports = { ...ctx.ports, directAwards: scopedDirectAwards(view, ctx.ports.directAwards) };
  marked[SCOPED] = workspaceId;
}

/** Whether a context reads through a fund scope (tests, and the funds service's own answers). */
export const isFundScoped = (ctx: Pick<ServiceContext, "repos">): boolean => ctx.repos instanceof ScopedRepos;

/** Input fields that name a record, and the set the record must be in. */
const INPUT_IDS: Record<string, { set: SetKey; what: string }> = {
  fundId: { set: "funds", what: "Fund" },
  programId: { set: "programs", what: "Program" },
  opportunityId: { set: "opportunities", what: "Opportunity" },
  competitionId: { set: "competitions", what: "Competition" },
  applicationId: { set: "applications", what: "Application" },
  awardId: { set: "awards", what: "Award" },
  agreementId: { set: "agreements", what: "Agreement" },
  trancheId: { set: "tranches", what: "Payment" },
  requirementId: { set: "requirements", what: "Requirement" },
  submissionId: { set: "submissions", what: "Submission" },
  decisionId: { set: "decisions", what: "Decision" },
};
const UUID_IN = /([0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12})$/i;
const bareOf = (v: string): string | null => {
  const m = UUID_IN.exec(v);
  if (!m) return null;
  const hex = m[1]!.replace(/-/g, "").toLowerCase();
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

/**
 * An agent's gated call becomes an approval request that a person runs later as themselves. For a
 * fund advisor's agent the request is refused when its input names a record outside their funds
 * (or, for a direct award, names no program), so no one is asked to approve work on another fund
 * in that advisor's name. Called by the MCP approval store before it files the request.
 */
export async function assertApprovalInFundScope(repos: Repos, a: { workspaceId: string; side: string; tool: string; requestedBy: { userId: string }; input: unknown }): Promise<void> {
  if (a.side !== "funder") return;
  const m = await repos.table("workspace_members").one({ workspace_id: a.workspaceId, user_id: a.requestedBy.userId });
  const funds = m ? fundScopeOf({ kind: "funder", role: m.role, memberScope: (m.scope as Record<string, unknown> | null) ?? null }) : null;
  if (!funds) return;
  const view = new FundView(repos, a.workspaceId, funds);
  const named: [string, string][] = [];
  const walk = (v: unknown, key: string) => {
    if (Array.isArray(v)) v.forEach((x) => walk(x, key.replace(/Ids$/, "Id")));
    else if (isPlain(v)) for (const [k, x] of Object.entries(v)) walk(x, k);
    else if (typeof v === "string" && INPUT_IDS[key.replace(/Ids$/, "Id")]) named.push([key.replace(/Ids$/, "Id"), v]);
  };
  walk(a.input, "");
  if (a.tool === "create_direct_award" && !named.some(([k]) => k === "programId")) throw new ApiError(422, "fund_required", "Choose a program in a fund you work on");
  for (const [key, value] of named) {
    const id = bareOf(value);
    const rule = INPUT_IDS[key]!;
    if (!id || !(await view.set(rule.set)).has(id)) throw notFound(rule.what);
  }
}
const isPlain = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
