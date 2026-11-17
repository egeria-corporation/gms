// SPDX-License-Identifier: AGPL-3.0-only
// The auth port. Two implementations: Supabase Auth (auth/supabase.ts) and the in-browser mock
// (mocks/auth.ts). Screens and guards only ever see this interface.

export interface Session {
  userId: string;
  email: string;
  /** aal2 once a TOTP factor was verified in this session. */
  aal: "aal1" | "aal2";
  accessToken: string;
  /** The identity provider this session signed in through (single sign-on, `amr` sso/saml); absent for any other sign-in. */
  ssoProviderId?: string | null;
}

export interface TotpEnrollment {
  factorId: string;
  /** The shared secret, for manual entry. */
  secret: string;
  /** otpauth:// URI encoded in the QR code. */
  uri: string;
  /** QR code as an image source (data URI), when the provider renders one. */
  qrCode?: string;
}

export interface AuthClient {
  getSession(): Promise<Session | null>;
  /** Calls back on sign-in, sign-out and assurance-level changes. Returns an unsubscribe function. */
  onChange(cb: (session: Session | null) => void): () => void;
  /** Emails a one-time code (the same email carries a magic link). */
  sendCode(email: string): Promise<void>;
  verifyCode(email: string, code: string): Promise<Session>;
  /**
   * Redeems the one-time sign-in the API hands back after Sign in with Passport
   * (`/auth/passport#token_hash=…&type=…`) for a session.
   */
  redeemSignIn(tokenHash: string, type: string): Promise<Session>;
  /** Ids of this user's verified TOTP factors. */
  listTotpFactors(): Promise<string[]>;
  enrollTotp(): Promise<TotpEnrollment>;
  /** Verifies a code for a factor (completing enrollment or a challenge) and raises the session to aal2. */
  verifyTotp(factorId: string, code: string): Promise<Session>;
  /**
   * Single sign-on (SAML): sends the browser to the identity provider registered for the domain of
   * `workEmail`, which returns to the sign-in page signed in. Rejects with code `no_sso` when the domain has none.
   */
  signInWithSSO(workEmail: string): Promise<void>;
  signOut(): Promise<void>;
}

export class AuthError extends Error {
  constructor(
    message: string,
    readonly code: "invalid_code" | "rate_limited" | "unavailable" | "no_sso" | "unknown" = "unknown",
  ) {
    super(message);
    this.name = "AuthError";
  }
}

/** Roles that must hold aal2 before their workspace opens (build spec §4). The API decides; this mirrors it for mocks. */
export function roleRequiresMfa(kind: "funder" | "applicant", role: string): boolean {
  return kind === "funder" ? role === "admin" || role === "finance" : role === "admin";
}
