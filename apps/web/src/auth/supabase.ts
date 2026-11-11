// SPDX-License-Identifier: AGPL-3.0-only
import { createClient, type Session as SupabaseSession, type SupabaseClient } from "@supabase/supabase-js";
import { AuthError, type AuthClient, type Session, type TotpEnrollment } from "./types.ts";

function aalOf(token: string): "aal1" | "aal2" {
  try {
    const payload = JSON.parse(atob(token.split(".")[1]!.replace(/-/g, "+").replace(/_/g, "/"))) as { aal?: string };
    return payload.aal === "aal2" ? "aal2" : "aal1";
  } catch {
    return "aal1";
  }
}

function toSession(s: SupabaseSession | null): Session | null {
  if (!s) return null;
  return { userId: s.user.id, email: s.user.email ?? "", aal: aalOf(s.access_token), accessToken: s.access_token };
}

function fail(error: { message: string; status?: number }): never {
  const code = error.status === 429 ? "rate_limited" : /expired|invalid|otp/i.test(error.message) ? "invalid_code" : "unknown";
  throw new AuthError(error.message, code);
}

export function createSupabaseAuth(url: string, anonKey: string): AuthClient {
  const supabase: SupabaseClient = createClient(url, anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });

  const current = async (): Promise<Session> => {
    const { data } = await supabase.auth.getSession();
    const session = toSession(data.session);
    if (!session) throw new AuthError("Not signed in", "unknown");
    return session;
  };

  return {
    async getSession() {
      const { data } = await supabase.auth.getSession();
      return toSession(data.session);
    },
    onChange(cb) {
      const { data } = supabase.auth.onAuthStateChange((_event, session) => cb(toSession(session)));
      return () => data.subscription.unsubscribe();
    },
    async sendCode(email) {
      const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: `${window.location.origin}/signin` } });
      if (error) fail(error);
    },
    async verifyCode(email, code) {
      const { data, error } = await supabase.auth.verifyOtp({ email, token: code, type: "email" });
      if (error) fail(error);
      const session = toSession(data.session);
      if (!session) throw new AuthError("That code didn't match.", "invalid_code");
      return session;
    },
    async redeemSignIn(tokenHash, type) {
      // The API issues a magic-link token; `signup` is what Supabase calls the same thing for an
      // address it has not seen confirmed. Anything else is not a sign-in and is refused here.
      if (type !== "magiclink" && type !== "signup") throw new AuthError("That sign-in is not valid.", "invalid_code");
      const { data, error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: type === "signup" ? "signup" : "magiclink" });
      if (error) fail(error);
      const session = toSession(data.session);
      if (!session) throw new AuthError("That sign-in has expired.", "invalid_code");
      return session;
    },
    async listTotpFactors() {
      const { data, error } = await supabase.auth.mfa.listFactors();
      if (error) fail(error);
      return data.totp.filter((f) => f.status === "verified").map((f) => f.id);
    },
    async enrollTotp(): Promise<TotpEnrollment> {
      const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp" });
      if (error) fail(error);
      return { factorId: data.id, secret: data.totp.secret, uri: data.totp.uri, qrCode: data.totp.qr_code };
    },
    async verifyTotp(factorId, code) {
      const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
      if (error) fail(error);
      return current();
    },
    async signOut() {
      await supabase.auth.signOut();
    },
  };
}
