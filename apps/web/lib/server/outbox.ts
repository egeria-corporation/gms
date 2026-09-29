// SPDX-License-Identifier: AGPL-3.0-or-later
// In-process fast path: after an action commits, drain the outbox soon (the worker/cron is the backstop).
// Safe to run concurrently with the worker: events are claimed with FOR UPDATE SKIP LOCKED.
import 'server-only';
import { getRuntime } from '@gms/actions';

let scheduled = false;

export function kickOutbox(): void {
  if (process.env.GMS_INPROCESS_OUTBOX === 'false' || scheduled) return;
  scheduled = true;
  setTimeout(async () => {
    scheduled = false;
    try {
      const { drainOutbox } = await import('@gms/worker/outbox');
      const rt = getRuntime();
      for (let i = 0; i < 5 && (await drainOutbox(rt)) > 0; i++) {
        /* drain a few batches */
      }
    } catch (err) {
      console.error('[outbox] in-process drain failed', (err as Error).message);
    }
  }, 50);
}
