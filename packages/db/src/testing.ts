// SPDX-License-Identifier: AGPL-3.0-only
// Test harness: isolated databases per test file, user factories, and RLS helpers.
import { randomBytes, randomUUID } from 'node:crypto';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { withRls, type Database, type RequestClaims, type Tx } from './client';
import { databaseUrl, EMBEDDED_URL } from './env';
import { dropDatabase, ensureDatabase, migrate } from './migrate';
import type { DB } from './types.gen';

export interface TestDatabase {
  url: string;
  db: Database;
  drop: () => Promise<void>;
}

/** Base server URL for test databases (tier 1/3 local, or GMS_TEST_DATABASE_URL). */
export function testServerUrl(): string {
  return process.env.GMS_TEST_DATABASE_URL || (process.env.DATABASE_URL && /127\.0\.0\.1|localhost/.test(process.env.DATABASE_URL) ? process.env.DATABASE_URL : '') || databaseUrl() || EMBEDDED_URL;
}

/** Creates a fresh database with the shim (if needed) and every migration applied. */
export async function createTestDatabase(prefix = 'gms_test'): Promise<TestDatabase> {
  const base = new URL(testServerUrl());
  const name = `${prefix}_${randomBytes(5).toString('hex')}`;
  base.pathname = `/${name}`;
  const url = base.toString();
  await ensureDatabase(url);
  await migrate({ url, shim: 'auto' });
  const pool = new pg.Pool({ connectionString: url, max: 5, options: '-c TimeZone=UTC' });
  const db = new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
  return {
    url,
    db,
    drop: async () => {
      await db.destroy();
      await dropDatabase(url);
    },
  };
}

export interface TestUser {
  id: string;
  email: string;
  name: string;
}

/** Inserts an auth.users row + profile (service privileges). */
export async function createUser(db: Database | Tx, input: { email?: string; name?: string; id?: string } = {}): Promise<TestUser> {
  const id = input.id ?? randomUUID();
  const email = input.email ?? `user-${id.slice(0, 8)}@test.example`;
  const name = input.name ?? `Test ${id.slice(0, 4)}`;
  await sql`insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values (${id}, ${email}, now(), ${JSON.stringify({ full_name: name })}::jsonb)`.execute(db);
  await db
    .insertInto('profiles')
    .values({ id, email, full_name: name })
    .onConflict((oc) => oc.column('id').doUpdateSet({ full_name: name, email }))
    .execute();
  return { id, email, name };
}

export function claimsFor(user: TestUser | null, extra: Partial<RequestClaims> = {}): RequestClaims {
  if (!user) return { role: 'anon' };
  return { role: 'authenticated', sub: user.id, email: user.email, aal: 'aal1', ...extra };
}

/** Runs fn under RLS as `user` (null = anon). Always rolls back so tests never leak writes. */
export async function asUser<T>(db: Database, user: TestUser | null, fn: (trx: Tx) => Promise<T>, extra: Partial<RequestClaims> = {}): Promise<T> {
  const rollback = new Error('__rollback__');
  let result: T | undefined;
  try {
    await withRls(
      claimsFor(user, extra),
      async (trx) => {
        result = await fn(trx);
        throw rollback;
      },
      db,
    );
  } catch (err) {
    if (err !== rollback) throw err;
  }
  return result as T;
}

/** Returns 'allowed' | 'denied' for an RLS-guarded operation (denied = error or 0 rows affected). */
export async function probe(
  db: Database,
  user: TestUser | null,
  fn: (trx: Tx) => Promise<number | bigint | undefined | { numAffectedRows?: bigint; numUpdatedRows?: bigint; numDeletedRows?: bigint } | unknown[]>,
): Promise<'allowed' | 'denied'> {
  try {
    const r = await asUser(db, user, fn);
    if (Array.isArray(r)) return r.length > 0 ? 'allowed' : 'denied';
    if (typeof r === 'number' || typeof r === 'bigint') return Number(r) > 0 ? 'allowed' : 'denied';
    if (r && typeof r === 'object') {
      const o = r as { numAffectedRows?: bigint; numUpdatedRows?: bigint; numDeletedRows?: bigint; numInsertedOrUpdatedRows?: bigint };
      const n = o.numAffectedRows ?? o.numUpdatedRows ?? o.numDeletedRows ?? o.numInsertedOrUpdatedRows ?? 0n;
      return Number(n) > 0 ? 'allowed' : 'denied';
    }
    return 'denied';
  } catch (err) {
    const msg = (err as Error).message;
    if (/row-level security|permission denied|violates|append-only|immutable|cannot|not allowed|42501/i.test(msg)) return 'denied';
    throw err;
  }
}
