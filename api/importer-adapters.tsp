import "@typespec/http";
import "@common-grants/core";
import "./models.tsp";
import "./routes.tsp";
import "./imports.tsp";

using TypeSpec.Http;
using CommonGrants.Responses;
using GMS.Models;
using GMS.Auth;
using GMS.Errors;
using GMS.HttpResponses;

// Importer adapters (v1.8.0): grant history from another grants system. A file exported from Good
// Grants, SurveyMonkey Apply, Submittable, Foundant GLM, SmartSimple or OpenWater gets that
// system's preset mapping, and the rows it says were never awarded are set aside; Fluxx and Zengine
// are read through their APIs with the funder's own credentials, read-only, 5,000 rows a run. The
// sensitive screen runs first on every table whatever the system. Files from a system's zip are
// matched by path and attached to the imported awards as the funder's own documents.

namespace GMS.Errors {
  /** The body is larger than the route takes (413 `too_large`). */
  alias PayloadTooLarge = CommonGrants.Responses.Error & {
    @statusCode statusCode: 413;
  };
}

namespace GMS.Models {
  union ImportAdapterKey {
    goodGrants: "good_grants",
    smApply: "sm_apply",
    submittable: "submittable",
    foundantGlm: "foundant_glm",
    smartsimple: "smartsimple",
    openwater: "openwater",
    fluxx: "fluxx",
    zengine: "zengine",
  }

  /** A grants system the import can read: what to export, and what a zip of its files holds. */
  model ImportAdapter {
    key: ImportAdapterKey;
    system: string;

    /** `file`: drop in its export. `api`: read with the funder's own credentials. */
    via: "file" | "api";

    /** What to export from the system, in plain steps. */
    steps: string[];

    /** The file types read for it. */
    accepts: ("csv" | "xlsx" | "json")[];

    /** What its zip of PDFs and files holds, when it has one. */
    attachments: string | null;

    /** Whether the export's exact column names were confirmed from the system's public pages; when not, the person confirms each field. */
    headersConfirmed: boolean;

    /** The public pages it was built from, as of November 2026. */
    sources: string[];
  }

  model ImportAdapterRef {
    key: ImportAdapterKey;
    system: string;
  }

  model ImportDetected {
    key: ImportAdapterKey;
    system: string;

    /** The headers that matched the system's export. */
    matched: string[];
  }

  model ImportJsonSource {
    kind: "json";

    /** The export's text: an array of records, or an object holding one. */
    text: string;

    fileName?: string;
  }

  model ImportFluxxSource {
    kind: "fluxx";

    /** Where to start: the `nextPage` of the last run. The first page when left out. */
    startPage?: int32;
  }

  model ImportZengineSource {
    kind: "zengine";

    /** The form whose records to read (see `zengineForms`). */
    formId: string;

    startPage?: int32;
  }

  union ImportPuller {
    fluxx: "fluxx",
    zengine: "zengine",
  }

  model ImportPullerConnection {
    provider: ImportPuller;
    label: string;

    /** Whether this server can store credentials (CREDENTIALS_ENCRYPTION_KEY is set). */
    configured: boolean;

    connected: boolean;

    /** Fluxx: the instance address. Never a credential. */
    instance: string | null;

    connectedAt: utcDateTime | null;
    lastReadAt: utcDateTime | null;
  }

  /** Fluxx: your instance's address, and the id and secret of the OAuth application you created at its /oauth/applications page. */
  model FluxxConnectInput {
    instanceUrl: string;
    clientId: string;
    clientSecret: string;
  }

  /** Zengine: an access token for your own account. */
  model ZengineConnectInput {
    token: string;
  }

  model ZengineForm {
    id: string;
    name: string;
    workspaceId: string;
    workspaceName: string;
  }

  model ImportFilesMatchInput {
    /** The zip's paths (folders and file names), never the files. At most 2,000. */
    paths: string[];
  }

  model ImportFileMatched {
    path: string;
    name: string;

    /** The row of the import it matched. */
    line: int32;

    /** The imported award's title. */
    title: string;

    /** By the export's own id in the path, or by the title. */
    by: "id" | "title";
  }

  model ImportFileUnmatched {
    path: string;
    name: string;

    /** Why, in plain words. */
    why: string;
  }

  model ImportFilesMatch {
    matched: ImportFileMatched[];
    unmatched: ImportFileUnmatched[];
  }

  model ImportFileInput {
    /** The file's path in the zip; it must match an imported award. */
    path: string;

    /** The file, base64. At most 25 MB. */
    contentBase64: string;
  }

  model ImportFile {
    id: CommonGrants.Types.uuid;
    name: string;
    mime: string;
    size: int64;
    line: int32 | null;

    /** The award's `awd_` id. */
    award: string | null;

    createdAt: utcDateTime;
  }

  model ImportFileAttached {
    file: ImportFile;

    /** False when the same file was already on the award. */
    created: boolean;
  }
}

namespace GMS.Routes.Custom {
  @tag("Imports")
  namespace ImportAdapters {
    /** Whether Fluxx or Zengine is connected for this funder workspace. A funder workspace admin, signed in. */
    @get @route("/imports/connections/{provider}") @useAuth(UserSession)
    op connection(@path provider: ImportPuller): OkT<ImportPullerConnection> | AuthErrors | NotFound;

    /** Connect Fluxx or Zengine with the funder's own credentials. Checked with one read first, then stored encrypted; never returned. Deleted when an import has read the source to its end and finished, on disconnect, when the source rejects them, or after a week unused. 422 `credentials_rejected`, `invalid_instance`; 503 `credentials_not_configured`, `connector_unavailable`. */
    @post @route("/imports/connections/{provider}") @useAuth(UserSession)
    op connect(@path provider: ImportPuller, @body body: FluxxConnectInput | ZengineConnectInput): CreatedT<ImportPullerConnection> | BadRequest | AuthErrors | NotFound | Unprocessable | TooManyRequests | ServiceUnavailable;

    /** Disconnect: the stored credentials are deleted. */
    @delete @route("/imports/connections/{provider}") @useAuth(UserSession)
    op disconnect(@path provider: ImportPuller): OkT<ImportPullerConnection> | AuthErrors | NotFound;

    /** The Zengine forms the saved token can read, to choose one to import. 409 `source_not_connected`; 429 `source_rate_limited`. */
    @get @route("/imports/zengine/forms") @useAuth(UserSession)
    op zengineForms(): OkT<ZengineForm[]> | AuthErrors | Conflict | Unprocessable | TooManyRequests | ServiceUnavailable;

    /** Match a zip's paths (never its files) to the awards a finished grant history import created, by the export's own id or by title. 409 `import_not_finished`. */
    @post @route("/imports/runs/{id}/files/match") @useAuth(UserSession)
    op matchFiles(@path id: CommonGrants.Types.uuid, @body body: ImportFilesMatchInput): OkT<ImportFilesMatch> | BadRequest | AuthErrors | NotFound | Conflict | Unprocessable;

    /** Attach one file to the award its path matches, as the funder's own document (the grantee never sees it). A signed-in person only (403 `human_only`). The same file on the same award is stored once (200 with `created: false`). 422 `file_not_matched`, `sensitive_document`; 413 `too_large`; 503 `storage_unavailable`. */
    @post @route("/imports/runs/{id}/files") @useAuth(UserSession)
    op attachFile(@path id: CommonGrants.Types.uuid, @body body: ImportFileInput): CreatedT<ImportFileAttached> | OkT<ImportFileAttached> | BadRequest | AuthErrors | NotFound | Conflict | Unprocessable | PayloadTooLarge | ServiceUnavailable;

    /** The files attached to a run's awards. */
    @get @route("/imports/runs/{id}/files") @useAuth(UserSession)
    op listFiles(@path id: CommonGrants.Types.uuid): OkT<ImportFile[]> | AuthErrors | NotFound;
  }
}
