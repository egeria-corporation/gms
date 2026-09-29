// SPDX-License-Identifier: AGPL-3.0-or-later
// Supabase Storage with the service role. Every bucket is private; the browser only ever gets short-lived
// signed URLs (uploads via createSignedUploadUrl, downloads via createSignedUrl). Object keys are validated
// with the same rules as local storage (no traversal, restricted charset).
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Bucket, SignedUpload, Storage, StoredObject } from '../types';
import { safeKey } from './local';

export const BUCKET_LIMITS: Record<Bucket, { fileSizeLimit: number; allowedMimeTypes?: string[] }> = {
  applications: { fileSizeLimit: 25 * 1024 * 1024 },
  'org-documents': { fileSizeLimit: 25 * 1024 * 1024 },
  brand: { fileSizeLimit: 5 * 1024 * 1024, allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml', 'image/x-icon'] },
  exports: { fileSizeLimit: 200 * 1024 * 1024 },
  agreements: { fileSizeLimit: 25 * 1024 * 1024 },
  reports: { fileSizeLimit: 25 * 1024 * 1024 },
};

/** Supabase signed upload URLs are valid for two hours (not configurable). */
const SIGNED_UPLOAD_TTL_S = 2 * 60 * 60;

export type StorageApi = SupabaseClient['storage'];

export interface SupabaseStorageOptions {
  url?: string;
  serviceRoleKey?: string;
  /** Injected storage API (tests). */
  storage?: StorageApi;
}

export class StorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StorageError';
  }
}

function isNotFound(err: { message?: string; statusCode?: string | number; status?: number } | null): boolean {
  if (!err) return false;
  const status = String(err.statusCode ?? err.status ?? '');
  return status === '404' || /not.?found|does not exist/i.test(err.message ?? '');
}

export class SupabaseStorage implements Storage {
  readonly name = 'supabase-storage' as const;
  private readonly storage: StorageApi;

  constructor(opts: SupabaseStorageOptions = {}) {
    if (opts.storage) {
      this.storage = opts.storage;
      return;
    }
    const url = opts.url ?? process.env.SUPABASE_URL;
    const key = opts.serviceRoleKey ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new StorageError('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for Supabase Storage');
    this.storage = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }).storage;
  }

  private bucket(bucket: Bucket) {
    if (!(bucket in BUCKET_LIMITS)) throw new StorageError(`unknown bucket: ${bucket}`);
    return this.storage.from(bucket);
  }

  /** Creates missing buckets as private with size limits, and forces existing ones private. */
  async ensureBuckets(): Promise<{ created: Bucket[]; updated: Bucket[] }> {
    const created: Bucket[] = [];
    const updated: Bucket[] = [];
    for (const [name, limits] of Object.entries(BUCKET_LIMITS) as [Bucket, (typeof BUCKET_LIMITS)[Bucket]][]) {
      const options = { public: false, fileSizeLimit: limits.fileSizeLimit, allowedMimeTypes: limits.allowedMimeTypes ?? null };
      const existing = await this.storage.getBucket(name);
      if (existing.data) {
        const b = existing.data;
        if (b.public || b.file_size_limit !== limits.fileSizeLimit) {
          const r = await this.storage.updateBucket(name, options);
          if (r.error) throw new StorageError(`could not update bucket ${name}: ${r.error.message}`);
          updated.push(name);
        }
        continue;
      }
      const r = await this.storage.createBucket(name, options);
      if (r.error) throw new StorageError(`could not create bucket ${name}: ${r.error.message}`);
      created.push(name);
    }
    return { created, updated };
  }

  async createSignedUploadUrl(
    bucket: Bucket,
    key: string,
    opts: { contentType: string; maxBytes: number; expiresInSeconds?: number },
  ): Promise<SignedUpload> {
    const path = safeKey(key);
    if (opts.maxBytes > BUCKET_LIMITS[bucket].fileSizeLimit) {
      throw new StorageError(`maxBytes exceeds the ${bucket} bucket limit`);
    }
    const r = await this.bucket(bucket).createSignedUploadUrl(path, { upsert: false });
    if (r.error || !r.data) throw new StorageError(`could not sign upload: ${r.error?.message ?? 'unknown error'}`);
    return {
      url: r.data.signedUrl,
      method: 'PUT',
      headers: { 'content-type': opts.contentType, 'x-upsert': 'false' },
      // The bucket's file size limit enforces maxBytes server-side; the app re-checks size after upload.
      expiresAt: new Date(Date.now() + Math.min(opts.expiresInSeconds ?? SIGNED_UPLOAD_TTL_S, SIGNED_UPLOAD_TTL_S) * 1000).toISOString(),
      path: `${bucket}/${path}`,
    };
  }

  async createSignedDownloadUrl(bucket: Bucket, key: string, opts: { expiresInSeconds?: number; fileName?: string } = {}): Promise<string> {
    const path = safeKey(key);
    const r = await this.bucket(bucket).createSignedUrl(path, Math.max(1, Math.min(opts.expiresInSeconds ?? 300, 3600)), {
      download: opts.fileName ?? false,
    });
    if (r.error || !r.data) throw new StorageError(`could not sign download: ${r.error?.message ?? 'unknown error'}`);
    return r.data.signedUrl;
  }

  async put(bucket: Bucket, key: string, body: Uint8Array, contentType: string): Promise<void> {
    const r = await this.bucket(bucket).upload(safeKey(key), body, { contentType, upsert: true });
    if (r.error) throw new StorageError(`upload failed: ${r.error.message}`);
  }

  async get(bucket: Bucket, key: string): Promise<Uint8Array | null> {
    const r = await this.bucket(bucket).download(safeKey(key));
    if (r.error || !r.data) {
      if (isNotFound(r.error)) return null;
      throw new StorageError(`download failed: ${r.error?.message ?? 'unknown error'}`);
    }
    return new Uint8Array(await r.data.arrayBuffer());
  }

  async head(bucket: Bucket, key: string): Promise<StoredObject | null> {
    const r = await this.bucket(bucket).info(safeKey(key));
    if (r.error || !r.data) {
      if (isNotFound(r.error)) return null;
      throw new StorageError(`info failed: ${r.error?.message ?? 'unknown error'}`);
    }
    const meta = (r.data.metadata ?? {}) as { size?: number; mimetype?: string };
    return {
      size: r.data.size ?? meta.size ?? 0,
      contentType: r.data.contentType ?? meta.mimetype ?? 'application/octet-stream',
    };
  }

  async delete(bucket: Bucket, key: string): Promise<void> {
    const r = await this.bucket(bucket).remove([safeKey(key)]);
    if (r.error) throw new StorageError(`delete failed: ${r.error.message}`);
  }
}
