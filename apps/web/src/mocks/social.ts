// SPDX-License-Identifier: AGPL-3.0-only
// Social posting in the browser (VITE_USE_MOCKS=true), against the fake Zernio from @gms/social
// through the real Zernio client: a profile per workspace (externalId = workspace id), a connect
// state sealed with an expiry and checked on the way back, the exact body built once for the
// preview and the post, one post per Idempotency-Key, and Zernio's counts in the reach report.
// The person "signs in" at the platform at once: the connect link is a path back into this app.
// Awards are not offered, as on a server where award sharing is not wired yet.
import { buildPostBody, checkCompose, FakeZernio, openToken, PLATFORM_LABEL, PLATFORM_LIMIT, NEEDS_IMAGE, PLATFORMS, postDigest, sealToken, ZernioClient, type Platform, type PostBody, type ZernioPost } from "@gms/social";
import type { Session } from "../auth/types.ts";
import { ApiError } from "../api/client.ts";
import type { Opportunity } from "../api/types.ts";
import type { SocialAccount, SocialApi, SocialComposeInput, SocialDraft, SocialPost, SocialPostStatus, SocialPreview, SocialReach, SocialSettings, SocialSubject } from "../api/social.ts";

const KEY = "zk_mock_browser_key_not_real";
/** Seals connect states and preview tokens in page memory only. */
const TOKEN_KEY = "mock-social-token-key";
const CONNECT_TTL_MS = 10 * 60 * 1000;
const PREVIEW_TTL_MS = 60 * 60 * 1000;
const POST_ROLES = ["admin", "program_officer", "editor"];

interface MockAccount {
  id: string;
  workspaceId: string;
  zernioAccountId: string;
  platform: Platform;
  username: string | null;
  status: "active" | "disconnected";
  connectedAt: string;
  disconnectedAt: string | null;
}
interface MockPost {
  workspaceId: string;
  key: string;
  digest: string;
  post: SocialPost;
  zernioPostId: string | null;
  zernioAccounts: string[];
}

export interface SocialStore {
  fake: FakeZernio;
  client: ZernioClient;
  profiles: Map<string, string>;
  accounts: MockAccount[];
  posts: MockPost[];
}

export function seedSocialStore(): SocialStore {
  const fake = new FakeZernio({ apiKey: KEY });
  return { fake, client: new ZernioClient({ apiKey: KEY, fetch: fake.fetch }), profiles: new Map(), accounts: [], posts: [] };
}

type Current = { id: string; kind: "funder" | "applicant"; handle: string; name: string; role: string } | null;

export interface MockSocialOptions {
  session: () => Promise<Session | null>;
  store: SocialStore;
  workspace: () => Current;
  getOpportunity: (id: string) => Promise<Opportunity>;
}

const accountView = (a: MockAccount): SocialAccount => ({ id: a.id, platform: a.platform, label: PLATFORM_LABEL[a.platform], username: a.username, status: a.status, connectedAt: a.connectedAt, disconnectedAt: a.disconnectedAt });
const usernameFor = (platform: Platform, handle: string) => (platform === "bluesky" ? `${handle}.bsky.social` : platform === "linkedin" || platform === "facebook" ? `${handle}-foundation` : handle.replace(/-/g, ""));
const dateText = (iso: string | undefined) => (iso && !Number.isNaN(Date.parse(iso)) ? new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }) : null);

export function createMockSocialApi(opts: MockSocialOptions): SocialApi {
  const { store } = opts;
  const ws = () => {
    const w = opts.workspace();
    if (!w) throw new ApiError(403, "Name a workspace for this action");
    return w;
  };
  const userId = async () => {
    const s = await opts.session();
    if (!s) throw new ApiError(401, "Sign in to continue");
    return s.userId;
  };
  const canPost = (w: NonNullable<Current>) => POST_ROLES.includes(w.role);

  async function draftFor(subject: SocialSubject): Promise<SocialDraft> {
    const w = ws();
    if (subject.type === "award") return { subject: { ...subject, title: "Award" }, shareable: false, reason: "This award is not listed publicly, so it is not offered for posting", suggestions: [], link: null, imageUrl: null };
    const o = await opts.getOpportunity(subject.id);
    const base: SocialDraft = { subject: { type: "opportunity", id: o.id, title: o.title }, shareable: false, reason: null, suggestions: [], link: null, imageUrl: null };
    if (!o.published || o.publish.publicPage === false) return { ...base, reason: "Publish this call with Public page on before you share it" };
    if (o.status !== "open" && o.status !== "forecasted") return { ...base, reason: "This call is closed, so it is not offered for posting" };
    const origin = window.location.origin;
    const link = `${origin}/f/${w.handle}/o/${o.slug}?utm_source=social`;
    const close = dateText(o.keyDates.closeDate?.date);
    const opens = dateText(o.keyDates.postDate?.date);
    const long = o.status === "open" ? `Applications are open: ${o.title}, from ${w.name}.${close ? ` Apply by ${close}.` : ""}\n\n${link}` : `Coming soon: ${o.title}, from ${w.name}.${opens ? ` Applications open ${opens}.` : ""}\n\n${link}`;
    const short = o.status === "open" ? `Now open: ${o.title}${close ? ` (apply by ${close})` : ""} ${link}` : `Coming soon: ${o.title} ${link}`;
    return { ...base, shareable: true, suggestions: [{ label: "Announcement", text: long }, { label: "Short", text: short }], link, imageUrl: `${origin}/og/f/${w.handle}/o/${o.slug}.png` };
  }

  async function compose(input: SocialComposeInput) {
    const w = ws();
    const draft = await draftFor(input.subject);
    if (!draft.shareable) throw new ApiError(409, draft.reason ?? "This cannot be posted about");
    const ids = [...new Set(input.accountIds)];
    const accounts = ids.map((id) => store.accounts.find((a) => a.id === id && a.workspaceId === w.id && a.status === "active"));
    if (accounts.some((a) => !a)) throw new ApiError(422, "One of the accounts is not connected to this workspace any more. Choose the accounts again");
    const list = accounts as MockAccount[];
    const ci = { content: input.content.replace(/\r\n/g, "\n"), imageUrl: input.includeImage === false ? null : draft.imageUrl, targets: list.map((a) => ({ platform: a.platform, accountId: a.zernioAccountId })), schedule: input.schedule ?? null };
    const check = checkCompose(ci, new Date());
    const body = buildPostBody(ci);
    return { w, draft, accounts: list, body, digest: await postDigest(body), check };
  }

  const statusOf = (p: ZernioPost | null, scheduled: boolean): SocialPostStatus => (!p ? (scheduled ? "scheduled" : "published") : p.status === "scheduled" ? "scheduled" : p.status === "failed" ? "failed" : p.status === "partial" ? "partial" : "published");

  return {
    settings: async (): Promise<SocialSettings> => {
      const w = ws();
      return {
        profileCreated: store.profiles.has(w.id),
        platforms: PLATFORMS.map((p) => ({ platform: p, label: PLATFORM_LABEL[p], limit: PLATFORM_LIMIT[p], needsImage: NEEDS_IMAGE[p] })),
        accounts: store.accounts.filter((a) => a.workspaceId === w.id && a.status === "active").map(accountView),
        canConnect: w.role === "admin",
        canPost: canPost(w),
      };
    },

    connect: async (platform) => {
      const w = ws();
      const u = await userId();
      if (w.role !== "admin") throw new ApiError(403, "This needs one of these roles: admin");
      let profileId = store.profiles.get(w.id);
      if (!profileId) {
        profileId = (await store.client.ensureProfile({ name: w.name, externalId: w.id })).id;
        store.profiles.set(w.id, profileId);
      }
      const state = await sealToken(TOKEN_KEY, "social-connect", { w: w.id, u, p: platform }, new Date(Date.now() + CONNECT_TTL_MS));
      const { authUrl } = await store.client.connectLink(platform, profileId, `/w/${w.handle}/settings/social?gs=${encodeURIComponent(state)}`);
      // The person approves at the platform at once, and is sent back here.
      return { authUrl: store.fake.approve(authUrl, usernameFor(platform, w.handle)) };
    },

    finishConnect: async (params) => {
      const w = ws();
      const u = await userId();
      const s = await openToken<{ w?: string; u?: string; p?: string }>(TOKEN_KEY, "social-connect", params.state, new Date());
      const profileId = store.profiles.get(w.id);
      if (!s || s.w !== w.id || s.u !== u || !profileId || profileId !== params.profileId) throw new ApiError(403, "This connection link is not valid for you here, or it has expired. Start again from Social accounts");
      const listed = (await store.client.listAccounts(profileId)).find((a) => a.id === params.accountId && a.platform === s.p);
      if (!listed) throw new ApiError(409, "Zernio does not list that account for this workspace. Try connecting again");
      const at = new Date().toISOString();
      const existing = store.accounts.find((a) => a.zernioAccountId === listed.id);
      if (existing) {
        Object.assign(existing, { status: "active", username: listed.username, connectedAt: existing.status === "active" ? existing.connectedAt : at, disconnectedAt: null });
        return accountView(existing);
      }
      const row: MockAccount = { id: crypto.randomUUID(), workspaceId: w.id, zernioAccountId: listed.id, platform: listed.platform, username: listed.username, status: "active", connectedAt: at, disconnectedAt: null };
      store.accounts.push(row);
      return accountView(row);
    },

    disconnect: async (accountId) => {
      const w = ws();
      const row = store.accounts.find((a) => a.id === accountId && a.workspaceId === w.id);
      if (!row) throw new ApiError(404, "Social account not found");
      if (row.status === "active") {
        await store.client.disconnectAccount(row.zernioAccountId);
        Object.assign(row, { status: "disconnected", disconnectedAt: new Date().toISOString() });
      }
      return accountView(row);
    },

    draft: (subject) => draftFor(subject),

    preview: async (input): Promise<SocialPreview> => {
      const u = await userId();
      const c = await compose(input);
      if (!canPost(c.w)) throw new ApiError(403, "This needs one of these roles: admin, editor");
      const previewToken = c.check.problems.length ? null : await sealToken(TOKEN_KEY, "social-preview", { w: c.w.id, u, d: c.digest }, new Date(Date.now() + PREVIEW_TTL_MS));
      return {
        subject: c.draft.subject,
        content: c.body.content,
        imageUrl: c.body.mediaItems?.[0]?.url ?? null,
        accounts: c.accounts.map(accountView),
        publishNow: c.body.publishNow === true,
        schedule: c.body.scheduledFor ? { scheduledFor: c.body.scheduledFor, timezone: c.body.timezone!, at: c.check.scheduledAt?.toISOString() ?? null } : null,
        lengths: c.check.lengths,
        problems: c.check.problems,
        body: c.body as SocialPreview["body"],
        previewToken,
      };
    },

    post: async (input, idempotencyKey) => {
      const u = await userId();
      const c = await compose(input);
      if (c.check.problems.length) throw new ApiError(422, c.check.problems[0]!);
      const tok = await openToken<{ w?: string; u?: string; d?: string }>(TOKEN_KEY, "social-preview", input.previewToken, new Date());
      if (!tok || tok.w !== c.w.id || tok.u !== u) throw new ApiError(409, "Look at the preview before posting");
      if (tok.d !== c.digest) throw new ApiError(409, "The post changed after the preview. Look at the preview again, then post");
      const earlier = store.posts.find((p) => p.workspaceId === c.w.id && p.key === idempotencyKey);
      if (earlier) {
        if (earlier.digest !== c.digest) throw new ApiError(409, "This post was already sent with other content. Start a new post");
        return earlier.post;
      }
      const result = await store.client.createPost(c.body as PostBody, idempotencyKey);
      const zp = result.post;
      const dup = zp ? store.posts.find((p) => p.zernioPostId === zp.id && p.workspaceId === c.w.id) : undefined;
      if (dup) return dup.post;
      const scheduled = !!input.schedule;
      const status = statusOf(zp, scheduled);
      const now = new Date().toISOString();
      const post: SocialPost = {
        id: crypto.randomUUID(),
        subject: input.subject,
        status,
        platforms: [...new Set(c.accounts.map((a) => a.platform))],
        accounts: c.accounts.map((a) => {
          const t = zp?.platforms.find((p) => p.accountId === a.zernioAccountId) ?? zp?.platforms.find((p) => p.accountId === null && p.platform === a.platform);
          return { accountId: a.id, platform: a.platform, label: PLATFORM_LABEL[a.platform], username: a.username, status: status === "scheduled" ? "scheduled" : t?.status === "failed" ? "failed" : "published", url: t?.url ?? null };
        }),
        scheduledFor: c.check.scheduledAt?.toISOString() ?? null,
        timezone: input.schedule?.timezone ?? null,
        sentAt: now,
        createdAt: now,
        error: null,
        metrics: { impressions: null, clicks: null, engagements: null, asOf: null },
      };
      store.posts.unshift({ workspaceId: c.w.id, key: idempotencyKey, digest: c.digest, post, zernioPostId: zp?.id ?? null, zernioAccounts: c.accounts.map((a) => a.zernioAccountId) });
      // Stand-in counts, so the reach report has something to show in the demo.
      if (zp && status === "published") store.fake.metrics.set(zp.id, { impressions: 0, clicks: 0, likes: 0 });
      return post;
    },

    reach: async (subject): Promise<SocialReach> => {
      const w = ws();
      if (subject?.type === "opportunity") await draftFor(subject);
      const mine = store.posts.filter((p) => p.workspaceId === w.id && (!subject || (p.post.subject.type === subject.type && p.post.subject.id === subject.id)));
      for (const p of mine) {
        if (!p.zernioPostId || (p.post.status !== "published" && p.post.status !== "partial")) continue;
        const m = await store.client.postMetrics(p.zernioPostId).catch(() => null);
        if (m) p.post = { ...p.post, metrics: { ...m, asOf: new Date().toISOString() } };
      }
      const posts = mine.map((p) => p.post);
      const sum = (k: "impressions" | "clicks" | "engagements") => {
        const xs = posts.map((p) => p.metrics[k]).filter((n): n is number => typeof n === "number");
        return xs.length ? xs.reduce((a, b) => a + b, 0) : null;
      };
      return { posts, totals: { posts: posts.length, impressions: sum("impressions"), clicks: sum("clicks"), engagements: sum("engagements") }, applicationsFromSocial: subject?.type === "opportunity" ? 0 : null };
    },
  };
}
