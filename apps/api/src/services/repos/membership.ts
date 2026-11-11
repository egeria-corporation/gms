// SPDX-License-Identifier: AGPL-3.0-only
// The auth layer's MembershipStore, served from the same repositories the services write to, so a
// member added through a service is seen by the very next request.
import type { WorkspaceKind } from "../../auth/scopes.ts";
import type { Membership, MembershipStore } from "../../auth/stores.ts";
import type { Repos, Row } from "./types.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const toMembership = (m: Row<"workspace_members">, w: Row<"workspaces">): Membership => ({
  workspaceId: m.workspace_id,
  workspaceKind: w.kind as WorkspaceKind,
  workspaceName: w.display_name,
  userId: m.user_id,
  role: m.role,
  scope: m.scope && typeof m.scope === "object" && !Array.isArray(m.scope) && Object.keys(m.scope).length ? (m.scope as Record<string, unknown>) : null,
  expiresAt: m.expires_at,
  lastActiveAt: m.last_active_at,
});

export class RepoMembershipStore implements MembershipStore {
  constructor(private readonly repos: Repos) {}

  async getMembership(workspaceId: string, userId: string): Promise<Membership | null> {
    if (!UUID.test(workspaceId) || !UUID.test(userId)) return null;
    const m = await this.repos.table("workspace_members").one({ workspace_id: workspaceId, user_id: userId });
    if (!m) return null;
    const w = await this.repos.table("workspaces").one({ id: workspaceId });
    return w ? toMembership(m, w) : null;
  }

  async listForUser(userId: string): Promise<Membership[]> {
    if (!UUID.test(userId)) return [];
    const ms = await this.repos.table("workspace_members").find({ user_id: userId });
    if (!ms.length) return [];
    const ws = new Map((await this.repos.table("workspaces").find({ id: ms.map((m) => m.workspace_id) })).map((w) => [w.id, w]));
    return ms.flatMap((m) => (ws.has(m.workspace_id) ? [toMembership(m, ws.get(m.workspace_id)!)] : []));
  }
}
