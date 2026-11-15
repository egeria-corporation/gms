// SPDX-License-Identifier: AGPL-3.0-only
// Opt-in content digests (v1.8.0). Three Monday emails, each off until the person turns it on, per
// person and workspace (`digest_subscriptions`, migration 0041):
//   new_matches      applicants: up to 10 new matches from OpenGrants plus open opportunities on
//                    this site that fit the profile, never one already sent to them or saved;
//   deadlines        applicants: outside and on-platform deadlines in the next 21 days, leaving out
//                    any the daily reminders already emailed this person today;
//   funder_activity  funder staff: new applications, reviews due, payments due and reports overdue
//                    this week, as counts with links. No applicant's answers, titles or names.
//
// Each email is sent once per person, digest and ISO week (`digest_sends`), only when there is
// something new, with a one-click unsubscribe for that digest (a signed link, no sign-in) and the
// List-Unsubscribe headers. Matches are read the way the person would read them in Discover: the
// same service functions, the same authorization, the same OpenGrants cache and errors. When
// OpenGrants cannot be reached the GMS part is sent and says so; with no GMS part, nothing is sent.
//
// Turning a digest on is a person's own choice: agents and API clients may read the settings and
// the preview, never change them. A person removed from a workspace stops getting its digests.
import { CONTENT_DIGESTS, CONTENT_DIGEST_LABEL, CONTENT_DIGEST_TEMPLATE, DEADLINE_DIGEST_DAYS, MAX_DIGEST_MATCHES, OUTSIDE_DEADLINE_OFFSETS, deadlinesDigestEmail, funderActivityDigestEmail, newMatchesDigestEmail, type ContentDigest, type DigestDeadline, type DigestEmail, type DigestFrame, type DigestMatch, type FunderActivityCounts } from "@gms/notify";
import { z } from "zod";
import { scopesForRole, type WorkspaceKind } from "../auth/scopes.ts";
import { ApiError } from "../lib/errors.ts";
import { apiId, uuidOf } from "../lib/ids.ts";
import { discoverCompetitions, openGrants } from "./applicant.ts";
import { authorize, makeActor, type BaseContext, type ServiceContext, type ServiceWorkspace } from "./context.ts";
import { normalizePreferences } from "./notifications.ts";
import { OUTSIDE_ROLES } from "./outside.ts";
import { workspaceDeadlines } from "./pipeline.ts";
import { RepoError, type Row } from "./repos/types.ts";

export { CONTENT_DIGESTS, type ContentDigest } from "@gms/notify";

type Member = Row<"workspace_members">;
type Ws = Row<"workspaces">;
type Sub = Row<"digest_subscriptions">;

// ------------------------------------------------------------------------------------ constants

/** When the job runs: Mondays at 15:10 UTC, five minutes after the weekly event digest. */
export const CONTENT_DIGEST_SCHEDULE = { weekday: 1, hour: 15, minute: 10 } as const;
/** How long an unsubscribe link keeps working. */
export const UNSUBSCRIBE_TTL_DAYS = 90;
/** OpenGrants match calls one run may make (one per applicant workspace). The rest get the GMS part. */
export const MAX_OPENGRANTS_CALLS_PER_RUN = 100;
/** Who may get each digest. The restrictive reading: consultants and reviewers get none. */
export const DIGEST_ROLES: Record<ContentDigest, { kind: WorkspaceKind; roles: readonly string[] }> = {
  // The roles that can use Discover (the `discovery` scope), consultants excluded.
  new_matches: { kind: "applicant", roles: ["admin", "editor", "finance", "viewer"] },
  deadlines: { kind: "applicant", roles: OUTSIDE_ROLES },
  funder_activity: { kind: "funder", roles: ["admin", "program_officer", "finance"] },
};
/** Only opportunities whose eligibility check says yes count as fitting; "unknown" does not. */
const MATCH_UNKNOWN_ELIGIBILITY = false;
/**
 * Stages in which each outside deadline is still reminded (as `OUTSIDE_REMINDABLE` in jobs.ts), so
 * the deadlines digest can leave out what the daily reminder already sent the person today.
 */
const OUTSIDE_REMINDABLE: Record<"loi" | "full" | "internal", readonly string[]> = {
  loi: ["prospect", "deciding", "loi"],
  full: ["prospect", "deciding", "loi", "invited", "drafting"],
  internal: ["prospect", "deciding", "loi", "invited", "drafting"],
};

const COLUMN: Record<ContentDigest, "new_matches" | "deadlines" | "funder_activity"> = { new_matches: "new_matches", deadlines: "deadlines", funder_activity: "funder_activity" };
const DESCRIPTION: Record<ContentDigest, string> = {
  new_matches: "Up to 10 new funding opportunities that fit your organization, from OpenGrants and from funders on this site. Never one you were already sent or saved.",
  deadlines: "Your deadlines in the next 3 weeks: applications you track here, application stages and reports due to funders.",
  funder_activity: "New applications, reviews due, payments due and reports overdue this week, as counts with links. Never an applicant's answers.",
};
const OPENGRANTS_UNAVAILABLE_NOTE = "We couldn't reach OpenGrants this week, so this email lists only opportunities on this site. Next week's will include OpenGrants again.";
const OPENGRANTS_PROFILE_NOTE = "To get matches from OpenGrants too, add your mission to your organization profile.";

const DAY_MS = 86_400_000;
const day = (d: Date) => d.toISOString().slice(0, 10);
const plusDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY_MS);
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
const live = (m: Member, now: Date) => !m.expires_at || Date.parse(m.expires_at) > now.getTime();

/** The ISO 8601 week of a moment in UTC, e.g. `2027-W16`. */
export function isoWeek(at: Date): string {
  const t = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const year = t.getUTCFullYear();
  const week = Math.ceil(((t.getTime() - Date.UTC(year, 0, 1)) / DAY_MS + 1) / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

/** The day the next digests go out (today, on a Monday before the run). */
export function nextSendOn(now: Date): string {
  const { weekday, hour, minute } = CONTENT_DIGEST_SCHEDULE;
  const ahead = (weekday - now.getUTCDay() + 7) % 7;
  const beforeRun = now.getUTCHours() * 60 + now.getUTCMinutes() < hour * 60 + minute;
  return day(plusDays(now, ahead === 0 && !beforeRun ? 7 : ahead));
}

/** The digests a member of this kind of workspace with this role can turn on. */
export function offeredDigests(kind: string, role: string): ContentDigest[] {
  return CONTENT_DIGESTS.filter((d) => DIGEST_ROLES[d].kind === kind && DIGEST_ROLES[d].roles.includes(role));
}

// ------------------------------------------------------------------------------------ unsubscribe links

const enc = (s: string) => new TextEncoder().encode(s);
const b64url = (bytes: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

/**
 * The link-signing key, derived (HKDF-SHA-256) from CREDENTIALS_ENCRYPTION_KEY with its own label,
 * so no new secret is needed and the encryption key itself never signs anything.
 */
async function linkKey(secret: string): Promise<CryptoKey> {
  const ikm = await crypto.subtle.importKey("raw", enc(secret), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: enc("opengrants-gms"), info: enc("content-digest-unsubscribe-v1") }, ikm, { name: "HMAC", hash: "SHA-256", length: 256 }, false, ["sign", "verify"]);
}

const TOKEN = /^v1\.([0-9a-f-]{36})\.(new_matches|deadlines|funder_activity)\.(\d{1,12})\.([A-Za-z0-9_-]{43})$/;

/** `v1.<membership>.<digest>.<expiry, Unix seconds>.<HMAC>`: turns off one digest for one membership. */
export async function unsubscribeToken(secret: string, memberId: string, digest: ContentDigest, expiresAt: Date): Promise<string> {
  const payload = `v1.${memberId}.${digest}.${Math.floor(expiresAt.getTime() / 1000)}`;
  return `${payload}.${b64url(await crypto.subtle.sign("HMAC", await linkKey(secret), enc(payload)))}`;
}

/** The membership and digest a link names; `invalid` when it was not signed here, `expired` after its date. */
export async function readUnsubscribeToken(secret: string, token: string, now: Date): Promise<{ memberId: string; digest: ContentDigest } | "invalid" | "expired"> {
  const m = TOKEN.exec(token.trim());
  if (!m) return "invalid";
  const [, memberId, digest, exp, sig] = m as unknown as [string, string, ContentDigest, string, string];
  let signature: Uint8Array;
  try {
    signature = fromB64url(sig);
  } catch {
    return "invalid";
  }
  const ok = await crypto.subtle.verify("HMAC", await linkKey(secret), signature as Uint8Array<ArrayBuffer>, enc(`v1.${memberId}.${digest}.${exp}`));
  if (!ok) return "invalid";
  if (Number(exp) * 1000 <= now.getTime()) return "expired";
  return { memberId, digest };
}

export const unsubscribeInput = z.object({ token: z.string().trim().min(1).max(300) }).strict();

/**
 * `POST /gms/digests/unsubscribe`: no sign-in, the signed link is the proof. Turns that one digest
 * off for that membership; a link for a membership that no longer exists answers the same (there
 * is nothing left to send). Mail apps call it with `List-Unsubscribe=One-Click` (RFC 8058).
 */
export async function unsubscribe(base: Pick<BaseContext, "repos" | "now" | "config">, token: string) {
  const secret = base.config.credentialsKey;
  if (!secret) throw new ApiError(503, "digests_not_configured", "Email digests are not set up on this server");
  const read = await readUnsubscribeToken(secret, token, base.now());
  if (read === "invalid") throw new ApiError(400, "invalid_link", "This unsubscribe link is not valid. Sign in to change which emails you get.");
  if (read === "expired") throw new ApiError(410, "link_expired", "This unsubscribe link has expired. Sign in to change which emails you get.");
  const sub = await base.repos.table("digest_subscriptions").one({ member_id: read.memberId });
  if (sub && sub[COLUMN[read.digest]]) await base.repos.table("digest_subscriptions").update({ id: sub.id }, { [COLUMN[read.digest]]: false });
  const ws = sub ? await base.repos.table("workspaces").one({ id: sub.workspace_id }) : null;
  return { digest: read.digest, label: CONTENT_DIGEST_LABEL[read.digest], workspace: ws?.display_name ?? null, on: false };
}

// ------------------------------------------------------------------------------------ settings

async function myMembership(ctx: ServiceContext): Promise<{ ws: ServiceWorkspace; member: Member; row: Ws }> {
  const ws = await authorize(ctx, { person: true });
  if (!ws) throw new ApiError(403, "workspace_required", "Name a workspace for this action");
  const member = await ctx.repos.table("workspace_members").one({ workspace_id: ws.id, user_id: ctx.actor.userId! });
  if (!member || !live(member, ctx.now())) throw new ApiError(403, "not_a_member", "You are not a member of this workspace");
  const row = await ctx.repos.table("workspaces").one({ id: ws.id });
  if (!row) throw new ApiError(404, "not_found", "Workspace not found");
  return { ws, member, row };
}

function view(ctx: Pick<ServiceContext, "now" | "ports" | "config">, member: Member, row: Ws, sub: Sub | null) {
  return {
    digests: offeredDigests(row.kind, member.role).map((key) => ({ key, label: CONTENT_DIGEST_LABEL[key], description: DESCRIPTION[key], on: !!sub?.[COLUMN[key]] })),
    promptDismissed: !!sub?.prompt_dismissed_at,
    nextSendOn: nextSendOn(ctx.now()),
    // Sending needs mail, a sender address and the key that signs unsubscribe links.
    emailAvailable: !!ctx.ports.mailer && !!ctx.config.mailFrom && !!ctx.config.credentialsKey,
  };
}

/** `GET /gms/digests`: the digests this person can turn on in this workspace, and which are on. */
export async function getDigestSettings(ctx: ServiceContext) {
  const { member, row } = await myMembership(ctx);
  return view(ctx, member, row, await ctx.repos.table("digest_subscriptions").one({ member_id: member.id }));
}

export const digestSettingsInput = z
  .object({
    new_matches: z.boolean().optional(),
    deadlines: z.boolean().optional(),
    funder_activity: z.boolean().optional(),
    /** The one-time "Get new matches every Monday" prompt was acted on or dismissed. */
    promptDismissed: z.literal(true).optional(),
  })
  .strict();

/** `PUT /gms/digests`: a person's own choice. Agents and API clients cannot turn email on or off for them. */
export async function saveDigestSettings(ctx: ServiceContext, input: z.output<typeof digestSettingsInput>) {
  if (ctx.actor.kind !== "user") throw new ApiError(403, "person_required", "Which emails a person gets is set by that person");
  const { member, row } = await myMembership(ctx);
  const offered = offeredDigests(row.kind, member.role);
  const patch: Partial<Pick<Sub, "new_matches" | "deadlines" | "funder_activity" | "prompt_dismissed_at">> = {};
  for (const d of CONTENT_DIGESTS) {
    const v = input[d];
    if (v === undefined) continue;
    if (v && !offered.includes(d)) throw new ApiError(422, "digest_not_offered", `"${CONTENT_DIGEST_LABEL[d]}" is not offered to you in this workspace`);
    if (offered.includes(d) || !v) patch[COLUMN[d]] = v;
  }
  if (input.promptDismissed) patch.prompt_dismissed_at = ctx.now().toISOString();
  const table = ctx.repos.table("digest_subscriptions");
  let sub = await table.one({ member_id: member.id });
  if (Object.keys(patch).length) {
    if (sub) sub = (await table.update({ id: sub.id }, patch))[0] ?? sub;
    else {
      try {
        sub = await table.insert({ workspace_id: row.id, member_id: member.id, user_id: member.user_id, ...patch });
      } catch (e) {
        // Two tabs saving at once: the other made the row first.
        if (!(e instanceof RepoError && e.kind === "conflict")) throw e;
        const existing = await table.one({ member_id: member.id });
        sub = existing ? ((await table.update({ id: existing.id }, patch))[0] ?? existing) : null;
      }
    }
  }
  return view(ctx, member, row, sub);
}

// ------------------------------------------------------------------------------------ content

/** One run's shared answers: OpenGrants is asked at most once per workspace and run, within the budget. */
export interface DigestRun {
  openGrantsCalls: number;
  maxOpenGrantsCalls: number;
  /** Set when OpenGrants could not be reached; nothing more is asked of it this run. */
  openGrantsDown: boolean;
  matches: Map<string, Promise<{ gms: Candidate[]; openGrants: Candidate[]; note: string | null }>>;
  deadlines: Map<string, Promise<Awaited<ReturnType<typeof workspaceDeadlines>>>>;
  activity: Map<string, Promise<FunderActivityCounts>>;
}

export const newRun = (maxOpenGrantsCalls = MAX_OPENGRANTS_CALLS_PER_RUN): DigestRun => ({ openGrantsCalls: 0, maxOpenGrantsCalls, openGrantsDown: false, matches: new Map(), deadlines: new Map(), activity: new Map() });

interface Candidate extends DigestMatch {
  key: string;
  /** Its GMS opportunity too, when an OpenGrants listing points back at one. */
  alsoKey: string | null;
}

/** What the person would read in Discover: the same service calls under their own role. */
function memberContext(base: BaseContext, m: Member, ws: Ws): ServiceContext {
  return { ...base, actor: makeActor("user", m.user_id, null), workspace: { id: ws.id, kind: ws.kind as WorkspaceKind, role: m.role, memberScope: (m.scope as Record<string, unknown> | null) ?? null }, scopes: scopesForRole(ws.kind as WorkspaceKind, m.role) };
}

const gmsKey = (opportunityId: string) => `gms:${uuidOf("opportunity", opportunityId, "Opportunity")}`;

async function matchCandidates(ctx: ServiceContext, ws: Ws, run: DigestRun) {
  const web = ctx.config.webBaseUrl;
  const gms: Candidate[] = [];
  for (const c of await discoverCompetitions(ctx)) {
    const eligible = c.eligibility?.eligible === true || (MATCH_UNKNOWN_ELIGIBILITY && c.eligibility?.eligible === "unknown");
    if (!c.acceptingApplications || !eligible || c.application || !c.url) continue;
    const funding = c.opportunity.funding as { maxAwardAmount?: { amount?: string } } | null;
    const max = Number(funding?.maxAwardAmount?.amount);
    gms.push({ key: gmsKey(c.opportunity.id), alsoKey: null, title: c.opportunity.title, funder: c.funder.name, deadline: typeof c.stage?.closes === "string" ? c.stage.closes.slice(0, 10) : null, amount: Number.isFinite(max) && max > 0 ? `up to $${Math.round(max).toLocaleString("en-US")}` : null, source: "gms", link: c.url });
  }
  gms.sort((a, b) => (a.deadline ?? "9999").localeCompare(b.deadline ?? "9999"));
  const openGrantsResults: Candidate[] = [];
  let note: string | null = null;
  if (ctx.ports.openGrants) {
    if (run.openGrantsDown || run.openGrantsCalls >= run.maxOpenGrantsCalls) note = OPENGRANTS_UNAVAILABLE_NOTE;
    else {
      run.openGrantsCalls++;
      try {
        const { results } = await openGrants(ctx, "match", {});
        for (const l of results) {
          const alsoKey = l.gms ? gmsKey(l.gms.opportunityId) : null;
          openGrantsResults.push({ key: `og:${l.id}`, alsoKey, title: l.title, funder: l.funder ?? null, deadline: l.deadline ?? null, amount: l.amount ?? null, source: "opengrants", link: `${web}/w/${ws.handle}/find` });
        }
      } catch (e) {
        if (!(e instanceof ApiError)) throw e;
        if (e.code === "opengrants_unavailable") {
          run.openGrantsDown = true;
          note = OPENGRANTS_UNAVAILABLE_NOTE;
        } else if (e.code === "opengrants_profile_incomplete") note = OPENGRANTS_PROFILE_NOTE;
        // Not configured or not offered: the GMS part alone, with nothing to apologize for.
      }
    }
  }
  return { gms, openGrants: openGrantsResults, note };
}

/** What this person was sent before, or the workspace already saved, tracks or applied to: never listed again. */
async function seenKeys(base: Pick<BaseContext, "repos">, ws: Ws, userId: string): Promise<Set<string>> {
  const seen = new Set<string>();
  for (const s of await base.repos.table("digest_sends").find({ workspace_id: ws.id, user_id: userId, digest: "new_matches" }, { limit: 1000 })) for (const k of s.item_keys) seen.add(k);
  for (const s of await base.repos.table("discover_saved").find({ workspace_id: ws.id, source: ["gms", "opengrants"] }, { limit: 5000 })) {
    if (s.gms_opportunity_id) seen.add(`gms:${s.gms_opportunity_id}`);
    if (s.source === "opengrants") seen.add(`og:${s.external_id}`);
    else {
      try {
        seen.add(gmsKey(s.external_id));
      } catch {
        // A saved row from an older client that names no opportunity.
      }
    }
  }
  for (const o of await base.repos.table("outside_applications").find({ workspace_id: ws.id, source: "opengrants" }, { limit: 5000 })) if (o.source_ref) seen.add(`og:${o.source_ref}`);
  // An opportunity here the workspace has applied to (an OpenGrants listing may point back at it).
  for (const a of await base.repos.table("applications").find({ applicant_workspace_id: ws.id }, { limit: 5000 })) if (a.status !== "withdrawn") seen.add(`gms:${a.opportunity_id}`);
  return seen;
}

export async function buildNewMatches(ctx: ServiceContext, ws: Ws, userId: string, run: DigestRun): Promise<{ items: Candidate[]; note: string | null }> {
  let pending = run.matches.get(ws.id);
  if (!pending) run.matches.set(ws.id, (pending = matchCandidates(ctx, ws, run)));
  const found = await pending;
  const seen = await seenKeys(ctx, ws, userId);
  const items: Candidate[] = [];
  const taken = new Set<string>();
  for (const c of [...found.gms, ...found.openGrants]) {
    if (items.length >= MAX_DIGEST_MATCHES) break;
    if (seen.has(c.key) || taken.has(c.key) || (c.alsoKey && (seen.has(c.alsoKey) || taken.has(c.alsoKey)))) continue;
    items.push(c);
    taken.add(c.key);
    if (c.alsoKey) taken.add(c.alsoKey);
  }
  return { items, note: found.note };
}

/**
 * Deadlines from today through 21 days ahead, as the calendar feed lists them, without the ones a
 * daily reminder emailed this person today: an outside deadline on one of its reminder days for
 * someone the reminder goes to, and a report whose reminder went out today.
 */
export async function buildDeadlines(base: BaseContext, ws: Ws, m: Member, run: DigestRun): Promise<DigestDeadline[]> {
  const now = base.now();
  const today = day(now);
  const until = day(plusDays(now, DEADLINE_DIGEST_DAYS));
  let pending = run.deadlines.get(ws.id);
  if (!pending) run.deadlines.set(ws.id, (pending = workspaceDeadlines(base, ws.id)));
  const upcoming = (await pending).filter((d) => d.date >= today && d.date <= until);
  const web = base.config.webBaseUrl;
  const prefs = normalizePreferences(m.notification_preferences as never);
  const out: DigestDeadline[] = [];
  for (const d of upcoming) {
    const [kind, id] = d.key.split(":") as [string, string];
    if (kind === "oa") {
      const deadlineKind = d.key.split(":")[2] as "loi" | "full" | "internal";
      if (OUTSIDE_DEADLINE_OFFSETS.includes(daysBetween(today, d.date)) && prefs.channels.outside_deadline.email && OUTSIDE_ROLES.includes(m.role)) {
        const oa = await base.repos.table("outside_applications").one({ id, workspace_id: ws.id });
        if (oa && OUTSIDE_REMINDABLE[deadlineKind]?.includes(oa.stage)) {
          const open = (await base.repos.table("outside_questions").find({ workspace_id: ws.id, outside_application_id: oa.id, obligation_id: null })).filter((q) => q.status !== "approved");
          if (oa.owner_user_id === m.user_id || open.some((q) => q.assignee_user_id === m.user_id)) continue;
        }
      }
      out.push({ date: d.date, label: d.label, title: d.title, funder: d.funder, link: `${web}/w/${ws.handle}/outside/${id}` });
    } else if (kind === "req") {
      const sentToday = (await base.repos.table("reminder_sends").find({ requirement_id: id }, { limit: 50 })).some((r) => r.sent_at.slice(0, 10) === today);
      if (sentToday) continue;
      out.push({ date: d.date, label: d.label, title: d.title, funder: d.funder, link: `${web}/w/${ws.handle}/reports` });
    } else {
      out.push({ date: d.date, label: d.label, title: d.title, funder: d.funder, link: `${web}/w/${ws.handle}/applications/${apiId("application", id)}/edit` });
    }
  }
  return out;
}

/** The week's counts for a funder workspace. Counts only: nothing an applicant wrote is read. */
export async function buildFunderActivity(base: Pick<BaseContext, "repos" | "now">, ws: Ws, run: DigestRun): Promise<FunderActivityCounts> {
  let pending = run.activity.get(ws.id);
  if (!pending) {
    pending = (async () => {
      const now = base.now();
      const weekAgo = plusDays(now, -7).toISOString();
      const weekAhead = plusDays(now, 7).toISOString();
      const apps = await base.repos.table("applications").find({ workspace_id: ws.id }, { notNull: ["submitted_at"], limit: 5000 });
      const reviews = await base.repos.table("review_assignments").find({ workspace_id: ws.id, status: ["assigned", "in_progress"] }, { notNull: ["due_at"], limit: 5000 });
      const tranches = await base.repos.table("tranches").find({ workspace_id: ws.id, status: ["due", "ready", "scheduled"] }, { limit: 5000 });
      return {
        newApplications: apps.filter((a) => a.submitted_at! >= weekAgo && a.status !== "withdrawn").length,
        reviewsDue: reviews.filter((r) => r.due_at! <= weekAhead).length,
        paymentsDue: tranches.filter((t) => t.status !== "scheduled" || (!!t.due_at && t.due_at <= weekAhead)).length,
        reportsOverdue: await base.repos.table("requirements").count({ workspace_id: ws.id, status: "overdue" }),
      };
    })();
    run.activity.set(ws.id, pending);
  }
  return pending;
}

const ACTIVITY_LINKS = (web: string, handle: string): Record<keyof FunderActivityCounts, string> => ({
  newApplications: `${web}/w/${handle}/applications`,
  reviewsDue: `${web}/w/${handle}/reviews/assign`,
  paymentsDue: `${web}/w/${handle}/payments/due`,
  reportsOverdue: `${web}/w/${handle}/reporting`,
});

interface Composed {
  email: DigestEmail;
  /** The matches it lists, recorded so they are never sent again. */
  keys: string[];
}

/** One digest for one member, or null when there is nothing new. */
async function compose(ctx: ServiceContext, digest: ContentDigest, ws: Ws, m: Member, links: Pick<DigestFrame, "unsubscribeLink" | "oneClickUrl">, run: DigestRun): Promise<Composed | null> {
  const frame: DigestFrame = { workspace: ws.display_name, settingsLink: `${ctx.config.webBaseUrl}/notifications`, ...links };
  if (digest === "new_matches") {
    const { items, note } = await buildNewMatches(ctx, ws, m.user_id, run);
    if (!items.length) return null;
    return { email: newMatchesDigestEmail({ ...frame, items, note }), keys: items.flatMap((i) => [i.key, ...(i.alsoKey ? [i.alsoKey] : [])]) };
  }
  if (digest === "deadlines") {
    const items = await buildDeadlines(ctx, ws, m, run);
    return items.length ? { email: deadlinesDigestEmail({ ...frame, items, today: day(ctx.now()) }), keys: [] } : null;
  }
  const counts = await buildFunderActivity(ctx, ws, run);
  if (!Object.values(counts).some((n) => n > 0)) return null;
  return { email: funderActivityDigestEmail({ ...frame, counts, links: ACTIVITY_LINKS(ctx.config.webBaseUrl, ws.handle) }), keys: [] };
}

export const previewQuery = z.object({ digest: z.enum(CONTENT_DIGESTS) }).strict();

/**
 * `GET /gms/digests/preview?digest=`: next Monday's email as it would be written now, for the
 * person asking. Nothing is sent or recorded; the unsubscribe link is a placeholder.
 */
export async function previewDigest(ctx: ServiceContext, digest: ContentDigest) {
  const { member, row } = await myMembership(ctx);
  if (!offeredDigests(row.kind, member.role).includes(digest)) throw new ApiError(422, "digest_not_offered", `"${CONTENT_DIGEST_LABEL[digest]}" is not offered to you in this workspace`);
  const sub = await ctx.repos.table("digest_subscriptions").one({ member_id: member.id });
  const sample = `${ctx.config.webBaseUrl}/digests/unsubscribe`;
  const made = await compose(ctx, digest, row, member, { unsubscribeLink: sample, oneClickUrl: `${ctx.config.baseUrl}/gms/digests/unsubscribe` }, newRun(1));
  return { digest, label: CONTENT_DIGEST_LABEL[digest], on: !!sub?.[COLUMN[digest]], sendsOn: nextSendOn(ctx.now()), willSend: !!made, subject: made?.email.subject ?? null, text: made?.email.text ?? null };
}

// ------------------------------------------------------------------------------------ the Monday job

async function inChunks<T, R>(items: T[], size: number, fn: (chunk: T[]) => Promise<R[]>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) out.push(...(await fn(items.slice(i, i + size))));
  return out;
}

export interface ContentDigestRunResult {
  sent: number;
  /** Turned on, but nothing new this week. */
  empty: number;
  /** Already sent this ISO week. */
  already: number;
  /** No longer a member, a role that does not get it, or no address. */
  skipped: number;
  failed: number;
  openGrantsCalls: number;
  openGrantsDown: boolean;
  /** Set when the server cannot send at all (no mailer, sender, directory or link key). */
  notConfigured?: true;
}

/**
 * The Monday run. For every membership with a digest on: check it is still a live membership with
 * a role that gets it, skip a digest already sent this ISO week, build it, skip it when empty,
 * send it (Resend's idempotency key names the membership, digest and week) and record the send.
 * One failing digest does not stop the others.
 */
export async function sendContentDigests(base: BaseContext, opts: { maxOpenGrantsCalls?: number } = {}): Promise<ContentDigestRunResult> {
  const run = newRun(opts.maxOpenGrantsCalls);
  const out: ContentDigestRunResult = { sent: 0, empty: 0, already: 0, skipped: 0, failed: 0, openGrantsCalls: 0, openGrantsDown: false };
  const { mailer, directory } = base.ports;
  const from = base.config.mailFrom;
  const secret = base.config.credentialsKey;
  if (!mailer || !from || !directory || !secret) return { ...out, notConfigured: true };
  const now = base.now();
  const week = isoWeek(now);
  const subs = (await base.repos.table("digest_subscriptions").find({}, { limit: 10_000 })).filter((s) => s.new_matches || s.deadlines || s.funder_activity);
  const members = new Map((await inChunks(subs.map((s) => s.member_id), 100, (ids) => base.repos.table("workspace_members").find({ id: ids }))).map((m) => [m.id, m]));
  const workspaces = new Map((await inChunks([...new Set(subs.map((s) => s.workspace_id))], 100, (ids) => base.repos.table("workspaces").find({ id: ids }))).map((w) => [w.id, w]));
  const people = await directory.lookup([...new Set([...members.values()].map((m) => m.user_id))]);
  for (const sub of subs) {
    for (const digest of CONTENT_DIGESTS.filter((d) => sub[COLUMN[d]])) {
      try {
        const m = members.get(sub.member_id);
        const ws = workspaces.get(sub.workspace_id);
        const to = m ? people.get(m.user_id)?.email : null;
        // Removed (the row outlived it), expired, moved to a role without it, or no address: nothing goes out.
        if (!m || !ws || !to || !live(m, now) || m.workspace_id !== sub.workspace_id || m.user_id !== sub.user_id || !offeredDigests(ws.kind, m.role).includes(digest)) {
          out.skipped++;
          continue;
        }
        if (await base.repos.table("digest_sends").one({ workspace_id: ws.id, user_id: m.user_id, digest, iso_week: week })) {
          out.already++;
          continue;
        }
        const token = await unsubscribeToken(secret, m.id, digest, new Date(now.getTime() + UNSUBSCRIBE_TTL_DAYS * DAY_MS));
        const links = { unsubscribeLink: `${base.config.webBaseUrl}/digests/unsubscribe#token=${token}`, oneClickUrl: `${base.config.baseUrl}/gms/digests/unsubscribe?token=${token}` };
        const made = await compose(memberContext(base, m, ws), digest, ws, m, links, run);
        if (!made) {
          out.empty++;
          continue;
        }
        const sent = await mailer.send({ from, to: [to], subject: made.email.subject, text: made.email.text, html: made.email.html, headers: made.email.headers, idempotencyKey: `${CONTENT_DIGEST_TEMPLATE[digest]}:${m.id}:${week}`, tags: [{ name: "template", value: CONTENT_DIGEST_TEMPLATE[digest] }] });
        try {
          await base.repos.table("digest_sends").insert({ workspace_id: ws.id, user_id: m.user_id, digest, iso_week: week, item_keys: made.keys.slice(0, 40), message_id: sent.id.slice(0, 200), sent_at: now.toISOString() });
        } catch (e) {
          // A parallel run recorded it first; the idempotency key kept the mail to one.
          if (!(e instanceof RepoError && e.kind === "conflict")) throw e;
        }
        out.sent++;
      } catch {
        out.failed++;
      }
    }
  }
  return { ...out, openGrantsCalls: run.openGrantsCalls, openGrantsDown: run.openGrantsDown };
}
