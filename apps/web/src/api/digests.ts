// SPDX-License-Identifier: AGPL-3.0-only
// Opt-in content digests (v1.8.0): what we email a person on Mondays, per workspace. New matches and
// deadlines in an applicant workspace, the week's activity in a funder one, each off until the
// person turns it on; a preview of next Monday's email; and the one-click unsubscribe page, which
// needs no sign-in (the signed link in the email is the proof).
//
// `createHttpDigestsApi` calls the GMS Worker (api/digests.tsp); `createMockDigestsApi`
// (mocks/digests.ts) implements the same interface in the browser.
import { ApiError } from "./client.ts";

export type DigestKey = "new_matches" | "deadlines" | "funder_activity";

export interface DigestChoice {
  key: DigestKey;
  label: string;
  description: string;
  on: boolean;
}

export interface DigestSettings {
  /** Only the digests this person can turn on in this workspace. */
  digests: DigestChoice[];
  /** The one-time "Get new matches every Monday" prompt was acted on or dismissed. */
  promptDismissed: boolean;
  /** YYYY-MM-DD. */
  nextSendOn: string;
  emailAvailable: boolean;
}

export interface DigestSettingsInput {
  new_matches?: boolean;
  deadlines?: boolean;
  funder_activity?: boolean;
  promptDismissed?: true;
}

export interface DigestPreview {
  digest: DigestKey;
  label: string;
  on: boolean;
  sendsOn: string;
  /** False when nothing is new: no email would go out. */
  willSend: boolean;
  subject: string | null;
  text: string | null;
}

export interface DigestUnsubscribed {
  digest: DigestKey;
  label: string;
  workspace: string | null;
  on: false;
}

export interface DigestsApi {
  settings(workspaceId: string): Promise<DigestSettings>;
  save(workspaceId: string, input: DigestSettingsInput): Promise<DigestSettings>;
  preview(workspaceId: string, digest: DigestKey): Promise<DigestPreview>;
  /** No sign-in: the token from the email link. */
  unsubscribe(token: string): Promise<DigestUnsubscribed>;
}

export interface HttpDigestsOptions {
  baseUrl: string;
  token: () => Promise<string | null>;
  fetch?: typeof fetch;
}

export function createHttpDigestsApi(opts: HttpDigestsOptions): DigestsApi {
  async function call<T>(method: string, path: string, workspaceId: string | null, body?: unknown, signedIn = true): Promise<T> {
    const token = signedIn ? await opts.token() : null;
    const res = await (opts.fetch ?? fetch)(`${opts.baseUrl}${path}`, {
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
  return {
    settings: (workspaceId) => call<DigestSettings>("GET", "/gms/digests", workspaceId),
    save: (workspaceId, input) => call<DigestSettings>("PUT", "/gms/digests", workspaceId, input),
    preview: (workspaceId, digest) => call<DigestPreview>("GET", `/gms/digests/preview?digest=${encodeURIComponent(digest)}`, workspaceId),
    unsubscribe: (token) => call<DigestUnsubscribed>("POST", "/gms/digests/unsubscribe", null, { token }, false),
  };
}

/** The token in an unsubscribe link: in the fragment (`#token=…`), so it never reaches a server log. */
export function unsubscribeTokenFrom(hash: string, search = ""): string | null {
  const fromHash = new URLSearchParams(hash.replace(/^#/, "")).get("token");
  return fromHash || new URLSearchParams(search).get("token") || null;
}

/** "Monday, April 19" from YYYY-MM-DD. */
export function mondayLabel(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? date : d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
}
