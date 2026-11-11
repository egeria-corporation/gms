// SPDX-License-Identifier: AGPL-3.0-only
// Mock auth for `VITE_USE_MOCKS=true` and tests. Any email signs in; the one-time code and the
// authenticator code are both MOCK_CODE. Starts signed in so the fixture workspaces open directly.
import { AuthError, type AuthClient, type Session } from "../auth/types.ts";
import { MOCK_PASSPORT_SESSION, MOCK_PASSPORT_TOKEN } from "../lib/passportSignIn.ts";
import { MOCK_USER } from "./fixtures.ts";

export const MOCK_CODE = "123456";
const KEY = "gms.mock.session";

export interface MockAuthOptions {
  /** Initial session. Omit to restore from sessionStorage, falling back to a signed-in aal2 demo session. */
  session?: Session | null;
  /** Whether the demo person already has an authenticator enrolled. */
  totpEnrolled?: boolean;
  persist?: boolean;
}

export const demoSession = (aal: "aal1" | "aal2" = "aal2", email = MOCK_USER.email): Session => ({
  userId: MOCK_USER.userId,
  email,
  aal,
  accessToken: `mock.${aal}`,
});

export function createMockAuth(opts: MockAuthOptions = {}): AuthClient {
  const persist = opts.persist ?? opts.session === undefined;
  const listeners = new Set<(s: Session | null) => void>();
  let enrolled = opts.totpEnrolled ?? false;

  const restore = (): Session | null => {
    if (opts.session !== undefined) return opts.session;
    try {
      const saved = sessionStorage.getItem(KEY);
      if (saved) return JSON.parse(saved) as Session | null;
    } catch {
      // Storage can be unavailable (private mode); fall through to the default session.
    }
    return demoSession();
  };
  let session = restore();

  const set = (next: Session | null) => {
    session = next;
    if (persist) {
      try {
        sessionStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        // See restore().
      }
    }
    for (const cb of listeners) cb(next);
    return next;
  };
  const checkCode = (code: string) => {
    if (code !== MOCK_CODE) throw new AuthError("That code didn't match.", "invalid_code");
  };

  return {
    getSession: async () => session,
    onChange(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    async sendCode(email) {
      if (!/^\S+@\S+\.\S+$/.test(email)) throw new AuthError("Enter a valid email address.");
    },
    async verifyCode(email, code) {
      checkCode(code);
      return set(demoSession("aal1", email))!;
    },
    async redeemSignIn(tokenHash) {
      if (tokenHash !== MOCK_PASSPORT_TOKEN) throw new AuthError("That sign-in has expired.", "invalid_code");
      return set({ ...demoSession("aal1"), accessToken: MOCK_PASSPORT_SESSION })!;
    },
    listTotpFactors: async () => (enrolled ? ["mock-totp"] : []),
    enrollTotp: async () => ({
      factorId: "mock-totp",
      secret: "QHX7-R2MP-4TLC-W9KD",
      uri: "otpauth://totp/OpenGrants%20GMS?secret=QHX7R2MP4TLCW9KD",
    }),
    async verifyTotp(_factorId, code) {
      checkCode(code);
      if (!session) throw new AuthError("Not signed in");
      enrolled = true;
      return set({ ...session, aal: "aal2", accessToken: "mock.aal2" })!;
    },
    async signOut() {
      set(null);
    },
  };
}
