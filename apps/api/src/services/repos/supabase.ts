// SPDX-License-Identifier: AGPL-3.0-only
// Supabase-backed repositories over the service-role client. The service role bypasses RLS, so
// every service passes the workspace in `where`; `authorize()` has already checked the caller.
import type { DbClient, TableName } from "@gms/db";
import { RepoError, type FindOptions, type Insert, type Repos, type Row, type TableRepo, type Update, type Where } from "./types.ts";

interface PgError {
  code?: string;
  message: string;
}

function fail(table: string, op: string, error: PgError): never {
  // 23505 unique_violation; 23503 foreign_key_violation; 23514 check_violation; 23502 not_null_violation; 22xxx data exceptions.
  if (error.code === "23505") throw new RepoError("conflict", `${table}: already exists`);
  if (error.code === "23503" || error.code === "23514" || error.code === "23502" || error.code?.startsWith("22")) throw new RepoError("invalid", `${table}: ${error.message}`);
  throw new RepoError("unavailable", `${table} ${op} failed`);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the PostgREST builder's generics do not survive a table-generic wrapper
type Builder = any;

function filter(b: Builder, where: Record<string, unknown>, notNull: readonly string[] = []): Builder {
  for (const [k, v] of Object.entries(where)) {
    if (v === undefined) continue;
    if (v === null) b = b.is(k, null);
    else if (Array.isArray(v)) b = b.in(k, v);
    else b = b.eq(k, v);
  }
  for (const k of notNull) b = b.not(k, "is", null);
  return b;
}

class SupabaseTable<T extends TableName> implements TableRepo<T> {
  constructor(
    private readonly db: DbClient,
    private readonly name: T,
  ) {}

  private from(): Builder {
    return this.db.from(this.name);
  }

  async find(where: Where<T>, opts: FindOptions<T> = {}) {
    let b = filter(this.from().select("*"), where, opts.notNull);
    if (opts.orderBy) b = b.order(opts.orderBy, { ascending: opts.ascending !== false });
    if (opts.limit !== undefined) {
      const offset = opts.offset ?? 0;
      b = b.range(offset, offset + opts.limit - 1);
    }
    const { data, error } = await b;
    if (error) fail(this.name, "read", error);
    return (data ?? []) as Row<T>[];
  }
  async count(where: Where<T>, opts: Pick<FindOptions<T>, "notNull"> = {}) {
    const { count, error } = await filter(this.from().select("*", { count: "exact", head: true }), where, opts.notNull);
    if (error) fail(this.name, "count", error);
    return count ?? 0;
  }
  async one(where: Where<T>) {
    return (await this.find(where, { limit: 1 }))[0] ?? null;
  }
  async insert(row: Insert<T>) {
    const { data, error } = await this.from().insert(row).select("*").single();
    if (error) fail(this.name, "insert", error);
    return data as Row<T>;
  }
  async update(where: Where<T>, patch: Update<T>) {
    const { data, error } = await filter(this.from().update(patch), where).select("*");
    if (error) fail(this.name, "update", error);
    return (data ?? []) as Row<T>[];
  }
  async remove(where: Where<T>) {
    const { data, error } = await filter(this.from().delete(), where).select("*");
    if (error) fail(this.name, "delete", error);
    return (data ?? []).length;
  }
}

export class SupabaseRepos implements Repos {
  constructor(private readonly db: DbClient) {}
  table<T extends TableName>(name: T): TableRepo<T> {
    return new SupabaseTable(this.db, name);
  }
}
