// SPDX-License-Identifier: AGPL-3.0-or-later
// Runs one RLS probe (principal x table x op) in a transaction that always rolls back.
import { sql, type Database, type RequestClaims, type Tx } from '../src/client';
import type { Op, Row, TableSpec } from './rls-expectations';
import type { Principal, World } from './world';

export type Outcome = 'allowed' | 'denied';

/** Trigger hints that mean "the database refused this on purpose". */
const DENIAL_HINTS = new Set(['append_only', 'immutable_form_version', 'maker_checker', 'cross_workspace_reference', 'scan_status']);

interface PgError {
  code?: string;
  hint?: string;
  message: string;
}

/** RLS / privilege / append-only / immutability refusals count as "denied"; anything else is a test bug. */
export function isDenial(err: unknown): boolean {
  const e = err as PgError;
  if (e?.code === '42501') return true; // insufficient_privilege, RLS WITH CHECK, guard triggers
  if (e?.code === 'P0001' && e.hint && DENIAL_HINTS.has(e.hint)) return true;
  return false;
}

const ROLLBACK = Symbol('rollback');

/**
 * Service-role `prep`, then switch to the principal's request role (exactly like withRls), run `fn`,
 * and roll back.
 */
export async function inRequest<T>(db: Database, claims: RequestClaims, fn: (trx: Tx) => Promise<T>, prep?: string): Promise<T> {
  let out: T | undefined;
  const role = claims.role === 'authenticated' && claims.sub ? 'gms_authenticated' : 'gms_anon';
  try {
    await db.transaction().execute(async (trx) => {
      if (prep) await sql.raw(prep).execute(trx);
      await sql`select set_config('role', ${role}, true), set_config('request.jwt.claims', ${JSON.stringify(claims)}, true)`.execute(trx);
      out = await fn(trx);
      throw ROLLBACK;
    });
  } catch (err) {
    if (err !== ROLLBACK) throw err;
  }
  return out as T;
}

export interface TableMeta {
  pk: string[];
  /** Insertable columns (no generated / GENERATED ALWAYS identity columns). */
  columns: string[];
  seeded: Row | null;
}

export async function tableMeta(db: Database, w: World, spec: TableSpec): Promise<TableMeta> {
  const key = w.rows[spec.table];
  if (!key) throw new Error(`world.ts seeds no matrix row for ${spec.table}`);
  const pk = Object.keys(key);
  if (spec.kind === 'view') return { pk, columns: [], seeded: null };
  const cols = await sql<{ column_name: string }>`
    select column_name from information_schema.columns
    where table_schema = 'public' and table_name = ${spec.table}
      and is_generated = 'NEVER' and coalesce(identity_generation, '') <> 'ALWAYS'
    order by ordinal_position`.execute(db);
  const seeded = await sql<{ j: Row }>`select to_jsonb(t) as j from ${sql.table(`public.${spec.table}`)} t where ${where(key)}`.execute(db);
  if (!seeded.rows[0]) throw new Error(`matrix row for ${spec.table} is missing`);
  return { pk, columns: cols.rows.map((c) => c.column_name), seeded: seeded.rows[0].j };
}

function where(key: Record<string, string>) {
  return sql.join(
    Object.entries(key).map(([c, v]) => sql`${sql.ref(c)}::text = ${v}`),
    sql` and `,
  );
}

export function cloneRow(spec: TableSpec, meta: TableMeta, w: World, principal: Principal): Row {
  let row: Row = { ...meta.seeded };
  if (meta.pk.length === 1 && meta.pk[0] === 'id' && typeof row.id === 'string') row.id = cloneId(spec.table);
  if (spec.clone) row = spec.clone(row, w);
  for (const col of spec.actor ?? []) row[col] = w.userId(principal);
  return row;
}

function cloneId(table: string): string {
  // Deterministic but distinct from any seeded id.
  const hex = Buffer.from(`clone:${table}`).toString('hex').padEnd(32, '0').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** Runs one probe and classifies it. Throws (test bug) on errors that are not a refusal. */
export async function probeOp(db: Database, w: World, spec: TableSpec, meta: TableMeta, op: Op, principal: Principal): Promise<Outcome> {
  const key = w.rows[spec.table]!;
  const t = sql.table(`public.${spec.table}`);
  const claims = w.claims(principal);
  try {
    switch (op) {
      case 'select': {
        const r = await inRequest(db, claims, (trx) => sql`select 1 from ${t} where ${where(key)}`.execute(trx));
        return r.rows.length > 0 ? 'allowed' : 'denied';
      }
      case 'insert': {
        const row = cloneRow(spec, meta, w, principal);
        const cols = sql.join(meta.columns.map((c) => sql.ref(c)));
        const r = await inRequest(
          db,
          claims,
          (trx) =>
            sql`insert into ${t} (${cols}) select ${cols} from jsonb_populate_record(null::${t}, ${JSON.stringify(row)}::jsonb)`.execute(trx),
          spec.prepInsert?.(w),
        );
        return Number(r.numAffectedRows ?? 0) > 0 ? 'allowed' : 'denied';
      }
      case 'update': {
        const set = spec.update ?? 'last_modified_at = now()';
        const r = await inRequest(db, claims, (trx) => sql`update ${t} set ${sql.raw(set)} where ${where(key)}`.execute(trx));
        return Number(r.numAffectedRows ?? 0) > 0 ? 'allowed' : 'denied';
      }
      case 'delete': {
        const r = await inRequest(db, claims, (trx) => sql`delete from ${t} where ${where(key)}`.execute(trx), spec.prepDelete?.(w));
        return Number(r.numAffectedRows ?? 0) > 0 ? 'allowed' : 'denied';
      }
    }
  } catch (err) {
    if (isDenial(err)) return 'denied';
    const e = err as PgError;
    throw new Error(`RLS probe ${spec.table}.${op} as ${principal} failed with a non-RLS error (test bug): [${e.code}] ${e.message}`);
  }
}

// ---------------------------------------------------------------------------------------------
// Multi-step scenario helpers: one service transaction (always rolled back) in which steps switch
// between the service role and request roles, each step isolated by a savepoint.
// ---------------------------------------------------------------------------------------------

/** Runs `fn` in a service transaction that is always rolled back. */
export async function scenario<T>(db: Database, fn: (trx: Tx) => Promise<T>): Promise<T> {
  let out: T | undefined;
  try {
    await db.transaction().execute(async (trx) => {
      out = await fn(trx);
      throw ROLLBACK;
    });
  } catch (err) {
    if (err !== ROLLBACK) throw err;
  }
  return out as T;
}

/** Switches the transaction to a request role with these claims (like withRls). */
export async function actAs(trx: Tx, claims: RequestClaims): Promise<void> {
  const role = claims.role === 'authenticated' && claims.sub ? 'gms_authenticated' : 'gms_anon';
  await sql`select set_config('role', ${role}, true), set_config('request.jwt.claims', ${JSON.stringify(claims)}, true)`.execute(trx);
}

/** Back to the service (migration owner) role. */
export async function actAsService(trx: Tx): Promise<void> {
  await sql`select set_config('role', 'none', true), set_config('request.jwt.claims', '', true)`.execute(trx);
}

/**
 * Runs one step inside a savepoint. Returns 'ok', or the error's hint (when it has one) else its
 * SQLSTATE, e.g. 'payment_ceiling', 'append_only', '42501', '23514'. Returns 'rows:0' when an
 * UPDATE/DELETE matched nothing (RLS-hidden).
 */
export async function attempt(trx: Tx, fn: () => Promise<unknown>): Promise<string> {
  await sql`savepoint step`.execute(trx);
  try {
    const r = (await fn()) as { numAffectedRows?: bigint } | undefined;
    await sql`release savepoint step`.execute(trx);
    if (r && typeof r === 'object' && 'numAffectedRows' in r && r.numAffectedRows !== undefined && Number(r.numAffectedRows) === 0) {
      return 'rows:0';
    }
    return 'ok';
  } catch (err) {
    await sql`rollback to savepoint step`.execute(trx);
    const e = err as PgError;
    if (!e.code) throw err;
    return e.hint || e.code;
  }
}
