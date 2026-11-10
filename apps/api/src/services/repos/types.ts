// SPDX-License-Identifier: AGPL-3.0-only
// Data access port for the service layer. One generic repository per table, typed against the
// generated schema (`@gms/db`), with two implementations: memory (unit tests) and Supabase.
// Services are the only callers; routes and MCP tools never touch a repository directly.
import type { TableName, Tables, TablesInsert, TablesUpdate } from "@gms/db";

export type Row<T extends TableName> = Tables<T>;
export type Insert<T extends TableName> = TablesInsert<T>;
export type Update<T extends TableName> = TablesUpdate<T>;

/**
 * Equality filter. A scalar matches the column, `null` matches SQL NULL, and an array of scalars
 * matches any of them (SQL IN). Array-typed columns cannot be filtered.
 */
export type Where<T extends TableName> = { [K in keyof Row<T>]?: Row<T>[K] | readonly NonNullable<Row<T>[K]>[] };

export interface FindOptions<T extends TableName> {
  orderBy?: keyof Row<T> & string;
  ascending?: boolean;
  limit?: number;
  offset?: number;
  /** Columns that must not be NULL (e.g. `published_at`). */
  notNull?: readonly (keyof Row<T> & string)[];
}

export interface TableRepo<T extends TableName> {
  find(where: Where<T>, opts?: FindOptions<T>): Promise<Row<T>[]>;
  count(where: Where<T>, opts?: Pick<FindOptions<T>, "notNull">): Promise<number>;
  one(where: Where<T>): Promise<Row<T> | null>;
  insert(row: Insert<T>): Promise<Row<T>>;
  /** Returns the rows after the update; an empty array means nothing matched. */
  update(where: Where<T>, patch: Update<T>): Promise<Row<T>[]>;
  remove(where: Where<T>): Promise<number>;
}

export interface Repos {
  table<T extends TableName>(name: T): TableRepo<T>;
}

/** A write the database refused: unique (`conflict`) or check/foreign-key (`invalid`) violation. */
export class RepoError extends Error {
  constructor(
    public readonly kind: "conflict" | "invalid" | "unavailable",
    message: string,
  ) {
    super(message);
    this.name = "RepoError";
  }
}
