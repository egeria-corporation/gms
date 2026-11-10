import "@typespec/http";
import "@typespec/rest";
import "@common-grants/core";
import "./models.tsp";

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
    /** Workspaces the caller is a member of. */
    @get @route("/workspaces") @useAuth(UserSession)
    op list(...PageParams): PaginatedT<Workspace> | AuthErrors;

    /** Create a funder or applicant workspace. */
    @post @route("/workspaces") @useAuth(UserSession)
    op create(@body body: WorkspaceInput): CreatedT<Workspace> | BadRequest | AuthErrors | Conflict;

    @get @route("/workspaces/{id}") @useAuth(GmsOAuth<["workspace:admin"]> | UserSession)
    op read(@path id: CommonGrants.Types.uuid): OkT<Workspace> | AuthErrors | NotFound;

    /** Update name, brand and settings. Brand contrast is checked (WCAG AA). */
    @patch @route("/workspaces/{id}") @useAuth(GmsOAuth<["workspace:admin"]> | UserSession)
    op update(@path id: CommonGrants.Types.uuid, @body body: MergePatch): OkT<Workspace> | BadRequest | AuthErrors | NotFound;

    @get @route("/workspaces/{id}/members") @useAuth(GmsOAuth<["workspace:admin"]> | UserSession)
    op listMembers(@path id: CommonGrants.Types.uuid, ...PageParams): PaginatedT<Member> | AuthErrors | NotFound;

    @post @route("/workspaces/{id}/members") @useAuth(GmsOAuth<["workspace:admin"]> | UserSession)
    op addMember(@path id: CommonGrants.Types.uuid, @body body: MemberInput): CreatedT<Member> | BadRequest | AuthErrors | NotFound | Conflict;

    @patch @route("/workspaces/{id}/members/{userId}") @useAuth(GmsOAuth<["workspace:admin"]> | UserSession)
    op updateMember(@path id: CommonGrants.Types.uuid, @path userId: CommonGrants.Types.uuid, @body body: MergePatch): OkT<Member> | BadRequest | AuthErrors | NotFound;

    @delete @route("/workspaces/{id}/members/{userId}") @useAuth(GmsOAuth<["workspace:admin"]> | UserSession)
    op removeMember(@path id: CommonGrants.Types.uuid, @path userId: CommonGrants.Types.uuid): NoContentResponse | AuthErrors | NotFound | Conflict;

    /** Invite by email; external reviewers and consultants are scoped and may expire. */
    @post @route("/workspaces/{id}/invitations") @useAuth(GmsOAuth<["workspace:admin"]> | UserSession)
    op invite(@path id: CommonGrants.Types.uuid, @body body: Invitation): CreatedT<Invitation> | BadRequest | AuthErrors | NotFound;

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
    op preview(@path id: GmsId): OkT<OpportunityDetails> | BadRequest | AuthErrors | NotFound;
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
    op setStages(@path id: GmsId, @body body: Stage[]): OkT<GmsCompetition> | BadRequest | AuthErrors | NotFound | Conflict;

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
    op ranking(@path id: GmsId, @query stage?: string): OkT<RankingRow[]> | AuthErrors | NotFound;

    /** Program headroom: budget − committed − proposed. */
    @get @route("/competitions/{id}/allocation") @useAuth(GmsOAuth<["decisions:write"]> | UserSession)
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
    /** Dry-run the eligibility rules against an organization or an application. */
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
    ): PaginatedT<GmsApplication> | AuthErrors;

    @get @route("/applications/{id}") @useAuth(GmsOAuth<["applications:read"]> | UserSession)
    op read(@path id: GmsId): OkT<GmsApplication> | AuthErrors | NotFound;

    /** Move to a stage whose `entryFrom` includes the current stage. */
    @post @route("/applications/{id}/advance") @useAuth(GmsOAuth<["applications:write"]> | UserSession)
    op advance(@path id: GmsId, @body body: AdvanceRequest): OkT<GmsApplication> | BadRequest | AuthErrors | NotFound | Conflict;

    @post @route("/applications/{id}/request-revision") @useAuth(GmsOAuth<["applications:write"]> | UserSession)
    op requestRevision(@path id: GmsId, @body body: RevisionRequest): OkT<GmsApplication> | BadRequest | AuthErrors | NotFound | Conflict;

    /** Declines and queues the letter. Sending is human-gated for agents. */
    @post @route("/applications/{id}/decline") @useAuth(GmsOAuth<["applications:write"]> | UserSession)
    op decline(@path id: GmsId, @body body: DeclineRequest): OkT<GmsApplication> | PendingApproval | AuthErrors | NotFound | Conflict;

    @post @route("/applications/{id}/tags") @useAuth(GmsOAuth<["applications:write"]> | UserSession)
    op tag(@path id: GmsId, @body body: TagsRequest): OkT<GmsApplication> | AuthErrors | NotFound;

    @post @route("/applications/{id}/assign") @useAuth(GmsOAuth<["applications:write"]> | UserSession)
    op assign(@path id: GmsId, @body body: AssignRequest): OkT<GmsApplication> | AuthErrors | NotFound;

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
    op listAssignments(...PageParams, @query competitionId?: GmsId, @query reviewerUserId?: CommonGrants.Types.uuid): PaginatedT<ReviewAssignment> | AuthErrors;

    @post @route("/review-assignments") @useAuth(GmsOAuth<["reviews:write"]> | UserSession)
    op createAssignment(@body body: ReviewAssignmentInput): CreatedT<ReviewAssignment> | BadRequest | AuthErrors | Conflict;

    /** Assign by capacity and expertise tags, excluding declared and domain-matched conflicts. */
    @post @route("/review-assignments/auto") @useAuth(GmsOAuth<["reviews:write"]> | UserSession)
    op autoAssign(@body body: AutoAssignRequest): CreatedT<ReviewAssignment[]> | BadRequest | AuthErrors;

    /** Declare a conflict, recuse, save scores or submit the review. */
    @patch @route("/review-assignments/{id}") @useAuth(GmsOAuth<["reviews:write"]> | UserSession)
    op updateAssignment(@path id: GmsId, @body body: MergePatch): OkT<ReviewAssignment> | BadRequest | AuthErrors | NotFound | Conflict;

    /** In blind mode a reviewer sees other reviews only at the panel. */
    @get @route("/reviews") @useAuth(GmsOAuth<["reviews:read"]> | UserSession)
    op listReviews(...PageParams, @query applicationId?: GmsId): PaginatedT<Review> | AuthErrors;
  }

  @tag("Decisions")
  namespace Decisions {
    @post @route("/decisions/propose") @useAuth(GmsOAuth<["decisions:write"]> | UserSession)
    op propose(@body body: ProposeDecisionsRequest): CreatedT<Decision[]> | BadRequest | AuthErrors;

    @get @route("/decisions") @useAuth(GmsOAuth<["decisions:write"]> | UserSession)
    op list(...PageParams, @query competitionId?: GmsId): PaginatedT<Decision> | AuthErrors;

    /** Creates awards in `offered`, drafts agreements and queues letters. Refuses over-allocation
     * unless an admin overrides with a reason. Always human-gated for agents.
     */
    @post @route("/decisions/commit") @useAuth(GmsOAuth<["decisions:write"]> | UserSession)
    op commit(@body body: CommitDecisionsRequest): OkT<Decision[]> | PendingApproval | BadRequest | AuthErrors | Conflict;
  }

  @tag("Awards (GMS)")
  namespace Awards {
    @get @route("/awards") @useAuth(GmsOAuth<["awards:read"]> | UserSession)
    op list(...PageParams, @query status?: AwardStatus, @query programId?: CommonGrants.Types.uuid): PaginatedT<GmsAward> | AuthErrors;

    @get @route("/awards/{id}") @useAuth(GmsOAuth<["awards:read"]> | UserSession)
    op read(@path id: GmsId): OkT<GmsAward> | AuthErrors | NotFound;

    /** Recipient accepts the offer; the GMS then mirrors the award to Passport. Human-gated for agents. */
    @post @route("/awards/{id}/accept-offer") @useAuth(GmsOAuth<["awards:write"]> | UserSession)
    op acceptOffer(@path id: GmsId): OkT<GmsAward> | PendingApproval | AuthErrors | NotFound | Conflict;

    /** Requires an executed agreement unless the award carries `noAgreementRequired`. */
    @post @route("/awards/{id}/activate") @useAuth(GmsOAuth<["awards:write"]> | UserSession)
    op activate(@path id: GmsId): OkT<GmsAward> | AuthErrors | NotFound | Conflict;

    @post @route("/awards/{id}/suspend") @useAuth(GmsOAuth<["awards:write"]> | UserSession)
    op suspend(@path id: GmsId, @body body: ReasonBody): OkT<GmsAward> | AuthErrors | NotFound | Conflict;

    @post @route("/awards/{id}/complete") @useAuth(GmsOAuth<["awards:write"]> | UserSession)
    op complete(@path id: GmsId): OkT<GmsAward> | AuthErrors | NotFound | Conflict;

    @post @route("/awards/{id}/cancel") @useAuth(GmsOAuth<["awards:write"]> | UserSession)
    op cancel(@path id: GmsId, @body body: ReasonBody): OkT<GmsAward> | AuthErrors | NotFound | Conflict;

    @post @route("/awards/{id}/amendments") @useAuth(GmsOAuth<["awards:write"]> | UserSession)
    op createAmendment(@path id: GmsId, @body body: AmendmentInput): CreatedT<Amendment> | BadRequest | AuthErrors | NotFound;

    /** Approve or decline. Approval that changes amount or period patches the Passport award. */
    @patch @route("/amendments/{id}") @useAuth(GmsOAuth<["awards:write"]> | UserSession)
    op decideAmendment(@path id: string, @body body: MergePatch): OkT<Amendment> | BadRequest | AuthErrors | NotFound | Conflict;

    @get @route("/awards/{id}/budget") @useAuth(GmsOAuth<["awards:read"]> | UserSession)
    op readBudget(@path id: GmsId): OkT<Budget[]> | AuthErrors | NotFound;

    @put @route("/awards/{id}/budget") @useAuth(GmsOAuth<["awards:write"]> | UserSession)
    op setBudget(@path id: GmsId, @body body: Budget): OkT<Budget> | BadRequest | AuthErrors | NotFound;

    @get @route("/awards/{id}/variance") @useAuth(GmsOAuth<["awards:read"]> | UserSession)
    op variance(@path id: GmsId): OkT<VarianceRow[]> | AuthErrors | NotFound;
  }

  @tag("Agreements")
  namespace Agreements {
    /** Draft an agreement from a template. */
    @post @route("/awards/{id}/agreements") @useAuth(GmsOAuth<["agreements:write"]> | UserSession)
    op create(@path id: GmsId, @body body: AgreementInput): CreatedT<Agreement> | BadRequest | AuthErrors | NotFound;

    @post @route("/agreements/{id}/send") @useAuth(GmsOAuth<["agreements:write"]> | UserSession)
    op send(@path id: GmsId): OkT<Agreement> | AuthErrors | NotFound | Conflict;

    /** Grantee click-to-sign: typed name, attestation, IP, time and document hash go to the ledger. Human-only. */
    @post @route("/agreements/{id}/sign") @useAuth(UserSession)
    op sign(@path id: GmsId, @body body: SignRequest): OkT<Agreement> | BadRequest | AuthErrors | NotFound | Conflict;

    /** Funder countersignature; the agreement becomes `executed`. Human-only. */
    @post @route("/agreements/{id}/countersign") @useAuth(UserSession)
    op countersign(@path id: GmsId, @body body: SignRequest): OkT<Agreement> | BadRequest | AuthErrors | NotFound | Conflict;

    /** Refused for an executed agreement; issue an amendment instead. */
    @post @route("/agreements/{id}/void") @useAuth(GmsOAuth<["agreements:write"]> | UserSession)
    op voidAgreement(@path id: GmsId, @body body: ReasonBody): OkT<Agreement> | AuthErrors | NotFound | Conflict;

    @get @route("/agreements/{id}/pdf") @useAuth(GmsOAuth<["awards:read"]> | UserSession)
    op pdf(@path id: GmsId): Pdf | AuthErrors | NotFound;
  }

  @tag("Payments")
  namespace Payments {
    @get @route("/awards/{id}/schedule") @useAuth(GmsOAuth<["payments:read"]> | UserSession)
    op readSchedule(@path id: GmsId): OkT<Tranche[]> | AuthErrors | NotFound;

    @put @route("/awards/{id}/schedule") @useAuth(GmsOAuth<["awards:write"]> | UserSession)
    op setSchedule(@path id: GmsId, @body body: ScheduleInput): OkT<Tranche[]> | BadRequest | AuthErrors | NotFound | Conflict;

    @get @route("/tranches") @useAuth(GmsOAuth<["payments:read"]> | UserSession)
    op listTranches(...PageParams, @query status?: TrancheStatus): PaginatedT<Tranche> | AuthErrors;

    /** Live readiness: agreement, condition, Passport link, credential (L3, destination active, no
     * pending change, no freeze), award headroom, duplicates, recipient status.
     */
    @get @route("/tranches/{id}/readiness") @useAuth(GmsOAuth<["payments:read"]> | UserSession)
    op readiness(@path id: GmsId): OkT<Readiness> | AuthErrors | NotFound;

    /** Facilitated release through Passport with the tranche id as idempotency key. Always human-gated for agents. */
    @post @route("/tranches/{id}/release") @useAuth(GmsOAuth<["payments:release"]> | UserSession)
    op release(@path id: GmsId, @body body: ReleaseRequest): OkT<Tranche> | PendingApproval | AuthErrors | NotFound | Conflict;

    /** Resolve mode: record a payment made elsewhere and post it to Passport, which verifies `last4`. */
    @post @route("/tranches/{id}/record-external") @useAuth(GmsOAuth<["payments:release"]> | UserSession)
    op recordExternal(@path id: GmsId, @body body: ExternalPayment): OkT<Tranche> | BadRequest | AuthErrors | NotFound | Conflict;

    @post @route("/tranches/{id}/hold") @useAuth(GmsOAuth<["payments:release"]> | UserSession)
    op hold(@path id: GmsId, @body body: ReasonBody): OkT<Tranche> | AuthErrors | NotFound | Conflict;

    @post @route("/tranches/{id}/cancel") @useAuth(GmsOAuth<["payments:release"]> | UserSession)
    op cancel(@path id: GmsId, @body body: ReasonBody): OkT<Tranche> | AuthErrors | NotFound | Conflict;

    /** Due and ready tranches with their readiness, for the Payments center. */
    @get @route("/payments/readiness") @useAuth(GmsOAuth<["payments:read"]> | UserSession)
    op center(...PageParams): PaginatedT<{
      tranche: Tranche;
      readiness: Readiness;
    }> | AuthErrors;

    /** Holds, freezes, pending destination changes and unverified external payments. */
    @get @route("/payments/alerts") @useAuth(GmsOAuth<["payments:read"]> | UserSession)
    op alerts(...PageParams): PaginatedT<PaymentAlert> | AuthErrors;

    /** Outbound transactions read from Mercury, with proposed tranche matches. */
    @get @route("/bank-transactions") @useAuth(GmsOAuth<["payments:read"]> | UserSession)
    op listBankTransactions(...PageParams, @query unmatched?: boolean): PaginatedT<BankTransaction> | AuthErrors;

    /** Confirm a match; calls record-external for the tranche. */
    @post @route("/bank-transactions/{id}/match") @useAuth(GmsOAuth<["payments:release"]> | UserSession)
    op matchBankTransaction(@path id: string, @body body: MatchRequest): OkT<Tranche> | BadRequest | AuthErrors | NotFound | Conflict;
  }

  @tag("Requirements")
  namespace Requirements {
    @get @route("/awards/{id}/requirements") @useAuth(GmsOAuth<["requirements:read"]> | UserSession)
    op list(@path id: GmsId, ...PageParams): PaginatedT<Requirement> | AuthErrors | NotFound;

    @post @route("/awards/{id}/requirements") @useAuth(GmsOAuth<["requirements:write"]> | UserSession)
    op create(@path id: GmsId, @body body: RequirementInput): CreatedT<Requirement> | BadRequest | AuthErrors | NotFound;

    @patch @route("/requirements/{id}") @useAuth(GmsOAuth<["requirements:write"]> | UserSession)
    op update(@path id: GmsId, @body body: MergePatch): OkT<Requirement> | BadRequest | AuthErrors | NotFound;

    @post @route("/requirements/{id}/waive") @useAuth(GmsOAuth<["requirements:write"]> | UserSession)
    op waive(@path id: GmsId, @body body: ReasonBody): OkT<Requirement> | AuthErrors | NotFound | Conflict;

    @get @route("/requirements/due") @useAuth(GmsOAuth<["requirements:read"]> | UserSession)
    op due(...PageParams, @query withinDays?: int32): PaginatedT<Requirement> | AuthErrors;

    /** Send the next reminder now. Idempotent per (requirement, offset). */
    @post @route("/requirements/{id}/remind") @useAuth(GmsOAuth<["requirements:write"]> | UserSession)
    op remind(@path id: GmsId): OkT<SendResult> | PendingApproval | AuthErrors | NotFound;

    @get @route("/submissions/{id}") @useAuth(GmsOAuth<["requirements:read"]> | UserSession)
    op readSubmission(@path id: GmsId): OkT<Submission> | AuthErrors | NotFound;

    /** Accepting moves a linked `onReportAccepted` tranche to `due`. */
    @post @route("/submissions/{id}/accept") @useAuth(GmsOAuth<["requirements:write"]> | UserSession)
    op acceptSubmission(@path id: GmsId, @body body: ReviewNote): OkT<Submission> | AuthErrors | NotFound | Conflict;

    @post @route("/submissions/{id}/return") @useAuth(GmsOAuth<["requirements:write"]> | UserSession)
    op returnSubmission(@path id: GmsId, @body body: ReviewNote): OkT<Submission> | AuthErrors | NotFound | Conflict;
  }

  @tag("Grantees")
  namespace Grantees {
    @get @route("/grantees") @useAuth(GmsOAuth<["grantees:read"]> | UserSession)
    op list(...PageParams, @query tag?: string): PaginatedT<Grantee> | AuthErrors;

    @get @route("/grantees/{applicantWorkspaceId}") @useAuth(GmsOAuth<["grantees:read"]> | UserSession)
    op read(@path applicantWorkspaceId: CommonGrants.Types.uuid): OkT<Grantee> | AuthErrors | NotFound;

    /** Owner, tags and relationship notes; never profile fields. */
    @patch @route("/grantees/{applicantWorkspaceId}") @useAuth(GmsOAuth<["grantees:write"]> | UserSession)
    op update(@path applicantWorkspaceId: CommonGrants.Types.uuid, @body body: MergePatch): OkT<Grantee> | BadRequest | AuthErrors | NotFound;

    /** Profile changes received from Passport. */
    @get @route("/org-changes") @useAuth(GmsOAuth<["grantees:read"]> | UserSession)
    op listOrgChanges(...PageParams, @query status?: string): PaginatedT<OrgChange> | AuthErrors;

    /** Refreshes the cached projection and re-runs eligibility where it applies. */
    @post @route("/org-changes/{id}/accept") @useAuth(GmsOAuth<["grantees:write"]> | UserSession)
    op acceptOrgChange(@path id: string): OkT<OrgChange> | AuthErrors | NotFound | Conflict;

    @post @route("/org-changes/{id}/dismiss") @useAuth(GmsOAuth<["grantees:write"]> | UserSession)
    op dismissOrgChange(@path id: string): OkT<OrgChange> | AuthErrors | NotFound | Conflict;

    /** Send a proposed profile change to Passport, where it is `pending` until the organization accepts. */
    @post @route("/grantees/{applicantWorkspaceId}/propose-change") @useAuth(GmsOAuth<["grantees:write"]> | UserSession)
    op proposeChange(@path applicantWorkspaceId: CommonGrants.Types.uuid, @body body: ProposeChangeRequest): AcceptedT<OrgChange> | BadRequest | AuthErrors | NotFound;
  }

  @tag("Communication")
  namespace Communication {
    @get @route("/threads") @useAuth(GmsOAuth<["messages:read"]> | UserSession)
    op listThreads(...PageParams, @query subjectType?: string, @query subjectId?: string): PaginatedT<Thread> | AuthErrors;

    @post @route("/threads/{id}/messages") @useAuth(GmsOAuth<["messages:write"]> | UserSession)
    op postMessage(@path id: string, @body body: MessageInput): CreatedT<Message> | BadRequest | AuthErrors | NotFound;

    @get @route("/tasks") @useAuth(GmsOAuth<["messages:read"]> | UserSession)
    op listTasks(...PageParams): PaginatedT<Task> | AuthErrors;

    @post @route("/tasks") @useAuth(GmsOAuth<["messages:write"]> | UserSession)
    op createTask(@body body: TaskInput): CreatedT<Task> | BadRequest | AuthErrors;

    @get @route("/templates") @useAuth(GmsOAuth<["communications:write"]> | UserSession)
    op listTemplates(...PageParams, @query kind?: string): PaginatedT<Template> | AuthErrors;

    @post @route("/templates") @useAuth(GmsOAuth<["communications:write"]> | UserSession)
    op createTemplate(@body body: TemplateInput): CreatedT<Template> | BadRequest | AuthErrors;

    @post @route("/templates/{id}/render") @useAuth(GmsOAuth<["communications:write"]> | UserSession)
    op renderTemplate(@path id: string, @body body: RenderRequest): OkT<Rendered> | BadRequest | AuthErrors | NotFound;

    /** Templated send through Resend. Human-gated for agents. */
    @post @route("/communications/send") @useAuth(GmsOAuth<["communications:write"]> | UserSession)
    op send(@body body: SendRequest): OkT<SendResult> | PendingApproval | BadRequest | AuthErrors;
  }

  @tag("Analytics")
  namespace Analytics {
    @get @route("/analytics/portfolio") @useAuth(GmsOAuth<["analytics:read"]> | UserSession)
    op portfolio(@query programId?: CommonGrants.Types.uuid): OkT<PortfolioSummary> | AuthErrors;

    @get @route("/analytics/cycle/{competitionId}") @useAuth(GmsOAuth<["analytics:read"]> | UserSession)
    op cycle(@path competitionId: GmsId): OkT<CycleMetrics> | AuthErrors | NotFound;

    /** 990-PF Part XV grant list for a fiscal year. */
    @get @route("/exports/990pf") @useAuth(GmsOAuth<["analytics:read"]> | UserSession)
    op grantList(@query fiscalYear: string): OkT<GrantListRow[]> | AuthErrors;

    /** CommonGrants JSON bundle + GMS JSON + attachments manifest. */
    @post @route("/exports/bundle") @useAuth(GmsOAuth<["workspace:admin"]> | UserSession)
    op exportBundle(): AcceptedT<ExportJob> | AuthErrors;

    @post @route("/imports/csv") @useAuth(GmsOAuth<["workspace:admin"]> | UserSession)
    op importCsv(@body body: CsvImportRequest): AcceptedT<ExportJob> | BadRequest | AuthErrors;
  }

  @tag("Integrations")
  namespace Integrations {
    @get @route("/api-clients") @useAuth(GmsOAuth<["workspace:admin"]> | UserSession)
    op listApiClients(...PageParams): PaginatedT<ApiClient> | AuthErrors;

    /** The secret is shown once. */
    @post @route("/api-clients") @useAuth(UserSession)
    op createApiClient(@body body: ApiClientInput): CreatedT<ApiClientCreated> | BadRequest | AuthErrors;

    @delete @route("/api-clients/{clientId}") @useAuth(UserSession)
    op deleteApiClient(@path clientId: string): NoContentResponse | AuthErrors | NotFound;

    @get @route("/webhooks") @useAuth(GmsOAuth<["workspace:admin"]> | UserSession)
    op listWebhooks(...PageParams): PaginatedT<WebhookSubscription> | AuthErrors;

    @post @route("/webhooks") @useAuth(GmsOAuth<["workspace:admin"]> | UserSession)
    op createWebhook(@body body: WebhookSubscriptionInput): CreatedT<WebhookSubscription> | BadRequest | AuthErrors;

    @delete @route("/webhooks/{id}") @useAuth(GmsOAuth<["workspace:admin"]> | UserSession)
    op deleteWebhook(@path id: string): NoContentResponse | AuthErrors | NotFound;

    @get @route("/webhooks/{id}/deliveries") @useAuth(GmsOAuth<["workspace:admin"]> | UserSession)
    op listDeliveries(@path id: string, ...PageParams): PaginatedT<WebhookDelivery> | AuthErrors | NotFound;

    @get @route("/mcp-connections") @useAuth(GmsOAuth<["workspace:admin"]> | UserSession)
    op listMcpConnections(...PageParams): PaginatedT<McpConnection> | AuthErrors;

    @delete @route("/mcp-connections/{id}") @useAuth(UserSession)
    op revokeMcpConnection(@path id: string): NoContentResponse | AuthErrors | NotFound;

    @get @route("/custom-mcp-servers") @useAuth(GmsOAuth<["workspace:admin"]> | UserSession)
    op listCustomMcpServers(...PageParams): PaginatedT<CustomMcpServer> | AuthErrors;

    /** Read tools only in v1. */
    @post @route("/custom-mcp-servers") @useAuth(UserSession)
    op createCustomMcpServer(@body body: CustomMcpServerInput): CreatedT<CustomMcpServer> | BadRequest | AuthErrors;

    @delete @route("/custom-mcp-servers/{id}") @useAuth(UserSession)
    op deleteCustomMcpServer(@path id: string): NoContentResponse | AuthErrors | NotFound;

    @get @route("/connectors/{provider}") @useAuth(GmsOAuth<["workspace:admin"]> | UserSession)
    op readConnector(@path provider: ConnectorProvider): OkT<ConnectorAccount> | AuthErrors | NotFound;

    @post @route("/connectors/{provider}") @useAuth(UserSession)
    op connect(@path provider: ConnectorProvider, @body body: ConnectorStart): CreatedT<ConnectorStart> | BadRequest | AuthErrors;

    @delete @route("/connectors/{provider}") @useAuth(UserSession)
    op disconnect(@path provider: ConnectorProvider): NoContentResponse | AuthErrors | NotFound;

    @post @route("/connectors/{provider}/sync") @useAuth(GmsOAuth<["workspace:admin"]> | UserSession)
    op sync(@path provider: ConnectorProvider): AcceptedT<ConnectorAccount> | AuthErrors | NotFound;

    /** The workspace-visible audit ledger (admins and auditors). */
    @get @route("/ledger") @useAuth(GmsOAuth<["workspace:admin"]> | UserSession)
    op ledger(...PageParams, @query subjectType?: string, @query subjectId?: string, @query eventType?: string): PaginatedT<LedgerEvent> | AuthErrors;

    /** Pending and resolved human gates. */
    @get @route("/approvals") @useAuth(GmsOAuth<["workspace:admin"]> | UserSession)
    op listApprovals(...PageParams, @query status?: string): PaginatedT<Approval> | AuthErrors;

    /** Agents poll this after a gated call returns `pending_approval`. */
    @get @route("/approvals/{id}") @useAuth(GmsOAuth<[]> | UserSession)
    op readApproval(@path id: string): OkT<Approval> | AuthErrors | NotFound;

    /** Approve or reject. Human-only; no token can call it. */
    @post @route("/approvals/{id}/decision") @useAuth(UserSession)
    op decideApproval(@path id: string, @body body: {
      approve: boolean;
      note?: string;
    }): OkT<Approval> | AuthErrors | NotFound | Conflict;
  }

  @tag("Assistant")
  namespace Assist {
    @post @route("/assist/summarize") @useAuth(GmsOAuth<["assist"]> | UserSession)
    op summarize(@body body: AssistRequest): OkT<AssistDraft> | BadRequest | AuthErrors | NotFound;

    @post @route("/assist/compare-rubric") @useAuth(GmsOAuth<["assist"]> | UserSession)
    op compareRubric(@body body: AssistRequest): OkT<AssistDraft> | BadRequest | AuthErrors | NotFound;

    @post @route("/assist/draft-letter") @useAuth(GmsOAuth<["assist"]> | UserSession)
    op draftLetter(@body body: AssistRequest): OkT<AssistDraft> | BadRequest | AuthErrors | NotFound;

    @post @route("/assist/adapt-answer") @useAuth(GmsOAuth<["assist"]> | UserSession)
    op adaptAnswer(@body body: AssistRequest): OkT<AssistDraft> | BadRequest | AuthErrors | NotFound;
  }

  // #########################################################
  // GMS routes (/gms/...) — applicant side
  // #########################################################

  @tag("Applicant")
  namespace Applicant {
    /** Build the Passport authorization URL (auth code + PKCE; `org:read org.changes:read org.changes:write`). */
    @post @route("/passport/consent/start") @useAuth(UserSession)
    op consentStart(): OkT<ConsentStart> | AuthErrors;

    /** Exchange the code, cache the projection and create or link the applicant workspace. */
    @get @route("/passport/consent/callback")
    op consentCallback(@query code: string, @query state: string): Redirect | BadRequest;

    @get @route("/me/organization") @useAuth(GmsOAuth<["org:read"]> | UserSession)
    op myOrganization(): OkT<OrganizationBase> | AuthErrors | NotFound;

    @get @route("/me/readiness") @useAuth(GmsOAuth<["org:read"]> | UserSession)
    op myReadiness(): OkT<ApplicantReadiness> | AuthErrors | NotFound;

    @post @route("/me/organization/refresh") @useAuth(UserSession)
    op refreshOrganization(): OkT<OrganizationBase> | AuthErrors | NotFound;

    /** Competitions open on this GMS, each with an eligibility preview for the applicant. */
    @get @route("/discover/competitions") @useAuth(GmsOAuth<["discovery"]> | UserSession)
    op discoverCompetitions(...PageParams): PaginatedT<DiscoverCompetition> | AuthErrors;

    @post @route("/discover/opengrants/search") @useAuth(GmsOAuth<["discovery"]> | UserSession)
    op openGrantsSearch(@body body: OpenGrantsQuery): OkT<OpenGrantsResults> | BadRequest | AuthErrors;

    @post @route("/discover/opengrants/match") @useAuth(GmsOAuth<["discovery"]> | UserSession)
    op openGrantsMatch(@body body: OpenGrantsQuery): OkT<OpenGrantsResults> | BadRequest | AuthErrors;

    @post @route("/discover/opengrants/eligibility") @useAuth(GmsOAuth<["discovery"]> | UserSession)
    op openGrantsEligibility(@body body: OpenGrantsQuery): OkT<OpenGrantsResults> | BadRequest | AuthErrors;

    @post @route("/discover/opengrants/alerts") @useAuth(GmsOAuth<["discovery"]> | UserSession)
    op openGrantsAlerts(@body body: OpenGrantsQuery): CreatedT<OpenGrantsResults> | BadRequest | AuthErrors;

    @get @route("/my/applications") @useAuth(GmsOAuth<["applications:read"]> | UserSession)
    op myApplications(...PageParams): PaginatedT<GmsApplication> | AuthErrors;

    @post @route("/my/applications/{id}/sections/assign") @useAuth(GmsOAuth<["applications:write"]> | UserSession)
    op assignSections(@path id: GmsId, @body body: SectionAssignment): OkT<SectionAssignment> | BadRequest | AuthErrors | NotFound;

    @post @route("/my/applications/{id}/comments") @useAuth(GmsOAuth<["applications:write"]> | UserSession)
    op comment(@path id: GmsId, @body body: Comment): CreatedT<Comment> | BadRequest | AuthErrors | NotFound;

    /** Register an upload (Supabase Storage up to 25 MB, R2 above) or reference a Passport locker document. */
    @post @route("/my/applications/{id}/attachments") @useAuth(GmsOAuth<["applications:write"]> | UserSession)
    op attach(@path id: GmsId, @body body: AttachmentInput): CreatedT<Document> | BadRequest | AuthErrors | NotFound;

    @post @route("/my/applications/{id}/withdraw") @useAuth(GmsOAuth<["applications:write"]> | UserSession)
    op withdraw(@path id: GmsId): OkT<GmsApplication> | AuthErrors | NotFound | Conflict;

    @get @route("/my/applications/{id}/status") @useAuth(GmsOAuth<["applications:read"]> | UserSession)
    op applicationStatus(@path id: GmsId): OkT<GmsApplication> | AuthErrors | NotFound;

    @get @route("/my/awards") @useAuth(GmsOAuth<["awards:read"]> | UserSession)
    op myAwards(...PageParams): PaginatedT<GmsAward> | AuthErrors;

    @get @route("/my/awards/{id}") @useAuth(GmsOAuth<["awards:read"]> | UserSession)
    op myAward(@path id: GmsId): OkT<GmsAward> | AuthErrors | NotFound;

    /** Human-gated for agents. */
    @post @route("/my/awards/{id}/accept") @useAuth(GmsOAuth<["awards:write"]> | UserSession)
    op acceptAward(@path id: GmsId): OkT<GmsAward> | PendingApproval | AuthErrors | NotFound | Conflict;

    @post @route("/my/awards/{id}/amendments") @useAuth(GmsOAuth<["awards:write"]> | UserSession)
    op requestAmendment(@path id: GmsId, @body body: AmendmentInput): CreatedT<Amendment> | BadRequest | AuthErrors | NotFound;

    /** Tranches with bank name and last four digits only. */
    @get @route("/my/awards/{id}/schedule") @useAuth(GmsOAuth<["awards:read"]> | UserSession)
    op mySchedule(@path id: GmsId): OkT<Tranche[]> | AuthErrors | NotFound;

    @get @route("/my/requirements") @useAuth(GmsOAuth<["requirements:read"]> | UserSession)
    op myRequirements(...PageParams): PaginatedT<Requirement> | AuthErrors;

    /** Prefilled from the application, the prior accepted submission and the Passport profile, with provenance. */
    @get @route("/my/submissions/{id}") @useAuth(GmsOAuth<["requirements:read"]> | UserSession)
    op mySubmission(@path id: GmsId): OkT<Submission> | AuthErrors | NotFound;

    @put @route("/my/submissions/{id}/forms/{formId}") @useAuth(GmsOAuth<["requirements:write"]> | UserSession)
    op setSubmissionForm(@path id: GmsId, @path formId: GmsId, @body body: Record<unknown>): OkT<AppFormResponse> | BadRequest | AuthErrors | NotFound | Conflict;

    /** Human-gated for agents. */
    @post @route("/my/submissions/{id}/submit") @useAuth(GmsOAuth<["requirements:write"]> | UserSession)
    op submitSubmission(@path id: GmsId): OkT<Submission> | PendingApproval | BadRequest | AuthErrors | NotFound | Conflict;

    /** Share an accepted submission with another funder workspace, by consent. */
    @post @route("/my/submissions/{id}/share") @useAuth(GmsOAuth<["requirements:write"]> | UserSession)
    op shareSubmission(@path id: GmsId, @body body: ShareSubmissionRequest): CreatedT<Submission> | BadRequest | AuthErrors | NotFound | Conflict;

    @get @route("/my/answers") @useAuth(GmsOAuth<["library:read"]> | UserSession)
    op listAnswers(...PageParams): PaginatedT<Answer> | AuthErrors;

    @post @route("/my/answers") @useAuth(GmsOAuth<["library:write"]> | UserSession)
    op createAnswer(@body body: AnswerInput): CreatedT<Answer> | BadRequest | AuthErrors;

    @patch @route("/my/answers/{id}") @useAuth(GmsOAuth<["library:write"]> | UserSession)
    op updateAnswer(@path id: string, @body body: MergePatch): OkT<Answer> | BadRequest | AuthErrors | NotFound;

    @post @route("/my/answers/{id}/adapt") @useAuth(GmsOAuth<["library:read", "assist"]> | UserSession)
    op adaptAnswer(@path id: string, @body body: AssistRequest): OkT<AssistDraft> | BadRequest | AuthErrors | NotFound;

    /** Which funders may read which of the applicant's data. */
    @get @route("/my/consents") @useAuth(UserSession)
    op listConsents(...PageParams): PaginatedT<Consent> | AuthErrors;

    @delete @route("/my/consents/{id}") @useAuth(UserSession)
    op revokeConsent(@path id: string): NoContentResponse | AuthErrors | NotFound;

    @get @route("/my/funders") @useAuth(UserSession)
    op myFunders(...PageParams): PaginatedT<Workspace> | AuthErrors;
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
