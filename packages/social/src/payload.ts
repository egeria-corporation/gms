// SPDX-License-Identifier: AGPL-3.0-only
// The exact body the GMS sends to `POST /v1/posts`, built in one place so the preview a person
// sees and the request that goes out are the same object, and its digest, which ties the two.
import type { PostBody } from "./client.ts";
import { lengthCheck, NEEDS_IMAGE, PLATFORM_LABEL, type LengthCheck, type Platform } from "./platforms.ts";
import { canonicalJson, sha256Hex } from "./tokens.ts";

/** The longest post text the GMS sends, whatever the platforms. */
export const MAX_CONTENT = 5000;
/** How far ahead a post may be scheduled. */
export const MAX_SCHEDULE_DAYS = 365;
/** The soonest a scheduled post may go out, so it is not in the past by the time Zernio has it. */
export const MIN_SCHEDULE_LEAD_MS = 5 * 60 * 1000;

export interface Schedule {
  /** Wall-clock time in `timezone`, `YYYY-MM-DDTHH:mm` (seconds optional). */
  scheduledFor: string;
  /** IANA time zone, e.g. `America/Chicago`. */
  timezone: string;
}

export interface ComposeInput {
  content: string;
  imageUrl: string | null;
  targets: { platform: Platform; accountId: string }[];
  schedule: Schedule | null;
}

const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

export function isTimeZone(tz: string): boolean {
  if (!/^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+){0,2}$/.test(tz) && tz !== "UTC") return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** The instant a wall-clock time in `timezone` names, or null when either is not valid. */
export function zonedToUtc(local: string, timezone: string): Date | null {
  const m = LOCAL_RE.exec(local);
  if (!m || !isTimeZone(timezone)) return null;
  const [y, mo, d, h, mi, s] = [m[1], m[2], m[3], m[4], m[5], m[6] ?? "0"].map(Number) as [number, number, number, number, number, number];
  const asUtc = Date.UTC(y, mo - 1, d, h, mi, s);
  const check = new Date(asUtc);
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d || h > 23 || mi > 59 || s > 59) return null;
  const offsetAt = (t: number) => {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: timezone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(t)).map((p) => [p.type, p.value]));
    return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second)) - t;
  };
  // Two passes settle the offset on either side of a daylight-saving change.
  let t = asUtc - offsetAt(asUtc);
  t = asUtc - offsetAt(t);
  return new Date(t);
}

/** `YYYY-MM-DDTHH:mm:ss`, the form Zernio takes with a time zone. */
const normalLocal = (local: string) => (local.length === 16 ? `${local}:00` : local);

export function buildPostBody(input: ComposeInput): PostBody {
  return {
    content: input.content,
    ...(input.imageUrl ? { mediaItems: [{ type: "image" as const, url: input.imageUrl }] } : {}),
    platforms: input.targets.map((t) => ({ platform: t.platform, accountId: t.accountId })),
    ...(input.schedule ? { scheduledFor: normalLocal(input.schedule.scheduledFor), timezone: input.schedule.timezone } : { publishNow: true as const }),
  };
}

/** SHA-256 of the body's canonical JSON: equal bodies, equal digests. */
export const postDigest = (body: PostBody) => sha256Hex(canonicalJson(body));

export interface ComposeCheck {
  lengths: LengthCheck[];
  /** Plain sentences; the post cannot go out while there is one. */
  problems: string[];
  /** When a scheduled post goes out, as an instant. */
  scheduledAt: Date | null;
}

export function checkCompose(input: ComposeInput, now: Date): ComposeCheck {
  const problems: string[] = [];
  const text = input.content;
  if (!text.trim()) problems.push("Write the post first.");
  if (Array.from(text).length > MAX_CONTENT) problems.push(`Keep the post under ${MAX_CONTENT.toLocaleString("en-US")} characters.`);
  if (!input.targets.length) problems.push("Choose at least one account to post to.");
  const platforms = [...new Set(input.targets.map((t) => t.platform))];
  const lengths = platforms.map((p) => lengthCheck(p, text));
  for (const l of lengths) if (l.over) problems.push(`${l.label} takes at most ${l.limit.toLocaleString("en-US")} characters; this post has ${l.length.toLocaleString("en-US")}.`);
  for (const p of platforms) if (NEEDS_IMAGE[p] && !input.imageUrl) problems.push(`${PLATFORM_LABEL[p]} needs a picture. Keep the share image, or leave ${PLATFORM_LABEL[p]} out.`);
  let scheduledAt: Date | null = null;
  if (input.schedule) {
    scheduledAt = zonedToUtc(input.schedule.scheduledFor, input.schedule.timezone);
    if (!scheduledAt) problems.push("Choose a date, a time and a time zone for the scheduled post.");
    else if (scheduledAt.getTime() < now.getTime() + MIN_SCHEDULE_LEAD_MS) problems.push("Schedule the post at least five minutes from now, or post it now.");
    else if (scheduledAt.getTime() > now.getTime() + MAX_SCHEDULE_DAYS * 86_400_000) problems.push("Schedule the post within the next year.");
  }
  return { lengths, problems, scheduledAt };
}
