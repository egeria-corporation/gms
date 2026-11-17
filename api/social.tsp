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

// Social posting through Zernio (v1.9.0): a funder announces an open call or an award on its own
// social accounts, a grantee shares its award, and the reach report shows what each post did.
// Nothing posts without a person: the exact text, picture and accounts are shown in a preview, and
// only the person's click on Post sends it. Agent and API-client tokens are refused on preview,
// post, connect and disconnect (403 `human_only`); agents read posts and reach (MCP
// `list_social_posts`). Each workspace is its own Zernio profile. Every route answers 404
// `social_not_configured` unless the server has ZERNIO_API_KEY and ZERNIO_WEBHOOK_SECRET.

namespace GMS.Models {
  /** Zernio's platform names; X is `twitter`. */
  union SocialPlatform {
    linkedin: "linkedin",
    facebook: "facebook",
    instagram: "instagram",
    twitter: "twitter",
    bluesky: "bluesky",
    threads: "threads",
  }

  model SocialPlatformInfo {
    platform: SocialPlatform;
    label: string;

    /** The longest post the platform takes (X counts each link as 23). */
    limit: int32;

    /** Instagram takes no post without a picture. */
    needsImage: boolean;
  }

  model SocialAccount {
    id: CommonGrants.Types.uuid;
    platform: SocialPlatform;
    label: string;
    username: string | null;
    status: "active" | "disconnected";
    connectedAt: utcDateTime;
    disconnectedAt: utcDateTime | null;
  }

  model SocialSettings {
    /** Whether the workspace's Zernio profile exists (it is created on the first connection). */
    profileCreated: boolean;

    platforms: SocialPlatformInfo[];

    /** Connected accounts only. */
    accounts: SocialAccount[];

    /** A signed-in workspace admin. */
    canConnect: boolean;

    /** A signed-in admin or editor (funder: admin, program officer; applicant: admin, editor). */
    canPost: boolean;
  }

  model SocialConnectInput {
    platform: SocialPlatform;
  }

  model SocialConnectStart {
    /** Zernio's sign-in for the platform. It returns to Settings › Social accounts. */
    authUrl: url;

    /** How long the connection may take before it must be started again. */
    expiresInSeconds: int32;
  }

  model SocialConnectCallback {
    /** The `gs` parameter this server put on the return address. */
    state: string;

    /** What Zernio added to the return address; checked against Zernio. */
    profileId: string;

    accountId: string;
    connected?: string;
    username?: string;
  }

  union SocialSubjectType {
    opportunity: "opportunity",
    award: "award",

    /** "Meet our grantees" (v1.12.0): a funder's program and its awards that may be public. */
    program: "program",
  }

  model SocialSubject {
    type: SocialSubjectType;
    id: CommonGrants.Types.uuid;
  }

  model SocialDraftSubject {
    ...SocialSubject;
    title: string;
  }

  model SocialSuggestion {
    label: string;
    text: string;

    /** `reminder`: the "Two weeks left" text; `meet`: "Meet our grantees". */
    kind?: "reminder" | "meet";
  }

  model SocialDraft {
    subject: SocialDraftSubject;

    /** False for a call that is not published or is closed, and for an award that is not publicly listed. */
    shareable: boolean;

    reason: string | null;

    /** Ready-to-edit texts; the composer starts with the first. */
    suggestions: SocialSuggestion[];

    /** The public page, with `utm_source=social`. */
    link: string | null;

    /** The share card attached when the person keeps it. */
    imageUrl: string | null;

    /** A call's "Two weeks left" prompt while it waits (v1.12.0): the first suggestion is then the reminder. */
    reminder?: {
      id: CommonGrants.Types.uuid;
      deadline: plainDate;
    } | null;

    /** An award's program, for the funder's "Meet our grantees" (funder side only). */
    program?: {
      id: CommonGrants.Types.uuid;
      name: string;
    } | null;

    /** "Meet our grantees": the program's awards that may be public, newest first, at most 10. */
    grantees?: SocialDraftGrantee[];

    /** "Meet our grantees": the opening and closing lines around the grantees' lines. */
    parts?: {
      intro: string;
      outro: string;
    } | null;
  }

  model SocialSchedule {
    /** Wall-clock time in `timezone`: `YYYY-MM-DDTHH:mm`. */
    scheduledFor: string;

    /** IANA time zone, e.g. `America/Chicago`. */
    timezone: string;
  }

  model SocialComposeInput {
    subject: SocialSubject;
    content: string;

    /** The workspace's connected accounts to post to. */
    accountIds: CommonGrants.Types.uuid[];

    /** Attach the subject's share card. */
    includeImage?: boolean = true;

    /** Post now when absent or null. */
    schedule?: SocialSchedule | null;
  }

  model SocialPostInput {
    ...SocialComposeInput;

    /** From the preview; it names the exact body previewed. */
    previewToken: string;
  }

  model SocialLengthCheck {
    platform: SocialPlatform;
    label: string;
    length: int32;
    limit: int32;
    over: boolean;
  }

  model SocialMediaItem {
    type: "image";
    url: string;
  }

  model SocialBodyTarget {
    platform: SocialPlatform;

    /** Zernio's account id. */
    accountId: string;
  }

  /** Exactly what Zernio receives (`POST /v1/posts`). */
  model SocialPostBody {
    content: string;
    mediaItems?: SocialMediaItem[];
    platforms: SocialBodyTarget[];
    publishNow?: true;
    scheduledFor?: string;
    timezone?: string;
  }

  model SocialPreviewSchedule {
    scheduledFor: string;
    timezone: string;

    /** When it goes out. */
    at: utcDateTime | null;
  }

  model SocialPreview {
    subject: SocialDraftSubject;
    content: string;
    imageUrl: string | null;
    accounts: SocialAccount[];
    publishNow: boolean;
    schedule: SocialPreviewSchedule | null;
    lengths: SocialLengthCheck[];

    /** Plain sentences; while there is one the post cannot go out and `previewToken` is null. */
    problems: string[];

    body: SocialPostBody;
    previewToken: string | null;
  }

  union SocialPostStatus {
    /** On its way, or Zernio did not confirm it yet (posting again with the same key is safe). */
    sending: "sending",

    scheduled: "scheduled",
    published: "published",

    /** Out on some accounts, failed on others. */
    partial: "partial",

    failed: "failed",
  }

  model SocialPostAccount {
    accountId: CommonGrants.Types.uuid;
    platform: SocialPlatform;
    label: string;
    username: string | null;
    status: "sending" | "scheduled" | "published" | "failed";

    /** The post on the platform, once it is out. */
    url: string | null;
  }

  /** Counts Zernio reports, summed over the post's platforms; null where it gives none. */
  model SocialMetrics {
    impressions: int64 | null;
    clicks: int64 | null;
    engagements: int64 | null;

    /** When the counts were read from Zernio. */
    asOf: utcDateTime | null;
  }

  model SocialPost {
    id: CommonGrants.Types.uuid;
    subject: SocialSubject;
    status: SocialPostStatus;
    platforms: SocialPlatform[];
    accounts: SocialPostAccount[];
    scheduledFor: utcDateTime | null;
    timezone: string | null;
    sentAt: utcDateTime | null;
    createdAt: utcDateTime;
    error: string | null;
    metrics: SocialMetrics;
  }

  model SocialTotals {
    posts: int32;
    impressions: int64 | null;
    clicks: int64 | null;
    engagements: int64 | null;
  }

  model SocialReach {
    /** The last 50, newest first. */
    posts: SocialPost[];

    totals: SocialTotals;

    /** For an opportunity: applications started from a link shared with `utm_source=social`. Null otherwise. */
    applicationsFromSocial: int32 | null;
  }

  model SocialWebhookEvent {
    id?: string;
    event?: string;
    timestamp?: string;
    profiles?: Record<unknown>[];
    account?: Record<unknown>;
    post?: Record<unknown>;
  }

  model SocialWebhookAck {
    status: int32;
    message: string;
  }
}

namespace GMS.Errors {
  /** Zernio refused the request (e.g. 502 `zernio_rejected`, `zernio_refused`). */
  alias SocialBadGateway = CommonGrants.Responses.Error & {
    @statusCode statusCode: 502;
  };
}

namespace GMS.Routes.Custom {
  @tag("Social")
  namespace Social {
    /** The platforms, the workspace's connected accounts, and whether the caller may connect or post. Funder staff (`analytics:read`), applicant staff (`awards:read`). */
    @get @route("/social") @useAuth(GmsOAuth<["analytics:read"]> | UserSession)
    op settings(): OkT<SocialSettings> | AuthErrors | NotFound;

    /** Start connecting an account. Creates the workspace's Zernio profile on first use. A signed-in admin only (403 `human_only` for tokens). */
    @post @route("/social/connect") @useAuth(UserSession)
    op connect(@body body: SocialConnectInput): OkT<SocialConnectStart> | BadRequest | AuthErrors | NotFound | SocialBadGateway | ServiceUnavailable;

    /** Record the account Zernio connected. The state must be this person's, for this workspace, and under ten minutes old (403 `connect_state_invalid`); the account must be listed under this workspace's profile (409 `account_not_listed`). */
    @post @route("/social/connect/callback") @useAuth(UserSession)
    op connectCallback(@body body: SocialConnectCallback): CreatedT<SocialAccount> | BadRequest | AuthErrors | NotFound | Conflict | SocialBadGateway | ServiceUnavailable;

    /** Disconnect an account, at Zernio and here. A signed-in admin only. */
    @delete @route("/social/accounts/{id}") @useAuth(UserSession)
    op disconnect(@path id: CommonGrants.Types.uuid): OkT<SocialAccount> | AuthErrors | NotFound | Conflict | SocialBadGateway | ServiceUnavailable;

    /** The composer's starting text, link and share card for an opportunity, an award or (v1.12.0, "Meet our grantees") a funder's program. A read: agents may use it to help write. */
    @get @route("/social/compose") @useAuth(GmsOAuth<["analytics:read"]> | UserSession)
    op compose(@query subjectType: SocialSubjectType, @query subjectId: CommonGrants.Types.uuid): OkT<SocialDraft> | BadRequest | AuthErrors | NotFound;

    /** The exact post as it will be sent, each platform's length, and a token for Post. A signed-in admin or editor only. 409 `not_shareable`; 422 `account_not_connected`. */
    @post @route("/social/posts/preview") @useAuth(UserSession)
    op preview(@body body: SocialComposeInput): OkT<SocialPreview> | BadRequest | AuthErrors | NotFound | Conflict | Unprocessable;

    /** Post or schedule: the person's click on Post. The body must be the one previewed (409 `preview_required`, `preview_changed`); one post per Idempotency-Key (the same key again returns it; 409 `idempotency_key_reused` for other content). Agent and API-client tokens get 403 `human_only`. 503 `zernio_unavailable`: not confirmed, post again with the same key. */
    @post @route("/social/posts") @useAuth(UserSession)
    op post(@header("Idempotency-Key") idempotencyKey: string, @body body: SocialPostInput): CreatedT<SocialPost> | BadRequest | AuthErrors | NotFound | Conflict | Unprocessable | SocialBadGateway | ServiceUnavailable;

    /** The reach report: posts with their links, statuses and counts, for one subject or all. MCP `list_social_posts` reads the same. */
    @get @route("/social/posts") @useAuth(GmsOAuth<["analytics:read"]> | UserSession)
    op reach(@query subjectType?: SocialSubjectType, @query subjectId?: CommonGrants.Types.uuid): OkT<SocialReach> | BadRequest | AuthErrors | NotFound;
  }
}

namespace GMS.Routes.Infrastructure {
  /** Zernio account and post events. Verifies `X-Zernio-Signature` (HMAC-SHA256 of the raw body) before reading it, dedupes on the event id, refuses deliveries older than a day, and applies an event only to the workspace whose profile it names. 404 when social posting is not set up. */
  @summary("Receive a Zernio webhook")
  @post
  @route("/webhooks/zernio")
  op zernioWebhook(@header("X-Zernio-Signature") signature: string, @body body: SocialWebhookEvent): {
    @statusCode statusCode: 200;
    @body body: SocialWebhookAck;
  } | BadRequest | Unauthorized | NotFound;
}
