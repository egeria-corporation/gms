import "@typespec/http";
import "@common-grants/core";
import "./models.tsp";
import "./routes.tsp";
import "./outside.tsp";

using TypeSpec.Http;
using CommonGrants.Responses;
using CommonGrants.Fields;
using GMS.Models;
using GMS.Auth;
using GMS.Errors;
using GMS.HttpResponses;

// Write faster as a team (v1.6.0) and win and keep it (v1.7.0), for applicant workspaces. The
// assistant drafts from the organization's own content and reads a funder's guidelines (pasted or
// uploaded through the guidelines route), never a vault document; drafts save nothing. Private to
// the applicant workspace (members other than consultants). Amounts are the applicant's own
// records: an amount and a date, never a destination or bank detail; no money moves.

namespace GMS.Models {
  // ---------------------------------------------------------------- drafting and guidelines

  /** A figure in the draft taken from a library answer not verified in the last 12 months (or never). */
  model StaleFlag {
    answerId: CommonGrants.Types.uuid;
    figure: string;
    note: string;
  }

  model DraftUsedAnswer {
    id: CommonGrants.Types.uuid;
    key: string;
    title: string;
    version: int32;
    lastVerifiedAt: utcDateTime | null;
    stale: boolean;
  }

  /** The assistant's draft of an answer. Nothing is saved: accept it with `PUT /outside-questions/{qid}/answer` and `provenance: "assist"`. */
  model DraftedAnswer {
    questionId: CommonGrants.Types.uuid;
    outsideApplicationId: CommonGrants.Types.uuid;

    /** The draft text; what the material does not say is written as [bracketed placeholders]. */
    draft: string;

    /** Library answers the draft draws on (only ids it was given). */
    usedAnswerIds: CommonGrants.Types.uuid[];

    usedAnswers: DraftUsedAnswer[];

    /** The up to eight library answers chosen by word overlap and sent with the question. */
    offeredAnswerIds: CommonGrants.Types.uuid[];

    /** The placeholders in the draft, and anything else the question asks for that the material lacks. */
    unknowns: string[];

    staleFlags: StaleFlag[];

    /** Counted by the server, not the model. */
    counts: TextCounts;

    limit: QuestionLimit | null;
    overLimit: boolean;

    /** True when the first draft was over the limit and a second call fitted it (two calls on the quota). */
    retried: boolean;

    saved: false;
    provenance: "assist";
    `model`: string;
    quota: AssistQuota;
  }

  union VaultType {
    irs_letter: "irs_letter",
    audit: "audit",
    financials: "financials",
    board_list: "board_list",
    budget: "budget",
    annual_report: "annual_report",
    logo: "logo",
    other: "other",
  }

  /** A required document the guidelines name, with the vault type it matches (null when none does). */
  model RequiredDocumentLabel {
    label: string;
    docType: VaultType | null;
  }

  /** The assistant's reading of a funder's guidelines. Nothing is saved; the person reviews it. */
  model GuidelinesProposal {
    mode: "ai";
    questions: ParsedQuestion[];
    requiredDocuments: RequiredDocumentLabel[];
    deadlines: {
      loiDue: plainDate | null;
      fullDue: plainDate | null;
    };
    cautions: string[];
    saved: false;
    `model`: string;
    quota: AssistQuota;
  }

  /** A PDF or plain-text file of the funder's guidelines: up to 10 MB and 50 pages (text: 60,000 characters). */
  model GuidelinesUploadInput {
    name: string;
    mime: "application/pdf" | "text/plain";
    contentBase64: string;
    phase?: "loi" | "full";
  }

  model GuidelinesUploaded {
    ...GuidelinesProposal;

    /** Kept on the application as a document typed `funder_guidelines` (the same file once). */
    document: Document;
  }

  /** One library answer offered for a question, with the version that best fits its limit. */
  model LibrarySuggestion {
    id: CommonGrants.Types.uuid;
    key: string;
    title: string;
    version: int32;
    tags: string[];

    /** Word overlap with the question, 0 to 1. */
    relevance: float64;

    lastVerifiedAt: utcDateTime | null;
    stale: boolean;
    suggested: {
      variant: "body" | "short" | "medium" | "long";
      text: string;
      fits: boolean;
      counts: TextCounts;
    };
  }

  model AiUseQuestion {
    questionId: CommonGrants.Types.uuid;
    prompt: string;
    phase: QuestionPhase;
    version: int32;
    savedAt: utcDateTime;
  }

  /** The "AI use" note: questions whose current answer is accepted assistant text (provenance `assist`). */
  model AiUse {
    used: boolean;
    count: int32;
    questions: AiUseQuestion[];
  }

  // ---------------------------------------------------------------- the vault and required documents

  model DocumentExpiry {
    /** `expiring`: within 30 days. */
    state: "none" | "current" | "expiring" | "expired";

    expiresOn: plainDate | null;
    daysLeft: int32 | null;
  }

  model VaultDocument {
    id: CommonGrants.Types.uuid;
    name: string;
    mime: string;
    size: int64;
    sha256: Sha256;
    docType: VaultType;
    docTypeLabel: string;
    expiresOn: plainDate | null;
    expiry: DocumentExpiry;
    uploadedBy: CommonGrants.Types.uuid | null;
    uploadedAt: utcDateTime;
    updatedAt: utcDateTime;
  }

  model VaultList {
    documents: VaultDocument[];
    types: {
      type: VaultType;
      label: string;
    }[];

    /** What the upload dialog says the vault never keeps. */
    `never`: string;
  }

  /** Up to 25 MB. A file named like a bank or tax form (bank, ach, void, routing, w-9) is refused, 422 `sensitive_document`. */
  model VaultUploadInput {
    name: string;
    mime: string;
    contentBase64: string;
    docType: VaultType;
    expiresOn?: plainDate;
  }

  model VaultPatch {
    name?: string;
    docType?: VaultType;
    expiresOn?: plainDate | null;
  }

  model RequiredDocument {
    label: string;
    docType: VaultType | null;
    status: "needed" | "attached" | "not_needed";

    /** The vault document attached ("Use from vault"). */
    document: VaultDocument | null;

    /** Vault documents of the same type. */
    matches: VaultDocument[];
  }

  model RequiredDocumentItemInput {
    /** Unique within the list (ignoring case). */
    label: string;

    docType?: VaultType | null;
    status?: "needed" | "not_needed";

    /** A vault document of this workspace; the item is then attached. */
    documentId?: CommonGrants.Types.uuid | null;
  }

  model RequiredDocumentsInput {
    items: RequiredDocumentItemInput[];
  }

  model UseFromVaultInput {
    /** The required document's label (ignoring case). */
    label: string;

    /** Null takes the attached document off. */
    documentId: CommonGrants.Types.uuid | null;
  }

  // ---------------------------------------------------------------- go/no-go, comments, milestones, calendar

  model GoNoGoWeights {
    fit: int32;
    capacity: int32;
    effort: int32;
    relationship: int32;
  }

  model GoNoGoScores {
    @minValue(1) @maxValue(5) fit: int32;
    @minValue(1) @maxValue(5) capacity: int32;
    @minValue(1) @maxValue(5) effort: int32;
    @minValue(1) @maxValue(5) relationship: int32;
  }

  model GoNoGoScorecard {
    scores: {
      eligibility: "pass" | "fail";
      ...GoNoGoScores;
    };
    weights: GoNoGoWeights;

    /** The weighted mean of the four scores, 1 to 5. */
    total: float64;

    decision: "go" | "no_go";
    decidedBy: CommonGrants.Types.uuid | null;
    decidedAt: utcDateTime;
    reason: string | null;
    to: "loi" | "drafting" | "not_pursuing";
  }

  /** The workspace setting (`goNoGoEnabled`, `goNoGoWeights`; off by default, weights 3, 2, 2, 1) and the application's scorecard. */
  model GoNoGo {
    enabled: boolean;
    weights: GoNoGoWeights;
    labels: Record<string>;
    scorecard: GoNoGoScorecard | null;
  }

  model GoNoGoInput {
    eligibility: "pass" | "fail";
    scores: GoNoGoScores;
    decision: "go" | "no_go";

    /** Required for `go`: where it goes next. */
    to?: "loi" | "drafting";

    reason?: string;
  }

  model QuestionComment {
    id: CommonGrants.Types.uuid;
    questionId: CommonGrants.Types.uuid | null;
    body: string;
    author: string;
    authorUserId: CommonGrants.Types.uuid | null;
    resolvedAt: utcDateTime | null;
    resolvedBy: CommonGrants.Types.uuid | null;
    createdAt: utcDateTime;
  }

  model QuestionCommentInput {
    body: string;
  }

  model MilestoneOffer {
    fullDue: plainDate | null;

    /** Draft due 14 days before the full deadline, review 7, final 2. Not saved. */
    tasks: {
      key: "draft" | "review" | "final";
      title: string;
      dueOn: plainDate;
      assigneeUserId: CommonGrants.Types.uuid | null;
      past: boolean;
    }[];
  }

  model MilestonesInput {
    tasks: {
      title: string;
      dueOn: plainDate;
      assigneeUserId?: CommonGrants.Types.uuid | null;
    }[];
  }

  model MilestoneTask {
    id: CommonGrants.Types.uuid;
    title: string;
    assigneeUserId: CommonGrants.Types.uuid | null;
    dueAt: utcDateTime | null;
    doneAt: utcDateTime | null;
  }

  model PipelineCalendar {
    /** YYYY-MM. */
    month: string;

    /** Weekday of the 1st, 0 = Sunday. */
    firstWeekday: int32;

    days: {
      date: plainDate;
      events: {
        date: plainDate;
        kind: "loi" | "full" | "internal";
        outsideApplicationId: CommonGrants.Types.uuid;
        title: string;
        funderName: string | null;
        stage: OutsideStage;
      }[];
    }[];
  }

  // ---------------------------------------------------------------- obligations of an outside award

  union ObligationKind {
    report: "report",
    payment_expected: "payment_expected",
    payment_received: "payment_received",
    condition: "condition",
  }

  union ObligationStatus {
    upcoming: "upcoming",
    due: "due",
    submitted: "submitted",
    received: "received",
    done: "done",
    missed: "missed",
  }

  model Obligation {
    id: CommonGrants.Types.uuid;
    outsideApplicationId: CommonGrants.Types.uuid;
    kind: ObligationKind;
    kindLabel: string;
    title: string;

    /** When it is due; for a payment received, the date it arrived. */
    dueOn: plainDate | null;

    /** Payments only: the applicant's own record. */
    amount: Money | null;

    status: ObligationStatus;
    statusLabel: string;
    overdue: boolean;
    seriesId: CommonGrants.Types.uuid | null;

    /** Edited on its own; regenerating the series leaves it as it is. */
    customized: boolean;

    notes: string | null;
    submittedAt: utcDateTime | null;
    confirmationRef: string | null;

    /** A submitted report's "as submitted" PDF, read through the application's documents. */
    snapshot: {
      documentId: CommonGrants.Types.uuid;
      sha256: Sha256;
    } | null;

    documentId: CommonGrants.Types.uuid | null;
    completedOn: plainDate | null;
    questionCount: int32;

    /** Statuses a person may move it to (submitted has its own route). */
    allowedStatuses: ObligationStatus[];

    createdAt: utcDateTime;
    updatedAt: utcDateTime;
  }

  model ObligationSeries {
    id: CommonGrants.Types.uuid;
    kind: string;
    title: string;
    everyMonths: int32;
    startOn: plainDate;
    endOn: plainDate;
    amount: Money | null;
    notes: string | null;
    instances: int32;
  }

  model ObligationPayments {
    currency: string;
    awarded: Money | null;
    received: Money;
    expected: Money;
    outstanding: Money | null;
    entries: Obligation[];
  }

  model ObligationCloseout {
    closedOutAt: utcDateTime | null;

    /** Every obligation done or received, the application awarded and not archived. */
    eligible: boolean;

    openCount: int32;
  }

  model ObligationList {
    obligations: Obligation[];
    series: ObligationSeries[];
    payments: ObligationPayments;
    closeout: ObligationCloseout;
  }

  model ObligationSeriesInput {
    @minValue(1) @maxValue(24) everyMonths: int32;

    /** The first instance's date. */
    startOn: plainDate;

    /** Defaults to the grant's end. */
    endOn?: plainDate;
  }

  model ObligationInput {
    kind: ObligationKind;
    title: string;

    /** Required for a report (unless a series) and a payment received (the date it arrived). */
    dueOn?: plainDate;

    /** Payments only, in the application's currency. */
    amount?: Money;

    notes?: string;

    /** "Every N months from start until grant end": at most 60 instances (422 `series_out_of_bounds`). Not for a payment received. */
    series?: ObligationSeriesInput;
  }

  model ObligationSeriesCreated {
    series: ObligationSeries;
    obligations: Obligation[];
  }

  model ObligationPatch {
    title?: string;
    dueOn?: plainDate | null;
    amount?: Money | null;
    notes?: string | null;
  }

  model ObligationStatusInput {
    to: ObligationStatus;

    /** When it was done or received (defaults to today). */
    completedOn?: plainDate;

    /** An expected payment received: the amount that came in. */
    amount?: Money;
  }

  model ObligationSeriesPatch {
    title?: string;
    @minValue(1) @maxValue(24) everyMonths?: int32;
    startOn?: plainDate;
    endOn?: plainDate;
    amount?: Money | null;
    notes?: string | null;
  }

  model ObligationSeriesChanged {
    series: ObligationSeries;

    /** Future, untouched instances replaced. */
    replaced: int32;

    added: int32;

    /** Past, edited, moved or written instances left as they were. */
    kept: int32;
  }

  model ObligationSeriesDeleted {
    id: CommonGrants.Types.uuid;
    deleted: true;
    removed: int32;
    kept: int32;
  }

  model ReportSubmissionInput {
    /** RFC 3339 timestamp, or a date (recorded at 12:00 UTC). Not in the future. */
    submittedAt: string;

    confirmationRef?: string;
  }

  /** An earlier report's answer to reuse (save it with `provenance: "prior_submission"` and `sourceAnswerId`). */
  model ReuseCandidate {
    answerId: CommonGrants.Types.uuid;
    questionId: CommonGrants.Types.uuid;
    prompt: string;
    body: string;
    version: int32;
    counts: TextCounts;
    obligationId: CommonGrants.Types.uuid | null;
    obligationTitle: string | null;
    reportStatus: ObligationStatus | null;
    submittedAt: utcDateTime | null;
    applicationTitle: string | null;
    funderName: string | null;
    relevance: float64;
  }

  model OutsideAward {
    id: CommonGrants.Types.uuid;
    label: "Outside award";
    source: "outside";
    title: string;
    funderName: string | null;
    programName: string | null;
    currency: string;
    awardedAmount: Money | null;
    awardByYear: AmountByYear[];
    grantStart: plainDate | null;
    grantEnd: plainDate | null;
    decidedAt: utcDateTime | null;

    /** The latest document attached with `docType: "award_letter"`. */
    awardLetter: Document | null;

    ...ObligationList;
  }

  model AwardedFundingItem {
    kind: "gms_award" | "outside_award";
    label: "On this GMS" | "Outside award";

    /** `awd_…` for a built-in award, the outside application's UUID for an outside award. */
    id: string;

    title: string;
    funderName: string | null;
    status: string;
    statusLabel: string;
    currency: string;
    awardedAmountMinor: int64 | null;
    awardedAmount: Money | null;
    grantStart: plainDate | null;
    grantEnd: plainDate | null;
    closedOutAt: utcDateTime | null;

    /** A built-in award as `/gms/my/awards` lists it; null for an outside award. */
    award: Record<unknown> | null;
  }

  model AwardedFunding {
    items: AwardedFundingItem[];
  }

  // ---------------------------------------------------------------- funding summary

  model FundingSummaryCounts {
    submitted: int32;
    decided: int32;
    awarded: int32;
    declined: int32;
  }

  model FundingSummaryYear {
    /** Named for the calendar year it ends in. */
    fiscalYear: int32;

    label: string;
    start: plainDate;
    end: plainDate;
    ...FundingSummaryCounts;

    /** Awarded divided by decided; null when nothing was decided. */
    winRate: float64 | null;

    /** By currency. */
    asked: Money[];

    awardedAmount: Money[];
    bySource: {
      outside: FundingSummaryCounts;
      gms: FundingSummaryCounts;
    };
  }

  model FundingSummary {
    organization: string;

    /** The workspace setting `fiscalYearStartMonth` (1 = January, the default). */
    fiscalYearStartMonth: int32;

    fiscalYearStarts: string;
    generatedAt: utcDateTime;

    /** Most recent first. */
    years: FundingSummaryYear[];

    note: string;
  }

  model FundingSummaryFile {
    @statusCode statusCode: 200;
    @header contentType: "text/csv; charset=utf-8" | "application/pdf";
    @body body: bytes;
  }

  model VaultDeleted {
    id: CommonGrants.Types.uuid;
    deleted: true;
  }
}

namespace GMS.Routes.Custom {
  @tag("Write faster and keep it")
  namespace Keep {
    /** Draft an answer from the organization's library answers and profile facts. Saves nothing (the call is logged and counted against the quota; a second call to fit the limit counts too). 404 `assistant_disabled` when off; 429 `assist_quota_exhausted`. */
    @post @route("/outside-questions/{qid}/draft") @useAuth(GmsOAuth<["applications:write", "assist", "library:read"]> | UserSession)
    op draftAnswer(@path qid: CommonGrants.Types.uuid, @body body: {}): OkT<DraftedAnswer> | BadRequest | AuthErrors | NotFound | Conflict | Unprocessable | TooManyRequests | ServiceUnavailable;

    /** Keep a funder's guidelines (PDF or plain text) on the application and read them with the assistant, as a document input. Only files uploaded here are ever read by the assistant. Saves nothing else. */
    @post @route("/outside-applications/{id}/guidelines") @useAuth(GmsOAuth<["applications:write", "assist"]> | UserSession)
    op uploadGuidelines(@path id: CommonGrants.Types.uuid, @body body: GuidelinesUploadInput): OkT<GuidelinesUploaded> | BadRequest | AuthErrors | NotFound | Conflict | Unprocessable | TooManyRequests | ServiceUnavailable;

    /** The library for one question, most relevant first, each with the variant that best fits the limit. */
    @get @route("/outside-questions/{qid}/library") @useAuth(GmsOAuth<["applications:read", "library:read"]> | UserSession)
    op librarySuggestions(@path qid: CommonGrants.Types.uuid): OkT<LibrarySuggestion[]> | AuthErrors | NotFound;

    /** "Mark as verified": the latest version's facts were checked now (no new version). Ledgered. */
    @post @route("/my/answers/{id}/verify") @useAuth(GmsOAuth<["library:write"]> | UserSession)
    op verifyAnswer(@path id: CommonGrants.Types.uuid): OkT<Answer> | AuthErrors | NotFound;

    /** The document vault, newest first. Admins, editors, finance and viewers (not consultants). */
    @get @route("/vault") @useAuth(GmsOAuth<["org:read"]> | UserSession)
    op listVault(@query docType?: VaultType): OkT<VaultList> | BadRequest | AuthErrors;

    @post @route("/vault") @useAuth(GmsOAuth<["applications:write"]> | UserSession)
    op uploadVault(@body body: VaultUploadInput): CreatedT<VaultDocument> | BadRequest | AuthErrors | Unprocessable | ServiceUnavailable;

    @patch @route("/vault/{docId}") @useAuth(GmsOAuth<["applications:write"]> | UserSession)
    op updateVault(@path docId: CommonGrants.Types.uuid, @body body: VaultPatch): OkT<VaultDocument> | BadRequest | AuthErrors | NotFound | Unprocessable;

    /** Required documents that named it go back to needed. */
    @delete @route("/vault/{docId}") @useAuth(GmsOAuth<["applications:write"]> | UserSession)
    op deleteVault(@path docId: CommonGrants.Types.uuid): OkT<VaultDeleted> | AuthErrors | NotFound;

    @get @route("/vault/{docId}/file") @useAuth(GmsOAuth<["org:read"]> | UserSession)
    op vaultFile(@path docId: CommonGrants.Types.uuid): DocumentBytes | AuthErrors | NotFound | ServiceUnavailable;

    /** Replace the application's required documents. */
    @put @route("/outside-applications/{id}/required-documents") @useAuth(GmsOAuth<["applications:write"]> | UserSession)
    op setRequiredDocuments(@path id: CommonGrants.Types.uuid, @body body: RequiredDocumentsInput): OkT<RequiredDocument[]> | BadRequest | AuthErrors | NotFound | Conflict;

    /** "Use from vault": attach a vault document to one required document, or take it off. */
    @post @route("/outside-applications/{id}/required-documents/use-from-vault") @useAuth(GmsOAuth<["applications:write"]> | UserSession)
    op useFromVault(@path id: CommonGrants.Types.uuid, @body body: UseFromVaultInput): OkT<RequiredDocument[]> | BadRequest | AuthErrors | NotFound | Conflict;

    /** Record the scorecard and move a deciding application: go to loi or drafting, no-go to not pursuing (`outside_application` machine). 409 `go_no_go_off` when the workspace has it switched off. */
    @post @route("/outside-applications/{id}/go-no-go") @useAuth(GmsOAuth<["applications:write"]> | UserSession)
    op goNoGo(@path id: CommonGrants.Types.uuid, @body body: GoNoGoInput): OkT<OutsideApplication> | BadRequest | AuthErrors | NotFound | Conflict;

    @get @route("/outside-applications/{id}/comments") @useAuth(GmsOAuth<["applications:read"]> | UserSession)
    op listComments(@path id: CommonGrants.Types.uuid, @query questionId?: CommonGrants.Types.uuid): OkT<QuestionComment[]> | BadRequest | AuthErrors | NotFound;

    @post @route("/outside-questions/{qid}/comments") @useAuth(GmsOAuth<["applications:write"]> | UserSession)
    op addComment(@path qid: CommonGrants.Types.uuid, @body body: QuestionCommentInput): CreatedT<QuestionComment> | BadRequest | AuthErrors | NotFound | Conflict;

    @post @route("/outside-applications/{id}/comments/{commentId}/resolve") @useAuth(GmsOAuth<["applications:write"]> | UserSession)
    op resolveComment(@path id: CommonGrants.Types.uuid, @path commentId: CommonGrants.Types.uuid): OkT<QuestionComment> | AuthErrors | NotFound;

    /** The milestone tasks offered for the full deadline, unsaved. */
    @get @route("/outside-applications/{id}/milestones") @useAuth(GmsOAuth<["applications:read"]> | UserSession)
    op milestoneOffer(@path id: CommonGrants.Types.uuid): OkT<MilestoneOffer> | AuthErrors | NotFound;

    /** Create the tasks the person confirmed. */
    @post @route("/outside-applications/{id}/milestones") @useAuth(GmsOAuth<["applications:write"]> | UserSession)
    op createMilestones(@path id: CommonGrants.Types.uuid, @body body: MilestonesInput): CreatedT<MilestoneTask[]> | BadRequest | AuthErrors | NotFound | Conflict | Unprocessable;

    /** A month grid of outside application deadlines. */
    @get @route("/pipeline/calendar") @useAuth(GmsOAuth<["applications:read"]> | UserSession)
    op calendarMonth(@query month: string): OkT<PipelineCalendar> | BadRequest | AuthErrors;

    @get @route("/outside-applications/{id}/obligations") @useAuth(GmsOAuth<["applications:read"]> | UserSession)
    op listObligations(@path id: CommonGrants.Types.uuid): OkT<ObligationList> | AuthErrors | NotFound;

    /** One obligation, or a series. The application must be awarded and not closed out (409 `not_awarded`, `closed_out`). */
    @post @route("/outside-applications/{id}/obligations") @useAuth(GmsOAuth<["applications:write"]> | UserSession)
    op createObligation(@path id: CommonGrants.Types.uuid, @body body: ObligationInput): CreatedT<Obligation | ObligationSeriesCreated> | BadRequest | AuthErrors | NotFound | Conflict | Unprocessable;

    @patch @route("/outside-obligations/{oid}") @useAuth(GmsOAuth<["applications:write"]> | UserSession)
    op updateObligation(@path oid: CommonGrants.Types.uuid, @body body: ObligationPatch): OkT<Obligation> | BadRequest | AuthErrors | NotFound | Conflict | Unprocessable;

    /** A submitted report is kept (409 `kept_record`). */
    @delete @route("/outside-obligations/{oid}") @useAuth(GmsOAuth<["applications:write"]> | UserSession)
    op deleteObligation(@path oid: CommonGrants.Types.uuid): OkT<Deleted> | AuthErrors | NotFound | Conflict;

    /** Move an obligation along its kind's edges (guard → write → ledger). 409 `use_submit` for submitted. */
    @post @route("/outside-obligations/{oid}/status") @useAuth(GmsOAuth<["applications:write"]> | UserSession)
    op setObligationStatus(@path oid: CommonGrants.Types.uuid, @body body: ObligationStatusInput): OkT<Obligation> | BadRequest | AuthErrors | NotFound | Conflict | Unprocessable;

    /** Mark a report submitted, with an "as submitted" PDF and its SHA-256. A person only (the MCP tool files an approval). */
    @post @route("/outside-obligations/{oid}/submit") @useAuth(UserSession)
    op submitReport(@path oid: CommonGrants.Types.uuid, @body body: ReportSubmissionInput): OkT<Obligation> | BadRequest | AuthErrors | NotFound | Conflict | Unprocessable | ServiceUnavailable;

    @get @route("/outside-obligations/{oid}/questions") @useAuth(GmsOAuth<["applications:read"]> | UserSession)
    op listReportQuestions(@path oid: CommonGrants.Types.uuid): OkT<OutsideQuestion[]> | AuthErrors | NotFound | Conflict;

    @post @route("/outside-obligations/{oid}/questions") @useAuth(GmsOAuth<["applications:write"]> | UserSession)
    op addReportQuestions(@path oid: CommonGrants.Types.uuid, @body body: OutsideQuestionsInput): CreatedT<OutsideQuestion[]> | BadRequest | AuthErrors | NotFound | Conflict | Unprocessable;

    /** Answers to other reports' questions in the workspace, most relevant to `questionId` first. */
    @get @route("/outside-obligations/{oid}/reuse") @useAuth(GmsOAuth<["applications:read"]> | UserSession)
    op reuseCandidates(@path oid: CommonGrants.Types.uuid, @query questionId?: CommonGrants.Types.uuid, @query q?: string): OkT<ReuseCandidate[]> | BadRequest | AuthErrors | NotFound | Conflict;

    /** Regenerate: only future, untouched instances are replaced; at most 60 in all. */
    @patch @route("/outside-obligation-series/{sid}") @useAuth(GmsOAuth<["applications:write"]> | UserSession)
    op updateSeries(@path sid: CommonGrants.Types.uuid, @body body: ObligationSeriesPatch): OkT<ObligationSeriesChanged> | BadRequest | AuthErrors | NotFound | Conflict | Unprocessable;

    @delete @route("/outside-obligation-series/{sid}") @useAuth(GmsOAuth<["applications:write"]> | UserSession)
    op deleteSeries(@path sid: CommonGrants.Types.uuid): OkT<ObligationSeriesDeleted> | AuthErrors | NotFound | Conflict;

    /** "Close out this award": every obligation done or received; the stage stays awarded. 409 `guard_failed` otherwise. */
    @post @route("/outside-applications/{id}/close-out") @useAuth(GmsOAuth<["applications:write"]> | UserSession)
    op closeOut(@path id: CommonGrants.Types.uuid): OkT<OutsideApplication> | AuthErrors | NotFound | Conflict;

    /** The outside award page (an awarded outside application). */
    @get @route("/outside-awards/{id}") @useAuth(GmsOAuth<["applications:read"]> | UserSession)
    op outsideAward(@path id: CommonGrants.Types.uuid): OkT<OutsideAward> | AuthErrors | NotFound;

    /** Awarded funding: built-in awards ("On this GMS") next to outside awards ("Outside award"). */
    @get @route("/my/awarded-funding") @useAuth(GmsOAuth<["awards:read"]> | UserSession)
    op awardedFunding(): OkT<AwardedFunding> | AuthErrors;

    /** "Get an alert when it reopens": a weekly funding alert on the program name (the GMS's own alerts). 200 with the existing one when already set. */
    @post @route("/outside-applications/{id}/next-cycle-alert") @useAuth(GmsOAuth<["applications:read", "discovery"]> | UserSession)
    op nextCycleAlert(@path id: CommonGrants.Types.uuid): CreatedT<FundingAlert> | OkT<FundingAlert> | AuthErrors | NotFound | Unprocessable;

    /** Outside and built-in applications by fiscal year. */
    @get @route("/funding-summary") @useAuth(GmsOAuth<["applications:read"]> | UserSession)
    op fundingSummary(): OkT<FundingSummary> | AuthErrors;

    /** CSV (one row per fiscal year) or the one-page PDF for the board. */
    @get @route("/funding-summary/export") @useAuth(GmsOAuth<["applications:read"]> | UserSession)
    op exportFundingSummary(@query format?: "csv" | "pdf"): FundingSummaryFile | BadRequest | AuthErrors;
  }
}
