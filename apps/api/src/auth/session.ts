// SPDX-License-Identifier: AGPL-3.0-only
// Supabase Auth sessions. The web app sends the Supabase access token as a bearer, audience
// `authenticated`. Current Supabase projects sign it with an asymmetric key (ES256 or RS256)
// published at `{SUPABASE_URL}/auth/v1/.well-known/jwks.json`; older and self-hosted projects sign
// it with HS256 and the project's JWT secret. Both are accepted. `aal` says whether the session
// passed this app's TOTP (aal2); whether a session has passed *a* second step is decided in
// auth/second-step.ts, which also accepts Passport's authenticator.
import { createRemoteJWKSet, decodeJwt, decodeProtectedHeader, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from "jose";
import { trimSlash } from "../env.ts";
import { ApiError } from "../lib/errors.ts";
import { authError } from "./verify.ts";

export interface SessionUser {
  userId: string;
  email: string | null;
  aal: "aal1" | "aal2";
  /** Supabase Auth's id for this session (`session_id` claim), when the token carries one. */
  sessionId?: string | null;
  /**
   * Whether this session holds Passport's second step. Filled in by `secondStepVerified`
   * (auth/second-step.ts) the first time a check needs it; never read it directly.
   */
  passportStep?: boolean;
  /** The name on the account (`user_metadata.full_name` or `.name`), when the token carries one. For display only. */
  name?: string | null;
}

export interface SessionConfig {
  /** SUPABASE_JWT_SECRET: verifies HS256 sessions. */
  jwtSecret?: string;
  /** SUPABASE_URL: locates the issuer and its published signing keys. */
  supabaseUrl?: string;
  /** Overrides the published keys (tests). */
  keys?: JWTVerifyGetKey;
}

const ASYMMETRIC = ["ES256", "RS256"];

/** The `iss` Supabase Auth puts on its sessions. */
export const sessionIssuer = (supabaseUrl: string): string => `${trimSlash(supabaseUrl)}/auth/v1`;

// One key set per issuer for the life of the isolate; jose refetches when it meets an unknown kid.
const keySets = new Map<string, JWTVerifyGetKey>();
function publishedKeys(supabaseUrl: string): JWTVerifyGetKey {
  const issuer = sessionIssuer(supabaseUrl);
  let set = keySets.get(issuer);
  if (!set) {
    set = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
    keySets.set(issuer, set);
  }
  return set;
}

/**
 * Whether a bearer is a person's session rather than a GMS-issued token. Read from unverified
 * parts only to choose the verifier; nothing is trusted until that verifier passes.
 */
export function isSessionToken(token: string, supabaseUrl: string | undefined): boolean {
  try {
    if (decodeProtectedHeader(token).alg === "HS256") return true;
    return !!supabaseUrl && decodeJwt(token).iss === sessionIssuer(supabaseUrl);
  } catch {
    return false;
  }
}

export async function verifySupabaseSession(token: string, config: SessionConfig, now: Date): Promise<SessionUser> {
  let alg: string | undefined;
  try {
    alg = decodeProtectedHeader(token).alg;
  } catch {
    throw authError("invalid_session", "Session is invalid or has expired");
  }
  const common = { audience: "authenticated", currentDate: now, clockTolerance: 60 };
  let payload: JWTPayload;
  try {
    if (alg === "HS256") {
      if (!config.jwtSecret) throw authError("sessions_unavailable", "Session sign-in is not configured on this server");
      ({ payload } = await jwtVerify(token, new TextEncoder().encode(config.jwtSecret), { ...common, algorithms: ["HS256"] }));
    } else {
      if (!config.supabaseUrl) throw authError("sessions_unavailable", "Session sign-in is not configured on this server");
      const keys = config.keys ?? publishedKeys(config.supabaseUrl);
      ({ payload } = await jwtVerify(token, keys, { ...common, algorithms: ASYMMETRIC, issuer: sessionIssuer(config.supabaseUrl) }));
    }
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw authError("invalid_session", "Session is invalid or has expired");
  }
  if (typeof payload.sub !== "string" || !payload.sub) throw authError("invalid_session", "Session is invalid or has expired");
  return { userId: payload.sub, email: typeof payload.email === "string" ? payload.email : null, aal: payload.aal === "aal2" ? "aal2" : "aal1", ...(typeof payload.session_id === "string" ? { sessionId: payload.session_id } : {}), ...(accountName(payload.user_metadata) ? { name: accountName(payload.user_metadata) } : {}) };
}

/** The display name Supabase Auth keeps in `user_metadata`; null when there is none. */
function accountName(meta: unknown): string | null {
  if (!meta || typeof meta !== "object") return null;
  const m = meta as Record<string, unknown>;
  const name = typeof m.full_name === "string" ? m.full_name : typeof m.name === "string" ? m.name : "";
  return name.trim() ? name.trim().slice(0, 200) : null;
}
