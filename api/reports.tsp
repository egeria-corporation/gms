import "@typespec/http";
import "@common-grants/core";
import "./models.tsp";
import "./routes.tsp";

using TypeSpec.Http;
using CommonGrants.Responses;
using GMS.Models;
using GMS.Auth;
using GMS.Errors;
using GMS.HttpResponses;

// The report builder (v1.8.0, docs/reports.md), for funder workspaces: members who may read reports
// (admin, program officer, finance, observer, auditor) build a report over one data set from its
// whitelisted columns, preview the first 200 rows, download up to 50,000 rows as CSV, save views
// (private or shared with the workspace) and schedule a view weekly or monthly to members of the
// workspace. A definition names columns by key only. Amounts are integer minor units as recorded in
// the GMS; Passport's disbursed amount appears only as "Disbursed through Passport" and is never
// added up. No column holds bank, payout, identity or contact data. Saving and scheduling are done
// by a person (no API client or agent); the MCP tools list and run views only.

namespace GMS.Models {
  union ReportDataSetKey {
    applications: "applications",
    awards: "awards",
    payments: "payments",
    requirements: "requirements",
    organizations: "organizations",
  }

  union ReportColumnType {
    text: "text",
    number: "number",
    money: "money",
    date: "date",
    status: "status",
  }

  /** A cell: text, a number (money in minor units), a date as YYYY-MM-DD, or null. */
  alias ReportCell = string | float64 | null;

  model ReportColumnInfo {
    key: string;
    label: string;
    type: ReportColumnType;

    /** Where the value comes from. */
    source: string;

    /** Number and money columns that may be added up and averaged. */
    aggregatable: boolean;

    /** Status columns: the values the column takes. */
    values?: string[];

    /** Status columns: which status vocabulary labels them (`application`, `award`, `tranche`, `requirement`). */
    statusKind?: string;

    note?: string;
  }

  model ReportDataSet {
    key: ReportDataSetKey;
    label: string;
    description: string;

    /** False when the caller lacks the data set's own read scope. */
    available: boolean;

    columns: ReportColumnInfo[];
  }

  /**
   * `eq` takes `value`, `in` takes `values` (1-100), `between` takes `from` and/or `to`, inclusive:
   * numbers (money in minor units), or dates as YYYY-MM-DD or relative to the run day
   * (`today`, `startOfYear`, `endOfYear`, `startOfMonth`, `endOfMonth`, each with an optional `+Nd` / `-Nd`).
   */
  model ReportFilter {
    column: string;
    `op`: "eq" | "in" | "between";
    value?: string | float64 | null;
    values?: (string | float64)[];
    from?: string | float64;
    to?: string | float64;
  }

  model ReportAggregate {
    `fn`: "count" | "sum" | "avg";

    /** Not for `count`. A number or money column the data set allows to add up. */
    column?: string;
  }

  model ReportSort {
    /** A column shown in the report, or `count`, `sum:<column>`, `avg:<column>` when grouped. */
    column: string;

    dir?: "asc" | "desc";
  }

  /** What a person builds. Every name is a column key of the data set; anything else is refused (422 `unknown_column`). */
  model ReportDefinition {
    dataSet: ReportDataSetKey;

    /** 1-30 column keys. */
    columns: string[];

    filters?: ReportFilter[];

    /** At most two column keys. With grouping (or summaries) the rows are groups. */
    groupBy?: string[];

    aggregates?: ReportAggregate[];

    /** At most three. */
    sort?: ReportSort[];
  }

  model ReportOutColumn {
    key: string;
    label: string;
    type: ReportColumnType;
    statusKind?: string;
    note?: string;
  }

  model ReportResult {
    dataSet: ReportDataSetKey;
    columns: ReportOutColumn[];

    /** One array per row, in the order of `columns`. */
    rows: ReportCell[][];

    /** Rows (or groups) that matched, before the cap. */
    total: int32;

    /** More rows matched than were returned. */
    truncated: boolean;

    warnings: string[];
    asOf: utcDateTime;

    /** The cap: 200 for a preview. */
    limit: int32;
  }

  model ReportViewRun {
    ...ReportResult;
    viewId: string;
    name: string;
  }

  model ReportPerson {
    userId: CommonGrants.Types.uuid;
    name: string;
  }

  model ReportSchedule {
    cadence: "weekly" | "monthly";

    /** Weekly: 1 = Monday … 7 = Sunday. */
    weekday: int32 | null;

    /** Monthly: 1-28. */
    dayOfMonth: int32 | null;

    recipients: ReportPerson[];
    active: boolean;

    /** `owner_left`, `no_recipients` or `view_private` when the job stopped it. */
    stoppedReason: string | null;

    lastSentAt: utcDateTime | null;
    nextSendAt: utcDateTime | null;
  }

  model ReportView {
    /** A UUID, or `starter-<key>` for a starter view. */
    id: string;

    name: string;
    description: string | null;
    dataSet: ReportDataSetKey;
    definition: ReportDefinition;
    visibility: "private" | "workspace";

    /** A starter view: read only; save a copy to change or schedule it. */
    starter: boolean;

    owner: ReportPerson | null;

    /** The caller saved this view. */
    mine: boolean;

    schedule: ReportSchedule | null;
    createdAt: utcDateTime | null;
    updatedAt: utcDateTime | null;
  }

  model ReportViewList {
    starters: ReportView[];

    /** Shared views and the caller's own private ones. */
    saved: ReportView[];
  }

  model ReportViewInput {
    name: string;
    description?: string | null;

    /** Default `private`. */
    visibility?: "private" | "workspace";

    definition: ReportDefinition;
  }

  model ReportViewPatch {
    name?: string;
    description?: string | null;
    visibility?: "private" | "workspace";
    definition?: ReportDefinition;
  }

  model ReportViewDeleted {
    id: CommonGrants.Types.uuid;
    deleted: true;
  }

  model ReportExportInput {
    definition: ReportDefinition;

    /** Names the file. */
    name?: string;
  }

  /** Recipients are members of the workspace by user id, never addresses. */
  model ReportScheduleInput {
    cadence: "weekly" | "monthly";
    weekday?: int32;
    dayOfMonth?: int32;

    /** 1-20 members who may read the report; for a private view, its owner only. */
    recipientUserIds: CommonGrants.Types.uuid[];
  }

  model ReportRecipient {
    userId: CommonGrants.Types.uuid;
    name: string;
    role: string;
  }

  model ReportFileSummary {
    id: CommonGrants.Types.uuid;
    viewId: CommonGrants.Types.uuid;
    viewName: string;

    /** ISO week (2027-W16) or month (2027-04). */
    period: string;

    rows: int32;
    truncated: boolean;
    createdAt: utcDateTime;
    expiresAt: utcDateTime;
  }

  /** A CSV: formula-safe cells, money in units with two decimals. */
  model ReportCsv {
    @statusCode statusCode: 200;
    @header contentType: "text/csv; charset=utf-8";
    @body body: bytes;
  }
}

namespace GMS.Routes.Custom {
  @tag("Reports")
  namespace Reports {
    /** The five data sets and their whitelisted columns. */
    @get @route("/reports/data-sets") @useAuth(GmsOAuth<["analytics:read"]> | UserSession)
    op dataSets(): OkT<ReportDataSet[]> | AuthErrors;

    /** The first 200 rows (or groups) of a definition. Also needs the data set's read scope. */
    @post @route("/reports/preview") @useAuth(GmsOAuth<["analytics:read"]> | UserSession)
    op preview(@body body: ReportDefinition): OkT<ReportResult> | BadRequest | AuthErrors | Unprocessable;

    /** Up to 50,000 rows as CSV, streamed (`X-Report-Rows`, `X-Report-Total`, `X-Report-Truncated`). */
    @post @route("/reports/export") @useAuth(GmsOAuth<["analytics:read"]> | UserSession)
    op exportCsv(@body body: ReportExportInput): ReportCsv | BadRequest | AuthErrors | Unprocessable;

    /** The starter views, and the saved views the caller may see. */
    @get @route("/report-views") @useAuth(GmsOAuth<["analytics:read"]> | UserSession)
    op listViews(): OkT<ReportViewList> | AuthErrors;

    /** Save a view. A signed-in person only (403 `person_required` otherwise). */
    @post @route("/report-views") @useAuth(UserSession)
    op createView(@body body: ReportViewInput): CreatedT<ReportView> | BadRequest | AuthErrors | Unprocessable;

    @get @route("/report-views/{id}") @useAuth(GmsOAuth<["analytics:read"]> | UserSession)
    op getView(@path id: string): OkT<ReportView> | AuthErrors | NotFound;

    /** The owner changes a view (403 `not_owner` otherwise). 409 `view_scheduled_to_others` when making private a view sent to others. */
    @patch @route("/report-views/{id}") @useAuth(UserSession)
    op updateView(@path id: string, @body body: ReportViewPatch): OkT<ReportView> | BadRequest | AuthErrors | NotFound | Conflict | Unprocessable;

    /** The owner removes a view, or an admin a shared one; its schedule stops and its files are removed. */
    @delete @route("/report-views/{id}") @useAuth(UserSession)
    op deleteView(@path id: string): OkT<ReportViewDeleted> | AuthErrors | NotFound;

    /** A view's first 200 rows. */
    @post @route("/report-views/{id}/run") @useAuth(GmsOAuth<["analytics:read"]> | UserSession)
    op runView(@path id: string): OkT<ReportViewRun> | AuthErrors | NotFound | Unprocessable;

    @get @route("/report-views/{id}/export") @useAuth(GmsOAuth<["analytics:read"]> | UserSession)
    op exportView(@path id: string): ReportCsv | AuthErrors | NotFound | Unprocessable;

    /** Members the view can be sent to. */
    @get @route("/report-views/{id}/recipients") @useAuth(UserSession)
    op scheduleRecipients(@path id: string): OkT<ReportRecipient[]> | AuthErrors | NotFound;

    /** Send the view weekly or monthly. The owner, in person; 422 `recipient_not_allowed` for anyone who is not a member who may read it. */
    @put @route("/report-views/{id}/schedule") @useAuth(UserSession)
    op setSchedule(@path id: string, @body body: ReportScheduleInput): OkT<ReportView> | BadRequest | AuthErrors | NotFound | Unprocessable;

    @delete @route("/report-views/{id}/schedule") @useAuth(UserSession)
    op stopSchedule(@path id: string): OkT<ReportView> | AuthErrors | NotFound;

    /** Scheduled files sent to the caller, kept 30 days. */
    @get @route("/report-files") @useAuth(UserSession)
    op listFiles(): OkT<ReportFileSummary[]> | AuthErrors;

    /** A scheduled file, for one of its recipients. 410 `file_expired` after 30 days. */
    @get @route("/report-files/{id}/download") @useAuth(UserSession)
    op downloadFile(@path id: CommonGrants.Types.uuid): ReportCsv | AuthErrors | NotFound | Gone | ServiceUnavailable;
  }
}
