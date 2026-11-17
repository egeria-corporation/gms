// SPDX-License-Identifier: AGPL-3.0-only
// Social posting through Zernio (v1.9.0): a funder announces an open call or an award on its own
// accounts, a grantee shares its award, and the reach report shows what each post did.
//
//   settings   the platforms, the workspace's connected accounts, and what this caller may do;
//   connect    Settings › Social accounts: the workspace's Zernio profile is created on first use
//              (externalId = workspace id), Zernio's sign-in link comes back with a state this
//              server sealed (workspace, person, platform, ten minutes), and the callback records
//              the account only after Zernio lists it under this workspace's profile;
//   compose    the text, link and share card prefilled from an opportunity or an award;
//   preview    the exact body that will be sent, with each platform's length, and a token that
//              names that body;
//   send       only a signed-in person's click on Post: the body is built again, must be the one
//              previewed, and goes out once per Idempotency-Key;
//   reach      per post the platform links and statuses and Zernio's counts; per opportunity the
//              applications started from a shared link (utm_source=social).
//   program    (v1.12.0) "Meet our grantees": one post about several of a program's awards, only
//              those award sharing says may be public, tagging a grantee's page only with its consent;
//   reminder   (v1.12.0) "Two weeks left": fourteen days before an open call's deadline the jobs
//              Worker records one prompt per call; the call's funder admins see "Post a reminder?"
//              in their notifications (and digest), which opens the composer prefilled. Nothing
//              posts by itself; an admin may dismiss the prompt.
//
// Human gates: posting, scheduling, connecting and disconnecting refuse agents and API clients
// (`human_only`); there is no MCP tool for any of them. Reads (settings, compose, reach) use the
// one authorization check, so an agent with the scope reads what the person would.
//
// Hidden when ZERNIO_API_KEY or ZERNIO_WEBHOOK_SECRET is not set: every route answers 404.
// Kept: Zernio ids, platform names, usernames, post links, statuses and counts. Never a token,
// an inbox message, a follower list, or the post's text (its SHA-256 is kept for retries).
import {
  buildPostBody,
  checkCompose,
  hmacHex,
  isHandledEvent,
  NEEDS_IMAGE,
  openToken,
  parseZernioEvent,
  PLATFORM_LABEL,
  PLATFORM_LIMIT,
  PLATFORMS,
  postDigest,
  sealToken,
  SIGNATURE_HEADER,
  verifyZernioSignature,
  ZernioClient,
  ZernioError,
  type Platform,
  type PostBody,
  type SocialPort,
  type ZernioPost,
} from "@gms/social";
import { z } from "zod";
import type { WorkspaceKind } from "../auth/scopes.ts";
import { forbidden } from "../auth/verify.ts";
import { ApiError, notFound } from "../lib/errors.ts";
import * as awardSharing from "./social-award-share.ts";
import { audit, authorize, changeStatus, guardWrite, systemContext, type BaseContext, type ServiceContext, type ServiceWorkspace } from "./context.ts";
import { DEFAULT_LOCALE, formatDateIn } from "@gms/i18n";
import { serverTranslator } from "@gms/i18n/server";
import { RepoError, type Row } from "./repos/types.ts";

// ------------------------------------------------------------------------------------ settings

/** Who may post, per kind of workspace (admins and editors). One constant to relax. */
export const POST_ROLES: Record<WorkspaceKind, readonly string[]> = { funder: ["admin", "program_officer"], applicant: ["admin", "editor"] };
const POST_SCOPE = { funder: "communications:write", applicant: "messages:write" } as const;
/** Who may connect and disconnect the workspace's accounts. Stricter than posting: admins only. */
export const CONNECT_ROLES: readonly string[] = ["admin"];
/** Who may read posts and reach: the workspace's staff (the scope every staff role holds). */
const READ_SCOPE = { funder: "analytics:read", applicant: "awards:read" } as const;

/** A connect link is good for this long. */
export const CONNECT_STATE_TTL_MS = 10 * 60 * 1000;
/** A preview may be posted for this long. */
export const PREVIEW_TTL_MS = 60 * 60 * 1000;
/** Counts are read from Zernio again after this long. */
export const METRICS_TTL_MS = 30 * 60 * 1000;
/** Zernio calls one reach report may make (each post's counts, a post still sending). */
export const REFRESH_PER_REQUEST = 10;
/** A webhook delivery older than this is not applied, whatever its signature. */
export const REPLAY_WINDOW_MS = 24 * 60 * 60 * 1000;
/** What a shared link carries, and what the reach report counts. */
export const UTM_SOURCE = "social";

type Account = Row<"social_accounts">;
type Post = Row<"social_posts">;
type PostStatus = "sending" | "scheduled" | "published" | "partial" | "failed";
type Target = { accountId: string; platform: Platform; username: string | null; status: "sending" | "scheduled" | "published" | "failed"; url: string | null };

const hidden = () => new ApiError(404, "social_not_configured", "Social posting is not set up on this server");
export const socialConfigured = (ctx: Pick<ServiceContext, "config">) => !!ctx.config.zernio;

/** The Zernio client for this server, or 404 when it is not set up. */
function zernio(ctx: Pick<ServiceContext, "config">): SocialPort {
  const z = ctx.config.zernio;
  if (!z) throw hidden();
  return new ZernioClient({ apiKey: z.apiKey });
}

/** The key that seals connect states and preview tokens, derived from this server's Zernio key. */
const tokenKey = (ctx: Pick<ServiceContext, "config">) => hmacHex(ctx.config.zernio!.apiKey, "opengrants-gms social tokens v1");

const personOnly = (ctx: ServiceContext, what: string) => {
  if (ctx.actor.kind !== "user" || !ctx.actor.userId) throw forbidden("human_only", `${what} is done by a signed-in person in the GMS, never by an agent or API client`);
};

const kindOf = (ctx: ServiceContext): WorkspaceKind => {
  if (!ctx.workspace) throw forbidden("workspace_required", "Name a workspace for this action");
  return ctx.workspace.kind;
};

async function readWorkspace(ctx: ServiceContext): Promise<ServiceWorkspace> {
  if (!socialConfigured(ctx)) throw hidden();
  return authorize(ctx, { scope: READ_SCOPE[kindOf(ctx)] });
}

async function postWorkspace(ctx: ServiceContext, what: string): Promise<ServiceWorkspace> {
  if (!socialConfigured(ctx)) throw hidden();
  const kind = kindOf(ctx);
  const ws = await authorize(ctx, { scope: POST_SCOPE[kind], roles: POST_ROLES[kind], person: true });
  personOnly(ctx, what);
  return ws;
}

async function connectWorkspace(ctx: ServiceContext, what: string): Promise<ServiceWorkspace> {
  if (!socialConfigured(ctx)) throw hidden();
  const ws = await authorize(ctx, { scope: "workspace:admin", roles: CONNECT_ROLES, person: true });
  personOnly(ctx, what);
  return ws;
}

/** What a failed Zernio call means for the person. Zernio's own text is never repeated. */
function zernioFailure(e: unknown, nothing = "Nothing was changed"): never {
  if (e instanceof ApiError) throw e;
  if (e instanceof ZernioError) {
    if (e.kind === "auth") throw new ApiError(502, "zernio_rejected", `Zernio refused this server's key. ${nothing}`);
    if (e.kind === "rate_limited") throw new ApiError(503, "zernio_busy", `Zernio asked us to slow down. ${nothing}; try again in a minute`);
    if (e.kind === "unavailable") throw new ApiError(503, "zernio_unavailable", `Zernio could not be reached. ${nothing}; try again in a few minutes`);
    throw new ApiError(502, "zernio_refused", `Zernio did not accept the request. ${nothing}`);
  }
  throw e;
}

const accountView = (a: Account) => ({ id: a.id, platform: a.platform as Platform, label: PLATFORM_LABEL[a.platform as Platform] ?? a.platform, username: a.username, status: a.status as "active" | "disconnected", connectedAt: a.connected_at, disconnectedAt: a.disconnected_at });
const platformsView = () => PLATFORMS.map((p) => ({ platform: p, label: PLATFORM_LABEL[p], limit: PLATFORM_LIMIT[p], needsImage: NEEDS_IMAGE[p] }));

export async function socialSettings(ctx: ServiceContext) {
  const ws = await readWorkspace(ctx);
  const [profile, accounts] = await Promise.all([ctx.repos.table("social_profiles").one({ workspace_id: ws.id }), ctx.repos.table("social_accounts").find({ workspace_id: ws.id }, { orderBy: "connected_at", ascending: true })]);
  const person = ctx.actor.kind === "user";
  return {
    profileCreated: !!profile,
    platforms: platformsView(),
    accounts: accounts.filter((a) => a.status === "active").map(accountView),
    canConnect: person && ws.role !== null && CONNECT_ROLES.includes(ws.role) && ctx.scopes.includes("workspace:admin"),
    canPost: person && ws.role !== null && POST_ROLES[ws.kind].includes(ws.role),
  };
}

// ------------------------------------------------------------------------------------ connect

export const connectInput = z.object({ platform: z.enum(PLATFORMS) }).strict();
export const callbackInput = z
  .object({
    /** The `gs` this server put on the redirect URL. */
    state: z.string().min(10).max(2000),
    /** What Zernio appended to the redirect URL. Checked against Zernio, never trusted alone. */
    profileId: z.string().min(1).max(64),
    accountId: z.string().min(1).max(64),
    connected: z.string().max(40).optional(),
    username: z.string().max(200).optional(),
  })
  .strict();

async function ensureProfile(ctx: ServiceContext, port: SocialPort, ws: ServiceWorkspace): Promise<Row<"social_profiles">> {
  const existing = await ctx.repos.table("social_profiles").one({ workspace_id: ws.id });
  if (existing) return existing;
  const home = await ctx.repos.table("workspaces").one({ id: ws.id });
  if (!home) throw notFound("Workspace");
  const { id } = await port.ensureProfile({ name: home.display_name.slice(0, 100), externalId: ws.id }).catch((e: unknown) => zernioFailure(e));
  try {
    const row = await ctx.repos.table("social_profiles").insert({ workspace_id: ws.id, zernio_profile_id: id, created_by: ctx.actor.userId });
    await audit(ctx, "social.profile.created", "social_profile", row.id, { zernioProfileId: id });
    return row;
  } catch (e) {
    // Two first connections at once: the other one recorded it.
    if (e instanceof RepoError && e.kind === "conflict") {
      const row = await ctx.repos.table("social_profiles").one({ workspace_id: ws.id });
      if (row && row.zernio_profile_id === id) return row;
    }
    throw e;
  }
}

/** Start connecting an account: Zernio's sign-in link, which returns to Settings › Social accounts. */
export async function startConnect(ctx: ServiceContext, platform: Platform) {
  const ws = await connectWorkspace(ctx, "Connecting a social account");
  const port = zernio(ctx);
  const home = await ctx.repos.table("workspaces").one({ id: ws.id });
  if (!home) throw notFound("Workspace");
  const profile = await ensureProfile(ctx, port, ws);
  const nonce = crypto.randomUUID();
  const state = await sealToken(await tokenKey(ctx), "social-connect", { w: ws.id, u: ctx.actor.userId, p: platform, n: nonce }, new Date(ctx.now().getTime() + CONNECT_STATE_TTL_MS));
  const redirectUrl = `${ctx.config.webBaseUrl}/w/${home.handle}/settings/social?gs=${encodeURIComponent(state)}`;
  const { authUrl } = await port.connectLink(platform, profile.zernio_profile_id, redirectUrl).catch((e: unknown) => zernioFailure(e));
  await audit(ctx, "social.connect.started", "social_profile", profile.id, { platform });
  return { authUrl, expiresInSeconds: CONNECT_STATE_TTL_MS / 1000 };
}

const badState = () => forbidden("connect_state_invalid", "This connection link is not valid for you here, or it has expired. Start again from Social accounts");

/** Record the account Zernio connected, once its callback is shown to belong to this workspace and person. */
export async function finishConnect(ctx: ServiceContext, input: z.output<typeof callbackInput>) {
  const ws = await connectWorkspace(ctx, "Connecting a social account");
  const port = zernio(ctx);
  const s = await openToken<{ w?: unknown; u?: unknown; p?: unknown }>(await tokenKey(ctx), "social-connect", input.state, ctx.now());
  if (!s || s.w !== ws.id || s.u !== ctx.actor.userId || typeof s.p !== "string" || !(PLATFORMS as readonly string[]).includes(s.p)) throw badState();
  const platform = s.p as Platform;
  const profile = await ctx.repos.table("social_profiles").one({ workspace_id: ws.id });
  if (!profile || profile.zernio_profile_id !== input.profileId) throw badState();
  // The query string is only a hint: the account must be listed under this workspace's profile.
  const listed = (await port.listAccounts(profile.zernio_profile_id).catch((e: unknown) => zernioFailure(e))).find((a) => a.id === input.accountId && a.platform === platform);
  if (!listed) throw new ApiError(409, "account_not_listed", `Zernio does not list that ${PLATFORM_LABEL[platform]} account for this workspace. Try connecting again`);
  return recordAccount(ctx, ws.id, { id: listed.id, platform, username: listed.username }, "callback");
}

async function recordAccount(ctx: ServiceContext, workspaceId: string, acc: { id: string; platform: Platform; username: string | null }, via: "callback" | "webhook") {
  const at = ctx.now().toISOString();
  const existing = await ctx.repos.table("social_accounts").one({ zernio_id: acc.id });
  // An account never moves between workspaces.
  if (existing && existing.workspace_id !== workspaceId) throw new ApiError(409, "account_elsewhere", "That account is connected to another workspace");
  const username = acc.username ? acc.username.slice(0, 200) : (existing?.username ?? null);
  let row: Account;
  if (existing) {
    if (existing.status === "active") {
      row = (await ctx.repos.table("social_accounts").update({ id: existing.id }, { username }))[0]!;
      return accountView(row);
    }
    await changeStatus(ctx, {
      event: "social.account.connected",
      subjectType: "social_account",
      subjectId: existing.id,
      current: existing.status,
      from: ["disconnected"],
      to: "active",
      data: { platform: acc.platform, via },
      write: async () => {
        row = (await ctx.repos.table("social_accounts").update({ id: existing.id }, { status: "active", username, connected_at: at, connected_by: ctx.actor.userId, disconnected_at: null }))[0]!;
      },
    });
    return accountView(row!);
  }
  row = await guardWrite("That account", () => ctx.repos.table("social_accounts").insert({ workspace_id: workspaceId, zernio_id: acc.id, platform: acc.platform, username, status: "active", connected_at: at, connected_by: ctx.actor.userId }));
  await audit(ctx, "social.account.connected", "social_account", row.id, { platform: acc.platform, via, from: null, to: "active" });
  return accountView(row);
}

export async function disconnectAccount(ctx: ServiceContext, id: string) {
  const ws = await connectWorkspace(ctx, "Disconnecting a social account");
  const port = zernio(ctx);
  const row = await ctx.repos.table("social_accounts").one({ id, workspace_id: ws.id });
  if (!row) throw notFound("Social account");
  if (row.status === "disconnected") return accountView(row);
  await port.disconnectAccount(row.zernio_id).catch((e: unknown) => zernioFailure(e));
  return markDisconnected(ctx, row, "settings");
}

async function markDisconnected(ctx: ServiceContext, row: Account, via: "settings" | "webhook") {
  let out = row;
  await changeStatus(ctx, {
    event: "social.account.disconnected",
    subjectType: "social_account",
    subjectId: row.id,
    current: row.status,
    from: ["active"],
    to: "disconnected",
    data: { platform: row.platform, via },
    write: async () => {
      out = (await ctx.repos.table("social_accounts").update({ id: row.id }, { status: "disconnected", disconnected_at: ctx.now().toISOString() }))[0]!;
    },
  });
  return accountView(out);
}

// ------------------------------------------------------------------------------------ compose

/** What a post is about: an open call, an award, or (v1.12.0, "Meet our grantees") a funder's program. */
export const SUBJECT_TYPES = ["opportunity", "award", "program"] as const;
export const subjectInput = z.object({ type: z.enum(SUBJECT_TYPES), id: z.uuid() }).strict();
type Subject = z.output<typeof subjectInput>;

/** One of a program's awards in a "Meet our grantees" post: its line, ready to keep or drop. */
export interface DraftGrantee {
  awardId: string;
  name: string;
  /** The grantee's page handle, only when it gave the link and agreed to be tagged. */
  tag: string | null;
  line: string;
}

export interface Draft {
  subject: { type: Subject["type"]; id: string; title: string };
  /** False when this subject may not be posted about; `reason` says why. */
  shareable: boolean;
  reason: string | null;
  /** Ready-to-edit texts; the first is put in the composer. `kind` names a reminder's. */
  suggestions: { label: string; text: string; kind?: "reminder" | "meet" }[];
  link: string | null;
  imageUrl: string | null;
  /** A call's "Two weeks left" prompt, while it is waiting (not dismissed, deadline not passed). */
  reminder?: { id: string; deadline: string } | null;
  /** An award's program, for the funder's "Meet our grantees" (funder side only). */
  program?: { id: string; name: string } | null;
  /** "Meet our grantees": the program's awards that may be public, with the intro and closing lines. */
  grantees?: DraftGrantee[];
  parts?: { intro: string; outro: string } | null;
}

const dateText = (iso: string | undefined) => (iso && !Number.isNaN(Date.parse(iso)) ? new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }) : null);

/** The link with `utm_source=social`, so the public page can count applications started from a post. */
export function withUtm(link: string): string {
  const u = new URL(link);
  u.searchParams.set("utm_source", UTM_SOURCE);
  return u.toString();
}

async function opportunityDraft(ctx: ServiceContext, ws: ServiceWorkspace, id: string): Promise<Draft> {
  if (ws.kind !== "funder") throw notFound("Opportunity");
  const o = await ctx.repos.table("opportunities").one({ id, workspace_id: ws.id });
  if (!o) throw notFound("Opportunity");
  const home = await ctx.repos.table("workspaces").one({ id: ws.id });
  const listed = !!o.published_at && (o.publish as { publicPage?: boolean } | null)?.publicPage !== false;
  const base: Draft = { subject: { type: "opportunity", id: o.id, title: o.title }, shareable: false, reason: null, suggestions: [], link: null, imageUrl: null };
  if (!home) return { ...base, reason: "This workspace has no public page" };
  if (!listed) return { ...base, reason: "Publish this call with Public page on before you share it" };
  if (o.status !== "open" && o.status !== "forecasted") return { ...base, reason: "This call is closed, so it is not offered for posting" };
  const page = `${ctx.config.webBaseUrl}/f/${home.handle}/o/${o.slug}`;
  const link = withUtm(page);
  const keyDates = (o.key_dates ?? {}) as { closeDate?: { date?: string }; postDate?: { date?: string } };
  const close = dateText(keyDates.closeDate?.date);
  const opens = dateText(keyDates.postDate?.date);
  const funder = home.display_name;
  const long = o.status === "open" ? `Applications are open: ${o.title}, from ${funder}.${close ? ` Apply by ${close}.` : ""}\n\n${link}` : `Coming soon: ${o.title}, from ${funder}.${opens ? ` Applications open ${opens}.` : ""}\n\n${link}`;
  const short = o.status === "open" ? `Now open: ${o.title}${close ? ` (apply by ${close})` : ""} ${link}` : `Coming soon: ${o.title} ${link}`;
  const suggestions: Draft["suggestions"] = [{ label: "Announcement", text: long }, { label: "Short", text: short }];
  // "Two weeks left": while the call's prompt waits, the composer starts from the reminder.
  const prompt = o.status === "open" ? await waitingPrompt(ctx, o.id) : null;
  if (prompt) {
    const locale = ctx.locale ?? DEFAULT_LOCALE;
    const t = serverTranslator(locale, "email");
    suggestions.unshift({ kind: "reminder", label: t("kit.reminder.label"), text: t("kit.reminder.text", { title: o.title, funder, date: formatDateIn(locale, prompt.deadline, "medium") ?? prompt.deadline, link }) });
  }
  return { ...base, shareable: true, suggestions, link, imageUrl: `${ctx.config.webBaseUrl}/og/f/${home.handle}/o/${o.slug}.png`, reminder: prompt ? { id: prompt.id, deadline: prompt.deadline } : null };
}

async function awardDraft(ctx: ServiceContext, ws: ServiceWorkspace, id: string): Promise<Draft> {
  const a = await ctx.repos.table("awards").one({ id });
  const mine = a && (ws.kind === "funder" ? a.workspace_id === ws.id : a.recipient_workspace_id === ws.id);
  if (!a || !mine) throw notFound("Award");
  const base: Draft = { subject: { type: "award", id: a.id, title: a.title }, shareable: false, reason: null, suggestions: [], link: null, imageUrl: null };
  // Never offered for a confidential or unlisted award (C1's one public check).
  if (!(await awardSharing.isPubliclyListable(ctx, a))) return { ...base, reason: "This award is not listed publicly, so it is not offered for posting" };
  const kit = await awardSharing.shareKit(ctx, a.id, ws.kind === "funder" ? "funder" : "grantee");
  if (!kit) return { ...base, reason: "This award has no share kit yet" };
  const link = withUtm(kit.link);
  const swap = (text: string) => text.split(kit.link).join(link);
  // The funder may also post about the award's program ("Meet our grantees").
  const program = ws.kind === "funder" && a.program_id ? await ctx.repos.table("programs").one({ id: a.program_id, workspace_id: ws.id }) : null;
  return { ...base, shareable: true, suggestions: kit.posts.map((p) => ({ label: p.label, text: swap(p.text) })), link, imageUrl: kit.imageUrl, program: program ? { id: program.id, name: program.name } : null };
}

/**
 * "Meet our grantees": one post about a funder's program, listing its awards that award sharing
 * says may be public (never a confidential award, one the funder does not list, or one whose
 * grantee chose "Don't list us publicly"), tagging a grantee's page only with its consent.
 */
async function programDraft(ctx: ServiceContext, ws: ServiceWorkspace, id: string): Promise<Draft> {
  if (ws.kind !== "funder") throw notFound("Program");
  const { program, grantees, awardsPage } = await awardSharing.meetOurGrantees(ctx, id);
  const base: Draft = { subject: { type: "program", id: program.id, title: program.name }, shareable: false, reason: null, suggestions: [], link: null, imageUrl: null, grantees: [], parts: null };
  if (!grantees.length) return { ...base, reason: "No award in this program is listed publicly yet, so there is no one to introduce" };
  const t = serverTranslator(ctx.locale ?? DEFAULT_LOCALE, "email");
  const link = withUtm(awardsPage);
  const lines: DraftGrantee[] = grantees.map((g) => ({ awardId: g.awardId, name: g.recipient, tag: g.tag?.handle ?? null, line: g.tag ? t("kit.meet.lineTagged", { recipient: g.recipient, tag: g.tag.handle, purpose: g.purpose }) : t("kit.meet.line", { recipient: g.recipient, purpose: g.purpose }) }));
  const parts = { intro: t("kit.meet.intro", { program: program.name }), outro: t("kit.meet.outro", { link }) };
  const text = [parts.intro, "", ...lines.map((l) => l.line), "", parts.outro].join("\n");
  // The funder's grants-awarded card: a post about several awards has no one award's card.
  const home = await ctx.repos.table("workspaces").one({ id: ws.id });
  return { ...base, shareable: true, suggestions: [{ kind: "meet", label: t("kit.meet.label"), text }], link, imageUrl: home ? `${ctx.config.webBaseUrl}/og/f/${home.handle}/awards.png` : null, grantees: lines, parts };
}

const draftFor = (ctx: ServiceContext, ws: ServiceWorkspace, s: Subject) => (s.type === "opportunity" ? opportunityDraft(ctx, ws, s.id) : s.type === "program" ? programDraft(ctx, ws, s.id) : awardDraft(ctx, ws, s.id));

/** The composer's starting point. A read: an agent may fetch it to draft text, never to send. */
export async function composerDraft(ctx: ServiceContext, subject: Subject) {
  const ws = await readWorkspace(ctx);
  return draftFor(ctx, ws, subject);
}

export const composeInput = z
  .object({
    subject: subjectInput,
    content: z.string().max(10_000),
    /** The workspace's accounts to post to, in order. */
    accountIds: z.array(z.uuid()).min(1).max(20),
    /** Attach the subject's share card. */
    includeImage: z.boolean().default(true),
    /** Post now when absent. */
    schedule: z.object({ scheduledFor: z.string().max(25), timezone: z.string().min(1).max(64) }).strict().nullable().default(null),
  })
  .strict();
export const sendInput = composeInput.extend({ previewToken: z.string().min(10).max(4000) });
type ComposeIn = z.output<typeof composeInput>;

interface Composed {
  draft: Draft;
  accounts: Account[];
  body: PostBody;
  digest: string;
  problems: string[];
  lengths: ReturnType<typeof checkCompose>["lengths"];
  scheduledAt: Date | null;
}

async function compose(ctx: ServiceContext, ws: ServiceWorkspace, input: ComposeIn): Promise<Composed> {
  const draft = await draftFor(ctx, ws, input.subject);
  if (!draft.shareable) throw new ApiError(409, "not_shareable", draft.reason ?? "This cannot be posted about");
  const ids = [...new Set(input.accountIds)];
  // Only this workspace's own, connected accounts: never another workspace's.
  const rows = await ctx.repos.table("social_accounts").find({ workspace_id: ws.id, id: ids, status: "active" });
  if (rows.length !== ids.length) throw new ApiError(422, "account_not_connected", "One of the accounts is not connected to this workspace any more. Choose the accounts again");
  const accounts = ids.map((id) => rows.find((r) => r.id === id)!);
  const content = input.content.replace(/\r\n/g, "\n");
  const ci = { content, imageUrl: input.includeImage ? draft.imageUrl : null, targets: accounts.map((a) => ({ platform: a.platform as Platform, accountId: a.zernio_id })), schedule: input.schedule };
  const check = checkCompose(ci, ctx.now());
  const body = buildPostBody(ci);
  return { draft, accounts, body, digest: await postDigest(body), problems: check.problems, lengths: check.lengths, scheduledAt: check.scheduledAt };
}

const previewView = (c: Composed) => ({
  subject: c.draft.subject,
  content: c.body.content,
  imageUrl: c.body.mediaItems?.[0]?.url ?? null,
  accounts: c.accounts.map(accountView),
  publishNow: c.body.publishNow === true,
  schedule: c.body.scheduledFor ? { scheduledFor: c.body.scheduledFor, timezone: c.body.timezone!, at: c.scheduledAt?.toISOString() ?? null } : null,
  lengths: c.lengths,
  problems: c.problems,
  /** Exactly what Zernio will receive. */
  body: c.body,
});

/** The exact post, as it will be sent, and a token for Post. Only for a person who may post. */
export async function previewPost(ctx: ServiceContext, input: ComposeIn) {
  const ws = await postWorkspace(ctx, "Posting");
  const c = await compose(ctx, ws, input);
  const previewToken = c.problems.length ? null : await sealToken(await tokenKey(ctx), "social-preview", { w: ws.id, u: ctx.actor.userId, d: c.digest }, new Date(ctx.now().getTime() + PREVIEW_TTL_MS));
  return { ...previewView(c), previewToken };
}

// ------------------------------------------------------------------------------------ send

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Status transitions a post may take (Zernio's events can arrive late or twice). */
const FROM: Record<Exclude<PostStatus, "sending">, readonly PostStatus[]> = {
  scheduled: ["sending"],
  published: ["sending", "scheduled", "partial", "failed"],
  partial: ["sending", "scheduled", "failed"],
  failed: ["sending", "scheduled"],
};

function targetStatus(s: string | null, scheduled: boolean): Target["status"] {
  if (s === "published" || s === "posted" || s === "success") return "published";
  if (s === "failed" || s === "error") return "failed";
  if (s === "scheduled" || s === "pending" || s === "queued") return "scheduled";
  return scheduled ? "scheduled" : "sending";
}

/** The post's status from its accounts': all published, some, none, or still on its way. */
function overall(targets: Target[], zernioStatus: string | null): PostStatus {
  if (zernioStatus === "partial") return "partial";
  if (targets.length && targets.every((t) => t.status === "published")) return "published";
  if (targets.some((t) => t.status === "published")) return targets.some((t) => t.status === "failed") ? "partial" : "sending";
  if (targets.length && targets.every((t) => t.status === "failed")) return "failed";
  if (targets.length && targets.every((t) => t.status === "scheduled")) return "scheduled";
  return "sending";
}

function mergeTargets(current: Target[], post: ZernioPost | null, accounts: Account[], scheduled: boolean): Target[] {
  return current.map((t) => {
    const acc = accounts.find((a) => a.id === t.accountId);
    // By account when Zernio names it; else by platform, when this post has one account on that platform.
    const onPlatform = current.filter((x) => x.platform === t.platform).length === 1;
    const z = post?.platforms.find((p) => acc && p.accountId === acc.zernio_id) ?? (onPlatform ? post?.platforms.find((p) => p.accountId === null && p.platform === t.platform) : undefined);
    if (!z) return t;
    const status = targetStatus(z.status ?? post?.status ?? null, scheduled);
    return { ...t, status, url: z.url ?? t.url };
  });
}

const targetsOf = (p: Post) => (Array.isArray(p.targets) ? (p.targets as unknown as Target[]) : []);

export const postView = (p: Post) => ({
  id: p.id,
  subject: { type: p.subject_type as Subject["type"], id: p.subject_id },
  status: p.status as PostStatus,
  platforms: p.platforms as Platform[],
  accounts: targetsOf(p).map((t) => ({ accountId: t.accountId, platform: t.platform, label: PLATFORM_LABEL[t.platform] ?? t.platform, username: t.username, status: t.status, url: t.url })),
  scheduledFor: p.scheduled_at,
  timezone: p.timezone,
  sentAt: p.sent_at,
  createdAt: p.created_at,
  error: p.error,
  metrics: { impressions: (p.metrics as Record<string, number | null>).impressions ?? null, clicks: (p.metrics as Record<string, number | null>).clicks ?? null, engagements: (p.metrics as Record<string, number | null>).engagements ?? null, asOf: p.metrics_at },
});

/** Move a post to `to` (guard → write → ledger), or only refresh its accounts when it is already there. */
async function settle(ctx: ServiceContext, post: Post, to: PostStatus, patch: Partial<Post>, data: Record<string, unknown> = {}): Promise<Post> {
  let out = post;
  const write = async () => {
    out = (await ctx.repos.table("social_posts").update({ id: post.id }, { ...patch, status: to }))[0]!;
  };
  if (to === post.status || to === "sending") {
    if (Object.keys(patch).length) out = (await ctx.repos.table("social_posts").update({ id: post.id }, patch))[0]!;
    return out;
  }
  if (!FROM[to].includes(post.status as PostStatus)) return post;
  await changeStatus(ctx, { event: `social.post.${to}`, subjectType: "social_post", subjectId: post.id, current: post.status, from: FROM[to], to, data: { subjectType: post.subject_type, subjectId: post.subject_id, platforms: post.platforms, ...data }, write });
  return out;
}

/**
 * Post. Only a signed-in person's click: the body is built again from the input and must be the
 * one previewed (`previewToken`), and it goes to Zernio once per Idempotency-Key. Sending the same
 * key again returns the post already made; Zernio's 409 (same content, same account, within a
 * day) is treated as sent.
 */
export async function sendPost(ctx: ServiceContext, input: z.output<typeof sendInput>, idempotencyKey: string | undefined) {
  const ws = await postWorkspace(ctx, "Posting");
  if (!idempotencyKey || !UUID_RE.test(idempotencyKey)) throw new ApiError(400, "idempotency_key_required", "Send an Idempotency-Key header (a UUID) with each post");
  const key = idempotencyKey.toLowerCase();
  const port = zernio(ctx);
  const c = await compose(ctx, ws, input);
  if (c.problems.length) throw new ApiError(422, "post_not_ready", c.problems[0]!, c.problems.map((m) => ({ code: "invalid", message: m })));
  const tok = await openToken<{ w?: unknown; u?: unknown; d?: unknown }>(await tokenKey(ctx), "social-preview", input.previewToken, ctx.now());
  if (!tok || tok.w !== ws.id || tok.u !== ctx.actor.userId) throw new ApiError(409, "preview_required", "Look at the preview before posting");
  if (tok.d !== c.digest) throw new ApiError(409, "preview_changed", "The post changed after the preview. Look at the preview again, then post");

  let row = await ctx.repos.table("social_posts").one({ workspace_id: ws.id, idempotency_key: key });
  if (row && row.payload_sha256 !== c.digest) throw new ApiError(409, "idempotency_key_reused", "This post was already sent with other content. Start a new post");
  if (row && (row.status !== "sending" || row.zernio_post_id)) return postView(await refreshOne(ctx, port, row, c.accounts));
  if (!row) {
    const targets: Target[] = c.accounts.map((a) => ({ accountId: a.id, platform: a.platform as Platform, username: a.username, status: "sending", url: null }));
    try {
      row = await ctx.repos.table("social_posts").insert({
        workspace_id: ws.id,
        subject_type: input.subject.type,
        subject_id: input.subject.id,
        idempotency_key: key,
        payload_sha256: c.digest,
        platforms: [...new Set(c.accounts.map((a) => a.platform))],
        targets: targets as unknown as Post["targets"],
        status: "sending",
        scheduled_at: c.scheduledAt?.toISOString() ?? null,
        timezone: input.schedule?.timezone ?? null,
        created_by: ctx.actor.userId!,
      });
    } catch (e) {
      // The same click twice at once: the other request owns the post.
      if (e instanceof RepoError && e.kind === "conflict") {
        const other = await ctx.repos.table("social_posts").one({ workspace_id: ws.id, idempotency_key: key });
        if (other && other.payload_sha256 === c.digest) return postView(other);
        throw new ApiError(409, "idempotency_key_reused", "This post was already sent with other content. Start a new post");
      }
      throw e;
    }
  }

  const scheduled = !!input.schedule;
  let result;
  try {
    result = await port.createPost(c.body, key);
  } catch (e) {
    if (e instanceof ZernioError && (e.kind === "unavailable" || e.kind === "rate_limited")) {
      // Unknown outcome: the row stays `sending` and the same key may be sent again safely.
      const unconfirmed = "Zernio did not confirm this post. Post again: it will not go out twice";
      await ctx.repos.table("social_posts").update({ id: row.id }, { error: unconfirmed });
      throw new ApiError(503, e.kind === "rate_limited" ? "zernio_busy" : "zernio_unavailable", unconfirmed);
    }
    const message = e instanceof ZernioError && e.kind === "auth" ? "Zernio refused this server's key. Nothing was posted" : "Zernio did not accept the post. Nothing was posted";
    await settle(ctx, row, "failed", { error: message, targets: targetsOf(row).map((t) => ({ ...t, status: "failed" })) as unknown as Post["targets"] }, { reason: e instanceof ZernioError ? e.kind : "error" });
    zernioFailure(e, "Nothing was posted");
  }
  let post = result.post;
  if (result.outcome === "duplicate" && post) {
    // Zernio already has this post (the same text to the same account within a day). When it is
    // one this workspace sent, this click is that post: nothing new went out.
    const earlier = await ctx.repos.table("social_posts").one({ zernio_post_id: post.id });
    if (earlier && earlier.workspace_id === ws.id && earlier.id !== row.id) {
      await ctx.repos.table("social_posts").remove({ id: row.id });
      await audit(ctx, "social.post.duplicate", "social_post", earlier.id, { subjectType: input.subject.type, subjectId: input.subject.id, platforms: earlier.platforms });
      return postView(earlier);
    }
    if (earlier) post = { ...post, id: "" };
  }
  let targets = mergeTargets(targetsOf(row), post, c.accounts, scheduled);
  if (!post) targets = targets.map((t) => ({ ...t, status: scheduled ? "scheduled" : "published" }));
  const to = post ? overall(targets, post.status) : scheduled ? "scheduled" : "published";
  const patch = { zernio_post_id: post?.id || null, targets: targets as unknown as Post["targets"], sent_at: ctx.now().toISOString(), error: null };
  row = to === "sending" ? (await ctx.repos.table("social_posts").update({ id: row.id }, patch))[0]! : await settle(ctx, row, to, patch, { zernioPostId: post?.id || null, duplicate: result.outcome === "duplicate", scheduledFor: row.scheduled_at });
  if (to === "sending") await audit(ctx, "social.post.sent", "social_post", row.id, { subjectType: row.subject_type, subjectId: row.subject_id, platforms: row.platforms, zernioPostId: post?.id || null });
  return postView(row);
}

// ------------------------------------------------------------------------------------ reach

/** Read a post's status (while it is on its way) and counts (once it is out) from Zernio, within budget. */
async function refreshOne(ctx: ServiceContext, port: SocialPort, row: Post, accounts?: Account[]): Promise<Post> {
  if (!row.zernio_post_id) return row;
  let out = row;
  const pending = row.status === "sending" || (row.status === "scheduled" && !!row.scheduled_at && Date.parse(row.scheduled_at) <= ctx.now().getTime());
  if (pending) {
    const post = await port.getPost(row.zernio_post_id).catch(() => null);
    if (post) {
      const accs = accounts ?? (await ctx.repos.table("social_accounts").find({ workspace_id: row.workspace_id }));
      const targets = mergeTargets(targetsOf(row), post, accs, !!row.scheduled_at);
      out = await settle(ctx, row, overall(targets, post.status), { targets: targets as unknown as Post["targets"] });
    }
  }
  const out2 = out;
  const live = out2.status === "published" || out2.status === "partial";
  const stale = !out2.metrics_at || ctx.now().getTime() - Date.parse(out2.metrics_at) > METRICS_TTL_MS;
  if (live && stale) {
    const m = await port.postMetrics(out2.zernio_post_id!).catch(() => undefined);
    // Zernio unreachable: keep the counts we had. No counts yet: say when we asked.
    if (m !== undefined) out = (await ctx.repos.table("social_posts").update({ id: out2.id }, { metrics: (m ?? {}) as unknown as Post["metrics"], metrics_at: ctx.now().toISOString() }))[0]!;
  }
  return out;
}

export const reachQuery = z.object({ subjectType: z.enum(SUBJECT_TYPES).optional(), subjectId: z.uuid().optional() }).strict();

/**
 * The reach report: this workspace's posts (about one subject, or all), each with its links,
 * statuses and counts; the totals; and, for an opportunity, the applications started from a link
 * shared with `utm_source=social`.
 */
export async function reachReport(ctx: ServiceContext, q: z.output<typeof reachQuery>) {
  const ws = await readWorkspace(ctx);
  if ((q.subjectType === undefined) !== (q.subjectId === undefined)) throw new ApiError(400, "bad_request", "Give both subjectType and subjectId, or neither");
  if (q.subjectType && q.subjectId) await draftFor(ctx, ws, { type: q.subjectType, id: q.subjectId });
  const port = zernio(ctx);
  const rows = await ctx.repos.table("social_posts").find({ workspace_id: ws.id, ...(q.subjectType ? { subject_type: q.subjectType, subject_id: q.subjectId } : {}) }, { orderBy: "created_at", ascending: false, limit: 50 });
  let budget = REFRESH_PER_REQUEST;
  const posts: Post[] = [];
  for (const r of rows) {
    const needs = !!r.zernio_post_id && (r.status === "sending" || r.status === "scheduled" || ((r.status === "published" || r.status === "partial") && (!r.metrics_at || ctx.now().getTime() - Date.parse(r.metrics_at) > METRICS_TTL_MS)));
    if (needs && budget > 0) {
      budget--;
      posts.push(await refreshOne(ctx, port, r));
    } else posts.push(r);
  }
  const views = posts.map(postView);
  const sum = (k: "impressions" | "clicks" | "engagements") => {
    const xs = views.map((v) => v.metrics[k]).filter((n): n is number => typeof n === "number");
    return xs.length ? xs.reduce((a, b) => a + b, 0) : null;
  };
  let applicationsFromSocial: number | null = null;
  if (q.subjectType === "opportunity" && q.subjectId) {
    const apps = await ctx.repos.table("applications").find({ workspace_id: ws.id, opportunity_id: q.subjectId }, { limit: 5000 });
    const started = apps.length ? await ctx.repos.table("application_events").find({ application_id: apps.map((a) => a.id), type: "started" }, { limit: 5000 }) : [];
    applicationsFromSocial = started.filter((e) => (e.payload as { utmSource?: unknown } | null)?.utmSource === UTM_SOURCE).length;
  }
  return { posts: views, totals: { posts: views.length, impressions: sum("impressions"), clicks: sum("clicks"), engagements: sum("engagements") }, applicationsFromSocial };
}

// ------------------------------------------------------------------------------------ webhook

export type ZernioReceived = { status: 200; outcome: "processed" | "duplicate" | "ignored" } | { status: 400 | 401 | 404 | 413; outcome: string };

/** Our sentence for a post Zernio cancelled (never Zernio's own words). */
export const CANCELLED_TEXT = "Zernio cancelled this scheduled post because an account it was going to was disconnected. Connect the account again and post it anew.";

/** The largest webhook body read. */
export const MAX_WEBHOOK_BYTES = 256 * 1024;

/**
 * `POST /webhooks/zernio`. The signature is checked on the raw body before anything is read; a
 * delivery is applied once (deduplicated on its event id in inbound_events) and only to the
 * workspace whose profile it names (externalId), and to that workspace's own accounts and posts.
 */
export async function receiveZernioEvent(base: BaseContext, headers: { get(name: string): string | null }, rawBody: string): Promise<ZernioReceived> {
  const zc = base.config.zernio;
  if (!zc) return { status: 404, outcome: "not_found" };
  if (rawBody.length > MAX_WEBHOOK_BYTES) return { status: 413, outcome: "too_large" };
  if (!(await verifyZernioSignature(zc.webhookSecret, rawBody, headers.get(SIGNATURE_HEADER)))) return { status: 401, outcome: "bad_signature" };
  const e = await parseZernioEvent(rawBody);
  if (!e) return { status: 400, outcome: "unreadable" };
  if (e.occurredAt && base.now().getTime() - Date.parse(e.occurredAt) > REPLAY_WINDOW_MS) return { status: 400, outcome: "stale" };
  if (!isHandledEvent(e.type)) return { status: 200, outcome: "ignored" };
  // Only what the GMS acts on is stored: ids and the event type, never the body.
  const facts = { type: e.type, profileExternalId: e.profileExternalId, profileId: e.profileId, accountId: e.accountId, postId: e.post?.id ?? null };
  let inbound: Row<"inbound_events">;
  try {
    inbound = await base.repos.table("inbound_events").insert({ provider: "zernio", external_id: e.id.slice(0, 200), type: e.type, payload: facts as unknown as Row<"inbound_events">["payload"], received_at: base.now().toISOString() });
  } catch (err) {
    if (err instanceof RepoError && err.kind === "conflict") return { status: 200, outcome: "duplicate" };
    throw err;
  }
  const done = (error: string | null = null) => base.repos.table("inbound_events").update({ id: inbound.id }, { processed_at: base.now().toISOString(), error });

  // Routed by profiles[].externalId (the workspace id), and only to a workspace whose own Zernio
  // profile it is: a listed profile whose Zernio id is another's is not this workspace's. An event
  // that names more than one of our workspaces is not applied to any.
  const matches: Row<"social_profiles">[] = [];
  for (const p of e.profiles.length ? e.profiles : [{ id: e.profileId, externalId: e.profileExternalId }]) {
    const wsId = p.externalId && UUID_RE.test(p.externalId) ? p.externalId.toLowerCase() : null;
    const row = wsId ? await base.repos.table("social_profiles").one({ workspace_id: wsId }) : null;
    if (row && (!p.id || p.id === row.zernio_profile_id) && !matches.some((m) => m.id === row.id)) matches.push(row);
  }
  const profile = matches.length === 1 ? matches[0]! : null;
  if (!profile) {
    await done(matches.length > 1 ? "several_profiles" : "unknown_profile");
    return { status: 200, outcome: "ignored" };
  }
  const home = await base.repos.table("workspaces").one({ id: profile.workspace_id });
  if (!home) {
    await done("unknown_profile");
    return { status: 200, outcome: "ignored" };
  }
  const ctx = systemContext(base, { job: "zernio-webhook" }, { id: home.id, kind: home.kind as WorkspaceKind });

  if (e.type === "account.connected" || e.type === "account.disconnected") {
    const accountId = e.accountId;
    if (!accountId) {
      await done("no_account");
      return { status: 200, outcome: "ignored" };
    }
    const row = await base.repos.table("social_accounts").one({ zernio_id: accountId });
    if (row && row.workspace_id !== home.id) {
      await done("account_elsewhere");
      return { status: 200, outcome: "ignored" };
    }
    if (e.type === "account.disconnected") {
      if (row && row.status === "active") await markDisconnected(ctx, row, "webhook");
    } else if (e.account) {
      await recordAccount(ctx, home.id, { id: e.account.id, platform: e.account.platform, username: e.account.username }, "webhook").catch(async (err: unknown) => {
        if (!(err instanceof ApiError)) throw err;
      });
    }
    await done();
    return { status: 200, outcome: "processed" };
  }

  // A post event: only a post this workspace made.
  const post = e.post;
  const row = post ? await base.repos.table("social_posts").one({ zernio_post_id: post.id }) : null;
  if (!post || !row || row.workspace_id !== home.id) {
    await done("unknown_post");
    return { status: 200, outcome: "ignored" };
  }
  const accounts = await base.repos.table("social_accounts").find({ workspace_id: home.id });
  const targets = mergeTargets(targetsOf(row), post, accounts, !!row.scheduled_at);
  if (e.type === "post.cancelled") {
    // Zernio cancels a scheduled post when its account is disconnected: it will not go out.
    await settle(ctx, row, "failed", { targets: targets.map((t) => (t.status === "published" ? t : { ...t, status: "failed" })) as unknown as Post["targets"], error: CANCELLED_TEXT }, { via: "webhook" });
    await done();
    return { status: 200, outcome: "processed" };
  }
  const named = e.type.slice("post.".length) as PostStatus;
  await settle(ctx, row, named === "scheduled" || named === "published" || named === "partial" || named === "failed" ? named : overall(targets, post.status), { targets: targets as unknown as Post["targets"] }, { via: "webhook" });
  await done();
  return { status: 200, outcome: "processed" };
}

// ------------------------------------------------------------------------------------ "Two weeks left"

/** Days before a call's deadline that its funder is asked "Post a reminder?". */
export const REMINDER_LEAD_DAYS = 14;
/**
 * The prompt is made while the deadline is at most `REMINDER_LEAD_DAYS` and more than
 * `REMINDER_LEAD_DAYS - REMINDER_WINDOW_DAYS` days away, so a daily run that was missed is caught
 * the next day, and a call published with less time left is not asked about "two weeks".
 */
export const REMINDER_WINDOW_DAYS = 2;
/** Who sees the prompt and may dismiss it: the funder's admins. */
export const REMINDER_ROLES: readonly string[] = ["admin"];

type Prompt = Row<"social_reminder_prompts">;
const DAY_MS = 86_400_000;
const dayOf = (iso: string | undefined | null) => (typeof iso === "string" && /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10) : null);
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
const closeDayOf = (o: Pick<Row<"opportunities">, "key_dates">) => dayOf(((o.key_dates ?? {}) as { closeDate?: { date?: string } }).closeDate?.date);

/** A call's prompt while it waits: made, not dismissed, its deadline not passed. */
async function waitingPrompt(ctx: Pick<ServiceContext, "repos" | "now">, opportunityId: string): Promise<Prompt | null> {
  const p = await ctx.repos.table("social_reminder_prompts").one({ opportunity_id: opportunityId });
  const today = ctx.now().toISOString().slice(0, 10);
  return p && !p.dismissed_at && p.deadline >= today ? p : null;
}

/**
 * The jobs Worker's daily run (14:40 UTC, before the daily digest): one prompt per open, published
 * call whose deadline is fourteen days away, in a workspace with a connected social account. It
 * writes a record and a ledger line, and nothing else: it never calls Zernio and never posts.
 */
export async function promptSocialReminders(base: BaseContext): Promise<{ checked: number; prompted: number; failed: number }> {
  const out = { checked: 0, prompted: 0, failed: 0 };
  const today = base.now().toISOString().slice(0, 10);
  const calls = await base.repos.table("opportunities").find({ status: "open" }, { notNull: ["published_at"], limit: 5000 });
  for (const o of calls) {
    const close = closeDayOf(o);
    if (!close || (o.publish as { publicPage?: boolean } | null)?.publicPage === false) continue;
    const left = daysBetween(today, close);
    if (left > REMINDER_LEAD_DAYS || left <= REMINDER_LEAD_DAYS - REMINDER_WINDOW_DAYS) continue;
    out.checked++;
    try {
      // Once per call, ever: a deadline that moves later does not ask again.
      if (await base.repos.table("social_reminder_prompts").one({ opportunity_id: o.id })) continue;
      const accounts = await base.repos.table("social_accounts").find({ workspace_id: o.workspace_id, status: "active" }, { limit: 1 });
      if (!accounts.length) continue;
      const row = await base.repos.table("social_reminder_prompts").insert({ workspace_id: o.workspace_id, opportunity_id: o.id, deadline: close, prompted_at: base.now().toISOString() });
      const ctx = systemContext(base, { job: "social-reminders" }, { id: o.workspace_id, kind: "funder" });
      await audit(ctx, "social.reminder_prompted", "opportunity", o.id, { promptId: row.id, deadline: close });
      out.prompted++;
    } catch (e) {
      // Two runs at once: the other one made it.
      if (!(e instanceof RepoError && e.kind === "conflict")) out.failed++;
    }
  }
  return out;
}

export interface ReminderNotice {
  id: string;
  opportunityId: string;
  title: string;
  promptedAt: string;
}

/**
 * The prompts a member sees in their notifications (and digest): a funder admin's, while each waits
 * and its call is still open. Hidden on a server where social posting is switched off (the API's
 * config says so; the jobs Worker, which does not hold the Zernio keys, relies on the prompt having
 * been made only for a workspace with a connected account).
 */
export async function reminderNotices(ctx: Pick<ServiceContext, "repos" | "now" | "config">, ws: Pick<ServiceWorkspace, "id" | "kind" | "role">): Promise<ReminderNotice[]> {
  if (ws.kind !== "funder" || !ws.role || !REMINDER_ROLES.includes(ws.role) || ctx.config.zernio === null) return [];
  const today = ctx.now().toISOString().slice(0, 10);
  const prompts = (await ctx.repos.table("social_reminder_prompts").find({ workspace_id: ws.id }, { orderBy: "prompted_at", ascending: false, limit: 50 })).filter((p) => !p.dismissed_at && p.deadline >= today);
  if (!prompts.length) return [];
  const calls = await ctx.repos.table("opportunities").find({ id: prompts.map((p) => p.opportunity_id), workspace_id: ws.id });
  return prompts.flatMap((p) => {
    const o = calls.find((c) => c.id === p.opportunity_id);
    return o && o.status === "open" ? [{ id: p.id, opportunityId: o.id, title: o.title, promptedAt: p.prompted_at }] : [];
  });
}

/** A funder admin dismisses a call's prompt, in person. It is gone for the workspace; it never comes back for that call. */
export async function dismissReminder(ctx: ServiceContext, promptId: string) {
  if (!socialConfigured(ctx)) throw hidden();
  const ws = await authorize(ctx, { scope: POST_SCOPE.funder, kind: "funder", roles: REMINDER_ROLES, person: true });
  personOnly(ctx, "Dismissing a reminder");
  const p = await ctx.repos.table("social_reminder_prompts").one({ id: promptId, workspace_id: ws.id });
  if (!p) throw notFound("Reminder");
  if (!p.dismissed_at) {
    await ctx.repos.table("social_reminder_prompts").update({ id: p.id }, { dismissed_at: ctx.now().toISOString(), dismissed_by: ctx.actor.userId });
    await audit(ctx, "social.reminder_dismissed", "opportunity", p.opportunity_id, { promptId: p.id });
  }
  return { id: p.id, opportunityId: p.opportunity_id, dismissed: true };
}
