// SPDX-License-Identifier: AGPL-3.0-only
// Supabase-backed auth stores, written against supabase/migrations/0002 and 0007: `api_clients`,
// `oauth_clients_dynamic`, `oauth_grants`, `oauth_codes`, `oauth_refresh_tokens`. Memberships are read through the
// service repositories (services/repos/membership.ts). Checked by test/stores.int.test.ts on a real stack.
// The Worker uses the service role; every query filters explicitly.
import { ApiError } from "../lib/errors.ts";
import { DYNAMIC_CLIENT_SCOPES } from "./scopes.ts";
import { REFRESH_TOKEN_TTL_SEC } from "./tokens.ts";
import type { AuthCode, AuthStore, OAuthClient, OAuthGrant } from "./stores.ts";

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
  gated_tools: string[] | null;
  revoked_at: string | null;
}

/** `oauth_clients_dynamic`: public clients (PKCE), no secret, no stored scope list. */
interface DynamicClientRow {
  id: string;
  client_name: string;
  redirect_uris: string[];
  grant_types: string[];
  token_endpoint_auth_method?: "none";
}

interface CodeRow {
  code_hash: string;
  client_id: string;
  grant_id: string;
  user_id: string;
  workspace_id: string;
  scopes: string[];
  redirect_uri: string;
  code_challenge: string;
  expires_at: string;
  used_at: string | null;
}

/** `oauth_grants`: one live consent per (client, user, workspace); the current refresh token's hash. */
interface GrantRow {
  id: string;
  refresh_token_hash: string | null;
  client_id: string;
  user_id: string;
  workspace_id: string;
  scopes: string[];
  revoked_at: string | null;
}

/** `oauth_refresh_tokens`: rotation history. A rotated token that shows up again revokes its grant. */
interface RefreshTokenRow {
  token_hash: string;
  grant_id: string;
  issued_at: string;
  rotated_at: string | null;
}

const DYNAMIC_GRANT_TYPES = ["authorization_code", "refresh_token"];
const TTL_MS = REFRESH_TOKEN_TTL_SEC * 1000;
const issuedAt = (expiresAt: string) => new Date(Date.parse(expiresAt) - TTL_MS).toISOString();

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

const toGrant = (g: GrantRow, t: RefreshTokenRow): OAuthGrant => ({
  id: g.id,
  tokenHash: t.token_hash,
  clientId: g.client_id,
  userId: g.user_id,
  workspaceId: g.workspace_id,
  scopes: g.scopes,
  expiresAt: new Date(Date.parse(t.issued_at) + TTL_MS).toISOString(),
  revokedAt: g.revoked_at,
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
        grantTypes: ["client_credentials"],
        redirectUris: [],
        gatedTools: api.gated_tools,
        dynamic: false,
        revokedAt: api.revoked_at,
      };
    }
    const dyn = check<DynamicClientRow | null>(await this.db.from("oauth_clients_dynamic").select("*").eq("id", clientId).maybeSingle(), "Client lookup");
    if (!dyn) return null;
    // A dynamic registration stores no scope list: what a token may carry is set by the person's consent and role.
    return { id: dyn.id, name: dyn.client_name, workspaceId: null, clientSecretHash: null, allowedScopes: [...DYNAMIC_CLIENT_SCOPES], grantTypes: dyn.grant_types, redirectUris: dyn.redirect_uris, gatedTools: null, dynamic: true, revokedAt: null };
  }

  async createDynamicClient(c: OAuthClient): Promise<void> {
    const row: DynamicClientRow = { id: c.id, client_name: c.name, redirect_uris: c.redirectUris, grant_types: c.grantTypes.filter((g) => DYNAMIC_GRANT_TYPES.includes(g)), token_endpoint_auth_method: "none" };
    check(await this.db.from("oauth_clients_dynamic").insert(row), "Client registration");
  }

  private async liveGrant(clientId: string, userId: string, workspaceId: string): Promise<GrantRow | null> {
    return check<GrantRow | null>(await this.db.from("oauth_grants").select("*").eq("client_id", clientId).eq("user_id", userId).eq("workspace_id", workspaceId).is("revoked_at", null).maybeSingle(), "Grant lookup");
  }

  /** A code belongs to a consent: the grant row is created (or its scopes replaced) when the person approves. */
  async saveCode(c: AuthCode): Promise<void> {
    let grant = await this.liveGrant(c.clientId, c.userId, c.workspaceId);
    if (grant) {
      check(await this.db.from("oauth_grants").update({ scopes: c.scopes }).eq("id", grant.id), "Grant update");
    } else {
      grant = check<GrantRow>(await this.db.from("oauth_grants").insert({ client_id: c.clientId, user_id: c.userId, workspace_id: c.workspaceId, scopes: c.scopes }).select("*").single(), "Grant issue");
    }
    const row: CodeRow = {
      code_hash: c.codeHash,
      client_id: c.clientId,
      grant_id: grant.id,
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

  /** Attach the first refresh token to the consent the code came from. */
  async saveGrant(g: OAuthGrant): Promise<void> {
    const live = await this.liveGrant(g.clientId, g.userId, g.workspaceId);
    let grantId = live?.id;
    if (live) {
      check(await this.db.from("oauth_grants").update({ refresh_token_hash: g.tokenHash, scopes: g.scopes }).eq("id", live.id), "Grant update");
    } else {
      grantId = g.id;
      check(await this.db.from("oauth_grants").insert({ id: g.id, client_id: g.clientId, user_id: g.userId, workspace_id: g.workspaceId, scopes: g.scopes, refresh_token_hash: g.tokenHash }), "Grant issue");
    }
    const token: RefreshTokenRow = { token_hash: g.tokenHash, grant_id: grantId!, issued_at: issuedAt(g.expiresAt), rotated_at: null };
    check(await this.db.from("oauth_refresh_tokens").insert(token), "Refresh token issue");
  }

  async getGrantByTokenHash(tokenHash: string): Promise<OAuthGrant | null> {
    const token = check<RefreshTokenRow | null>(await this.db.from("oauth_refresh_tokens").select("*").eq("token_hash", tokenHash).maybeSingle(), "Refresh token lookup");
    if (!token) return null;
    const grant = check<GrantRow | null>(await this.db.from("oauth_grants").select("*").eq("id", token.grant_id).maybeSingle(), "Grant lookup");
    if (!grant) return null;
    if (token.rotated_at) {
      // A refresh token works once. Seeing a rotated one again means it leaked: end the whole consent.
      const now = new Date().toISOString();
      check(await this.db.from("oauth_grants").update({ revoked_at: now }).eq("id", grant.id).is("revoked_at", null), "Grant revocation");
      return toGrant({ ...grant, revoked_at: grant.revoked_at ?? now }, token);
    }
    return toGrant(grant, token);
  }

  async rotateGrant(id: string, fromTokenHash: string, toTokenHash: string, expiresAt: string): Promise<boolean> {
    const rows = check<{ id: string }[]>(
      await this.db.from("oauth_grants").update({ refresh_token_hash: toTokenHash }).eq("id", id).eq("refresh_token_hash", fromTokenHash).is("revoked_at", null).select("id"),
      "Grant rotation",
    );
    if (rows.length !== 1) return false;
    const issued = issuedAt(expiresAt);
    check(await this.db.from("oauth_refresh_tokens").update({ rotated_at: issued }).eq("token_hash", fromTokenHash), "Refresh token rotation");
    check(await this.db.from("oauth_refresh_tokens").insert({ token_hash: toTokenHash, grant_id: id, issued_at: issued, rotated_at: null } satisfies RefreshTokenRow), "Refresh token issue");
    return true;
  }

  async revokeGrant(id: string, now: string): Promise<void> {
    check(await this.db.from("oauth_grants").update({ revoked_at: now }).eq("id", id).is("revoked_at", null), "Grant revocation");
  }
}
