// SPDX-License-Identifier: AGPL-3.0-only
// One scheduled tick (Netlify Scheduled Function or `pnpm --filter @gms/worker tick`):
// runs queued graphile jobs once, then the time-based work for this minute.
import { getRuntime } from '@gms/actions';
import { databaseUrl } from '@gms/db';
import { runOnce } from 'graphile-worker';
import { runScheduled, taskList } from './tasks';

export async function tick(now = new Date()): Promise<{ ran: string[] }> {
  const rt = getRuntime();
  await runOnce({ connectionString: databaseUrl(), taskList: taskList(rt), noHandleSignals: true });
  const ran = await runScheduled(rt, now);
  return { ran };
}
