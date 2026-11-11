// SPDX-License-Identifier: AGPL-3.0-only
// One authorization path for every caller. A request is made by a signed-in person (Supabase
// session), a workspace API client (client-credentials token) or an agent acting for a person
// (delegated token). All three resolve to a Principal with a workspace and a set of scopes, and
// routes ask one question: `requireScope("payments:release")`.
import { formatActor, type Actor } from "@gms/ledger";
import type { Context, MiddlewareHandler } from "hono";
import type { AppEnv } from "../app.ts";
import { keyRing } from "../lib/keys.ts";
import { roleRequiresMfa, scopesForRole } from "./scopes.ts";
import { secondStepVerified } from "./second-step.ts";
import { isSessionToken, verifySupabaseSession, type SessionConfig, type SessionUser } from "./session.ts";
import { authError, checkScope, checkWorkspaceBinding, forbidden, verifyAccessToken } from "./verify.ts";

export const WORKSPACE_HEADER = "X-GMS-Workspace";

export interface Principal {
  kind: "user" | "client" | "delegated";
  userId: string | null;
  clientId: string | null;
  workspaceId: string;
  /** The person's workspace role; null for client-credentials tokens. */
  role: string | null;
  scopes: readonly string[];
  /** Consultant / external reviewer restrictions from the membership, for row-level checks in services. */
  memberScope: Record<string, unknown> | null;
  jti: string | null;
}

export function actorOf(p: Principal): Actor {
  if (p.kind === "user") return { kind: "user", userId: p.userId! };
  if (p.kind === "client") return { kind: "client", clientId: p.clientId! };
  return { kind: "delegated", userId: p.userId!, clientId: p.clientId! };
}
export const actorString = (p: Principal) => formatActor(actorOf(p));

function bearer(c: Context<AppEnv>): string | null {
  const m = /^Bearer\s+(\S+)$/i.exec(c.req.header("Authorization") ?? "");
  return m ? m[1]! : null;
}

const sessionConfig = (c: Context<AppEnv>): SessionConfig => ({
  jwtSecret: c.env.SUPABASE_JWT_SECRET,
  supabaseUrl: c.env.SUPABASE_URL,
  keys: c.get("deps").sessionKeys,
});

/** The workspace a request names: `:workspaceId` in the path, else the X-GMS-Workspace header. */
const namedWorkspace = (c: Context<AppEnv>): string | null => c.req.param("workspaceId") ?? c.req.header(WORKSPACE_HEADER) ?? null;

/** A signed-in person, with no workspace yet (workspace list, OAuth consent, onboarding). */
export function requireUser(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const token = bearer(c);
    if (!token) throw authError("missing_token", "Sign in to continue");
    if (!isSessionToken(token, c.env.SUPABASE_URL)) throw authError("session_required", "This action needs a signed-in person, not an API token");
    c.set("user", await verifySupabaseSession(token, sessionConfig(c), c.get("deps").now()));
    await next();
  };
}

export const LAST_ACTIVE_EVERY_MS = 15 * 60 * 1000;

/**
 * Note that a member used the workspace: one small write at most every 15 minutes per member, and
 * none at all on the requests in between. A failed write never fails the request.
 */
async function touchLastActive(c: Context<AppEnv>, m: { workspaceId: string; userId: string; lastActiveAt?: string | null }): Promise<void> {
  const deps = c.get("deps");
  const now = deps.now();
  if (m.lastActiveAt && now.getTime() - Date.parse(m.lastActiveAt) < LAST_ACTIVE_EVERY_MS) return;
  try {
    await deps.repos.table("workspace_members").update({ workspace_id: m.workspaceId, user_id: m.userId }, { last_active_at: now.toISOString() });
  } catch {
    // Activity is a convenience for the member list, not a reason to refuse a request.
  }
}

async function principalFromSession(c: Context<AppEnv>, user: SessionUser): Promise<Principal> {
  const workspaceId = namedWorkspace(c);
  if (!workspaceId) throw forbidden("workspace_required", `Name a workspace with the ${WORKSPACE_HEADER} header`);
  const m = await c.get("deps").members.getMembership(workspaceId, user.userId);
  // Same answer for "no such workspace" and "not a member", so workspace ids cannot be probed.
  if (!m) throw forbidden("workspace_mismatch", "You are not a member of this workspace");
  if (m.expiresAt && Date.parse(m.expiresAt) <= c.get("deps").now().getTime()) throw forbidden("membership_expired", "Your access to this workspace has expired");
  if (roleRequiresMfa(m.workspaceKind, m.role) && !(await secondStepVerified(c, user))) throw forbidden("mfa_required", "This role requires two-step verification. Verify with your authenticator app to continue");
  await touchLastActive(c, m);
  return { kind: "user", userId: user.userId, clientId: null, workspaceId, role: m.role, scopes: scopesForRole(m.workspaceKind, m.role), memberScope: m.scope, jti: null };
}

async function principalFromToken(c: Context<AppEnv>, token: string): Promise<Principal> {
  const env = c.env;
  const claims = await verifyAccessToken(token, {
    audience: env.GMS_BASE_URL,
    trustedIssuers: { [env.OAUTH_ISSUER]: async () => (await keyRing(env)).jwks },
    now: c.get("deps").now(),
  });
  if (!claims.workspaceId) throw forbidden("workspace_required", "Token is not bound to a workspace");
  const named = namedWorkspace(c);
  if (named) checkWorkspaceBinding(claims.workspaceId, named);

  let scopes: readonly string[] = claims.scopes;
  let role: string | null = null;
  let memberScope: Record<string, unknown> | null = null;
  if (claims.userId) {
    // A delegated token never outlives or exceeds the person behind it: re-read their membership on every call.
    const m = await c.get("deps").members.getMembership(claims.workspaceId, claims.userId);
    if (!m || (m.expiresAt && Date.parse(m.expiresAt) <= c.get("deps").now().getTime())) throw forbidden("workspace_mismatch", "The person this token acts for no longer has access to this workspace");
    const allowed = new Set<string>(scopesForRole(m.workspaceKind, m.role));
    scopes = claims.scopes.filter((s) => allowed.has(s) || s === "approvals:bypass");
    role = m.role;
    memberScope = m.scope;
  }
  return { kind: claims.userId ? "delegated" : "client", userId: claims.userId, clientId: claims.clientId, workspaceId: claims.workspaceId, role, scopes, memberScope, jti: claims.jti };
}

/** Resolve the caller to a workspace-bound Principal (steps 1–6 for tokens; session + membership for people). */
export function authenticate(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const token = bearer(c);
    if (!token) throw authError("missing_token", "A bearer token is required");
    const principal =
      isSessionToken(token, c.env.SUPABASE_URL)
        ? await principalFromSession(c, await verifySupabaseSession(token, sessionConfig(c), c.get("deps").now()))
        : await principalFromToken(c, token);
    c.set("principal", principal);
    await next();
  };
}

/** Step 7: scope. Use after `authenticate()`, or alone (it authenticates first when needed). */
export function requireScope(scope: string): MiddlewareHandler<AppEnv> {
  const auth = authenticate();
  return async (c, next) => {
    const run = async () => {
      checkScope(c.get("principal").scopes, scope);
      await next();
    };
    if (c.get("principal")) return run();
    return auth(c, run);
  };
}

/** For the few routes that are about who you are rather than what a token may do (ledger: admin, auditor). */
export function requireRole(roles: readonly string[], tokenScope: string): MiddlewareHandler<AppEnv> {
  const auth = authenticate();
  return async (c, next) =>
    auth(c, async () => {
      const p = c.get("principal");
      if (p.role !== null) {
        if (!roles.includes(p.role)) throw forbidden("insufficient_role", `This needs one of these roles: ${roles.join(", ")}`);
        if (p.kind === "delegated") checkScope(p.scopes, tokenScope);
      } else {
        checkScope(p.scopes, tokenScope);
      }
      await next();
    });
}
