// SPDX-License-Identifier: AGPL-3.0-only
// Reading a system's zip of PDFs and files in the browser: the list of paths (to match them), then
// one file at a time (to attach it). fflate, plain JavaScript. Kept on its own entry
// (`@gms/importers/zip`) so only the import screen loads it. Paths only are read for matching; a
// file's bytes are read only to send that one file to the record it matched.
import { unzipSync } from "fflate";
import { isIgnoredPath, MAX_ATTACHMENT_BYTES } from "./attachments.ts";

export interface ZipEntry {
  path: string;
  /** Uncompressed size in bytes. */
  size: number;
}

/** Every file in the zip (folders and the files a zip tool adds left out). */
export function listZip(bytes: Uint8Array): ZipEntry[] {
  const out: ZipEntry[] = [];
  try {
    unzipSync(bytes, {
      filter: (f) => {
        if (!isIgnoredPath(f.name)) out.push({ path: f.name, size: f.originalSize });
        return false;
      },
    });
  } catch {
    throw new Error("The zip file could not be read");
  }
  return out;
}

/** One file's bytes, or null when it is not in the zip or is larger than an attachment may be. */
export function readZipEntry(bytes: Uint8Array, path: string): Uint8Array | null {
  const files = unzipSync(bytes, { filter: (f) => f.name === path && f.originalSize <= MAX_ATTACHMENT_BYTES });
  return files[path] ?? null;
}
