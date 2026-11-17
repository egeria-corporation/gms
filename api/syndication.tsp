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

// Syndication (docs/syndication.md): where a published call goes besides its own page.
//   * Open-call feeds for newsletters and partners: open and forecasted calls whose public page is
//     on, unless the funder took the call out of the feeds (`publish.feeds`, on by default), with
//     only the fields the public page shows, each linking to the page with `utm_source=feed`.
//     JSON Feed 1.1, CSV (formula-safe cells) and RSS 2.0. No token; cached; 304 when unchanged.
//   * The OpenGrants index feed: CommonGrants records of calls with `publish.openGrantsIndex` on,
//     for OpenGrants to pull. OpenGrants documents no endpoint to publish to, so the GMS pushes nothing.
//   * Philanthropy News Digest takes RFPs by email (pndrfp@candid.org), four weeks before the
//     earliest deadline. A person previews the email filled from the public page and sends exactly
//     that, once per call; replies go to the funder. No agent, API client or MCP tool sends it.

namespace GMS.Models {
  /** One call in a feed: only what its public page shows. */
  model OpenCallFeedItem {
    id: CommonGrants.Types.uuid;
    title: string;
    description: string;
    status: "open" | "forecasted";
    acceptingApplications: boolean;
    funder: {
      name: string;
      handle: string;
      page: url;
    };

    /** The fund the page names, when it is not the funder's default fund. */
    category: {
      name: string;
      slug: string;
      page: url;
    } | null;

    /** CommonGrants `OppFunding`, as on the page. */
    funding: Record<unknown>;

    /** CommonGrants `OppTimeline`, as on the page. */
    keyDates: Record<unknown>;

    /** YYYY-MM-DD, from `keyDates.postDate`. */
    opens: string | null;

    /** YYYY-MM-DD, from `keyDates.closeDate`. */
    closes: string | null;

    /** CommonGrants applicant type codes. */
    acceptedApplicantTypes: string[];

    /** The eligibility rule labels the page lists (never the rules' values). */
    eligibility: string[];

    publishedAt: utcDateTime | null;

    /** The public page, with `utm_source=feed`. */
    link: url;
  }

  /** JSON Feed 1.1 (https://jsonfeed.org/version/1.1); each item's fields in `_gms`. */
  model OpenCallJsonFeed {
    version: "https://jsonfeed.org/version/1.1";
    title: string;
    home_page_url: url;
    feed_url: url;
    description: string;
    language: "en";
    items: {
      id: CommonGrants.Types.uuid;
      url: url;
      title: string;
      content_text: string;
      date_published?: utcDateTime;
      authors: {
        name: string;
        url: url;
      }[];
      tags?: string[];
      _gms: OpenCallFeedItem;
    }[];
  }

  /** Why a call cannot go to PND now. `person_only`: the caller is an agent or API client. `role`: the person does not edit calls. `not_listed`: unpublished or no public page. `too_late`: past PND's four weeks. `no_reply_to`: no address for replies. `sent`: already sent (once per call). `sending`: a send is under way. */
  union PndBlock {
    "person_only",
    "role",
    "not_listed",
    "closed",
    "too_late",
    "mail_not_configured",
    "no_reply_to",
    "sent",
    "sending",
  }

  /** The "Share this call" panel. */
  model Syndication {
    opportunityId: CommonGrants.Types.uuid;
    feeds: {
      /** `publish.feeds`: false when the funder took the call out of the feeds. */
      on: boolean;

      /** In the feeds now: on, published with its page on, open or forecasted. */
      listed: boolean;

      /** This funder's feed in each format (`?funder={handle}`). */
      urls: {
        json: url;
        csv: url;
        rss: url;
      };

      /** Every funder's calls, as RSS. */
      allUrl: url;
    };
    openGrants: {
      /** `publish.openGrantsIndex`. */
      on: boolean;

      /** In the OpenGrants index feed now (open, forecasted or closed, with its page on). */
      inFeed: boolean;

      feedUrl: url;

      /** Whether OpenGrants pulls the feed today. False until the OpenGrants team does. */
      pulling: boolean;
    };
    pnd: {
      name: "Philanthropy News Digest";
      address: "pndrfp@candid.org";

      /** Candid's page that states how PND takes RFPs. */
      sourceUrl: url;

      /** 28: PND needs a call four weeks before its earliest deadline. */
      leadDays: int32;

      /** YYYY-MM-DD: the call's closing date or a public stage's, whichever is first and still ahead. Null for a call open all year. */
      earliestDeadline: string | null;

      /** YYYY-MM-DD: the last day PND takes the call. Null when there is no deadline. */
      sendBy: string | null;

      sent: {
        sentAt: utcDateTime;

        /** Masked: `g…@example.org`. */
        replyTo: string;
      } | null;

      canSend: boolean;
      blocked: PndBlock | null;
    };

    /** Applications to this call started from a feed link and from a PND link (`utm_source`). */
    startedFrom: {
      feed: int32;
      pnd: int32;
    };
  }

  model SyndicationFeedsInput {
    /** False takes the call out of the open-call feeds; true puts it back. */
    feeds: boolean;
  }

  /** Exactly the email that would be sent to PND. */
  model PndPreview {
    /** The funder's name on the GMS's sending address. */
    from: string;

    to: "pndrfp@candid.org";

    /** The funder's public contact address, else the person's own. */
    replyTo: string;

    subject: string;
    text: string;
    html: string;

    /** PND's fields, in the email's order, as the preview shows them. */
    fields: {
      key: "funder" | "title" | "scope" | "qualifications" | "instructions" | "deadlines" | "link" | "contact";
      label: string;
      value: string;
    }[];

    /** Ties a send to this preview: a send whose email differs is refused (409 `preview_changed`). */
    digest: string;

    earliestDeadline: string | null;
    sendBy: string | null;
    sourceUrl: url;
  }

  model PndSendInput {
    /** The `digest` of the preview the person confirmed. */
    digest: string;
  }

  model PndSent {
    sent: true;
    sentAt: utcDateTime;
    to: "pndrfp@candid.org";
    replyTo: string;
  }
}

namespace GMS.HttpResponses {
  model OpenCallJsonFeedFile {
    @statusCode statusCode: 200;
    @header contentType: "application/feed+json; charset=utf-8";

    /** `public, max-age=300, s-maxage=900`. */
    @header cacheControl: string;

    @header etag: string;
    @header("Access-Control-Allow-Origin") allowOrigin: "*";
    @body body: OpenCallJsonFeed;
  }

  model OpenCallCsvFeedFile {
    @statusCode statusCode: 200;
    @header contentType: "text/csv; charset=utf-8";
    @header cacheControl: string;
    @header etag: string;
    @header contentDisposition: string;
    @header("Access-Control-Allow-Origin") allowOrigin: "*";

    /** Columns: id, title, funder, funder_handle, status, accepting_applications, opens, closes, min_award, max_award, total_available, currency, applicant_types, eligibility, category, published_at, link, description. */
    @body body: string;
  }

  model OpenCallRssFeedFile {
    @statusCode statusCode: 200;
    @header contentType: "application/rss+xml; charset=utf-8";
    @header cacheControl: string;
    @header etag: string;
    @header("Access-Control-Allow-Origin") allowOrigin: "*";
    @body body: string;
  }

  model OpenGrantsIndexFeedFile {
    @statusCode statusCode: 200;
    @header contentType: "application/json; charset=utf-8";
    @header cacheControl: string;
    @header etag: string;
    @header("Access-Control-Allow-Origin") allowOrigin: "*";
    @body body: CommonGrants.Responses.PaginatedBase<CommonGrants.Models.OpportunityBase>;
  }

  model FeedNotModified {
    @statusCode statusCode: 304;
    @header etag: string;
  }
}

namespace GMS.Routes.Custom {
  @tag("Syndication")
  namespace OpenCallFeeds {
    /** Open and forecasted calls with a public page that are in the feeds, newest first (at most 500), as JSON Feed 1.1. `region`: a US state (code or name) or any region the page names; `category`: a fund's name or slug; `funder`: a handle; `closingWithin`: 1 to 365 days. Other parameters are ignored. No token. */
    @summary("Open-call feed (JSON)")
    @get
    @route("/public/feeds/opportunities.json")
    op jsonFeed(@query region?: string, @query category?: string, @query funder?: string, @query closingWithin?: int32, @header ifNoneMatch?: string): OpenCallJsonFeedFile | FeedNotModified | BadRequest;

    /** The same calls as CSV; every cell formula-safe. */
    @summary("Open-call feed (CSV)")
    @get
    @route("/public/feeds/opportunities.csv")
    op csvFeed(@query region?: string, @query category?: string, @query funder?: string, @query closingWithin?: int32, @header ifNoneMatch?: string): OpenCallCsvFeedFile | FeedNotModified | BadRequest;

    /** The same calls as RSS 2.0. */
    @summary("Open-call feed (RSS)")
    @get
    @route("/public/feeds/opportunities.rss")
    op rssFeed(@query region?: string, @query category?: string, @query funder?: string, @query closingWithin?: int32, @header ifNoneMatch?: string): OpenCallRssFeedFile | FeedNotModified | BadRequest;

    /** For OpenGrants to pull: published calls with `publish.openGrantsIndex` and their public page on, open, forecasted or closed, as CommonGrants `OpportunityBase` records, least recently changed first. `modifiedSince` (ISO 8601) for an incremental pull; a record a full pull no longer lists is gone. No token. */
    @summary("OpenGrants index feed")
    @get
    @route("/public/feeds/opengrants.json")
    op openGrantsFeed(...PageParams, @query modifiedSince?: utcDateTime, @header ifNoneMatch?: string): OpenGrantsIndexFeedFile | FeedNotModified | BadRequest;
  }

  @tag("Syndication")
  namespace ShareThisCall {
    /** The "Share this call" panel: the feeds the call is in, what OpenGrants can pull, the PND submission and why it cannot go now, and applications started from those links. A read: agents see it too and are told a person sends. */
    @get @route("/opportunities/{id}/syndication") @useAuth(GmsOAuth<["opportunities:read"]> | UserSession)
    op get(@path id: GmsId): OkT<Syndication> | AuthErrors | NotFound;

    /** Take the call out of the open-call feeds, or put it back (`publish.feeds`). */
    @put @route("/opportunities/{id}/syndication/feeds") @useAuth(GmsOAuth<["opportunities:write"]> | UserSession)
    op setFeeds(@path id: GmsId, @body body: SyndicationFeedsInput): OkT<Syndication> | BadRequest | AuthErrors | NotFound;

    /** Exactly the email to PND, and its digest. Nothing is sent. A person who edits calls (admins and program officers): agent and API-client tokens get 403 `human_only`. 409 `pnd_already_sent`, `pnd_sending`, `pnd_not_listed`, `pnd_call_closed` or `pnd_too_late`; 422 `pnd_no_reply_to`; 503 `mail_not_configured`. */
    @post @route("/opportunities/{id}/syndication/pnd/preview") @useAuth(UserSession)
    op previewPnd(@path id: GmsId): OkT<PndPreview> | AuthErrors | NotFound | Conflict | Unprocessable | ServiceUnavailable;

    /** Send the call to PND if it is still exactly the preview (409 `preview_changed` otherwise). Once per call. 502 `mail_failed` records nothing, so the person can try again. */
    @post @route("/opportunities/{id}/syndication/pnd") @useAuth(UserSession)
    op sendPnd(@path id: GmsId, @body body: PndSendInput): OkT<PndSent> | BadRequest | AuthErrors | NotFound | Conflict | Unprocessable | ServiceUnavailable | BadGateway;
  }
}
