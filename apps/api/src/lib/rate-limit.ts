// SPDX-License-Identifier: AGPL-3.0-only
// Daily caps on creating workspaces (review NP-07). The count lives in Postgres
// (`gms_claim_workspace_creation`, migration 0027): one statement per key checks and counts under
// a row lock, so parallel requests cannot all pass, and every Worker sees the same count. Without a
// database (tests, a partial install) an in-memory limiter keeps the same rules for one isolate.

/**
 * Workspace creation is open to any signed-in person, and since a workspace no longer needs
 * Passport it costs nothing to make one. These caps keep that from being used to fill the table.
 * One place to relax them.
 */
export const WORKSPACE_CREATION_LIMITS = { perUserPerDay: 5, perAddressPerDay: 20 } as const;

/** Counts creations per key per day. `claim` is all-or-nothing across the keys. */
export interface CreationLimiter {
  /** Count one creation against every key; false (and nothing counted) when any is at its limit. */
  claim(keys: readonly { key: string; limit: number }[], now: Date): Promise<boolean>;
  /** Give back a claim whose creation did not happen. */
  release(keys: readonly string[], now: Date): Promise<void>;
}

/** One isolate's counts. Check and count happen with no await between them, so they cannot interleave. */
export class MemoryCreationLimiter implements CreationLimiter {
  private readonly used = new Map<string, number>();
  private slot = (key: string, now: Date) => `${now.toISOString().slice(0, 10)}|${key}`;
  async claim(keys: readonly { key: string; limit: number }[], now: Date): Promise<boolean> {
    if (keys.some((k) => (this.used.get(this.slot(k.key, now)) ?? 0) >= k.limit)) return false;
    for (const k of keys) this.used.set(this.slot(k.key, now), (this.used.get(this.slot(k.key, now)) ?? 0) + 1);
    return true;
  }
  async release(keys: readonly string[], now: Date): Promise<void> {
    for (const key of keys) this.used.set(this.slot(key, now), Math.max(0, (this.used.get(this.slot(key, now)) ?? 0) - 1));
  }
}

/** The part of the Supabase client the limiter uses (service role). */
export interface RpcLike {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

export class SupabaseCreationLimiter implements CreationLimiter {
  constructor(private readonly client: RpcLike) {}
  async claim(keys: readonly { key: string; limit: number }[]): Promise<boolean> {
    const { data, error } = await this.client.rpc("gms_claim_workspace_creation", { p_keys: keys.map((k) => k.key), p_limits: keys.map((k) => k.limit) });
    if (error) throw new Error(`Counting workspace creations failed: ${error.message}`);
    return data === true;
  }
  async release(keys: readonly string[]): Promise<void> {
    const { error } = await this.client.rpc("gms_release_workspace_creation", { p_keys: [...keys] });
    if (error) throw new Error(`Releasing a workspace-creation count failed: ${error.message}`);
  }
}

/** Expand an IPv6 address to its eight groups; null when it is not one. */
function ipv6Groups(address: string): string[] | null {
  if (!address.includes(":") || !/^[0-9A-Fa-f:.]+$/.test(address)) return null;
  const [head, tail, ...more] = address.toLowerCase().split("::");
  if (more.length) return null;
  const left = head ? head.split(":") : [];
  const right = tail !== undefined ? (tail ? tail.split(":") : []) : null;
  // An embedded IPv4 tail (::ffff:1.2.3.4) counts as two groups.
  const v4 = (parts: string[]) => parts.flatMap((p) => (p.includes(".") ? ["0", "0"] : [p]));
  const l = v4(left);
  const r = right ? v4(right) : [];
  const fill = right ? 8 - l.length - r.length : 0;
  if (fill < 0 || (!right && l.length !== 8)) return null;
  const groups = [...l, ...Array(fill).fill("0"), ...r];
  return groups.every((g) => /^[0-9a-f]{1,4}$/.test(g)) ? groups.map((g) => g.replace(/^0+(?=.)/, "")) : null;
}

/**
 * The key a network address is counted under: an IPv4 address as is, an IPv6 address by its /64
 * (one subscriber's allocation, so rotating within it does not reset the count). Only Cloudflare's
 * `CF-Connecting-IP` is trusted; forwarded headers only when `trustProxy` says a proxy sets them.
 */
export function addressKey(header: (name: string) => string | undefined, trustProxy = false): string | null {
  const raw = header("CF-Connecting-IP") ?? (trustProxy ? (header("X-Forwarded-For")?.split(",")[0]?.trim() ?? header("X-Real-IP")) : undefined);
  if (!raw || raw.length > 64) return null;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(raw)) return raw;
  const groups = ipv6Groups(raw);
  return groups ? `${groups.slice(0, 4).join(":")}::/64` : null;
}
