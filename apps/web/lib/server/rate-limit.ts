// SPDX-License-Identifier: AGPL-3.0-or-later
// Fixed-window rate limiting in Postgres (works across serverless instances).
import 'server-only';
import { getRuntime } from '@gms/actions';
import { sql } from '@gms/db';

export async function rateLimit(key: string, limit: number, windowSeconds: number): Promise<{ ok: boolean; remaining: number; resetSeconds: number }> {
  const now = Date.now();
  const windowStart = new Date(Math.floor(now / (windowSeconds * 1000)) * windowSeconds * 1000).toISOString();
  const r = await sql<{ count: number }>`
    insert into public.rate_limit_buckets (key, window_start, count) values (${key}, ${windowStart}, 1)
    on conflict (key) do update set
      count = case when rate_limit_buckets.window_start = excluded.window_start then rate_limit_buckets.count + 1 else 1 end,
      window_start = excluded.window_start
    returning count`.execute(getRuntime().db);
  const count = Number(r.rows[0]?.count ?? 1);
  const resetSeconds = Math.ceil((Date.parse(windowStart) + windowSeconds * 1000 - now) / 1000);
  return { ok: count <= limit, remaining: Math.max(0, limit - count), resetSeconds };
}
