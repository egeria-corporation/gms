// SPDX-License-Identifier: AGPL-3.0-only
// The RLS matrix: every public table x every principal x {select, insert, update, delete},
// asserted exactly against packages/db/test/rls-expectations.ts. Every probe rolls back.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from '../src/client';
import { createTestDatabase, type TestDatabase } from '../src/testing';
import { MATRIX, OPS, assertionCount, type Op, type TableSpec } from './rls-expectations';
import { probeOp, tableMeta, type Outcome } from './rls-harness';
import { PRINCIPALS, buildWorld, type Principal, type World } from './world';

let t: TestDatabase;
let w: World;

beforeAll(async () => {
  t = await createTestDatabase('gms_rls_matrix');
  w = await buildWorld(t.db);
});

afterAll(async () => {
  await t?.drop();
});

type Matrix = Partial<Record<Op, Record<Principal, Outcome>>>;

function expected(spec: TableSpec): Matrix {
  const ops = spec.kind === 'view' ? (['select'] as const) : OPS;
  const out: Matrix = {};
  for (const op of ops) {
    out[op] = Object.fromEntries(PRINCIPALS.map((p) => [p, spec.allow[op].includes(p) ? 'allowed' : 'denied'])) as Record<Principal, Outcome>;
  }
  return out;
}

async function actual(spec: TableSpec): Promise<Matrix> {
  const meta = await tableMeta(t.db, w, spec);
  const ops = spec.kind === 'view' ? (['select'] as const) : OPS;
  const out: Matrix = {};
  for (const op of ops) {
    const results = await Promise.all(PRINCIPALS.map(async (p) => [p, await probeOp(t.db, w, spec, meta, op, p)] as const));
    out[op] = Object.fromEntries(results) as Record<Principal, Outcome>;
  }
  return out;
}

describe('RLS matrix', () => {
  it(`declares ${assertionCount()} allow/deny assertions over ${MATRIX.length} relations`, () => {
    expect(new Set(MATRIX.map((s) => s.table)).size).toBe(MATRIX.length);
    for (const s of MATRIX) {
      for (const op of OPS) for (const p of s.allow[op]) expect(PRINCIPALS).toContain(p);
    }
  });

  for (const spec of MATRIX) {
    it(`${spec.table}`, async () => {
      expect(await actual(spec)).toEqual(expected(spec));
    });
  }
});

describe('RLS coverage', () => {
  it('RLS is enabled on every table in public and gms_private', async () => {
    const r = await sql<{ name: string }>`
      select n.nspname || '.' || c.relname as name
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname in ('public', 'gms_private') and c.relkind in ('r', 'p') and not c.relrowsecurity
      order by 1`.execute(t.db);
    expect(r.rows.map((x) => x.name)).toEqual([]);
  });

  it('every public table and view has an entry in the RLS matrix', async () => {
    const r = await sql<{ name: string }>`
      select c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm') order by 1`.execute(t.db);
    const inDb = r.rows.map((x) => x.name);
    const covered = new Set(MATRIX.map((s) => s.table));
    expect(inDb.filter((n) => !covered.has(n))).toEqual([]);
    expect([...covered].filter((n) => !inDb.includes(n))).toEqual([]);
  });

  it('world.ts seeds a workspace-A row for every matrix entry', () => {
    expect(MATRIX.filter((s) => !w.rows[s.table]).map((s) => s.table)).toEqual([]);
  });

  it("Supabase's anon/authenticated roles have no privileges on public tables, views or sequences", async () => {
    const r = await sql<{ grantee: string; name: string; privilege: string }>`
      select g.grantee, g.table_name as name, g.privilege_type as privilege
      from information_schema.role_table_grants g
      where g.table_schema = 'public' and g.grantee in ('anon', 'authenticated')
      union all
      select g.grantee, g.object_name, g.privilege_type
      from information_schema.usage_privileges g
      where g.object_schema = 'public' and g.object_type = 'SEQUENCE' and g.grantee in ('anon', 'authenticated')
      order by 1, 2, 3`.execute(t.db);
    expect(r.rows).toEqual([]);
    // No default privileges that would re-grant on tables created by later migrations.
    const d = await sql<{ acl: string }>`
      select d.defaclacl::text as acl from pg_default_acl d
      join pg_namespace n on n.oid = d.defaclnamespace
      where n.nspname = 'public' and d.defaclacl::text ~ '(^|[{,])(anon|authenticated)='`.execute(t.db);
    expect(d.rows).toEqual([]);
  });

  it('gms request roles have no table privileges in gms_private', async () => {
    const r = await sql<{ name: string }>`
      select table_name as name from information_schema.role_table_grants
      where table_schema = 'gms_private' and grantee in ('gms_anon', 'gms_authenticated', 'PUBLIC')`.execute(t.db);
    expect(r.rows).toEqual([]);
  });
});
