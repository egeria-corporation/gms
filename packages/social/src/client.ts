// SPDX-License-Identifier: AGPL-3.0-only
// The Zernio port and its HTTP client (https://zernio.com/api/v1, Bearer API key).
//
// One Zernio profile per GMS workspace (`externalId` = the workspace id), so one workspace's posts
// can only name that workspace's accounts. The client reads only what the GMS keeps: ids, platform
// names, usernames, post statuses and URLs, and counts. It never reads tokens, inbox messages or
// follower lists, and it never puts the API key in an error or a log line.
import { isPlatform, type Platform } from "./platforms.ts";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface ZernioAccount {
  id: string;
  platform: Platform;
  username: string | null;
  profileId: string | null;
}

export interface ZernioPostTarget {
  platform: Platform;
  /** Null when Zernio names only the platform (its webhook body does: `{ platform, status, platformPostUrl }`). */
  accountId: string | null;
  status: string | null;
  url: string | null;
}

export interface ZernioPost {
  id: string;
  status: string | null;
  platforms: ZernioPostTarget[];
  scheduledFor: string | null;
}

/** Counts Zernio reports for a post, summed over its platforms; null where it gives none. */
export interface PostMetrics {
  impressions: number | null;
  clicks: number | null;
  engagements: number | null;
}

/** The body of `POST /v1/posts`, exactly as sent. */
export interface PostBody {
  content: string;
  mediaItems?: { type: "image"; url: string }[];
  platforms: { platform: Platform; accountId: string }[];
  publishNow?: true;
  scheduledFor?: string;
  timezone?: string;
}

/**
 * `accepted`: Zernio took the post, or (same Idempotency-Key within a day) returned the original.
 * `duplicate`: Zernio answered 409, the same content already went to the same account within a
 * day; the GMS treats it as sent.
 */
export type CreatePostResult = { outcome: "accepted"; post: ZernioPost } | { outcome: "duplicate"; post: ZernioPost | null };

export interface SocialPort {
  findProfile(externalId: string): Promise<{ id: string } | null>;
  /** Creates the profile, or returns the one that already has this externalId. */
  ensureProfile(input: { name: string; externalId: string }): Promise<{ id: string }>;
  connectLink(platform: Platform, profileId: string, redirectUrl: string): Promise<{ authUrl: string }>;
  listAccounts(profileId: string): Promise<ZernioAccount[]>;
  disconnectAccount(accountId: string): Promise<void>;
  createPost(body: PostBody, idempotencyKey: string): Promise<CreatePostResult>;
  getPost(postId: string): Promise<ZernioPost | null>;
  postMetrics(postId: string): Promise<PostMetrics | null>;
}

export type ZernioErrorKind = "auth" | "invalid" | "not_found" | "conflict" | "rate_limited" | "unavailable";

/** A refused or failed Zernio call. The message is ours; Zernio's own text is not repeated. */
export class ZernioError extends Error {
  constructor(
    readonly kind: ZernioErrorKind,
    readonly status: number | null,
  ) {
    super(`Zernio ${kind}${status ? ` (${status})` : ""}`);
    this.name = "ZernioError";
  }
}

export const ZERNIO_BASE_URL = "https://zernio.com/api";
/** How long one Zernio call may take before the GMS gives up on it. */
export const ZERNIO_TIMEOUT_MS = 10_000;

type Json = Record<string, unknown>;
const obj = (v: unknown): Json | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const idOf = (v: unknown): string | null => {
  const o = obj(v);
  return o ? (str(o._id) ?? str(o.id)) : null;
};
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null);

export function accountOf(v: unknown): ZernioAccount | null {
  const o = obj(v);
  const id = idOf(o);
  if (!o || !id || !isPlatform(o.platform)) return null;
  const profile = o.profileId;
  return { id, platform: o.platform, username: str(o.username) ?? str(o.displayName), profileId: str(profile) ?? idOf(profile) };
}

export function postOf(v: unknown): ZernioPost | null {
  const o = obj(v);
  const id = idOf(o);
  if (!o || !id) return null;
  const platforms: ZernioPostTarget[] = [];
  for (const p of Array.isArray(o.platforms) ? o.platforms : []) {
    const t = obj(p);
    if (!t || !isPlatform(t.platform)) continue;
    const accountId = str(t.accountId) ?? idOf(t.accountId) ?? idOf(t.account);
    const url = str(t.platformPostUrl) ?? str(t.url);
    platforms.push({ platform: t.platform, accountId, status: str(t.status), url: url && /^https:\/\//.test(url) ? url : null });
  }
  return { id, status: str(o.status), platforms, scheduledFor: str(o.scheduledFor) };
}

/** Counts from an analytics answer, wherever Zernio puts them (whole post, or per platform). */
export function metricsOf(v: unknown): PostMetrics | null {
  const root = obj(v);
  if (!root) return null;
  const blocks: Json[] = [];
  const a = obj(root.analytics);
  if (a) blocks.push(a);
  for (const p of Array.isArray(root.platformAnalytics) ? root.platformAnalytics : Array.isArray(root.platforms) ? root.platforms : []) {
    const b = obj(obj(p)?.analytics) ?? obj(p);
    if (b) blocks.push(b);
  }
  if (!blocks.length) blocks.push(root);
  const pick = (b: Json, keys: string[]) => {
    for (const k of keys) {
      const n = num(b[k]);
      if (n !== null) return n;
    }
    return null;
  };
  // Whole-post numbers when present; otherwise the platforms' numbers added up.
  const source = a ? [a] : blocks;
  const total = (keys: string[]) => {
    const xs = source.map((b) => pick(b, keys)).filter((n): n is number => n !== null);
    return xs.length ? xs.reduce((s, n) => s + n, 0) : null;
  };
  const engagementOf = (b: Json) => {
    const direct = pick(b, ["engagements", "engagement"]);
    if (direct !== null) return direct;
    const parts = ["likes", "comments", "shares", "saves", "reposts", "replies"].map((k) => num(b[k])).filter((n): n is number => n !== null);
    return parts.length ? parts.reduce((s, n) => s + n, 0) : null;
  };
  const eng = source.map(engagementOf).filter((n): n is number => n !== null);
  const m: PostMetrics = { impressions: total(["impressions", "views", "reach"]), clicks: total(["clicks", "linkClicks", "urlClicks"]), engagements: eng.length ? eng.reduce((s, n) => s + n, 0) : null };
  return m.impressions === null && m.clicks === null && m.engagements === null ? null : m;
}

const kindOf = (status: number): ZernioErrorKind => (status === 401 || status === 403 ? "auth" : status === 404 ? "not_found" : status === 409 ? "conflict" : status === 429 ? "rate_limited" : status >= 500 ? "unavailable" : "invalid");

export interface ZernioClientOptions {
  apiKey: string;
  baseUrl?: string;
  fetch?: FetchLike;
  timeoutMs?: number;
}

export class ZernioClient implements SocialPort {
  private readonly base: string;
  private readonly http: FetchLike;
  constructor(private readonly opts: ZernioClientOptions) {
    this.base = (opts.baseUrl ?? ZERNIO_BASE_URL).replace(/\/+$/, "");
    this.http = opts.fetch ?? ((input, init) => fetch(input, init));
  }

  private async call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; json: Json }> {
    let res: Response;
    try {
      res = await this.http(`${this.base}${path}`, {
        method,
        headers: { Authorization: `Bearer ${this.opts.apiKey}`, Accept: "application/json", ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...headers },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(this.opts.timeoutMs ?? ZERNIO_TIMEOUT_MS),
      });
    } catch {
      throw new ZernioError("unavailable", null);
    }
    const json = obj(await res.json().catch(() => null)) ?? {};
    return { status: res.status, json };
  }

  private async ok(method: string, path: string, body?: unknown, headers?: Record<string, string>): Promise<Json> {
    const r = await this.call(method, path, body, headers);
    if (r.status < 200 || r.status >= 300) throw new ZernioError(kindOf(r.status), r.status);
    return r.json;
  }

  async findProfile(externalId: string) {
    const r = await this.ok("GET", `/v1/profiles?externalId=${encodeURIComponent(externalId)}`);
    const list = Array.isArray(r.profiles) ? r.profiles : r.profile ? [r.profile] : [];
    const match = list.map(obj).find((p) => p && (p.externalId === undefined || p.externalId === externalId));
    const id = idOf(match);
    return id ? { id } : null;
  }

  async ensureProfile(input: { name: string; externalId: string }) {
    const r = await this.call("POST", "/v1/profiles", { name: input.name, externalId: input.externalId });
    if (r.status >= 200 && r.status < 300) {
      const id = idOf(r.json.profile) ?? idOf(r.json);
      if (id) return { id };
      throw new ZernioError("invalid", r.status);
    }
    // externalId is unique at Zernio: the workspace already has its profile.
    if (r.status === 409) {
      const found = await this.findProfile(input.externalId);
      if (found) return found;
    }
    throw new ZernioError(kindOf(r.status), r.status);
  }

  async connectLink(platform: Platform, profileId: string, redirectUrl: string) {
    const r = await this.ok("GET", `/v1/connect/${platform}?profileId=${encodeURIComponent(profileId)}&redirect_url=${encodeURIComponent(redirectUrl)}`);
    const authUrl = str(r.authUrl);
    if (!authUrl || !/^https:\/\//.test(authUrl)) throw new ZernioError("invalid", 200);
    return { authUrl };
  }

  async listAccounts(profileId: string) {
    const r = await this.ok("GET", `/v1/accounts?profileId=${encodeURIComponent(profileId)}`);
    return (Array.isArray(r.accounts) ? r.accounts : []).map(accountOf).filter((a): a is ZernioAccount => !!a);
  }

  async disconnectAccount(accountId: string) {
    const r = await this.call("DELETE", `/v1/accounts/${encodeURIComponent(accountId)}`);
    // Already gone at Zernio is what we wanted.
    if ((r.status >= 200 && r.status < 300) || r.status === 404) return;
    throw new ZernioError(kindOf(r.status), r.status);
  }

  async createPost(body: PostBody, idempotencyKey: string): Promise<CreatePostResult> {
    const r = await this.call("POST", "/v1/posts", body, { "Idempotency-Key": idempotencyKey });
    if (r.status === 409) return { outcome: "duplicate", post: postOf(r.json.post) ?? postOf(r.json.existingPost) };
    if (r.status < 200 || r.status >= 300) throw new ZernioError(kindOf(r.status), r.status);
    const post = postOf(r.json.post) ?? postOf(r.json);
    if (!post) throw new ZernioError("invalid", r.status);
    return { outcome: "accepted", post };
  }

  async getPost(postId: string) {
    const r = await this.call("GET", `/v1/posts/${encodeURIComponent(postId)}`);
    if (r.status === 404) return null;
    if (r.status < 200 || r.status >= 300) throw new ZernioError(kindOf(r.status), r.status);
    return postOf(r.json.post) ?? postOf(r.json);
  }

  async postMetrics(postId: string) {
    const r = await this.call("GET", `/v1/analytics?postId=${encodeURIComponent(postId)}`);
    // No analytics yet, or not part of this Zernio plan: the report shows the post without counts.
    if (r.status === 404 || r.status === 402 || r.status === 403) return null;
    if (r.status < 200 || r.status >= 300) throw new ZernioError(kindOf(r.status), r.status);
    return metricsOf(r.json);
  }
}
