// SPDX-License-Identifier: AGPL-3.0-only
// The OAuth signing key (ES256) and the published JWKS. Keys are imported once per isolate and
// re-imported when the secrets change. Rotation: move the old public key into
// JWKS_EXTRA_PUBLIC_KEYS, set the new OAUTH_KID / OAUTH_SIGNING_KEY_JWK (docs/runbook.md).
import { importJWK, type JWK } from "jose";
import type { Env } from "../env.ts";

export interface KeyRing {
  kid: string;
  privateKey: CryptoKey;
  /** Everything published at /.well-known/jwks.json: the current key first, then retained rotations. */
  jwks: { keys: JWK[] };
}

export function toPublicJwk(jwk: JWK, kid: string): JWK {
  if (jwk.kty !== "EC" || jwk.crv !== "P-256" || !jwk.x || !jwk.y) throw new Error("signing key must be an EC P-256 JWK");
  return { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y, kid, use: "sig", alg: "ES256" };
}

function parseExtra(raw: string | undefined): JWK[] {
  if (!raw) return [];
  const parsed = JSON.parse(raw) as unknown;
  const keys = Array.isArray(parsed) ? parsed : (parsed as { keys?: unknown }).keys;
  if (!Array.isArray(keys)) throw new Error("JWKS_EXTRA_PUBLIC_KEYS must be a JSON array of public JWKs");
  return keys.map((k: JWK) => {
    if (!k.kid) throw new Error("every extra public key needs a kid");
    if ("d" in k) throw new Error("JWKS_EXTRA_PUBLIC_KEYS must hold public keys only");
    return toPublicJwk(k, k.kid);
  });
}

async function load(env: Env): Promise<KeyRing> {
  if (!env.OAUTH_SIGNING_KEY_JWK || !env.OAUTH_KID) throw new Error("OAuth signing key is not configured");
  const jwk = JSON.parse(env.OAUTH_SIGNING_KEY_JWK) as JWK;
  if (!jwk.d) throw new Error("OAUTH_SIGNING_KEY_JWK must be a private key");
  const privateKey = (await importJWK(jwk, "ES256")) as CryptoKey;
  return { kid: env.OAUTH_KID, privateKey, jwks: { keys: [toPublicJwk(jwk, env.OAUTH_KID), ...parseExtra(env.JWKS_EXTRA_PUBLIC_KEYS)] } };
}

let cached: { source: string; ring: Promise<KeyRing> } | undefined;

export function keyRing(env: Env): Promise<KeyRing> {
  const source = `${env.OAUTH_KID}|${env.OAUTH_SIGNING_KEY_JWK}|${env.JWKS_EXTRA_PUBLIC_KEYS ?? ""}`;
  if (!cached || cached.source !== source) {
    const ring = load(env);
    ring.catch(() => {
      if (cached?.ring === ring) cached = undefined;
    });
    cached = { source, ring };
  }
  return cached.ring;
}
