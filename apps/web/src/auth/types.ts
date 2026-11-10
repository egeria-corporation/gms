// SPDX-License-Identifier: AGPL-3.0-only
// The auth port. Two implementations: Supabase Auth (auth/supabase.ts) and the in-browser mock
// (mocks/auth.ts). Screens and guards only ever see this interface.

export interface Session {
  userId: string;
  email: string;
  /** aal2 once a TOTP factor was verified in this session. */
  aal: "aal1" | "aal2";
  accessToken: string;
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
  /** Ids of this user's verified TOTP factors. */
  listTotpFactors(): Promise<string[]>;
  enrollTotp(): Promise<TotpEnrollment>;
  /** Verifies a code for a factor (completing enrollment or a challenge) and raises the session to aal2. */
  verifyTotp(factorId: string, code: string): Promise<Session>;
  signOut(): Promise<void>;
}

export class AuthError extends Error {
  constructor(
    message: string,
    readonly code: "invalid_code" | "rate_limited" | "unavailable" | "unknown" = "unknown",
  ) {
    super(message);
    this.name = "AuthError";
  }
}

/** Roles that must hold aal2 before their workspace opens (build spec §4). The API decides; this mirrors it for mocks. */
export function roleRequiresMfa(kind: "funder" | "applicant", role: string): boolean {
  return kind === "funder" ? role === "admin" || role === "finance" : role === "admin";
}
