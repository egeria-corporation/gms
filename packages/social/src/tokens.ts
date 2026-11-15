// SPDX-License-Identifier: AGPL-3.0-only
// WebCrypto helpers: HMAC-SHA256 and SHA-256 in hex, a constant-time compare, a canonical JSON
// form for hashing, and short sealed tokens (a JSON payload with an expiry, signed with HMAC) that
// the GMS issues to itself: the connect state and the preview token.

const enc = new TextEncoder();

const hex = (buf: ArrayBuffer): string => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");

export async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, enc.encode(message)));
}

export async function sha256Hex(message: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", enc.encode(message)));
}

/** Equal strings in time that does not depend on where they first differ. */
export function constantTimeEqual(a: string, b: string): boolean {
  const ea = enc.encode(a);
  const eb = enc.encode(b);
  let diff = ea.length ^ eb.length;
  for (let i = 0; i < Math.max(ea.length, eb.length); i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return diff === 0;
}

/** JSON with object keys sorted at every level, so equal values hash equally. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

const b64url = (s: string) => btoa(String.fromCharCode(...enc.encode(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
function fromB64url(s: string): string | null {
  try {
    const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
    return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  } catch {
    return null;
  }
}

/**
 * A token `v1.<payload>.<mac>`: the payload (with `exp`, seconds since the epoch) in base64url and
 * an HMAC-SHA256 over the label and the payload. The label keeps a token of one kind from being
 * accepted as another.
 */
export async function sealToken(key: string, label: string, payload: Record<string, unknown>, expiresAt: Date): Promise<string> {
  const body = b64url(JSON.stringify({ ...payload, exp: Math.floor(expiresAt.getTime() / 1000) }));
  return `v1.${body}.${await hmacHex(key, `${label}.${body}`)}`;
}

/** The payload of a token this server sealed with `label`, or null when forged, altered or expired. */
export async function openToken<T extends Record<string, unknown>>(key: string, label: string, token: string, now: Date): Promise<(T & { exp: number }) | null> {
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1" || !parts[1] || !parts[2] || token.length > 4000) return null;
  if (!constantTimeEqual(await hmacHex(key, `${label}.${parts[1]}`), parts[2])) return null;
  const text = fromB64url(parts[1]);
  if (!text) return null;
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    return null;
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const exp = (payload as { exp?: unknown }).exp;
  if (typeof exp !== "number" || exp * 1000 <= now.getTime()) return null;
  return payload as T & { exp: number };
}
