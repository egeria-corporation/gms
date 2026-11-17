// SPDX-License-Identifier: AGPL-3.0-only
// Slack alerts (v1.12.0, docs/connectors.md): a workspace admin connects Slack through Composio,
// picks one public channel and the events to hear about; the jobs Worker posts one short message
// per event. Funder teams: new application, review assigned, an opportunity closing in three days,
// a report due, a payment due. Applicant teams: a deadline in three days, a report due, a payment
// due. Each message carries the event, the record title and a link to the GMS, nothing else: never
// an applicant's answers, an email address, a person's name or an amount.
//
// Idempotent per event: before posting, the event is claimed in alert_deliveries (unique per
// subscription and event key), so a re-run or a second Worker never posts it twice. Turning alerts
// off, or disconnecting Slack, stops them at once: the subscription is read again before each post.
import { DEFAULT_LOCALE, isLocale, type Locale } from "@gms/i18n";
import { ConnectorAuthError, ConnectorScopeError, ConnectorScopeUnverifiedError, ConnectorUnavailableError, isSlackChannelId, SourceReadError } from "@gms/connectors";
import { z } from "zod";
import { ApiError } from "../lib/errors.ts";
import { apiId } from "../lib/ids.ts";
import { audit, authorize, systemContext, type BaseContext, type ServiceContext, type ServiceWorkspace } from "./context.ts";
import { humanOnly } from "./integrations.ts";
import { workspaceDeadlines } from "./pipeline.ts";
import { RepoError, type Row } from "./repos/types.ts";

export const ALERT_EVENTS = ["new_application", "review_assigned", "deadline_soon", "report_due", "payment_due"] as const;
export type AlertEvent = (typeof ALERT_EVENTS)[number];
/** What each kind of team can be told about. A review is a funder's; an applicant hears about its own dates. */
export const EVENTS_FOR: Record<"funder" | "applicant", readonly AlertEvent[]> = {
  funder: ALERT_EVENTS,
  applicant: ["deadline_soon", "report_due", "payment_due"],
};
/** How far ahead "deadline soon" looks. */
export const DEADLINE_DAYS = 3;
/** Posts per channel per run: Slack takes about one a second, and the next run picks up the rest. */
export const POSTS_PER_RUN = 20;
/** A post Slack refused is tried again on later runs, this many times in all. */
export const MAX_ATTEMPTS = 3;
/** Nothing older than this is alerted, whenever alerts were turned on. */
const LOOKBACK_MS = 7 * 86_400_000;

type Sub = Row<"alert_subscriptions">;

const LABEL: Record<Locale, Record<AlertEvent, string>> = {
  en: { new_application: "New application", review_assigned: "Review assigned", deadline_soon: "Deadline in 3 days", report_due: "Report due", payment_due: "Payment due" },
  es: { new_application: "Nueva solicitud", review_assigned: "Revisión asignada", deadline_soon: "Fecha límite en 3 días", report_due: "Informe pendiente", payment_due: "Pago pendiente" },
};
const OPEN_LINK: Record<Locale, string> = { en: "Open in the GMS", es: "Abrir en el GMS" };

/**
 * A record title as Slack text: one line, no markup, and no way to mention anyone. Titles are
 * written by applicants, so `<!channel>`, `@here` or a link in one must arrive as plain words.
 */
export function slackSafe(title: string): string {
  const flat = title
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/[<>*_~`|[\]()#]/g, " ")
    .replace(/&/g, "and")
    .replace(/@/g, "@​")
    .replace(/\s+/g, " ")
    .trim();
  return (flat.length > 120 ? `${flat.slice(0, 119)}…` : flat) || "Untitled";
}

/** The whole message: the event, the record title, a link to the GMS. */
export function alertText(locale: Locale, event: AlertEvent, title: string, url: string): string {
  return `*${LABEL[locale][event]}*: ${slackSafe(title)}\n[${OPEN_LINK[locale]}](${url})`;
}

// ------------------------------------------------------------------------------------ settings

export const alertsInput = z
  .object({
    channelId: z.string().refine(isSlackChannelId, "Choose a Slack channel"),
    events: z.array(z.enum(ALERT_EVENTS)).max(ALERT_EVENTS.length),
    enabled: z.boolean(),
  })
  .strict();

const admin = (ctx: ServiceContext): Promise<ServiceWorkspace> => authorize(ctx, { scope: "workspace:admin", roles: ["admin"] });

function slackError(e: unknown): never {
  if (e instanceof ConnectorScopeError) throw new ApiError(422, "connector_scope_rejected", e.message);
  if (e instanceof ConnectorScopeUnverifiedError) throw new ApiError(422, "connector_scope_unverified", e.message);
  if (e instanceof ConnectorAuthError) throw new ApiError(409, "slack_not_connected", "Connect Slack first");
  if (e instanceof ConnectorUnavailableError) throw new ApiError(503, "connector_unavailable", "Composio could not be reached. Nothing was changed");
  if (e instanceof SourceReadError) throw new ApiError(422, "slack_refused", e.message);
  throw e;
}

const view = (s: Sub | null) => (s ? { channelId: s.channel_id, channelName: s.channel_name, events: s.events as AlertEvent[], enabled: s.enabled, locale: s.locale, alertsFrom: s.alerts_from, updatedAt: s.updated_at } : null);

/** The Slack alert settings of this workspace, which events it can have, and the latest alerts sent. */
export async function getAlerts(ctx: ServiceContext) {
  const ws = await admin(ctx);
  const port = ctx.ports.slack;
  const sub = await ctx.repos.table("alert_subscriptions").one({ workspace_id: ws.id, provider: "slack" });
  const connected = port ? (await port.status(ws.id).catch(() => ({ connected: false }))).connected : false;
  const recent = sub ? await ctx.repos.table("alert_deliveries").find({ subscription_id: sub.id }, { orderBy: "created_at", ascending: false, limit: 20 }) : [];
  return {
    configured: !!port,
    connected,
    events: EVENTS_FOR[ws.kind],
    subscription: view(sub),
    recent: recent.map((d) => ({ event: d.event as AlertEvent, status: d.status, at: d.updated_at })),
  };
}

/** Public channels the Slack connection can see. Read only; Slack's messages are never read. */
export async function listSlackChannels(ctx: ServiceContext) {
  const ws = await admin(ctx);
  if (!ctx.ports.slack) throw new ApiError(503, "connector_not_configured", "Slack through Composio is not configured on this server");
  return (await ctx.ports.slack.listChannels(ws.id).catch(slackError)).slice(0, 500);
}

/**
 * Choose the channel and the events, or turn alerts on or off. A person only: this decides what is
 * posted in the workspace's name. Turning alerts on starts from now, so nothing older is posted.
 */
export async function putAlerts(ctx: ServiceContext, input: z.output<typeof alertsInput>) {
  const ws = await authorize(ctx, { scope: "workspace:admin", roles: ["admin"], person: true });
  humanOnly(ctx);
  if (!ctx.ports.slack) throw new ApiError(503, "connector_not_configured", "Slack through Composio is not configured on this server");
  const allowed = EVENTS_FOR[ws.kind];
  const wrong = input.events.filter((e) => !allowed.includes(e));
  if (wrong.length) throw new ApiError(422, "event_not_available", `These alerts are not available for this kind of workspace: ${wrong.join(", ")}`);
  // The channel must be one Slack lists for this connection; its name is taken from there.
  const channel = (await ctx.ports.slack.listChannels(ws.id).catch(slackError)).find((c) => c.id === input.channelId);
  if (!channel) throw new ApiError(422, "channel_not_found", "That channel is not one of the public channels the Slack connection can see");
  const existing = await ctx.repos.table("alert_subscriptions").one({ workspace_id: ws.id, provider: "slack" });
  const now = ctx.now().toISOString();
  const locale: Locale = isLocale(ctx.locale) ? ctx.locale : DEFAULT_LOCALE;
  const turnedOn = input.enabled && (!existing || !existing.enabled);
  const patch = { channel_id: channel.id, channel_name: channel.name, events: [...new Set(input.events)], enabled: input.enabled, locale, ...(turnedOn ? { alerts_from: now } : {}) };
  const row = existing ? (await ctx.repos.table("alert_subscriptions").update({ id: existing.id }, patch))[0]! : await ctx.repos.table("alert_subscriptions").insert({ workspace_id: ws.id, provider: "slack", created_by: ctx.actor.userId, ...patch, alerts_from: now });
  await audit(ctx, "connector.alerts_changed", "workspace", ws.id, { provider: "slack", channel: channel.name, events: row.events, enabled: row.enabled });
  return { ...view(row)!, channelMember: channel.member };
}

/** Stop and forget the alert settings. A person only. */
export async function deleteAlerts(ctx: ServiceContext) {
  const ws = await authorize(ctx, { scope: "workspace:admin", roles: ["admin"], person: true });
  humanOnly(ctx);
  const removed = await ctx.repos.table("alert_subscriptions").remove({ workspace_id: ws.id, provider: "slack" });
  if (removed) await audit(ctx, "connector.alerts_changed", "workspace", ws.id, { provider: "slack", enabled: false, removed: true });
  return { deleted: removed > 0 };
}

// ------------------------------------------------------------------------------------ events

export interface AlertCandidate {
  event: AlertEvent;
  /** Unique per subscription: the event and its record (and date, for dates). */
  key: string;
  title: string;
  url: string;
}

const day = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : null);
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const closeOf = (o: Row<"opportunities">) => day((o.key_dates as { closeDate?: { date?: string } } | null)?.closeDate?.date ?? null);

/**
 * What happened in a workspace since `from` that its team can be told about, by event. Read from
 * the records themselves (applications, assignments, dates, requirements, tranches), so a missed
 * run catches up and an alert can always be traced to its record. Titles and links only.
 */
export async function alertCandidates(base: Pick<BaseContext, "repos" | "now" | "config">, ws: Row<"workspaces">, events: readonly AlertEvent[], from: string): Promise<AlertCandidate[]> {
  const out: AlertCandidate[] = [];
  const want = new Set(events);
  const web = `${base.config.webBaseUrl}/w/${ws.handle}`;
  const today = base.now().toISOString().slice(0, 10);
  const soon = addDays(today, DEADLINE_DAYS);
  const after = (iso: string | null | undefined) => !!iso && iso >= from;
  const repos = base.repos;

  if (ws.kind === "funder") {
    if (want.has("new_application")) {
      const apps = await repos.table("applications").find({ workspace_id: ws.id }, { orderBy: "submitted_at", ascending: false, limit: 200, notNull: ["submitted_at"] });
      for (const a of apps.filter((x) => after(x.submitted_at))) out.push({ event: "new_application", key: `new_application:${a.id}`, title: a.title, url: `${web}/applications/${apiId("application", a.id)}` });
    }
    if (want.has("review_assigned")) {
      const assigned = (await repos.table("review_assignments").find({ workspace_id: ws.id }, { orderBy: "created_at", ascending: false, limit: 200 })).filter((r) => after(r.created_at));
      const apps = assigned.length ? await repos.table("applications").find({ id: [...new Set(assigned.map((r) => r.application_id))] }) : [];
      for (const r of assigned) {
        const app = apps.find((a) => a.id === r.application_id);
        if (app) out.push({ event: "review_assigned", key: `review_assigned:${r.id}`, title: app.title, url: `${web}/applications/${apiId("application", app.id)}` });
      }
    }
    if (want.has("deadline_soon")) {
      const opps = (await repos.table("opportunities").find({ workspace_id: ws.id, status: ["forecasted", "open"] }, { limit: 2000 })).filter((o) => o.published_at);
      for (const o of opps) {
        const close = closeOf(o);
        if (close && close >= today && close <= soon) out.push({ event: "deadline_soon", key: `deadline_soon:opp:${o.id}:${close}`, title: o.title, url: `${web}/opportunities/${apiId("opportunity", o.id)}/edit` });
      }
    }
    if (want.has("report_due") || want.has("payment_due")) {
      const awards = await repos.table("awards").find({ workspace_id: ws.id }, { limit: 5000 });
      const title = (id: string) => awards.find((a) => a.id === id)?.title ?? "Award";
      if (want.has("report_due")) {
        const reqs = (await repos.table("requirements").find({ workspace_id: ws.id, status: "due" }, { limit: 2000 })).filter((r) => after(r.updated_at));
        for (const r of reqs) out.push({ event: "report_due", key: `report_due:${r.id}:${day(r.due_at) ?? "open"}`, title: `${r.title} (${title(r.award_id)})`, url: `${web}/awards/${apiId("award", r.award_id)}/agreement` });
      }
      if (want.has("payment_due")) {
        const due = (await repos.table("tranches").find({ workspace_id: ws.id, status: "due" }, { limit: 2000 })).filter((t) => after(t.updated_at));
        for (const t of due) out.push({ event: "payment_due", key: `payment_due:${t.id}`, title: title(t.award_id), url: `${web}/awards/${apiId("award", t.award_id)}/payments` });
      }
    }
    return out;
  }

  // An applicant team: its own dates, its reports and payments on awards made to it.
  if (want.has("deadline_soon")) {
    for (const d of await workspaceDeadlines({ repos }, ws.id)) {
      // Reports have their own alert; this one is for applications.
      if (d.key.startsWith("req:") || d.date < today || d.date > soon) continue;
      const [kind, id] = d.key.split(":");
      const url = kind === "oa" ? `${web}/outside/${id}` : kind === "app" ? `${web}/applications/${apiId("application", id!)}/edit` : `${web}/applications`;
      out.push({ event: "deadline_soon", key: `deadline_soon:${d.key}`, title: `${d.label}: ${d.title}`, url });
    }
  }
  if (want.has("report_due") || want.has("payment_due")) {
    const awards = await repos.table("awards").find({ recipient_workspace_id: ws.id }, { limit: 5000 });
    const title = (id: string) => awards.find((a) => a.id === id)?.title ?? "Grant";
    if (awards.length && want.has("report_due")) {
      const reqs = (await repos.table("requirements").find({ award_id: awards.map((a) => a.id), status: "due" }, { limit: 2000 })).filter((r) => after(r.updated_at));
      for (const r of reqs) out.push({ event: "report_due", key: `report_due:${r.id}:${day(r.due_at) ?? "open"}`, title: `${r.title} (${title(r.award_id)})`, url: `${web}/reports` });
    }
    if (awards.length && want.has("payment_due")) {
      const due = (await repos.table("tranches").find({ award_id: awards.map((a) => a.id), status: "due" }, { limit: 2000 })).filter((t) => after(t.updated_at));
      for (const t of due) out.push({ event: "payment_due", key: `payment_due:${t.id}`, title: title(t.award_id), url: `${web}/grants/${apiId("award", t.award_id)}` });
    }
  }
  return out;
}

// ------------------------------------------------------------------------------------ the job

type Delivery = Row<"alert_deliveries">;

/** Claim an event for one post. Null when it was posted before, is being posted, or failed too often. */
async function claim(base: BaseContext, sub: Sub, c: AlertCandidate): Promise<Delivery | null> {
  try {
    return await base.repos.table("alert_deliveries").insert({ subscription_id: sub.id, workspace_id: sub.workspace_id, event_key: c.key.slice(0, 200), event: c.event });
  } catch (e) {
    if (!(e instanceof RepoError && e.kind === "conflict")) throw e;
  }
  const prior = await base.repos.table("alert_deliveries").one({ subscription_id: sub.id, event_key: c.key.slice(0, 200) });
  if (!prior || prior.status !== "failed" || prior.attempts >= MAX_ATTEMPTS) return null;
  // Retry one Slack refused: the update only matches while it is still `failed` at that count.
  const [taken] = await base.repos.table("alert_deliveries").update({ id: prior.id, status: "failed", attempts: prior.attempts }, { status: "sending", attempts: prior.attempts + 1 });
  return taken ?? null;
}

/**
 * Post the alerts due for every workspace with Slack alerts on. Called by the jobs Worker every
 * fifteen minutes. One failing workspace does not stop the others.
 */
export async function sendConnectorAlerts(base: BaseContext): Promise<{ subscriptions: number; posted: number; failed: number; skipped: number }> {
  const out = { subscriptions: 0, posted: 0, failed: 0, skipped: 0 };
  const port = base.ports.slack;
  if (!port) return out;
  const subs = await base.repos.table("alert_subscriptions").find({ provider: "slack", enabled: true }, { limit: 5000 });
  for (const sub of subs) {
    out.subscriptions++;
    try {
      const ws = await base.repos.table("workspaces").one({ id: sub.workspace_id });
      if (!ws || ws.status !== "active") continue;
      const allowed = EVENTS_FOR[ws.kind as ServiceWorkspace["kind"]].filter((e) => (sub.events as string[]).includes(e));
      if (!allowed.length) continue;
      const floor = new Date(base.now().getTime() - LOOKBACK_MS).toISOString();
      const from = sub.alerts_from > floor ? sub.alerts_from : floor;
      const locale: Locale = isLocale(sub.locale) ? sub.locale : DEFAULT_LOCALE;
      let posts = 0;
      for (const c of await alertCandidates(base, ws, allowed, from)) {
        if (posts >= POSTS_PER_RUN) break;
        // Turned off, moved to another channel or disconnected since the run began: stop at once.
        const live = await base.repos.table("alert_subscriptions").one({ id: sub.id });
        if (!live || !live.enabled || live.channel_id !== sub.channel_id || !(live.events as string[]).includes(c.event)) break;
        const claimed = await claim(base, live, c);
        if (!claimed) {
          out.skipped++;
          continue;
        }
        posts++;
        try {
          const r = await port.post(ws.id, live.channel_id, alertText(locale, c.event, c.title, c.url));
          await base.repos.table("alert_deliveries").update({ id: claimed.id }, { status: "sent", slack_ts: r.ts && /^\d{1,12}\.\d{1,8}$/.test(r.ts) ? r.ts : null });
          out.posted++;
        } catch (e) {
          await base.repos.table("alert_deliveries").update({ id: claimed.id }, { status: "failed" });
          out.failed++;
          // Without a usable connection nothing else will go through this run.
          if (e instanceof ConnectorAuthError || e instanceof ConnectorScopeError || e instanceof ConnectorScopeUnverifiedError || e instanceof ConnectorUnavailableError) break;
        }
      }
      if (posts) await audit(systemContext(base, { job: "connector-alerts" }, { id: ws.id, kind: ws.kind as ServiceWorkspace["kind"] }), "connector.alerts_sent", "workspace", ws.id, { provider: "slack", posts });
    } catch {
      out.failed++;
    }
  }
  return out;
}
