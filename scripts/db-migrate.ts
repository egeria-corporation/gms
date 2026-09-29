// SPDX-License-Identifier: AGPL-3.0-or-later
import { databaseUrl, loadDotEnv } from '../packages/db/src/env';
import { dropDatabase, ensureDatabase, migrate } from '../packages/db/src/migrate';

loadDotEnv();
const url = databaseUrl();
if (process.argv.includes('--reset')) {
  if (!/127\.0\.0\.1|localhost/.test(url)) {
    console.error('[db:reset] refusing to drop a non-local database');
    process.exit(1);
  }
  await dropDatabase(url);
}
await ensureDatabase(url);
const res = await migrate({ url, shim: 'auto', log: (m) => console.log(`[migrate] ${m}`) });
console.log(`[migrate] ${res.applied.length} applied`);
