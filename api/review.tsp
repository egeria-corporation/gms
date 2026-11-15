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

// Review parity (v1.8.0): a competition-wide conflict-of-interest policy every reviewer signs
// before any application in the competition opens for them, the conflicts register, anonymized
// review as a per-stage setting, and the board docket PDF for the decision meeting.
//
// A reviewer signs in person: an agent or API client token is refused, and no MCP tool signs.
// Anonymized review is applied in the service layer, so every route a reviewer reaches (the inbox,
// application detail, the CommonGrants routes, assignments, reviews, MCP tools and resources, the
// assistant's context) gives the same view. Staff always see everything.

namespace GMS.Models {
  /** Set on an application or assignment when the caller reviews in a stage with anonymized review. */
  model AnonymizedApplicant {
    /** The application's stable short code in its competition, e.g. `A-1042`; it shows as "Applicant A-1042". */
    code: string;
  }

  model CoiPolicy {
    competitionId: PrefixedId;
    competitionTitle: string;

    /** The version reviewers sign now. Version 1 is the plain-language default until the funder writes its own. */
    version: int32;

    text: string;

    /** True while the text is the plain-language default. */
    isDefault: boolean;

    updatedAt: utcDateTime | null;

    /** Reviewers sign before anything in the competition opens for them. True for new competitions; false for competitions that existed before v1.8.0 until the funder turns it on. */
    required: boolean;

    /** The caller has signed this version. */
    signed: boolean;

    /** The caller's latest signature in this competition, of any version. */
    mySignature: CoiSignature | null;
  }

  model DeclaredOrg {
    name: string;
    website?: string;
  }

  model CoiSignature {
    policyVersion: int32;
    signedName: string;
    signedAt: utcDateTime;

    /** Signed against the policy as it stands now. */
    current: boolean;

    /** The organizations the reviewer declared a conflict with, as they typed them. Whether any applied is never said to the reviewer. */
    declared: DeclaredOrg[];
  }

  model CoiSigned {
    ...CoiSignature;
    competitionId: PrefixedId;

    /** True when this version was already signed (200); the declared organizations are the first signature's. */
    alreadySigned: boolean;
  }

  /** The funder's own text, or `{ useDefault: true }` to go back to the plain-language default. A change is a new version: reviewers who signed an earlier one sign again. */
  /** `text` or `useDefault` writes a new version; `required` turns signing on or off (a signed-in person only: 403 `human_only` for an agent or API client). At least one. */
  model CoiPolicyInput {
    text?: string;
    useDefault?: true;
    required?: boolean;
  }

  model CoiSignInput {
    /** The version the reviewer read. 409 `policy_changed` when the policy changed meanwhile. */
    policyVersion: int32;

    /** The reviewer's name, typed. */
    signedName: string;

    agree: true;

    /** Organizations the reviewer has a conflict with (at most 50). Matched to applicants by name or website; the match feeds the assignment exclusion and recuses existing assignments. */
    conflicts?: DeclaredOrg[];
  }

  model RegisterDeclaredOrg {
    ...DeclaredOrg;

    /** The applicant organizations it matched. */
    matches: {
      workspaceId: CommonGrants.Types.uuid;
      name: string;
    }[];
  }

  model RegisterSignature {
    policyVersion: int32;
    signedName: string;
    signedAt: utcDateTime;
    current: boolean;
    declared: RegisterDeclaredOrg[];
  }

  model RegisterReviewer {
    userId: CommonGrants.Types.uuid;
    name: string | null;
    email: string | null;
    role: string | null;

    /** Signed the current version. */
    signed: boolean;

    /** The latest signature, of any version, with the applicants each declared organization matched. */
    signature: RegisterSignature | null;

    assigned: int32;
  }

  model RegisterRecusal {
    assignmentId: CommonGrants.Types.uuid;
    reviewerUserId: CommonGrants.Types.uuid;
    reviewerName: string | null;
    applicationId: PrefixedId;
    applicationTitle: string;
    applicant: string | null;
    stage: string;

    /** Declared on the assignment, declared when signing the policy, or recused by the reviewer or staff. */
    source: "declared_conflict" | "declared_at_signing" | "recused";

    reason: string | null;
    at: utcDateTime;
  }

  /** Who signed the competition's conflict-of-interest policy and when, the conflicts declared, and every recusal with its reason. */
  model ConflictsRegister {
    competitionId: PrefixedId;
    competitionTitle: string;
    policy: {
      version: int32;
      isDefault: boolean;
      updatedAt: utcDateTime | null;
    };
    counts: {
      reviewers: int32;
      signed: int32;
      declared: int32;
      recusals: int32;
    };
    reviewers: RegisterReviewer[];
    recusals: RegisterRecusal[];
  }

  model StageReviewSettings {
    key: string;
    label: string;

    /** Reviewers in the stage do not see who applied. Off by default. */
    anonymized: boolean;

    /** Whether reviewers see each other's scores: never before the panel (blind), after submitting their own, or always. */
    reviewMode: "blind" | "see_after_submit" | "open";

    panelOpen: boolean;
    rubricId: CommonGrants.Types.uuid | null;
  }

  model ReviewSettings {
    competitionId: PrefixedId;
    stages: StageReviewSettings[];
  }

  model ReviewSettingsInput {
    stage: string;
    anonymized?: boolean;
    reviewMode?: "blind" | "see_after_submit" | "open";
    panelOpen?: boolean;
  }

  model DocketRequest {
    /** A picked set of applications (at most 200); the whole stage when absent. */
    applicationIds?: GmsId[];

    /** Defaults to the competition's first stage. */
    stage?: string;

    /** Reviewers' comments marked funder-only are left out unless this is true. */
    includeFunderOnlyComments?: boolean = false;
  }

  /** A board docket kept in the workspace's private exports. */
  model Docket {
    docketId: CommonGrants.Types.uuid;
    competitionId: PrefixedId;
    applications: int32;
    includeFunderOnlyComments: boolean;
    bytes: int32;
    sha256: string;
    createdAt: utcDateTime;

    /** `GET` it with the same credentials. */
    downloadPath: string;
  }

  // The register's CSV answers with `CsvFile` (outside.tsp).
}

namespace GMS.Routes.Custom {
  @tag("Review parity")
  namespace ReviewParity {
    /** The conflict-of-interest policy reviewers sign for a competition. Staff and the competition's reviewers. */
    @get @route("/competitions/{id}/coi-policy") @useAuth(GmsOAuth<["reviews:read"]> | UserSession)
    op readCoiPolicy(@path id: GmsId): OkT<CoiPolicy> | AuthErrors | NotFound;

    /** Write the policy or go back to the default, and turn signing on or off. Program staff. */
    @put @route("/competitions/{id}/coi-policy") @useAuth(GmsOAuth<["reviews:write"]> | UserSession)
    op writeCoiPolicy(@path id: GmsId, @body body: CoiPolicyInput): OkT<CoiPolicy> | BadRequest | AuthErrors | NotFound;

    /** The reviewer signs the policy, in person (a session, never an agent or API client token). 201 when signed, 200 when this version was already signed. */
    @post @route("/competitions/{id}/coi-policy/sign") @useAuth(UserSession)
    op signCoiPolicy(@path id: GmsId, @body body: CoiSignInput): CreatedT<CoiSigned> | OkT<CoiSigned> | BadRequest | AuthErrors | NotFound | Conflict;

    /** The conflicts register. Program staff, observers and auditors. */
    @get @route("/competitions/{id}/conflicts-register") @useAuth(GmsOAuth<["reviews:read"]> | UserSession)
    op conflictsRegister(@path id: GmsId): OkT<ConflictsRegister> | AuthErrors | NotFound;

    /** The conflicts register as CSV: one line per signature, declared organization and recusal. */
    @get @route("/competitions/{id}/conflicts-register.csv") @useAuth(GmsOAuth<["reviews:read"]> | UserSession)
    op conflictsRegisterCsv(@path id: GmsId): CsvFile | AuthErrors | NotFound;

    @get @route("/competitions/{id}/review-settings") @useAuth(GmsOAuth<["reviews:read"]> | UserSession)
    op readReviewSettings(@path id: GmsId): OkT<ReviewSettings> | AuthErrors | NotFound;

    /** One stage's review settings, at any time. Turning anonymized review off shows reviewers who applied from then on. Program staff. */
    @put @route("/competitions/{id}/review-settings") @useAuth(GmsOAuth<["reviews:write"]> | UserSession)
    op writeReviewSettings(@path id: GmsId, @body body: ReviewSettingsInput): OkT<ReviewSettings> | BadRequest | AuthErrors | NotFound | Unprocessable;

    /** Build the board docket PDF and keep it in the workspace's private exports. Program staff. 503 `exports_unavailable` without export storage. */
    @post @route("/competitions/{id}/dockets") @useAuth(GmsOAuth<["reviews:read"]> | UserSession)
    op createDocket(@path id: GmsId, @body body: DocketRequest): CreatedT<Docket> | BadRequest | AuthErrors | NotFound | Conflict | Unprocessable | ServiceUnavailable;

    /** Download a docket. Program staff of the workspace that made it. */
    @get @route("/competitions/{id}/dockets/{docketId}") @useAuth(GmsOAuth<["reviews:read"]> | UserSession)
    op downloadDocket(@path id: GmsId, @path docketId: CommonGrants.Types.uuid): Pdf | AuthErrors | NotFound;
  }
}
