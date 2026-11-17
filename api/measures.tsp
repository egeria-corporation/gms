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

// The growth measures (F3, docs/measures.md): nine numbers for OpenGrants' operators, each over the
// last 30 days with its 90-day target, and Google Search Console's figures for the GMS's own public
// pages. Operators only (the OPERATORS secret, else GALLERY_MODERATORS), signed in: agents and API
// clients get 401 `session_required`, anyone else 403 `not_an_operator`. Aggregate counts only:
// no answer holds a person, an organization, a page address or an id.

namespace GMS.Models {
  model OperatorStatus {
    /** Whether the signed-in person is one of OpenGrants' operators. */
    operator: boolean;
  }

  model MeasureWindow {
    from: utcDateTime;
    to: utcDateTime;
    days: int32;
  }

  /** A count over the window, its 90-day target and whether it is met. */
  model CountMeasure {
    value: int32;
    target: int32;
    met: boolean;
  }

  /** Measure 3: new applicant workspaces per call published, both counted over the window. Null when no call was published. */
  model PerCallMeasure {
    value: float64 | null;
    target: int32;
    met: boolean;
    newApplicantWorkspaces: int32;
    callsPublished: int32;
  }

  /** Measure 5: funders that published a call within `withinDays` after importing their history. */
  model SwitchMeasure {
    ...CountMeasure;
    withinDays: int32;
  }

  /** Measure 6: the share of awards made in the window with a share-kit post, and the clicks award posts reported. */
  model ShareKitMeasure {
    value: float64 | null;
    target: float64;
    met: boolean;
    awardsShared: int32;
    awardsEligible: int32;
    posts: int32;
    clicks: int32;
    postsWithClicks: int32;
    clicksPerPost: float64 | null;
  }

  /** Where measure 7 comes from, or why it is missing. */
  union OrganicSource {
    search_console: "search_console",
    not_configured: "not_configured",
    not_connected: "not_connected",
    no_site: "no_site",
    unavailable: "unavailable",
  }

  model SearchConsoleRange {
    start: plainDate;
    end: plainDate;
  }

  /** The plan's first week; `clicks` is null until Search Console's figures for it are final. */
  model OrganicBaselineWeek {
    start: plainDate;
    end: plainDate;
    clicks: int32 | null;
  }

  /** Measure 7: clicks from Google Search to funder pages and their calls, funds and awards (Search Console). */
  model OrganicVisitsMeasure {
    source: OrganicSource;
    value: int32 | null;
    impressions: int32 | null;
    weeklyAverage: float64 | null;
    range: SearchConsoleRange | null;
    baselineWeek: OrganicBaselineWeek | null;
    target: {
      multiple: int32;

      /** Visits a week to reach: the first week's times `multiple`. */
      value: float64 | null;
    };
    met: boolean | null;
  }

  /** Measure 8: the share of teammate invitations made in the window that were accepted. */
  model ShareMeasure {
    value: float64 | null;
    target: float64;
    met: boolean;
    sent: int32;
    accepted: int32;
  }

  /** Why a deal was lost: the growth plan's parity gaps, then common reasons. Never free text. */
  union LostDealReason {
    forms: "forms",
    reviews: "reviews",
    reporting: "reporting",
    payments: "payments",
    procurement: "procurement",
    languages: "languages",
    integrations: "integrations",
    data_migration: "data_migration",
    support: "support",
    went_elsewhere: "went_elsewhere",
    timing: "timing",
    no_decision: "no_decision",
    other: "other",
  }

  model LostDealCount {
    reason: LostDealReason;
    count: int32;
  }

  /** Measure 9: deals lost in the window, by stated reason (every reason, zeros included). */
  model DealsLostMeasure {
    total: int32;
    byReason: LostDealCount[];
  }

  model OperatorMeasures {
    window: MeasureWindow;
    fundersWithOpenCall: CountMeasure;
    activeApplicantWorkspaces: CountMeasure;
    newApplicantWorkspacesPerCall: PerCallMeasure;
    fundersJoinedFromApplicantLinks: CountMeasure;
    switchedFundersWithCall: SwitchMeasure;
    shareKit: ShareKitMeasure;
    organicVisits: OrganicVisitsMeasure;
    invitedTeammatesJoined: ShareMeasure;
    dealsLost: DealsLostMeasure;
  }

  model LostDealInput {
    reason: LostDealReason;

    /** The day it was lost; today when left out. Not in the future, not over a year ago. */
    lostOn?: plainDate;
  }

  model LostDealRecorded {
    recorded: true;
    reason: LostDealReason;
    lostOn: plainDate;
  }

  model SearchConsoleProperty {
    /** `sc-domain:<domain>` or `https://<host>/`. */
    siteUrl: string;

    permissionLevel: string;
  }

  model SearchConsoleState {
    /** False until COMPOSIO_SEARCH_CONSOLE_AUTH_CONFIG_ID is set on the server. */
    available: boolean;

    connected: boolean;

    /** Why a connection is not usable: connect again, it held more than read-only access (removed), or Composio did not answer. */
    problem: "reconnect" | "too_broad" | "unreachable" | null;

    /** The chosen property, or null. */
    site: string | null;

    /** The properties the connected account can read that cover the GMS's own host; never its other sites. */
    sites: SearchConsoleProperty[];
  }

  model SearchConsoleConnect {
    connected: boolean;

    /** A Composio-hosted Google sign-in that returns to the measures page; null once connected. */
    connectUrl: url | null;
  }

  model SearchConsoleDisconnected {
    connected: false;
    site: null;
  }

  model SearchConsoleSiteInput {
    @maxLength(300) siteUrl: string;
  }

  model SearchConsoleSiteChosen {
    site: string;
  }

  /** Kinds of public page. Pages are grouped by kind because an address names a funder. */
  union PageKind {
    home: "home",
    funder: "funder",
    opportunity: "opportunity",
    fund: "fund",
    awards: "awards",
    award: "award",
    switch: "switch",
    templates: "templates",
    for_funders: "for_funders",
    partners: "partners",
    other: "other",
  }

  model PageKindTotal {
    kind: PageKind;
    clicks: int32;
    impressions: int32;
  }

  model SearchTotals {
    clicks: int32;
    impressions: int32;
  }

  model SearchConsoleReport {
    site: string;

    /** The 30 days Search Console has final figures for (they run about three days behind). */
    range: SearchConsoleRange;

    totals: SearchTotals;

    /** By kind of page, most clicked first. */
    pages: PageKindTotal[];

    /** Funder pages and their calls, funds and awards: measure 7. */
    organic: SearchTotals;

    baselineWeek: OrganicBaselineWeek;
  }
}

namespace GMS.Routes.Custom {
  @tag("Operator measures")
  namespace Measures {
    /** Whether the signed-in person is one of OpenGrants' operators. */
    @get @route("/operator/me") @useAuth(UserSession)
    op operatorStatus(): OkT<OperatorStatus> | AuthErrors;

    /** The nine growth measures over the last 30 days, each with its 90-day target. Counts only. Operators only (403 `not_an_operator`); 503 `measures_unavailable` without the database's measures. */
    @get @route("/operator/measures") @useAuth(UserSession)
    op operatorMeasures(): OkT<OperatorMeasures> | AuthErrors | ServiceUnavailable;

    /** Record a deal lost, by its stated reason. Nothing else is kept: no name, no note. 422 `invalid_date`. */
    @post @route("/operator/lost-deals") @useAuth(UserSession)
    op recordLostDeal(@body body: LostDealInput): CreatedT<LostDealRecorded> | BadRequest | AuthErrors | Unprocessable;

    /** Whether Search Console is set up and connected, the chosen property, and the properties that cover the GMS's host. */
    @get @route("/operator/search-console") @useAuth(UserSession)
    op searchConsoleState(): OkT<SearchConsoleState> | AuthErrors;

    /** Start connecting Google Search Console (read only) through Composio. 404 `search_console_unavailable` when it is not set up. */
    @post @route("/operator/search-console/connect") @useAuth(UserSession)
    op connectSearchConsole(): OkT<SearchConsoleConnect> | AuthErrors | NotFound;

    /** Remove the connection at Composio and forget the property. */
    @delete @route("/operator/search-console") @useAuth(UserSession)
    op disconnectSearchConsole(): OkT<SearchConsoleDisconnected> | AuthErrors | NotFound;

    /** Choose the property: one the connected account can read that covers the GMS's host. 422 `site_not_gms`, `site_not_found`. */
    @put @route("/operator/search-console/site") @useAuth(UserSession)
    op chooseSearchConsoleSite(@body body: SearchConsoleSiteInput): OkT<SearchConsoleSiteChosen> | BadRequest | AuthErrors | NotFound | Unprocessable;

    /** Clicks and impressions for the GMS's public pages over the last 30 days Search Console has, by kind of page. 409 `search_console_site_required`, `search_console_reconnect`; 503 `search_console_unreachable`. */
    @get @route("/operator/search-console/report") @useAuth(UserSession)
    op searchConsoleReport(): OkT<SearchConsoleReport> | AuthErrors | NotFound | Conflict | ServiceUnavailable;
  }
}
