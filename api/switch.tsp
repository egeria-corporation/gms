import "@typespec/http";
import "@common-grants/core";
import "./models.tsp";
import "./routes.tsp";

using TypeSpec.Http;
using CommonGrants.Responses;
using GMS.Models;
using GMS.Errors;

// The switch pages (`/switch`, `/switch/{system}`) and their "Request a free migration" form. A
// visitor asks OpenGrants for a free, human-run migration; the request is emailed to OpenGrants
// (CONSULTING_REQUEST_TO) with replies going to the person. No token: anonymous visitors may send.
// A person's own session is accepted; API and agent tokens are refused (403 `person_only`), and
// there is no MCP tool. Nothing is stored: the email is the record.

namespace GMS.Models {
  /** The system the organization uses today, as the switch pages list them. */
  union MigrationSystem {
    goodGrants: "good-grants",
    submittable: "submittable",
    surveymonkeyApply: "surveymonkey-apply",
    foundant: "foundant",
    zengine: "zengine",
    fluxx: "fluxx",
    smartsimple: "smartsimple",
    cybergrants: "cybergrants",
    openwater: "openwater",
    spreadsheets: "spreadsheets",
    other: "other",
  }

  /** Approximate number of programs. */
  union MigrationPrograms {
    one: "1",
    twoToFive: "2-5",
    sixToTwenty: "6-20",
    moreThanTwenty: "21+",
    unsure: "unsure",
  }

  /** Approximate number of past awards. */
  union MigrationPastAwards {
    fewerThan100: "0-99",
    upTo999: "100-999",
    upTo9999: "1000-9999",
    tenThousandOrMore: "10000+",
    unsure: "unsure",
  }

  /** When they hope to move. */
  union MigrationTiming {
    asap: "asap",
    threeMonths: "3-months",
    sixMonths: "6-months",
    twelveMonths: "12-months",
    exploring: "exploring",
  }

  model MigrationRequestForm {
    /** Signed by the server with the time the form was shown. A send needs one at least `minSeconds` and at most 24 hours old. */
    formToken: string;

    minSeconds: int32;
  }

  model MigrationRequestInput {
    @maxLength(200) name: string;
    @maxLength(320) email: string;
    @maxLength(200) organization: string;
    system: MigrationSystem;
    programs: MigrationPrograms;
    pastAwards: MigrationPastAwards;
    timing: MigrationTiming;

    /** Up to 2,000 characters. Numbers that look like bank account, routing or identity numbers are removed before the preview and the send. */
    @maxLength(2000) note?: string;

    /** The form's hidden field: always empty from a person. A send with anything in it is refused (422 `not_sent`). */
    @maxLength(500) website?: string;

    /** From `GET /gms/migration-requests/form`. Needed to send, not to preview. */
    @maxLength(200) formToken?: string;
  }

  model MigrationEmailPreview {
    to: string;
    subject: string;

    /** Exactly the email's text. */
    text: string;
  }

  model MigrationRequestPreview {
    /** CONSULTING_REQUEST_TO, default `hello@agents.opengrants.io`. */
    to: string;

    replyTo: string;
    subject: string;

    /** Exactly the email's text. */
    text: string;

    name: string;
    email: string;
    organization: string;
    system: MigrationSystem;
    systemLabel: string;
    programs: MigrationPrograms;
    programsLabel: string;
    pastAwards: MigrationPastAwards;
    pastAwardsLabel: string;
    timing: MigrationTiming;
    timingLabel: string;

    /** The note as it will be sent, with numbers removed; null when there is none. */
    note: string | null;

    numbersRemoved: int32;

    /** The confirmation the person will get. */
    confirmation: MigrationEmailPreview;
  }

  model MigrationRequestSent {
    sent: boolean;

    /** For the email's idempotency only; not stored. */
    requestId: CommonGrants.Types.uuid;

    sentAt: utcDateTime;
    to: string;
    replyTo: string;

    /** False when only the confirmation could not be sent; the request reached OpenGrants. */
    confirmationSent: boolean;

    message: string;
  }
}

namespace GMS.Routes.Custom {
  /** The email to OpenGrants could not be sent (502 `mail_failed`); nothing was counted. */
  alias BadGateway = CommonGrants.Responses.Error & {
    @statusCode statusCode: 502;
  };

  @tag("Switching")
  namespace Switching {
    /** Shown with the form: a signed token that says when. No token needed; 403 `person_only` for an API or agent token. */
    @get @route("/migration-requests/form")
    op migrationRequestForm(): OkT<MigrationRequestForm> | AuthErrors;

    /** Exactly what a migration request would send, and the confirmation. Nothing is sent or counted. No token needed; 403 `person_only` for an API or agent token. */
    @post @route("/migration-requests/preview")
    op previewMigrationRequest(@body body: MigrationRequestInput): OkT<MigrationRequestPreview> | BadRequest | AuthErrors;

    /** Ask OpenGrants for a free migration (email with reply-to the person, and a confirmation to them). A person only: 403 `person_only` for an API or agent token. 422 `not_sent` (hidden field filled), `form_expired` or `too_fast` (under 3 seconds); 429 `too_many_requests_for_email` (3 a day) or `too_many_requests` (20 a day per network); 503 `mail_not_configured`. */
    @post @route("/migration-requests")
    op sendMigrationRequest(@body body: MigrationRequestInput): OkT<MigrationRequestSent> | BadRequest | AuthErrors | Unprocessable | TooManyRequests | ServiceUnavailable | BadGateway;
  }
}
