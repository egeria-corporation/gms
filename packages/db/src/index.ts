// SPDX-License-Identifier: AGPL-3.0-only
// Typed Supabase client, generated types, workspace-scope helpers and API id prefixes.
export { createServiceClient, type DbClient, type ServiceEnv } from "./client.ts";
export {
  forWorkspace,
  isUuid,
  type MutableWorkspaceTable,
  type WorkspaceInsert,
  type WorkspaceScope,
  type WorkspaceScopedTable,
  type WorkspaceUpdate,
} from "./workspace-scope.ts";
export {
  ID_PREFIXES,
  InvalidIdError,
  fromApiId,
  isApiId,
  parseApiId,
  toApiId,
  uuidV7Timestamp,
  type IdKind,
  type IdPrefix,
} from "./ids.ts";
export { TABLE_NAMES } from "./database.types.ts";
export type { Database, Json, TableName, Tables, TablesInsert, TablesUpdate } from "./database.types.ts";
