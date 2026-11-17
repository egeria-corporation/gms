import "@typespec/http";
import "@common-grants/core";
import "./models.tsp";
import "./routes.tsp";

using TypeSpec.Http;
using CommonGrants.Responses;
using GMS.Models;
using GMS.Auth;
using GMS.Errors;

// F1: live co-editing with presence (docs/co-editing.md). People writing one draft together see
// who else is in it, which question each is in, a soft lock while someone types, and each other's
// saved answers within seconds. The live channel is a private Supabase Realtime channel; Realtime
// admits a session to it only while that session holds a pass from this route (migration 0050:
// RLS policies on realtime.messages). The pass is issued by the check that opens the draft, so the
// channel reaches exactly the people who may read the draft. The channel carries who is present
// and "saved" nudges, never an answer: answers are read through the API.

namespace GMS.Models {
  union PresenceDraftKind {
    application: "application",
    outsideApplication: "outside_application",
  }

  /** The draft to write in: a built-in application (`app_…`) or an outside application (its id). */
  model PresenceDraftRef {
    kind: PresenceDraftKind;
    id: string;
  }

  model PresencePassRequest {
    draft: PresenceDraftRef;
  }

  /** A pass for the signed-in person's session to the draft's private Realtime channel. */
  model PresencePass {
    /** The channel to join, private: `draft:application:<uuid>` or `draft:outside:<uuid>`. */
    topic: string;

    expiresAt: utcDateTime;

    /** Ask again after this many seconds while the editor stays open; each renewal runs the access check again. */
    renewAfterSeconds: int32;

    /** The session may write answers here, so it may send soft locks and saved nudges; otherwise it is shown as present only. */
    canWrite: boolean;
  }
}

namespace GMS.Routes.Custom {
  @tag("Co-editing")
  namespace Presence {
    /**
     * A pass to a draft's live channel, for the signed-in person's own session. Issued by the check
     * that opens the draft: the applicant's team and the consultants or cowriters the draft names.
     * 404 for anyone else (another workspace, the funder and its reviewers: a draft is the
     * applicant's until submitted); 409 `not_a_draft` once a built-in application is submitted;
     * 403 `person_required` for agents and API clients, which never hold presence; 403
     * `session_required` for a sign-in without a session. Renewing updates the same pass.
     */
    @post @route("/presence/passes") @useAuth(UserSession)
    op pass(@body body: PresencePassRequest): OkT<PresencePass> | BadRequest | AuthErrors | NotFound | Conflict;
  }
}
