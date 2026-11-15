import "@typespec/http";
import "@common-grants/core";
import "./models.tsp";
import "./routes.tsp";
import "./outside.tsp";

using TypeSpec.Http;
using CommonGrants.Responses;
using CommonGrants.Fields;
using GMS.Models;
using GMS.Auth;
using GMS.Errors;
using GMS.HttpResponses;

// Open data exports (docs/open-data.md): a funder's awards in the 360Giving Data Standard (schema
// 1.4.3, JSON and CSV) and its published opportunities and awards as CommonGrants v0.5.0. Only
// accepted and later awards go out; never offers, cancelled awards, awards to individuals,
// unlinked recipients or awards marked confidential. A recipient is named with its Passport
// record (legal name, EIN, address) only while it is verified and shares its record with the
// funder; any other recipient by name only. Nothing here carries bank or identity data.

namespace GMS.Models {
  /** Award dates, inclusive; null for no bound. */
  model OpenDataRange {
    from: plainDate | null;
    to: plainDate | null;
  }

  union OpenDataExclusion {
    not_accepted: "not_accepted",
    cancelled: "cancelled",
    individual: "individual",
    no_organization: "no_organization",
    confidential: "confidential",
    no_amount: "no_amount",
  }

  model OpenDataLeftOut {
    reason: OpenDataExclusion;

    /** Plain language, e.g. "Marked confidential". */
    label: string;

    count: int32;
  }

  /** One award in the period and what the export does with it. */
  model OpenDataAwardRow {
    awardId: PrefixedId;
    title: string;

    /** "An individual" for an award to a person: this feature never shows a person's name. */
    recipientName: string;

    awardedAmount: Money | null;
    awardDate: plainDate;
    status: string;
    exported: boolean;
    reason: OpenDataExclusion | null;
    reasonLabel: string | null;

    /** Exported by name only: the recipient is not verified with Passport or does not share its record with this funder. */
    nameOnly: boolean;

    confidential: boolean;
  }

  model OpenDataSettingsState {
    /** The funder's registered 360Giving publisher prefix (`360G-…`); null until it registers. */
    threeSixtyGivingPrefix: string | null;

    /** "Publish my awards as open data": the public feed. Off by default. */
    publishFeed: boolean;
  }

  /** What an export of the period would hold, what it leaves out and why. */
  model OpenDataSummary {
    range: OpenDataRange;
    settings: OpenDataSettingsState;

    /** No registered prefix: the 360Giving file is a draft (identifiers start with `DRAFT-`). */
    draft: boolean;

    /** Where a funder registers as a 360Giving publisher. */
    registerUrl: url;

    /** The public feed, only while it is switched on. */
    feedUrl: url | null;

    license: {
      name: string;
      url: url;
    };
    counts: {
      inRange: int32;
      exported: int32;
      leftOut: int32;
      nameOnly: int32;
    };

    /** Only the reasons that leave something out. */
    leftOut: OpenDataLeftOut[];

    commonGrants: {
      opportunities: int32;
      awards: int32;
    };

    /** The awards in the period (at most 500 rows; `counts` covers them all). */
    awards: OpenDataAwardRow[];

    awardsShown: int32;
  }

  /** Merge patch: a key that is not sent keeps its value. Publishing needs a prefix (409 `prefix_required`). */
  model OpenDataSettingsInput {
    /** `360G-` and the publisher's code, as 360Giving issued it; null removes it. */
    threeSixtyGivingPrefix?: string | null;

    publishFeed?: boolean;
  }

  model OpenDataSettingsView {
    ...OpenDataSettingsState;
    feedUrl: url | null;
  }

  model OpenDataConfidentialInput {
    confidential: boolean;
  }

  model OpenDataConfidential {
    awardId: PrefixedId;
    confidential: boolean;
  }

  /** A 360Giving organization (schema `#/$defs/Organization`). Address and web address only from a verified, shared Passport record. */
  model ThreeSixtyGivingOrganization {
    /** `US-EIN-12-3456789`, or `<prefix>-<id>` for an organization the export does not name by its EIN. */
    id: string;

    name: string;
    streetAddress?: string;
    addressLocality?: string;
    addressRegion?: string;
    postalCode?: string;
    addressCountry?: string;
    url?: url;
  }

  /** One grant in the 360Giving Data Standard (schema 1.4.3). */
  model ThreeSixtyGivingGrant {
    /** `<360Giving prefix>-<award id>`; `DRAFT-<handle>-<award id>` without a registered prefix. */
    id: string;

    title: string;
    description: string;

    /** ISO 4217. */
    currency: string;

    amountAwarded: float64;
    awardDate: plainDate;
    plannedDates?: {
      startDate: plainDate;
      endDate?: plainDate;
    }[];
    recipientOrganization: ThreeSixtyGivingOrganization[];
    fundingOrganization: ThreeSixtyGivingOrganization[];
    grantProgramme?: {
      code: string;
      title: string;
    }[];
    dateModified: utcDateTime;
  }

  /** A 360Giving data package (schema `360-giving-package-schema.json`). */
  model ThreeSixtyGivingPackage {
    /** The schema version, major.minor. */
    version: "1.4";

    title: string;
    description: string;
    modified: utcDateTime;
    identifier: string;
    publisher: {
      name: string;
      identifier: string;
      website?: url;
      logo?: url;
    };
    license: url;
    accessURL?: url;
    downloadURL?: url;
    grants: ThreeSixtyGivingGrant[];
  }

  /** Published opportunities and exported awards, each a CommonGrants v0.5.0 record validated with `@common-grants/sdk`. */
  model CommonGrantsOpenData {
    commonGrants: "0.5.0";
    generatedAt: utcDateTime;
    range: OpenDataRange;
    opportunities: CommonGrants.Models.OpportunityBase[];

    /** A recipient appears in `recipientOrganizations` only while it is verified with Passport and shares its record. */
    awards: CommonGrants.Models.AwardBase[];
  }

  model ThreeSixtyGivingFile {
    @statusCode statusCode: 200;
    @header contentType: "application/json; charset=utf-8";
    @header contentDisposition: string;

    /** `true` on a draft (no registered prefix). */
    @header("X-Open-Data-Draft") draft?: "true";

    @body body: ThreeSixtyGivingPackage;
  }

  model ThreeSixtyGivingCsvFile {
    @statusCode statusCode: 200;
    @header contentType: "text/csv; charset=utf-8";
    @header contentDisposition: string;
    @header("X-Open-Data-Draft") draft?: "true";
    @body body: string;
  }

  model CommonGrantsOpenDataFile {
    @statusCode statusCode: 200;
    @header contentType: "application/json; charset=utf-8";
    @header contentDisposition: string;
    @body body: CommonGrantsOpenData;
  }

  model ThreeSixtyGivingFeed {
    @statusCode statusCode: 200;
    @header contentType: "application/json; charset=utf-8";

    /** `public, max-age=300, s-maxage=900`. */
    @header cacheControl: string;

    @header etag: string;
    @header("Access-Control-Allow-Origin") allowOrigin: "*";
    @body body: ThreeSixtyGivingPackage;
  }

  model OpenDataNotModified {
    @statusCode statusCode: 304;
    @header etag: string;
  }
}

namespace GMS.Routes.Custom {
  @tag("Open data")
  namespace OpenData {
    /** What an export of the period would hold (`year`, or `from` and `to`, by award date; all years when none is given), what it leaves out and why. Funder admins, program officers, finance and auditors. */
    @get @route("/open-data/summary") @useAuth(GmsOAuth<["analytics:read"]> | UserSession)
    op openDataSummary(@query year?: string, @query from?: plainDate, @query to?: plainDate): OkT<OpenDataSummary> | BadRequest | AuthErrors;

    /** The 360Giving JSON package for the period. 409 `nothing_to_export` when no award in it can go out. */
    @get @route("/open-data/360giving.json") @useAuth(GmsOAuth<["analytics:read"]> | UserSession)
    op threeSixtyGivingJson(@query year?: string, @query from?: plainDate, @query to?: plainDate): ThreeSixtyGivingFile | BadRequest | AuthErrors | Conflict;

    /** The same grants as a CSV with the 360Giving column titles. */
    @get @route("/open-data/360giving.csv") @useAuth(GmsOAuth<["analytics:read"]> | UserSession)
    op threeSixtyGivingCsv(@query year?: string, @query from?: plainDate, @query to?: plainDate): ThreeSixtyGivingCsvFile | BadRequest | AuthErrors | Conflict;

    /** Published opportunities (by publish date) and exported awards (by award date) as CommonGrants v0.5.0. */
    @get @route("/open-data/commongrants.json") @useAuth(GmsOAuth<["analytics:read"]> | UserSession)
    op commonGrantsJson(@query year?: string, @query from?: plainDate, @query to?: plainDate): CommonGrantsOpenDataFile | BadRequest | AuthErrors | Conflict;

    /** The 360Giving prefix and the "Publish my awards as open data" switch. A workspace admin, signed in: API clients and agents are refused (403 `human_only`). */
    @put @route("/open-data/settings") @useAuth(UserSession)
    op updateOpenDataSettings(@body body: OpenDataSettingsInput): OkT<OpenDataSettingsView> | BadRequest | AuthErrors | Conflict;

    /** Mark an award confidential (never exported) or clear the mark. An admin or program officer, signed in (403 `human_only` otherwise). */
    @put @route("/open-data/awards/{id}/confidential") @useAuth(UserSession)
    op setAwardConfidential(@path id: GmsId, @body body: OpenDataConfidentialInput): OkT<OpenDataConfidential> | BadRequest | AuthErrors | NotFound | Conflict;

    /** The public feed: every award the export would hold, all years, in 360Giving JSON. No token. 404 unless the funder has a registered prefix and has switched publishing on, and while there is nothing to publish. Read-only and cached; an unchanged body answers 304. */
    @get @route("/open-data/{handle}/360giving.json")
    op openDataFeed(@path handle: string, @header ifNoneMatch?: string): ThreeSixtyGivingFeed | OpenDataNotModified | NotFound;
  }
}
