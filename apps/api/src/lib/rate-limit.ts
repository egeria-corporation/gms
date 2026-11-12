// SPDX-License-Identifier: AGPL-3.0-only
// Fixed-window counters in the RATE_LIMIT KV namespace (an in-memory map when it is not bound),
// the same facility the MCP dispatcher and Sign in with Passport use. KV has no atomic increment,
// so two requests at once can count as one: a limit here is a brake, not a quota.
import type { KvPort } from "@gms/mcp";

/**
 * Workspace creation is open to any signed-in person, and since a workspace no longer needs
 * Passport it costs nothing to make one. These caps keep that from being used to fill the table.
 * One place to relax them.
 */
export const WORKSPACE_CREATION_LIMITS = { perUserPerDay: 5, perAddressPerDay: 20, windowSeconds: 86_400 } as const;

/** The caller's network address as Cloudflare reports it, or null when there is none to trust. */
export function clientAddress(header: (name: string) => string | undefined): string | null {
  const address = header("CF-Connecting-IP") ?? header("X-Forwarded-For")?.split(",")[0]?.trim() ?? header("X-Real-IP");
  return address && /^[0-9A-Fa-f:.]{2,64}$/.test(address) ? address : null;
}

export interface WindowCounter {
  /** True when every counter is under its limit. */
  allowed(): Promise<boolean>;
  /** Count one use against every counter. Call after the action succeeded. */
  hit(): Promise<void>;
}

/** Several fixed-window counters checked and counted together. */
export function windowCounters(kv: KvPort, nowMs: number, windowSeconds: number, counters: readonly { key: string; limit: number }[]): WindowCounter {
  const window = Math.floor(nowMs / 1000 / windowSeconds);
  const keys = counters.map((c) => ({ ...c, key: `${c.key}:${window}` }));
  return {
    async allowed() {
      for (const c of keys) if (Number((await kv.get(c.key)) ?? "0") >= c.limit) return false;
      return true;
    },
    async hit() {
      for (const c of keys) await kv.put(c.key, String(Number((await kv.get(c.key)) ?? "0") + 1), { expirationTtl: windowSeconds * 2 });
    },
  };
}
