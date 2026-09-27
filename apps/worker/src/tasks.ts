// SPDX-License-Identifier: AGPL-3.0-only
// Periodic work. Used by the long-lived worker (graphile-worker crontab) and by the Netlify scheduled
// function (worker-tick), which calls runScheduled() once a minute.
import { expireApprovals, systemContext, type Runtime } from '@gms/actions';
import { sql } from '@gms/db';
import type { TaskList } from 'graphile-worker';
import { deliverWebhooks, drainOutbox } from './outbox';

async function forEachWorkspace(rt: Runtime, fn: (ws: { id: string; slug: string; name: string; timezone: string }) => Promise<void>, filter?: 'mercury') {
  let q = rt.db.selectFrom('workspaces as w').select(['w.id', 'w.slug', 'w.name', 'w.timezone']).where('w.status', '=', 'active');
  if (filter === 'mercury') {
    q = q.where((eb) =>
      eb.exists(eb.selectFrom('bank_connections as c').select('c.id').whereRef('c.workspace_id', '=', 'w.id').where('c.provider', '=', 'mercury').where('c.status', '=', 'connected')),
    );
  }
  for (const ws of await q.execute()) {
    try {
      await fn(ws);
    } catch (err) {
      console.error(`[worker] ${ws.slug}: ${(err as Error).message}`);
    }
  }
}

export async function everyMinute(rt: Runtime): Promise<void> {
  await rt.executor.run('system.tick_opportunity_schedule', {}, systemContext(null));
  while ((await drainOutbox(rt)) > 0) {
    /* drain until empty */
  }
  await deliverWebhooks(rt);
}

export async function everyFiveMinutes(rt: Runtime): Promise<void> {
  await forEachWorkspace(
    rt,
    async (ws) => {
      await rt.executor.run('system.poll_payees', {}, systemContext(ws));
      await rt.executor.run('system.poll_bank_requests', {}, systemContext(ws));
    },
    'mercury',
  );
  await drainOutbox(rt);
}

export async function hourly(rt: Runtime): Promise<void> {
  await forEachWorkspace(rt, (ws) => rt.executor.run('bank.sync', {}, systemContext(ws)).then(() => undefined), 'mercury');
  await expireApprovals(rt.db);
  await refreshAnalytics(rt);
}

export async function nightly(rt: Runtime): Promise<void> {
  await rt.executor.run('system.tick_reports', {}, systemContext(null));
  await forEachWorkspace(rt, (ws) => rt.executor.run('system.reconcile', { days: 30 }, systemContext(ws)).then(() => undefined), 'mercury');
  await refreshAnalytics(rt);
  // Retention: processed outbox rows and dev mail older than 30 days.
  await sql`delete from public.outbox where processed_at < now() - interval '30 days'`.execute(rt.db);
  await sql`delete from public.dev_outbox where created_at < now() - interval '30 days'`.execute(rt.db);
  await sql`delete from public.rate_limit_buckets where window_start < now() - interval '1 day'`.execute(rt.db);
  await drainOutbox(rt);
}

export async function refreshAnalytics(rt: Runtime): Promise<void> {
  const r = await sql<{ name: string }>`select matviewname as name from pg_matviews where schemaname = 'analytics'`.execute(rt.db);
  for (const mv of r.rows) {
    await sql`refresh materialized view ${sql.raw(`analytics."${mv.name.replace(/"/g, '')}"`)}`.execute(rt.db).catch((e: Error) => console.error(`[analytics] ${mv.name}: ${e.message}`));
  }
}

/** Called once a minute by the Netlify scheduled function. */
export async function runScheduled(rt: Runtime, now = new Date()): Promise<string[]> {
  const ran: string[] = ['minute'];
  await everyMinute(rt);
  const m = now.getUTCMinutes();
  const h = now.getUTCHours();
  if (m % 5 === 0) {
    await everyFiveMinutes(rt);
    ran.push('five');
  }
  if (m === 7) {
    await hourly(rt);
    ran.push('hourly');
  }
  if (h === 10 && m === 15) {
    await nightly(rt);
    ran.push('nightly');
  }
  return ran;
}

export function taskList(rt: Runtime): TaskList {
  return {
    every_minute: async () => everyMinute(rt),
    every_five_minutes: async () => everyFiveMinutes(rt),
    hourly: async () => hourly(rt),
    nightly: async () => nightly(rt),
    drain_outbox: async () => {
      await drainOutbox(rt);
    },
    run_export: async (payload) => {
      const { runExport } = await import('./exports');
      await runExport(rt, String((payload as { exportId: string }).exportId));
    },
  };
}

export const CRONTAB = [
  '* * * * * every_minute',
  '*/5 * * * * every_five_minutes',
  '7 * * * * hourly',
  // 02:15 Pacific ≈ 10:15 UTC (the server runs in UTC).
  '15 10 * * * nightly',
].join('\n');
