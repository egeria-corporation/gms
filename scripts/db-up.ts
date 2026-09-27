// SPDX-License-Identifier: AGPL-3.0-only
// Starts the database for local development using the first tier that works:
//   1. local Supabase (supabase CLI + Docker)  2. remote dev project (DATABASE_URL/SUPABASE_DB_URL)  3. embedded Postgres.
// Then applies migrations.
import { execSync } from 'node:child_process';
import { databaseUrl, EMBEDDED_URL, loadDotEnv } from '../packages/db/src/env';
import { startEmbedded } from '../packages/db/src/embedded';
import { ensureDatabase, migrate } from '../packages/db/src/migrate';
import { detectDbTier } from './lib/detect';

loadDotEnv();
const log = (m: string) => console.log(`[db:up] ${m}`);
const tier = await detectDbTier();
log(`database tier: ${tier.tier} (${tier.reason})`);
let url = databaseUrl();
if (tier.tier === 'supabase-local') {
  try {
    execSync('supabase start', { stdio: 'inherit' });
  } catch {
    log('supabase start failed; falling back to embedded Postgres');
    tier.tier = 'embedded';
  }
  url = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:54322/postgres';
}
if (tier.tier === 'embedded') {
  await startEmbedded({ log });
  url = process.env.DATABASE_URL ?? EMBEDDED_URL;
  await ensureDatabase(url);
}
const res = await migrate({ url, shim: 'auto', log });
log(res.applied.length ? `applied ${res.applied.length} migration(s)` : 'schema is up to date');
log(`DATABASE_URL=${url.replace(/:[^:@/]+@/, ':****@')}`);
