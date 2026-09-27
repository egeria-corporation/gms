// SPDX-License-Identifier: AGPL-3.0-only
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { repoRoot } from './env';

export interface MigrateOptions {
  url: string;
  /** Apply compat/supabase-shim.sql when the database is plain Postgres (no auth schema). */
  shim?: 'auto' | 'always' | 'never';
  log?: (msg: string) => void;
}

export interface MigrationFile {
  version: string;
  name: string;
  path: string;
  sql: string;
  checksum: string;
}

export function listMigrations(dir = join(repoRoot(), 'supabase', 'migrations')): MigrationFile[] {
  return readdirSync(dir)
    .filter((f) => /^\d{14}_.+\.sql$/.test(f))
    .sort()
    .map((f) => {
      const sqlText = readFileSync(join(dir, f), 'utf8');
      return {
        version: f.slice(0, 14),
        name: f.slice(15, -4),
        path: join(dir, f),
        sql: sqlText,
        checksum: createHash('sha256').update(sqlText).digest('hex'),
      };
    });
}

/**
 * Forward-only migration runner. Records applied versions in gms_meta.schema_migrations and,
 * when present (real Supabase), also in supabase_migrations.schema_migrations so `supabase db push`
 * agrees about what is applied.
 */
export async function migrate(opts: MigrateOptions): Promise<{ applied: string[] }> {
  const log = opts.log ?? (() => {});
  const client = new pg.Client({ connectionString: opts.url });
  await client.connect();
  try {
    const hasAuth = await client.query(`select 1 from pg_namespace where nspname = 'auth'`);
    const needShim = opts.shim === 'always' || (opts.shim !== 'never' && hasAuth.rowCount === 0);
    if (needShim) {
      log('applying compat/supabase-shim.sql (plain Postgres tier)');
      await client.query(readFileSync(join(repoRoot(), 'compat', 'supabase-shim.sql'), 'utf8'));
    }
    await client.query(`create schema if not exists gms_meta;
      create table if not exists gms_meta.schema_migrations (
        version text primary key, name text not null, checksum text not null, applied_at timestamptz not null default now())`);
    const supa = await client.query(
      `select 1 from information_schema.tables where table_schema = 'supabase_migrations' and table_name = 'schema_migrations'`,
    );
    const done = new Map(
      (await client.query<{ version: string; checksum: string }>('select version, checksum from gms_meta.schema_migrations')).rows.map(
        (r) => [r.version, r.checksum],
      ),
    );
    if (supa.rowCount) {
      const supaDone = await client.query<{ version: string }>('select version from supabase_migrations.schema_migrations');
      for (const r of supaDone.rows) if (!done.has(r.version)) done.set(r.version, 'supabase');
    }
    const applied: string[] = [];
    for (const m of listMigrations()) {
      const prev = done.get(m.version);
      if (prev) {
        if (prev !== 'supabase' && prev !== m.checksum) {
          throw new Error(
            `migration ${m.version}_${m.name} changed after it was applied. Migrations are forward-only: add a new migration instead.`,
          );
        }
        continue;
      }
      log(`applying ${m.version}_${m.name}`);
      await client.query('begin');
      try {
        await client.query(m.sql);
        await client.query('insert into gms_meta.schema_migrations (version, name, checksum) values ($1, $2, $3)', [
          m.version,
          m.name,
          m.checksum,
        ]);
        if (supa.rowCount) {
          await client.query(
            'insert into supabase_migrations.schema_migrations (version, name) values ($1, $2) on conflict do nothing',
            [m.version, m.name],
          );
        }
        await client.query('commit');
      } catch (err) {
        await client.query('rollback');
        const e = err as Error & { position?: string };
        throw new Error(`migration ${m.version}_${m.name} failed: ${e.message}${e.position ? ` (at char ${e.position})` : ''}`);
      }
      applied.push(m.version);
    }
    return { applied };
  } finally {
    await client.end();
  }
}

/** Creates a database if it does not exist, using a maintenance connection to `postgres`. */
export async function ensureDatabase(url: string): Promise<void> {
  const u = new URL(url);
  const name = decodeURIComponent(u.pathname.slice(1));
  u.pathname = '/postgres';
  const client = new pg.Client({ connectionString: u.toString() });
  await client.connect();
  try {
    const exists = await client.query('select 1 from pg_database where datname = $1', [name]);
    if (!exists.rowCount) await client.query(`create database "${name.replace(/"/g, '""')}"`);
  } finally {
    await client.end();
  }
}

export async function dropDatabase(url: string): Promise<void> {
  const u = new URL(url);
  const name = decodeURIComponent(u.pathname.slice(1));
  u.pathname = '/postgres';
  const client = new pg.Client({ connectionString: u.toString() });
  await client.connect();
  try {
    await client.query(`drop database if exists "${name.replace(/"/g, '""')}" with (force)`);
  } finally {
    await client.end();
  }
}
