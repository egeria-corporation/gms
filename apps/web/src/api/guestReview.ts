// SPDX-License-Identifier: AGPL-3.0-only
// The guest reviewer loop (C4): an external reviewer's welcome after accepting an invitation to
// review, and the done screen after their last review with a one-time offer to run a review panel
// for their own organization. Calls name the funder workspace the person reviews for.
//
// `createHttpGuestReviewApi` calls the GMS Worker (api/guest-review.tsp); `createMockGuestReviewApi`
// (mocks/guestReview.ts) implements the same interface in the browser.
import { ApiError } from "./client.ts";

export interface GuestFunder {
  name: string;
  handle: string;
}

export interface GuestCompetition {
  id: string;
  title: string;
  opportunityTitle: string | null;
  assigned: number;
  submitted: number;
  open: number;
  dueAt: string | null;
}

export interface GuestWelcome {
  funder: GuestFunder;
  competitions: GuestCompetition[];
  assigned: number;
  submitted: number;
  open: number;
  dueAt: string | null;
  coi: { note: string; link: string };
  startUrl: string;
  done: boolean;
}

export interface PanelSuggestion {
  domain: string;
  name: string;
  handle: string;
}

export interface GuestDone {
  funder: GuestFunder;
  done: boolean;
  submitted: number;
  assigned: number;
  open: number;
  offer: { show: boolean; suggestion: PanelSuggestion | null };
}

export type PanelOfferEvent = "shown" | "clicked" | "dismissed" | "created";

export interface GuestReviewApi {
  welcome(workspaceId: string): Promise<GuestWelcome>;
  done(workspaceId: string): Promise<GuestDone>;
  offer(workspaceId: string, event: PanelOfferEvent, createdWorkspaceId?: string): Promise<{ event: PanelOfferEvent; counted: boolean }>;
}

export interface HttpGuestReviewOptions {
  baseUrl: string;
  token: () => Promise<string | null>;
  fetch?: typeof fetch;
}

export function createHttpGuestReviewApi(opts: HttpGuestReviewOptions): GuestReviewApi {
  async function call<T>(workspaceId: string, method: string, path: string, body?: unknown): Promise<T> {
    const token = await opts.token();
    const res = await (opts.fetch ?? fetch)(`${opts.baseUrl}${path}`, {
      method,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "X-GMS-Workspace": workspaceId, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const json = (await res.json().catch(() => ({}))) as { data?: T; message?: string; errors?: unknown[] };
    if (!res.ok) throw new ApiError(res.status, json.message ?? `Request failed (${res.status})`, json.errors ?? []);
    return json.data as T;
  }
  return {
    welcome: (ws) => call(ws, "GET", "/gms/guest-review/welcome"),
    done: (ws) => call(ws, "GET", "/gms/guest-review/done"),
    offer: (ws, event, createdWorkspaceId) => call(ws, "POST", "/gms/guest-review/offer", { event, ...(event === "created" && createdWorkspaceId ? { workspaceId: createdWorkspaceId } : {}) }),
  };
}
