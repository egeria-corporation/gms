import "@typespec/http";
import "@typespec/rest";
import "@common-grants/core";
import "./models.tsp";
import "./money.tsp";
import "./insights.tsp";
import "./launch.tsp";

using TypeSpec.Http;
using CommonGrants.Responses;
using CommonGrants.Models;
using GMS.Models;

// #########################################################
// Auth and shared responses
// #########################################################

namespace GMS.Auth {
  /** OAuth 2.1 issued by the GMS's built-in authorization server: client credentials for workspace
   * API clients, authorization code with PKCE (and dynamic client registration) for MCP clients.
   * JWTs are ES256 and carry `https://gms.opengrants.io/workspace_id`; they may also carry
   * `https://commongrants.org/org_id`.
   *
   * Scope vocabulary: `workspace:admin`, `programs:read|write`, `opportunities:read|write`,
   * `competitions:read|write`, `forms:read|write`, `applications:read|write|submit`,
   * `reviews:read|write`, `decisions:write`, `awards:read|write`, `agreements:write`,
   * `payments:read|release`, `requirements:read|write`, `grantees:read|write`,
   * `messages:read|write`, `communications:write`, `analytics:read`, `discovery`,
   * `library:read|write`, `org:read`, `assist`.
   *
   * @template Scopes The scopes an operation requires.
   */
  alias GmsOAuth<Scopes extends string[]> = OAuth2Auth<[
    {
      type: OAuth2FlowType.clientCredentials;
      tokenUrl: "https://gms.opengrants.io/oauth/token";
      scopes: Scopes;
    },
    {
      type: OAuth2FlowType.authorizationCode;
      authorizationUrl: "https://gms.opengrants.io/oauth/authorize";
      tokenUrl: "https://gms.opengrants.io/oauth/token";
      scopes: Scopes;
    }
  ]>;

  /** A Supabase Auth user session (Bearer access token) for a member of the workspace. */
  model UserSession is BearerAuth;
}

namespace GMS.Errors {
  alias BadRequest = CommonGrants.Responses.Error & Http.BadRequestResponse;
  alias Conflict = CommonGrants.Responses.Error & Http.ConflictResponse;

  /** The request was understood but cannot be applied; `errors` lists what is wrong. */
  alias Unprocessable = CommonGrants.Responses.Error & {
    @statusCode statusCode: 422;
  };

  /** A daily cap was reached (e.g. 429 `too_many_workspaces`). */
  alias TooManyRequests = CommonGrants.Responses.Error & {
    @statusCode statusCode: 429;
  };

  /** The link was valid once and is not any more (410 `invitation_expired`, `invitation_revoked`). */
  alias Gone = CommonGrants.Responses.Error & {
    @statusCode statusCode: 410;
  };

  /** Something the action needs is not set up on this server (e.g. 503 `mail_not_configured`). */
  alias ServiceUnavailable = CommonGrants.Responses.Error & {
    @statusCode statusCode: 503;
  };

  /** Errors every authenticated GMS route can return. */
  alias AuthErrors = Unauthorized | Forbidden;
}

namespace GMS.HttpResponses {
  /** A redirect. */
  model Redirect {
    @statusCode statusCode: 302;
    @header location: url;
  }

  /** An RFC 6749 error response. */
  @error
  model OAuthErrorResponse {
    @statusCode statusCode: 400 | 401;
    @body body: OAuthError;
  }

  /** A human gate: the action was recorded as an approval request instead of being run. */
  model PendingApproval {
    @statusCode statusCode: 202;
    status: 202;
    message: string;
    data: Approval;
  }

  model Pdf {
    @statusCode statusCode: 200;
    @header contentType: "application/pdf";
    @body body: bytes;
  }

  model PlainText {
    @statusCode statusCode: 200;
    @header contentType: "text/plain";
    @body body: string;
  }

  model Xml {
    @statusCode statusCode: 200;
    @header contentType: "application/xml";
    @body body: string;
  }

  model WebhookAck {
    @statusCode statusCode: 200;
  }
}

using GMS.Auth;
using GMS.Errors;
using GMS.HttpResponses;

// #########################################################
// CommonGrants protocol routes (/common-grants/...)
// #########################################################

/** Published opportunities are public; drafts need a token for the owning workspace.
 * `OpportunityDetails` includes the competitions and awards the caller may see.
 */
@tag("Opportunities")
@route("/common-grants/opportunities")
namespace GMS.Routes.Opportunities {
  alias Router = CommonGrants.Routes.Opportunities;

  @tag("required")
  op list is Router.list;

  @tag("required")
  op read is Router.read;

  @tag("optional")
  op search is Router.search;
}

/** Open and closed competitions are public; drafts need a token. Stages are exposed in
 * `customFields.gms.stages`; CommonGrants clients see one competition whose `forms` is the union of
 * the stage forms.
 */
@tag("Competitions")
@tag("optional")
@route("/common-grants/competitions")
namespace GMS.Routes.Competitions {
  alias Router = CommonGrants.Routes.Competitions;

  op read is Router.read;
}

/** Forms of published competitions are public. Each `FormBase` carries `jsonSchema`, `uiSchema`,
 * `mappingFromCommonGrants` and `mappingToCommonGrants`. `GET /forms/{formId}?version=` returns a
 * specific published version.
 */
@tag("Forms")
@tag("optional")
@route("/common-grants/forms")
namespace GMS.Routes.Forms {
  alias Router = CommonGrants.Routes.Forms;

  op list is Router.list;

  op read is Router.read;
}

/** Start, read, submit and search applications. Starting runs prefill from the applicant's
 * Passport record; submitting validates every required form, runs the eligibility rules and stamps
 * `verificationLevel` and the attestation URL in `customFields`. Submit is human-gated for agents
 * by default.
 */
@tag("Applications")
@tag("optional")
@route("/common-grants/applications")
namespace GMS.Routes.Applications {
  alias Router = CommonGrants.Routes.Applications;

  @useAuth(GmsOAuth<["applications:write"]> | UserSession)
  op startApplication is Router.startApplication;

  @useAuth(GmsOAuth<["applications:read"]> | UserSession)
  op getApplication is Router.getApplication;

  @useAuth(GmsOAuth<["applications:submit"]> | UserSession)
  op submitApplication is Router.submitApplication;

  @useAuth(GmsOAuth<["applications:read"]> | UserSession)
  op searchApplications is Router.searchApplications;
}

/** Form responses of an application. `PUT` merges into the stored response; validation errors are
 * returned on the response and block only at submit.
 */
@tag("Applications")
@tag("optional")
@route("/common-grants/applications")
namespace GMS.Routes.FormResponses {
  alias Router = CommonGrants.Routes.FormResponses;

  @useAuth(GmsOAuth<["applications:write"]> | UserSession)
  op setFormResponse is Router.setFormResponse;

  @useAuth(GmsOAuth<["applications:read"]> | UserSession)
  op getFormResponse is Router.getFormResponse;
}

/** Awards visible to the funder that owns them or to the recipient. `funding.disbursedAmount` is the
 * value last read from Passport, never a GMS computation.
 */
@tag("Awards")
@tag("optional")
@route("/common-grants/awards")
namespace GMS.Routes.Awards {
  alias Router = CommonGrants.Routes.Awards;

  @useAuth(GmsOAuth<["awards:read"]> | UserSession)
  op list is Router.list;

  @useAuth(GmsOAuth<["awards:read"]> | UserSession)
  op read is Router.read;

  @useAuth(GmsOAuth<["awards:read"]> | UserSession)
  op search is Router.search;
}

/** Organization profiles served from the cached Passport projection (`source` points at Passport).
 * Writes are forwarded to Passport with the caller's consent context: `PATCH` returns 403 unless
 * the caller is the organization itself; changes arrive at Passport as `pending`.
 */
@tag("Organizations")
@tag("experimental")
@route("/common-grants/orgs")
namespace GMS.Routes.Orgs {
  alias Router = CommonGrants.Routes.Organizations;

  /** Supports `?registry=org:us:ein&id=…` lookup. */
  @useAuth(GmsOAuth<["org:read"]> | UserSession)
  op list is Router.list;

  @useAuth(GmsOAuth<["org:read"]> | UserSession)
  op read is Router.read;

  @useAuth(GmsOAuth<["org:read"]> | UserSession)
  op update is Router.update;

  @useAuth(GmsOAuth<["grantees:write"]> | UserSession)
  op submitChange is Router.submitChange;

  @useAuth(GmsOAuth<["org:read"]> | UserSession)
  op listChanges is Router.listChanges;

  @useAuth(GmsOAuth<["org:read"]> | UserSession)
  op viewChange is Router.viewChange;
}

// #########################################################
// GMS routes (/gms/...) — funder side
// #########################################################

@route("/gms")
namespace GMS.Routes.Custom {
  @tag("Workspaces")
  namespace Workspaces {
    /** The signed-in person and the workspaces they can open, each with its handle, kind, role and brand. */
    @get @route("/me") @useAuth(UserSession)
    op me(): OkT<Me> | AuthErrors;

    /** What this caller is in its workspace. */
    @get @route("/whoami") @useAuth(GmsOAuth<[]> | UserSession)
    op whoami(): OkT<WhoAmI> | AuthErrors;

    /** Accept an emailed invitation; the caller becomes a member with the invited role. */
    @post @route("/invitations/accept") @useAuth(UserSession)
    op acceptInvitation(@body body: {
      token: string;
    }): OkT<Workspace> | BadRequest | AuthErrors | NotFound;

    /** Workspaces the caller is a member of. */
    @get @route("/workspaces") @useAuth(UserSession)
    op list(...PageParams): PaginatedT<Workspace> | AuthErrors;

    /**
     * Create a funder or applicant workspace. With `profile` it is created without Passport, with a
     * self-declared profile (shown as not verified). `passportOrgId` is refused: only Passport sets
     * it. Capped per person (5) and per network address (20) per day: 429 `too_many_workspaces`.
     */
    @post @route("/workspaces") @useAuth(UserSession)
    op create(@body body: WorkspaceInput): CreatedT<Workspace> | BadRequest | AuthErrors | Conflict | TooManyRequests;

    /**
     * Workspace admins edit the self-declared profile (a merge patch). Every change is on the ledger
     * as `workspace.profile_updated` with the field names. 409 `profile_from_passport` for a
     * workspace linked to Passport: its record is edited in Passport.
     */
    @patch @route("/workspaces/{id}/profile") @useAuth(GmsOAuth<["workspace:admin"]> | UserSession)
    op updateProfile(@path id: CommonGrants.Types.uuid, @body body: SelfDeclaredProfilePatch): OkT<WorkspaceProfile> | BadRequest | AuthErrors | NotFound | Conflict | Unprocessable;

    @get @route("/workspaces/{id}") @useAuth(GmsOAuth<["workspace:admin"]> | UserSession)
    op read(@path id: CommonGrants.Types.uuid): OkT<Workspace> | AuthErrors | NotFound;

    /** Update name, brand and settings. Brand contrast is checked (WCAG AA). */
    @patch @route("/workspaces/{id}") @useAuth(GmsOAuth<["workspace:admin"]> | UserSession)
    op update(@path id: CommonGrants.Types.uuid, @body body: MergePatch): OkT<Workspace> | BadRequest | AuthErrors | NotFound;

    @get @route("/workspaces/{id}/members") @useAuth(GmsOAuth<["workspace:admin"]> | UserSession)
    op listMembers(@path id: CommonGrants.Types.uuid): PaginatedT<Member> | AuthErrors | NotFound;

    @post @route("/workspaces/{id}/members") @useAuth(GmsOAuth<["workspace:admin"]> | UserSession)
    op addMember(@path id: CommonGrants.Types.uuid, @body body: MemberInput): CreatedT<Member> | BadRequest | AuthErrors | NotFound | Conflict;

    @patch @route("/workspaces/{id}/members/{userId}") @useAuth(GmsOAuth<["workspace:admin"]> | UserSession)
    op updateMember(@path id: CommonGrants.Types.uuid, @path userId: CommonGrants.Types.uuid, @body body: MergePatch): OkT<Member> | BadRequest | AuthErrors | NotFound;

    /** Leave the workspace. People only; refused for the last admin. Passport is not affected. */
    @delete @route("/workspaces/{id}/members/me") @useAuth(UserSession)
    op leaveWorkspace(@path id: CommonGrants.Types.uuid): OkT<LeftWorkspace> | AuthErrors | NotFound | Conflict;

    @delete @route("/workspaces/{id}/members/{userId}") @useAuth(GmsOAuth<["workspace:admin"]> | UserSession)
    op removeMember(@path id: CommonGrants.Types.uuid, @path userId: CommonGrants.Types.uuid): NoContentResponse | AuthErrors | NotFound | Conflict;

    /** Invite by email; external reviewers and consultants are scoped and may expire. */
    @post @route("/workspaces/{id}/invitations") @useAuth(GmsOAuth<["workspace:admin"]> | UserSession)
    op invite(@path id: CommonGrants.Types.uuid, @body body: InvitationInput): CreatedT<Invitation> | BadRequest | AuthErrors | NotFound;

    /** Store the funder's Passport client (secret encrypted), request a token and verify it against Passport. */
    @post @route("/workspaces/{id}/passport/link") @useAuth(UserSession)
    op linkPassport(@path id: CommonGrants.Types.uuid, @body body: PassportLinkRequest): OkT<PassportLinkStatus> | BadRequest | AuthErrors | NotFound | Conflict;

    @get @route("/workspaces/{id}/passport/status") @useAuth(GmsOAuth<["workspace:admin"]> | UserSession)
    op passportStatus(@path id: CommonGrants.Types.uuid): OkT<PassportLinkStatus> | AuthErrors | NotFound;

    @delete @route("/workspaces/{id}/passport/link") @useAuth(UserSession)
    op unlinkPassport(@path id: CommonGrants.Types.uuid): NoContentResponse | AuthErrors | NotFound;
  }

  @tag("Programs")
  namespace Programs {
    @get @route("/programs") @useAuth(GmsOAuth<["programs:read"]> | UserSession)
    op list(...PageParams): PaginatedT<Program> | AuthErrors;

    @post @route("/programs") @useAuth(GmsOAuth<["programs:write"]> | UserSession)
    op create(@body body: ProgramInput): CreatedT<Program> | BadRequest | AuthErrors;

    @get @route("/programs/{id}") @useAuth(GmsOAuth<["programs:read"]> | UserSession)
    op read(@path id: CommonGrants.Types.uuid): OkT<Program> | AuthErrors | NotFound;

    @patch @route("/programs/{id}") @useAuth(GmsOAuth<["programs:write"]> | UserSession)
    op update(@path id: CommonGrants.Types.uuid, @body body: MergePatch): OkT<Program> | BadRequest | AuthErrors | NotFound;
  }

  @tag("Opportunities (GMS)")
  namespace Opportunities {
    /** Includes drafts. */
    @get @route("/opportunities") @useAuth(GmsOAuth<["opportunities:read"]> | UserSession)
    op list(...PageParams, @query programId?: CommonGrants.Types.uuid): PaginatedT<GmsOpportunity> | AuthErrors;

    @post @route("/opportunities") @useAuth(GmsOAuth<["opportunities:write"]> | UserSession)
    op create(@body body: GmsOpportunityInput): CreatedT<GmsOpportunity> | BadRequest | AuthErrors;

    @get @route("/opportunities/{id}") @useAuth(GmsOAuth<["opportunities:read"]> | UserSession)
    op read(@path id: GmsId): OkT<GmsOpportunity> | AuthErrors | NotFound;

    @patch @route("/opportunities/{id}") @useAuth(GmsOAuth<["opportunities:write"]> | UserSession)
    op update(@path id: GmsId, @body body: MergePatch): OkT<GmsOpportunity> | BadRequest | AuthErrors | NotFound;

    /** Validates the CommonGrants projection, renders the public page and adds the sitemap entry. */
    @post @route("/opportunities/{id}/publish") @useAuth(GmsOAuth<["opportunities:write"]> | UserSession)
    op publish(@path id: GmsId): OkT<GmsOpportunity> | BadRequest | AuthErrors | NotFound | Conflict;

    @post @route("/opportunities/{id}/close") @useAuth(GmsOAuth<["opportunities:write"]> | UserSession)
    op close(@path id: GmsId): OkT<GmsOpportunity> | AuthErrors | NotFound | Conflict;

    /** The CommonGrants record as it would be published, without publishing. */
    @post @route("/opportunities/{id}/preview") @useAuth(GmsOAuth<["opportunities:read"]> | UserSession)
    op preview(@path id: GmsId): OkT<OpportunityPreview> | BadRequest | AuthErrors | NotFound;
  }

  @tag("Competitions (GMS)")
  namespace Competitions {
    @get @route("/competitions") @useAuth(GmsOAuth<["competitions:read"]> | UserSession)
    op list(...PageParams, @query opportunityId?: GmsId): PaginatedT<GmsCompetition> | AuthErrors;

    @post @route("/competitions") @useAuth(GmsOAuth<["competitions:write"]> | UserSession)
    op create(@body body: GmsCompetitionInput): CreatedT<GmsCompetition> | BadRequest | AuthErrors;

    @get @route("/competitions/{id}") @useAuth(GmsOAuth<["competitions:read"]> | UserSession)
    op read(@path id: GmsId): OkT<GmsCompetition> | AuthErrors | NotFound;

    @patch @route("/competitions/{id}") @useAuth(GmsOAuth<["competitions:write"]> | UserSession)
    op update(@path id: GmsId, @body body: MergePatch): OkT<GmsCompetition> | BadRequest | AuthErrors | NotFound;

    @put @route("/competitions/{id}/stages") @useAuth(GmsOAuth<["competitions:write"]> | UserSession)
    op setStages(@path id: GmsId, @body body: StagesInput): OkT<GmsCompetition> | BadRequest | AuthErrors | NotFound | Conflict;

    /** Pin form versions per stage. On an open competition `migrate: true` is required and re-validates in-progress responses. */
    @put @route("/competitions/{id}/forms") @useAuth(GmsOAuth<["competitions:write"]> | UserSession)
    op setForms(@path id: GmsId, @body body: StageForms): OkT<GmsCompetition> | BadRequest | AuthErrors | NotFound | Conflict;

    @put @route("/competitions/{id}/rubric") @useAuth(GmsOAuth<["competitions:write"]> | UserSession)
    op setRubric(@path id: GmsId, @body body: RubricRef): OkT<GmsCompetition> | BadRequest | AuthErrors | NotFound;

    /** The launch checklist: forms published, rubric set, dates valid, reviewers available. */
    @post @route("/competitions/{id}/launch-check") @useAuth(GmsOAuth<["competitions:read"]> | UserSession)
    op launchCheck(@path id: GmsId): OkT<Readiness> | AuthErrors | NotFound;

    @post @route("/competitions/{id}/open") @useAuth(GmsOAuth<["competitions:write"]> | UserSession)
    op open(@path id: GmsId): OkT<GmsCompetition> | AuthErrors | NotFound | Conflict;

    @post @route("/competitions/{id}/close") @useAuth(GmsOAuth<["competitions:write"]> | UserSession)
    op close(@path id: GmsId): OkT<GmsCompetition> | AuthErrors | NotFound | Conflict;

    /** Applications ranked by weighted score with mean, median, spread and n. */
    @get @route("/competitions/{id}/ranking") @useAuth(GmsOAuth<["reviews:read"]> | UserSession)
    op ranking(@path id: GmsId, @query stage?: string): OkT<Ranking> | AuthErrors | NotFound | Conflict;

    /** Program headroom: budget − committed − proposed. */
    @get @route("/competitions/{id}/allocation") @useAuth(GmsOAuth<["reviews:read"]> | UserSession)
    op allocation(@path id: GmsId): OkT<Allocation> | AuthErrors | NotFound;
  }

  @tag("Forms (GMS)")
  namespace Forms {
    @get @route("/forms") @useAuth(GmsOAuth<["forms:read"]> | UserSession)
    op list(...PageParams, @query purpose?: FormPurpose): PaginatedT<GmsForm> | AuthErrors;

    /** Rejects schemas outside the supported JSON Schema 2020-12 subset with a clear error. */
    @post @route("/forms") @useAuth(GmsOAuth<["forms:write"]> | UserSession)
    op create(@body body: GmsFormInput): CreatedT<GmsForm> | BadRequest | AuthErrors;

    /** The shared form library (common application, LOI, budget, reports, FFATA pack). */
    @get @route("/forms/library") @useAuth(GmsOAuth<["forms:read"]> | UserSession)
    op library(...PageParams): PaginatedT<GmsForm> | AuthErrors;

    @get @route("/forms/{id}") @useAuth(GmsOAuth<["forms:read"]> | UserSession)
    op read(@path id: GmsId, @query version?: int32): OkT<GmsForm> | AuthErrors | NotFound;

    /** Edits the draft version; a published version is immutable. */
    @patch @route("/forms/{id}") @useAuth(GmsOAuth<["forms:write"]> | UserSession)
    op update(@path id: GmsId, @body body: MergePatch): OkT<GmsForm> | BadRequest | AuthErrors | NotFound | Conflict;

    /** Start a draft of the next version. */
    @post @route("/forms/{id}/versions") @useAuth(GmsOAuth<["forms:write"]> | UserSession)
    op createVersion(@path id: GmsId): CreatedT<GmsForm> | AuthErrors | NotFound | Conflict;

    @post @route("/forms/{id}/publish") @useAuth(GmsOAuth<["forms:write"]> | UserSession)
    op publish(@path id: GmsId): OkT<GmsForm> | BadRequest | AuthErrors | NotFound | Conflict;

    /** Generate a realistic response from the schema for previews and tests. */
    @post @route("/forms/{id}/test-fill") @useAuth(GmsOAuth<["forms:read"]> | UserSession)
    op testFill(@path id: GmsId): OkT<Record<unknown>> | AuthErrors | NotFound;
  }

  @tag("Applications (GMS)")
  namespace Applications {
    /** Dry-run the eligibility rules against an organization or an application. Reviewer roles get
     * 403. When the rules run against another organization's cached Passport record, each result
     * carries the outcome and label only: `actual` is omitted and `explain` does not quote the value.
     */
    @post @route("/eligibility/evaluate") @useAuth(GmsOAuth<["applications:read"]> | UserSession)
    op evaluateEligibility(@body body: EligibilityRequest): OkT<EligibilityResult> | BadRequest | AuthErrors | NotFound;

    @get @route("/applications") @useAuth(GmsOAuth<["applications:read"]> | UserSession)
    op list(
      ...PageParams,
      @query competitionId?: GmsId,
      @query status?: ApplicationStatus,
      @query stage?: string,
      @query eligible?: string,
      @query level?: VerificationLevel,
      @query tag?: string,
      /** Named views: applications whose reviews are all in, or that are flagged (tag, unknown eligibility, or reviewer spread). Items carry `score`, `reviews`, `daysInStage` and `flagged`. */
      @query view?: "review_complete" | "flagged",
    ): PaginatedT<GmsApplication> | AuthErrors;

    @get @route("/applications/{id}") @useAuth(GmsOAuth<["applications:read"]> | UserSession)
    op read(@path id: GmsId): OkT<GmsApplication> | AuthErrors | NotFound;

    /** Move to a stage whose `entryFrom` includes the current stage. */
    /** Re-run the opportunity's eligibility rules against the application as it stands. */
    @post @route("/applications/{id}/eligibility") @useAuth(GmsOAuth<["applications:read"]> | UserSession)
    op rerunEligibility(@path id: GmsId): OkT<EligibilityResult> | AuthErrors | NotFound;

    @post @route("/applications/{id}/advance") @useAuth(GmsOAuth<["applications:write"]> | UserSession)
    op advance(@path id: GmsId, @body body: AdvanceRequest): OkT<ApplicationActionResult> | BadRequest | AuthErrors | NotFound | Conflict;

    @post @route("/applications/{id}/request-revision") @useAuth(GmsOAuth<["applications:write"]> | UserSession)
    op requestRevision(@path id: GmsId, @body body: RevisionRequest): OkT<ApplicationActionResult> | BadRequest | AuthErrors | NotFound | Conflict;

    /** Declines and queues the letter. Sending is human-gated for agents. */
    @post @route("/applications/{id}/decline") @useAuth(GmsOAuth<["applications:write"]> | UserSession)
    op decline(@path id: GmsId, @body body: DeclineRequest): OkT<ApplicationActionResult> | PendingApproval | AuthErrors | NotFound | Conflict;

    @post @route("/applications/{id}/tags") @useAuth(GmsOAuth<["applications:write"]> | UserSession)
    op tag(@path id: GmsId, @body body: TagsRequest): OkT<ApplicationActionResult> | AuthErrors | NotFound;

    @post @route("/applications/{id}/assign") @useAuth(GmsOAuth<["applications:write"]> | UserSession)
    op assign(@path id: GmsId, @body body: AssignRequest): OkT<ApplicationActionResult> | AuthErrors | NotFound;

    @post @route("/applications/bulk") @useAuth(GmsOAuth<["applications:write"]> | UserSession)
    op bulk(@body body: BulkApplicationRequest): OkT<BulkResult> | PendingApproval | BadRequest | AuthErrors;
  }

  @tag("Reviews")
  namespace Reviews {
    @get @route("/rubrics") @useAuth(GmsOAuth<["reviews:read"]> | UserSession)
    op listRubrics(...PageParams): PaginatedT<Rubric> | AuthErrors;

    @post @route("/rubrics") @useAuth(GmsOAuth<["reviews:write"]> | UserSession)
    op createRubric(@body body: RubricInput): CreatedT<Rubric> | BadRequest | AuthErrors;

    @get @route("/review-assignments") @useAuth(GmsOAuth<["reviews:read"]> | UserSession)
    op listAssignments(@query competitionId?: GmsId, @query applicationId?: GmsId, @query stage?: string, @query reviewerUserId?: CommonGrants.Types.uuid, @query status?: string): OkT<ReviewAssignment[]> | AuthErrors;

    /** Refused with 409 `conflict_of_interest` when a conflict is on record or the reviewer's email domain is the applicant's. */
    @post @route("/review-assignments") @useAuth(GmsOAuth<["reviews:write"]> | UserSession)
    op createAssignment(@body body: ReviewAssignmentInput): CreatedT<ReviewAssignment> | BadRequest | AuthErrors | NotFound | Conflict | Unprocessable;

    /** Assign by capacity and expertise tags, excluding declared and domain-matched conflicts. */
    @post @route("/review-assignments/auto") @useAuth(GmsOAuth<["reviews:write"]> | UserSession)
    op autoAssign(@body body: AutoAssignRequest): OkT<AutoAssignResult> | BadRequest | AuthErrors | NotFound | Conflict;

    /** Invite an external reviewer by email; accepting creates an `external_reviewer` member scoped to the competition. */
    @post @route("/review-assignments/invite") @useAuth(UserSession)
    op inviteReviewer(@body body: InviteReviewerRequest): CreatedT<ReviewerInvitation> | BadRequest | AuthErrors | NotFound;

    /** The reviewer's working view, with the application masked for their role. */
    @get @route("/review-assignments/{id}") @useAuth(GmsOAuth<["reviews:read"]> | UserSession)
    op readAssignment(@path id: CommonGrants.Types.uuid): OkT<ReviewAssignmentDetail> | AuthErrors | NotFound;

    /** Declare a conflict, save scores, submit the review, recuse or reschedule. */
    @patch @route("/review-assignments/{id}") @useAuth(GmsOAuth<["reviews:write"]> | UserSession)
    op updateAssignment(@path id: CommonGrants.Types.uuid, @body body: ReviewAssignmentPatch): OkT<ReviewAssignment> | BadRequest | AuthErrors | NotFound | Conflict | Unprocessable;

    /** In blind mode a reviewer sees other reviews only at the panel. */
    @get @route("/reviews") @useAuth(GmsOAuth<["reviews:read"]> | UserSession)
    op listReviews(@query applicationId: GmsId, @query stage?: string): OkT<Review[]> | AuthErrors | NotFound;
  }

  @tag("Decisions")
  namespace Decisions {
    @post @route("/decisions/propose") @useAuth(GmsOAuth<["decisions:write"]> | UserSession)
    op propose(@body body: ProposeDecisionsRequest): OkT<ProposeDecisionsResult> | BadRequest | AuthErrors | NotFound | Conflict | Unprocessable;

    @get @route("/decisions") @useAuth(GmsOAuth<["reviews:read"]> | UserSession)
    op list(@query competitionId?: GmsId, @query applicationId?: GmsId, @query committed?: boolean): OkT<Decision[]> | AuthErrors;

    /** Creates awards in `offered`, drafts agreements and queues letters. Refuses over-allocation
     * (409 `over_allocation`) unless an admin overrides with a reason. People only: an agent's
     * commit runs after a person approves it.
     */
    @post @route("/decisions/commit") @useAuth(UserSession)
    op commit(@body body: CommitDecisionsRequest): OkT<CommitDecisionsResult> | BadRequest | AuthErrors | NotFound | Conflict;
  }

  @tag("Awards (GMS)")
  namespace Awards {
    @get @route("/awards") @useAuth(GmsOAuth<["awards:read"]> | UserSession)
    op list(...PageParams, @query status?: string, @query programId?: CommonGrants.Types.uuid, @query recipientWorkspaceId?: CommonGrants.Types.uuid): PaginatedT<GmsAward> | AuthErrors;

    /** Create an award for an accepted application that has none. */
    @post @route("/awards") @useAuth(GmsOAuth<["awards:write"]> | UserSession)
    op createFromApplication(@body body: AwardFromApplicationRequest): CreatedT<AwardFromApplicationResult> | BadRequest | AuthErrors | NotFound | Conflict;

    /**
     * Give an award directly to an organization that has not applied, by its name and a contact
     * email. The award is created `offered` with no recipient workspace; the contact is emailed a
     * link and the award is attached only when they accept it, signed in with that address, for an
     * applicant workspace they administer. Needs `awards:write`: funder `admin` or `program_officer`
     * (as for an award from an application), people only (an agent's request waits for a person's
     * approval). 25 invitations, new and resent, per funder workspace
     * per rolling 24 hours: 429 `too_many_invitations`. 503 `mail_not_configured` creates nothing.
     */
    @post @route("/awards/direct") @useAuth(UserSession)
    op createDirect(@body body: DirectAwardInput): CreatedT<DirectAwardView> | BadRequest | AuthErrors | NotFound | TooManyRequests | ServiceUnavailable;

    /**
     * Send a direct award's invitation again with a new link (the old one stops working), to a new
     * address when `contactEmail` is given. Funder `admin`, `program_officer` or `finance`, people
     * only. Counts against the daily limits. 409 `invitation_closed` once it was accepted, declined or
     * withdrawn.
     */
    @post @route("/awards/{id}/invitation/resend") @useAuth(UserSession)
    op resendInvitation(@path id: GmsId, @body body?: ResendInvitationInput): OkT<DirectAwardView> | BadRequest | AuthErrors | NotFound | Conflict | TooManyRequests | ServiceUnavailable;

    @get @route("/awards/{id}") @useAuth(GmsOAuth<["awards:read"]> | UserSession)
    op read(@path id: GmsId): OkT<GmsAwardDetail> | AuthErrors | NotFound;

    @get @route("/awards/{id}/letter.pdf") @useAuth(GmsOAuth<["awards:read"]> | UserSession)
    op letterPdf(@path id: GmsId): Pdf | AuthErrors | NotFound;

    /**
     * Recipient accepts the offer; the GMS then mirrors the award to Passport. People only. When
     * Passport lists verified representatives for the organization, `name` is required and must be
     * one of theirs (422 `signer_name_required`, 403 `not_a_representative`); otherwise the admin
     * role stands. The answer carries `signerAuthority`, which is also ledgered.
     */
    @post @route("/awards/{id}/accept-offer") @useAuth(UserSession)
    op acceptOffer(@path id: GmsId, @body body?: AcceptOfferInput): OkT<AcceptedAward> | BadRequest | AuthErrors | NotFound | Conflict | Unprocessable;

    /** Requires an executed agreement unless the award carries `noAgreementRequired`. */
    @post @route("/awards/{id}/activate") @useAuth(GmsOAuth<["awards:write"]> | UserSession)
    op activate(@path id: GmsId): OkT<GmsAwardDetail> | AuthErrors | NotFound | Conflict;

    @post @route("/awards/{id}/suspend") @useAuth(GmsOAuth<["awards:write"]> | UserSession)
    op suspend(@path id: GmsId, @body body: ReasonBody): OkT<GmsAwardDetail> | BadRequest | AuthErrors | NotFound | Conflict;

    @post @route("/awards/{id}/resume") @useAuth(GmsOAuth<["awards:write"]> | UserSession)
    op resume(@path id: GmsId): OkT<GmsAwardDetail> | AuthErrors | NotFound | Conflict;

    @post @route("/awards/{id}/complete") @useAuth(GmsOAuth<["awards:write"]> | UserSession)
    op complete(@path id: GmsId): OkT<GmsAwardDetail> | AuthErrors | NotFound | Conflict;

    /** Cancelling a direct award not yet accepted also revokes its invitation. */
    @post @route("/awards/{id}/cancel") @useAuth(GmsOAuth<["awards:write"]> | UserSession)
    op cancel(@path id: GmsId, @body body: ReasonBody): OkT<GmsAwardDetail> | BadRequest | AuthErrors | NotFound | Conflict;

    @get @route("/awards/{id}/amendments") @useAuth(GmsOAuth<["awards:read"]> | UserSession)
    op listAmendments(@path id: GmsId): OkT<Amendment[]> | AuthErrors | NotFound;

    @post @route("/awards/{id}/amendments") @useAuth(GmsOAuth<["awards:write"]> | UserSession)
    op createAmendment(@path id: GmsId, @body body: AmendmentInput): CreatedT<Amendment> | BadRequest | AuthErrors | NotFound | Conflict | Unprocessable;

    /** Approve or decline. Approving an extension or a supplemental changes the award and patches Passport. */
    @patch @route("/amendments/{id}") @useAuth(GmsOAuth<["awards:write"]> | UserSession)
    op decideAmendment(@path id: CommonGrants.Types.uuid, @body body: AmendmentDecision): OkT<Amendment> | BadRequest | AuthErrors | NotFound | Conflict;

    @get @route("/awards/{id}/budget") @useAuth(GmsOAuth<["awards:read"]> | UserSession)
    op readBudget(@path id: GmsId): OkT<BudgetBook> | AuthErrors | NotFound;

    /** The funder sets the approved budget (it cannot exceed the award). */
    @put @route("/awards/{id}/budget") @useAuth(GmsOAuth<["awards:write"]> | UserSession)
    op setBudget(@path id: GmsId, @body body: BudgetPut): OkT<BudgetView> | BadRequest | AuthErrors | NotFound | Unprocessable;

    /** Approved versus reported actuals, by category. */
    @get @route("/awards/{id}/variance") @useAuth(GmsOAuth<["awards:read"]> | UserSession)
    op variance(@path id: GmsId): OkT<BudgetVariance> | AuthErrors | NotFound;
  }


  /**
   * A directly given award, from the invited person's side: signed in (no workspace yet), the
   * token from the link always in the body. People only; no agent can accept or decline.
   */
  @tag("Awards (GMS)")
  namespace AwardInvitations {
    /** What the invitation offers. 404 `invitation_not_found` for a token that is not (or no longer) a link. */
    @post @route("/award-invitations/lookup") @useAuth(UserSession)
    op lookup(@body body: AwardInvitationTokenInput): OkT<AwardInvitationLookup> | BadRequest | AuthErrors | NotFound;

    /**
     * Accept for an applicant workspace. 403 `email_mismatch` unless signed in with the invited
     * address, 403 `not_workspace_admin`, 403 `mfa_required` without the admin role's second step,
     * 410 `invitation_expired` or `invitation_revoked`, 409 `invitation_used`. One step attaches the
     * award, records the organization's consent (basis `award`) and accepts it; the Passport mirror
     * follows as for any accepted award. Signer rules as for `acceptOffer`.
     */
    @post @route("/award-invitations/accept") @useAuth(UserSession)
    op accept(@body body: AwardInvitationAcceptInput): OkT<AwardInvitationAccepted> | BadRequest | AuthErrors | NotFound | Conflict | Gone | Unprocessable;

    /** Decline as the invited person. The funder is told and decides whether to withdraw the award. */
    @post @route("/award-invitations/decline") @useAuth(UserSession)
    op decline(@body body: AwardInvitationDeclineInput): OkT<AwardInvitationDeclined> | BadRequest | AuthErrors | NotFound | Conflict | Gone;
  }
  @tag("Agreements")
  namespace Agreements {
    /** Draft an agreement from a template. Refused while a live agreement exists; void it first. */
    @post @route("/awards/{id}/agreements") @useAuth(GmsOAuth<["agreements:write"]> | UserSession)
    op create(@path id: GmsId, @body body: AgreementInput): CreatedT<Agreement> | BadRequest | AuthErrors | NotFound | Conflict | Unprocessable;

    @get @route("/agreements/{id}") @useAuth(GmsOAuth<["awards:read"]> | UserSession)
    op read(@path id: GmsId): OkT<Agreement> | AuthErrors | NotFound;

    /** Renders and hashes the document; that hash is what both parties sign. */
    @post @route("/agreements/{id}/send") @useAuth(GmsOAuth<["agreements:write"]> | UserSession)
    op send(@path id: GmsId): OkT<SentAgreement> | AuthErrors | NotFound | Conflict | Unprocessable;

    /**
     * Grantee click-to-sign: typed name, attestation, network address, time and document hash go to
     * the ledger. People only; the offer must be accepted first. When Passport lists verified
     * representatives the typed name must match one (403 `not_a_representative`), compared without
     * case, accents or spacing; otherwise the admin role stands. The rule applied is returned as
     * `signerAuthority`, kept on the signature record and ledgered (`agreement.signer_checked`).
     */
    @post @route("/agreements/{id}/sign") @useAuth(UserSession)
    op sign(@path id: GmsId, @body body: SignRequest): OkT<Agreement> | BadRequest | AuthErrors | NotFound | Conflict;

    /** Funder countersignature; the agreement becomes `executed`, the award `active`, and tranches conditioned on execution become due. People only. */
    @post @route("/agreements/{id}/countersign") @useAuth(UserSession)
    op countersign(@path id: GmsId, @body body: SignRequest): OkT<ExecutedAgreement> | BadRequest | AuthErrors | NotFound | Conflict;

    /** Refused for an executed agreement; issue an amendment instead. */
    @post @route("/agreements/{id}/void") @useAuth(GmsOAuth<["agreements:write"]> | UserSession)
    op voidAgreement(@path id: GmsId, @body body: ReasonBody): OkT<Agreement> | BadRequest | AuthErrors | NotFound | Conflict;

    /** The executed document once executed; before that, the document sent for signature. `X-Content-SHA256` carries its hash. */
    @get @route("/agreements/{id}/pdf") @useAuth(GmsOAuth<["awards:read"]> | UserSession)
    op pdf(@path id: GmsId): Pdf | AuthErrors | NotFound;
  }

  @tag("Payments")
  namespace Payments {
    /** The award's tranches, with the disbursed total as last read back from Passport. */
    @get @route("/awards/{id}/schedule") @useAuth(GmsOAuth<["awards:read"]> | UserSession)
    op readSchedule(@path id: GmsId): OkT<PaymentSchedule> | AuthErrors | NotFound;

    /** Replace the tranches that have not started. They must add up to what is left of the award. */
    @put @route("/awards/{id}/schedule") @useAuth(GmsOAuth<["payments:release"]> | UserSession)
    op setSchedule(@path id: GmsId, @body body: PaymentScheduleInput): OkT<PaymentSchedule> | BadRequest | AuthErrors | NotFound | Conflict | Unprocessable;

    /** `view`: due (due, ready, held), in-flight, done or upcoming. */
    @get @route("/tranches") @useAuth(GmsOAuth<["payments:read"]> | UserSession)
    op listTranches(...PageParams, @query status?: TrancheStatus, @query view?: string, @query awardId?: string): PaginatedT<TrancheListItem> | BadRequest | AuthErrors;

    /** Live readiness: agreement, condition, funder link, payee credential (L3, destination active,
     * no pending change, no freeze), award headroom, duplicates, recipient standing. `unknown` is
     * its own state when Passport cannot be reached.
     */
    @get @route("/tranches/{id}/readiness") @useAuth(GmsOAuth<["payments:read"]> | UserSession)
    op readiness(@path id: GmsId): OkT<TrancheReadinessView> | AuthErrors | NotFound;

    /** Facilitated release through Passport with the tranche id as the Idempotency-Key. People only:
     * any agent or API-client token is refused with `human_only`. Answers 409
     * `facilitated_payments_disabled` when the server runs without facilitated payments
     * (`PAYMENTS_FACILITATED` is not `true`); record the payment with `record-external` instead.
     */
    @post @route("/tranches/{id}/release") @useAuth(UserSession)
    op release(@path id: GmsId, @body body: ReleaseInput): OkT<ReleaseResult> | BadRequest | AuthErrors | NotFound | Conflict;

    /** Resolve mode: record a payment made elsewhere and post it to Passport, which verifies the last four digits. People only. */
    @post @route("/tranches/{id}/record-external") @useAuth(UserSession)
    op recordExternal(@path id: GmsId, @body body: ExternalPaymentInput): OkT<ExternalPaymentResult> | BadRequest | AuthErrors | NotFound | Conflict;

    /** Resolve a payment stuck in `releasing`: the identical request is repeated under the same
     * Idempotency-Key, so Passport answers with the disbursement it holds or the one that was
     * released, never a second payment. People only (finance, admin).
     */
    @post @route("/tranches/{id}/reconcile") @useAuth(UserSession)
    op reconcile(@path id: GmsId): OkT<ReleaseResult> | AuthErrors | NotFound | Conflict;

    @post @route("/tranches/{id}/hold") @useAuth(GmsOAuth<["payments:release"]> | UserSession)
    op hold(@path id: GmsId, @body body: ReasonBody): OkT<PaymentTranche> | BadRequest | AuthErrors | NotFound | Conflict;

    /** Lift a GMS hold, or ask Passport to release a disbursement it parked itself. */
    @post @route("/tranches/{id}/release-hold") @useAuth(GmsOAuth<["payments:release"]> | UserSession)
    op releaseHold(@path id: GmsId): OkT<PaymentTranche> | AuthErrors | NotFound | Conflict;

    @post @route("/tranches/{id}/cancel") @useAuth(GmsOAuth<["payments:release"]> | UserSession)
    op cancel(@path id: GmsId, @body body: ReasonBody): OkT<PaymentTranche> | BadRequest | AuthErrors | NotFound | Conflict;

    /** Due, ready and held tranches with their readiness, for the Payments center. */
    @get @route("/payments/readiness") @useAuth(GmsOAuth<["payments:read"]> | UserSession)
    op center(): OkT<PaymentsCenter> | AuthErrors;

    /** Holds, failures, returns, pending destination changes and unverified external payments. */
    @get @route("/payments/alerts") @useAuth(GmsOAuth<["payments:read"]> | UserSession)
    op alerts(): OkT<PaymentAlertView[]> | AuthErrors;

    /** Outbound transactions read from Mercury (read-only), with proposed tranche matches. */
    @get @route("/bank-transactions") @useAuth(GmsOAuth<["payments:read"]> | UserSession)
    op listBankTransactions(...PageParams, @query matched?: boolean): PaginatedT<BankTransactionView> | AuthErrors;

    /** A person confirms a match; this records the tranche as paid outside Passport. */
    @post @route("/bank-transactions/{id}/match") @useAuth(UserSession)
    op matchBankTransaction(@path id: string, @body body: BankMatchInput): OkT<BankMatchResult> | BadRequest | AuthErrors | NotFound | Conflict | Unprocessable;
  }

  @tag("Requirements")
  namespace Requirements {
    @get @route("/awards/{id}/requirements") @useAuth(GmsOAuth<["requirements:read"]> | UserSession)
    op list(@path id: GmsId): OkT<RequirementView[]> | AuthErrors | NotFound;

    @post @route("/awards/{id}/requirements") @useAuth(GmsOAuth<["requirements:write"]> | UserSession)
    op create(@path id: GmsId, @body body: RequirementCreate): CreatedT<RequirementView> | BadRequest | AuthErrors | NotFound | Unprocessable;

    @patch @route("/requirements/{id}") @useAuth(GmsOAuth<["requirements:write"]> | UserSession)
    op update(@path id: GmsId, @body body: MergePatch): OkT<RequirementView> | BadRequest | AuthErrors | NotFound | Conflict;

    @post @route("/requirements/{id}/waive") @useAuth(GmsOAuth<["requirements:write"]> | UserSession)
    op waive(@path id: GmsId, @body body: ReasonBody): OkT<RequirementView> | BadRequest | AuthErrors | NotFound | Conflict;

    /** The reporting queue: due, overdue, received and returned, with who owes each. */
    @get @route("/requirements/due") @useAuth(GmsOAuth<["requirements:read"]> | UserSession)
    op due(...PageParams, @query status?: RequirementStatus): PaginatedT<RequirementView> | AuthErrors;

    /**
     * Send a reminder now, outside the plan. Planned reminders are sent by the jobs Worker, once per (requirement, offset).
     * Only to an organization that shares its record with this funder (409 `not_shared`), and at most one per
     * requirement per 24 hours (429 `reminder_sent_recently`).
     */
    @post @route("/requirements/{id}/remind") @useAuth(GmsOAuth<["requirements:write"]> | UserSession)
    op remind(@path id: GmsId): OkT<ReminderSent> | AuthErrors | NotFound | Conflict | Unprocessable | TooManyRequests;

    /** Reports received, including those a grantee shared from another funder (`shared=true`). */
    @get @route("/submissions") @useAuth(GmsOAuth<["requirements:read"]> | UserSession)
    op listSubmissions(...PageParams, @query status?: SubmissionStatus, @query shared?: boolean): PaginatedT<SubmissionView> | AuthErrors;

    @get @route("/submissions/{id}") @useAuth(GmsOAuth<["requirements:read"]> | UserSession)
    op readSubmission(@path id: GmsId): OkT<SubmissionView> | AuthErrors | NotFound;

    /** Accepting also accepts the requirement and moves a tranche that waits on it to `due`. */
    @post @route("/submissions/{id}/accept") @useAuth(GmsOAuth<["requirements:write"]> | UserSession)
    op acceptSubmission(@path id: GmsId, @body body: ReviewNote): OkT<SubmissionView> | BadRequest | AuthErrors | NotFound | Conflict;

    /** Returns the report with a note; the requirement goes back to `due`. */
    @post @route("/submissions/{id}/return") @useAuth(GmsOAuth<["requirements:write"]> | UserSession)
    op returnSubmission(@path id: GmsId, @body body: ReviewNote): OkT<SubmissionView> | BadRequest | AuthErrors | NotFound | Conflict;
  }

  @tag("Grantees")
  namespace Grantees {
    /** Organizations this funder has a relationship with: a submitted application or an award. */
    @get @route("/grantees") @useAuth(GmsOAuth<["grantees:read"]> | UserSession)
    op list(...PageParams, @query q?: string, @query tag?: string): PaginatedT<GranteeSummary> | AuthErrors;

    @get @route("/grantees/{applicantWorkspaceId}") @useAuth(GmsOAuth<["grantees:read"]> | UserSession)
    op read(@path applicantWorkspaceId: CommonGrants.Types.uuid): OkT<GranteeDetail> | AuthErrors | NotFound;

    /** Owner, tags and relationship notes; never profile fields. */
    @patch @route("/grantees/{applicantWorkspaceId}") @useAuth(GmsOAuth<["grantees:write"]> | UserSession)
    op update(@path applicantWorkspaceId: CommonGrants.Types.uuid, @body body: GranteePatch): OkT<GranteeDetail> | BadRequest | AuthErrors | NotFound;

    /** Profile changes received from Passport (polled nightly). */
    @get @route("/org-changes") @useAuth(GmsOAuth<["grantees:read"]> | UserSession)
    op listOrgChanges(...PageParams, @query status?: string): PaginatedT<OrgChangeView> | AuthErrors;

    @post @route("/org-changes/{id}/accept") @useAuth(GmsOAuth<["grantees:write"]> | UserSession)
    op acceptOrgChange(@path id: string): OkT<OrgChangeView> | AuthErrors | NotFound | Conflict;

    @post @route("/org-changes/{id}/dismiss") @useAuth(GmsOAuth<["grantees:write"]> | UserSession)
    op dismissOrgChange(@path id: string): OkT<OrgChangeView> | AuthErrors | NotFound | Conflict;

    /** Send a proposed profile change to Passport, where it is `pending` until the organization accepts.
     * Answers 403 `consent_required` when the organization has not granted `org.changes:write`.
     */
    @post @route("/grantees/{applicantWorkspaceId}/propose-change") @useAuth(GmsOAuth<["grantees:write"]> | UserSession)
    op proposeChange(@path applicantWorkspaceId: CommonGrants.Types.uuid, @body body: ProposeChangeInput): AcceptedT<ProposeChangeResult> | BadRequest | AuthErrors | NotFound | Conflict | Unprocessable;
  }

  @tag("Communication")
  namespace Communication {
    @get @route("/threads") @useAuth(GmsOAuth<["messages:read"]> | UserSession)
    op listThreads(@query subjectType?: "application", @query subjectId: GmsId): OkT<Thread[]> | BadRequest | AuthErrors | NotFound;

    /** Get or create the shared thread of an application, or the caller's side's internal one. */
    @post @route("/threads") @useAuth(GmsOAuth<["messages:write"]> | UserSession)
    op openThread(@body body: ThreadInput): OkT<Thread> | BadRequest | AuthErrors | NotFound;

    @post @route("/threads/{id}/messages") @useAuth(GmsOAuth<["messages:write"]> | UserSession)
    op postMessage(@path id: string, @body body: MessageInput): CreatedT<Message> | BadRequest | AuthErrors | NotFound;

    @get @route("/tasks") @useAuth(GmsOAuth<["messages:read"]> | UserSession)
    op listTasks(@query open?: boolean, @query mine?: boolean): OkT<Task[]> | AuthErrors;

    @post @route("/tasks") @useAuth(GmsOAuth<["messages:write"]> | UserSession)
    op createTask(@body body: TaskInput): CreatedT<Task> | BadRequest | AuthErrors;

    @patch @route("/tasks/{id}") @useAuth(GmsOAuth<["messages:write"]> | UserSession)
    op updateTask(@path id: CommonGrants.Types.uuid, @body body: TaskPatch): OkT<Task> | BadRequest | AuthErrors | NotFound;

    @get @route("/templates") @useAuth(GmsOAuth<["communications:write"]> | UserSession)
    op listTemplates(@query kind?: string): OkT<TemplateList> | AuthErrors;

    @post @route("/templates") @useAuth(GmsOAuth<["communications:write"]> | UserSession)
    op createTemplate(@body body: TemplateInput): CreatedT<Template> | BadRequest | AuthErrors;

    @get @route("/templates/{id}") @useAuth(GmsOAuth<["communications:write"]> | UserSession)
    op readTemplate(@path id: string): OkT<Template> | AuthErrors | NotFound;

    /** 422 `missing_merge_fields` lists every field that has no value. */
    @post @route("/templates/{id}/render") @useAuth(GmsOAuth<["communications:write"]> | UserSession)
    op renderTemplate(@path id: string, @body body: RenderRequest): OkT<Rendered> | BadRequest | AuthErrors | NotFound | Unprocessable;

    /** The send log, newest first. */
    @get @route("/communications") @useAuth(GmsOAuth<["communications:write"]> | UserSession)
    op listCommunications(...PageParams): PaginatedT<SentCommunication> | AuthErrors;

    /** Templated send through Resend. Every letter is rendered first; nothing is sent if any is missing a field. People only: an agent's send runs after a person approves it. */
    @post @route("/communications/send") @useAuth(UserSession)
    op send(@body body: SendRequest): OkT<SendResult> | BadRequest | AuthErrors | NotFound | Unprocessable;
  }

  @tag("Analytics")
  namespace Analytics {
    /** Committed and paid by program. "Paid" is Passport's disbursed amount as last read back. */
    @get @route("/analytics/portfolio") @useAuth(GmsOAuth<["analytics:read"]> | UserSession)
    op portfolio(@query fy?: string): OkT<PortfolioView> | BadRequest | AuthErrors;

    @get @route("/analytics/cycle/{competitionId}") @useAuth(GmsOAuth<["analytics:read"]> | UserSession)
    op cycle(@path competitionId: GmsId): OkT<CycleReport> | AuthErrors | NotFound;

    /** 990-PF Part XV grant list for a year. `format=csv` answers a CSV file. */
    @get @route("/exports/990pf") @useAuth(GmsOAuth<["analytics:read"]> | UserSession)
    op grantList(@query year?: string, @query format?: "csv" | "json"): OkT<GrantList990> | BadRequest | AuthErrors;

    /** CommonGrants JSON bundle + GMS JSON + attachments manifest, written to the exports bucket. */
    @post @route("/exports/bundle") @useAuth(UserSession)
    op exportBundle(@query inline?: boolean): OkT<BundleExport> | AuthErrors;

    /**
     * Import historical awards from a CSV with a column mapping. `dryRun` reports without writing. A recipient is
     * linked only to an organization already connected to this funder (an application, a consent, or an award made
     * in the GMS); any other row keeps the recipient's name without a workspace and reports `matchedRecipient: false`.
     */
    @post @route("/imports/csv") @useAuth(UserSession)
    op importCsv(@body body: CsvImportInput): OkT<CsvImportResult> | BadRequest | AuthErrors | Unprocessable;
  }

  @tag("Integrations")
  namespace Integrations {
    @get @route("/api-clients") @useAuth(GmsOAuth<["workspace:admin"]> | UserSession)
    op listApiClients(): OkT<ApiClientView[]> | AuthErrors;

    /** The secret is shown once. */
    @post @route("/api-clients") @useAuth(UserSession)
    op createApiClient(@body body: ApiClientCreate): CreatedT<ApiClientIssued> | BadRequest | AuthErrors | Unprocessable;

    @delete @route("/api-clients/{clientId}") @useAuth(UserSession)
    op deleteApiClient(@path clientId: string): OkT<ApiClientView> | AuthErrors | NotFound;

    @get @route("/webhooks") @useAuth(GmsOAuth<["workspace:admin"]> | UserSession)
    op listWebhooks(): OkT<WebhookView[]> | AuthErrors;

    /** The signing secret is shown once. */
    @post @route("/webhooks") @useAuth(GmsOAuth<["workspace:admin"]> | UserSession)
    op createWebhook(@body body: WebhookCreate): CreatedT<WebhookCreated> | BadRequest | AuthErrors | Unprocessable;

    @delete @route("/webhooks/{id}") @useAuth(GmsOAuth<["workspace:admin"]> | UserSession)
    op deleteWebhook(@path id: string): OkT<DeletedResult> | AuthErrors | NotFound;

    @get @route("/webhooks/{id}/deliveries") @useAuth(GmsOAuth<["workspace:admin"]> | UserSession)
    op listDeliveries(@path id: string): OkT<WebhookDeliveryView[]> | AuthErrors | NotFound;

    /** Send one delivery again as a new delivery with the same signed body. People only. */
    @post @route("/webhooks/{id}/deliveries/{deliveryId}/replay") @useAuth(UserSession)
    op replayDelivery(@path id: string, @path deliveryId: string): CreatedT<WebhookReplay> | AuthErrors | NotFound | Conflict;

    /** Agents connected to the workspace, on either side: all of them for an admin, the caller's own otherwise. */
    @get @route("/mcp-connections") @useAuth(GmsOAuth<["workspace:admin"]> | UserSession)
    op listMcpConnections(): OkT<McpConnectionView[]> | AuthErrors;

    /** Revokes the agent's connection and its OAuth grant. Admins revoke any; other members their own. */
    @delete @route("/mcp-connections/{id}") @useAuth(UserSession)
    op revokeMcpConnection(@path id: string): OkT<McpConnectionView> | AuthErrors | NotFound;

    @get @route("/custom-mcp-servers") @useAuth(GmsOAuth<["workspace:admin"]> | UserSession)
    op listCustomMcpServers(): OkT<McpServerView[]> | AuthErrors;

    /** Register an MCP server. Only tools it marks read-only can be allow-listed in v1. */
    @post @route("/custom-mcp-servers") @useAuth(UserSession)
    op createCustomMcpServer(@body body: McpServerCreate): CreatedT<McpServerRegistered> | BadRequest | AuthErrors | Unprocessable;

    @get @route("/custom-mcp-servers/{id}/tools") @useAuth(GmsOAuth<["workspace:admin"]> | UserSession)
    op listCustomMcpServerTools(@path id: string): OkT<RemoteToolView[]> | AuthErrors | NotFound;

    @patch @route("/custom-mcp-servers/{id}") @useAuth(GmsOAuth<["workspace:admin"]> | UserSession)
    op updateCustomMcpServer(@path id: string, @body body: McpServerPatch): OkT<McpServerView> | BadRequest | AuthErrors | NotFound | Unprocessable;

    @delete @route("/custom-mcp-servers/{id}") @useAuth(UserSession)
    op deleteCustomMcpServer(@path id: string): OkT<DeletedResult> | AuthErrors | NotFound;

    @get @route("/connectors/{provider}") @useAuth(GmsOAuth<["payments:read"]> | UserSession)
    op readConnector(@path provider: ConnectorProvider): OkT<ConnectorView> | AuthErrors | NotFound;

    /** Mercury: a read-only token for reconciliation. Google Workspace: the connection lives at Composio. */
    @post @route("/connectors/{provider}") @useAuth(UserSession)
    op connect(@path provider: ConnectorProvider, @body body: ConnectorConnect): OkT<ConnectorView> | BadRequest | AuthErrors | NotFound | Unprocessable;

    @delete @route("/connectors/{provider}") @useAuth(UserSession)
    op disconnect(@path provider: ConnectorProvider): OkT<ConnectorView> | AuthErrors | NotFound;

    @post @route("/connectors/{provider}/sync") @useAuth(GmsOAuth<["payments:release"]> | UserSession)
    op sync(@path provider: ConnectorProvider): OkT<ConnectorView> | AuthErrors | NotFound | Conflict | Unprocessable;

    /** People in the funder's Google directory, to suggest at invite time. */
    @get @route("/directory/suggest") @useAuth(GmsOAuth<["workspace:admin"]> | UserSession)
    op suggestMembers(@query q?: string): OkT<DirectoryPersonView[]> | AuthErrors;

    /** The workspace-visible audit ledger (admins and auditors). */
    @get @route("/ledger") @useAuth(GmsOAuth<["workspace:admin"]> | UserSession)
    op ledger(...PageParams, @query subjectType?: string, @query subjectId?: string, @query eventType?: string): PaginatedT<LedgerEvent> | AuthErrors;

    /** Pending and resolved human gates of the workspace, newest first. People only. */
    @get @route("/approvals") @useAuth(UserSession)
    op listApprovals(...PageParams, @query status?: string): PaginatedT<Approval> | AuthErrors;

    /** Agents poll this after a gated call returns `pending_approval`. */
    @get @route("/approvals/{id}") @useAuth(GmsOAuth<[]> | UserSession)
    op readApproval(@path id: string): OkT<Approval> | AuthErrors | NotFound;

    /** Approve or reject. Human-only: no token can call it, and the person needs the gated tool's
     * scope. Approving runs the original call once, as the approver; the result is `executed` or `failed`.
     */
    @post @route("/approvals/{id}/decision") @useAuth(UserSession)
    op decideApproval(@path id: string, @body body: {
      approve: boolean;
      note?: string;
    }): OkT<Approval> | AuthErrors | NotFound | Conflict;
  }

  @tag("Insights")
  namespace Insights {
    /** Proposed budget rows and attached documents for one application. */
    @get @route("/applications/{id}/budget") @useAuth(GmsOAuth<["applications:read"]> | UserSession)
    op applicationBudget(@path id: GmsId): OkT<ApplicationBudgetView> | AuthErrors | NotFound;

    @get @route("/applications/{id}/documents") @useAuth(GmsOAuth<["applications:read"]> | UserSession)
    op applicationDocuments(@path id: GmsId): OkT<DocumentRef[]> | AuthErrors | NotFound;

    /** Revision requests, the interview and the committed decision, as the caller's side may see them. */
    @get @route("/applications/{id}/follow-ups") @useAuth(GmsOAuth<["applications:read"]> | UserSession)
    op followUps(@path id: GmsId): OkT<ApplicationFollowUps> | AuthErrors | NotFound;

    /** The funder offers interview times. */
    @post @route("/applications/{id}/interview") @useAuth(GmsOAuth<["applications:write"]> | UserSession)
    op proposeInterview(@path id: GmsId, @body body: InterviewProposal): CreatedT<InterviewState> | BadRequest | AuthErrors | NotFound;

    @get @route("/programs/{id}/rollup") @useAuth(GmsOAuth<["programs:read"]> | UserSession)
    op programRollup(@path id: CommonGrants.Types.uuid): OkT<ProgramRollup> | AuthErrors | NotFound;

    @get @route("/competitions/{id}/reviewers") @useAuth(GmsOAuth<["reviews:read"]> | UserSession)
    op reviewerPool(@path id: GmsId): OkT<ReviewerPool> | AuthErrors | NotFound;

    /** Per-criterion means per application and where the stage's decisions stand. */
    @get @route("/competitions/{id}/panel-summary") @useAuth(GmsOAuth<["reviews:read"]> | UserSession)
    op panelSummary(@path id: GmsId, @query stage?: string): OkT<PanelSummary> | AuthErrors | NotFound;

    /** Panel discussion notes: internal to the funder. */
    @get @route("/competitions/{id}/notes") @useAuth(GmsOAuth<["reviews:read"]> | UserSession)
    op listPanelNotes(@path id: GmsId): OkT<Note[]> | AuthErrors | NotFound;

    @post @route("/competitions/{id}/notes") @useAuth(UserSession)
    op addPanelNote(@path id: GmsId, @body body: NoteInput): CreatedT<Note> | BadRequest | AuthErrors | NotFound;

    /** Ledger events for the award and its agreements, tranches and requirements, newest first. */
    @get @route("/awards/{id}/activity") @useAuth(GmsOAuth<["awards:read"]> | UserSession)
    op awardActivity(@path id: GmsId): OkT<ActivityEntry[]> | AuthErrors | NotFound;

    @get @route("/awards/{id}/signatures") @useAuth(GmsOAuth<["awards:read"]> | UserSession)
    op awardSignatures(@path id: GmsId): OkT<SignatureRecord[]> | AuthErrors | NotFound;

    @get @route("/awards/{id}/closeout") @useAuth(GmsOAuth<["awards:read"]> | UserSession)
    op awardCloseout(@path id: GmsId): OkT<AwardCloseout> | AuthErrors | NotFound;

    /** The closeout summary as a PDF. The same record prints the same bytes. */
    @get @route("/awards/{id}/closeout.pdf") @useAuth(GmsOAuth<["awards:read"]> | UserSession)
    op awardCloseoutPdf(@path id: GmsId): { @statusCode _: 200; @header contentType: "application/pdf"; @body body: bytes } | AuthErrors | NotFound;

    /** Agreements and files on an award, for either party. Also at `/my/awards/{id}/documents`. */
    @get @route("/awards/{id}/documents") @useAuth(GmsOAuth<["awards:read"]> | UserSession)
    op awardDocuments(@path id: GmsId): OkT<AwardDocument[]> | AuthErrors | NotFound;

    /** The shared thread between funder and grantee on one award. Also at `/my/awards/{id}/messages`. */
    @get @route("/awards/{id}/messages") @useAuth(GmsOAuth<["messages:read"]> | UserSession)
    op listAwardMessages(@path id: GmsId): OkT<Note[]> | AuthErrors | NotFound;

    @post @route("/awards/{id}/messages") @useAuth(GmsOAuth<["messages:write"]> | UserSession)
    op postAwardMessage(@path id: GmsId, @body body: NoteInput): CreatedT<Note> | BadRequest | AuthErrors | NotFound;

    /** Tranches falling due in the next `days` days (default 30). */
    @get @route("/payments/upcoming") @useAuth(GmsOAuth<["payments:read"]> | UserSession)
    op upcomingPayments(@query days?: int32): OkT<UpcomingPayments> | AuthErrors;

    /** Every ledger event about a tranche, newest first. */
    @get @route("/payments/ledger") @useAuth(GmsOAuth<["payments:read"]> | UserSession)
    op paymentsLedger(...PageParams): PaginatedT<ActivityEntry> | AuthErrors;

    @get @route("/grantees/{granteeId}/reports") @useAuth(GmsOAuth<["grantees:read"]> | UserSession)
    op granteeReports(@path granteeId: CommonGrants.Types.uuid): OkT<GranteeReport[]> | AuthErrors;

    /** Awards by region, reviewer load, and tax status and budget band from records shared through Passport. */
    @get @route("/analytics/breakdowns") @useAuth(GmsOAuth<["analytics:read"]> | UserSession)
    op breakdowns(): OkT<Breakdowns> | AuthErrors;

    @get @route("/templates/usage") @useAuth(GmsOAuth<["communications:write"]> | UserSession)
    op templateUsage(): OkT<TemplateUsage[]> | AuthErrors;

    /** Send one template to every application in a view. People only; `dryRun` previews recipients. */
    @post @route("/communications/bulk") @useAuth(UserSession)
    op bulkSend(@body body: BulkSendRequest): OkT<Record<unknown>> | BadRequest | AuthErrors | Unprocessable;

    /** The workspace's recent ledger activity in words, for the dashboard. Staff only. */
    @get @route("/activity") @useAuth(GmsOAuth<["applications:read"]> | UserSession)
    op recentActivity(@query limit?: int32): OkT<ActivityEntry[]> | AuthErrors;

    /** What approving would do: affected applications and, for a decline, each letter. */
    @get @route("/approvals/{id}/preview") @useAuth(UserSession)
    op approvalPreview(@path id: string): OkT<ApprovalPreview> | AuthErrors | NotFound;

    /** Funders by consent, connected agents and the team, in one read. */
    @get @route("/me/access") @useAuth(GmsOAuth<["org:read"]> | UserSession)
    op whoHasAccess(): OkT<AccessOverview> | AuthErrors;

    @get @route("/my/funders/detail") @useAuth(GmsOAuth<["applications:read"]> | UserSession)
    op myFundersDetail(): OkT<FunderRelationship[]> | AuthErrors;

    @get @route("/my/applications/{id}/follow-ups") @useAuth(GmsOAuth<["applications:read"]> | UserSession)
    op myFollowUps(@path id: GmsId): OkT<ApplicationFollowUps> | AuthErrors | NotFound;

    /** The applicant picks one of the offered times. */
    @post @route("/my/applications/{id}/interview/confirm") @useAuth(GmsOAuth<["applications:write"]> | UserSession)
    op confirmInterview(@path id: GmsId, @body body: InterviewConfirmation): OkT<InterviewState> | BadRequest | AuthErrors | NotFound | Unprocessable;

    @get @route("/discover/alerts") @useAuth(GmsOAuth<["discovery"]> | UserSession)
    op listAlerts(): OkT<FundingAlert[]> | AuthErrors;

    @post @route("/discover/alerts") @useAuth(GmsOAuth<["discovery"]> | UserSession)
    op createAlert(@body body: FundingAlertInput): CreatedT<FundingAlert> | BadRequest | AuthErrors | Unprocessable;

    @delete @route("/discover/alerts/{alertId}") @useAuth(GmsOAuth<["discovery"]> | UserSession)
    op deleteAlert(@path alertId: CommonGrants.Types.uuid): OkT<Record<unknown>> | AuthErrors | NotFound;
  }

  @tag("Launch")
  namespace Launch {
    /** What this server has switched on. No token. */
    @get @route("/config")
    op config(): OkT<InstallConfig>;

    /** The signed-in person's own sessions, newest activity first. No workspace is named. */
    @get @route("/me/sessions") @useAuth(UserSession)
    op listSessions(): OkT<AccountSession[]> | AuthErrors;

    /** End another of the caller's sessions. 409 `current_session` for the one in use; another person's session answers 404. */
    @delete @route("/me/sessions/{id}") @useAuth(UserSession)
    op endSession(@path id: CommonGrants.Types.uuid): OkT<EndedSession> | AuthErrors | NotFound | Conflict;

    /** The organization's verified representatives, read live from Passport with the workspace's consent. Never stored. */
    @get @route("/me/representatives") @useAuth(GmsOAuth<["org:read"]> | UserSession)
    op representatives(): OkT<Representatives> | AuthErrors;

    @get @route("/programs/{id}/budget-categories") @useAuth(GmsOAuth<["programs:read"]> | UserSession)
    op getBudgetCategories(@path id: CommonGrants.Types.uuid): OkT<BudgetCategories> | AuthErrors | NotFound;

    /** The funder's budget categories for awards under the program (also `defaults.budgetCategories` on the program). */
    @put @route("/programs/{id}/budget-categories") @useAuth(GmsOAuth<["programs:write"]> | UserSession)
    op putBudgetCategories(@path id: CommonGrants.Types.uuid, @body body: BudgetCategoriesInput): OkT<BudgetCategories> | BadRequest | AuthErrors | NotFound;

    /** The grantee's category mapping, as the funder reads it. */
    @get @route("/awards/{id}/budget-mapping") @useAuth(GmsOAuth<["awards:read"]> | UserSession)
    op budgetMapping(@path id: GmsId): OkT<BudgetMapping> | AuthErrors | NotFound;

    @get @route("/my/awards/{id}/budget-mapping") @useAuth(GmsOAuth<["awards:read"]> | UserSession)
    op myBudgetMapping(@path id: GmsId): OkT<BudgetMapping> | AuthErrors | NotFound;

    /** The grantee maps its own budget categories to the funder's; variance then compares by the funder's categories. 422 `unknown_budget_category` for a category the funder does not have. */
    @put @route("/my/awards/{id}/budget-mapping") @useAuth(GmsOAuth<["awards:write"]> | UserSession)
    op putMyBudgetMapping(@path id: GmsId, @body body: BudgetMappingInput): OkT<BudgetMapping> | BadRequest | AuthErrors | NotFound | Unprocessable;

    @get @route("/my/awards/{id}/variance") @useAuth(GmsOAuth<["awards:read"]> | UserSession)
    op myVariance(@path id: GmsId): OkT<BudgetVariance> | AuthErrors | NotFound;

    /** Who signed, for the grantee. Its admins see the network address of their own organization's signer only. */
    @get @route("/my/awards/{id}/signatures") @useAuth(GmsOAuth<["awards:read"]> | UserSession)
    op myAwardSignatures(@path id: GmsId): OkT<SignatureRecord[]> | AuthErrors | NotFound;

    /** The funder's named contacts. */
    @get @route("/contacts") @useAuth(GmsOAuth<["programs:read"]> | UserSession)
    op contacts(): OkT<FunderContact[]> | AuthErrors;

    /** Replace the funder's named contacts. Admins only. */
    @put @route("/contacts") @useAuth(GmsOAuth<["workspace:admin"]> | UserSession)
    op putContacts(@body body: FunderContactsInput): OkT<FunderContact[]> | BadRequest | AuthErrors;

    /**
     * Save an award letter, an agreement or an application snapshot as a PDF into a Drive folder the
     * person picked. Admins and program officers, people only. 409 `drive_folder_unavailable` when
     * Google will not take the file; 422 `connector_scope_rejected` or `connector_scope_unverified`
     * when the connection cannot be used.
     */
    @post @route("/connectors/google_workspace/export") @useAuth(UserSession)
    op exportToDrive(@body body: DriveExportInput): CreatedT<DriveExportResult> | BadRequest | AuthErrors | NotFound | Conflict | Unprocessable;

    /** People in the funder's Google directory, for invite suggestions. Admins only. 409 `connector_not_connected` before Google is connected. */
    @get @route("/connectors/google_workspace/directory") @useAuth(GmsOAuth<["workspace:admin"]> | UserSession)
    op searchDirectory(@query q?: string): OkT<DirectoryPersonSuggestion[]> | AuthErrors | Conflict | Unprocessable;
  }

  @tag("Assistant")
  namespace Assist {
    /** Whether the assistant is on and the workspace's remaining monthly quota. */
    @get @route("/assist/status") @useAuth(GmsOAuth<["assist"]> | UserSession)
    op status(): OkT<AssistStatus> | AuthErrors;

    /**
     * Every assist route returns a draft and changes nothing. All answer 404 `assistant_disabled`
     * when the assistant is off, 429 `assist_quota_exhausted` when the month's quota is spent, and
     * 422 `assistant_declined` when the model declines.
     */
    @post @route("/assist/summarize") @useAuth(GmsOAuth<["assist"]> | UserSession)
    op summarize(@body body: SummarizeRequest): OkT<ApplicationSummaryDraft> | BadRequest | AuthErrors | NotFound;

    @post @route("/assist/compare-rubric") @useAuth(GmsOAuth<["assist"]> | UserSession)
    op compareRubric(@body body: CompareRubricRequest): OkT<RubricComparisonDraft> | BadRequest | AuthErrors | NotFound;

    @post @route("/assist/draft-letter") @useAuth(GmsOAuth<["assist"]> | UserSession)
    op draftLetter(@body body: DraftLetterRequest): OkT<LetterDraft> | BadRequest | AuthErrors | NotFound;

    @post @route("/assist/adapt-answer") @useAuth(GmsOAuth<["assist"]> | UserSession)
    op adaptAnswer(@body body: AdaptAnswerRequest): OkT<AdaptedAnswerDraft> | BadRequest | AuthErrors | NotFound;
  }

  // #########################################################
  // GMS routes (/gms/...) — applicant side
  // #########################################################

  @tag("Applicant")
  namespace Applicant {
    /** Build the Passport authorization URL (auth code + PKCE; `org:read org.changes:read org.changes:write`). */
    @post @route("/passport/consent/start") @useAuth(UserSession)
    op consentStart(@body body?: ConsentStartRequest): OkT<ConsentStart> | BadRequest | AuthErrors | NotFound;

    /** Passport sends the browser here. The request carries no session, so nothing is linked and the
     * code is not redeemed. Always redirects into the web app: `?passport=finish#code=…&state=…`
     * (the code travels in the fragment), or `?passport=error&reason=<code>`.
     */
    @get @route("/passport/consent/callback")
    op consentCallback(@query code?: string, @query state?: string, @query error?: string): Redirect;

    /** Finish the consent with the session of the person who started it. Exchanges the code, caches
     * the organization and its Common App profile, and creates or links the applicant workspace.
     * 403 `consent_not_yours` when another account started the flow; the code is then left unredeemed.
     */
    @post @route("/passport/consent/finish") @useAuth(UserSession)
    op consentFinish(@body body: ConsentFinishRequest): OkT<ConsentFinished> | BadRequest | AuthErrors | Unprocessable;

    /** Sign in with Passport, step 1 (no session needed). Redirects the browser to Passport's
     * authorization endpoint asking for `openid email` plus the applicant consent scopes, with PKCE
     * and a nonce, and sets a short-lived HttpOnly cookie that binds the flow to this browser.
     * `returnTo` is honored only when it is a plain path in the web app. `hop` is a random value
     * the web app made in the tab (base64url, 22 to 128 characters); it is sealed in the state and
     * returned in the fragment at the end, and the web app redeems the sign-in only when it matches.
     * Without a valid `hop` the flow is not started (`passport_error=state_mismatch`).
     */
    @get @route("/passport/signin/start")
    op passportSignInStart(@query hop?: string, @query returnTo?: string): Redirect;

    /** Sign in with Passport, step 2. Passport sends the browser here. Checks the sealed state and
     * the browser binding, exchanges the code, verifies the ID token, selects the account by the
     * email Passport verified, links the approved organization's workspace, and redirects into the
     * web app: `/auth/passport#token_hash=…&type=…&hop=…&next=…` (a one-time sign-in, in the
     * fragment) or `/signin?passport_error=<code>` with one of `cancelled`, `no_organization`,
     * `email_unverified`, `expired`, `state_mismatch`, `unavailable`, `not_configured`,
     * `account_mismatch`. An account whose email was never confirmed is replaced, not adopted; an
     * account already tied to a different Passport user is refused (`account_mismatch`).
     */
    @get @route("/passport/signin/callback")
    op passportSignInCallback(@query code?: string, @query state?: string, @query error?: string): Redirect;

    /** Sign in with Passport, step 3. The web app, holding the session it just redeemed, presents
     * the same one-time token so that Passport's authenticator counts as this session's second
     * step (when Passport's ID token said `acr: aal2`). Bound to that one session, once, within ten
     * minutes of the sign-in; the trust ends twelve hours after the person passed Passport's
     * authenticator. A wrong, used or late token is not an error: `verified` is false and the app
     * asks for its own second step. People only.
     */
    @post @route("/passport/signin/second-step") @useAuth(UserSession)
    op passportSecondStep(@body body: PassportSecondStepClaim): OkT<PassportSecondStepResult> | BadRequest | AuthErrors;

    @get @route("/me/organization") @useAuth(GmsOAuth<["org:read"]> | UserSession)
    op myOrganization(): OkT<MyOrganization> | AuthErrors | NotFound;

    /** The organization's Passport locker as references (never bytes), read live with the stored consent. */
    @get @route("/me/documents") @useAuth(GmsOAuth<["org:read"]> | UserSession)
    op myDocuments(): OkT<LockerDocumentRef[]> | AuthErrors | NotFound | Conflict;

    @get @route("/me/readiness") @useAuth(GmsOAuth<["org:read"]> | UserSession)
    op myReadiness(): OkT<ApplicantReadiness> | AuthErrors | NotFound;

    /** Re-read the organization and profile from Passport with the stored consent. */
    @post @route("/me/organization/refresh") @useAuth(GmsOAuth<["org:read"]> | UserSession)
    op refreshOrganization(): OkT<MyOrganization> | AuthErrors | NotFound | Conflict;

    /** Discovery items the workspace saved. */
    @get @route("/discover/saved") @useAuth(GmsOAuth<["discovery"]> | UserSession)
    op listSaved(): OkT<SavedListing[]> | AuthErrors;

    @post @route("/discover/saved") @useAuth(GmsOAuth<["discovery"]> | UserSession)
    op saveListing(@body body: SavedListingInput): CreatedT<SavedListing> | BadRequest | AuthErrors;

    /** Competitions open on this GMS, each with an eligibility preview for the applicant. */
    @get @route("/discover/competitions") @useAuth(GmsOAuth<["discovery"]> | UserSession)
    op discoverCompetitions(): OkT<DiscoverCompetition[]> | AuthErrors;

    @post @route("/discover/opengrants/search") @useAuth(GmsOAuth<["discovery"]> | UserSession)
    op openGrantsSearch(@body body: OpenGrantsQuery): OkT<OpenGrantsResults> | BadRequest | AuthErrors;

    @post @route("/discover/opengrants/match") @useAuth(GmsOAuth<["discovery"]> | UserSession)
    op openGrantsMatch(@body body: OpenGrantsQuery): OkT<OpenGrantsResults> | BadRequest | AuthErrors;

    @post @route("/discover/opengrants/eligibility") @useAuth(GmsOAuth<["discovery"]> | UserSession)
    op openGrantsEligibility(@body body: OpenGrantsQuery): OkT<OpenGrantsResults> | BadRequest | AuthErrors;

    @post @route("/discover/opengrants/alerts") @useAuth(GmsOAuth<["discovery"]> | UserSession)
    op openGrantsAlerts(@body body: OpenGrantsQuery): OkT<OpenGrantsResults> | BadRequest | AuthErrors;

    @get @route("/my/applications") @useAuth(GmsOAuth<["applications:read"]> | UserSession)
    op myApplications(): OkT<MyApplication[]> | AuthErrors;

    @get @route("/my/applications/{id}/sections") @useAuth(GmsOAuth<["applications:read"]> | UserSession)
    op mySectionAssignments(@path id: GmsId): OkT<FormSectionAssignments[]> | AuthErrors | NotFound;

    /** The same assignments for the funder's staff (not reviewers). */
    @get @route("/applications/{id}/sections") @useAuth(GmsOAuth<["applications:read"]> | UserSession)
    op sectionAssignments(@path id: GmsId): OkT<FormSectionAssignments[]> | AuthErrors | NotFound;

    /** Put a library answer into one field. Its provenance becomes `library`; the answer records the use. */
    @post @route("/my/applications/{id}/forms/{formId}/insert-answer") @useAuth(GmsOAuth<["applications:write", "library:read"]> | UserSession)
    op insertAnswer(@path id: GmsId, @path formId: GmsId, @body body: InsertAnswerInput): OkT<InsertAnswerResult> | BadRequest | AuthErrors | NotFound | Conflict | Unprocessable;

    /** The member's notifications, derived from the ledger and from events on their applications. */
    @get @route("/notifications") @useAuth(UserSession)
    op listNotifications(@query unread?: boolean): OkT<NotificationList> | AuthErrors;

    @post @route("/notifications/read") @useAuth(UserSession)
    op markNotificationsRead(@body body: NotificationReadInput): OkT<{ unread: int32 }> | BadRequest | AuthErrors;

    @get @route("/me/notification-preferences") @useAuth(UserSession)
    op getNotificationPreferences(): OkT<NotificationPreferences> | AuthErrors;

    @put @route("/me/notification-preferences") @useAuth(UserSession)
    op putNotificationPreferences(@body body: NotificationPreferences): OkT<NotificationPreferences> | BadRequest | AuthErrors;

    @post @route("/my/applications/{id}/sections/assign") @useAuth(GmsOAuth<["applications:write"]> | UserSession)
    op assignSections(@path id: GmsId, @body body: SectionAssignment): OkT<SectionAssignment> | BadRequest | AuthErrors | NotFound;

    /** Field comments of the applicant team. Never visible to the funder. */
    @get @route("/my/applications/{id}/comments") @useAuth(GmsOAuth<["applications:read"]> | UserSession)
    op listComments(@path id: GmsId): OkT<Comment[]> | AuthErrors | NotFound;

    @post @route("/my/applications/{id}/comments/{commentId}/resolve") @useAuth(GmsOAuth<["applications:write"]> | UserSession)
    op resolveComment(@path id: GmsId, @path commentId: CommonGrants.Types.uuid): OkT<Comment> | AuthErrors | NotFound;

    @get @route("/my/applications/{id}/attachments") @useAuth(GmsOAuth<["applications:read"]> | UserSession)
    op listAttachments(@path id: GmsId): OkT<Document[]> | AuthErrors | NotFound;

    @post @route("/my/applications/{id}/comments") @useAuth(GmsOAuth<["applications:write"]> | UserSession)
    op comment(@path id: GmsId, @body body: CommentInput): CreatedT<Comment> | BadRequest | AuthErrors | NotFound;

    /** Register an upload (Supabase Storage up to 25 MB, R2 above) or reference a Passport locker document. */
    @post @route("/my/applications/{id}/attachments") @useAuth(GmsOAuth<["applications:write"]> | UserSession)
    op attach(@path id: GmsId, @body body: AttachmentInput): CreatedT<Document> | BadRequest | AuthErrors | NotFound;

    @post @route("/my/applications/{id}/withdraw") @useAuth(GmsOAuth<["applications:write"]> | UserSession)
    op withdraw(@path id: GmsId): OkT<ApplicationActionResult> | AuthErrors | NotFound | Conflict;

    @get @route("/my/applications/{id}/status") @useAuth(GmsOAuth<["applications:read"]> | UserSession)
    op applicationStatus(@path id: GmsId): OkT<ApplicationStatusView> | AuthErrors | NotFound;

    @get @route("/my/awards") @useAuth(GmsOAuth<["awards:read"]> | UserSession)
    op myAwards(...PageParams): PaginatedT<GmsAward> | AuthErrors;

    @get @route("/my/awards/{id}") @useAuth(GmsOAuth<["awards:read"]> | UserSession)
    op myAward(@path id: GmsId): OkT<MyAwardDetail> | AuthErrors | NotFound;

    /** Where Passport would pay this grant: bank name and last four digits, read live with the
     * grantee's own consent and never stored by the GMS.
     */
    @get @route("/my/awards/{id}/payout-destination") @useAuth(GmsOAuth<["awards:read"]> | UserSession)
    op myPayoutDestination(@path id: GmsId): OkT<PayoutDestinationView> | AuthErrors | NotFound;

    /** People only: the recipient workspace's admin accepts; an agent's accept runs after a person approves it. */
    @post @route("/my/awards/{id}/accept") @useAuth(UserSession)
    op acceptAward(@path id: GmsId, @body body?: AcceptOfferInput): OkT<AcceptedAward> | BadRequest | AuthErrors | NotFound | Conflict | Unprocessable;

    @post @route("/my/awards/{id}/amendments") @useAuth(GmsOAuth<["awards:write"]> | UserSession)
    op requestAmendment(@path id: GmsId, @body body: AmendmentInput): CreatedT<Amendment> | BadRequest | AuthErrors | NotFound | Conflict | Unprocessable;

    /** The award's payment schedule. No bank data: destinations live in Passport. */
    @get @route("/my/awards/{id}/schedule") @useAuth(GmsOAuth<["awards:read"]> | UserSession)
    op mySchedule(@path id: GmsId): OkT<AwardTranche[]> | AuthErrors | NotFound;

    @get @route("/my/awards/{id}/budget") @useAuth(GmsOAuth<["awards:read"]> | UserSession)
    op myBudget(@path id: GmsId): OkT<BudgetBook> | AuthErrors | NotFound;

    /** The grantee reports actuals for a period. */
    @put @route("/my/awards/{id}/budget") @useAuth(GmsOAuth<["awards:write"]> | UserSession)
    op setMyBudget(@path id: GmsId, @body body: BudgetPut): OkT<BudgetView> | BadRequest | AuthErrors | NotFound;

    @get @route("/my/requirements") @useAuth(GmsOAuth<["requirements:read"]> | UserSession)
    op myRequirements(): OkT<RequirementView[]> | AuthErrors;

    /** Open (or return to) the report for a requirement. The first call creates the draft, prefilled
     * from Passport and the last accepted report on the award, with provenance per field.
     */
    @post @route("/my/requirements/{id}/start") @useAuth(GmsOAuth<["requirements:write"]> | UserSession)
    op startSubmission(@path id: GmsId): OkT<SubmissionView> | AuthErrors | NotFound | Conflict;

    @get @route("/my/submissions/{id}") @useAuth(GmsOAuth<["requirements:read"]> | UserSession)
    op mySubmission(@path id: GmsId): OkT<SubmissionView> | AuthErrors | NotFound;

    @put @route("/my/submissions/{id}/forms/{formId}") @useAuth(GmsOAuth<["requirements:write"]> | UserSession)
    op setSubmissionForm(@path id: GmsId, @path formId: GmsId, @body body: SubmissionFormInput): OkT<SubmissionFormSaved> | BadRequest | AuthErrors | NotFound | Conflict;

    @post @route("/my/submissions/{id}/submit") @useAuth(GmsOAuth<["requirements:write"]> | UserSession)
    op submitSubmission(@path id: GmsId): OkT<SubmissionView> | AuthErrors | NotFound | Conflict | Unprocessable;

    /** Share an accepted report with another funder workspace. This is the grantee's consent. */
    @post @route("/my/submissions/{id}/share") @useAuth(GmsOAuth<["requirements:write"]> | UserSession)
    op shareSubmission(@path id: GmsId, @body body: ShareSubmissionInput): CreatedT<ShareSubmissionResult> | BadRequest | AuthErrors | NotFound | Conflict;

    @get @route("/my/answers") @useAuth(GmsOAuth<["library:read"]> | UserSession)
    op listAnswers(...PageParams): PaginatedT<Answer> | AuthErrors;

    @post @route("/my/answers") @useAuth(GmsOAuth<["library:write"]> | UserSession)
    op createAnswer(@body body: AnswerInput): CreatedT<Answer> | BadRequest | AuthErrors;

    @patch @route("/my/answers/{id}") @useAuth(GmsOAuth<["library:write"]> | UserSession)
    op updateAnswer(@path id: string, @body body: MergePatch): OkT<Answer> | BadRequest | AuthErrors | NotFound;

    @post @route("/my/answers/{id}/adapt") @useAuth(GmsOAuth<["library:read", "assist"]> | UserSession)
    op adaptAnswer(@path id: string, @body body: AdaptAnswerBody): OkT<AdaptedAnswerDraft> | BadRequest | AuthErrors | NotFound;

    /** Which funders may read which of the applicant's data. */
    @get @route("/my/consents") @useAuth(UserSession)
    op listConsents(): OkT<Consent[]> | AuthErrors;

    @delete @route("/my/consents/{id}") @useAuth(UserSession)
    op revokeConsent(@path id: string): OkT<{
      revoked: boolean;
    }> | AuthErrors | NotFound;

    @get @route("/my/funders") @useAuth(UserSession)
    op myFunders(): OkT<MyFunder[]> | AuthErrors;
  }
}

// #########################################################
// Infrastructure routes
// #########################################################

@tag("Infrastructure")
namespace GMS.Routes.Infrastructure {
  /** Client credentials, authorization code (PKCE S256) and refresh token exchange. Issues ES256 JWTs. */
  @summary("Issue an access token")
  @post
  @route("/oauth/token")
  @useAuth(BasicAuth | NoAuth)
  op token(@header contentType: "application/x-www-form-urlencoded", @body body: TokenRequest): TokenResponse | OAuthErrorResponse;

  /** Authorization-code request with PKCE; redirects to the consent screen, where a user with
   * several workspaces chooses one.
   */
  @summary("Start an authorization request")
  @get
  @route("/oauth/authorize")
  op authorize(
    @query response_type: "code",
    @query client_id: string,
    @query redirect_uri: url,
    @query scope: string,
    @query state: string,
    @query code_challenge: string,
    @query code_challenge_method: "S256",
    @query resource?: url,
  ): Redirect | OAuthErrorResponse;

  /** Consent decision from the web app; returns the client redirect URI carrying `code` or `error`. */
  @summary("Record a consent decision")
  @post
  @route("/oauth/authorize/decision")
  @useAuth(UserSession)
  op authorizeDecision(@body body: AuthorizationDecision): OkT<AuthorizationDecisionResult> | BadRequest | AuthErrors | NotFound;

  /** Dynamic client registration for MCP clients (RFC 7591): public clients, redirect allow-list. */
  @summary("Register an OAuth client")
  @post
  @route("/oauth/register")
  op register(@body body: ClientRegistrationRequest): {
    @statusCode statusCode: 201;
    @body body: ClientRegistrationResponse;
  } | OAuthErrorResponse;

  @summary("JSON Web Key Set")
  @get
  @route("/.well-known/jwks.json")
  op jwks(): JwkSet;

  @summary("Authorization server metadata")
  @get
  @route("/.well-known/oauth-authorization-server")
  op authorizationServer(): AuthorizationServerMetadata;

  @summary("Protected resource metadata")
  @get
  @route("/.well-known/oauth-protected-resource")
  op protectedResource(): ProtectedResourceMetadata;

  @summary("Agent card")
  @get
  @route("/.well-known/agent.json")
  op agentCard(): AgentCard;

  /** What the GMS is, how to authenticate, the tool list and the human gates. */
  @summary("Agent guide")
  @get
  @route("/llms.txt")
  op llms(): PlainText;

  @summary("Agent guide with schemas")
  @get
  @route("/llms-full.txt")
  op llmsFull(): PlainText;

  /** Published data behind `/f/{handle}`: the funder's brand and its listed opportunities. No token. */
  @summary("Funder public page data")
  @get
  @route("/gms/public/funders/{handle}")
  op funderPage(@path handle: string): OkT<FunderPage> | NotFound;

  /** Published data behind `/f/{handle}/o/{slug}`. No token; published fields only. */
  @summary("Opportunity public page data")
  @get
  @route("/gms/public/funders/{handle}/opportunities/{slug}")
  op opportunityPage(@path handle: string, @path slug: string): OkT<OpportunityPage> | NotFound;

  /** The MCP server: Streamable HTTP, stateless. POST one JSON-RPC message (or a batch) and read
   * the answer as JSON; notifications answer 202. A 401 carries `WWW-Authenticate` pointing at
   * `/.well-known/oauth-protected-resource`. Tokens are bound to a person, a workspace and scopes;
   * gated tools return `{ status: "pending_approval", approvalId, url }`.
   */
  @summary("Model Context Protocol endpoint")
  @post
  @route("/mcp")
  @useAuth(GmsOAuth<[]>)
  op mcp(@body body: McpMessage | McpMessage[]): {
    @statusCode statusCode: 200;
    @body body: McpMessage | McpMessage[];
  } | {
    @statusCode statusCode: 202;
  } | Unauthorized | Forbidden;

  /** Funder pages and open opportunities, for the OpenGrants importer. */
  @summary("Sitemap")
  @get
  @route("/sitemap.xml")
  op sitemap(): Xml;

  /** Verifies `X-Passport-Signature` / `X-Passport-Timestamp`, dedupes on the event id and enqueues. */
  @summary("Receive a Passport webhook")
  @post
  @route("/webhooks/passport")
  op passportWebhook(
    @header("X-Passport-Signature") signature: string,
    @header("X-Passport-Timestamp") timestamp: string,
    @body body: InboundWebhook,
  ): WebhookAck | BadRequest | Unauthorized;

  /** Delivery events and inbound replies, matched to threads by `Message-ID` or plus-addressing. */
  @summary("Receive a Resend webhook")
  @post
  @route("/webhooks/resend")
  op resendWebhook(@body body: InboundWebhook): WebhookAck | BadRequest | Unauthorized;
}
