import "@typespec/http";
import "@common-grants/core";
import "./models.tsp";
import "./routes.tsp";

using TypeSpec.Http;
using CommonGrants.Responses;
using GMS.Models;
using GMS.Auth;
using GMS.Errors;

// The template gallery: ready-to-use application forms, rubrics, report forms, email
// templates and program kits, shared under CC BY 4.0. Approved items are public (no token). A
// funder workspace copies one into its own drafts; a funder workspace admin shares one of its own
// records, which loses its contact details and the organization's names before it is saved; an
// operator listed in GALLERY_MODERATORS approves or declines it. Sharing, withdrawing and
// moderating are a signed-in person's (no API token, no MCP tool).

namespace GMS.Models {
  union GalleryKind {
    application_form: "application_form",
    report_form: "report_form",
    rubric: "rubric",
    email_template: "email_template",
    program_kit: "program_kit",
  }

  /** Each from a fixed vocabulary (`tags` on the list response). */
  model GalleryTags {
    fieldOfWork: string[];
    grantSize: string[];
    audience: string[];
  }

  /** The vocabularies the tags are chosen from. */
  model GalleryTagVocabulary {
    fieldOfWork: string[];
    grantSize: string[];
    audience: string[];
  }

  /** Who shared it: the workspace's display name, `verified` only when it is linked to Passport; or the OpenGrants starter library. */
  model GalleryAuthor {
    kind: "workspace" | "opengrants";
    name: string;
    verified: boolean;
  }

  model GalleryLicence {
    code: "CC-BY-4.0";
    name: "CC BY 4.0";
    url: url;
  }

  model GalleryContents {
    forms: int32;
    rubrics: int32;
    emails: int32;
    /** Questions across the item's forms. */
    questions: int32;
  }

  model GalleryCard {
    id: CommonGrants.Types.uuid;
    slug: string;
    kind: GalleryKind;
    title: string;
    summary: string;
    tags: GalleryTags;
    author: GalleryAuthor;
    licence: GalleryLicence;
    usesCount: int32;
    version: int32;
    publishedAt: utcDateTime;
    contents: GalleryContents;
  }

  /** A form as `POST /gms/forms` takes it: JSON Schema, UI schema and CommonGrants mappings. */
  model GalleryForm {
    title: string;
    description: string | null;
    instructions: string | null;
    purpose: FormPurpose;
    jsonSchema: Record<unknown>;
    uiSchema: Record<unknown>;
    mappingFromCommonGrants: Record<unknown>;
    mappingToCommonGrants: Record<unknown>;
    fieldMeta: Record<unknown>;
  }

  model GalleryRubric {
    name: string;
    /** As `POST /gms/rubrics` takes them. */
    criteria: Record<unknown>[];
    overall: Record<unknown>;
  }

  model GalleryEmail {
    name: string;
    subject: string;
    body: string;
  }

  /** A copy taken when the item was shared; never a link to the author's record. */
  model GallerySnapshot {
    forms: GalleryForm[];
    rubrics: GalleryRubric[];
    emails: GalleryEmail[];
  }

  model GalleryItemDetail {
    ...GalleryCard;
    snapshot: GallerySnapshot;
  }

  model GalleryCreated {
    type: "form" | "rubric" | "template";
    /** `frm_…` for a form; a bare UUID for a rubric or a template. */
    id: string;
    title: string;
    /** Forms only. */
    purpose?: FormPurpose;
  }

  model GalleryCopyResult {
    item: {
      id: CommonGrants.Types.uuid;
      slug: string;
      title: string;
      kind: GalleryKind;
      usesCount: int32;
    };

    /** Each a new record of the workspace: forms are drafts. */
    created: GalleryCreated[];
  }

  /** One of the workspace's own records. A form shares its latest published version unless `version` names one. */
  model GallerySource {
    type: "form" | "rubric" | "template";
    id: string;
    version?: int32;
  }

  model GalleryPreviewInput {
    source: GallerySource;

    /** More names to replace with "[Your organization]" (a program's name, for example). */
    extraNames?: string[];
  }

  model GallerySubmissionInput {
    source: GallerySource;
    title: string;
    summary: string;
    tags?: GalleryTags;
    extraNames?: string[];

    /** Sharing is under CC BY 4.0 only. */
    licence: "CC-BY-4.0";
  }

  /** One thing taken out. The value itself is never kept. */
  model GalleryStripped {
    path: string;
    where: string;
    what: "default" | "help" | "text" | "name";
    found: ("email" | "phone" | "link" | "organization name")[];
  }

  model GalleryPreview {
    kind: GalleryKind;
    source: {
      type: "form" | "rubric" | "template";
      version: int32;
    };
    suggestedTitle: string;
    names: string[];
    placeholder: "[Your organization]";
    snapshot: GallerySnapshot;
    stripped: GalleryStripped[];
    licence: GalleryLicence;
  }

  model GallerySubmission {
    id: CommonGrants.Types.uuid;
    kind: GalleryKind;
    title: string;
    summary: string;
    tags: GalleryTags;
    status: "pending" | "approved" | "rejected" | "withdrawn";
    source: {
      type: "form" | "rubric" | "template";
      id: string;
      version: int32;
    };
    stripped: GalleryStripped[];

    /** Why a moderator declined it. */
    decisionReason: string | null;

    decidedAt: utcDateTime | null;
    withdrawnAt: utcDateTime | null;

    /** The published item, once approved; `live` is false after it is withdrawn. */
    item: {
      slug: string;
      live: boolean;
    } | null;

    licence: GalleryLicence;
    createdAt: utcDateTime;
  }

  model GalleryQueueItem {
    ...GallerySubmission;
    snapshot: GallerySnapshot;
    author: GalleryAuthor;
  }

  model GalleryApproveInput {
    /** The item's address; made from the title when omitted. */
    slug?: string;
  }

  model GalleryRejectInput {
    /** Shown to the author beside the submission. */
    reason: string;
  }

  model GalleryApproved {
    submission: GallerySubmission;
    item: {
      slug: string;
      id: CommonGrants.Types.uuid;
    };
  }

  model GalleryModeratorStatus {
    moderator: boolean;
  }
}

namespace GMS.Routes.Custom {
  @tag("Template gallery")
  namespace Gallery {
    /** Approved items, most used first. No token. `tags` lists the vocabularies to filter by. */
    @get @route("/gallery")
    op listGallery(...PageParams, @query kind?: GalleryKind, @query tag?: string, @query q?: string): (PaginatedT<GalleryCard> & {
      tags: GalleryTagVocabulary;
    }) | BadRequest;

    /** One approved item with its content. No token. 404 once it is withdrawn. */
    @get @route("/gallery/{slug}")
    op readGalleryItem(@path slug: string): OkT<GalleryItemDetail> | NotFound;

    /** Copy an item into this funder workspace: new draft forms, a new rubric, new email templates (a name the workspace already uses gets "(from the gallery)"). Counts one use. */
    @post @route("/workspaces/{workspaceId}/gallery/items/{slug}/copy") @useAuth(GmsOAuth<["forms:read", "forms:write", "reviews:write", "communications:write"]> | UserSession)
    op copyGalleryItem(@path workspaceId: CommonGrants.Types.uuid, @path slug: string): CreatedT<GalleryCopyResult> | BadRequest | AuthErrors | NotFound;

    /** What would be shared, saving nothing: the cleaned snapshot and what was taken out. A funder admin, in person. */
    @post @route("/workspaces/{workspaceId}/gallery/preview") @useAuth(UserSession)
    op previewGallerySubmission(@path workspaceId: CommonGrants.Types.uuid, @body body: GalleryPreviewInput): OkT<GalleryPreview> | BadRequest | AuthErrors | NotFound | Conflict | Unprocessable;

    /** The workspace's submissions, newest first, with each decision and reason. */
    @get @route("/workspaces/{workspaceId}/gallery/submissions") @useAuth(GmsOAuth<["forms:read"]> | UserSession)
    op listGallerySubmissions(@path workspaceId: CommonGrants.Types.uuid): PaginatedT<GallerySubmission> | AuthErrors;

    /** Share a published form, a rubric or an email template for review. A funder admin, in person (403 `human_only` for an agent). 409 `already_submitted`, `form_not_published`. */
    @post @route("/workspaces/{workspaceId}/gallery/submissions") @useAuth(UserSession)
    op submitToGallery(@path workspaceId: CommonGrants.Types.uuid, @body body: GallerySubmissionInput): CreatedT<GallerySubmission> | BadRequest | AuthErrors | NotFound | Conflict | Unprocessable;

    /** Withdraw a pending or published submission; a published item leaves the gallery. Copies already made stay. */
    @post @route("/workspaces/{workspaceId}/gallery/submissions/{id}/withdraw") @useAuth(UserSession)
    op withdrawGallerySubmission(@path workspaceId: CommonGrants.Types.uuid, @path id: CommonGrants.Types.uuid): OkT<GallerySubmission> | AuthErrors | NotFound | Conflict;

    /** Whether the signed-in person moderates the gallery. */
    @get @route("/gallery/moderation/me") @useAuth(UserSession)
    op galleryModerator(): OkT<GalleryModeratorStatus> | AuthErrors;

    /** Pending submissions, oldest first. Moderators only (403 `not_a_moderator`). */
    @get @route("/gallery/moderation/queue") @useAuth(UserSession)
    op galleryQueue(): PaginatedT<GalleryQueueItem> | AuthErrors;

    @post @route("/gallery/moderation/submissions/{id}/approve") @useAuth(UserSession)
    op approveGallerySubmission(@path id: CommonGrants.Types.uuid, @body body: GalleryApproveInput): OkT<GalleryApproved> | BadRequest | AuthErrors | NotFound | Conflict;

    /** Decline with a reason the author reads. */
    @post @route("/gallery/moderation/submissions/{id}/reject") @useAuth(UserSession)
    op rejectGallerySubmission(@path id: CommonGrants.Types.uuid, @body body: GalleryRejectInput): OkT<GallerySubmission> | BadRequest | AuthErrors | NotFound | Conflict;
  }
}
