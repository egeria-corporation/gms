import "@typespec/http";
import "@common-grants/core";
import "./models.tsp";
import "./routes.tsp";
import "./outside.tsp";
import "./importer-adapters.tsp";

using TypeSpec.Http;
using CommonGrants.Responses;
using GMS.Models;
using GMS.Auth;
using GMS.Errors;
using GMS.HttpResponses;

// Imported history (v1.12.0): a funder's past applications, the reviews of them and the reports on
// its past grants, brought from the system it used before through /gms/imports (targets
// history_applications, history_reviews, history_reports). Read-only: nothing here changes them,
// and they are never reviewed, decided or paid, never part of a live competition. Funder staff
// read them with their existing roles; reviewers and external reviewers never do. A reviewer is
// named as text, never with contact details; no export id is ever returned.

namespace GMS.Models {
  union HistoryOutcome {
    awarded: "awarded",
    declined: "declined",
    withdrawn: "withdrawn",

    /** Pending, in review, waitlisted: not decided when it was exported. */
    undecided: "undecided",

    /** The export said nothing the GMS reads as an outcome; `outcomeLabel` keeps its words. */
    notKnown: "unknown",
  }

  union HistoryReportState {
    approved: "approved",
    submitted: "submitted",
    late: "late",
    notSubmitted: "not_submitted",
    notKnown: "unknown",
  }

  model HistoryAwardRef {
    /** The award's `awd_` id. */
    id: string;

    title: string;
  }

  model HistoryFile {
    id: CommonGrants.Types.uuid;
    name: string;
    mime: string;
    size: int64;
  }

  /** A past application, without its answers. */
  model HistoryApplication {
    id: CommonGrants.Types.uuid;
    title: string;

    /** As the export named it. */
    organizationName: string;

    /** The applicant workspace it was linked to (through its award, or by EIN or exact name among connected organizations). */
    organizationId: CommonGrants.Types.uuid | null;

    programName: string | null;
    callTitle: string | null;
    submittedOn: plainDate | null;
    outcome: HistoryOutcome;

    /** The outcome as the export wrote it. */
    outcomeLabel: string | null;

    currency: string;
    requestedAmountMinor: int64 | null;
    awardedAmountMinor: int64 | null;

    /** The award it was linked to: by the export's own id, then by exact title and recipient. */
    award: HistoryAwardRef | null;

    answerCount: int32;
    reviewCount: int32;
    sourceSystem: ImportAdapterRef | null;
    importedAt: utcDateTime;
  }

  model HistoryCriterionScore {
    criterion: string;
    score: float64;

    /** The most the criterion gives, when the export said. */
    outOf: float64 | null;
  }

  model HistoryReview {
    id: CommonGrants.Types.uuid;
    applicationId: CommonGrants.Types.uuid | null;
    applicationTitle: string | null;

    /** The reviewer's name as text; never their contact details. */
    reviewerName: string | null;

    scores: HistoryCriterionScore[];
    totalScore: float64 | null;
    recommendation: string | null;
    comment: string | null;
    reviewedOn: plainDate | null;
    sourceSystem: ImportAdapterRef | null;
  }

  model HistoryQuestionAnswer {
    question: string;
    answer: string;
  }

  model HistoryApplicationDetail {
    ...HistoryApplication;
    answers: HistoryQuestionAnswer[];

    /** Left out (empty, with `includes.reviews` false) for a token without `reviews:read`. */
    reviews: HistoryReview[];

    /** The application's snapshot or PDF from the system's zip, when imported. */
    files: HistoryFile[];

    includes: {
      reviews: boolean;
    };
  }

  model HistoryReport {
    id: CommonGrants.Types.uuid;
    title: string;
    organizationName: string | null;
    organizationId: CommonGrants.Types.uuid | null;

    /** The grant's title as the export named it. */
    awardTitle: string | null;

    award: HistoryAwardRef | null;
    dueOn: plainDate | null;
    submittedOn: plainDate | null;
    state: HistoryReportState;
    stateLabel: string | null;

    /** The report's file from the system's zip, when imported. */
    file: HistoryFile | null;

    sourceSystem: ImportAdapterRef | null;
    importedAt: utcDateTime;
  }

  model HistoryList {
    /** At most 200, the latest submitted first. */
    applications: HistoryApplication[];

    /** At most 200, the latest due first. Left out (empty, with `includes.reports` false) for a token without `requirements:read`. */
    reports: HistoryReport[];

    includes: {
      reviews: boolean;
      reports: boolean;
    };
  }
}

namespace GMS.Routes.Custom {
  @tag("Imported history")
  namespace History {
    /** Imported history about one organization (its applicant workspace id) or one award (its `awd_` id): name exactly one. Funder staff (admin, program officer, finance, observer, auditor), or a token with `applications:read`; 403 for reviewers and external reviewers. */
    @get @route("/history") @useAuth(GmsOAuth<["applications:read"]> | UserSession)
    op list(@query organization?: CommonGrants.Types.uuid, @query award?: string): OkT<HistoryList> | BadRequest | AuthErrors | NotFound;

    /** One past application with its answers, its reviews and its files. */
    @get @route("/history/applications/{id}") @useAuth(GmsOAuth<["applications:read"]> | UserSession)
    op application(@path id: CommonGrants.Types.uuid): OkT<HistoryApplicationDetail> | AuthErrors | NotFound;

    /** A file imported with a past application. */
    @get @route("/history/applications/{id}/files/{docId}") @useAuth(GmsOAuth<["applications:read"]> | UserSession)
    op applicationFile(@path id: CommonGrants.Types.uuid, @path docId: CommonGrants.Types.uuid): DocumentBytes | AuthErrors | NotFound | ServiceUnavailable;

    /** The file imported with a past report (needs `requirements:read` too). */
    @get @route("/history/reports/{id}/files/{docId}") @useAuth(GmsOAuth<["applications:read", "requirements:read"]> | UserSession)
    op reportFile(@path id: CommonGrants.Types.uuid, @path docId: CommonGrants.Types.uuid): DocumentBytes | AuthErrors | NotFound | ServiceUnavailable;
  }
}
