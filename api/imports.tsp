import "@typespec/http";
import "@common-grants/core";
import "./models.tsp";
import "./routes.tsp";

using TypeSpec.Http;
using CommonGrants.Responses;
using CommonGrants.Fields;
using GMS.Models;
using GMS.Auth;
using GMS.Errors;
using GMS.HttpResponses;

// Import from a spreadsheet (v1.7.0): a funder's grant history or an applicant's outside
// applications, from a CSV or XLSX file, a Google Sheets spreadsheet or an Airtable table (the last
// two through Composio, read-only, when the server is set up for them). Columns that look like bank
// or identity data are dropped before anything is shown or stored; a run keeps their names only.
// Every run is checked first (a dry run with a reconciliation), then committed in batches; a source
// row is imported at most once per workspace. Grant history payments are recorded as paid elsewhere,
// never through Passport and never as a disbursed amount. Import runs are private to the workspace.

namespace GMS.Models {
  union ImportTarget {
    outsideApplications: "outside_applications",
    awardHistory: "award_history",
  }

  union ImportSourceKind {
    csv: "csv",
    xlsx: "xlsx",
    googleSheets: "google_sheets",
    airtable: "airtable",
  }

  union ImportOutcome {
    create: "create",
    skip: "skip",
    error: "error",
  }

  union ImportRunStatus {
    /** Checked; not imported yet. */
    checked: "checked",

    /** Committed; rows are being written. */
    importing: "importing",

    done: "done",

    /** Checked more than a day ago and never imported: check again. */
    expired: "expired",
  }

  union DroppedReason {
    header: "header",
    bankRouting: "bank_routing",
    identityNumber: "identity_number",
    longNumber: "long_number",
  }

  model ImportField {
    key: string;
    label: string;
    kind: "text" | "longtext" | "date" | "year" | "money" | "currency" | "choice" | "yesno" | "url" | "id";
    required: boolean;
    help: string | null;
  }

  model ImportSourceOption {
    kind: ImportSourceKind;
    label: string;

    /** Files are always ready; a connected app is ready once connected. */
    connected: boolean;

    /** Whether the caller may connect it (workspace admins, signed in). */
    canConnect: boolean;
  }

  model ImportSources {
    target: ImportTarget;
    maxRows: int32;
    maxXlsxBytes: int32;
    fields: ImportField[];

    /** CSV and XLSX always; Google Sheets and Airtable only where this server is set up for them. */
    sources: ImportSourceOption[];
  }

  model ImportCsvSource {
    kind: "csv";

    /** The file's text, header row first. */
    text: string;

    fileName?: string;
  }

  model ImportXlsxSource {
    kind: "xlsx";

    /** The .xlsx file, base64. At most 4 MB. */
    base64: string;

    fileName?: string;

    /** The sheet to read; the first when left out. */
    sheet?: string;
  }

  model ImportSheetsSource {
    kind: "google_sheets";

    /** The spreadsheet's link (https://docs.google.com/spreadsheets/d/…) or its id. */
    url: string;

    /** The tab to read; the first when left out. */
    sheet?: string;
  }

  model ImportAirtableSource {
    kind: "airtable";

    /** The base's or table's link (https://airtable.com/app…) or the base id. */
    url: string;

    /** The table's id or name; the one in the link, else the first. */
    table?: string;
  }

  @discriminated(#{ envelope: "none", discriminatorPropertyName: "kind" })
  union ImportSource {
    csv: ImportCsvSource,
    xlsx: ImportXlsxSource,
    google_sheets: ImportSheetsSource,
    airtable: ImportAirtableSource,
  }

  model ImportReadInput {
    target: ImportTarget;
    source: ImportSource;
  }

  model ImportPreviewInput {
    target: ImportTarget;
    source: ImportSource;

    /** Field key → column header. Required fields must be mapped. */
    mapping: Record<string>;

    /** Remember the mapping for the next file with the same columns, or the same sheet or table. Default true. */
    saveMapping?: boolean = true;
  }

  model ImportSourceRead {
    kind: ImportSourceKind;
    label: string;

    /** Workbooks and spreadsheets: every sheet, and the one read. */
    sheets?: string[];

    sheet?: string | null;

    /** Airtable: the base's tables, and the one read. */
    tables?: {
      id: string;
      name: string;
    }[];

    table?: string | null;
  }

  model DroppedColumn {
    /** The column's name. Its values are never stored or shown. */
    column: string;

    reason: DroppedReason;

    /** The reason in plain words. */
    why: string;
  }

  model ImportColumn {
    name: string;

    /** Up to three values from the column, to help choose. */
    samples: string[];
  }

  model ImportRead {
    target: ImportTarget;
    source: ImportSourceRead;
    rows: int32;

    /** The columns that may be mapped. Dropped columns are not among them. */
    columns: ImportColumn[];

    dropped: DroppedColumn[];

    /** A suggested mapping (field key → column), the saved one first. */
    mapping: Record<string>;

    /** Where the suggestion came from: the mapping saved for this source, one for a similar source, or none. */
    savedMapping: "this_source" | "similar_source" | null;

    fields: ImportField[];
  }

  model ImportProblem {
    field?: string;
    message: string;
  }

  model ImportMoney {
    kind: "ask" | "awarded" | "paid";
    amountMinor: int64;
    currency: string;
    year: int32 | null;
  }

  model ImportTotal {
    outcome: ImportOutcome;
    kind: "ask" | "awarded" | "paid";
    currency: string;
    year: int32 | null;
    amountMinor: int64;
    rows: int32;
  }

  model ImportReconciliation {
    rows: int32;
    create: int32;
    skip: int32;
    error: int32;

    /** Money by outcome, kind, currency and year. */
    totals: ImportTotal[];
  }

  model ImportProgress {
    toWrite: int32;
    written: int32;
    skipped: int32;
    failed: int32;
  }

  model ImportRun {
    id: CommonGrants.Types.uuid;
    target: ImportTarget;
    source: ImportSourceKind;
    sourceLabel: string | null;
    mapping: Record<string>;
    dropped: DroppedColumn[];

    /** As checked. */
    reconciliation: ImportReconciliation;

    rowsTotal: int32;
    status: ImportRunStatus;
    createdAt: utcDateTime;
    committedAt: utcDateTime | null;
    finishedAt: utcDateTime | null;
    expiresAt: utcDateTime;
    progress?: ImportProgress;
  }

  model ImportPreviewRow {
    /** Where the row is in the source (the spreadsheet row; the header is row 1). */
    line: int32;

    outcome: ImportOutcome;

    /** Why a row is skipped. */
    reason: string | null;

    problems: ImportProblem[];
    title: string;
    subtitle: string | null;
    money: ImportMoney[];
  }

  model ImportPreview {
    run: ImportRun;
    source: ImportSourceRead;
    columns: string[];

    /** Fields mapped to a column that is not there or was dropped. */
    unknownColumns: string[];

    rows: ImportPreviewRow[];
  }

  model ImportEntity {
    type: "outside_application" | "award";

    /** An outside application's UUID, or an award's `awd_` id. */
    id: string;
  }

  model ImportLogRow {
    line: int32;
    outcome: ImportOutcome;
    reason: string | null;
    problems: ImportProblem[];
    title: string;
    subtitle: string | null;
    written: boolean;
    entity: ImportEntity | null;
  }

  model ImportRunDetail {
    run: ImportRun;
    rows: ImportLogRow[];
  }

  model ImportCommitted {
    run: ImportRun;

    /** True once every row to create is written. Until then, call again. */
    done: boolean;

    /** Rows written by this call. */
    wrote: int32;
  }
}

namespace GMS.Routes.Custom {
  @tag("Imports")
  namespace Imports {
    /** The sources this workspace can import from for a target, and the target's fields. Outside applications: applicant workspaces, `applications:write`. Grant history: funder workspace admins, signed in. */
    @get @route("/imports/sources") @useAuth(GmsOAuth<["applications:write"]> | UserSession)
    op sources(@query target: ImportTarget): OkT<ImportSources> | BadRequest | AuthErrors;

    /** Read a source: its columns with sensitive ones dropped, sample values and a suggested mapping. Stores nothing. 409 `source_not_connected`; 422 `invalid_link`, `too_many_rows`, `source_not_readable`; 503 when the source is not set up or Composio cannot be reached. */
    @post @route("/imports/read") @useAuth(GmsOAuth<["applications:write"]> | UserSession)
    op read(@body body: ImportReadInput): OkT<ImportRead> | BadRequest | AuthErrors | Conflict | Unprocessable | ServiceUnavailable;

    /** Check every row (the dry run) and store the run: what will be created, skipped or in error, with totals by year. 422 `mapping_incomplete`. */
    @post @route("/imports/preview") @useAuth(GmsOAuth<["applications:write"]> | UserSession)
    op preview(@body body: ImportPreviewInput): CreatedT<ImportPreview> | BadRequest | AuthErrors | Conflict | Unprocessable | ServiceUnavailable;

    /** The workspace's last 20 runs for a target. */
    @get @route("/imports/runs") @useAuth(GmsOAuth<["applications:write"]> | UserSession)
    op listRuns(@query target: ImportTarget): OkT<ImportRun[]> | BadRequest | AuthErrors;

    /** A run and its log, with links to what each row created. */
    @get @route("/imports/runs/{id}") @useAuth(GmsOAuth<["applications:write"]> | UserSession)
    op getRun(@path id: CommonGrants.Types.uuid): OkT<ImportRunDetail> | AuthErrors | NotFound;

    /** Import the next batch of a checked run; call again until `done`. Each row is written once, whoever calls. 410 `import_expired` for a check older than a day. A signed-in person only: agent and API-client tokens get 403 `human_only` (they read the check with `getRun` or MCP `get_import_preview`). */
    @post @route("/imports/runs/{id}/commit") @useAuth(UserSession)
    op commit(@path id: CommonGrants.Types.uuid): OkT<ImportCommitted> | AuthErrors | NotFound | Gone;
  }
}
