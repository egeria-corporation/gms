// SPDX-License-Identifier: AGPL-3.0-only
// Small WebCrypto helpers shared by the OAuth server: hashing, random tokens, PKCE, constant-time compare.

export function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function sha256b64url(input: string): Promise<string> {
  return b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input))));
}

/** 32 random bytes, base64url, with a recognizable prefix so the log redactor and secret scanners can spot it. */
export function randomToken(prefix: string): string {
  return `${prefix}${b64url(crypto.getRandomValues(new Uint8Array(32)))}`;
}

export function timingSafeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  let diff = ea.length ^ eb.length;
  for (let i = 0; i < Math.max(ea.length, eb.length); i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return diff === 0;
}

// Client secrets, codes and refresh tokens are 32 random bytes, so one SHA-256 is enough (no password KDF).
const HASH_PREFIX = "sha256$";
export const hashSecret = async (secret: string) => HASH_PREFIX + (await sha256b64url(secret));
export async function verifySecret(secret: string, storedHash: string): Promise<boolean> {
  return storedHash.startsWith(HASH_PREFIX) && timingSafeEqual(await hashSecret(secret), storedHash);
}

export const generateClientSecret = () => randomToken("gms_cs_");
export const generateRefreshToken = () => randomToken("gms_rt_");
export const generateAuthCode = () => randomToken("gms_ac_");

/** RFC 7636 §4.1: 43–128 chars of [A-Z a-z 0-9 - . _ ~]. */
export const VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/;
/** S256 challenge: base64url SHA-256 (43 chars). */
export const CHALLENGE = /^[A-Za-z0-9_-]{43}$/;

/** RFC 7636 §4.6, S256 only. */
export async function verifyPkce(verifier: string, challenge: string): Promise<boolean> {
  return VERIFIER.test(verifier) && timingSafeEqual(await sha256b64url(verifier), challenge);
}
