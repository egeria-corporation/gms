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

// v1.8.0: opt-in content digests. Three Monday emails, each off until the person turns it on, per
// person and workspace: new matches and deadlines for applicants, the week's activity for funder
// staff. Each is sent once per person, digest and ISO week, only when there is something new, with
// a one-click unsubscribe link (signed, no sign-in) and the List-Unsubscribe headers. Turning a
// digest on or off is the person's own choice: agents and API clients may read the settings and
// the preview, never change them. The funder digest carries counts and links, never answers.

namespace GMS.Models {
  union ContentDigestKey {
    newMatches: "new_matches",
    deadlines: "deadlines",
    funderActivity: "funder_activity",
  }

  /** One digest this person can turn on in this workspace. */
  model DigestChoice {
    key: ContentDigestKey;
    label: string;
    description: string;
    on: boolean;
  }

  /** `GET /gms/digests`: the digests offered to this person here (by workspace kind and role), and which are on. */
  model DigestSettings {
    digests: DigestChoice[];

    /** The one-time "Get new matches every Monday" prompt was acted on or dismissed. */
    promptDismissed: boolean;

    /** The next Monday the digests go out (YYYY-MM-DD). */
    nextSendOn: plainDate;

    /** This server can send them (mail, a sender address and the key that signs unsubscribe links). */
    emailAvailable: boolean;
  }

  /** Any of the three, and the prompt. A digest the person is not offered cannot be turned on (422 `digest_not_offered`). */
  model DigestSettingsInput {
    new_matches?: boolean;
    deadlines?: boolean;
    funder_activity?: boolean;
    promptDismissed?: true;
  }

  /** Next Monday's email as it would be written now. Nothing is sent or recorded. */
  model DigestPreview {
    digest: ContentDigestKey;
    label: string;

    /** Whether this person has it on. */
    on: boolean;

    sendsOn: plainDate;

    /** False when there is nothing new: no email would go out. */
    willSend: boolean;

    subject: string | null;

    /** The plain-text part; the unsubscribe link in it is a placeholder. */
    text: string | null;
  }

  model DigestUnsubscribeInput {
    /** The signed token from the email's link. */
    token: string;
  }

  /** The digest turned off. */
  model DigestUnsubscribed {
    digest: ContentDigestKey;
    label: string;

    /** The workspace's name, or null when the membership no longer exists. */
    workspace: string | null;

    on: false;
  }

  /** The List-Unsubscribe address opened in a browser: nothing changes; the page that asks the API opens. */
  model DigestUnsubscribeRedirect {
    @statusCode statusCode: 303;
    @header location: url;
  }
}

namespace GMS.Routes.Custom {
  @tag("Digests")
  namespace Digests {
    /** The content digests offered to the caller in this workspace and which are on. Every digest starts off. */
    @get @route("/digests") @useAuth(GmsOAuth<[]> | UserSession)
    op get(): OkT<DigestSettings> | AuthErrors;

    /** Turn digests on or off, or dismiss the one-time prompt. The signed-in person only: agents and API clients are refused (403 `person_required`). */
    @put @route("/digests") @useAuth(UserSession)
    op save(@body body: DigestSettingsInput): OkT<DigestSettings> | BadRequest | AuthErrors | Unprocessable;

    /** Next Monday's email for the caller, written now and not sent. 422 `digest_not_offered` for a digest their role does not get. */
    @get @route("/digests/preview") @useAuth(GmsOAuth<[]> | UserSession)
    op preview(@query digest: ContentDigestKey): OkT<DigestPreview> | BadRequest | AuthErrors | Unprocessable;

    /**
     * One-click unsubscribe (RFC 8058). No sign-in: the signed token is the proof. Mail apps POST
     * `List-Unsubscribe=One-Click` to the address in the List-Unsubscribe header (token in the
     * query); the web page posts `{ token }`. 400 `invalid_link` for a token not signed here, 410
     * `link_expired` after 90 days.
     */
    @post @route("/digests/unsubscribe")
    op unsubscribe(@query token?: string, @body body?: DigestUnsubscribeInput): OkT<DigestUnsubscribed> | BadRequest | Gone | ServiceUnavailable;

    /** Opening the List-Unsubscribe address in a browser: a 303 to the web page, which turns the digest off when it opens. This request changes nothing. */
    @get @route("/digests/unsubscribe")
    op unsubscribePage(@query token?: string): DigestUnsubscribeRedirect;
  }
}
