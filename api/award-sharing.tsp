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

// Award sharing (v1.9.0): the grants a funder has awarded on its public page, each award's page,
// a "Funded by" badge for the grantee's website, and a share kit (ready-to-edit posts, the link,
// the card image and the badge) for both sides. An award is public only when it is not
// confidential, went to an organization (never an individual), is accepted, active or completed,
// the funder turned on "List awards on my public page" (off by default) and the grantee did not
// choose "Don't list us publicly". Everything public is built from public fields only. Listing,
// confidentiality and the grantee's choice are changed by signed-in people only (403 `human_only`
// for agent and API-client tokens); agents read the share kit with MCP `get_award_share_kit`.

namespace GMS.Models {
  /** Why an award is not public. The first that applies is given, in this order. */
  union AwardNotListedReason {
    /** The funder marked it confidential, or its program makes new awards confidential. */
    confidential: "confidential",

    /** Awards to individuals are never public. */
    individual: "individual",

    /** Offered, suspended or cancelled: only accepted, active and completed awards are listed. */
    notAccepted: "not_accepted",

    /** The funder's workspace is not active. */
    funderUnavailable: "funder_unavailable",

    /** The funder has not turned on "List awards on my public page". */
    listingOff: "listing_off",

    /** The grantee chose "Don't list us publicly". */
    recipientUnlisted: "recipient_unlisted",
  }

  /** A listed award, as the public sees it. */
  model PublicAward {
    /** `{recipient-name}-{token}`: the award page and badge address. Found by its token, so a rename keeps links working. */
    slug: string;

    /** The organization's own name in the GMS (never a Passport record it shares only with its funders). */
    recipient: {
      name: string;
    };

    /** The award's title: what it is for. */
    purpose: string;

    /** The program, else the published opportunity the award came from. */
    program: string | null;

    year: int32;
    awardDate: plainDate;

    /** Null when the funder hides amounts. */
    amount: Money | null;

    links: {
      page: url;

      /** The share card (1200x627 PNG), drawn by the front Worker. */
      image: url;

      /** The "Funded by" badge (SVG). */
      badge: url;
    };
  }

  /** Data for `/f/{handle}/awards`. */
  model FunderAwardsPage {
    funder: PublicFunder;

    /** Newest award date first. */
    awards: PublicAward[];

    /** The award years, newest first, to group by. */
    years: int32[];

    /** The program names, A to Z, to group by. */
    programs: string[];

    amountsShown: boolean;
    links: {
      page: url;
      funder: url;
    };
  }

  /** Data for `/f/{handle}/awards/{slug}`. */
  model AwardPublicPage {
    funder: PublicFunder;
    award: PublicAward;

    /** The funder's workspace is linked to Passport: only then do the badge and card say verified. */
    verified: boolean;

    links: {
      awards: url;
    };
  }

  /** Ready-to-edit posts and the links that go with them. Nothing is posted from the GMS. */
  model AwardShareKit {
    posts: {
      /** LinkedIn length. */
      linkedin: string;

      /** At most 280 characters, the link included. */
      short: string;

      /** A paragraph for a newsletter. */
      newsletter: string;
    };
    links: {
      page: url;

      /** The funder's grants-awarded page. */
      awards: url;

      image: url;
      badge: url;
    };
    badge: {
      verified: boolean;

      /** "Funded by {Funder} · verified", or without "verified" for a funder not linked to Passport. */
      text: string;

      /** An HTML snippet for the grantee's website: the badge, linked to the award page. */
      snippet: string;

      /** The badge itself, as `/badge/{slug}.svg` serves it, for a preview that loads nothing. */
      svg: string;
    };
    award: PublicAward;
  }

  /** What the "Share this award" panel shows, for the funder or the grantee. */
  model AwardSharing {
    listed: boolean;
    reason: AwardNotListedReason | null;
    confidential: boolean;

    /** The grantee chose "Don't list us publicly". */
    recipientUnlisted: boolean;

    /** The funder's "List awards on my public page" setting. */
    listingOn: boolean;

    amountsShown: boolean;

    /** Whether the caller may change this side's switch: funder admins and program officers (confidential), grantee admins (unlisted), signed in. */
    canChange: boolean;

    /** The funder's grants-awarded page, while it lists awards. */
    awardsPage: url | null;

    /** Null while the award is not public. */
    kit: AwardShareKit | null;
  }

  model AwardListingSettings {
    /** "List awards on my public page". Off by default. */
    listAwards: boolean;

    /** Show amounts on the public pages, cards and share kit. On by default. */
    showAmounts: boolean;

    /** The grants-awarded page; it answers 404 while listing is off. */
    awardsPage: url;

    counts: {
      listed: int32;
      confidential: int32;
      recipientUnlisted: int32;
    };

    /** Each program's default for new awards. */
    programs: {
      id: CommonGrants.Types.uuid;
      name: string;
      awardsConfidential: boolean;
    }[];
  }

  model AwardListingSettingsInput {
    listAwards?: boolean;
    showAmounts?: boolean;
  }

  model AwardConfidentialInput {
    confidential: boolean;
  }

  model AwardUnlistedInput {
    /** True: "Don't list us publicly". */
    unlisted: boolean;
  }

  model ProgramAwardSharingInput {
    /** New awards in this program start confidential. Awards already made keep their setting. */
    awardsConfidential: boolean;
  }

  /** The "Funded by" badge. */
  model Svg {
    @statusCode statusCode: 200;
    @header contentType: "image/svg+xml";

    /** Cached for an hour. */
    @header("Cache-Control") cacheControl: string;

    @body body: string;
  }

  /** The same short answer for an award that does not exist, is confidential, unlisted or not yet public. */
  model NeutralNotFound {
    @statusCode statusCode: 404;
    @header contentType: "text/plain";
    @body body: string;
  }
}

namespace GMS.Routes.Custom {
  @tag("Public pages")
  namespace PublicAwards {
    /** Published data behind `/f/{handle}/awards`: the awards the funder lists. 404 while it does not list awards. No token. */
    @summary("Grants-awarded page data")
    @get
    @route("/public/funders/{handle}/awards")
    op funderAwards(@path handle: string): OkT<FunderAwardsPage> | NotFound;

    /** Published data behind `/f/{handle}/awards/{slug}`. The same 404 for an award that does not exist and one that is not public. No token. */
    @summary("Award public page data")
    @get
    @route("/public/funders/{handle}/awards/{slug}")
    op awardPage(@path handle: string, @path slug: string): OkT<AwardPublicPage> | NotFound;

    /** The "Funded by" badge, `{slug}.svg` (the front Worker serves it at `/badge/{slug}.svg`). "verified" only for a funder linked to Passport. No token. */
    @summary("Funded by badge")
    @get
    @route("/public/badges/{file}")
    op badge(@path file: string): Svg | NeutralNotFound;
  }

  @tag("Award sharing")
  namespace AwardSharingRoutes {
    /** The funder's "Share this award" panel: whether the award is public and why not, and the share kit while it is. */
    @get @route("/awards/{id}/sharing") @useAuth(GmsOAuth<["awards:read"]> | UserSession)
    op funderSharing(@path id: GmsId): OkT<AwardSharing> | AuthErrors | NotFound;

    /** Mark an award confidential, or not. Funder admins and program officers, signed in: agent and API-client tokens get 403 `human_only`. */
    @put @route("/awards/{id}/confidential") @useAuth(UserSession)
    op setConfidential(@path id: GmsId, @body body: AwardConfidentialInput): OkT<AwardSharing> | BadRequest | AuthErrors | NotFound | Conflict;

    /** The grantee's "Share this award" panel. */
    @get @route("/my/awards/{id}/sharing") @useAuth(GmsOAuth<["awards:read"]> | UserSession)
    op granteeSharing(@path id: GmsId): OkT<AwardSharing> | AuthErrors | NotFound;

    /** The grantee's "Don't list us publicly", per award. Grantee admins, signed in. */
    @put @route("/my/awards/{id}/listing") @useAuth(UserSession)
    op setUnlisted(@path id: GmsId, @body body: AwardUnlistedInput): OkT<AwardSharing> | BadRequest | AuthErrors | NotFound | Conflict;

    /** The funder's award listing settings, counts and program defaults. Any funder staff. */
    @get @route("/award-sharing/settings") @useAuth(GmsOAuth<["awards:read"]> | UserSession)
    op listingSettings(): OkT<AwardListingSettings> | AuthErrors;

    /** "List awards on my public page" and "Show award amounts". A workspace admin, signed in. */
    @put @route("/award-sharing/settings") @useAuth(UserSession)
    op updateListingSettings(@body body: AwardListingSettingsInput): OkT<AwardListingSettings> | BadRequest | AuthErrors | Conflict;

    /** Whether new awards in a program start confidential. Funder admins and program officers, signed in. */
    @put @route("/programs/{id}/award-sharing") @useAuth(UserSession)
    op setProgramDefault(@path id: CommonGrants.Types.uuid, @body body: ProgramAwardSharingInput): OkT<AwardListingSettings> | BadRequest | AuthErrors | NotFound;
  }
}
