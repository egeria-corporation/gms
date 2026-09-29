// SPDX-License-Identifier: AGPL-3.0-or-later
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { signToken } from '../src/crypto';
import { LocalStorage, safeKey, verifyStorageToken } from '../src/storage/local';
import { BUCKET_LIMITS, SupabaseStorage, type StorageApi } from '../src/storage/supabase';

function tokenOf(url: string): string {
  return decodeURIComponent(new URL(url, 'http://x').searchParams.get('token')!);
}

describe('LocalStorage', () => {
  let dir: string;
  let s: LocalStorage;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'gms-storage-'));
    s = new LocalStorage(dir);
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('stores, reads, heads and deletes objects', async () => {
    await s.put('applications', 'ws1/app1/budget.pdf', new Uint8Array([1, 2, 3]), 'application/pdf');
    expect(await s.get('applications', 'ws1/app1/budget.pdf')).toEqual(new Uint8Array([1, 2, 3]));
    expect(await s.head('applications', 'ws1/app1/budget.pdf')).toEqual({ size: 3, contentType: 'application/pdf' });
    await s.delete('applications', 'ws1/app1/budget.pdf');
    expect(await s.get('applications', 'ws1/app1/budget.pdf')).toBeNull();
  });

  it('issues signed tokens that verify, bound to op/bucket/key', async () => {
    const up = await s.createSignedUploadUrl('org-documents', 'org/990.pdf', { contentType: 'application/pdf', maxBytes: 1000 });
    expect(verifyStorageToken(tokenOf(up.url))).toMatchObject({ op: 'put', b: 'org-documents', k: 'org/990.pdf', ct: 'application/pdf', max: 1000 });
    const down = await s.createSignedDownloadUrl('org-documents', 'org/990.pdf', { fileName: '990.pdf' });
    expect(verifyStorageToken(tokenOf(down))).toMatchObject({ op: 'get', fn: '990.pdf' });
  });

  it('rejects tampered tokens', async () => {
    const down = await s.createSignedDownloadUrl('exports', 'ws1/report.csv');
    const token = tokenOf(down);
    const [body, sig] = token.split('.');
    const payload = JSON.parse(Buffer.from(body!, 'base64url').toString()) as Record<string, unknown>;
    const forged = Buffer.from(JSON.stringify({ ...payload, k: 'ws2/report.csv' })).toString('base64url');
    expect(verifyStorageToken(`${forged}.${sig!}`)).toBeNull();
    expect(verifyStorageToken(`${body!}.${sig!.slice(0, -2)}xx`)).toBeNull();
    expect(verifyStorageToken('garbage')).toBeNull();
    // A token for another purpose does not verify as a storage token.
    expect(verifyStorageToken(signToken('other', { op: 'get', b: 'exports', k: 'a' }, 60))).toBeNull();
  });

  it('rejects expired tokens', async () => {
    const expired = signToken('storage', { op: 'get', b: 'exports', k: 'a.csv' }, 60, Date.now() - 120_000);
    expect(verifyStorageToken(expired)).toBeNull();
  });

  it('rejects path traversal and unknown buckets', async () => {
    for (const bad of ['../etc/passwd', 'a/../../b', '/abs/path', 'a\0b', 'a/../../../x', 'spaces are bad']) {
      expect(() => safeKey(bad)).toThrow();
    }
    await expect(s.put('applications', '../../escape.txt', new Uint8Array([1]), 'text/plain')).rejects.toThrow();
    // @ts-expect-error unknown bucket
    await expect(s.put('secrets', 'a.txt', new Uint8Array([1]), 'text/plain')).rejects.toThrow(/unknown bucket/);
    const forged = signToken('storage', { op: 'get', b: 'exports', k: '../x' }, 60);
    expect(verifyStorageToken(forged)).toBeNull();
    const forgedBucket = signToken('storage', { op: 'get', b: 'secrets', k: 'x' }, 60);
    expect(verifyStorageToken(forgedBucket)).toBeNull();
  });
});

describe('SupabaseStorage', () => {
  function fakeApi() {
    const buckets = new Map<string, { public: boolean; file_size_limit: number | null }>([['brand', { public: true, file_size_limit: null }]]);
    const objects = new Map<string, { data: Uint8Array; contentType: string }>();
    const calls: string[] = [];
    const api = {
      getBucket: async (name: string) => {
        const b = buckets.get(name);
        return b ? { data: { id: name, name, ...b }, error: null } : { data: null, error: { message: 'Bucket not found' } };
      },
      createBucket: async (name: string, o: { public: boolean; fileSizeLimit: number }) => {
        calls.push(`create ${name} public=${o.public} limit=${o.fileSizeLimit}`);
        buckets.set(name, { public: o.public, file_size_limit: o.fileSizeLimit });
        return { data: { name }, error: null };
      },
      updateBucket: async (name: string, o: { public: boolean; fileSizeLimit: number }) => {
        calls.push(`update ${name} public=${o.public}`);
        buckets.set(name, { public: o.public, file_size_limit: o.fileSizeLimit });
        return { data: { message: 'ok' }, error: null };
      },
      from: (bucket: string) => ({
        createSignedUploadUrl: async (path: string) => ({ data: { signedUrl: `https://sb.example/upload/${bucket}/${path}?token=t`, token: 't', path }, error: null }),
        createSignedUrl: async (path: string, expiresIn: number, o: { download: string | boolean }) => ({
          data: { signedUrl: `https://sb.example/sign/${bucket}/${path}?exp=${expiresIn}&dl=${String(o.download)}` },
          error: null,
        }),
        upload: async (path: string, data: Uint8Array, o: { contentType: string }) => {
          objects.set(`${bucket}/${path}`, { data, contentType: o.contentType });
          return { data: { path }, error: null };
        },
        download: async (path: string) => {
          const o = objects.get(`${bucket}/${path}`);
          return o ? { data: new Blob([o.data.slice()]), error: null } : { data: null, error: { message: 'Object not found', statusCode: '404' } };
        },
        info: async (path: string) => {
          const o = objects.get(`${bucket}/${path}`);
          return o ? { data: { size: o.data.byteLength, contentType: o.contentType }, error: null } : { data: null, error: { message: 'Object not found', statusCode: '404' } };
        },
        remove: async (paths: string[]) => {
          for (const p of paths) objects.delete(`${bucket}/${p}`);
          return { data: [], error: null };
        },
      }),
    };
    return { api: api as unknown as StorageApi, calls, buckets };
  }

  it('ensures private buckets with size limits', async () => {
    const { api, calls, buckets } = fakeApi();
    const s = new SupabaseStorage({ storage: api });
    const r = await s.ensureBuckets();
    expect(r.updated).toEqual(['brand']);
    expect(r.created).toHaveLength(5);
    expect(calls).toContain(`create applications public=false limit=${BUCKET_LIMITS.applications.fileSizeLimit}`);
    expect([...buckets.values()].every((b) => b.public === false)).toBe(true);
    expect((await s.ensureBuckets()).created).toEqual([]);
  });

  it('signs uploads/downloads and round-trips objects', async () => {
    const { api } = fakeApi();
    const s = new SupabaseStorage({ storage: api });
    const up = await s.createSignedUploadUrl('applications', 'ws/app/file.pdf', { contentType: 'application/pdf', maxBytes: 1024 });
    expect(up).toMatchObject({ method: 'PUT', path: 'applications/ws/app/file.pdf' });
    await expect(s.createSignedUploadUrl('brand', 'logo.png', { contentType: 'image/png', maxBytes: 50 * 1024 * 1024 })).rejects.toThrow(/limit/);
    await expect(s.createSignedUploadUrl('applications', '../x', { contentType: 'text/plain', maxBytes: 1 })).rejects.toThrow();
    expect(await s.createSignedDownloadUrl('applications', 'ws/app/file.pdf', { expiresInSeconds: 99_999, fileName: 'f.pdf' })).toContain('exp=3600&dl=f.pdf');
    await s.put('reports', 'r/1.pdf', new Uint8Array([9, 8]), 'application/pdf');
    expect(await s.get('reports', 'r/1.pdf')).toEqual(new Uint8Array([9, 8]));
    expect(await s.head('reports', 'r/1.pdf')).toEqual({ size: 2, contentType: 'application/pdf' });
    await s.delete('reports', 'r/1.pdf');
    expect(await s.get('reports', 'r/1.pdf')).toBeNull();
    expect(await s.head('reports', 'r/1.pdf')).toBeNull();
  });

  it('requires credentials', () => {
    const prev = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY };
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    try {
      expect(() => new SupabaseStorage()).toThrow(/SUPABASE_URL/);
    } finally {
      if (prev.url) process.env.SUPABASE_URL = prev.url;
      if (prev.key) process.env.SUPABASE_SERVICE_ROLE_KEY = prev.key;
    }
  });
});
