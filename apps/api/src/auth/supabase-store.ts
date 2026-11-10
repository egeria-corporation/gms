// SPDX-License-Identifier: AGPL-3.0-only
// Supabase-backed auth stores. Table and column names follow build spec §8: `api_clients`,
// `oauth_clients_dynamic`, `oauth_codes`, `oauth_grants`, `workspace_members`, `workspaces`.
// The Worker uses the service role; every query filters explicitly.
import { ApiError } from "../lib/errors.ts";
import type { WorkspaceKind } from "./scopes.ts";
import type { AuthCode, AuthStore, Membership, MembershipStore, OAuthClient, OAuthGrant } from "./stores.ts";

/** The slice of a Supabase client these stores use; `@supabase/supabase-js` satisfies it. */
export interface Db {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- structural stand-in for the PostgREST query builder
  from(table: string): any;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function check<T>(res: { data: T; error: { message: string } | null }, what: string): T {
  if (res.error) throw new ApiError(500, "internal_error", `${what} failed`);
  return res.data;
}

interface ApiClientRow {
  id: string;
  workspace_id: string;
  name: string;
  client_secret_hash: string;
  allowed_scopes: string[];
  grant_types: string[] | null;
  redirect_uris: string[] | null;
  gated_tools: string[] | null;
  revoked_at: string | null;
}

interface DynamicClientRow {
  id: string;
  client_name: string;
  redirect_uris: string[];
  grant_types: string[];
  allowed_scopes: string[];
  revoked_at?: string | null;
}

interface CodeRow {
  code_hash: string;
  client_id: string;
  user_id: string;
  workspace_id: string;
  scopes: string[];
  redirect_uri: string;
  code_challenge: string;
  expires_at: string;
  used_at: string | null;
}

interface GrantRow {
  id: string;
  token_hash: string;
  client_id: string;
  user_id: string;
  workspace_id: string;
  scopes: string[];
  expires_at: string;
  revoked_at: string | null;
}

const toCode = (r: CodeRow): AuthCode => ({
  codeHash: r.code_hash,
  clientId: r.client_id,
  userId: r.user_id,
  workspaceId: r.workspace_id,
  scopes: r.scopes,
  redirectUri: r.redirect_uri,
  codeChallenge: r.code_challenge,
  expiresAt: r.expires_at,
  usedAt: r.used_at,
});

const toGrant = (r: GrantRow): OAuthGrant => ({
  id: r.id,
  tokenHash: r.token_hash,
  clientId: r.client_id,
  userId: r.user_id,
  workspaceId: r.workspace_id,
  scopes: r.scopes,
  expiresAt: r.expires_at,
  revokedAt: r.revoked_at,
});

export class SupabaseAuthStore implements AuthStore {
  constructor(private readonly db: Db) {}

  async getClient(clientId: string): Promise<OAuthClient | null> {
    if (!UUID.test(clientId)) return null;
    const api = check<ApiClientRow | null>(await this.db.from("api_clients").select("*").eq("id", clientId).maybeSingle(), "Client lookup");
    if (api) {
      return {
        id: api.id,
        name: api.name,
        workspaceId: api.workspace_id,
        clientSecretHash: api.client_secret_hash,
        allowedScopes: api.allowed_scopes,
        grantTypes: api.grant_types ?? ["client_credentials"],
        redirectUris: api.redirect_uris ?? [],
        gatedTools: api.gated_tools,
        dynamic: false,
        revokedAt: api.revoked_at,
      };
    }
    const dyn = check<DynamicClientRow | null>(await this.db.from("oauth_clients_dynamic").select("*").eq("id", clientId).maybeSingle(), "Client lookup");
    if (!dyn) return null;
    return {
      id: dyn.id,
      name: dyn.client_name,
      workspaceId: null,
      clientSecretHash: null,
      allowedScopes: dyn.allowed_scopes,
      grantTypes: dyn.grant_types,
      redirectUris: dyn.redirect_uris,
      gatedTools: null,
      dynamic: true,
      revokedAt: dyn.revoked_at ?? null,
    };
  }

  async createDynamicClient(c: OAuthClient): Promise<void> {
    const row: DynamicClientRow = { id: c.id, client_name: c.name, redirect_uris: c.redirectUris, grant_types: c.grantTypes, allowed_scopes: c.allowedScopes };
    check(await this.db.from("oauth_clients_dynamic").insert(row), "Client registration");
  }

  async saveCode(c: AuthCode): Promise<void> {
    const row: CodeRow = {
      code_hash: c.codeHash,
      client_id: c.clientId,
      user_id: c.userId,
      workspace_id: c.workspaceId,
      scopes: c.scopes,
      redirect_uri: c.redirectUri,
      code_challenge: c.codeChallenge,
      expires_at: c.expiresAt,
      used_at: c.usedAt,
    };
    check(await this.db.from("oauth_codes").insert(row), "Code issue");
  }

  async consumeCode(codeHash: string, now: string): Promise<AuthCode | null> {
    // One UPDATE … WHERE used_at IS NULL RETURNING: two concurrent redemptions cannot both win.
    const rows = check<CodeRow[]>(await this.db.from("oauth_codes").update({ used_at: now }).eq("code_hash", codeHash).is("used_at", null).select("*"), "Code redemption");
    return rows[0] ? toCode(rows[0]) : null;
  }

  async saveGrant(g: OAuthGrant): Promise<void> {
    const row: GrantRow = { id: g.id, token_hash: g.tokenHash, client_id: g.clientId, user_id: g.userId, workspace_id: g.workspaceId, scopes: g.scopes, expires_at: g.expiresAt, revoked_at: g.revokedAt };
    check(await this.db.from("oauth_grants").insert(row), "Grant issue");
  }

  async getGrantByTokenHash(tokenHash: string): Promise<OAuthGrant | null> {
    const row = check<GrantRow | null>(await this.db.from("oauth_grants").select("*").eq("token_hash", tokenHash).maybeSingle(), "Grant lookup");
    return row ? toGrant(row) : null;
  }

  async rotateGrant(id: string, fromTokenHash: string, toTokenHash: string, expiresAt: string): Promise<boolean> {
    const rows = check<GrantRow[]>(
      await this.db.from("oauth_grants").update({ token_hash: toTokenHash, expires_at: expiresAt }).eq("id", id).eq("token_hash", fromTokenHash).is("revoked_at", null).select("id"),
      "Grant rotation",
    );
    return rows.length === 1;
  }

  async revokeGrant(id: string, now: string): Promise<void> {
    check(await this.db.from("oauth_grants").update({ revoked_at: now }).eq("id", id).is("revoked_at", null), "Grant revocation");
  }
}

interface MemberRow {
  workspace_id: string;
  user_id: string;
  role: string;
  scope: Record<string, unknown> | null;
  expires_at: string | null;
  workspaces: { kind: WorkspaceKind; display_name: string } | null;
}

const MEMBER_SELECT = "workspace_id, user_id, role, scope, expires_at, workspaces(kind, display_name)";

const toMembership = (r: MemberRow): Membership | null =>
  r.workspaces
    ? { workspaceId: r.workspace_id, workspaceKind: r.workspaces.kind, workspaceName: r.workspaces.display_name, userId: r.user_id, role: r.role, scope: r.scope, expiresAt: r.expires_at }
    : null;

export class SupabaseMembershipStore implements MembershipStore {
  constructor(private readonly db: Db) {}

  async getMembership(workspaceId: string, userId: string): Promise<Membership | null> {
    if (!UUID.test(workspaceId) || !UUID.test(userId)) return null;
    const row = check<MemberRow | null>(await this.db.from("workspace_members").select(MEMBER_SELECT).eq("workspace_id", workspaceId).eq("user_id", userId).maybeSingle(), "Membership lookup");
    return row ? toMembership(row) : null;
  }

  async listForUser(userId: string): Promise<Membership[]> {
    if (!UUID.test(userId)) return [];
    const rows = check<MemberRow[]>(await this.db.from("workspace_members").select(MEMBER_SELECT).eq("user_id", userId), "Membership list");
    return rows.map(toMembership).filter((m): m is Membership => m !== null);
  }
}
