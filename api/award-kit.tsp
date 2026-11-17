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

// The award kit, plus (v1.12.0). The share kit (award-sharing.tsp) gains the portrait card's words,
// a 6-10 page carousel PDF with each page's alt text, a press release with the funder's credit
// wording ("funded by" or "supported by", never "sponsored"), each side's social page to tag (only
// with that side's consent) and the federal share statement (the Stevens Amendment; only once the
// funder entered both the federal amount and its percentage). Social posting (social.tsp) gains
// "Meet our grantees" (a post about a program) and the "Two weeks left" reminder prompt. Every
// change here is a signed-in person's: agent and API-client tokens get 403 `human_only`, and no MCP
// tool makes these changes.

namespace GMS.Models {
  /** An award's federal share, as the funder entered it. */
  model FederalFunding {
    funded: boolean;

    /** Federal dollars, e.g. `80000.00`. */
    amount: string | null;

    /** The federal share of the project's total costs, in percent (above 0, at most 100, two decimals). Never computed. */
    percent: float64 | null;

    /** The federal agency, as the funder named it. */
    source: string | null;

    /** The statement of the federal share of costs, in the request's language; null until both the amount and the percentage are entered. */
    statement: string | null;
  }

  model AwardFederalFunding {
    ...FederalFunding;

    /** Funder admins and program officers, signed in. */
    canChange: boolean;
  }

  /** `PUT /gms/awards/{id}/federal-funding`. Unmarking clears the numbers. */
  model FederalFundingInput {
    federallyFunded: boolean;

    /** Dollars, digits with up to two decimals, more than zero. */
    @pattern("^\\d{1,12}(\\.\\d{1,2})?$")
    amount?: string | null;

    @minValueExclusive(0)
    @maxValue(100)
    percent?: float64 | null;

    @minLength(1)
    @maxLength(200)
    source?: string | null;
  }

  union SocialPagePlatform {
    linkedin: "linkedin",
    facebook: "facebook",
    instagram: "instagram",
    x: "x",
    bluesky: "bluesky",
    threads: "threads",
  }

  /** An organization's page, read from the link it gave. */
  model SocialPage {
    url: url;
    platform: SocialPagePlatform;

    /** What a post writes to tag the page, e.g. `@alder-creek-family-services`. */
    handle: string;
  }

  model SocialTag {
    ...SocialPage;

    /** Whose page it is. */
    name: string;
  }

  union CreditWording {
    fundedBy: "funded_by",
    supportedBy: "supported_by",
  }

  /** A workspace's share-kit settings (`share_kit_profiles`). */
  model ShareKitProfile {
    pageUrl: url | null;
    page: SocialPage | null;

    /** The other side may tag this page. Without it the page is never tagged. A new link needs it again. */
    tagConsent: boolean;

    consentedAt: utcDateTime | null;

    /** A funder's press-release wording. `funded_by` by default; "sponsored" is not a choice. */
    creditWording: CreditWording;

    /** A funder's standard description, for the press release. */
    standardDescription: string | null;

    /** A workspace admin, signed in. */
    canChange: boolean;
  }

  model ShareKitProfileInput {
    /** The https address of the organization's page on LinkedIn (company, school or showcase page), Facebook, Instagram, X, Bluesky or Threads; null removes it (and the consent). */
    @maxLength(300)
    pageUrl?: string | null;

    tagConsent?: boolean;

    /** A funder only (422 `funder_only_setting`). */
    creditWording?: CreditWording;

    /** A funder only. */
    @maxLength(1500)
    standardDescription?: string | null;
  }

  model CarouselPageInfo {
    heading: string;

    /** What a screen reader user is told the page shows. */
    alt: string;
  }

  /** The kit's extras (v1.12.0), built from the award's public fields and what the funder entered for them. */
  model AwardKitExtras {
    /** "Funded by {Funder}" or "Supported by {Funder}", the funder's choice. */
    creditLine: string;

    /** To edit before sending: bracketed parts are for the person to fill in. */
    pressRelease: string;

    /** The statement of the federal share of costs, or null until the funder entered both numbers. */
    federalStatement: string | null;

    carousel: {
      /** 6 to 10 pages of 1080 × 1350, in order. */
      pages: CarouselPageInfo[];

      /** Download it here (signed in). */
      path: string;

      fileName: string;
    };

    /** What the 1080 × 1350 portrait card shows. `amount` is null when the funder hides amounts; the panel hides it until asked. */
    portrait: {
      funder: string;
      recipient: string;
      program: string | null;
      purpose: string;
      year: int32;
      amount: CommonGrants.Fields.Money | null;
      verified: boolean;

      /** The same card at a public address, for a post that takes a portrait image (Instagram, through Zernio); add `?amount=1` to draw the amount, shown only while the funder shows amounts. */
      imageUrl: url;
    };

    /** The other side's page, only when that side gave the link and agreed to be tagged. */
    tags: {
      funder: SocialTag | null;
      grantee: SocialTag | null;
    };
  }

  /** One of a program's awards in a "Meet our grantees" post. */
  model SocialDraftGrantee {
    awardId: GmsId;
    name: string;

    /** The grantee's page handle, only with its consent. */
    tag: string | null;

    line: string;
  }

  model SocialReminderDismissed {
    id: CommonGrants.Types.uuid;
    opportunityId: CommonGrants.Types.uuid;
    dismissed: true;
  }

  /** The carousel PDF, saved by the person under its name. */
  model CarouselPdf {
    @statusCode statusCode: 200;
    @header contentType: "application/pdf";
    @header("Content-Disposition") contentDisposition: string;
    @body body: bytes;
  }
}

namespace GMS.Routes.Custom {
  @tag("Award sharing")
  namespace AwardKitRoutes {
    /** Mark an award federally funded, with the federal amount and percentage (and, optionally, the agency); or unmark it. Funder admins and program officers, signed in (403 `human_only` for tokens). The statement appears in the kit only once both numbers are entered. */
    @put @route("/awards/{id}/federal-funding") @useAuth(UserSession)
    op setFederalFunding(@path id: GmsId, @body body: FederalFundingInput): OkT<AwardSharing> | BadRequest | AuthErrors | NotFound;

    /** The carousel PDF for a public award, from the funder's side. 409 `not_public` for an award that is not listed publicly. */
    @get @route("/awards/{id}/sharing/carousel.pdf") @useAuth(GmsOAuth<["awards:read"]> | UserSession)
    op funderCarousel(@path id: GmsId): CarouselPdf | AuthErrors | NotFound | Conflict;

    /** The carousel PDF for a public award, from the grantee's side. */
    @get @route("/my/awards/{id}/sharing/carousel.pdf") @useAuth(GmsOAuth<["awards:read"]> | UserSession)
    op granteeCarousel(@path id: GmsId): CarouselPdf | AuthErrors | NotFound | Conflict;

    /** The workspace's share-kit settings: its social page, consent to be tagged, and a funder's credit wording and description. Any staff member who reads awards. */
    @get @route("/share-kit/profile") @useAuth(GmsOAuth<["awards:read"]> | UserSession)
    op shareKitProfile(): OkT<ShareKitProfile> | AuthErrors;

    /** Change the share-kit settings. A workspace admin, signed in (403 `human_only` for tokens). 422 `page_url_invalid`, `consent_needs_page`, `funder_only_setting`. */
    @put @route("/share-kit/profile") @useAuth(UserSession)
    op updateShareKitProfile(@body body: ShareKitProfileInput): OkT<ShareKitProfile> | BadRequest | AuthErrors | Unprocessable;
  }

  @tag("Social")
  namespace SocialReminders {
    /** Dismiss a call's "Two weeks left" prompt, for the workspace. A funder admin, signed in (403 `human_only` for tokens). 404 when social posting is not set up. */
    @post @route("/social/reminders/{id}/dismiss") @useAuth(UserSession)
    op dismissReminder(@path id: CommonGrants.Types.uuid): OkT<SocialReminderDismissed> | AuthErrors | NotFound;
  }
}
