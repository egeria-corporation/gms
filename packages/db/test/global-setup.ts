// SPDX-License-Identifier: AGPL-3.0-or-later
// Ensures a Postgres server is reachable for DB tests; starts the embedded one when needed.
import pg from 'pg';
import { loadDotEnv } from '../src/env';
import { startEmbedded } from '../src/embedded';
import { testServerUrl } from '../src/testing';

export default async function setup(): Promise<void> {
  loadDotEnv();
  const url = new URL(testServerUrl());
  url.pathname = '/postgres';
  const c = new pg.Client({ connectionString: url.toString() });
  try {
    await c.connect();
    await c.end();
  } catch {
    await c.end().catch(() => {});
    if (/127\.0\.0\.1|localhost/.test(url.hostname)) {
      await startEmbedded({ port: Number(url.port) || undefined, log: (m) => console.log(`[test:db] ${m}`) });
    } else {
      throw new Error(`test database server ${url.host} is unreachable`);
    }
  }
}
