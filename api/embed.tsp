import "@typespec/http";
import "@common-grants/core";
import "./models.tsp";
import "./routes.tsp";

using TypeSpec.Http;
using CommonGrants.Responses;
using GMS.Models;
using GMS.Errors;
using GMS.HttpResponses;

// The embeddable apply widget (v1.7.0): the data behind `/embed/f/{handle}/o/{slug}`, a small
// card a funder pastes into its own site. Public, published fields only, like the funder pages.

namespace GMS.Models {
  /** What the apply widget shows: the call, its funder, and whether it is taking applications. */
  model EmbedWidget {
    funder: {
      handle: string;

      /** The Passport legal name for a Passport-linked funder, else the workspace's name. */
      name: string;

      brand: {
        logoUrl: string | null;
        accent: string | null;
        onAccent: string | null;
      };

      /** True only for a funder whose organization comes from Passport; a self-declared one is never presented as verified. */
      verified: boolean;
    };
    opportunity: {
      slug: string;
      title: string;
      status: "forecasted" | "open" | "closed";
      closeDate: {
        name: string;
        date: plainDate;
      } | null;
      opensDate: plainDate | null;
      acceptedApplicantTypes: string[];

      /** Up to three of the eligibility rules' plain-language labels */
      eligibility: string[];

      /** How many more labels the opportunity page lists */
      moreEligibility: int32;
    };

    /** An open opportunity with an open competition: the widget offers Apply only then. */
    acceptingApplications: boolean;

    /** The funder's "Powered by OpenGrants Grant Management System" setting (on unless turned off). */
    poweredBy: boolean;

    links: {
      /** The public opportunity page, where Apply leads */
      page: url;
    };
  }
}

namespace GMS.Routes.Custom {
  @tag("Public pages")
  namespace Embed {
    /** Published data behind the embeddable apply widget. No token; published fields only. */
    @summary("Apply widget data")
    @get
    @route("/public/embed/funders/{handle}/opportunities/{slug}")
    op embedWidget(@path handle: string, @path slug: string): OkT<EmbedWidget> | NotFound;
  }
}
