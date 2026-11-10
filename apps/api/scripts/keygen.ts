// SPDX-License-Identifier: AGPL-3.0-only
// Generate an ES256 signing key for the GMS OAuth server.
//   pnpm --filter @gms/api keygen
// Prints the two values to set as secrets (OAUTH_KID, OAUTH_SIGNING_KEY_JWK) and the public JWK to
// keep in JWKS_EXTRA_PUBLIC_KEYS when this key is later rotated out. Nothing is written to disk.
import { exportJWK, generateKeyPair } from "jose";

const { privateKey, publicKey } = await generateKeyPair("ES256", { extractable: true });
const kid = `oauth-${new Date().toISOString().slice(0, 10)}-${crypto.randomUUID().slice(0, 8)}`;
const priv = await exportJWK(privateKey);
const pub = { ...(await exportJWK(publicKey)), kid, use: "sig", alg: "ES256" };

console.log("# Set these as Wrangler secrets (wrangler secret put …) or in .dev.vars. Do not commit them.\n");
console.log(`OAUTH_KID=${kid}`);
console.log(`OAUTH_SIGNING_KEY_JWK=${JSON.stringify(priv)}`);
console.log("\n# Public key (safe to share). Add to JWKS_EXTRA_PUBLIC_KEYS when you rotate this key out:");
console.log(JSON.stringify(pub));
