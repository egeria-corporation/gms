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

// Apply anywhere (v1.5.0): outside applications, the applicant's own records of applications to
// any funder. Private to the applicant workspace (members other than consultants); never in
// CommonGrants output, Passport or funder analytics. The GMS never submits anything: it records a
// submission the person made elsewhere. Amounts are the applicant's own records; no money moves.
// Ids of outside applications, questions and funder records are bare UUIDs.

namespace GMS.Models {
  union OutsideStage {
    prospect: "prospect",
    deciding: "deciding",
    loi: "loi",
    invited: "invited",
    drafting: "drafting",
    submitted: "submitted",
    awarded: "awarded",
    declined: "declined",
    withdrawn: "withdrawn",
    not_pursuing: "not_pursuing",
  }

  /** Stages a plain move reaches (`POST /stage`); submitted, awarded and declined each need their record. */
  union OutsidePlainStage {
    prospect: "prospect",
    deciding: "deciding",
    loi: "loi",
    invited: "invited",
    drafting: "drafting",
    withdrawn: "withdrawn",
    not_pursuing: "not_pursuing",
  }

  union SubmissionMethod {
    portal: "portal",
    email: "email",
    mail: "mail",
    grants_gov: "grants_gov",
    other: "other",
  }

  union LimitKind {
    words: "words",
    chars: "chars",
    chars_no_spaces: "chars_no_spaces",
  }

  union QuestionPhase {
    loi: "loi",
    full: "full",
    report: "report",
  }

  union QuestionStatus {
    empty: "empty",
    draft: "draft",
    ready: "ready",
    approved: "approved",
  }

  model OutsideDeadlines {
    loiDue: plainDate | null;
    fullDue: plainDate | null;
    internalDue: plainDate | null;
    rolling: boolean;
  }

  model OutsideNextDeadline {
    kind: "loi" | "full" | "internal";
    date: plainDate;
  }

  model OutsidePerson {
    userId: CommonGrants.Types.uuid;
    name: string | null;
  }

  model AmountByYear {
    @minValue(1900) @maxValue(2999) year: int32;
    amountMinor: int64;
    amount: Money;
  }

  /** By year, as Money or in minor units of the application's currency. */
  union AmountByYearInput {
    money: {
      @minValue(1900) @maxValue(2999) year: int32;
      amount: Money;
    },
    minor: {
      @minValue(1900) @maxValue(2999) year: int32;
      @minValue(0) amountMinor: int64;
    },
  }

  /** What a listing said when it was saved: kept as a snapshot. */
  model OutsideListing {
    funder?: string;
    amount?: string;
    deadline?: string;
    summary?: string;
    url?: url;
  }

  model OutsideApplicationItem {
    id: CommonGrants.Types.uuid;
    title: string;
    funderName: string | null;
    funderRecordId: CommonGrants.Types.uuid | null;
    programName: string | null;
    stage: OutsideStage;
    stageLabel: string;
    source: "opengrants" | "manual" | "import" | "link";

    /** The OpenGrants listing id for source `opengrants`. */
    sourceRef: string | null;

    deadlines: OutsideDeadlines;

    /** The next deadline from today, or the latest one when all have passed. */
    nextDeadline: OutsideNextDeadline | null;

    askAmount: Money | null;
    owner: OutsidePerson | null;
    archived: boolean;
    archivedAt: utcDateTime | null;
    questionCounts: {
      total: int32;
      approved: int32;
    };
    updatedAt: utcDateTime;
  }

  model OutsideSubmission {
    submittedAt: utcDateTime;
    method: SubmissionMethod;
    methodLabel: string | null;
    confirmationRef: string | null;
    receiptDocumentId: CommonGrants.Types.uuid | null;

    /** The "as submitted" PDF of every question and its latest answer (`GET …/snapshot.pdf`). */
    snapshot: {
      documentId: CommonGrants.Types.uuid;
      sha256: Sha256;
    } | null;
  }

  model OutsideDecision {
    decidedAt: utcDateTime | null;
    awardedAmount: Money | null;
    awardByYear: AmountByYear[];
    grantStart: plainDate | null;
    grantEnd: plainDate | null;
    notes: string | null;
    nextCycleOn: plainDate | null;
  }

  model TextCounts {
    /** Runs of non-space characters. */
    words: int32;

    /** Characters including spaces and line breaks (code points; CRLF counts once). */
    chars: int32;

    charsNoSpaces: int32;
  }

  model QuestionLimit {
    kind: LimitKind;
    value: int32;
  }

  model OutsideAnswer {
    id: CommonGrants.Types.uuid;
    questionId: CommonGrants.Types.uuid;
    version: int32;
    body: string;

    /** `user`, `library`, `assist`, `prior_submission`, or `agent:<clientId>` (the forms provenance vocabulary). */
    provenance: string;

    libraryAnswerId: CommonGrants.Types.uuid | null;
    counts: TextCounts;
    overLimit: boolean;
    createdBy: CommonGrants.Types.uuid | null;
    createdAt: utcDateTime;

    /** The same as `createdBy` and `createdAt`. */
    savedBy: CommonGrants.Types.uuid | null;

    savedAt: utcDateTime;
  }

  model OutsideQuestion {
    id: CommonGrants.Types.uuid;
    outsideApplicationId: CommonGrants.Types.uuid;
    phase: QuestionPhase;
    section: string | null;
    position: int32;
    prompt: string;
    guidance: string | null;
    limit: QuestionLimit | null;

    /** The limit, flat. */
    limitKind: LimitKind | null;

    limitValue: int32 | null;
    required: boolean;
    assigneeUserId: CommonGrants.Types.uuid | null;
    status: QuestionStatus;

    /** A report question's report obligation (v1.7); null for the application's own questions. */
    obligationId: CommonGrants.Types.uuid | null;

    /** The latest saved version, or null when nothing was written yet. */
    answer: OutsideAnswer | null;

    updatedAt: utcDateTime;
  }

  /** One entry of an application's ledger: ids, stages and dates only, never answer text, amounts or addresses. */
  model OutsideActivity {
    id: string;
    type: string;
    at: utcDateTime;

    /** `user:<id>`, `user:<id>/client:<id>`, `system:<job>`. */
    actor: string;

    data: Record<unknown>;
  }

  model OutsideApplication {
    ...OutsideApplicationItem;
    previousStage: OutsideStage | null;

    /** Plain moves allowed from the current stage (none while archived). */
    allowedMoves: OutsidePlainStage[];

    listing: OutsideListing;
    listingUrl: url | null;
    portalUrl: url | null;
    currency: string;
    askByYear: AmountByYear[];

    // The submission and the decision, flat; `submission` and `decision` group the same values.
    submittedAt: utcDateTime | null;

    submissionMethod: SubmissionMethod | null;
    confirmationRef: string | null;
    receiptDocumentId: CommonGrants.Types.uuid | null;
    snapshotDocumentId: CommonGrants.Types.uuid | null;
    snapshotSha256: Sha256 | null;
    decidedAt: utcDateTime | null;
    awardedAmount: Money | null;
    awardByYear: AmountByYear[];
    grantStart: plainDate | null;
    grantEnd: plainDate | null;
    decisionNotes: string | null;
    nextCycleOn: plainDate | null;
    submission: OutsideSubmission | null;
    decision: OutsideDecision | null;

    /** Up to 30 string keys with scalar values. */
    customFields: Record<string | numeric | boolean | null>;

    funderRecord: {
      id: CommonGrants.Types.uuid;
      name: string;
      portalLoginHolder: string | null;
      portalUrl: url | null;
    } | null;

    createdAt: utcDateTime;
    questions: OutsideQuestion[];
    documents: Document[];
    tasks: Task[];

    /** Newest first, the latest 200. */
    activity: OutsideActivity[];

    /** v1.6.0: the questions whose current answer is accepted assistant text. */
    aiUse: AiUse;

    /** v1.6.0: the funder's required documents, matched to the vault. */
    requiredDocuments: RequiredDocument[];

    /** v1.6.0: the workspace's go/no-go setting and this application's scorecard. */
    goNoGo: GoNoGo;

    /** v1.7.0: when an awarded application was closed out. */
    closedOutAt: utcDateTime | null;
  }

  model OutsideApplicationInput {
    source?: "opengrants" | "manual" | "link" = "manual";

    /** The OpenGrants listing id; required with source `opengrants`. */
    sourceRef?: string;

    listing?: OutsideListing;
    title: string;
    funderName: string;
    programName?: string;
    funderRecordId?: CommonGrants.Types.uuid;
    listingUrl?: url;
    portalUrl?: url;
    loiDue?: plainDate;
    fullDue?: plainDate;
    internalDue?: plainDate;
    rolling?: boolean;
    askAmount?: Money;
    stage?: "prospect" | "drafting" = "drafting";
  }

  /** Everything edited by hand. Never the stage, the submission or the decision (400 for those fields). */
  model OutsideApplicationPatch {
    title?: string;
    funderName?: string;
    programName?: string | null;
    funderRecordId?: CommonGrants.Types.uuid | null;
    listingUrl?: url | null;
    portalUrl?: url | null;
    loiDue?: plainDate | null;
    fullDue?: plainDate | null;
    internalDue?: plainDate | null;
    rolling?: boolean;
    askAmount?: Money | null;
    askByYear?: AmountByYearInput[];
    ownerUserId?: CommonGrants.Types.uuid | null;
    customFields?: Record<string | numeric | boolean | null>;
  }

  model OutsideStageInput {
    to: OutsidePlainStage;
  }

  model OutsideSubmissionInput {
    /** RFC 3339 timestamp, or a date (recorded at 12:00 UTC). Not in the future. */
    submittedAt: string;

    method: SubmissionMethod;
    confirmationRef?: string;

    /** A document already attached to this application. */
    receiptDocumentId?: CommonGrants.Types.uuid;
  }

  model OutsideDecisionInput {
    outcome: "awarded" | "declined" | "withdrawn";

    /** Required for `awarded`, zero or more. */
    awardedAmount?: Money;

    awardByYear?: AmountByYearInput[];
    grantStart?: plainDate;
    grantEnd?: plainDate;
    notes?: string;
    nextCycleOn?: plainDate;
  }

  model OutsideQuestionInput {
    phase?: QuestionPhase = QuestionPhase.full;
    section?: string | null;
    position?: int32;
    prompt: string;
    guidance?: string | null;
    limitKind?: LimitKind | null;
    limitValue?: int32 | null;
    required?: boolean;
    assigneeUserId?: CommonGrants.Types.uuid | null;
  }

  /** One question, or up to 100 at once (the reviewed result of a paste). */
  union OutsideQuestionsInput {
    one: OutsideQuestionInput,
    many: {
      questions: OutsideQuestionInput[];
    },
  }

  model OutsideQuestionPatch {
    phase?: QuestionPhase;
    section?: string | null;
    position?: int32;
    prompt?: string;
    guidance?: string | null;
    limitKind?: LimitKind | null;
    limitValue?: int32 | null;
    required?: boolean;
    assigneeUserId?: CommonGrants.Types.uuid | null;

    /** `ready` and `approved` need a saved answer (422 `no_answer`). */
    status?: "draft" | "ready" | "approved";
  }

  model ParseQuestionsInput {
    text: string;
    phase?: QuestionPhase;

    /** `ai` (v1.6.0): the assistant reads pasted guidelines (60,000 characters at most) and answers a `GuidelinesProposal`; 404 `assistant_disabled` when it is off. */
    mode?: "deterministic" | "ai";
  }

  model ParsedQuestion {
    prompt: string;
    limitKind?: LimitKind;
    limitValue?: int32;
    phase: QuestionPhase;
  }

  model ParsedQuestions {
    mode?: "deterministic";
    questions: ParsedQuestion[];
  }

  model OutsideAnswerInput {
    body: string;

    /** The library answer it came from: provenance becomes `library` and the library records the use. */
    libraryAnswerId?: CommonGrants.Types.uuid;

    /** `assist`: accepted assistant text. `prior_submission`: reused from an earlier report (with `sourceAnswerId`). Not with `libraryAnswerId`. An agent's save is always the agent's. */
    provenance?: "assist" | "prior_submission";

    sourceAnswerId?: CommonGrants.Types.uuid;
  }

  model OutsideAnswerSaved {
    ...OutsideAnswer;
    question: OutsideQuestion;
  }

  union OutsideDocumentInput {
    upload: {
      name: string;
      mime: string;
      contentBase64: string;

      /** v1.7.0: `award_letter` marks the funder's award letter. A file named like a bank or tax form is refused (422 `sensitive_document`). */
      docType?: "award_letter";
    },
    lockerWithDetails: {
      name: string;
      mime: string;
      passportDocumentId: string;
      size: int64;
      sha256: Sha256;
      docType?: "award_letter";
    },
    locker: {
      passportDocumentId: string;
      docType?: "award_letter";
    },
  }

  model Deleted {
    id: CommonGrants.Types.uuid;
    deleted: boolean;
  }

  model PipelineItem {
    kind: "gms_application" | "outside_application" | "saved_gms";

    /** `app_…` for a built-in application; a UUID otherwise. */
    id: string;

    title: string;
    funderName: string | null;

    /** Outside applications. */
    stage: OutsideStage | null;

    stageLabel?: string;

    /** Built-in applications (their status) and saved GMS opportunities (`saved`). */
    status: string | null;

    statusLabel?: string;
    nextDeadline: plainDate | null;
    askAmount: Money | null;
    owner: OutsidePerson | null;
    url: url | null;
    updatedAt: utcDateTime;
  }

  model FunderRecordContact {
    name: string;
    role?: string;
    email?: string;
    phone?: string;
  }

  model FunderRecord {
    id: CommonGrants.Types.uuid;
    name: string;
    website: url | null;
    notes: string | null;
    contacts: FunderRecordContact[];
    portalUrl: url | null;

    /** The name of the person who holds the login to the funder's portal. Never the login itself. */
    portalLoginHolder: string | null;

    createdAt: utcDateTime;
    updatedAt: utcDateTime;
  }

  model FunderRecordSummary {
    ...FunderRecord;
    applicationCount: int32;
  }

  model FunderRecordApplication {
    kind: "outside_application" | "gms_application";
    id: string;
    title: string;
    stage?: OutsideStage;
    stageLabel?: string;
    status?: string;
    askAmount: Money | null;
    awardedAmount?: Money | null;
    submittedAt: utcDateTime | null;
    decidedAt?: utcDateTime | null;
    archived?: boolean;

    /** `linked`: an outside application on this record. `name`: a built-in application to a funder workspace with exactly this name. */
    match: "linked" | "name";
  }

  model FunderRecordDetail {
    ...FunderRecord;
    applications: FunderRecordApplication[];
  }

  model FunderRecordInput {
    name: string;
    website?: url | null;
    notes?: string | null;

    @maxItems(20)
    contacts?: FunderRecordContact[];

    portalUrl?: url | null;
    portalLoginHolder?: string | null;
  }

  model FunderRecordPatch {
    name?: string;
    website?: url | null;
    notes?: string | null;

    @maxItems(20)
    contacts?: FunderRecordContact[];

    portalUrl?: url | null;
    portalLoginHolder?: string | null;
  }

  model CalendarFeedStatus {
    exists: boolean;
    createdAt: utcDateTime | null;
    rotatedAt: utcDateTime | null;
  }

  /** Shown this once. Anyone with the link sees deadline titles, funders and dates, nothing else. */
  model CalendarFeedLink {
    url: url;
    rotated: boolean;
  }

  model CalendarFeedDeleted {
    deleted: boolean;
  }

  model OutsideImportInput {
    csv: string;

    /** Target field → CSV column header. `title` and `funderName` are required. Unmapped columns are never read. */
    mapping: Record<string>;

    /** Preview only (the default). */
    dryRun?: boolean = true;
  }

  model OutsideImportProblem {
    field?: string;
    message: string;
  }

  model OutsideImportRow {
    /** The line in the file; the header is line 1. */
    row: int32;

    ok: boolean;
    problems: OutsideImportProblem[];

    /** What was read from the mapped columns. */
    values: Record<string>;

    /** How the row is saved: stage key, dates, Money amounts. */
    normalized: Record<unknown>;

    /** Set on a real import for a row that was created. */
    id?: CommonGrants.Types.uuid;
  }

  model OutsideImportResult {
    dryRun: boolean;
    rows: OutsideImportRow[];
    created: OutsideApplicationItem[];
    summary: {
      rows: int32;
      valid: int32;
      created: int32;
      failed: int32;
    };
    unknownColumns: string[];

    /** Columns left out because their header names bank or identity data. */
    refusedColumns: string[];
  }

  model ConsultingRequestInput {
    /** Default: the signed-in person's name and address. */
    contactName?: string;

    contactEmail?: string;
    message?: string;

    /** Send the latest answers too (truncated to 20,000 characters in all). */
    includeAnswers?: boolean = false;
  }

  model ConsultingPreview {
    /** CONSULTING_REQUEST_TO, default `hello@agents.opengrants.io`. */
    to: string;

    replyTo: string;
    subject: string;

    /** Exactly the email's text. */
    text: string;

    organization: string;
    contactName: string;
    contactEmail: string;
    title: string;
    funder: string | null;
    deadlines: OutsideDeadlines;
    ask: Money | null;
    listingUrl: url | null;
    portalUrl: url | null;
    stage: OutsideStage;
    stageLabel: string;
    questionCount: int32;
    message: string | null;

    /** Present only when the person chose to include their current answers. */
    answers: {
      prompt: string;
      body: string;
    }[] | null;

    /** True when the answers were cut to 20,000 characters. */
    answersTruncated: boolean;

    content: Record<unknown>;

    /** Names of the fields that will be sent, never their values. */
    fieldsSent: string[];
  }

  model ConsultingSent {
    sent: boolean;
    requestId: CommonGrants.Types.uuid;
    sentAt: utcDateTime;
    to: string;
    replyTo: string;
    message: string;
  }

  model OpenGrantsListingDetail {
    id: string;
    title: string;
    funder?: string;
    url?: url;
    source?: string;
    deadline?: string;
    amount?: string;
    summary?: string;

    /** Set when the listing points back at an opportunity on this GMS. */
    gms: {
      opportunityId: PrefixedId;
      competitionId: CommonGrants.Types.uuid | null;
    } | null;
  }

  model ICalendar {
    @statusCode statusCode: 200;
    @header contentType: "text/calendar; charset=utf-8";
    @body body: string;
  }

  model CsvFile {
    @statusCode statusCode: 200;
    @header contentType: "text/csv; charset=utf-8";
    @body body: string;
  }

  model ExportFile {
    @statusCode statusCode: 200;
    @header contentType: "text/plain; charset=utf-8" | "text/markdown; charset=utf-8" | "application/pdf" | "application/json; charset=utf-8";
    @body body: bytes;
  }

  model DocumentBytes {
    @statusCode statusCode: 200;
    @header contentType: string;
    @body body: bytes;
  }
}

namespace GMS.Routes.Custom {
  @tag("Apply anywhere")
  namespace Outside {
    /** One list of every grant the applicant works on: built-in applications, outside applications (not archived) and saved GMS opportunities, by next deadline. */
    @get @route("/pipeline") @useAuth(GmsOAuth<["applications:read"]> | UserSession)
    op pipeline(): OkT<PipelineItem[]> | AuthErrors;

    /** Outside applications. `stage` is a comma-separated list; `archived` is `false` (default), `true` or `all`. */
    @get @route("/outside-applications") @useAuth(GmsOAuth<["applications:read"]> | UserSession)
    op list(@query stage?: string, @query q?: string, @query archived?: "true" | "false" | "all"): OkT<OutsideApplicationItem[]> | BadRequest | AuthErrors;

    /** Start tracking an application to any funder. 200 with the existing one for an OpenGrants listing already tracked. 409 `apply_here` when a link to start drafting points at an opportunity open on this GMS. */
    @post @route("/outside-applications") @useAuth(GmsOAuth<["applications:write"]> | UserSession)
    op create(@body body: OutsideApplicationInput): CreatedT<OutsideApplication> | OkT<OutsideApplication> | BadRequest | AuthErrors | NotFound | Conflict;

    @get @route("/outside-applications/{id}") @useAuth(GmsOAuth<["applications:read"]> | UserSession)
    op get(@path id: CommonGrants.Types.uuid): OkT<OutsideApplication> | AuthErrors | NotFound;

    /** 409 `archived` while archived. */
    @patch @route("/outside-applications/{id}") @useAuth(GmsOAuth<["applications:write"]> | UserSession)
    op update(@path id: CommonGrants.Types.uuid, @body body: OutsideApplicationPatch): OkT<OutsideApplication> | BadRequest | AuthErrors | NotFound | Conflict | Unprocessable;

    /** A plain move (`outside_application` machine). 409 `guard_failed` or `invalid_transition` with the reason. */
    @post @route("/outside-applications/{id}/stage") @useAuth(GmsOAuth<["applications:write"]> | UserSession)
    op setStage(@path id: CommonGrants.Types.uuid, @body body: OutsideStageInput): OkT<OutsideApplication> | BadRequest | AuthErrors | NotFound | Conflict;

    /** Record that the person submitted it elsewhere, keeping an "as submitted" PDF and its SHA-256. A person only: an agent's call is 403 `approval_required` (the MCP tool files an approval). 503 `storage_unavailable` without file storage. */
    @post @route("/outside-applications/{id}/submit") @useAuth(UserSession)
    op submit(@path id: CommonGrants.Types.uuid, @body body: OutsideSubmissionInput): OkT<OutsideApplication> | BadRequest | AuthErrors | NotFound | Conflict | Unprocessable | ServiceUnavailable;

    /** Record the funder's decision. A person only, like the submission. */
    @post @route("/outside-applications/{id}/decision") @useAuth(UserSession)
    op decide(@path id: CommonGrants.Types.uuid, @body body: OutsideDecisionInput): OkT<OutsideApplication> | BadRequest | AuthErrors | NotFound | Conflict | Unprocessable;

    /** Back to the stage before it closed (awarded, declined, withdrawn or not pursuing). */
    @post @route("/outside-applications/{id}/reopen") @useAuth(GmsOAuth<["applications:write"]> | UserSession)
    op reopen(@path id: CommonGrants.Types.uuid): OkT<OutsideApplication> | AuthErrors | NotFound | Conflict;

    @post @route("/outside-applications/{id}/archive") @useAuth(GmsOAuth<["applications:write"]> | UserSession)
    op archive(@path id: CommonGrants.Types.uuid): OkT<OutsideApplication> | AuthErrors | NotFound | Conflict;

    @post @route("/outside-applications/{id}/unarchive") @useAuth(GmsOAuth<["applications:write"]> | UserSession)
    op unarchive(@path id: CommonGrants.Types.uuid): OkT<OutsideApplication> | AuthErrors | NotFound | Conflict;

    /** Questions and latest answers as text, Markdown or PDF. */
    @get @route("/outside-applications/{id}/export") @useAuth(GmsOAuth<["applications:read"]> | UserSession)
    op exportOne(@path id: CommonGrants.Types.uuid, @query format?: "txt" | "md" | "pdf"): ExportFile | BadRequest | AuthErrors | NotFound;

    /** The "as submitted" PDF. */
    @get @route("/outside-applications/{id}/snapshot.pdf") @useAuth(GmsOAuth<["applications:read"]> | UserSession)
    op snapshot(@path id: CommonGrants.Types.uuid): Pdf | AuthErrors | NotFound | ServiceUnavailable;

    @get @route("/outside-applications/{id}/documents") @useAuth(GmsOAuth<["applications:read"]> | UserSession)
    op listDocuments(@path id: CommonGrants.Types.uuid): OkT<Document[]> | AuthErrors | NotFound;

    /** Upload a file (up to 25 MB) or reference one in the Passport locker. Members only. */
    @post @route("/outside-applications/{id}/documents") @useAuth(GmsOAuth<["applications:write"]> | UserSession)
    op attachDocument(@path id: CommonGrants.Types.uuid, @body body: OutsideDocumentInput): CreatedT<Document> | BadRequest | AuthErrors | NotFound | Conflict | Unprocessable | ServiceUnavailable;

    @get @route("/outside-applications/{id}/documents/{docId}/file") @useAuth(GmsOAuth<["applications:read"]> | UserSession)
    op documentContent(@path id: CommonGrants.Types.uuid, @path docId: CommonGrants.Types.uuid): DocumentBytes | AuthErrors | NotFound | Conflict | ServiceUnavailable;

    @get @route("/outside-applications/{id}/questions") @useAuth(GmsOAuth<["applications:read"]> | UserSession)
    op listQuestions(@path id: CommonGrants.Types.uuid): OkT<OutsideQuestion[]> | AuthErrors | NotFound;

    /** Add one question or a list (at most 300 on an application). */
    @post @route("/outside-applications/{id}/questions") @useAuth(GmsOAuth<["applications:write"]> | UserSession)
    op addQuestions(@path id: CommonGrants.Types.uuid, @body body: OutsideQuestionsInput): CreatedT<OutsideQuestion[]> | BadRequest | AuthErrors | NotFound | Conflict | Unprocessable;

    /** Propose questions from pasted text; nothing is saved. Deterministic: split on numbering and blank lines, limits read from the text. */
    @post @route("/outside-applications/{id}/questions/parse") @useAuth(GmsOAuth<["applications:write"]> | UserSession)
    op parseQuestions(@path id: CommonGrants.Types.uuid, @body body: ParseQuestionsInput): OkT<ParsedQuestions | GuidelinesProposal> | BadRequest | AuthErrors | NotFound | Unprocessable | TooManyRequests | ServiceUnavailable;

    @patch @route("/outside-questions/{qid}") @useAuth(GmsOAuth<["applications:write"]> | UserSession)
    op updateQuestion(@path qid: CommonGrants.Types.uuid, @body body: OutsideQuestionPatch): OkT<OutsideQuestion> | BadRequest | AuthErrors | NotFound | Conflict | Unprocessable;

    @delete @route("/outside-questions/{qid}") @useAuth(GmsOAuth<["applications:write"]> | UserSession)
    op deleteQuestion(@path qid: CommonGrants.Types.uuid): OkT<Deleted> | AuthErrors | NotFound | Conflict;

    /** Save an answer as a new version, with its counts and whether it is over the limit. */
    @put @route("/outside-questions/{qid}/answer") @useAuth(GmsOAuth<["applications:write"]> | UserSession)
    op putAnswer(@path qid: CommonGrants.Types.uuid, @body body: OutsideAnswerInput): OkT<OutsideAnswerSaved> | BadRequest | AuthErrors | NotFound | Conflict;

    /** Every version, newest first. */
    @get @route("/outside-questions/{qid}/answers") @useAuth(GmsOAuth<["applications:read"]> | UserSession)
    op answerVersions(@path qid: CommonGrants.Types.uuid): OkT<OutsideAnswer[]> | AuthErrors | NotFound;

    /** Import outside applications from a CSV (up to 500 rows). A dry run, the default, writes nothing. */
    @post @route("/outside-applications/import") @useAuth(GmsOAuth<["applications:write"]> | UserSession)
    op importCsv(@body body: OutsideImportInput): OkT<OutsideImportResult> | BadRequest | AuthErrors | Unprocessable;

    @get @route("/outside-applications/export.csv") @useAuth(GmsOAuth<["applications:read"]> | UserSession)
    op exportCsv(): CsvFile | AuthErrors;

    @get @route("/outside-applications/export.json") @useAuth(GmsOAuth<["applications:read"]> | UserSession)
    op exportJson(): ExportFile | AuthErrors;

    /** Exactly what a consulting request would send, and to whom. A person only; nothing is sent or counted. */
    @post @route("/outside-applications/{id}/consulting-request/preview") @useAuth(UserSession)
    op consultingPreview(@path id: CommonGrants.Types.uuid, @body body: ConsultingRequestInput): OkT<ConsultingPreview> | BadRequest | AuthErrors | NotFound | Unprocessable;

    /** Ask OpenGrants for consulting support (email with reply-to the person). A person only; admins and editors. 429 `too_many_requests_for_application` (3 a day) or `too_many_requests` (10 a day per workspace); 503 `mail_not_configured`. */
    @post @route("/outside-applications/{id}/consulting-request") @useAuth(UserSession)
    op consultingRequest(@path id: CommonGrants.Types.uuid, @body body: ConsultingRequestInput): OkT<ConsultingSent> | BadRequest | AuthErrors | NotFound | Unprocessable | TooManyRequests | ServiceUnavailable;

    @get @route("/funder-records") @useAuth(GmsOAuth<["applications:read"]> | UserSession)
    op listFunderRecords(): OkT<FunderRecordSummary[]> | AuthErrors;

    /** 409 when a record of that name (ignoring case) exists. */
    @post @route("/funder-records") @useAuth(GmsOAuth<["applications:write"]> | UserSession)
    op createFunderRecord(@body body: FunderRecordInput): CreatedT<FunderRecordDetail> | BadRequest | AuthErrors | Conflict;

    @get @route("/funder-records/{id}") @useAuth(GmsOAuth<["applications:read"]> | UserSession)
    op getFunderRecord(@path id: CommonGrants.Types.uuid): OkT<FunderRecordDetail> | AuthErrors | NotFound;

    @patch @route("/funder-records/{id}") @useAuth(GmsOAuth<["applications:write"]> | UserSession)
    op updateFunderRecord(@path id: CommonGrants.Types.uuid, @body body: FunderRecordPatch): OkT<FunderRecordDetail> | BadRequest | AuthErrors | NotFound | Conflict;

    /** Its outside applications stay, unlinked. */
    @delete @route("/funder-records/{id}") @useAuth(GmsOAuth<["applications:write"]> | UserSession)
    op deleteFunderRecord(@path id: CommonGrants.Types.uuid): OkT<Deleted> | AuthErrors | NotFound;

    /** Whether the workspace has a calendar link (never the link). */
    @get @route("/calendar-feed") @useAuth(GmsOAuth<["applications:read"]> | UserSession)
    op calendarFeedStatus(): OkT<CalendarFeedStatus> | AuthErrors;

    /** Make the link, or replace it (the old one stops working). Shown once. A person only; admins and editors. */
    @post @route("/calendar-feed") @useAuth(UserSession)
    op createCalendarFeed(): OkT<CalendarFeedLink> | AuthErrors;

    @delete @route("/calendar-feed") @useAuth(UserSession)
    op deleteCalendarFeed(): OkT<CalendarFeedDeleted> | AuthErrors;

    /** The calendar feed. No token: the link is the key (kept as a SHA-256). All-day events with a title, the funder and the date only. Rate limited per link (429). */
    @get @route("/cal/{file}")
    op calendar(@path file: string): ICalendar | NotFound | TooManyRequests;

    /** One OpenGrants listing (`GET /grants-api/{id}` of the OpenGrants REST API). 404 `not_found` when OpenGrants has none; 404 `not_available` when this server cannot read one listing. */
    @get @route("/discover/opengrants/{listingId}") @useAuth(GmsOAuth<["discovery"]> | UserSession)
    op openGrantsListing(@path listingId: string): OkT<OpenGrantsListingDetail> | AuthErrors | NotFound | ServiceUnavailable;
  }
}
