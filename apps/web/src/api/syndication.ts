// SPDX-License-Identifier: AGPL-3.0-only
// "Share this call" (docs/syndication.md), for a funder workspace: the open-call feeds a call is
// in, the feed OpenGrants can pull, and the Philanthropy News Digest submission, which a person
// previews and sends, once per call.
//
// `createHttpSyndicationApi` calls the GMS Worker (api/syndication.tsp);
// `createMockSyndicationApi` (mocks/syndication.ts) implements the same interface in the browser.
import { ApiError } from "./client.ts";

export type PndBlock = "person_only" | "role" | "not_listed" | "closed" | "too_late" | "mail_not_configured" | "no_reply_to" | "sent" | "sending";

export interface Syndication {
  opportunityId: string;
  feeds: { on: boolean; listed: boolean; urls: { json: string; csv: string; rss: string }; allUrl: string };
  openGrants: { on: boolean; inFeed: boolean; feedUrl: string; pulling: boolean };
  pnd: {
    name: string;
    address: string;
    sourceUrl: string;
    leadDays: number;
    /** YYYY-MM-DD; null for a call open all year. */
    earliestDeadline: string | null;
    /** YYYY-MM-DD: the last day PND takes the call. */
    sendBy: string | null;
    sent: { sentAt: string; replyTo: string } | null;
    canSend: boolean;
    blocked: PndBlock | null;
  };
  startedFrom: { feed: number; pnd: number };
}

export type PndFieldKey = "funder" | "title" | "scope" | "qualifications" | "instructions" | "deadlines" | "link" | "contact";

export interface PndPreview {
  from: string;
  to: string;
  replyTo: string;
  subject: string;
  text: string;
  html: string;
  fields: { key: PndFieldKey; label: string; value: string }[];
  digest: string;
  earliestDeadline: string | null;
  sendBy: string | null;
  sourceUrl: string;
}

export interface PndSent {
  sent: true;
  sentAt: string;
  to: string;
  replyTo: string;
}

export interface SyndicationApi {
  get(opportunityId: string): Promise<Syndication>;
  setFeeds(opportunityId: string, feeds: boolean): Promise<Syndication>;
  previewPnd(opportunityId: string): Promise<PndPreview>;
  sendPnd(opportunityId: string, digest: string): Promise<PndSent>;
}

export interface HttpSyndicationOptions {
  baseUrl: string;
  token: () => Promise<string | null>;
  workspaceId: () => string | null;
  fetch?: typeof fetch;
}

export function createHttpSyndicationApi(opts: HttpSyndicationOptions): SyndicationApi {
  const doFetch = opts.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const token = await opts.token();
    const workspaceId = opts.workspaceId();
    const res = await doFetch(`${opts.baseUrl}${path}`, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(workspaceId ? { "X-GMS-Workspace": workspaceId } : {}),
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const json = (await res.json().catch(() => ({}))) as { data?: T; message?: string; errors?: unknown[] };
    if (!res.ok) throw new ApiError(res.status, json.message ?? `Request failed (${res.status})`, json.errors ?? []);
    return json.data as T;
  }
  const base = (id: string) => `/gms/opportunities/${encodeURIComponent(id)}/syndication`;
  return {
    get: (id) => call("GET", base(id)),
    setFeeds: (id, feeds) => call("PUT", `${base(id)}/feeds`, { feeds }),
    previewPnd: (id) => call("POST", `${base(id)}/pnd/preview`, {}),
    sendPnd: (id, digest) => call("POST", `${base(id)}/pnd`, { digest }),
  };
}
