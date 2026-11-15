// SPDX-License-Identifier: AGPL-3.0-only
// A fake Zernio for tests and the web app's mock mode: the parts of Zernio's API the GMS calls,
// answered from memory, with Zernio's rules for profiles (externalId unique), idempotent posts
// (the same Idempotency-Key within a day returns the original) and duplicates (the same content
// to the same account within a day answers 409). It records every request so a test can compare
// what was sent with what the person saw. It never reaches the network.
import type { FetchLike, PostBody } from "./client.ts";
import { isPlatform, type Platform } from "./platforms.ts";
import { signZernioBody } from "./webhook.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface FakeProfile {
  _id: string;
  name: string;
  externalId: string;
}
export interface FakeAccount {
  _id: string;
  profileId: string;
  platform: Platform;
  username: string;
  active: boolean;
}
export interface FakePost {
  _id: string;
  key: string;
  body: PostBody;
  createdAt: number;
  status: "scheduled" | "published" | "partial" | "failed";
  platforms: { platform: Platform; accountId: string; status: string; platformPostUrl: string | null }[];
}
export interface FakeRequest {
  method: string;
  path: string;
  query: Record<string, string>;
  idempotencyKey: string | null;
  body: unknown;
}

export interface FakeZernioOptions {
  apiKey: string;
  baseUrl?: string;
  now?: () => Date;
}

export class FakeZernio {
  readonly profiles: FakeProfile[] = [];
  readonly accounts: FakeAccount[] = [];
  readonly posts: FakePost[] = [];
  readonly requests: FakeRequest[] = [];
  /** Counts per post, as Zernio's analytics would report them. */
  readonly metrics = new Map<string, Record<string, number>>();
  /** The next N calls answer with this status (Zernio down, a rate limit). */
  failNext: { status: number; times: number } | null = null;
  private readonly pending = new Map<string, { platform: Platform; profileId: string; redirectUrl: string }>();
  private seq = 0;
  readonly base: string;

  constructor(private readonly opts: FakeZernioOptions) {
    this.base = (opts.baseUrl ?? "https://zernio.com/api").replace(/\/+$/, "");
  }

  private now = () => (this.opts.now ? this.opts.now() : new Date()).getTime();
  private id = (prefix: string) => `${prefix}${(++this.seq).toString(16).padStart(8, "0")}`;

  /** The person approves the connection at the platform: the account is created and the browser is sent back. */
  approve(authUrl: string, username: string): string {
    const state = /\/connect\/([A-Za-z0-9_-]+)$/.exec(authUrl)?.[1];
    const p = state ? this.pending.get(state) : undefined;
    if (!p || !state) throw new Error("fake Zernio: no connection waiting for that link");
    this.pending.delete(state);
    const existing = this.accounts.find((a) => a.profileId === p.profileId && a.platform === p.platform && a.username === username);
    const account = existing ?? { _id: this.id("acc_"), profileId: p.profileId, platform: p.platform, username, active: true };
    account.active = true;
    if (!existing) this.accounts.push(account);
    const url = new URL(p.redirectUrl, "https://gms.invalid");
    for (const [k, v] of Object.entries({ connected: p.platform, profileId: p.profileId, accountId: account._id, username, request_id: this.id("req_"), stage: "complete" })) url.searchParams.set(k, v);
    return p.redirectUrl.startsWith("/") ? `${url.pathname}${url.search}` : url.toString();
  }

  /** A signed webhook delivery, as Zernio would send it to the endpoint. */
  async delivery(secret: string, event: Record<string, unknown>): Promise<{ body: string; signature: string }> {
    const body = JSON.stringify(event);
    return { body, signature: await signZernioBody(secret, body) };
  }

  readonly fetch: FetchLike = async (input, init) => {
    const url = new URL(input);
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = new Headers(init?.headers);
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : undefined;
    const path = url.pathname.startsWith(new URL(this.base).pathname) ? url.pathname.slice(new URL(this.base).pathname.length) : url.pathname;
    this.requests.push({ method, path, query: Object.fromEntries(url.searchParams), idempotencyKey: headers.get("Idempotency-Key"), body });
    const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
    if (`${url.origin}` !== new URL(this.base).origin) return json(404, { error: "Not found" });
    if (headers.get("Authorization") !== `Bearer ${this.opts.apiKey}`) return json(401, { error: "Invalid API key" });
    if (this.failNext && this.failNext.times > 0) {
      this.failNext.times -= 1;
      const status = this.failNext.status;
      if (this.failNext.times === 0) this.failNext = null;
      return json(status, { error: "Unavailable" });
    }
    const q = url.searchParams;
    let m: RegExpExecArray | null;

    if (path === "/v1/profiles" && method === "POST") {
      const b = body as { name?: string; externalId?: string };
      if (!b?.name || !b.externalId) return json(400, { error: "name and externalId are required" });
      if (this.profiles.some((p) => p.externalId === b.externalId)) return json(409, { error: "externalId already in use" });
      const profile = { _id: this.id("prof_"), name: b.name, externalId: b.externalId };
      this.profiles.push(profile);
      return json(201, { profile });
    }
    if (path === "/v1/profiles" && method === "GET") return json(200, { profiles: this.profiles.filter((p) => !q.get("externalId") || p.externalId === q.get("externalId")) });

    if ((m = /^\/v1\/connect\/([a-z]+)$/.exec(path)) && method === "GET") {
      const platform = m[1];
      const profileId = q.get("profileId") ?? "";
      const redirectUrl = q.get("redirect_url") ?? "";
      if (!isPlatform(platform)) return json(400, { error: "Unknown platform" });
      if (!this.profiles.some((p) => p._id === profileId)) return json(404, { error: "Profile not found" });
      if (!redirectUrl) return json(400, { error: "redirect_url is required" });
      const state = this.id("st_");
      this.pending.set(state, { platform, profileId, redirectUrl });
      return json(200, { authUrl: `https://zernio.fake/connect/${state}`, state });
    }

    if (path === "/v1/accounts" && method === "GET") {
      const profileId = q.get("profileId");
      return json(200, { accounts: this.accounts.filter((a) => a.active && (!profileId || a.profileId === profileId)).map((a) => ({ _id: a._id, platform: a.platform, username: a.username, profileId: a.profileId, isActive: true })) });
    }
    if ((m = /^\/v1\/accounts\/([A-Za-z0-9_-]+)$/.exec(path)) && method === "DELETE") {
      const a = this.accounts.find((x) => x._id === m![1] && x.active);
      if (!a) return json(404, { error: "Account not found" });
      a.active = false;
      return json(200, { message: "Disconnected" });
    }

    if (path === "/v1/posts" && method === "POST") {
      const key = headers.get("Idempotency-Key");
      const b = body as PostBody;
      const now = this.now();
      const replay = key ? this.posts.find((p) => p.key === key && now - p.createdAt < DAY_MS) : undefined;
      if (replay) return json(200, { post: this.view(replay) });
      if (!b?.content || !Array.isArray(b.platforms) || !b.platforms.length) return json(400, { error: "content and platforms are required" });
      for (const t of b.platforms) if (!this.accounts.some((a) => a._id === t.accountId && a.active && a.platform === t.platform)) return json(400, { error: "Unknown account" });
      const dup = this.posts.find((p) => now - p.createdAt < DAY_MS && p.body.content === b.content && p.body.platforms.some((t) => b.platforms.some((u) => u.accountId === t.accountId)));
      if (dup) return json(409, { error: "Duplicate content", existingPost: this.view(dup) });
      const scheduled = !b.publishNow;
      const _id = this.id("post_");
      const post: FakePost = {
        _id,
        key: key ?? this.id("nokey_"),
        body: b,
        createdAt: now,
        status: scheduled ? "scheduled" : "published",
        platforms: b.platforms.map((t) => ({ platform: t.platform, accountId: t.accountId, status: scheduled ? "scheduled" : "published", platformPostUrl: scheduled ? null : `https://${t.platform}.example/posts/${_id}` })),
      };
      this.posts.push(post);
      return json(201, { post: this.view(post) });
    }
    if ((m = /^\/v1\/posts\/([A-Za-z0-9_-]+)$/.exec(path)) && method === "GET") {
      const p = this.posts.find((x) => x._id === m![1]);
      return p ? json(200, { post: this.view(p) }) : json(404, { error: "Post not found" });
    }
    if (path === "/v1/analytics" && method === "GET") {
      const id = q.get("postId") ?? "";
      const counts = this.metrics.get(id);
      return counts ? json(200, { postId: id, analytics: counts }) : json(404, { error: "No analytics yet" });
    }
    return json(404, { error: "Not found" });
  };

  /** Publish a scheduled post now (as its time arriving would). */
  publish(postId: string): FakePost {
    const p = this.posts.find((x) => x._id === postId);
    if (!p) throw new Error("fake Zernio: no such post");
    p.status = "published";
    for (const t of p.platforms) {
      t.status = "published";
      t.platformPostUrl = `https://${t.platform}.example/posts/${p._id}`;
    }
    return p;
  }

  private view(p: FakePost) {
    return { _id: p._id, content: p.body.content, status: p.status, scheduledFor: p.body.scheduledFor ?? null, timezone: p.body.timezone ?? null, platforms: p.platforms.map((t) => ({ ...t })) };
  }
}
