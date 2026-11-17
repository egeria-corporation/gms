// SPDX-License-Identifier: AGPL-3.0-only
// Connected apps (v1.12.0, api/connectors.tsp): Slack alerts, a person's Google Calendar, an
// applicant's Google Drive and Salesforce (an import source). Connecting, choosing, posting,
// writing and copying are a signed-in person's; the server refuses agent and API-client tokens.
//
// `createHttpConnectedAppsApi` calls the GMS Worker; `createMockConnectedAppsApi`
// (mocks/connectedApps.ts) implements the same interface in the browser.
import { ApiError } from "./client.ts";
import type { components } from "./schema.d.ts";

type S = components["schemas"];
export type AlertEvent = S["Models.AlertEvent"];
export type SlackAlerts = S["Models.SlackAlerts"];
export type SlackChannel = S["Models.SlackChannel"];
export type SlackAlertsInput = S["Models.SlackAlertsInput"];
export type SlackAlertsSaved = S["Models.SlackAlertsSaved"];
export type CalendarLink = S["Models.CalendarLink"];
export type CalendarConnectStarted = S["Models.CalendarConnectStarted"];
export type CalendarEntry = S["Models.CalendarEntry"];
export type CalendarSynced = S["Models.CalendarSynced"];
export type DriveSaveInput = S["Models.DriveSaveInput"];
export type DriveSaved = S["Models.DriveSaved"];

/** The apps connected once for the whole workspace, by a workspace admin. */
export type WorkspaceApp = "slack" | "google_drive" | "salesforce";
export interface AppConnection {
  provider: WorkspaceApp;
  connected: boolean;
  status: string;
  scopes: string[];
  connectUrl?: string | null;
}

export interface ConnectedAppsApi {
  connection(app: WorkspaceApp): Promise<AppConnection>;
  /** Start (or finish) connecting: a Composio-hosted sign-in URL until the app is connected. */
  connect(app: WorkspaceApp, returnTo: string): Promise<AppConnection>;
  disconnect(app: WorkspaceApp): Promise<AppConnection>;

  slack(): Promise<SlackAlerts>;
  slackChannels(): Promise<SlackChannel[]>;
  saveSlack(input: SlackAlertsInput): Promise<SlackAlertsSaved>;
  deleteSlack(): Promise<{ deleted: boolean }>;

  calendar(): Promise<CalendarLink>;
  connectCalendar(returnTo: string): Promise<CalendarConnectStarted>;
  calendars(): Promise<CalendarEntry[]>;
  chooseCalendar(calendarId: string): Promise<CalendarSynced>;
  syncCalendar(): Promise<CalendarSynced>;
  disconnectCalendar(): Promise<CalendarLink>;

  /** The bytes of a file picked in the Google Picker, as a File the upload controls take. */
  fetchDriveFile(fileId: string): Promise<File>;
  saveToDrive(input: DriveSaveInput): Promise<DriveSaved>;
}

export interface HttpConnectedAppsOptions {
  baseUrl: string;
  token: () => Promise<string | null>;
  workspaceId: () => string | null;
  fetch?: typeof fetch;
}

export function createHttpConnectedAppsApi(opts: HttpConnectedAppsOptions): ConnectedAppsApi {
  const doFetch = opts.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  async function request(method: string, path: string, body?: unknown): Promise<Response> {
    const token = await opts.token();
    const workspaceId = opts.workspaceId();
    const res = await doFetch(`${opts.baseUrl}${path}`, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(workspaceId ? { "X-GMS-Workspace": workspaceId } : {}),
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as { message?: string; errors?: unknown[] };
      throw new ApiError(res.status, json.message ?? `Request failed (${res.status})`, json.errors ?? []);
    }
    return res;
  }
  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const json = (await (await request(method, path, body)).json()) as { data?: T };
    return json.data as T;
  }
  return {
    connection: (app) => call("GET", `/gms/connectors/${app}`),
    connect: (app, returnTo) => call("POST", `/gms/connectors/${app}`, { returnTo }),
    disconnect: (app) => call("DELETE", `/gms/connectors/${app}`),
    slack: () => call("GET", "/gms/connected-apps/slack"),
    slackChannels: () => call("GET", "/gms/connected-apps/slack/channels"),
    saveSlack: (input) => call("PUT", "/gms/connected-apps/slack", input),
    deleteSlack: () => call("DELETE", "/gms/connected-apps/slack"),
    calendar: () => call("GET", "/gms/connected-apps/calendar"),
    connectCalendar: (returnTo) => call("POST", "/gms/connected-apps/calendar", { returnTo }),
    calendars: () => call("GET", "/gms/connected-apps/calendar/calendars"),
    chooseCalendar: (calendarId) => call("PUT", "/gms/connected-apps/calendar", { calendarId }),
    syncCalendar: () => call("POST", "/gms/connected-apps/calendar/sync"),
    disconnectCalendar: () => call("DELETE", "/gms/connected-apps/calendar"),
    async fetchDriveFile(fileId) {
      const res = await request("POST", "/gms/connected-apps/google-drive/fetch", { fileId });
      const name = decodeURIComponent(res.headers.get("X-File-Name") ?? "") || "file";
      const blob = await res.blob();
      return new File([blob], name, { type: res.headers.get("Content-Type") ?? blob.type });
    },
    saveToDrive: (input) => call("POST", "/gms/connected-apps/google-drive/save", input),
  };
}
