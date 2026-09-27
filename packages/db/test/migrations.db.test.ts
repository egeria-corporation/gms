// SPDX-License-Identifier: AGPL-3.0-only
// Migrations apply cleanly from zero, are recorded in gms_meta.schema_migrations, re-running is a
// no-op, and editing an applied migration is detected.
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dropDatabase, ensureDatabase, listMigrations, migrate } from '../src/migrate';
import { testServerUrl } from '../src/testing';

let url: string;

beforeAll(async () => {
  const u = new URL(testServerUrl());
  u.pathname = `/gms_migrations_${randomBytes(5).toString('hex')}`;
  url = u.toString();
  await ensureDatabase(url);
});

afterAll(async () => {
  if (url) await dropDatabase(url);
});

async function query<T extends pg.QueryResultRow>(text: string, values: unknown[] = []): Promise<T[]> {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    return (await c.query<T>(text, values)).rows;
  } finally {
    await c.end();
  }
}

describe('migrations', () => {
  const files = listMigrations();

  it('the migration directory is well-formed (unique, ordered versions; SPDX headers)', () => {
    expect(files.length).toBeGreaterThan(0);
    const versions = files.map((f) => f.version);
    expect(new Set(versions).size).toBe(versions.length);
    expect([...versions].sort()).toEqual(versions);
    for (const f of files) expect(f.sql.startsWith('-- SPDX-License-Identifier: AGPL-3.0-only')).toBe(true);
  });

  it('apply cleanly from zero on a fresh database', async () => {
    const res = await migrate({ url, shim: 'auto' });
    expect(res.applied).toEqual(files.map((f) => f.version));
  });

  it('are recorded in gms_meta.schema_migrations with their checksums', async () => {
    const rows = await query<{ version: string; name: string; checksum: string }>(
      'select version, name, checksum from gms_meta.schema_migrations order by version',
    );
    expect(rows).toEqual(files.map((f) => ({ version: f.version, name: f.name, checksum: f.checksum })));
  });

  it('re-running migrate() is a no-op', async () => {
    const before = await query<{ n: string }>('select count(*)::text as n from gms_meta.schema_migrations');
    expect(await migrate({ url, shim: 'auto' })).toEqual({ applied: [] });
    expect(await migrate({ url, shim: 'auto' })).toEqual({ applied: [] });
    expect(await query<{ n: string }>('select count(*)::text as n from gms_meta.schema_migrations')).toEqual(before);
  });

  it('refuses to run when an applied migration was edited (forward-only)', async () => {
    const last = files[files.length - 1]!;
    await query('update gms_meta.schema_migrations set checksum = $1 where version = $2', ['tampered', last.version]);
    try {
      await expect(migrate({ url, shim: 'auto' })).rejects.toThrow(/changed after it was applied/);
    } finally {
      await query('update gms_meta.schema_migrations set checksum = $1 where version = $2', [last.checksum, last.version]);
    }
    expect(await migrate({ url, shim: 'auto' })).toEqual({ applied: [] });
  });

  it('leaves every public and gms_private table with RLS enabled', async () => {
    const rows = await query<{ name: string }>(`
      select n.nspname || '.' || c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname in ('public', 'gms_private') and c.relkind in ('r', 'p') and not c.relrowsecurity`);
    expect(rows).toEqual([]);
  });
});
