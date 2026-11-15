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

// v1.7.0: invite someone into a draft, and the AI summary on the funder's review screen.
//
// An invitation into a draft is sent by a workspace admin's own click (never an agent or API
// client), once: there are no reminders, and an address with an invitation still waiting is not
// sent another. The invited person joins as a `consultant`, the least privileged applicant role
// that can edit answers, scoped to that one draft, and is assigned the question or section on
// acceptance. Addresses are masked in responses and in the ledger. A workspace creates at most 20
// invitations in a rolling day, from this route and Team & access together (429 `invitation_limit`).
//
// The AI summary is written by the `summarize` assist on the first request and kept per
// application and response version, so every reviewer of that version reads the same one and the
// monthly quota is spent once. It describes; it never scores, ranks, recommends or decides.

namespace GMS.Models {
  /** The draft an invitation is for: an outside application (optionally one question) or a built-in application (optionally one section of one form). */
  model DraftRef {
    kind: "outside_application" | "application";

    /** The outside application's UUID, or the built-in application's id (`app_…` or its UUID). */
    id: string;

    /** Outside applications: the question to assign. */
    questionId?: CommonGrants.Types.uuid;

    /** Built-in applications: the form the section belongs to (`frm_…`). */
    formId?: string;

    /** Built-in applications: the section to assign, as the editor names it. */
    section?: string;
  }

  /** The draft as the API names it. */
  model DraftLocation {
    kind: "outside_application" | "application";
    id: string;
    questionId: CommonGrants.Types.uuid | null;
    formId: string | null;
    section: string | null;
  }

  model DraftInvitationInput {
    /** The person's address, typed by the admin. No address book is read. */
    email: string;

    draft: DraftRef;
  }

  /** An invitation into a draft, as its sender sees it. */
  model DraftInvitation {
    id: CommonGrants.Types.uuid;

    /** Masked: the first character and the domain. */
    email: string;

    /** Always `consultant`, scoped to the draft. */
    role: MemberRole;

    draft: DraftLocation;
    expiresAt: utcDateTime;

    /** False when the email could not be sent; `acceptUrl` then holds the link to pass on. */
    emailed: boolean;

    acceptUrl: url | null;
  }

  model PendingDraftInvitation {
    id: CommonGrants.Types.uuid;

    /** Masked. */
    email: string;

    draft: DraftLocation;
    expiresAt: utcDateTime;
    createdAt: utcDateTime;
  }

  /** Invitations into one draft still waiting, and whether the caller may send one. */
  model DraftInvitationList {
    invitations: PendingDraftInvitation[];

    /** The caller is a person with a role that may invite (workspace admins). */
    canInvite: boolean;

    perDay: int32;
    remainingToday: int32;
  }

  /** Where an accepted invitation into a draft lands. */
  model DraftLanding {
    ...DraftLocation;

    /** The question or section was assigned to the person (false when someone else already had it). */
    assigned: boolean;
  }

  /** `POST /gms/invitations/accept`. */
  model InvitationAccepted {
    workspace: Workspace;

    /** The member's role in the workspace (their existing role when they were already a member). */
    role: MemberRole;

    /** For an invitation into a draft, where to open it; null otherwise. */
    draft: DraftLanding | null;
  }

  /** One-time notes a member can dismiss. */
  union NoteKey {
    inviteTeammate: "invite_teammate",
  }

  model DismissedNotes {
    dismissed: NoteKey[];
  }

  model DismissNoteInput {
    note: NoteKey;
  }

  /** The AI summary's own fields. Never a score or a recommendation. */
  model AiSummaryContent {
    summary: string;
    strengths: string[];
    openQuestions: string[];
    quotes: AssistQuote[];
    fromExternalSystems: {
      server: string;
      note: string;
    }[];
    cautions: string[];
  }

  /** The AI summary panel: the summary kept for this application and response version, or null before the first request. */
  model AiSummary {
    draft: true;
    applicationId: GmsId;

    /** SHA-256 (hex) of what the assistant reads of the application as the caller may see it. */
    responseVersion: string;

    /** "Review before relying on it". */
    label: string;

    /** True when this summary was written earlier (no call was made, nothing counted). */
    cached: boolean;

    generatedAt: utcDateTime | null;
    `model`: string | null;
    summary: AiSummaryContent | null;
    quota: AssistQuota;
  }
}

namespace GMS.Routes.Custom {
  @tag("Invitations")
  namespace DraftInvitations {
    /**
     * Invite someone by email into a draft. A workspace admin's own click only: agents and API
     * clients are refused (403 `human_only`), whatever they hold. Sends one transactional email.
     * 409 `already_member` when the address is on the team, 409 `already_invited` while an
     * invitation to it is waiting (nothing is sent again), 409 `application_locked` when the
     * application is no longer being written, 429 `invitation_limit` after 20 in a rolling day.
     */
    @post @route("/draft-invitations") @useAuth(UserSession)
    op create(@body body: DraftInvitationInput): CreatedT<DraftInvitation> | BadRequest | AuthErrors | NotFound | Conflict | TooManyRequests;

    /** Invitations into this draft still waiting, addresses masked. Not for consultants. */
    @get @route("/draft-invitations") @useAuth(GmsOAuth<["applications:read"]> | UserSession)
    op list(@query kind: "outside_application" | "application", @query id: string): OkT<DraftInvitationList> | BadRequest | AuthErrors | NotFound;

    /** The one-time notes the signed-in person dismissed in this workspace. */
    @get @route("/me/notes") @useAuth(UserSession)
    op notes(): OkT<DismissedNotes> | AuthErrors;

    /** Never show this note to this person in this workspace again. */
    @post @route("/me/notes/dismiss") @useAuth(UserSession)
    op dismissNote(@body body: DismissNoteInput): OkT<DismissedNotes> | BadRequest | AuthErrors;
  }

  @tag("Assistant")
  namespace AiSummaries {
    /** The AI summary kept for this application's current response version, or `summary: null`. Never calls the model. 404 `assistant_disabled` when the assistant is off. */
    @get @route("/assist/summary") @useAuth(GmsOAuth<["assist"]> | UserSession)
    op get(@query applicationId: GmsId): OkT<AiSummary> | BadRequest | AuthErrors | NotFound;

    /** Write the AI summary on the first request (one call against the quota), or return the one kept for this version (no call). 404 `assistant_disabled`; 429 `assist_quota_exhausted` only when none is kept. */
    @post @route("/assist/summary") @useAuth(GmsOAuth<["assist"]> | UserSession)
    op generate(@body body: SummarizeRequest): OkT<AiSummary> | BadRequest | AuthErrors | NotFound | TooManyRequests;
  }
}
