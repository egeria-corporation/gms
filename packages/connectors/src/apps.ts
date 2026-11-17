// SPDX-License-Identifier: AGPL-3.0-only
// Connected apps through Composio (v1.12.0): Slack alerts, Google Calendar events, Google Drive
// attach and save (applicants), and a Salesforce import source, read-only.
//
// One Composio auth config per toolkit, each from its own Wrangler secret:
//   COMPOSIO_SLACK_AUTH_CONFIG_ID            slack           chat:write, channels:read
//   COMPOSIO_GOOGLE_CALENDAR_AUTH_CONFIG_ID  googlecalendar  calendar.calendarlist.readonly, calendar.events.owned
//   COMPOSIO_GOOGLE_DRIVE_AUTH_CONFIG_ID     googledrive     drive.file
//   COMPOSIO_SALESFORCE_AUTH_CONFIG_ID       salesforce      api (read through SOQL only)
// The Composio entity (`user_id`) is the GMS workspace id. Slack, Drive and Salesforce are one
// connection per workspace; Google Calendar is one connection per person, on the same entity, and
// the GMS keeps that person's connected account id (calendar_links) so it only ever acts on it.
//
// Composio holds every provider token; the GMS stores none. Each connection's scopes are read from
// Composio and checked before every use: a connection holding anything beyond the list is deleted
// at Composio and refused; one that reports no scopes, or lacks a required one, is not used.
//
// Only these predefined tools are executed (APP_TOOLS), with the arguments written below; nothing
// else is ever sent to Composio's tool endpoint. Saving a PDF to Drive uses the proxy, as the
// funder's Drive export does (./composio.ts), so the exact Google request is in this repository.
// Slugs and argument names were checked with Composio's tool search and schemas on 2026-11-17;
// docs/connectors.md lists what is still unverified. Nothing here has run against Composio.
import { ComposioError, ConnectorScopeError, ConnectorScopeUnverifiedError, driveMultipart, GOOGLE_API, GOOGLE_DRIVE_FILE, normalizeScopes, type ComposioClient, type ConnectedAccount, type FetchLike } from "./composio.ts";
import { ConnectorAuthError, ConnectorUnavailableError, isRegistrableMcpUrl } from "./index.ts";
import { dig, SourceReadError } from "./tabular.ts";

export type AppProvider = "slack" | "google_calendar" | "google_drive" | "salesforce";
export const APP_PROVIDERS: readonly AppProvider[] = ["slack", "google_calendar", "google_drive", "salesforce"];

export const SLACK_CHAT_WRITE = "chat:write";
export const SLACK_CHANNELS_READ = "channels:read";
export const GOOGLE_CALENDARLIST_READONLY = "https://www.googleapis.com/auth/calendar.calendarlist.readonly";
export const GOOGLE_CALENDAR_EVENTS_OWNED = "https://www.googleapis.com/auth/calendar.events.owned";
export const SALESFORCE_API = "api";

/** The tools these connectors may execute. Nothing else is ever sent to Composio's tool endpoint. */
export const APP_TOOLS = {
  slackChannels: "SLACK_LIST_ALL_CHANNELS",
  slackPost: "SLACK_SEND_MESSAGE",
  calendarList: "GOOGLECALENDAR_LIST_CALENDARS",
  calendarCreate: "GOOGLECALENDAR_CREATE_EVENT",
  calendarPatch: "GOOGLECALENDAR_PATCH_EVENT",
  calendarDelete: "GOOGLECALENDAR_DELETE_EVENT",
  driveMetadata: "GOOGLEDRIVE_GET_FILE_METADATA",
  driveDownload: "GOOGLEDRIVE_DOWNLOAD_FILE",
  salesforceQuery: "SALESFORCE_RUN_SOQL_QUERY",
  salesforceMore: "SALESFORCE_QUERY_MORE",
} as const;
type AppTool = (typeof APP_TOOLS)[keyof typeof APP_TOOLS];

const IDENTITY = ["openid", "email", "profile", "https://www.googleapis.com/auth/userinfo.email", "https://www.googleapis.com/auth/userinfo.profile"];

interface ScopeRules {
  label: string;
  allowed: ReadonlySet<string>;
  /** Never allowed, even if the allow-list were edited by mistake. */
  forbidden: readonly RegExp[];
  /** Every one of these must be granted for the connection to be usable. */
  required: readonly string[];
}

/**
 * What each connection may hold. The narrowest reading of the brief: Slack posts and lists public
 * channels (never reads a message, a private channel or a person); Calendar lists the person's
 * calendars and writes events on calendars they own; Drive reaches only files picked in the Google
 * Picker or created by the GMS; Salesforce has no read-only OAuth scope, so `api` is held and the
 * connector only ever runs a SOQL SELECT. Relax one entry here, and nowhere else.
 */
export const APP_SCOPE_RULES: Record<AppProvider, ScopeRules> = {
  slack: {
    label: "Slack",
    allowed: new Set([SLACK_CHAT_WRITE, SLACK_CHANNELS_READ]),
    forbidden: [/history$/, /^users[:.]/, /^im:/, /^mpim:/, /^groups:/, /^files:/, /^admin/, /^channels:(manage|write|join)/, /^chat:write\.(customize|public)$/],
    required: [SLACK_CHAT_WRITE, SLACK_CHANNELS_READ],
  },
  google_calendar: {
    label: "Google Calendar",
    allowed: new Set([GOOGLE_CALENDARLIST_READONLY, GOOGLE_CALENDAR_EVENTS_OWNED, ...IDENTITY]),
    forbidden: [/\/auth\/calendar$/, /\/auth\/calendar\.readonly$/, /\/auth\/calendar\.events$/, /\/auth\/calendar\.events\.readonly$/, /\/auth\/calendar\.acls/, /\/auth\/calendar\.settings/, /\/auth\/calendar\.calendars/, /\/auth\/drive/, /\/auth\/gmail/],
    required: [GOOGLE_CALENDARLIST_READONLY, GOOGLE_CALENDAR_EVENTS_OWNED],
  },
  google_drive: {
    label: "Google Drive",
    allowed: new Set([GOOGLE_DRIVE_FILE, ...IDENTITY]),
    forbidden: [/\/auth\/drive$/, /\/auth\/drive\.readonly$/, /\/auth\/drive\.metadata/, /\/auth\/drive\.appdata$/, /\/auth\/drive\.photos/, /\/auth\/drive\.scripts$/],
    required: [GOOGLE_DRIVE_FILE],
  },
  salesforce: {
    label: "Salesforce",
    allowed: new Set([SALESFORCE_API, "refresh_token", "offline_access", "id", "openid", "profile", "email"]),
    forbidden: [/^full$/, /^web$/, /^visualforce$/, /^chatter_api$/, /^wave_api$/, /^cdp_/, /^custom_permissions$/, /^pardot_api$/, /^eclair_api$/, /^lightning$/, /^content$/, /^sfap_api$/, /^interaction_api$/],
    required: [SALESFORCE_API],
  },
};

export interface AppScopeCheck {
  ok: boolean;
  excess: string[];
  missing: string[];
}

/** A connection passes only when every scope it holds is on the provider's allow-list. */
export function checkAppScopes(provider: AppProvider, scopes: unknown): AppScopeCheck {
  const r = APP_SCOPE_RULES[provider];
  const list = normalizeScopes(scopes);
  const excess = list.filter((s) => !r.allowed.has(s) || r.forbidden.some((re) => re.test(s)));
  return { ok: excess.length === 0, excess, missing: r.required.filter((s) => !list.includes(s)) };
}

/** What the connector_accounts row records for each: the scope names only, never a credential. */
export const APP_SCOPE_NAMES: Record<AppProvider, string[]> = {
  slack: [SLACK_CHAT_WRITE, SLACK_CHANNELS_READ],
  google_calendar: ["calendar.calendarlist.readonly", "calendar.events.owned"],
  google_drive: ["drive.file"],
  salesforce: ["api (SOQL read only)"],
};

// ------------------------------------------------------------------------------------- shared

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

export interface AppConfig {
  client: ComposioClient;
  /** The auth config created for this toolkit with exactly the scopes above. */
  authConfigId: string;
  callbackUrl: (entityId: string, returnTo?: string) => string;
}

export interface Connection {
  readonly provider: AppProvider;
  /** Whether the workspace is connected. With `link`, one that is not gets a Composio-hosted sign-in link. */
  status(entityId: string, opts?: { link?: boolean; returnTo?: string }): Promise<{ connected: boolean; connectUrl: string | null }>;
  /** Remove every connection the workspace has on this auth config at Composio. */
  disconnect(entityId: string): Promise<void>;
}

abstract class ComposioApp implements Connection {
  abstract readonly provider: AppProvider;
  constructor(protected readonly cfg: AppConfig) {
    if (!cfg.authConfigId) throw new Error("The Composio auth config id is not set");
  }

  protected get rules(): ScopeRules {
    return APP_SCOPE_RULES[this.provider];
  }

  protected async wrap<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof ComposioError) {
        if (e.status === 401 || e.status === 403 || e.status === 422) throw new ConnectorAuthError("composio");
        throw new ConnectorUnavailableError("composio", "Composio could not be reached");
      }
      throw e;
    }
  }

  /** One account, after the checks: on this auth config, this entity, active, and within the scopes. Null when not usable yet. */
  protected async checked(account: ConnectedAccount, entityId: string): Promise<ConnectedAccount | null> {
    if (account.status !== "ACTIVE" || account.authConfigId !== this.cfg.authConfigId) return null;
    if (account.userId !== null && account.userId !== entityId) return null;
    if (!account.grantedScopes.length && !account.requestedScopes.length) throw new ConnectorScopeUnverifiedError(`The permissions of the ${this.rules.label} connection could not be read, so it is not being used. Disconnect and connect again.`);
    const scopes = checkAppScopes(this.provider, [...account.grantedScopes, ...account.requestedScopes]);
    if (!scopes.ok) {
      await this.cfg.client.deleteConnectedAccount(account.id);
      throw new ConnectorScopeError(scopes.excess, `The ${this.rules.label} connection was given more access than the GMS allows, so it was removed. Connect again and keep the permissions asked for.`);
    }
    if (scopes.missing.length) throw new ConnectorScopeUnverifiedError(`The ${this.rules.label} connection does not include the access the GMS needs. Disconnect and connect again, and keep the permissions asked for.`);
    return account;
  }

  /** The workspace's live connection, after the scope check. */
  protected async active(entityId: string): Promise<ConnectedAccount | null> {
    const listed = await this.cfg.client.listConnectedAccounts({ authConfigId: this.cfg.authConfigId, userId: entityId });
    const candidate = listed.find((a) => a.status === "ACTIVE");
    if (!candidate) return null;
    return this.checked(await this.cfg.client.getConnectedAccount(candidate.id), entityId);
  }

  async status(entityId: string, opts: { link?: boolean; returnTo?: string } = {}): Promise<{ connected: boolean; connectUrl: string | null }> {
    return this.wrap(async () => {
      if (await this.active(entityId)) return { connected: true, connectUrl: null };
      if (!opts.link) return { connected: false, connectUrl: null };
      const link = await this.cfg.client.createConnectLink({ authConfigId: this.cfg.authConfigId, userId: entityId, callbackUrl: this.cfg.callbackUrl(entityId, opts.returnTo) });
      return { connected: false, connectUrl: link.redirectUrl };
    });
  }

  async disconnect(entityId: string): Promise<void> {
    await this.wrap(async () => {
      for (const a of await this.cfg.client.listConnectedAccounts({ authConfigId: this.cfg.authConfigId, userId: entityId })) await this.cfg.client.deleteConnectedAccount(a.id);
    });
  }

  /** Execute one tool on an account that passed the checks. A tool that did not succeed is a {@link SourceReadError}. */
  protected async exec(account: ConnectedAccount, entityId: string, slug: AppTool, args: Record<string, unknown>, failed: string): Promise<unknown> {
    const r = await this.cfg.client.executeTool(slug, { connectedAccountId: account.id, userId: entityId, arguments: args });
    // The provider's own error text is not passed on: it can name internals. The person gets one plain sentence.
    if (!r.successful) throw new SourceReadError(failed);
    return r.data;
  }

  /** Execute one tool on the workspace's live connection. */
  protected async run(entityId: string, slug: AppTool, args: Record<string, unknown>, failed: string): Promise<unknown> {
    return this.wrap(async () => {
      const account = await this.active(entityId);
      if (!account) throw new ConnectorAuthError("composio");
      return this.exec(account, entityId, slug, args, failed);
    });
  }
}

// ------------------------------------------------------------------------------------- Slack

export interface SlackChannel {
  id: string;
  name: string;
  /** Whether the GMS's Slack app is in the channel; Slack refuses a post to one it is not in. */
  member: boolean;
}

export interface SlackAlerts extends Connection {
  readonly provider: "slack";
  /** Public channels, not archived, by name. Read only. */
  listChannels(entityId: string): Promise<SlackChannel[]>;
  /** Post one message to one channel. Returns Slack's message timestamp. */
  post(entityId: string, channelId: string, text: string): Promise<{ ts: string | null }>;
}

const SLACK_CHANNEL_ID = /^[CG][A-Z0-9]{2,30}$/;
const SLACK_PAGES = 10;

export const isSlackChannelId = (v: string): boolean => SLACK_CHANNEL_ID.test(v);

export function slackChannelsOf(data: unknown): { channels: SlackChannel[]; next: string | null } {
  const channels = dig(data, "channels");
  const next = str(rec(dig(data, "response_metadata")).next_cursor);
  return {
    channels: arr(channels)
      .map(rec)
      .flatMap((c) => {
        const id = str(c.id);
        if (!id || !SLACK_CHANNEL_ID.test(id) || c.is_archived === true || c.is_im === true || c.is_mpim === true || c.is_private === true) return [];
        return [{ id, name: (str(c.name) ?? id).slice(0, 80), member: c.is_member === true }];
      }),
    next,
  };
}

export class ComposioSlackAlerts extends ComposioApp implements SlackAlerts {
  readonly provider = "slack" as const;

  async listChannels(entityId: string): Promise<SlackChannel[]> {
    const out: SlackChannel[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < SLACK_PAGES; page++) {
      const data = await this.run(entityId, APP_TOOLS.slackChannels, { types: "public_channel", exclude_archived: true, limit: 200, ...(cursor ? { cursor } : {}) }, "Slack did not list the channels. Try again in a few minutes");
      const r = slackChannelsOf(data);
      out.push(...r.channels);
      cursor = r.next;
      if (!cursor) break;
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  async post(entityId: string, channelId: string, text: string): Promise<{ ts: string | null }> {
    if (!SLACK_CHANNEL_ID.test(channelId)) throw new SourceReadError("That is not a Slack channel");
    // Plain text, no previews of the link: the message carries the event, the record title and a link, nothing more.
    const data = await this.run(entityId, APP_TOOLS.slackPost, { channel: channelId, markdown_text: text.slice(0, 1000), unfurl_links: false, unfurl_media: false }, "Slack did not take the message. Invite the GMS app to the channel, or choose another channel");
    return { ts: str(dig(data, "ts")) };
  }
}

export class FixtureSlackAlerts implements SlackAlerts {
  readonly provider = "slack" as const;
  connected = true;
  readonly posts: { entityId: string; channelId: string; text: string }[] = [];
  /** Channels that refuse a post (the app is not in them). */
  refuse = new Set<string>();
  constructor(public channels: SlackChannel[] = [{ id: "C0GRANTS01", name: "grants", member: true }, { id: "C0GENERAL1", name: "general", member: false }]) {}
  async status(entityId: string, opts: { link?: boolean } = {}) {
    if (this.connected) return { connected: true, connectUrl: null };
    return { connected: false, connectUrl: opts.link ? `https://composio.invalid/connect/slack?entity=${encodeURIComponent(entityId)}` : null };
  }
  async disconnect() {
    this.connected = false;
  }
  async listChannels() {
    if (!this.connected) throw new ConnectorAuthError("composio");
    return [...this.channels];
  }
  async post(entityId: string, channelId: string, text: string) {
    if (!this.connected) throw new ConnectorAuthError("composio");
    if (this.refuse.has(channelId)) throw new SourceReadError("Slack did not take the message. Invite the GMS app to the channel, or choose another channel");
    this.posts.push({ entityId, channelId, text });
    return { ts: `1700000000.${String(this.posts.length).padStart(6, "0")}` };
  }
}

// ---------------------------------------------------------------------------- Google Calendar

export interface CalendarEntry {
  id: string;
  name: string;
  primary: boolean;
}

/** One all-day event: a deadline. Titles and dates only. */
export interface CalendarEventInput {
  title: string;
  /** YYYY-MM-DD */
  date: string;
  /** A short line under the title: what the date is, and a link to the GMS. */
  description: string;
}

/**
 * A person's Google Calendar. The connection is the person's own (one connected account per
 * person on the workspace's entity); every call names that account, never "the first one".
 */
export interface CalendarSync {
  readonly provider: "google_calendar";
  /** Start a connection for one person: Composio's hosted Google sign-in, and the account id it will become. */
  connectLink(entityId: string, returnTo?: string): Promise<{ accountId: string; url: string }>;
  /** Whether that person's account is connected and within the scopes. */
  accountStatus(entityId: string, accountId: string): Promise<{ connected: boolean }>;
  /** Delete that person's connection at Composio. */
  removeAccount(entityId: string, accountId: string): Promise<void>;
  /** Calendars the person owns (events can be written only there). */
  listCalendars(entityId: string, accountId: string): Promise<CalendarEntry[]>;
  createEvent(entityId: string, accountId: string, calendarId: string, event: CalendarEventInput): Promise<{ eventId: string }>;
  updateEvent(entityId: string, accountId: string, calendarId: string, eventId: string, event: CalendarEventInput): Promise<void>;
  /** Already gone counts as deleted. */
  deleteEvent(entityId: string, accountId: string, calendarId: string, eventId: string): Promise<void>;
}

/** The event is gone at Google (deleted by the person, or on another calendar). */
export class CalendarEventGoneError extends Error {
  constructor() {
    super("The calendar event no longer exists");
    this.name = "CalendarEventGoneError";
  }
}

const CALENDAR_ID = /^[^\s/\\]{1,255}$/;
const EVENT_ID = /^[a-v0-9_]{5,1024}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const CALENDAR_PAGES = 5;
const nextDate = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

export function calendarsOf(data: unknown): { calendars: CalendarEntry[]; next: string | null } {
  return {
    calendars: arr(dig(data, "calendars") ?? dig(data, "items"))
      .map(rec)
      .flatMap((c) => {
        const id = str(c.id);
        // `owner` only: calendar.events.owned writes nowhere else.
        if (!id || !CALENDAR_ID.test(id) || c.deleted === true || (typeof c.accessRole === "string" && c.accessRole !== "owner")) return [];
        return [{ id, name: (str(c.summaryOverride) ?? str(c.summary) ?? id).slice(0, 120), primary: c.primary === true }];
      }),
    next: str(dig(data, "next_page_token") ?? dig(data, "nextPageToken")),
  };
}

/** The new event's id from GOOGLECALENDAR_CREATE_EVENT (`response_data.id`, or `id`). */
export function createdEventIdOf(data: unknown): string | null {
  const nested = rec(dig(data, "response_data"));
  const id = str(nested.id) ?? str(rec(data).id) ?? str(rec(rec(data).data).id);
  return id && EVENT_ID.test(id) ? id : null;
}

/** The arguments every event is written with: all day, no guests, no Meet link, no emails, shown as free. */
export function calendarEventArgs(calendarId: string, e: CalendarEventInput) {
  if (!DATE.test(e.date)) throw new SourceReadError("That is not a date");
  return {
    calendar_id: calendarId,
    summary: e.title.slice(0, 250),
    description: e.description.slice(0, 1000),
    start_date: e.date,
    end_date: nextDate(e.date),
    create_meeting_room: false,
    send_updates: "none",
    exclude_organizer: true,
    transparency: "transparent",
  };
}

export class ComposioCalendarSync extends ComposioApp implements CalendarSync {
  readonly provider = "google_calendar" as const;

  async connectLink(entityId: string, returnTo?: string): Promise<{ accountId: string; url: string }> {
    return this.wrap(async () => {
      const link = await this.cfg.client.createConnectLink({ authConfigId: this.cfg.authConfigId, userId: entityId, callbackUrl: this.cfg.callbackUrl(entityId, returnTo) });
      return { accountId: link.connectedAccountId, url: link.redirectUrl };
    });
  }

  private async account(entityId: string, accountId: string): Promise<ConnectedAccount | null> {
    try {
      return await this.checked(await this.cfg.client.getConnectedAccount(accountId), entityId);
    } catch (e) {
      if (e instanceof ComposioError && e.status === 404) return null;
      throw e;
    }
  }

  private async own(entityId: string, accountId: string): Promise<ConnectedAccount> {
    const a = await this.account(entityId, accountId);
    if (!a) throw new ConnectorAuthError("composio");
    return a;
  }

  async accountStatus(entityId: string, accountId: string): Promise<{ connected: boolean }> {
    return this.wrap(async () => ({ connected: !!(await this.account(entityId, accountId)) }));
  }

  async removeAccount(_entityId: string, accountId: string): Promise<void> {
    await this.wrap(() => this.cfg.client.deleteConnectedAccount(accountId));
  }

  async listCalendars(entityId: string, accountId: string): Promise<CalendarEntry[]> {
    return this.wrap(async () => {
      const a = await this.own(entityId, accountId);
      const out: CalendarEntry[] = [];
      let token: string | null = null;
      for (let page = 0; page < CALENDAR_PAGES; page++) {
        const r = calendarsOf(await this.exec(a, entityId, APP_TOOLS.calendarList, { min_access_role: "owner", max_results: 100, ...(token ? { page_token: token } : {}) }, "Google Calendar did not list your calendars. Try again in a few minutes"));
        out.push(...r.calendars);
        token = r.next;
        if (!token) break;
      }
      return out.sort((x, y) => Number(y.primary) - Number(x.primary) || x.name.localeCompare(y.name));
    });
  }

  async createEvent(entityId: string, accountId: string, calendarId: string, event: CalendarEventInput): Promise<{ eventId: string }> {
    if (!CALENDAR_ID.test(calendarId)) throw new SourceReadError("That is not a calendar");
    return this.wrap(async () => {
      const a = await this.own(entityId, accountId);
      const id = createdEventIdOf(await this.exec(a, entityId, APP_TOOLS.calendarCreate, calendarEventArgs(calendarId, event), "Google Calendar did not take the event"));
      if (!id) throw new ConnectorUnavailableError("google_calendar", "Google Calendar did not return the new event");
      return { eventId: id };
    });
  }

  async updateEvent(entityId: string, accountId: string, calendarId: string, eventId: string, event: CalendarEventInput): Promise<void> {
    if (!CALENDAR_ID.test(calendarId) || !EVENT_ID.test(eventId)) throw new SourceReadError("That is not a calendar event");
    if (!DATE.test(event.date)) throw new SourceReadError("That is not a date");
    await this.wrap(async () => {
      const a = await this.own(entityId, accountId);
      const r = await this.cfg.client.executeTool(APP_TOOLS.calendarPatch, {
        connectedAccountId: a.id,
        userId: entityId,
        arguments: { calendar_id: calendarId, event_id: eventId, summary: event.title.slice(0, 250), description: event.description.slice(0, 1000), start_time: event.date, end_time: nextDate(event.date), send_updates: "none" },
      });
      // A patch that fails is taken as the event being gone (deleted by the person): the caller writes it again.
      if (!r.successful) throw new CalendarEventGoneError();
    });
  }

  async deleteEvent(entityId: string, accountId: string, calendarId: string, eventId: string): Promise<void> {
    if (!CALENDAR_ID.test(calendarId) || !EVENT_ID.test(eventId)) return;
    await this.wrap(async () => {
      const a = await this.own(entityId, accountId);
      // 404 and 410 are reported as a failure; either way the event is not there any more.
      await this.cfg.client.executeTool(APP_TOOLS.calendarDelete, { connectedAccountId: a.id, userId: entityId, arguments: { calendar_id: calendarId, event_id: eventId, send_updates: "none" } });
    });
  }
}

/** Stands in for Google Calendar in tests and local runs: accounts by id, events by calendar. */
export class FixtureCalendarSync implements CalendarSync {
  readonly provider = "google_calendar" as const;
  readonly accounts = new Map<string, { entityId: string; active: boolean }>();
  readonly events = new Map<string, { calendarId: string; title: string; date: string; description: string }>();
  readonly calls: { op: "create" | "update" | "delete"; eventId: string; date?: string }[] = [];
  private seq = 0;
  constructor(public calendars: CalendarEntry[] = [{ id: "primary", name: "Your calendar", primary: true }, { id: "grants@group.calendar.google.com", name: "Grant deadlines", primary: false }]) {}
  async connectLink(entityId: string) {
    const accountId = `ca_fixture_${++this.seq}`;
    // A fixture account becomes active at once, as if the person finished Google's sign-in.
    this.accounts.set(accountId, { entityId, active: true });
    return { accountId, url: `https://composio.invalid/connect/google_calendar?account=${accountId}` };
  }
  private live(entityId: string, accountId: string) {
    const a = this.accounts.get(accountId);
    if (!a || !a.active || a.entityId !== entityId) throw new ConnectorAuthError("composio");
  }
  async accountStatus(entityId: string, accountId: string) {
    const a = this.accounts.get(accountId);
    return { connected: !!a && a.active && a.entityId === entityId };
  }
  async removeAccount(_entityId: string, accountId: string) {
    this.accounts.delete(accountId);
  }
  async listCalendars(entityId: string, accountId: string) {
    this.live(entityId, accountId);
    return [...this.calendars];
  }
  async createEvent(entityId: string, accountId: string, calendarId: string, e: CalendarEventInput) {
    this.live(entityId, accountId);
    const eventId = `evt${String(++this.seq).padStart(6, "0")}`;
    this.events.set(eventId, { calendarId, title: e.title, date: e.date, description: e.description });
    this.calls.push({ op: "create", eventId, date: e.date });
    return { eventId };
  }
  async updateEvent(entityId: string, accountId: string, calendarId: string, eventId: string, e: CalendarEventInput) {
    this.live(entityId, accountId);
    if (!this.events.has(eventId)) throw new CalendarEventGoneError();
    this.events.set(eventId, { calendarId, title: e.title, date: e.date, description: e.description });
    this.calls.push({ op: "update", eventId, date: e.date });
  }
  async deleteEvent(entityId: string, accountId: string, _calendarId: string, eventId: string) {
    this.live(entityId, accountId);
    this.events.delete(eventId);
    this.calls.push({ op: "delete", eventId });
  }
}

// ------------------------------------------------------------------------------- Google Drive

export interface DriveFile {
  name: string;
  mimeType: string;
  bytes: Uint8Array;
}

/**
 * An applicant's Google Drive with `drive.file` only: it reaches a file the person picked in the
 * Google Picker (for the same Google Cloud project) and files the GMS created, nothing else.
 */
export interface DriveFiles extends Connection {
  readonly provider: "google_drive";
  /** Copy a picked file's bytes, refusing folders and anything larger than `maxBytes`. Google Docs, Sheets and Slides come as PDF. */
  download(entityId: string, fileId: string, maxBytes: number): Promise<DriveFile>;
  /** Create a PDF in My Drive (or a folder the person picked). Returns the new file's id and link. */
  savePdf(entityId: string, file: { name: string; bytes: Uint8Array; folderId?: string }): Promise<{ id: string; url: string }>;
}

/** The file is not one the GMS can take: a folder, a form, too large, or not picked for this app. */
export class DriveFileRefusedError extends Error {
  constructor(
    public readonly reason: "not_found" | "folder" | "too_large" | "not_downloadable",
    message: string,
  ) {
    super(message);
    this.name = "DriveFileRefusedError";
  }
}

export const DRIVE_FILE_ID = /^[A-Za-z0-9_-]{10,128}$/;
const GOOGLE_APPS = "application/vnd.google-apps.";
/** Google's own formats that export to PDF. Forms, sites, maps and shortcuts do not. */
const EXPORTABLE = new Set([`${GOOGLE_APPS}document`, `${GOOGLE_APPS}spreadsheet`, `${GOOGLE_APPS}presentation`, `${GOOGLE_APPS}drawing`]);
const MAX_SAVE_BYTES = 20 * 1024 * 1024;

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

const cleanName = (name: string, fallback: string) =>
  [...name]
    .map((ch) => (ch.charCodeAt(0) < 0x20 || ch.charCodeAt(0) === 0x7f || ch === "/" || ch === "\\" ? " " : ch))
    .join("")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200) || fallback;

/** Read at most `max` bytes of a response; more is refused without reading the rest. */
async function readCapped(res: Response, max: number): Promise<Uint8Array> {
  const declared = Number(res.headers.get("Content-Length") ?? "NaN");
  if (Number.isFinite(declared) && declared > max) throw new DriveFileRefusedError("too_large", "The file is larger than an upload may be");
  if (!res.body) return new Uint8Array(await res.arrayBuffer());
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => undefined);
      throw new DriveFileRefusedError("too_large", "The file is larger than an upload may be");
    }
    parts.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.byteLength;
  }
  return out;
}

export interface DriveConfig extends AppConfig {
  /** How the Worker fetches the file Composio downloaded (tests pass a fake). */
  fetch?: FetchLike;
}

export class ComposioDriveFiles extends ComposioApp implements DriveFiles {
  readonly provider = "google_drive" as const;
  private readonly doFetch: FetchLike;
  constructor(cfg: DriveConfig) {
    super(cfg);
    this.doFetch = cfg.fetch ?? ((input, init) => fetch(input, init));
  }

  async download(entityId: string, fileId: string, maxBytes: number): Promise<DriveFile> {
    if (!DRIVE_FILE_ID.test(fileId)) throw new DriveFileRefusedError("not_found", "That is not a Google Drive file");
    return this.wrap(async () => {
      const account = await this.active(entityId);
      if (!account) throw new ConnectorAuthError("composio");
      const notPicked = "Google Drive would not open that file for the GMS. Choose it again in the Google Picker, signed in as the Google account that connected";
      const meta = await this.cfg.client.executeTool(APP_TOOLS.driveMetadata, { connectedAccountId: account.id, userId: entityId, arguments: { fileId, fields: "id,name,mimeType,size", supportsAllDrives: true } });
      if (!meta.successful) throw new DriveFileRefusedError("not_found", notPicked);
      const mimeType = str(dig(meta.data, "mimeType")) ?? "application/octet-stream";
      const name = str(dig(meta.data, "name")) ?? "file";
      if (mimeType === `${GOOGLE_APPS}folder`) throw new DriveFileRefusedError("folder", "That is a folder. Choose a file");
      const google = mimeType.startsWith(GOOGLE_APPS);
      if (google && !EXPORTABLE.has(mimeType)) throw new DriveFileRefusedError("not_downloadable", "That kind of Google file cannot be copied. Choose a document, a spreadsheet, a presentation or a file");
      const size = dig(meta.data, "size");
      const declared = typeof size === "number" ? size : typeof size === "string" ? Number(size) : Number.NaN;
      if (Number.isFinite(declared) && declared > maxBytes) throw new DriveFileRefusedError("too_large", "The file is larger than an upload may be");
      const dl = await this.cfg.client.executeTool(APP_TOOLS.driveDownload, { connectedAccountId: account.id, userId: entityId, arguments: { fileId, ...(google ? { mime_type: "application/pdf" } : {}) } });
      if (!dl.successful) throw new DriveFileRefusedError("not_found", notPicked);
      if (dig(dl.data, "export_size_limit_exceeded") === true) throw new DriveFileRefusedError("too_large", "Google would not export a file that large. Download it as a PDF and upload it instead");
      const content = rec(dig(dl.data, "downloaded_file_content"));
      const url = str(content.s3url);
      // Composio keeps the bytes it downloaded and hands back a link to them: HTTPS on a public host only.
      if (!url || !isRegistrableMcpUrl(url)) throw new ConnectorUnavailableError("google_drive", "Composio did not return the file");
      let res: Response;
      try {
        res = await this.doFetch(url, { method: "GET", signal: AbortSignal.timeout(30_000) });
      } catch {
        throw new ConnectorUnavailableError("google_drive", "The file could not be fetched from Composio");
      }
      if (!res.ok) throw new ConnectorUnavailableError("google_drive", `Composio's file store answered ${res.status}`);
      const bytes = await readCapped(res, maxBytes);
      const outMime = google ? "application/pdf" : (str(content.mimetype) ?? mimeType);
      const base = cleanName(str(content.name) ?? name, "file");
      return { name: google && !/\.pdf$/i.test(base) ? `${base}.pdf` : base, mimeType: outMime, bytes };
    });
  }

  async savePdf(entityId: string, file: { name: string; bytes: Uint8Array; folderId?: string }): Promise<{ id: string; url: string }> {
    if (file.folderId !== undefined && !DRIVE_FILE_ID.test(file.folderId)) throw new DriveFileRefusedError("not_found", "That is not a Google Drive folder");
    if (file.bytes.byteLength === 0 || file.bytes.byteLength > MAX_SAVE_BYTES) throw new DriveFileRefusedError("too_large", "The file is empty or larger than 20 MB");
    return this.wrap(async () => {
      const account = await this.active(entityId);
      if (!account) throw new ConnectorAuthError("composio");
      const boundary = `gms-${crypto.randomUUID()}`;
      const meta = { name: cleanName(file.name, "application.pdf"), ...(file.folderId ? { parents: [file.folderId] } : {}) } as { name: string; parents: string[] };
      const body = driveMultipart(meta, file.bytes, "application/pdf", boundary);
      const res = await this.cfg.client.proxy({
        connectedAccountId: account.id,
        userId: entityId,
        endpoint: `${GOOGLE_API}/upload/drive/v3/files`,
        method: "POST",
        query: { uploadType: "multipart", supportsAllDrives: true, fields: "id,webViewLink" },
        binary: { base64: toBase64(body), contentType: `multipart/related; boundary=${boundary}` },
      });
      if (res.status === 403 || res.status === 404) throw new DriveFileRefusedError("not_found", "That Drive folder is not shared with the GMS. Choose it again in the Google Picker, or save to My Drive");
      if (res.status !== 200) throw new ConnectorUnavailableError("google_drive", `Google Drive answered ${res.status}`);
      const d = rec(res.data);
      const id = str(d.id);
      if (!id || !DRIVE_FILE_ID.test(id)) throw new ConnectorUnavailableError("google_drive", "Google Drive did not return the new file");
      return { id, url: str(d.webViewLink) ?? `https://drive.google.com/file/d/${id}/view` };
    });
  }
}

/** Stands in for Google Drive in tests and local runs: picked files by id. */
export class FixtureDriveFiles implements DriveFiles {
  readonly provider = "google_drive" as const;
  connected = true;
  readonly saved: { entityId: string; name: string; size: number; folderId: string | null }[] = [];
  constructor(public files: Record<string, { name: string; mimeType: string; bytes: Uint8Array }> = {}) {}
  async status(entityId: string, opts: { link?: boolean } = {}) {
    if (this.connected) return { connected: true, connectUrl: null };
    return { connected: false, connectUrl: opts.link ? `https://composio.invalid/connect/google_drive?entity=${encodeURIComponent(entityId)}` : null };
  }
  async disconnect() {
    this.connected = false;
  }
  async download(_entityId: string, fileId: string, maxBytes: number) {
    if (!this.connected) throw new ConnectorAuthError("composio");
    const f = this.files[fileId];
    if (!f) throw new DriveFileRefusedError("not_found", "Google Drive would not open that file for the GMS. Choose it again in the Google Picker, signed in as the Google account that connected");
    if (f.mimeType === `${GOOGLE_APPS}folder`) throw new DriveFileRefusedError("folder", "That is a folder. Choose a file");
    if (f.bytes.byteLength > maxBytes) throw new DriveFileRefusedError("too_large", "The file is larger than an upload may be");
    return { ...f, bytes: f.bytes.slice() };
  }
  async savePdf(entityId: string, file: { name: string; bytes: Uint8Array; folderId?: string }) {
    if (!this.connected) throw new ConnectorAuthError("composio");
    this.saved.push({ entityId, name: file.name, size: file.bytes.byteLength, folderId: file.folderId ?? null });
    return { id: `fixtureDriveFile${String(this.saved.length).padStart(4, "0")}`, url: `https://drive.google.invalid/file/${this.saved.length}` };
  }
}

// ---------------------------------------------------------------------------------- Salesforce

export interface SalesforceSource extends Connection {
  readonly provider: "salesforce";
  /** Run one SOQL SELECT and follow its pages: at most `maxRows` records, plus one to tell when there are more. */
  query(entityId: string, soql: string, maxRows: number): Promise<Record<string, unknown>[]>;
}

const SALESFORCE_PAGES = 10;
/** `/services/data/vNN.N/query/<locator>` (or `queryAll`), as Salesforce returns it. */
const NEXT_RECORDS = /^\/services\/data\/v\d{2,3}\.\d\/query(?:All)?\/[A-Za-z0-9-]{1,200}$/;

export function soqlPageOf(data: unknown): { records: Record<string, unknown>[]; next: string | null } {
  const records = arr(dig(data, "records")).map(rec);
  const done = dig(data, "done");
  const next = str(dig(data, "nextRecordsUrl"));
  return { records, next: done === true || !next || !NEXT_RECORDS.test(next) ? null : next };
}

export class ComposioSalesforceSource extends ComposioApp implements SalesforceSource {
  readonly provider = "salesforce" as const;

  async query(entityId: string, soql: string, maxRows: number): Promise<Record<string, unknown>[]> {
    // The importer (packages/importers/src/sources/salesforce.ts) has already refused anything but a plain SELECT.
    if (!/^\s*select\s/i.test(soql)) throw new SourceReadError("Only a SOQL SELECT query can be run");
    const failed = "Salesforce did not run that query. Check the object and field names, and that the Salesforce user you connected can read them";
    const out: Record<string, unknown>[] = [];
    let page = soqlPageOf(await this.run(entityId, APP_TOOLS.salesforceQuery, { query: soql }, failed));
    out.push(...page.records);
    for (let i = 1; i < SALESFORCE_PAGES && page.next && out.length <= maxRows; i++) {
      page = soqlPageOf(await this.run(entityId, APP_TOOLS.salesforceMore, { next_records_url: page.next }, failed));
      out.push(...page.records);
    }
    return out.slice(0, maxRows + 1);
  }
}

/** Stands in for Salesforce in tests and local runs: records by object name (the word after FROM). */
export class FixtureSalesforceSource implements SalesforceSource {
  readonly provider = "salesforce" as const;
  connected = true;
  readonly queries: string[] = [];
  constructor(public objects: Record<string, Record<string, unknown>[]> = {}) {}
  async status(entityId: string, opts: { link?: boolean } = {}) {
    if (this.connected) return { connected: true, connectUrl: null };
    return { connected: false, connectUrl: opts.link ? `https://composio.invalid/connect/salesforce?entity=${encodeURIComponent(entityId)}` : null };
  }
  async disconnect() {
    this.connected = false;
  }
  async query(_entityId: string, soql: string, maxRows: number) {
    if (!this.connected) throw new ConnectorAuthError("composio");
    this.queries.push(soql);
    const object = /\bfrom\s+([A-Za-z0-9_]+)/i.exec(soql)?.[1] ?? "";
    const rows = this.objects[object];
    if (!rows) throw new SourceReadError("Salesforce did not run that query. Check the object and field names, and that the Salesforce user you connected can read them");
    return rows.slice(0, maxRows + 1);
  }
}
