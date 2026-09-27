// SPDX-License-Identifier: AGPL-3.0-only
// `pnpm run upgrade` — after `git pull && pnpm i`: applies forward-only migrations, then checks that the schema
// is safe to serve (RLS on every table, no privileges leaked to Supabase's anon/authenticated roles, the
// request roles exist) and that the database has what this version expects. Exits non-zero on any failure.
import pg from 'pg';
import { databaseUrl, loadDotEnv } from '../packages/db/src/env';
import { listMigrations, migrate } from '../packages/db/src/migrate';

loadDotEnv();
const url = databaseUrl();
const failures: string[] = [];
const ok = (m: string) => console.log(`  ✓ ${m}`);
const fail = (m: string) => {
  failures.push(m);
  console.log(`  ✗ ${m}`);
};

console.log('GMS upgrade');
console.log('1. Migrations');
const res = await migrate({ url, shim: 'auto', log: (m) => console.log(`  · ${m}`) });
ok(res.applied.length ? `${res.applied.length} migration(s) applied` : 'already up to date');

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  console.log('2. Schema checks');
  const expected = listMigrations().map((m) => m.version);
  const applied = new Set((await client.query<{ version: string }>('select version from gms_meta.schema_migrations')).rows.map((r) => r.version));
  const missing = expected.filter((v) => !applied.has(v));
  if (missing.length) fail(`migrations not recorded: ${missing.join(', ')}`);
  else ok(`${expected.length} migrations recorded`);

  const noRls = await client.query<{ name: string }>(
    `select n.nspname || '.' || c.relname as name
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where c.relkind in ('r', 'p') and n.nspname = 'public' and not c.relrowsecurity
      order by 1`,
  );
  if (noRls.rowCount) fail(`tables without row-level security: ${noRls.rows.map((r) => r.name).join(', ')}`);
  else ok('row-level security is on for every public table');

  const noPolicy = await client.query<{ name: string }>(
    `select n.nspname || '.' || c.relname as name
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where c.relkind in ('r', 'p') and n.nspname = 'public'
        and not exists (select 1 from pg_policy p where p.polrelid = c.oid)
        and has_table_privilege('gms_authenticated', c.oid, 'select')
      order by 1`,
  );
  // RLS on + no policies = deny all for request roles: these are service-only tables (outbox, OAuth protocol
  // state, rate limits, idempotency keys, dev mail capture).
  ok(`${noPolicy.rowCount} service-only table(s) deny request roles by default${noPolicy.rowCount ? ` (${noPolicy.rows.map((r) => r.name.replace('public.', '')).join(', ')})` : ''}`);

  const roles = await client.query<{ rolname: string }>(`select rolname from pg_roles where rolname in ('gms_authenticated', 'gms_anon')`);
  if (roles.rowCount !== 2) fail('request roles gms_authenticated / gms_anon are missing');
  else ok('request roles exist');

  const leaked = await client.query<{ grantee: string; table_name: string }>(
    `select distinct grantee, table_name from information_schema.role_table_grants
      where table_schema = 'public' and grantee in ('anon', 'authenticated') order by 1, 2`,
  );
  if (leaked.rowCount) fail(`Supabase Data API roles have privileges on GMS tables: ${leaked.rows.map((r) => `${r.grantee}→${r.table_name}`).join(', ')}`);
  else ok('Supabase anon/authenticated roles have no access to GMS tables');

  const audit = await client.query<{ n: number }>(
    `select count(*)::int as n from pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relname = 'audit_log' and not t.tgisinternal`,
  );
  if (!audit.rows[0]?.n) fail('audit_log is missing its append-only trigger');
  else ok('audit log is append-only');
} finally {
  await client.end();
}

console.log('3. Environment');
console.log('  · run `pnpm run doctor` to see which adapters are real or fake (writes ENVIRONMENT.md)');

if (failures.length) {
  console.error(`\nUpgrade checks failed (${failures.length}). Fix these before serving traffic.`);
  process.exit(1);
}
console.log('\nUpgrade complete.');
