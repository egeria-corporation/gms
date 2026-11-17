// SPDX-License-Identifier: AGPL-3.0-only
// The pass to a draft's live channel (api/presence.tsp, docs/co-editing.md). The API issues it to
// the signed-in person's session after the check that opens the draft; Supabase Realtime admits
// the session to the draft's private channel only while it holds one (migration 0050).
//
// `createHttpPresenceApi` calls the GMS Worker; `createMockPresenceApi` (mocks/presence.ts) answers
// in the browser for mock mode and tests.
import { ApiError } from "./client.ts";

/** A built-in application (`app_…`) or an outside one. */
export interface PresenceDraft {
  kind: "application" | "outside_application";
  id: string;
}

export interface PresencePass {
  /** The private channel: `draft:application:<uuid>` or `draft:outside:<uuid>`. */
  topic: string;
  expiresAt: string;
  /** Ask again after this many seconds while the editor stays open. */
  renewAfterSeconds: number;
  /** This session may write here, so it may send soft locks and saved nudges. */
  canWrite: boolean;
}

export interface PresenceApi {
  pass(workspaceId: string, draft: PresenceDraft): Promise<PresencePass>;
}

export interface HttpPresenceOptions {
  baseUrl: string;
  token: () => Promise<string | null>;
  fetch?: typeof fetch;
}

export function createHttpPresenceApi(opts: HttpPresenceOptions): PresenceApi {
  return {
    async pass(workspaceId, draft) {
      const token = await opts.token();
      const res = await (opts.fetch ?? fetch)(`${opts.baseUrl}/gms/presence/passes`, {
        method: "POST",
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "X-GMS-Workspace": workspaceId, "Content-Type": "application/json" },
        body: JSON.stringify({ draft }),
      });
      const json = (await res.json().catch(() => ({}))) as { data?: PresencePass; message?: string; errors?: unknown[] };
      if (!res.ok || !json.data) throw new ApiError(res.status, json.message ?? `Request failed (${res.status})`, json.errors ?? []);
      return json.data;
    },
  };
}
