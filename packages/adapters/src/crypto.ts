// SPDX-License-Identifier: AGPL-3.0-or-later
// Symmetric crypto helpers: AES-256-GCM envelopes, purpose-bound HMAC tokens, hashing.
import { isInternetFacing, isProductionEnvironment } from '@gms/domain';
import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';

let masterKey: Buffer | null = null;

/**
 * 32-byte master key from GMS_ENCRYPTION_KEY (base64 or hex). In development a deterministic key is derived
 * so local data survives restarts; production refuses to start without a real key.
 */
export function getMasterKey(): Buffer {
  if (masterKey) return masterKey;
  const raw = process.env.GMS_ENCRYPTION_KEY?.trim();
  if (raw) {
    const buf = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
    if (buf.length !== 32) throw new Error('GMS_ENCRYPTION_KEY must be 32 bytes (64 hex chars or base64).');
    masterKey = buf;
    return buf;
  }
  if (isInternetFacing()) {
    throw new Error('GMS_ENCRYPTION_KEY is required on internet-facing deployments.');
  }
  masterKey = createHash('sha256').update('gms-development-key:do-not-use-in-production').digest();
  return masterKey;
}

/** True only for real production deployments (Netlify production context or GMS_ENV=production). */
export function isProductionDeploy(): boolean {
  return isProductionEnvironment();
}

/** Derives an independent key for a purpose (HKDF-SHA256). */
export function deriveKey(purpose: string, length = 32): Buffer {
  return Buffer.from(hkdfSync('sha256', getMasterKey(), Buffer.alloc(0), Buffer.from(`gms:${purpose}`), length));
}

export function encrypt(plaintext: string, purpose = 'secrets'): string {
  const key = deriveKey(purpose);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64url'), tag.toString('base64url'), ct.toString('base64url')].join('.');
}

export function decrypt(envelope: string, purpose = 'secrets'): string {
  const [v, iv, tag, ct] = envelope.split('.');
  if (v !== 'v1' || !iv || !tag || ct === undefined) throw new Error('invalid ciphertext envelope');
  const decipher = createDecipheriv('aes-256-gcm', deriveKey(purpose), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ct, 'base64url')), decipher.final()]).toString('utf8');
}

export function sha256Hex(input: string | Uint8Array): string {
  return createHash('sha256').update(input).digest('hex');
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function hmacHex(key: Buffer | string, data: string): string {
  return createHmac('sha256', key).update(data).digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Signs a JSON payload with an expiry, bound to a purpose. Format: base64url(payload).base64url(sig) */
export function signToken(purpose: string, payload: Record<string, unknown>, ttlSeconds: number, now = Date.now()): string {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(now / 1000) + ttlSeconds })).toString('base64url');
  const sig = createHmac('sha256', deriveKey(`token:${purpose}`)).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifyToken<T extends Record<string, unknown>>(purpose: string, token: string, now = Date.now()): (T & { exp: number }) | null {
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = createHmac('sha256', deriveKey(`token:${purpose}`)).update(body).digest('base64url');
  if (!safeEqual(sig, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as T & { exp: number };
    if (typeof payload.exp !== 'number' || payload.exp * 1000 < now) return null;
    return payload;
  } catch {
    return null;
  }
}
