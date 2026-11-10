// SPDX-License-Identifier: AGPL-3.0-only
// File storage port (build spec §4: Supabase Storage for small files, R2 for larger ones and
// archives) and the SHA-256 every stored file carries. Bytes only: metadata lives in `documents`.

export interface StoredFile {
  storage: "supabase" | "r2";
  path: string;
}

export interface FileStorage {
  /** Store the bytes under `path`; returns where they went. */
  put(path: string, bytes: Uint8Array, mime: string): Promise<StoredFile>;
  get(file: StoredFile): Promise<Uint8Array | null>;
}

export class MemoryFileStorage implements FileStorage {
  readonly files = new Map<string, { bytes: Uint8Array; mime: string }>();
  async put(path: string, bytes: Uint8Array, mime: string): Promise<StoredFile> {
    this.files.set(path, { bytes, mime });
    return { storage: "r2", path };
  }
  async get(file: StoredFile): Promise<Uint8Array | null> {
    return this.files.get(file.path)?.bytes ?? null;
  }
}

/** The part of a Workers `R2Bucket` this package uses. */
export interface R2BucketLike {
  put(key: string, value: Uint8Array, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
}

export class R2FileStorage implements FileStorage {
  constructor(private readonly bucket: R2BucketLike) {}
  async put(path: string, bytes: Uint8Array, mime: string): Promise<StoredFile> {
    await this.bucket.put(path, bytes, { httpMetadata: { contentType: mime } });
    return { storage: "r2", path };
  }
  async get(file: StoredFile): Promise<Uint8Array | null> {
    const obj = await this.bucket.get(file.path);
    return obj ? new Uint8Array(await obj.arrayBuffer()) : null;
  }
}

/** The part of a Supabase client's Storage API this package uses. */
export interface SupabaseStorageLike {
  storage: {
    from(bucket: string): {
      upload(path: string, body: Uint8Array, options?: { contentType?: string; upsert?: boolean }): Promise<{ error: { message: string } | null }>;
      download(path: string): Promise<{ data: { arrayBuffer(): Promise<ArrayBuffer> } | null; error: { message: string } | null }>;
    };
  };
}

export class StorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StorageError";
  }
}

/** Supabase Storage, for installs without R2 and for files up to 25 MB. */
export class SupabaseFileStorage implements FileStorage {
  constructor(
    private readonly client: SupabaseStorageLike,
    private readonly bucket: string = "attachments",
  ) {}
  async put(path: string, bytes: Uint8Array, mime: string): Promise<StoredFile> {
    const { error } = await this.client.storage.from(this.bucket).upload(path, bytes, { contentType: mime, upsert: true });
    if (error) throw new StorageError("The file could not be stored");
    return { storage: "supabase", path };
  }
  async get(file: StoredFile): Promise<Uint8Array | null> {
    const { data, error } = await this.client.storage.from(this.bucket).download(file.path);
    if (error || !data) return null;
    return new Uint8Array(await data.arrayBuffer());
  }
}

/** Files above this size go to R2 (build spec §4). */
export const SUPABASE_STORAGE_LIMIT_BYTES = 25 * 1024 * 1024;

/** Routes each file to the store that holds it: small files to Supabase Storage, the rest to R2. */
export class TieredFileStorage implements FileStorage {
  constructor(
    private readonly small: FileStorage | null,
    private readonly large: FileStorage,
    private readonly limitBytes: number = SUPABASE_STORAGE_LIMIT_BYTES,
  ) {}
  put(path: string, bytes: Uint8Array, mime: string): Promise<StoredFile> {
    return (this.small && bytes.byteLength <= this.limitBytes ? this.small : this.large).put(path, bytes, mime);
  }
  get(file: StoredFile): Promise<Uint8Array | null> {
    return (file.storage === "supabase" && this.small ? this.small : this.large).get(file);
  }
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>));
  let out = "";
  for (const b of digest) out += b.toString(16).padStart(2, "0");
  return out;
}
