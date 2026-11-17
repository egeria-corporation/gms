import "@typespec/http";
import "@common-grants/core";
import "./models.tsp";
import "./routes.tsp";
import "./importer-adapters.tsp";

using TypeSpec.Http;
using CommonGrants.Responses;
using GMS.Models;
using GMS.Auth;
using GMS.Errors;
using GMS.HttpResponses;

// Connected apps through Composio (v1.12.0, docs/connectors.md). Slack: a workspace admin picks one
// public channel and the events to hear about; the jobs Worker posts one message per event (the
// event, the record title and a link, never answers, emails or amounts). Google Calendar: each
// person connects their own and picks one of their calendars; deadlines are written as all-day
// events and kept in step (created, updated, deleted). Google Drive (applicants, `drive.file`):
// copy a file picked in the Google Picker for an upload, and save the as-submitted PDF to Drive.
// Salesforce is a read-only import source (the `salesforce` source of `/gms/imports`). Slack,
// Google Drive and Salesforce connect through `/gms/connectors/{provider}`. Connecting, choosing,
// posting, writing and copying are a signed-in person's only: agent and API-client tokens get 403.

namespace GMS.Models {
  union AlertEvent {
    newApplication: "new_application",
    reviewAssigned: "review_assigned",

    /** An opportunity closing (funders), or an application deadline (applicants), within three days. */
    deadlineSoon: "deadline_soon",

    reportDue: "report_due",
    paymentDue: "payment_due",
  }

  model SlackAlertSettings {
    channelId: string;
    channelName: string;
    events: AlertEvent[];
    enabled: boolean;

    /** The language messages are written in: the admin's when they saved the settings. */
    locale: "en" | "es";

    /** Nothing that happened before this moment is alerted. */
    alertsFrom: utcDateTime;

    updatedAt: utcDateTime;
  }

  model SlackAlerts {
    /** Slack through Composio is set up on this server. */
    configured: boolean;

    connected: boolean;

    /** The events this kind of workspace can hear about. */
    events: AlertEvent[];

    subscription: SlackAlertSettings | null;

    /** The latest alerts, newest first: the event and how it went. No message text is kept. */
    recent: {
      event: AlertEvent;
      status: "sending" | "sent" | "failed";
      at: utcDateTime;
    }[];
  }

  model SlackChannel {
    id: string;
    name: string;

    /** Whether the GMS's Slack app is in the channel; Slack refuses posts to one it is not in. */
    member: boolean;
  }

  model SlackAlertsInput {
    /** A public channel's id, from `GET /gms/connected-apps/slack/channels`. */
    channelId: string;

    events: AlertEvent[];
    enabled: boolean;
  }

  model SlackAlertsSaved {
    ...SlackAlertSettings;
    channelMember: boolean;
  }

  model CalendarLink {
    /** Google Calendar through Composio is set up on this server. */
    configured: boolean;

    connected: boolean;
    status: "not_connected" | "pending" | "active" | "error";
    calendar: {
      id: string;
      name: string;
    } | null;

    /** How many deadlines are in the calendar. */
    events: int32;

    lastSyncAt: utcDateTime | null;
  }

  model CalendarConnectInput {
    /** A page of this workspace (`/w/<handle>/…`) Composio returns to after Google's sign-in. */
    returnTo?: string;
  }

  model CalendarConnectStarted {
    ...CalendarLink;

    /** Composio's hosted Google sign-in; null when already connected. */
    connectUrl: string | null;
  }

  model CalendarEntry {
    id: string;
    name: string;
    primary: boolean;
  }

  model CalendarChooseInput {
    calendarId: string;
  }

  model CalendarSynced {
    ...CalendarLink;
    result: {
      created: int32;
      updated: int32;
      deleted: int32;
      unchanged: int32;

      /** Writes left for the next hourly run. */
      pending: int32;
    };
  }

  model DriveFetchInput {
    /** The file's id from the Google Picker. */
    fileId: string;
  }

  model DriveSaveInput {
    /** `application`: an application submitted on this GMS. `outside`: an outside application's as-submitted PDF. */
    kind: "application" | "outside";

    id: string;

    /** A folder picked in the Google Picker; My Drive when left out. */
    folderId?: string;
  }

  model DriveSaved {
    fileId: string;
    fileName: string;
    url: string;
  }

  /** Salesforce, read only (v1.12.0): a preset, or a SOQL SELECT of the person's own. */
  model ImportSalesforceSource {
    kind: "salesforce";

    /** `npsp_grants`: Nonprofit Success Pack Opportunities with a grant record type; `accounts`: Accounts. */
    preset?: "npsp_grants" | "accounts";

    /** One SELECT; FOR UPDATE, FOR VIEW, FOR REFERENCE and UPDATE TRACKING are refused (422 `invalid_query`). */
    query?: string;
  }
}

namespace GMS.HttpResponses {
  /** The bytes of a file picked in Google Drive, with its own type; the name is in `X-File-Name` (URI-encoded). */
  model DriveFileBytes {
    @statusCode statusCode: 200;
    @header contentType: string;
    @header("X-File-Name") fileName: string;
    @body body: bytes;
  }
}

namespace GMS.Routes.Custom {
  @tag("Connected apps")
  namespace ConnectedApps {
    /** The workspace's Slack alert settings, the events it can have and the latest alerts. Workspace admins. */
    @get @route("/connected-apps/slack") @useAuth(GmsOAuth<["workspace:admin"]> | UserSession)
    op slack(): OkT<SlackAlerts> | AuthErrors;

    /** Public channels the Slack connection can see (read only). 409 `slack_not_connected`. */
    @get @route("/connected-apps/slack/channels") @useAuth(GmsOAuth<["workspace:admin"]> | UserSession)
    op slackChannels(): OkT<SlackChannel[]> | AuthErrors | Conflict | Unprocessable | ServiceUnavailable;

    /** Choose the channel and events, or turn alerts on or off. Workspace admins, in person. 422 `channel_not_found`, `event_not_available`. */
    @put @route("/connected-apps/slack") @useAuth(UserSession)
    op saveSlack(@body body: SlackAlertsInput): OkT<SlackAlertsSaved> | BadRequest | AuthErrors | Conflict | Unprocessable | ServiceUnavailable;

    /** Stop the alerts and forget the settings. Workspace admins, in person. */
    @delete @route("/connected-apps/slack") @useAuth(UserSession)
    op deleteSlack(): OkT<DeletedResult> | AuthErrors;

    /** My Google Calendar link in this workspace. */
    @get @route("/connected-apps/calendar") @useAuth(UserSession)
    op calendar(): OkT<CalendarLink> | AuthErrors;

    /** Start connecting my own Google Calendar: Composio's hosted sign-in. In person. */
    @post @route("/connected-apps/calendar") @useAuth(UserSession)
    op connectCalendar(@body body: CalendarConnectInput): OkT<CalendarConnectStarted> | BadRequest | AuthErrors | Unprocessable | ServiceUnavailable;

    /** The calendars I own (events are written only there). 409 `calendar_not_connected`. */
    @get @route("/connected-apps/calendar/calendars") @useAuth(UserSession)
    op calendars(): OkT<CalendarEntry[]> | AuthErrors | Conflict | ServiceUnavailable;

    /** Choose the calendar and write my deadlines now. Moving to another calendar removes them from the first. In person. */
    @put @route("/connected-apps/calendar") @useAuth(UserSession)
    op chooseCalendar(@body body: CalendarChooseInput): OkT<CalendarSynced> | BadRequest | AuthErrors | NotFound | Conflict | ServiceUnavailable;

    /** Write my deadlines now instead of at the next hourly run. In person. */
    @post @route("/connected-apps/calendar/sync") @useAuth(UserSession)
    op syncCalendar(): OkT<CalendarSynced> | AuthErrors | Conflict | ServiceUnavailable;

    /** Remove the events written, then the connection, then the link. In person. */
    @delete @route("/connected-apps/calendar") @useAuth(UserSession)
    op disconnectCalendar(): OkT<CalendarLink> | AuthErrors | ServiceUnavailable;

    /**
     * The bytes of a file picked in the Google Picker, for the browser to upload like a file from
     * the computer (same size and type checks). Nothing is stored. Applicant admins, editors and
     * finance, in person. 413 `drive_too_large` over 25 MB; 422 `drive_not_found`, `drive_folder`.
     */
    @post @route("/connected-apps/google-drive/fetch") @useAuth(UserSession)
    op fetchDriveFile(@body body: DriveFetchInput): DriveFileBytes | BadRequest | AuthErrors | Conflict | Unprocessable | PayloadTooLarge | ServiceUnavailable;

    /** Save the as-submitted PDF to Google Drive through `drive.file`. In person. 409 `not_submitted`. */
    @post @route("/connected-apps/google-drive/save") @useAuth(UserSession)
    op saveToDrive(@body body: DriveSaveInput): CreatedT<DriveSaved> | BadRequest | AuthErrors | NotFound | Conflict | Unprocessable | PayloadTooLarge | ServiceUnavailable;
  }
}
