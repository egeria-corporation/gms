// SPDX-License-Identifier: AGPL-3.0-only
// Persistence ports for the auth layer. Supabase in production (supabase-store.ts), memory in tests.
import type { WorkspaceKind } from "./scopes.ts";

export interface OAuthClient {
  id: string;
  name: string;
  /** Workspace API clients belong to one workspace. Dynamically registered (MCP) clients belong to none. */
  workspaceId: string | null;
  /** `sha256$…`; null for public clients, which must use PKCE. */
  clientSecretHash: string | null;
  allowedScopes: string[];
  grantTypes: string[];
  redirectUris: string[];
  /** Per-client override of the human-gated tool list (`api_clients.gated_tools`); null = defaults. */
  gatedTools: string[] | null;
  dynamic: boolean;
  revokedAt: string | null;
}

export interface AuthCode {
  codeHash: string;
  clientId: string;
  userId: string;
  workspaceId: string;
  scopes: string[];
  redirectUri: string;
  codeChallenge: string;
  expiresAt: string;
  usedAt: string | null;
}

/** A consent grant and its current refresh token (`oauth_grants`). */
export interface OAuthGrant {
  id: string;
  tokenHash: string;
  clientId: string;
  userId: string;
  workspaceId: string;
  scopes: string[];
  expiresAt: string;
  revokedAt: string | null;
}

export interface AuthStore {
  getClient(clientId: string): Promise<OAuthClient | null>;
  createDynamicClient(client: OAuthClient): Promise<void>;
  saveCode(code: AuthCode): Promise<void>;
  /** Atomically mark the code used and return it; null if unknown or already used. */
  consumeCode(codeHash: string, now: string): Promise<AuthCode | null>;
  saveGrant(grant: OAuthGrant): Promise<void>;
  /**
   * The grant a refresh token belongs to. A token that was already rotated returns its grant
   * revoked (and revokes it): a refresh token works once, so reuse means it leaked.
   */
  getGrantByTokenHash(tokenHash: string): Promise<OAuthGrant | null>;
  /** Replace the refresh token of a live grant; false if it was rotated or revoked meanwhile. */
  rotateGrant(id: string, fromTokenHash: string, toTokenHash: string, expiresAt: string): Promise<boolean>;
  revokeGrant(id: string, now: string): Promise<void>;
}

export interface Membership {
  workspaceId: string;
  workspaceKind: WorkspaceKind;
  workspaceName: string;
  userId: string;
  role: string;
  /** Consultant / external reviewer restrictions (application, award, competition ids). */
  scope: Record<string, unknown> | null;
  expiresAt: string | null;
  lastActiveAt?: string | null;
}

export interface MembershipStore {
  getMembership(workspaceId: string, userId: string): Promise<Membership | null>;
  listForUser(userId: string): Promise<Membership[]>;
}

export class MemoryAuthStore implements AuthStore {
  readonly codes: AuthCode[] = [];
  readonly grants: OAuthGrant[] = [];
  /** Rotated refresh-token hash → grant id. A rotated token that shows up again revokes the grant. */
  private readonly rotated = new Map<string, string>();
  constructor(readonly clients: OAuthClient[] = []) {}

  async getClient(clientId: string) {
    return this.clients.find((c) => c.id === clientId) ?? null;
  }
  async createDynamicClient(client: OAuthClient) {
    this.clients.push(client);
  }
  async saveCode(code: AuthCode) {
    this.codes.push({ ...code });
  }
  async consumeCode(codeHash: string, now: string) {
    const code = this.codes.find((c) => c.codeHash === codeHash && c.usedAt === null);
    if (!code) return null;
    code.usedAt = now;
    return { ...code };
  }
  async saveGrant(grant: OAuthGrant) {
    this.grants.push({ ...grant });
  }
  async getGrantByTokenHash(tokenHash: string) {
    const g = this.grants.find((x) => x.tokenHash === tokenHash);
    if (g) return { ...g };
    const reused = this.grants.find((x) => x.id === this.rotated.get(tokenHash));
    if (!reused) return null;
    reused.revokedAt ??= new Date().toISOString();
    return { ...reused, tokenHash };
  }
  async rotateGrant(id: string, fromTokenHash: string, toTokenHash: string, expiresAt: string) {
    const g = this.grants.find((x) => x.id === id && x.tokenHash === fromTokenHash && x.revokedAt === null);
    if (!g) return false;
    this.rotated.set(fromTokenHash, id);
    g.tokenHash = toTokenHash;
    g.expiresAt = expiresAt;
    return true;
  }
  async revokeGrant(id: string, now: string) {
    const g = this.grants.find((x) => x.id === id);
    if (g && !g.revokedAt) g.revokedAt = now;
  }
}

export class MemoryMembershipStore implements MembershipStore {
  constructor(readonly memberships: Membership[] = []) {}
  async getMembership(workspaceId: string, userId: string) {
    return this.memberships.find((m) => m.workspaceId === workspaceId && m.userId === userId) ?? null;
  }
  async listForUser(userId: string) {
    return this.memberships.filter((m) => m.userId === userId);
  }
}
