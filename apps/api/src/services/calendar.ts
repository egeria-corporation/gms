// SPDX-License-Identifier: AGPL-3.0-only
// A private calendar link per applicant workspace (apply anywhere): every deadline of its outside
// applications, built-in application stage closes and reports due, as an iCalendar feed a calendar
// app subscribes to. The link is the only key: anyone holding it reads titles, funders and dates
// (nothing else), so it is shown once, kept only as a SHA-256, and can be rotated or deleted.
import { z } from "zod";
import { ApiError } from "../lib/errors.ts";
import { audit, authorize, type ServiceContext } from "./context.ts";
import { sha256Hex } from "./ports.ts";
import { OUTSIDE_ROLES } from "./outside.ts";
import { workspaceDeadlines, type DeadlineEvent } from "./pipeline.ts";
import type { Repos } from "./repos/types.ts";

/** Calendar links start with this, so the log redactor can recognise them (lib/log.ts). */
export const CALENDAR_TOKEN_PREFIX = "gms_cal_";
/** Requests per feed link per hour; a calendar app polls far less often. */
export const CALENDAR_FEED_LIMIT = { perHour: 60 } as const;

/** Who may create, rotate or delete the workspace's link: it changes the link for everyone. */
const FEED_ROLES = ["admin", "editor"] as const;

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export const calendarTokenHash = (token: string) => sha256Hex(new TextEncoder().encode(token));
const isToken = (t: string) => new RegExp(`^${CALENDAR_TOKEN_PREFIX}[A-Za-z0-9_-]{43}$`).test(t);

export async function getFeed(ctx: ServiceContext) {
  const ws = await authorize(ctx, { scope: "applications:read", kind: "applicant", roles: OUTSIDE_ROLES });
  const feed = await ctx.repos.table("calendar_feeds").one({ workspace_id: ws.id });
  return { exists: !!feed, createdAt: feed?.created_at ?? null, rotatedAt: feed?.rotated_at ?? null };
}

/** Make the workspace's link, or replace it (the old one stops working). The URL is returned this once. */
export async function createOrRotateFeed(ctx: ServiceContext) {
  const ws = await authorize(ctx, { scope: "applications:write", kind: "applicant", roles: FEED_ROLES, person: true });
  const token = `${CALENDAR_TOKEN_PREFIX}${b64url(crypto.getRandomValues(new Uint8Array(32)))}`;
  const hash = await calendarTokenHash(token);
  const existing = await ctx.repos.table("calendar_feeds").one({ workspace_id: ws.id });
  if (existing) await ctx.repos.table("calendar_feeds").update({ id: existing.id, workspace_id: ws.id }, { token_sha256: hash, rotated_at: ctx.now().toISOString(), created_by: ctx.actor.userId });
  else await ctx.repos.table("calendar_feeds").insert({ workspace_id: ws.id, token_sha256: hash, created_by: ctx.actor.userId });
  await audit(ctx, existing ? "calendar_feed.rotated" : "calendar_feed.created", "workspace", ws.id, {});
  return { url: `${ctx.config.baseUrl}/gms/cal/${token}.ics`, rotated: !!existing };
}

export async function deleteFeed(ctx: ServiceContext) {
  const ws = await authorize(ctx, { scope: "applications:write", kind: "applicant", roles: FEED_ROLES, person: true });
  const removed = await ctx.repos.table("calendar_feeds").remove({ workspace_id: ws.id });
  if (removed) await audit(ctx, "calendar_feed.deleted", "workspace", ws.id, {});
  return { deleted: removed > 0 };
}

export const feedFile = z.string().regex(/^gms_cal_[A-Za-z0-9_-]{43}\.ics$/);

/** The workspace a link opens, by its hash; null for an unknown, malformed or deleted link. */
export async function feedWorkspace(repos: Repos, token: string): Promise<string | null> {
  if (!isToken(token)) return null;
  const feed = await repos.table("calendar_feeds").one({ token_sha256: await calendarTokenHash(token) });
  if (!feed) return null;
  const ws = await repos.table("workspaces").one({ id: feed.workspace_id });
  return ws && ws.kind === "applicant" && ws.status === "active" ? ws.id : null;
}

// ------------------------------------------------------------------------------------ iCalendar (RFC 5545)

/** TEXT escaping: backslash, semicolon, comma and line breaks. */
const icsText = (s: string) => s.replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\r\n?|\n/g, "\\n");

/** Lines longer than 75 octets are folded with CRLF and a space, never inside a UTF-8 sequence. */
function fold(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const out: string[] = [];
  let current = "";
  let size = 0;
  for (const ch of line) {
    const n = new TextEncoder().encode(ch).length;
    if (size + n > (out.length ? 74 : 75)) {
      out.push(current);
      current = "";
      size = 0;
    }
    current += ch;
    size += n;
  }
  out.push(current);
  return out.join("\r\n ");
}

const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const nextDay = (date: string) => new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10).replace(/-/g, "");

/** The feed for these events: all-day VEVENTs with a title, the funder and the date, nothing more. */
export async function renderIcs(events: DeadlineEvent[], opts: { host: string; now: Date; workspaceId: string }): Promise<string> {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//OpenGrants//GMS deadlines//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "X-WR-CALNAME:Grant deadlines", "X-PUBLISHED-TTL:PT6H"];
  for (const e of events) {
    // The UID is a digest: stable for the same deadline, and it names no record.
    const uid = (await sha256Hex(new TextEncoder().encode(`${opts.workspaceId}|${e.key}`))).slice(0, 32);
    const summary = `${e.label}: ${e.title}${e.funder ? ` (${e.funder})` : ""}`;
    lines.push("BEGIN:VEVENT", `UID:${uid}@${opts.host}`, `DTSTAMP:${stamp(opts.now)}`, `DTSTART;VALUE=DATE:${e.date.replace(/-/g, "")}`, `DTEND;VALUE=DATE:${nextDay(e.date)}`, `SUMMARY:${icsText(summary.slice(0, 500))}`, "TRANSP:TRANSPARENT", "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}

/** The public feed: the link is the key. Unknown links answer 404 with nothing else. */
export async function calendarFeed(base: { repos: Repos; now: () => Date; config: { baseUrl: string } }, token: string): Promise<string> {
  const workspaceId = await feedWorkspace(base.repos, token);
  if (!workspaceId) throw new ApiError(404, "not_found", "Calendar not found");
  const events = await workspaceDeadlines(base, workspaceId);
  return renderIcs(events, { host: new URL(base.config.baseUrl).host, now: base.now(), workspaceId });
}
