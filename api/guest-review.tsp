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

// The guest reviewer loop (C4). An external reviewer, invited per competition, joins with the
// emailed code and lands on a welcome; after their last assigned review they see a done screen
// that offers, once, a free review panel for their own organization. A person only, an
// `external_reviewer` of the funder workspace named in X-GMS-Workspace (403 `insufficient_role`
// for anyone else); no MCP tool. The offer's events are kept with no workspace: no funder reads them.

namespace GMS.Models {
  model GuestFunder {
    name: string;
    handle: string;
  }

  model GuestCompetition {
    id: GmsId;
    title: string;
    opportunityTitle: string | null;

    /** Applications assigned to the reviewer here, recusals left out. */
    assigned: int32;

    submitted: int32;
    open: int32;

    /** The earliest due date of an open review (of any, when none is open); null when none is set. */
    dueAt: utcDateTime | null;
  }

  model GuestWelcome {
    funder: GuestFunder;
    competitions: GuestCompetition[];
    assigned: int32;
    submitted: int32;
    open: int32;
    dueAt: utcDateTime | null;
    coi: {
      note: string;

      /** Where the reviewer declares conflicts (and signs a conflict-of-interest policy when the funder has one). */
      link: string;
    };

    /** The reviewer portal, in this funder's workspace. */
    startUrl: string;

    /** Every assigned review is submitted. */
    done: boolean;
  }

  /** A name and handle from the reviewer's email domain, only ever a suggestion; null for a shared mail provider. */
  model PanelSuggestion {
    domain: string;
    name: string;
    handle: string;
  }

  model GuestDone {
    funder: GuestFunder;
    done: boolean;
    submitted: int32;
    assigned: int32;
    open: int32;
    offer: {
      /** Once every review is in, unless the person was shown it before, dismissed it, took it, or already runs a funder workspace. */
      show: boolean;

      suggestion: PanelSuggestion | null;
    };
  }

  /** `created` names the funder workspace the person just made with funder setup (`POST /gms/workspaces`). */
  model PanelOfferEventInput {
    event: "shown" | "clicked" | "dismissed" | "created";
    workspaceId?: CommonGrants.Types.uuid;
  }

  model PanelOfferEventResult {
    event: "shown" | "clicked" | "dismissed" | "created";

    /** False when this person's event was already counted. */
    counted: boolean;
  }
}

namespace GMS.Routes.Custom {
  @tag("Reviews")
  namespace GuestReview {
    /** The guest reviewer's welcome: the funder, the competition, how many applications, the due date, the conflict-of-interest note and where to start. */
    @get @route("/guest-review/welcome") @useAuth(UserSession)
    op welcome(): OkT<GuestWelcome> | AuthErrors;

    /** The done screen: whether every assigned review is in, and the one-time offer. */
    @get @route("/guest-review/done") @useAuth(UserSession)
    op done(): OkT<GuestDone> | AuthErrors;

    /** Count one event of the offer. 422 `not_your_new_workspace` when `created` names a workspace the person did not just set up. */
    @post @route("/guest-review/offer") @useAuth(UserSession)
    op offer(@body body: PanelOfferEventInput): OkT<PanelOfferEventResult> | BadRequest | AuthErrors | Unprocessable;
  }
}
