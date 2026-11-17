import "@typespec/http";
import "@common-grants/core";
import "./models.tsp";
import "./routes.tsp";
import "./switch.tsp";
import "./importer-adapters.tsp";

using TypeSpec.Http;
using CommonGrants.Responses;
using GMS.Models;
using GMS.Auth;
using GMS.Errors;
using GMS.HttpResponses;

// Funder loops (E4, docs/loops.md): how funders hear of the GMS from the people already on it.
//   - A funder admin invites a peer funder: one email, previewed, at most five a week per
//     workspace, never twice to one address, never a reminder. A person only: agent and
//     API-client tokens get 403 `human_only`, and no MCP tool sends one.
//   - The send-to-funder package's footer links to "for funders" (`/for-funders?ref=`): the
//     applicant's region and how many organizations there keep their applications here (only from
//     ten, never a name).
//   - An intermediary (two or more funds) has a co-branded onboarding link for its funds'
//     grantees and affiliated funders, and may be listed in the partner directory once an operator
//     approves (DIRECTORY_MODERATORS, else GALLERY_MODERATORS). Changes are an admin's, in person.
//   - A workspace made from an invitation or a link is counted once, by its id.
//   - The applicant's reusable profile: the organization facts every funder they apply to sees.

namespace GMS.Models {
  /** What the "for funders" page says about the applicant's link; null when the link is unknown or turned off. */
  model ForFundersRef {
    /** The applicant's region (a US state by its name); null when its profile gives none. */
    region: {
      name: string;
    } | null;

    /** Organizations in that region that keep their applications here; null below `floor`, so a small number is never shown. */
    organizations: int32 | null;
  }

  model ForFundersInvitation {
    funder: {
      name: string;
      handle: string;
    };

    /** The name on the inviting admin's account; null when it is not known. */
    inviter: string | null;
  }

  model ForFundersPage {
    ref: ForFundersRef | null;
    invitation: ForFundersInvitation | null;

    /** The fewest organizations counted out loud. */
    floor: int32;
  }

  model PeerInviteInput {
    @maxLength(320) email: string;

    /** The admin's own words above the invitation. No links or email addresses (422 `note_has_link`). */
    @maxLength(500) note?: string;
  }

  model PeerInviteSendInput {
    ...PeerInviteInput;

    /** The link token the preview made. */
    @pattern("^gms_pi_[A-Za-z0-9_-]{43}$") token: string;

    /** The preview's digest: 409 `preview_changed` when the email would differ. */
    @pattern("^[0-9a-f]{64}$") digest: string;
  }

  model PeerInvitePreview {
    from: string;
    to: string;
    replyTo: string;
    subject: string;
    text: string;
    html: string;
    locale?: "en" | "es";
    token: string;
    digest: string;
    perWeek: int32;
    remainingThisWeek: int32;

    /** This workspace invited the address before: sending would be refused (409 `already_invited`). */
    alreadyInvited: boolean;
  }

  union PeerInvitationStatus {
    notSent: "not_sent",
    sent: "sent",
    joined: "joined",
  }

  model PeerInvitation {
    id: CommonGrants.Types.uuid;

    /** Masked: the first character and the domain. */
    to: string;

    status: PeerInvitationStatus;
    sentAt: utcDateTime | null;

    /** Funder workspaces made from this invitation's link. */
    joinedCount: int32;

    firstJoinedAt: utcDateTime | null;
    createdAt: utcDateTime;
  }

  model PeerInvitationList {
    items: PeerInvitation[];
    perWeek: int32;
    remainingThisWeek: int32;
    joined: int32;
    canInvite: boolean;
    reason: string | null;
  }

  model PeerInviteSent {
    sent: true;
    invitation: PeerInvitation;
    remainingThisWeek: int32;
  }

  model ReferralClaimInput {
    workspaceId: CommonGrants.Types.uuid;
    source: "invite" | "package" | "onboarding";
    @maxLength(80) token: string;
  }

  model ReferralClaimResult {
    counted: boolean;
    reason: "counted" | "already_counted" | "unknown_link" | "own_link";
  }

  model OnboardingLogo {
    url: url;
    alt: string;
  }

  model OnboardingLink {
    token: string;
    url: url;
    logo: OnboardingLogo | null;

    /** Workspaces made from this link. */
    joined: int32;

    createdAt: utcDateTime;
  }

  union DirectoryListingStatus {
    pending: "pending",
    approved: "approved",
    rejected: "rejected",
    withdrawn: "withdrawn",
  }

  model DirectoryListing {
    status: DirectoryListingStatus;
    region: string;
    submittedAt: utcDateTime;
    decidedAt: utcDateTime | null;

    /** The moderator's reason, for a declined listing. */
    decisionReason: string | null;

    withdrawnAt: utcDateTime | null;
  }

  model PartnerSettings {
    /** The workspace runs at least `minFunds` funds besides its default fund. */
    eligible: boolean;

    minFunds: int32;
    funds: {
      id: CommonGrants.Types.uuid;
      name: string;
    }[];
    link: OnboardingLink | null;
    listing: DirectoryListing | null;

    /** False for an API client: it reads, a person changes. */
    canChange: boolean;
  }

  model OnboardingLogoInput {
    mime: "image/png" | "image/jpeg" | "image/webp";

    /** The image, base64, up to 256 KB (413 `logo_too_large`; 422 `logo_not_an_image`). */
    contentBase64: string;

    /** What the logo shows, read aloud by screen readers. */
    @minLength(1) @maxLength(200) alt: string;
  }

  model OnboardingLogoAltInput {
    @minLength(1) @maxLength(200) alt: string;
  }

  model DirectoryListingInput {
    /** Where the intermediary works, as it would like it shown. */
    @minLength(2) @maxLength(100) region: string;
  }

  model DirectoryRejectInput {
    @minLength(3) @maxLength(2000) reason: string;
  }

  model OnboardingPage {
    intermediary: {
      name: string;
      handle: string;
      verification: Verification;
    };

    /** Its funds' names (the default fund is never named). */
    funds: string[];

    logo: OnboardingLogo | null;
  }

  model PartnerCard {
    name: string;
    handle: string;
    region: string;

    /** Funds besides the default. */
    funds: int32;

    /** The intermediary's public page. */
    page: url;

    verification: Verification;
  }

  model DirectoryModeratorStatus {
    moderator: boolean;
  }

  model DirectoryQueueItem {
    id: CommonGrants.Types.uuid;
    ...DirectoryListing;
    partner: {
      name: string;
      handle: string;
      verification: Verification;
    } | null;
    funds: int32;

    /** The workspace still runs enough funds to be listed. */
    eligible: boolean;
  }

  model DirectoryDecision {
    id: CommonGrants.Types.uuid;
    ...DirectoryListing;
  }

  union FunderSeenField {
    legalName: "legalName",
    ein: "ein",
    orgType: "orgType",
    address: "address",
    email: "email",
    website: "website",
    mission: "mission",
  }

  model ReusableProfile {
    source: ProfileSource;
    level: VerificationLevel | null;

    /** True only for a Passport record. */
    verified: boolean;

    /** The fields a funder sees when the organization applies, in order; `value` null where none is given. */
    fields: {
      key: FunderSeenField;
      value: string | null;
    }[];

    /** Where a Passport record is edited (Passport); null otherwise. */
    editUrl: url | null;

    /** Where a self-declared profile is edited in the GMS; null for a Passport record. */
    editPath: string | null;

    /** Where to verify with Passport; null once verified. */
    verifyPath: string | null;

    selfDeclared: boolean;
  }

  model ImageFile {
    @statusCode statusCode: 200;
    @header contentType: "image/png" | "image/jpeg" | "image/webp";
    @body body: bytes;
  }
}

namespace GMS.Routes.Custom {
  @tag("Funder loops")
  namespace FunderLoops {
    /** Data for `/for-funders`: with `ref`, the applicant's region and aggregate count; with `invite`, who invited the funder. Unknown links read as none. No token. */
    @get @route("/public/for-funders")
    op forFunders(@query ref?: string, @query invite?: string): OkT<ForFundersPage>;

    /** The partner directory: approved intermediaries that still run enough funds, by name. No token. */
    @get @route("/public/partners")
    op partners(): PaginatedT<PartnerCard>;

    /** An intermediary's co-branded onboarding page. 404 for a turned-off link, or one whose workspace no longer runs enough funds. No token. */
    @get @route("/public/join/{token}")
    op onboardingPage(@path token: string): OkT<OnboardingPage> | NotFound;

    /** The intermediary's logo for that page. No token. */
    @get @route("/public/join/{token}/logo")
    op onboardingLogo(@path token: string): ImageFile | NotFound;

    /** Count the workspace the person just made for the link they came from. A person only, for a workspace they admin, made within the hour (422 `not_your_new_workspace`). */
    @post @route("/referrals/claim") @useAuth(UserSession)
    op claim(@body body: ReferralClaimInput): OkT<ReferralClaimResult> | BadRequest | AuthErrors | Unprocessable;

    /** The workspace's peer invitations, newest first, with masked addresses. Funder admins; API clients with `workspace:admin` read. */
    @get @route("/peer-invitations") @useAuth(GmsOAuth<["workspace:admin"]> | UserSession)
    op listPeerInvitations(): OkT<PeerInvitationList> | AuthErrors;

    /** Exactly the email that would be sent. Nothing is sent or counted. Funder admins, in person (403 `human_only` for agents and API clients). 422 `note_has_link`, `invite_yourself`; 503 `mail_not_configured`. */
    @post @route("/peer-invitations/preview") @useAuth(UserSession)
    op previewPeerInvite(@body body: PeerInviteInput): OkT<PeerInvitePreview> | BadRequest | AuthErrors | Unprocessable | ServiceUnavailable;

    /** Send the invitation if it is still exactly the preview. Once per address (409 `already_invited`), five a week (429 `too_many_peer_invites`). */
    @post @route("/peer-invitations") @useAuth(UserSession)
    op sendPeerInvite(@body body: PeerInviteSendInput): OkT<PeerInviteSent> | BadRequest | AuthErrors | Conflict | Unprocessable | TooManyRequests | BadGateway | ServiceUnavailable;

    /** Whether the workspace is an intermediary, its onboarding link and its directory listing. Funder admins; API clients with `workspace:admin` read. */
    @get @route("/partner-settings") @useAuth(GmsOAuth<["workspace:admin"]> | UserSession)
    op partnerSettings(): OkT<PartnerSettings> | AuthErrors;

    /** Make the onboarding link (the same one when it exists). 409 `not_an_intermediary` below two funds. In person. */
    @post @route("/partner-settings/onboarding-link") @useAuth(UserSession)
    op createOnboardingLink(): OkT<PartnerSettings> | AuthErrors | Conflict;

    /** A new link in place of the old, which stops working at once. In person. */
    @post @route("/partner-settings/onboarding-link/replace") @useAuth(UserSession)
    op replaceOnboardingLink(): OkT<PartnerSettings> | AuthErrors | NotFound | Conflict;

    /** Turn the onboarding link off. In person. */
    @delete @route("/partner-settings/onboarding-link") @useAuth(UserSession)
    op revokeOnboardingLink(): OkT<PartnerSettings> | AuthErrors | NotFound;

    /** Upload the logo shown on the onboarding page, with its alt text. In person. */
    @put @route("/partner-settings/onboarding-link/logo") @useAuth(UserSession)
    op putOnboardingLogo(@body body: OnboardingLogoInput): OkT<PartnerSettings> | BadRequest | AuthErrors | NotFound | PayloadTooLarge | Unprocessable | ServiceUnavailable;

    /** Change the logo's alt text. In person. */
    @patch(#{ implicitOptionality: false }) @route("/partner-settings/onboarding-link/logo") @useAuth(UserSession)
    op putOnboardingLogoAlt(@body body: OnboardingLogoAltInput): OkT<PartnerSettings> | BadRequest | AuthErrors | NotFound;

    /** Remove the logo. In person. */
    @delete @route("/partner-settings/onboarding-link/logo") @useAuth(UserSession)
    op removeOnboardingLogo(): OkT<PartnerSettings> | AuthErrors | NotFound;

    /** Ask to be listed in the partner directory (or again after withdrawing or a decline). In person. 409 `listing_pending`, `already_listed`, `not_an_intermediary`. */
    @put @route("/partner-settings/listing") @useAuth(UserSession)
    op requestListing(@body body: DirectoryListingInput): OkT<DirectoryListing> | BadRequest | AuthErrors | Conflict;

    /** Leave the directory, or the queue, at once. In person. */
    @post @route("/partner-settings/listing/withdraw") @useAuth(UserSession)
    op withdrawListing(): OkT<DirectoryListing> | AuthErrors | NotFound | Conflict;

    /** Whether the signed-in person moderates the partner directory. */
    @get @route("/partners/moderation/me") @useAuth(UserSession)
    op directoryModerator(): OkT<DirectoryModeratorStatus> | AuthErrors;

    /** Pending listings, oldest first. Moderators only (403 `not_a_directory_moderator`). */
    @get @route("/partners/moderation/queue") @useAuth(UserSession)
    op directoryQueue(): PaginatedT<DirectoryQueueItem> | AuthErrors;

    @post @route("/partners/moderation/listings/{id}/approve") @useAuth(UserSession)
    op approveListing(@path id: CommonGrants.Types.uuid): OkT<DirectoryDecision> | AuthErrors | NotFound | Conflict;

    /** Decline with a reason the intermediary reads. */
    @post @route("/partners/moderation/listings/{id}/reject") @useAuth(UserSession)
    op rejectListing(@path id: CommonGrants.Types.uuid, @body body: DirectoryRejectInput): OkT<DirectoryDecision> | BadRequest | AuthErrors | NotFound | Conflict;

    /** The applicant's organization facts as every funder they apply to sees them, how far they are verified, and where to edit or verify them. */
    @get @route("/reusable-profile") @useAuth(GmsOAuth<["org:read"]> | UserSession)
    op reusableProfile(): OkT<ReusableProfile> | AuthErrors;
  }
}
