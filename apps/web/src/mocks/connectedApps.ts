// SPDX-License-Identifier: AGPL-3.0-only
// The connected-apps port in the browser (VITE_USE_MOCKS=true): Slack, a person's Google Calendar,
// Google Drive and Salesforce, with the same rules the server applies (an admin connects; agents
// cannot; events by workspace kind). Nothing leaves the page.
import { ApiError } from "../api/client.ts";
import type { AlertEvent, AppConnection, CalendarEntry, CalendarLink, ConnectedAppsApi, SlackAlerts, SlackChannel, WorkspaceApp } from "../api/connectedApps.ts";

export interface ConnectedAppsStore {
  connected: Record<WorkspaceApp, boolean>;
  channels: SlackChannel[];
  slack: Record<string, SlackAlerts["subscription"]>;
  calendars: CalendarEntry[];
  /** By workspace and person. */
  links: Record<string, CalendarLink>;
  /** Files "picked" in mock mode, by id. */
  driveFiles: Record<string, { name: string; type: string; text: string }>;
  saved: string[];
}

export const MOCK_DRIVE_FILE_ID = "1MockDriveBudget01";

export function seedConnectedAppsStore(): ConnectedAppsStore {
  return {
    connected: { slack: false, google_drive: false, salesforce: false },
    channels: [
      { id: "C0GRANTS01", name: "grants", member: true },
      { id: "C0GENERAL1", name: "general", member: false },
    ],
    slack: {},
    calendars: [
      { id: "primary", name: "My calendar", primary: true },
      { id: "grants@group.calendar.google.com", name: "Grant deadlines", primary: false },
    ],
    links: {},
    driveFiles: { [MOCK_DRIVE_FILE_ID]: { name: "Budget 2027.pdf", type: "application/pdf", text: "%PDF-1.7 mock budget" } },
    saved: [],
  };
}

export interface MockConnectedAppsOptions {
  store: ConnectedAppsStore;
  workspace: () => { id: string; kind: "funder" | "applicant"; role: string } | null;
  person: () => Promise<string | null>;
  now?: () => Date;
}

const FUNDER_EVENTS: AlertEvent[] = ["new_application", "review_assigned", "deadline_soon", "report_due", "payment_due"];
const APPLICANT_EVENTS: AlertEvent[] = ["deadline_soon", "report_due", "payment_due"];
const SCOPES: Record<WorkspaceApp, string[]> = { slack: ["chat:write", "channels:read"], google_drive: ["drive.file"], salesforce: ["api (SOQL read only)"] };

export function createMockConnectedAppsApi(opts: MockConnectedAppsOptions): ConnectedAppsApi {
  const { store } = opts;
  const now = () => (opts.now ?? (() => new Date()))().toISOString();
  const ws = () => opts.workspace() ?? { id: "", kind: "funder" as const, role: "admin" };
  // The server's rules (who may connect, which workspace kind) are tested against the API; the mock keeps what the screens show.
  const admin = ws;
  const view = (app: WorkspaceApp): AppConnection => ({ provider: app, connected: store.connected[app], status: store.connected[app] ? "active" : "not_connected", scopes: store.connected[app] ? SCOPES[app] : [], connectUrl: null });
  const linkKey = async () => `${ws().id}:${(await opts.person()) ?? "anon"}`;
  const emptyLink = (): CalendarLink => ({ configured: true, connected: false, status: "not_connected", calendar: null, events: 0, lastSyncAt: null });
  const synced = (link: CalendarLink) => ({ ...link, result: { created: link.events, updated: 0, deleted: 0, unchanged: 0, pending: 0 } });

  return {
    async connection(app) {
      admin();
      return view(app);
    },
    async connect(app) {
      admin();
      // Mock mode has no Google or Slack sign-in: the connection is made at once.
      store.connected[app] = true;
      return view(app);
    },
    async disconnect(app) {
      admin();
      store.connected[app] = false;
      if (app === "slack") delete store.slack[ws().id];
      return view(app);
    },
    async slack() {
      const w = admin();
      return { configured: true, connected: store.connected.slack, events: w.kind === "funder" ? FUNDER_EVENTS : APPLICANT_EVENTS, subscription: store.slack[w.id] ?? null, recent: [] };
    },
    async slackChannels() {
      admin();
      if (!store.connected.slack) throw new ApiError(409, "Connect Slack first", [{ code: "slack_not_connected" }]);
      return [...store.channels];
    },
    async saveSlack(input) {
      const w = admin();
      const channel = store.channels.find((c) => c.id === input.channelId);
      if (!channel) throw new ApiError(422, "That channel is not one of the public channels the Slack connection can see", [{ code: "channel_not_found" }]);
      const allowed = w.kind === "funder" ? FUNDER_EVENTS : APPLICANT_EVENTS;
      if (input.events.some((e) => !allowed.includes(e))) throw new ApiError(422, "These alerts are not available for this kind of workspace", [{ code: "event_not_available" }]);
      const prior = store.slack[w.id];
      const sub = { channelId: channel.id, channelName: channel.name, events: [...new Set(input.events)], enabled: input.enabled, locale: "en" as const, alertsFrom: input.enabled && !prior?.enabled ? now() : (prior?.alertsFrom ?? now()), updatedAt: now() };
      store.slack[w.id] = sub;
      return { ...sub, channelMember: channel.member };
    },
    async deleteSlack() {
      const w = admin();
      const had = !!store.slack[w.id];
      delete store.slack[w.id];
      return { deleted: had };
    },
    async calendar() {
      return store.links[await linkKey()] ?? emptyLink();
    },
    async connectCalendar() {
      const link: CalendarLink = { ...emptyLink(), connected: true, status: "active" };
      store.links[await linkKey()] = link;
      return { ...link, connectUrl: null };
    },
    async calendars() {
      if (!store.links[await linkKey()]) throw new ApiError(409, "Connect Google Calendar first", [{ code: "calendar_not_connected" }]);
      return [...store.calendars];
    },
    async chooseCalendar(calendarId) {
      const key = await linkKey();
      const chosen = store.calendars.find((c) => c.id === calendarId);
      if (!store.links[key] || !chosen) throw new ApiError(404, "Calendar not found", [{ code: "not_found" }]);
      const link: CalendarLink = { ...store.links[key]!, calendar: { id: chosen.id, name: chosen.name }, events: 3, lastSyncAt: now() };
      store.links[key] = link;
      return synced(link);
    },
    async syncCalendar() {
      const key = await linkKey();
      const link = store.links[key];
      if (!link?.calendar) throw new ApiError(409, "Connect Google Calendar and choose a calendar first", [{ code: "calendar_not_connected" }]);
      store.links[key] = { ...link, lastSyncAt: now() };
      return { ...store.links[key]!, result: { created: 0, updated: 0, deleted: 0, unchanged: link.events, pending: 0 } };
    },
    async disconnectCalendar() {
      delete store.links[await linkKey()];
      return emptyLink();
    },
    async fetchDriveFile(fileId) {
      if (!store.connected.google_drive) throw new ApiError(409, "Connect Google Drive first (Settings, Connected apps)", [{ code: "drive_not_connected" }]);
      const f = store.driveFiles[fileId];
      if (!f) throw new ApiError(422, "Google Drive would not open that file for the GMS", [{ code: "drive_not_found" }]);
      return new File([f.text], f.name, { type: f.type });
    },
    async saveToDrive(input) {
      if (!store.connected.google_drive) throw new ApiError(409, "Connect Google Drive first (Settings, Connected apps)", [{ code: "drive_not_connected" }]);
      const fileName = `As submitted - ${input.id}.pdf`;
      store.saved.push(fileName);
      return { fileId: `1MockSaved${String(store.saved.length).padStart(8, "0")}`, fileName, url: "https://drive.google.com/drive/my-drive" };
    },
  };
}
