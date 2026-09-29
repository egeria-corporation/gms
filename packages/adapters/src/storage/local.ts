// SPDX-License-Identifier: AGPL-3.0-or-later
// Local-filesystem storage for development and tier 3. Private by default: objects are only reachable through
// short-lived HMAC-signed URLs served by the app's /api/storage/object route.
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, normalize, sep } from 'node:path';
import { repoRoot } from '@gms/db';
import { signToken, verifyToken } from '../crypto';
import type { Bucket, SignedUpload, Storage, StoredObject } from '../types';

export interface StorageTokenPayload extends Record<string, unknown> {
  op: 'put' | 'get';
  b: Bucket;
  k: string;
  ct?: string;
  max?: number;
  fn?: string;
}

const BUCKETS: readonly Bucket[] = ['applications', 'org-documents', 'brand', 'exports', 'agreements', 'reports'];

export function safeKey(key: string): string {
  const n = normalize(key).replace(/\\/g, '/');
  if (n.startsWith('/') || n.startsWith('..') || n.includes('/../') || n.includes('\0') || !/^[A-Za-z0-9._\-/]+$/.test(n)) {
    throw new Error(`invalid storage key: ${key}`);
  }
  return n;
}

export class LocalStorage implements Storage {
  readonly name = 'local-filesystem' as const;
  constructor(private readonly root = process.env.GMS_STORAGE_DIR ?? join(repoRoot(), '.gms', 'storage')) {}

  private file(bucket: Bucket, key: string): string {
    if (!BUCKETS.includes(bucket)) throw new Error(`unknown bucket: ${bucket}`);
    const p = join(this.root, bucket, ...safeKey(key).split('/'));
    if (!p.startsWith(join(this.root, bucket) + sep)) throw new Error('path escapes bucket');
    return p;
  }

  async createSignedUploadUrl(
    bucket: Bucket,
    key: string,
    opts: { contentType: string; maxBytes: number; expiresInSeconds?: number },
  ): Promise<SignedUpload> {
    const ttl = opts.expiresInSeconds ?? 600;
    const token = signToken('storage', { op: 'put', b: bucket, k: safeKey(key), ct: opts.contentType, max: opts.maxBytes }, ttl);
    return {
      url: `/api/storage/object?token=${encodeURIComponent(token)}`,
      method: 'PUT',
      headers: { 'content-type': opts.contentType },
      expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
      path: `${bucket}/${key}`,
    };
  }

  async createSignedDownloadUrl(bucket: Bucket, key: string, opts: { expiresInSeconds?: number; fileName?: string } = {}): Promise<string> {
    const token = signToken(
      'storage',
      { op: 'get', b: bucket, k: safeKey(key), ...(opts.fileName ? { fn: opts.fileName } : {}) },
      opts.expiresInSeconds ?? 300,
    );
    return `/api/storage/object?token=${encodeURIComponent(token)}`;
  }

  async put(bucket: Bucket, key: string, body: Uint8Array, contentType: string): Promise<void> {
    const f = this.file(bucket, key);
    await mkdir(dirname(f), { recursive: true });
    await writeFile(f, body);
    await writeFile(`${f}.meta.json`, JSON.stringify({ contentType, size: body.byteLength }));
  }

  async get(bucket: Bucket, key: string): Promise<Uint8Array | null> {
    try {
      return new Uint8Array(await readFile(this.file(bucket, key)));
    } catch {
      return null;
    }
  }

  async head(bucket: Bucket, key: string): Promise<StoredObject | null> {
    try {
      const f = this.file(bucket, key);
      const s = await stat(f);
      let contentType = 'application/octet-stream';
      try {
        contentType = (JSON.parse(await readFile(`${f}.meta.json`, 'utf8')) as { contentType: string }).contentType;
      } catch {
        /* no metadata */
      }
      return { size: s.size, contentType };
    } catch {
      return null;
    }
  }

  async delete(bucket: Bucket, key: string): Promise<void> {
    const f = this.file(bucket, key);
    await rm(f, { force: true });
    await rm(`${f}.meta.json`, { force: true });
  }
}

/** Used by the app's /api/storage/object route to authorize a signed request. */
export function verifyStorageToken(token: string): StorageTokenPayload | null {
  const p = verifyToken<StorageTokenPayload>('storage', token);
  if (!p || (p.op !== 'put' && p.op !== 'get') || !BUCKETS.includes(p.b)) return null;
  try {
    safeKey(p.k);
  } catch {
    return null;
  }
  return p;
}
