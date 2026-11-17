// SPDX-License-Identifier: AGPL-3.0-only
// Social posting through Zernio: the port behind Settings › Social accounts, the post composer and
// the reach panel. `createHttpSocialApi` calls the GMS Worker (/gms/social); `createMockSocialApi`
// (mocks/social.ts) implements the same interface in the browser against the fake Zernio.
//
// Nothing here posts on its own: `post` is called only from the composer's Post button, after the
// person has seen `preview`, and the server refuses it unless the body is the one previewed.
import { ApiError } from "./client.ts";
import type { components } from "./schema.d.ts";

type S = components["schemas"];

export type SocialPlatform = S["Models.SocialPlatform"];
export type SocialSettings = S["Models.SocialSettings"];
export type SocialAccount = S["Models.SocialAccount"];
export type SocialDraft = S["Models.SocialDraft"];
export type SocialComposeInput = S["Models.SocialComposeInput"];
export type SocialPreview = S["Models.SocialPreview"];
export type SocialPost = S["Models.SocialPost"];
export type SocialPostStatus = S["Models.SocialPostStatus"];
export type SocialReach = S["Models.SocialReach"];
export type SocialSubject = S["Models.SocialSubject"];
export type SocialCallback = S["Models.SocialConnectCallback"];

export interface SocialApi {
  /** Null when social posting is not set up on this server: every social control is hidden. */
  settings(): Promise<SocialSettings | null>;
  /** Start connecting an account: Zernio's sign-in (or, in mock mode, a path in this app). */
  connect(platform: SocialPlatform): Promise<{ authUrl: string }>;
  /** What Zernio added to the return address; the server checks it against Zernio. */
  finishConnect(params: SocialCallback): Promise<SocialAccount>;
  disconnect(accountId: string): Promise<SocialAccount>;
  draft(subject: SocialSubject): Promise<SocialDraft>;
  preview(input: SocialComposeInput): Promise<SocialPreview>;
  /** The person's click on Post. `idempotencyKey` is one per logical post: a retry sends the same. */
  post(input: SocialComposeInput & { previewToken: string }, idempotencyKey: string): Promise<SocialPost>;
  reach(subject?: SocialSubject): Promise<SocialReach>;
  /** A funder admin dismisses a call's "Two weeks left" prompt. */
  dismissReminder(id: string): Promise<{ id: string; opportunityId: string; dismissed: true }>;
}

export interface HttpSocialOptions {
  baseUrl: string;
  token: () => Promise<string | null>;
  workspaceId: () => string | null;
  fetch?: typeof fetch;
}

export function createHttpSocialApi(opts: HttpSocialOptions): SocialApi {
  async function call<T>(method: string, path: string, body?: unknown, extra: Record<string, string> = {}): Promise<T> {
    const token = await opts.token();
    const workspaceId = opts.workspaceId();
    const res = await (opts.fetch ?? fetch)(`${opts.baseUrl}${path}`, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(workspaceId ? { "X-GMS-Workspace": workspaceId } : {}),
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...extra,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const json = (await res.json().catch(() => ({}))) as { data?: T; message?: string; errors?: unknown[] };
    if (!res.ok) throw new ApiError(res.status, json.message ?? `Request failed (${res.status})`, (json.errors ?? []) as never);
    return json.data as T;
  }
  const e = encodeURIComponent;
  const subjectQuery = (s: SocialSubject) => `subjectType=${e(s.type)}&subjectId=${e(s.id)}`;
  return {
    settings: async () => {
      try {
        return await call<SocialSettings>("GET", "/gms/social");
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) return null;
        throw err;
      }
    },
    connect: (platform) => call("POST", "/gms/social/connect", { platform }),
    finishConnect: (params) => call("POST", "/gms/social/connect/callback", params),
    disconnect: (accountId) => call("DELETE", `/gms/social/accounts/${e(accountId)}`),
    draft: (subject) => call("GET", `/gms/social/compose?${subjectQuery(subject)}`),
    preview: (input) => call("POST", "/gms/social/posts/preview", input),
    post: (input, idempotencyKey) => call("POST", "/gms/social/posts", input, { "Idempotency-Key": idempotencyKey }),
    reach: (subject) => call("GET", `/gms/social/posts${subject ? `?${subjectQuery(subject)}` : ""}`),
    dismissReminder: (id) => call("POST", `/gms/social/reminders/${e(id)}/dismiss`),
  };
}

/** The callback Zernio makes to Settings › Social accounts, read from the address, or null. */
export function callbackFrom(search: string): SocialCallback | null {
  const q = new URLSearchParams(search);
  const state = q.get("gs");
  const profileId = q.get("profileId");
  const accountId = q.get("accountId");
  if (!state || !profileId || !accountId) return null;
  return { state, profileId, accountId, ...(q.get("connected") ? { connected: q.get("connected")! } : {}), ...(q.get("username") ? { username: q.get("username")! } : {}) };
}
