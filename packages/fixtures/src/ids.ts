// SPDX-License-Identifier: AGPL-3.0-or-later
// Stable, name-derived UUIDs (RFC 4122 version-5 layout over SHA-1), so seeded rows keep the same ids across runs.
import { createHash } from 'node:crypto';

/** GMS seed namespace (a fixed random UUID). */
const NAMESPACE = Buffer.from('6f2d3c1e8a4b4f7a9c0d5e6f7a8b9c0d', 'hex');

/** Deterministic UUID for a seed entity, e.g. sid('org:eastside-youth-music'). */
export function sid(name: string): string {
  const h = createHash('sha1').update(NAMESPACE).update(name).digest();
  h[6] = (h[6]! & 0x0f) | 0x50;
  h[8] = (h[8]! & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}

/** Deterministic lowercase hex (e.g. for content hashes of placeholder documents). */
export function hexOf(name: string, length = 64): string {
  let out = '';
  let i = 0;
  while (out.length < length) out += createHash('sha256').update(`${name}#${i++}`).digest('hex');
  return out.slice(0, length);
}
