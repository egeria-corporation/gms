// SPDX-License-Identifier: AGPL-3.0-or-later
// Liveness + readiness for uptime monitors: the app answers and the database responds. No tenant, no auth, no
// secrets in the response.
import { getRuntime } from '@gms/actions';
import { sql } from '@gms/db';
import { config } from '@/lib/config';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const started = Date.now();
  let database: 'ok' | 'error' = 'ok';
  try {
    await Promise.race([
      sql`select 1`.execute(getRuntime().db),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000)),
    ]);
  } catch {
    database = 'error';
  }
  const ok = database === 'ok';
  return Response.json(
    { status: ok ? 'ok' : 'degraded', version: config.version, database, latencyMs: Date.now() - started },
    { status: ok ? 200 : 503, headers: { 'cache-control': 'no-store' } },
  );
}
