// SPDX-License-Identifier: AGPL-3.0-only
import { createClient, type Session as SupabaseSession, type SupabaseClient } from "@supabase/supabase-js";
import { emailDomain } from "./sso.ts";
import { AuthError, type AuthClient, type Session, type TotpEnrollment } from "./types.ts";

function claimsOf(token: string): { aal?: unknown; amr?: unknown } {
  try {
    return JSON.parse(atob(token.split(".")[1]!.replace(/-/g, "+").replace(/_/g, "/"))) as { aal?: unknown; amr?: unknown };
  } catch {
    return {};
  }
}

const aalOf = (claims: { aal?: unknown }): "aal1" | "aal2" => (claims.aal === "aal2" ? "aal2" : "aal1");

/** The identity provider of the session's latest `sso/saml` sign-in (any position in `amr`: two-step verification may come first). */
export function ssoProviderOf(amr: unknown): string | null {
  if (!Array.isArray(amr)) return null;
  for (const e of amr) {
    const entry = (e ?? {}) as { method?: unknown; provider?: unknown };
    if (entry.method === "sso/saml" && typeof entry.provider === "string") return entry.provider;
  }
  return null;
}

function toSession(s: SupabaseSession | null): Session | null {
  if (!s) return null;
  const claims = claimsOf(s.access_token);
  const sso = ssoProviderOf(claims.amr);
  return { userId: s.user.id, email: s.user.email ?? "", aal: aalOf(claims), accessToken: s.access_token, ...(sso ? { ssoProviderId: sso } : {}) };
}

/** Where single sign-on comes back to: the sign-in page, which the redirect allow list already holds for email links. */
export const ssoRedirectTo = (origin: string) => `${origin}/signin`;

function fail(error: { message: string; status?: number }): never {
  const code = error.status === 429 ? "rate_limited" : /expired|invalid|otp/i.test(error.message) ? "invalid_code" : "unknown";
  throw new AuthError(error.message, code);
}

/** The name authenticator apps show for the two-step verification entry. */
export const TOTP_ISSUER = "OpenGrants";
/** A real name, so a second enrollment is not refused for an empty friendly name. */
export const TOTP_FRIENDLY_NAME = "Authenticator";

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

  // `data.totp` is verified factors only. An interrupted enrollment lives in `data.all`.
  const listAll = async () => {
    const { data, error } = await supabase.auth.mfa.listFactors();
    if (error) fail(error);
    return (data.all ?? []).flatMap((f) => (f.factor_type === "totp" ? [{ id: f.id, status: f.status === "verified" ? ("verified" as const) : ("unverified" as const) }] : []));
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
    listAllTotpFactors: listAll,
    async listTotpFactors() {
      return (await listAll()).filter((f) => f.status === "verified").map((f) => f.id);
    },
    async unenrollTotp(factorId) {
      const { error } = await supabase.auth.mfa.unenroll({ factorId });
      if (error) fail(error);
    },
    async enrollTotp(): Promise<TotpEnrollment> {
      const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", issuer: TOTP_ISSUER, friendlyName: TOTP_FRIENDLY_NAME });
      if (error) fail(error);
      return { factorId: data.id, secret: data.totp.secret, uri: data.totp.uri, qrCode: data.totp.qr_code };
    },
    async verifyTotp(factorId, code) {
      const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
      if (error) fail(error);
      return current();
    },
    async signInWithSSO(workEmail) {
      const domain = emailDomain(workEmail);
      if (!domain) throw new AuthError("Enter your work email address.");
      const { data, error } = await supabase.auth.signInWithSSO({ domain, options: { redirectTo: ssoRedirectTo(window.location.origin), skipBrowserRedirect: true } });
      if (error) {
        const code = (error as { code?: string }).code;
        if (error.status === 404 || code === "sso_provider_not_found") throw new AuthError(`Single sign-on is not set up for ${domain}. Sign in with an email code instead, or ask your IT team.`, "no_sso");
        if (code === "sso_provider_disabled") throw new AuthError(`Single sign-on for ${domain} is switched off right now. Sign in with an email code instead, or ask your IT team.`, "no_sso");
        fail(error);
      }
      if (!data?.url) throw new AuthError("Single sign-on could not be started. Try again.", "unknown");
      window.location.assign(data.url);
    },
    async signOut() {
      await supabase.auth.signOut();
    },
  };
}
