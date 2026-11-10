// SPDX-License-Identifier: AGPL-3.0-only
// AES-GCM for tenant secrets at rest: a funder's Passport client secret and an applicant's refresh
// token. The key is CREDENTIALS_ENCRYPTION_KEY (32 bytes, base64url). Ciphertext format matches
// Passport's webhook-secret format: `v1.<iv>.<ciphertext>`, both base64url.

const enc = new TextEncoder();

export function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromB64url(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function aesKey(keyB64: string): Promise<CryptoKey> {
  let raw: Uint8Array<ArrayBuffer>;
  try {
    raw = fromB64url(keyB64);
  } catch {
    raw = new Uint8Array(0);
  }
  if (raw.length !== 32) throw new Error("CREDENTIALS_ENCRYPTION_KEY must be 32 bytes, base64url");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptSecret(plaintext: string, keyB64: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(keyB64), enc.encode(plaintext));
  return `v1.${b64url(iv)}.${b64url(new Uint8Array(ct))}`;
}

export async function decryptSecret(ciphertext: string, keyB64: string): Promise<string> {
  const [v, iv, ct] = ciphertext.split(".");
  if (v !== "v1" || !iv || !ct) throw new Error("unsupported secret ciphertext");
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64url(iv) }, await aesKey(keyB64), fromB64url(ct));
  return new TextDecoder().decode(pt);
}
