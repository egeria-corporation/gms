// SPDX-License-Identifier: AGPL-3.0-or-later
// Long-lived worker for local development and self-hosting on a server: graphile-worker with a crontab,
// plus LISTEN gms_outbox so domain events fan out within a second.
import { getRuntime } from '@gms/actions';
import { databaseUrl, loadDotEnv } from '@gms/db';
import { run } from 'graphile-worker';
import pg from 'pg';
import { drainOutbox } from './outbox';
import { CRONTAB, taskList } from './tasks';

loadDotEnv();
const rt = getRuntime();
const connectionString = databaseUrl();

const runner = await run({ connectionString, concurrency: 4, noHandleSignals: false, pollInterval: 2000, taskList: taskList(rt), crontab: CRONTAB });

// Fast path: drain the outbox as soon as a transaction commits an event.
const listener = new pg.Client({ connectionString });
await listener.connect();
let draining = false;
let again = false;
async function kick() {
  if (draining) {
    again = true;
    return;
  }
  draining = true;
  try {
    do {
      again = false;
      while ((await drainOutbox(rt)) > 0) {
        /* keep going */
      }
    } while (again);
  } catch (err) {
    console.error('[worker] outbox drain failed', (err as Error).message);
  } finally {
    draining = false;
  }
}
listener.on('notification', () => void kick());
await listener.query('listen gms_outbox');
void kick();
console.log('[worker] running: graphile-worker + outbox listener');

const stop = async () => {
  await listener.end().catch(() => {});
  await runner.stop();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
await runner.promise;
