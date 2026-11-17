// SPDX-License-Identifier: AGPL-3.0-only
// Google Calendar (v1.12.0, docs/connectors.md): a person connects their own Google Calendar
// through Composio and picks one of their calendars; the deadlines they work to are written there
// as all-day events. Funders: the workspace's opportunity deadlines (within the funds a fund
// advisor may see). Applicants: outside and on-platform application deadlines and reports due.
//
// One-way and idempotent: the link keeps, per deadline, the Google event id, its date and a digest
// of what was written. A sync creates what is new, updates what changed (date or wording), deletes
// what was removed, and leaves alone what is the same. An event the person deleted in Google is
// written again only if its deadline changes. The `.ics` feed (./calendar.ts) stays as it is.
//
// Connecting, choosing a calendar and disconnecting are a person's own acts (never an agent's);
// the jobs Worker syncs every hour. Events carry a title, a date and a link to the GMS: no guests,
// no Meet link, no reminders emailed, shown as free time.
import { CalendarEventGoneError, ConnectorAuthError, ConnectorScopeError, ConnectorScopeUnverifiedError, ConnectorUnavailableError, SourceReadError, type CalendarEventInput, type CalendarSync } from "@gms/connectors";
import { type Locale } from "@gms/i18n";
import { z } from "zod";
import { ApiError, notFound } from "../lib/errors.ts";
import { parse } from "../lib/input.ts";
import { apiId } from "../lib/ids.ts";
import { audit, authorize, fundScopeOf, systemContext, type BaseContext, type ServiceContext, type ServiceWorkspace } from "./context.ts";
import { scopeToFunds } from "./fund-scope.ts";
import { humanOnly } from "./integrations.ts";
import { workspaceDeadlines } from "./pipeline.ts";
import { recipientLocale } from "./preferences.ts";
import { sha256Hex } from "./ports.ts";
import type { Row, Update } from "./repos/types.ts";

/** Calendar writes per link per run; the rest follow on the next run. */
export const WRITES_PER_RUN = 50;
/** Deadlines further back than this are left as they are, never deleted. */
export const KEEP_PAST_DAYS = 60;
/** At most this many deadlines are kept in a calendar. */
const MAX_EVENTS = 500;

type Link = Row<"calendar_links">;
type EventMap = Record<string, { eventId: string; date: string; hash?: string }>;

/** Funder staff and applicant members who work to deadlines. Reviewers and consultants are left out. */
const FUNDER_ROLES = ["admin", "program_officer", "finance", "auditor"] as const;
const APPLICANT_ROLES = ["admin", "editor", "finance", "viewer"] as const;

const LABELS: Record<Locale, Record<string, string>> = {
  en: { close: "Applications close", "Letter of inquiry due": "Letter of inquiry due", "Application due": "Application due", "Internal deadline": "Internal deadline", "Application stage closes": "Application stage closes", "Report due": "Report due", open: "Open in the GMS" },
  es: { close: "Cierre de solicitudes", "Letter of inquiry due": "Carta de intención: fecha límite", "Application due": "Solicitud: fecha límite", "Internal deadline": "Fecha límite interna", "Application stage closes": "Cierra la etapa de la solicitud", "Report due": "Informe: fecha límite", open: "Abrir en el GMS" },
};

export interface CalendarDeadline {
  /** Stable per deadline, without its date, so a moved date is an update, not a new event. */
  key: string;
  date: string;
  event: CalendarEventInput;
}

const day = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : null);
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/**
 * The deadlines one person's calendar holds, in their language. `repos` is already narrowed to the
 * funds the person may see when they are a fund advisor.
 */
export async function personDeadlines(ctx: Pick<ServiceContext, "repos" | "config">, ws: Row<"workspaces">, locale: Locale): Promise<CalendarDeadline[]> {
  const L = LABELS[locale];
  const web = `${ctx.config.webBaseUrl}/w/${ws.handle}`;
  const out: CalendarDeadline[] = [];
  if (ws.kind === "funder") {
    const opps = (await ctx.repos.table("opportunities").find({ workspace_id: ws.id }, { limit: 2000 })).filter((o) => o.published_at || o.status !== "closed");
    for (const o of opps) {
      const close = day((o.key_dates as { closeDate?: { date?: string } } | null)?.closeDate?.date ?? null);
      if (!close) continue;
      const url = `${web}/opportunities/${apiId("opportunity", o.id)}/edit`;
      out.push({ key: `opp:${o.id}`, date: close, event: { title: `${L.close}: ${o.title}`, date: close, description: `${L.open}: ${url}` } });
    }
  } else {
    for (const d of await workspaceDeadlines({ repos: ctx.repos }, ws.id)) {
      // The deadline's key without its trailing date.
      const key = d.key.replace(/:\d{4}-\d{2}-\d{2}$/, "");
      const [kind, id] = key.split(":");
      const url = kind === "oa" ? `${web}/outside/${id}` : kind === "app" ? `${web}/applications/${apiId("application", id!)}/edit` : `${web}/reports`;
      const label = L[d.label] ?? d.label;
      out.push({ key, date: d.date, event: { title: `${label}: ${d.title}${d.funder ? ` (${d.funder})` : ""}`, date: d.date, description: `${L.open}: ${url}` } });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date)).slice(0, 2000);
}

const digest = async (e: CalendarEventInput) => (await sha256Hex(new TextEncoder().encode(`${e.title}\n${e.description}`))).slice(0, 16);

export interface SyncResult {
  created: number;
  updated: number;
  deleted: number;
  unchanged: number;
  /** Writes left for the next run (the per-run cap). */
  pending: number;
}

/**
 * Bring one person's calendar in line with their deadlines. Only this link's account and calendar
 * are touched. The map is saved after every write, so an interruption loses nothing.
 */
export async function syncLink(base: Pick<BaseContext, "repos" | "now">, port: CalendarSync, link: Link, deadlines: CalendarDeadline[]): Promise<SyncResult> {
  const out: SyncResult = { created: 0, updated: 0, deleted: 0, unchanged: 0, pending: 0 };
  if (!link.calendar_id || link.status !== "active") return out;
  const calendarId = link.calendar_id;
  const map: EventMap = { ...((link.event_map ?? {}) as EventMap) };
  const keepFrom = addDays(base.now().toISOString().slice(0, 10), -KEEP_PAST_DAYS);
  const wanted = new Map(deadlines.filter((d) => d.date >= keepFrom).slice(0, MAX_EVENTS).map((d) => [d.key, d]));
  const save = () => base.repos.table("calendar_links").update({ id: link.id }, { event_map: map as unknown as Update<"calendar_links">["event_map"] });
  let writes = 0;
  const budget = () => writes < WRITES_PER_RUN;

  // Removed (or moved out of reach): delete, unless the deadline is simply in the past.
  for (const [key, entry] of Object.entries(map)) {
    if (wanted.has(key)) continue;
    if (entry.date < keepFrom) {
      delete map[key];
      continue;
    }
    if (!budget()) {
      out.pending++;
      continue;
    }
    writes++;
    await port.deleteEvent(link.workspace_id, link.composio_account_id, calendarId, entry.eventId);
    delete map[key];
    out.deleted++;
    await save();
  }

  for (const [key, d] of wanted) {
    const hash = await digest(d.event);
    const entry = map[key];
    if (entry && entry.date === d.date && entry.hash === hash) {
      out.unchanged++;
      continue;
    }
    if (!budget()) {
      out.pending++;
      continue;
    }
    writes++;
    if (entry) {
      try {
        await port.updateEvent(link.workspace_id, link.composio_account_id, calendarId, entry.eventId, d.event);
        map[key] = { eventId: entry.eventId, date: d.date, hash };
        out.updated++;
      } catch (e) {
        if (!(e instanceof CalendarEventGoneError)) throw e;
        const made = await port.createEvent(link.workspace_id, link.composio_account_id, calendarId, d.event);
        map[key] = { eventId: made.eventId, date: d.date, hash };
        out.created++;
      }
    } else {
      const made = await port.createEvent(link.workspace_id, link.composio_account_id, calendarId, d.event);
      map[key] = { eventId: made.eventId, date: d.date, hash };
      out.created++;
    }
    await save();
  }
  await base.repos.table("calendar_links").update({ id: link.id }, { event_map: map as unknown as Update<"calendar_links">["event_map"], last_sync_at: base.now().toISOString() });
  return out;
}

/** The person's own deadlines, read as they may read them (a fund advisor through their funds). */
async function deadlinesFor(base: BaseContext, link: Link): Promise<CalendarDeadline[] | null> {
  const ws = await base.repos.table("workspaces").one({ id: link.workspace_id });
  const member = await base.repos.table("workspace_members").one({ workspace_id: link.workspace_id, user_id: link.user_id });
  if (!ws || ws.status !== "active" || !member || (member.expires_at && member.expires_at <= base.now().toISOString())) return null;
  if (!(ws.kind === "funder" ? (FUNDER_ROLES as readonly string[]) : (APPLICANT_ROLES as readonly string[])).includes(member.role)) return null;
  const ctx = systemContext(base, { job: "calendar-sync" }, { id: ws.id, kind: ws.kind as ServiceWorkspace["kind"] });
  ctx.workspace = { ...ctx.workspace!, role: member.role, memberScope: (member.scope ?? null) as ServiceWorkspace["memberScope"] };
  const funds = fundScopeOf(ctx.workspace);
  if (funds) scopeToFunds(ctx, ws.id, funds);
  return personDeadlines(ctx, ws, await recipientLocale(base.ports, link.user_id));
}

/** Every linked calendar, once an hour from the jobs Worker. One failing link does not stop the others. */
export async function syncCalendars(base: BaseContext): Promise<{ links: number; created: number; updated: number; deleted: number; failed: number }> {
  const out = { links: 0, created: 0, updated: 0, deleted: 0, failed: 0 };
  const port = base.ports.calendar;
  if (!port) return out;
  const links = (await base.repos.table("calendar_links").find({ status: "active" }, { limit: 5000 })).filter((l) => l.calendar_id);
  for (const link of links) {
    out.links++;
    try {
      const deadlines = await deadlinesFor(base, link);
      if (!deadlines) continue;
      const r = await syncLink(base, port, link, deadlines);
      out.created += r.created;
      out.updated += r.updated;
      out.deleted += r.deleted;
    } catch (e) {
      out.failed++;
      // A connection that no longer works waits for the person to connect again.
      if (e instanceof ConnectorAuthError || e instanceof ConnectorScopeError || e instanceof ConnectorScopeUnverifiedError) await base.repos.table("calendar_links").update({ id: link.id }, { status: "error" });
    }
  }
  return out;
}

// ------------------------------------------------------------------------------------ a person's own

export const calendarConnectInput = z.object({ returnTo: z.string().max(300).optional() }).strict();
export const calendarChooseInput = z.object({ calendarId: z.string().min(1).max(255).regex(/^[^\s/\\]+$/) }).strict();

/** A member who works to deadlines, in the GMS themselves. */
async function me(ctx: ServiceContext): Promise<ServiceWorkspace> {
  const ws = await authorize(ctx, { person: true });
  if (!ws) throw new ApiError(403, "workspace_required", "Name a workspace for this action");
  if (!(ws.kind === "funder" ? (FUNDER_ROLES as readonly string[]) : (APPLICANT_ROLES as readonly string[])).includes(ws.role ?? "")) throw new ApiError(403, "insufficient_role", "Calendar sync is for the people who work to this workspace's deadlines");
  return ws;
}

function calendarPort(ctx: ServiceContext): CalendarSync {
  if (!ctx.ports.calendar) throw new ApiError(503, "connector_not_configured", "Google Calendar through Composio is not configured on this server");
  return ctx.ports.calendar;
}

function calendarError(e: unknown): never {
  if (e instanceof ConnectorScopeError) throw new ApiError(422, "connector_scope_rejected", e.message);
  if (e instanceof ConnectorScopeUnverifiedError) throw new ApiError(422, "connector_scope_unverified", e.message);
  if (e instanceof ConnectorAuthError) throw new ApiError(409, "calendar_not_connected", "Connect Google Calendar first");
  if (e instanceof ConnectorUnavailableError) throw new ApiError(503, "connector_unavailable", "Composio could not be reached. Nothing was changed");
  if (e instanceof SourceReadError) throw new ApiError(422, "calendar_refused", e.message);
  throw e;
}

const linkView = (l: Link | null, configured: boolean) => ({
  configured,
  connected: !!l && l.status === "active",
  status: l?.status ?? "not_connected",
  calendar: l?.calendar_id ? { id: l.calendar_id, name: l.calendar_name } : null,
  events: l ? Object.keys((l.event_map ?? {}) as EventMap).length : 0,
  lastSyncAt: l?.last_sync_at ?? null,
});

const mine = (ctx: ServiceContext, wsId: string) => ctx.repos.table("calendar_links").one({ workspace_id: wsId, user_id: ctx.actor.userId! });

/** My calendar link. A pending one is checked once at Composio (the person may just be back from Google). */
export async function getMyCalendar(ctx: ServiceContext) {
  const ws = await me(ctx);
  let link = await mine(ctx, ws.id);
  const port = ctx.ports.calendar;
  if (link && port && link.status !== "active") {
    const s = await port.accountStatus(ws.id, link.composio_account_id).catch(() => ({ connected: false }));
    if (s.connected) link = (await ctx.repos.table("calendar_links").update({ id: link.id }, { status: "active" }))[0] ?? link;
  }
  return linkView(link, !!port);
}

/** Start connecting my Google Calendar: Composio's hosted sign-in for my own account. A person only. */
export async function connectMyCalendar(ctx: ServiceContext, body: unknown) {
  const ws = await me(ctx);
  humanOnly(ctx);
  const input = parse(calendarConnectInput, body);
  const port = calendarPort(ctx);
  const existing = await mine(ctx, ws.id);
  if (existing?.status === "active" && (await port.accountStatus(ws.id, existing.composio_account_id).catch(() => ({ connected: false }))).connected) return { ...linkView(existing, true), connectUrl: null };
  const home = await ctx.repos.table("workspaces").one({ id: ws.id });
  const fallback = `/w/${home?.handle ?? ""}/settings/apps`;
  const returnTo = input.returnTo && home && input.returnTo.startsWith(`/w/${home.handle}/`) && /^\/w\/[a-z0-9-]+\/[A-Za-z0-9/_?=&.-]*$/.test(input.returnTo) && !input.returnTo.includes("//", 1) ? input.returnTo : fallback;
  const link = await port.connectLink(ws.id, returnTo).catch(calendarError);
  // A half-started earlier attempt is removed at Composio, so only one account per person remains.
  if (existing && existing.composio_account_id !== link.accountId) await port.removeAccount(ws.id, existing.composio_account_id).catch(() => undefined);
  const row = existing
    ? (await ctx.repos.table("calendar_links").update({ id: existing.id }, { composio_account_id: link.accountId, status: "pending", calendar_id: null, calendar_name: null, event_map: {} }))[0]!
    : await ctx.repos.table("calendar_links").insert({ workspace_id: ws.id, user_id: ctx.actor.userId!, composio_account_id: link.accountId, status: "pending" });
  await audit(ctx, "connector.connected", "workspace", ws.id, { provider: "google_calendar", state: "pending" });
  return { ...linkView(row, true), connectUrl: link.url };
}

/** The calendars I own, to choose one. */
export async function listMyCalendars(ctx: ServiceContext) {
  const ws = await me(ctx);
  const port = calendarPort(ctx);
  const link = await mine(ctx, ws.id);
  if (!link) throw new ApiError(409, "calendar_not_connected", "Connect Google Calendar first");
  return (await port.listCalendars(ws.id, link.composio_account_id).catch(calendarError)).slice(0, 200);
}

/** Choose the calendar deadlines go to, and write them now. Moving to another calendar removes them from the first. A person only. */
export async function chooseMyCalendar(ctx: ServiceContext, body: unknown) {
  const ws = await me(ctx);
  humanOnly(ctx);
  // Authorized before the body is read: a caller who may not gets 403, never 400.
  const input = parse(calendarChooseInput, body);
  const port = calendarPort(ctx);
  let link = await mine(ctx, ws.id);
  if (!link) throw new ApiError(409, "calendar_not_connected", "Connect Google Calendar first");
  const chosen = (await port.listCalendars(ws.id, link.composio_account_id).catch(calendarError)).find((c) => c.id === input.calendarId);
  if (!chosen) throw notFound("Calendar");
  if (link.calendar_id && link.calendar_id !== chosen.id) await removeEvents(ctx, port, link);
  link = (await ctx.repos.table("calendar_links").update({ id: link.id }, { status: "active", calendar_id: chosen.id, calendar_name: chosen.name.slice(0, 120), ...(link.calendar_id !== chosen.id ? { event_map: {} } : {}) }))[0]!;
  await audit(ctx, "connector.calendar_chosen", "workspace", ws.id, { provider: "google_calendar" });
  return syncMine(ctx, ws, link);
}

async function syncMine(ctx: ServiceContext, ws: ServiceWorkspace, link: Link) {
  const port = calendarPort(ctx);
  const home = await ctx.repos.table("workspaces").one({ id: ws.id });
  if (!home) throw notFound("Workspace");
  // `ctx.repos` is already narrowed to a fund advisor's funds by `authorize`.
  const deadlines = await personDeadlines(ctx, home, await recipientLocale(ctx.ports, ctx.actor.userId));
  const result = await syncLink(ctx, port, link, deadlines).catch(calendarError);
  return { ...linkView(await mine(ctx, ws.id), true), result };
}

/** Write my deadlines now instead of at the next hourly run. A person only. */
export async function syncMyCalendar(ctx: ServiceContext) {
  const ws = await me(ctx);
  humanOnly(ctx);
  const link = await mine(ctx, ws.id);
  if (!link || link.status !== "active" || !link.calendar_id) throw new ApiError(409, "calendar_not_connected", "Connect Google Calendar and choose a calendar first");
  return syncMine(ctx, ws, link);
}

/** Take the deadlines this link wrote out of the calendar. Best effort: one that is gone already is fine. */
async function removeEvents(ctx: ServiceContext, port: CalendarSync, link: Link): Promise<number> {
  if (!link.calendar_id) return 0;
  let removed = 0;
  for (const entry of Object.values((link.event_map ?? {}) as EventMap).slice(0, MAX_EVENTS)) {
    await port.deleteEvent(link.workspace_id, link.composio_account_id, link.calendar_id, entry.eventId).then(
      () => removed++,
      () => undefined,
    );
  }
  void ctx;
  return removed;
}

/** Disconnect my Google Calendar: the events written are removed, then the connection at Composio, then the link. A person only. */
export async function disconnectMyCalendar(ctx: ServiceContext) {
  const ws = await me(ctx);
  humanOnly(ctx);
  const link = await mine(ctx, ws.id);
  if (!link) return linkView(null, !!ctx.ports.calendar);
  const port = ctx.ports.calendar;
  if (port) {
    await removeEvents(ctx, port, link);
    await port.removeAccount(ws.id, link.composio_account_id).catch(calendarError);
  }
  await ctx.repos.table("calendar_links").remove({ id: link.id });
  await audit(ctx, "connector.disconnected", "workspace", ws.id, { provider: "google_calendar" });
  return linkView(null, !!port);
}
