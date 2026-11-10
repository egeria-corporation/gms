// SPDX-License-Identifier: AGPL-3.0-only
// Bring a database up to the current schema, and optionally load the demo seed, in one command.
//
//   node scripts/bootstrap-supabase.ts --db-url "postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres" [--seed]
//
// Applies supabase/migrations/*.sql in order with `psql`, each in one transaction, and records
// what it applied in `gms_meta.schema_migrations`, so it is safe to run again after an upgrade.
// `--seed` loads supabase/seed.sql (fictional funders and applicants; never use it in production).
// `--plain-postgres` first creates the few Supabase objects the schema expects (the `auth` schema,
// `auth.uid()`, the `anon` / `authenticated` / `service_role` roles) for a Postgres that is not
// Supabase: local development and CI only.
//
// The connection string can also come from DATABASE_URL. It is never printed.
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const value = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

function fail(message: string): never {
  console.error(`bootstrap: ${message}`);
  process.exit(1);
}

const dbUrl = value("db-url") ?? process.env.DATABASE_URL;
if (!dbUrl) fail('pass --db-url "<connection string>" or set DATABASE_URL');
if (spawnSync("psql", ["--version"]).status !== 0) fail("psql is not installed (it ships with the PostgreSQL client tools)");

// The connection reaches psql as PG* environment variables, so the password never appears in a
// process listing.
let parsed: URL;
try {
  parsed = new URL(dbUrl);
} catch {
  fail("the connection string is not a valid postgresql:// URL");
}
if (!/^postgres(ql)?:$/.test(parsed.protocol)) fail("the connection string must start with postgresql://");
const env: NodeJS.ProcessEnv = {
  ...process.env,
  PGHOST: parsed.hostname,
  PGPORT: parsed.port || "5432",
  PGUSER: decodeURIComponent(parsed.username),
  PGPASSWORD: decodeURIComponent(parsed.password),
  PGDATABASE: decodeURIComponent(parsed.pathname.replace(/^\//, "")) || "postgres",
  PGCONNECT_TIMEOUT: "15",
  ...(parsed.searchParams.get("sslmode") ? { PGSSLMODE: parsed.searchParams.get("sslmode")! } : {}),
};
function psql(extra: string[], input?: string): { ok: boolean; out: string; err: string } {
  const r = spawnSync("psql", ["--no-psqlrc", "--quiet", "--tuples-only", "--no-align", "-v", "ON_ERROR_STOP=1", ...extra], { env, input, encoding: "utf8" });
  return { ok: r.status === 0, out: (r.stdout ?? "").trim(), err: (r.stderr ?? "").trim() };
}

const PLAIN_POSTGRES = `
do $$ begin
  if not exists (select from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key, email text, aud text, role text, raw_user_meta_data jsonb, created_at timestamptz not null default now());
create or replace function auth.uid() returns uuid language sql stable as
  $f$ select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid $f$;
create or replace function auth.jwt() returns jsonb language sql stable as
  $f$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $f$;
grant usage on schema auth to anon, authenticated, service_role;
`;

const ping = psql(["-c", "select 1"]);
if (!ping.ok) fail(`could not connect to the database: ${ping.err.split("\n")[0] ?? "connection failed"}`);

if (flag("plain-postgres")) {
  const r = psql([], PLAIN_POSTGRES);
  if (!r.ok) fail(`could not prepare a plain Postgres: ${r.err.split("\n")[0]}`);
  console.log("Prepared plain Postgres (auth schema and Supabase roles).");
}

const meta = psql([], "create schema if not exists gms_meta; create table if not exists gms_meta.schema_migrations (name text primary key, applied_at timestamptz not null default now());");
if (!meta.ok) fail(`could not create the migrations table: ${meta.err.split("\n")[0]}`);
const applied = new Set(psql(["-c", "select name from gms_meta.schema_migrations"]).out.split("\n").filter(Boolean));

const dir = join(root, "supabase", "migrations");
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
let ran = 0;
for (const file of files) {
  if (applied.has(file)) continue;
  const r = psql(["--single-transaction", "-f", join(dir, file), "-c", `insert into gms_meta.schema_migrations (name) values ('${file.replace(/'/g, "''")}')`]);
  if (!r.ok) fail(`${file} failed and was rolled back:\n${r.err.split("\n").slice(0, 6).join("\n")}`);
  console.log(`Applied ${file}`);
  ran++;
}
console.log(ran ? `${ran} migration(s) applied; ${files.length} total.` : `Schema is up to date (${files.length} migrations).`);

if (flag("seed")) {
  const count = psql(["-c", "select count(*) from public.workspaces"]);
  if (count.ok && Number(count.out) > 0 && !flag("force-seed")) {
    console.log("Seed skipped: this database already has workspaces. Pass --force-seed to load it anyway.");
  } else {
    // The seed file opens and commits its own transaction.
    const r = psql(["-f", join(root, "supabase", "seed.sql")]);
    if (!r.ok) fail(`seed failed and was rolled back:\n${r.err.split("\n").slice(0, 6).join("\n")}`);
    console.log("Seed loaded (fictional demo data).");
  }
}
