// SPDX-License-Identifier: AGPL-3.0-only
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import { isSessionToken, sessionIssuer, verifySupabaseSession } from "../src/auth/session.ts";

const SUPABASE = "https://project.supabase.test";
const NOW = new Date("2027-04-20T12:00:00Z");
const iat = Math.floor(NOW.getTime() / 1000);

async function asymmetric() {
  const { publicKey, privateKey } = await generateKeyPair("ES256");
  const kid = "session-key-1";
  const keys = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), kid, alg: "ES256", use: "sig" }] });
  const sign = (claims: Record<string, unknown> = {}, key = privateKey) =>
    new SignJWT({ aal: "aal2", email: "person@riverbendcf.example", role: "authenticated", ...claims })
      .setProtectedHeader({ alg: "ES256", kid, typ: "JWT" })
      .setIssuer((claims.iss as string) ?? sessionIssuer(SUPABASE))
      .setSubject("0190a000-0000-7000-8000-0000000000aa")
      .setAudience((claims.aud as string) ?? "authenticated")
      .setIssuedAt(iat)
      .setExpirationTime((claims.exp as number) ?? iat + 3600)
      .sign(key);
  return { keys, sign };
}

describe("Supabase sessions", () => {
  it("accepts a session signed with the project's published asymmetric key", async () => {
    const { keys, sign } = await asymmetric();
    const token = await sign();
    expect(isSessionToken(token, SUPABASE)).toBe(true);
    const user = await verifySupabaseSession(token, { supabaseUrl: SUPABASE, keys }, NOW);
    expect(user).toEqual({ userId: "0190a000-0000-7000-8000-0000000000aa", email: "person@riverbendcf.example", aal: "aal2" });
  });

  it("refuses a session from another issuer, for another audience, expired, or signed by another key", async () => {
    const { keys, sign } = await asymmetric();
    const other = await generateKeyPair("ES256");
    const cases = [await sign({ iss: "https://elsewhere.test/auth/v1" }), await sign({ aud: "anon" }), await sign({ exp: iat - 600 }), await sign({}, other.privateKey)];
    for (const token of cases) {
      await expect(verifySupabaseSession(token, { supabaseUrl: SUPABASE, keys }, NOW)).rejects.toMatchObject({ status: 401, code: "invalid_session" });
    }
  });

  it("still accepts a legacy HS256 session when the project's JWT secret is configured", async () => {
    const secret = "legacy-session-secret-for-unit-tests";
    const token = await new SignJWT({ aal: "aal1" })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setSubject("0190a000-0000-7000-8000-0000000000bb")
      .setAudience("authenticated")
      .setIssuedAt(iat)
      .setExpirationTime(iat + 3600)
      .sign(new TextEncoder().encode(secret));
    expect(isSessionToken(token, SUPABASE)).toBe(true);
    await expect(verifySupabaseSession(token, { jwtSecret: secret }, NOW)).resolves.toMatchObject({ aal: "aal1" });
    await expect(verifySupabaseSession(token, { supabaseUrl: SUPABASE }, NOW)).rejects.toMatchObject({ code: "sessions_unavailable" });
  });

  it("does not mistake a GMS access token for a session", async () => {
    const { sign } = await asymmetric();
    expect(isSessionToken(await sign({ iss: "https://gms.test" }), SUPABASE)).toBe(false);
    expect(isSessionToken("not-a-jwt", SUPABASE)).toBe(false);
  });
});
