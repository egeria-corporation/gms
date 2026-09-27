// SPDX-License-Identifier: AGPL-3.0-only
import { Kysely, PostgresDialect, sql, type Transaction } from 'kysely';
import pg from 'pg';
import { databaseUrl } from './env';
import type { DB } from './types.gen';

// Type parsers: money is bigint cents -> number (safe to ±9e15 cents); timestamps -> ISO strings; dates stay strings.
pg.types.setTypeParser(20, (v) => Number(v)); // int8
pg.types.setTypeParser(1700, (v) => Number(v)); // numeric
pg.types.setTypeParser(1082, (v) => v); // date
pg.types.setTypeParser(1114, (v) => new Date(v + 'Z').toISOString()); // timestamp
pg.types.setTypeParser(1184, (v) => new Date(v).toISOString()); // timestamptz
const INT8_ARRAY = 1016 as unknown as Parameters<typeof pg.types.setTypeParser>[0];
const INT4_ARRAY = 1007 as unknown as Parameters<typeof pg.types.getTypeParser>[0];
pg.types.setTypeParser(INT8_ARRAY, (v: string) => (pg.types.getTypeParser(INT4_ARRAY) as (s: string) => number[])(v)); // int8[] as numbers

export type Database = Kysely<DB>;
export type Tx = Transaction<DB>;

const pools = new Map<string, pg.Pool>();
const dbs = new Map<string, Database>();

export function getPool(url = databaseUrl()): pg.Pool {
  let pool = pools.get(url);
  if (!pool) {
    pool = new pg.Pool({
      connectionString: url,
      max: Number(process.env.GMS_DB_POOL_MAX ?? 10),
      idleTimeoutMillis: 10_000,
      options: '-c TimeZone=UTC',
    });
    pool.on('error', (err) => {
      console.error('[db] idle client error', err.message);
    });
    pools.set(url, pool);
  }
  return pool;
}

/** The raw (service) Kysely instance. Only the action executor, workers and webhooks may use it directly. */
export function getDb(url = databaseUrl()): Database {
  let db = dbs.get(url);
  if (!db) {
    db = new Kysely<DB>({ dialect: new PostgresDialect({ pool: getPool(url) }) });
    dbs.set(url, db);
  }
  return db;
}

export async function closeDb(url?: string): Promise<void> {
  const urls = url ? [url] : [...pools.keys()];
  for (const u of urls) {
    const db = dbs.get(u);
    dbs.delete(u);
    const pool = pools.get(u);
    pools.delete(u);
    if (db) await db.destroy();
    else if (pool) await pool.end();
  }
}

/** JWT-like claims that drive RLS. These must come from a verified session or token. */
export interface RequestClaims {
  sub?: string;
  role: 'anon' | 'authenticated';
  email?: string;
  aal?: 'aal1' | 'aal2';
  session_id?: string;
  /** Agent/OAuth client id when an agent acts for the user. */
  client_id?: string;
  scope?: string;
  [key: string]: unknown;
}

export const ANON_CLAIMS: RequestClaims = { role: 'anon' };

/**
 * Runs `fn` in a transaction with RLS enforced for the given claims:
 *   set_config('role', 'gms_authenticated' | 'gms_anon', true)
 *   set_config('request.jwt.claims', <claims json>, true)
 * This mirrors PostgREST, so gms.uid()/auth.uid() work inside policies.
 */
export async function withRls<T>(
  claims: RequestClaims,
  fn: (trx: Tx) => Promise<T>,
  db: Database = getDb(),
): Promise<T> {
  const role = claims.role === 'authenticated' && claims.sub ? 'gms_authenticated' : 'gms_anon';
  return db.transaction().execute(async (trx) => {
    await sql`select set_config('role', ${role}, true), set_config('request.jwt.claims', ${JSON.stringify(claims)}, true)`.execute(
      trx,
    );
    return fn(trx);
  });
}

/** Service transaction (bypasses RLS). Use only from the executor with a system actor, workers, and webhooks. */
export async function withService<T>(fn: (trx: Tx) => Promise<T>, db: Database = getDb()): Promise<T> {
  return db.transaction().execute(fn);
}

export { sql };
