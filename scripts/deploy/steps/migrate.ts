// SPDX-License-Identifier: AGPL-3.0-only
// migrate: apply supabase/migrations/*.sql through the Management API, each in its own transaction.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Ctx, Result } from "../core.ts";
import { confirmOrDry, loadState, patchState, res } from "../core.ts";
import { apiMessage, Supabase, supabaseToken } from "../supabase-api.ts";
import { LOGIN_MESSAGE } from "./supabase.ts";

const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;

export interface MigrationFile {
  file: string;
  version: string;
  name: string;
}
export function migrationFiles(root: string): MigrationFile[] {
  return readdirSync(join(root, "supabase", "migrations"))
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((file) => {
      const m = /^(\d+)_(.*)\.sql$/.exec(file);
      return { file, version: m?.[1] ?? file.replace(/\.sql$/, ""), name: m?.[2] ?? file };
    });
}

/** Wrap one migration so it runs and is recorded atomically. */
export function wrapMigration(m: MigrationFile, sql: string): string {
  return `begin;\n${sql}\n;\ninsert into supabase_migrations.schema_migrations (version, name, statements) values (${lit(m.version)}, ${lit(m.name)}, array[]::text[]) on conflict (version) do nothing;\ncommit;`;
}

const PRELUDE = "create schema if not exists supabase_migrations; create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text);";

export interface Applied {
  versions: Set<string>;
  names: Set<string>;
  hasTracking: boolean;
  publicTables: number;
}

/** What the database already records. Read-only. */
export async function readApplied(api: Supabase, ref: string): Promise<Applied | string> {
  const probe = await api.query<{ sb: boolean; gm: boolean; tables: number | string }>(
    ref,
    "select to_regclass('supabase_migrations.schema_migrations') is not null as sb, to_regclass('gms_meta.schema_migrations') is not null as gm, (select count(*) from pg_tables where schemaname = 'public') as tables",
  );
  if (probe.status >= 300 || !Array.isArray(probe.body) || !probe.body[0]) return `could not read the database (${apiMessage(probe.body)})`;
  const { sb, gm, tables } = probe.body[0];
  const out: Applied = { versions: new Set(), names: new Set(), hasTracking: false, publicTables: Number(tables) };
  if (sb) {
    const r = await api.query<{ version: string }>(ref, "select version from supabase_migrations.schema_migrations");
    if (r.status >= 300 || !Array.isArray(r.body)) return `could not read supabase_migrations.schema_migrations (${apiMessage(r.body)})`;
    for (const row of r.body) out.versions.add(String(row.version));
  }
  if (gm) {
    const r = await api.query<{ name: string }>(ref, "select name from gms_meta.schema_migrations");
    if (r.status >= 300 || !Array.isArray(r.body)) return `could not read gms_meta.schema_migrations (${apiMessage(r.body)})`;
    for (const row of r.body) out.names.add(String(row.name));
  }
  out.hasTracking = out.versions.size + out.names.size > 0;
  return out;
}

/** A migration counts as applied if recorded in either table. */
export const isApplied = (m: MigrationFile, a: Applied) => a.versions.has(m.version) || a.names.has(m.file);

export async function migrate(ctx: Ctx): Promise<Result> {
  const ref = loadState(ctx).supabase?.ref as string | undefined;
  if (!ref) return res("needs_input", "There is no Supabase project yet. Run the supabase step first.", {}, "supabase");
  const token = supabaseToken(ctx);
  if (!token) return res("needs_login", LOGIN_MESSAGE, {}, null);
  const api = new Supabase(ctx, token);

  const files = migrationFiles(ctx.root);
  const applied = await readApplied(api, ref);
  if (typeof applied === "string") return res("error", `Cannot check which migrations are applied: ${applied}.`, {}, null);
  const pending = files.filter((m) => !isApplied(m, applied));
  if (pending.length === 0) {
    if (!ctx.dryRun) patchState(ctx, { migrations: { total: files.length, latest: files.at(-1)?.file ?? null } });
    return res("skipped", `The database is up to date (${files.length} migrations).`, { total: files.length }, "auth");
  }

  // Not the GMS's database: tables but no history, or a history that names migrations this repository does not have.
  const knownVersions = new Set(files.map((m) => m.version));
  const knownFiles = new Set(files.map((m) => m.file));
  const strangers = [...applied.versions].filter((v) => !knownVersions.has(v)).length + [...applied.names].filter((x) => !knownFiles.has(x)).length;
  const foreign = (!applied.hasTracking && applied.publicTables > 0) || strangers > 0;
  if (foreign && !ctx.dryRun && ctx.flags["allow-existing-tables"] !== true) {
    return res("needs_confirmation", `This database does not look like a fresh GMS database: ${strangers > 0 ? `its migration history holds ${strangers} entr${strangers === 1 ? "y" : "ies"} this repository does not have` : `it already holds ${applied.publicTables} table(s) the GMS did not create and has no migration history`}. Applying the GMS migrations on top of another app's schema can break both. If that is what you want, re-run with --allow-existing-tables --yes. Otherwise use a new Supabase project.`, { pending: pending.map((m) => m.file) }, "migrate");
  }
  const plan = [`apply ${pending.length} migration(s) (${pending[0]!.file}${pending.length > 1 ? ` to ${pending.at(-1)!.file}` : ""}), each in its own transaction`];
  if (foreign) plan.unshift(`WARNING: this database is not a fresh GMS database (${strangers} unknown history entries, ${applied.publicTables} tables in public)`);
  const gate = confirmOrDry(ctx, "migrate", plan, { pending: pending.map((m) => m.file), existingTables: foreign ? applied.publicTables : 0 });
  if (gate) return gate;

  const prelude = await api.query(ref, PRELUDE);
  if (prelude.status >= 300) return res("error", `Could not create the migration history table: ${apiMessage(prelude.body)}.`, {}, null);
  const done: string[] = [];
  for (const m of pending) {
    ctx.log(`Applying ${m.file}`);
    const r = await api.query(ref, wrapMigration(m, readFileSync(join(ctx.root, "supabase", "migrations", m.file), "utf8")));
    if (r.status >= 300) {
      await api.query(ref, "rollback;"); // leave no aborted transaction behind on a pooled connection
      return res("error", `${m.file} failed and was rolled back: ${apiMessage(r.body)}. ${done.length} earlier migration(s) in this run were kept. Fix the cause and re-run; it resumes here.`, { failed: m.file, applied: done }, "migrate");
    }
    done.push(m.file);
  }
  patchState(ctx, { migrations: { total: files.length, latest: files.at(-1)?.file ?? null } });
  return res("ok", `Applied ${done.length} migration(s).`, { applied: done, total: files.length }, "auth");
}
