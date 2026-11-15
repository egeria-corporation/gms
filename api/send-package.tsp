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

// Send to the funder (C4): an outside application handed to a funder who is not on the GMS. The
// package is a PDF (cover, questions and answers in order, budget summary when there is one,
// attachment list) and a ZIP (that PDF, the attached files under their names, `answers.txt`). The
// files are the application's own documents and the vault documents used for its checklist, never
// another. Every answer is screened for bank, card and identity numbers first (422
// `sensitive_answer`, naming the question). Downloads are reads; emailing the package is a
// person's (admins and editors), a preview first, then exactly that email, at most five a day per
// application. The footer line ("Prepared with the OpenGrants Grant Management System, free for
// funders and applicants · gms.opengrants.io") follows the workspace's `poweredBy` setting.

namespace GMS.Models {
  model PackageDeadline {
    /** "Letter of inquiry due", "Application due", or "Deadline" for a rolling one. The team's internal deadline is never included. */
    label: string;

    /** YYYY-MM-DD, or "Rolling". */
    date: string;
  }

  model PackageCover {
    organization: string;
    funder: string | null;
    program: string | null;
    ask: Money | null;

    /** The ask as printed on the cover, e.g. "USD 50,000.00". */
    askPrinted: string | null;

    deadlines: PackageDeadline[];

    /** The date of the latest change to anything in the package (YYYY-MM-DD). */
    answersAsOf: string;
  }

  model PackageQuestion {
    id: CommonGrants.Types.uuid;
    number: int32;
    phase: "loi" | "full" | "report";
    prompt: string;
    answered: boolean;
  }

  model PackageBudget {
    byYear: {
      year: int32;
      amount: Money;
    }[];

    /** The total, printed. */
    total: string;
  }

  model PackageFile {
    documentId: CommonGrants.Types.uuid;

    /** The name in the ZIP and the email: the original name, made unique. */
    name: string;

    originalName: string;

    /** `application`: attached to this application; `vault`: a vault document used for one of its required documents. */
    source: "application" | "vault";

    /** For a vault document: the required document it was used for. */
    requiredFor: string | null;

    mime: string;
    size: int64;
    sha256: string;
  }

  model PackageFileLeftOut {
    documentId: CommonGrants.Types.uuid;
    name: string;

    /** `passport_locker`: the GMS holds no copy; `sensitive_name`: named like a bank or tax form. */
    reason: "passport_locker" | "sensitive_name";

    message: string;
  }

  model PackageBlockedAnswer {
    questionId: CommonGrants.Types.uuid;
    number: int32;
    prompt: string;
    reason: "bank_routing" | "identity_number" | "long_number";

    /** Which question, in plain words. The number itself is never returned. */
    message: string;
  }

  /** `GET /gms/outside-applications/{id}/package`: what the package holds and whether it can be emailed. Builds nothing. */
  model SendPackage {
    applicationId: CommonGrants.Types.uuid;
    title: string;
    cover: PackageCover;
    questions: PackageQuestion[];
    budget: PackageBudget | null;
    attachments: PackageFile[];
    notIncluded: PackageFileLeftOut[];
    footer: {
      shown: boolean;
      text: string;

      /** The caller may switch the footer line (a workspace admin, in person). */
      canChange: boolean;
    };

    /** Answers that look like a bank, card or identity number. While any is listed, nothing can be downloaded or sent. */
    blocked: PackageBlockedAnswer[];

    files: {
      pdf: string;
      zip: string;

      /** The ZIP's entries in order. */
      contents: string[];
    };

    totalBytes: int64;
    downloads: {
      pdf: string;
      zip: string;
    };
    email: {
      available: boolean;

      /** Why the package cannot be emailed now, in plain words; null when it can. */
      reason: string | null;

      perDay: int32;
      sentToday: int32;
      remainingToday: int32;
      maxBytes: int64;
    };
  }

  model PackageEmailInput {
    /** The funder contact's address, typed by the person. */
    @format("email")
    to: string;

    /** The person's own words above the package (up to 2,000 characters). */
    message?: string;
  }

  model PackageEmailSend {
    ...PackageEmailInput;

    /** The `digest` of the preview the person confirmed. */
    digest: string;
  }

  /** Exactly the email that would be sent. */
  model PackageEmailPreview {
    /** The person's name on the GMS's sending address. */
    from: string;

    to: string;

    /** The person's sign-in address. */
    replyTo: string;

    subject: string;
    text: string;
    html: string;
    attachments: {
      filename: string;
      contentType: string;
      sha256: string;
      size: int64;
    }[];

    /** Ties a send to this preview: a send whose email differs is refused (409 `preview_changed`). */
    digest: string;

    perDay: int32;
    remainingToday: int32;
  }

  model PackageEmailSent {
    sent: true;
    sendId: CommonGrants.Types.uuid;
    sentAt: utcDateTime;
    to: string;
    replyTo: string;
    remainingToday: int32;
  }

  model PackageSettings {
    /** The footer line on this workspace's packages (the workspace's `poweredBy` setting). */
    poweredBy: boolean;
  }
}

namespace GMS.HttpResponses {
  model ZipFile {
    @statusCode statusCode: 200;
    @header contentType: "application/zip";
    @body body: bytes;
  }
}

namespace GMS.Routes.Custom {
  @tag("Apply anywhere")
  namespace SendToFunder {
    /** What the package holds, any answer that stops it, and whether it can be emailed now. Members other than consultants. */
    @get @route("/outside-applications/{id}/package") @useAuth(GmsOAuth<["applications:read"]> | UserSession)
    op get(@path id: CommonGrants.Types.uuid): OkT<SendPackage> | AuthErrors | NotFound;

    /** The package PDF. 422 `sensitive_answer` naming the questions; the number is never returned. */
    @get @route("/outside-applications/{id}/package.pdf") @useAuth(GmsOAuth<["applications:read"]> | UserSession)
    op pdf(@path id: CommonGrants.Types.uuid): Pdf | AuthErrors | NotFound | Unprocessable;

    /** The package ZIP: the PDF, the attached files under their names, and `answers.txt`. 413 `package_too_large` over 60 MB of files. */
    @get @route("/outside-applications/{id}/package.zip") @useAuth(GmsOAuth<["applications:read"]> | UserSession)
    op zip(@path id: CommonGrants.Types.uuid): ZipFile | AuthErrors | NotFound | Unprocessable | ServiceUnavailable;

    /**
     * Exactly the email that would be sent, and its digest. Nothing is sent or counted. A person
     * only (admins and editors): an agent's token is 403 `approval_required`, and no MCP tool sends
     * a package. 409 `archived`; 422 `sensitive_answer`; 503 `mail_not_configured` or
     * `mail_attachments_unavailable`.
     */
    @post @route("/outside-applications/{id}/package/email/preview") @useAuth(UserSession)
    op previewEmail(@path id: CommonGrants.Types.uuid, @body body: PackageEmailInput): OkT<PackageEmailPreview> | BadRequest | AuthErrors | NotFound | Conflict | Unprocessable | ServiceUnavailable;

    /** Send the package if it is still exactly the preview (409 `preview_changed` otherwise). 429 `too_many_package_emails` after five in a UTC day for this application. */
    @post @route("/outside-applications/{id}/package/email") @useAuth(UserSession)
    op sendEmail(@path id: CommonGrants.Types.uuid, @body body: PackageEmailSend): OkT<PackageEmailSent> | BadRequest | AuthErrors | NotFound | Conflict | Unprocessable | TooManyRequests | ServiceUnavailable;

    /** Turn the footer line on this applicant workspace's packages on or off. Workspace admins, in person. */
    @put @route("/send-package/settings") @useAuth(UserSession)
    op settings(@body body: PackageSettings): OkT<PackageSettings> | BadRequest | AuthErrors;
  }
}
