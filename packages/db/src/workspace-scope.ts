// SPDX-License-Identifier: AGPL-3.0-only
import type { DbClient } from "./client.ts";
import type { Database, TablesInsert, TablesUpdate } from "./database.types.ts";

type PublicTables = Database["public"]["Tables"];

/** Tables that carry a `workspace_id` column (the workspace that owns the row). */
export type WorkspaceScopedTable = {
  [K in keyof PublicTables]: "workspace_id" extends keyof PublicTables[K]["Row"] ? K : never;
}[keyof PublicTables];

/** Insert shape for a workspace-scoped table, minus `workspace_id` (the scope supplies it). */
export type WorkspaceInsert<T extends WorkspaceScopedTable> = Omit<TablesInsert<T>, "workspace_id">;
/** Update shape; `workspace_id` can never be changed through the scope. */
export type WorkspaceUpdate<T extends WorkspaceScopedTable> = Omit<TablesUpdate<T>, "workspace_id">;

/** The ledger is append-only; it has no update or delete through the scope (or anywhere). */
type AppendOnlyTable = "ledger_events";
export type MutableWorkspaceTable = Exclude<WorkspaceScopedTable, AppendOnlyTable>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/**
 * Workspace-scoped query helpers. Every read, update and delete is filtered by `workspace_id`,
 * and every insert has `workspace_id` set, so a service-role query cannot forget the tenant filter.
 *
 * ```ts
 * const ws = forWorkspace(db, workspaceId);
 * const { data } = await ws.select("applications", "id, title, status").eq("competition_id", id);
 * await ws.insert("tasks", { title: "Call the grantee" });
 * await ws.update("programs", { name: "Community Health" }).eq("id", programId);
 * ```
 *
 * `workspace_id` is the funder on two-sided tables (`applications`, `awards` and their children).
 * Applicant-side reads filter those tables explicitly on `applicant_workspace_id` /
 * `recipient_workspace_id`; this helper does not cover them.
 */
export function forWorkspace(client: DbClient, workspaceId: string) {
  if (!isUuid(workspaceId)) throw new TypeError("forWorkspace: workspaceId must be a UUID");

  return {
    workspaceId,

    select<T extends WorkspaceScopedTable, Q extends string = "*">(table: T, columns?: Q) {
      return client
        .from(table)
        .select(columns ?? ("*" as Q))
        .eq("workspace_id" as never, workspaceId as never);
    },

    insert<T extends WorkspaceScopedTable>(table: T, rows: WorkspaceInsert<T> | WorkspaceInsert<T>[]) {
      const list = (Array.isArray(rows) ? rows : [rows]).map((row) => {
        if ("workspace_id" in (row as object)) throw new TypeError("forWorkspace.insert: workspace_id is set by the scope");
        return { ...row, workspace_id: workspaceId };
      });
      return client.from(table).insert(list as never);
    },

    update<T extends MutableWorkspaceTable>(table: T, patch: WorkspaceUpdate<T>) {
      if ("workspace_id" in (patch as object)) throw new TypeError("forWorkspace.update: workspace_id cannot be changed");
      return client
        .from(table)
        .update(patch as never)
        .eq("workspace_id" as never, workspaceId as never);
    },

    delete<T extends MutableWorkspaceTable>(table: T) {
      return client.from(table).delete().eq("workspace_id" as never, workspaceId as never);
    },
  };
}

export type WorkspaceScope = ReturnType<typeof forWorkspace>;
