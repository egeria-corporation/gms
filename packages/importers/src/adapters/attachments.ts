// SPDX-License-Identifier: AGPL-3.0-only
// PDFs and files from a system's zip, attached to the records an import created. A file is matched
// by the export's own id in its path (a folder or file named after the submission), else by the
// record's title, and only when exactly one record fits. Nothing here opens a file: matching reads
// paths only, and no file's contents are ever read by a model (no document AI).
//
// The run log keeps no source ids, only each row's key (a hash of the target, the source and the
// id; ../plan.ts). So a path's id-shaped tokens are hashed the same way and looked up by key: a
// file matches a row without the id ever being stored.
import { rowKey } from "../plan.ts";
import type { SourceKind } from "../table.ts";
import { fold } from "../values.ts";
import type { ImportAdapter } from "./types.ts";

/** At most this many paths are matched in one request. */
export const MAX_ATTACHMENT_PATHS = 2000;
/** A file larger than this is not attached (the GMS's attachment limit). */
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
/** Id-shaped tokens tried per path. */
const MAX_TOKENS = 40;

export interface AttachmentRow {
  line: number;
  /** The row's key in the run log. */
  key: string;
  title: string;
}

export interface AttachmentMatch {
  path: string;
  /** The file's own name (the last part of its path). */
  name: string;
  line: number;
  by: "id" | "title";
}

export interface AttachmentMiss {
  path: string;
  name: string;
  why: "no_match" | "ambiguous";
}

export const ATTACHMENT_MISS_TEXT: Record<AttachmentMiss["why"], string> = {
  no_match: "No imported record matches its name",
  ambiguous: "More than one imported record matches its name",
};

/** Folders, and the files a zip tool adds (macOS resource forks, .DS_Store), are not attachments. */
export const isIgnoredPath = (path: string): boolean => !path || path.endsWith("/") || path.split("/").some((p) => p === "__MACOSX" || p.startsWith("."));

export const baseName = (path: string): string => path.split("/").filter(Boolean).pop() ?? path;

/**
 * The key a row id gets in a run: the same as the dry run's (../plan.ts). A mapped Row ID column is
 * scoped to the source kind and column (an uploaded file) or the source itself; without one the
 * source's own record id is scoped to the source.
 */
export function idKey(target: string, source: { kind: SourceKind | string; ref: string | null }, idColumn: string | null) {
  const scope = idColumn ? (source.ref ?? `${source.kind}:${idColumn}`) : (source.ref ?? source.kind);
  return (id: string) => rowKey(target, { id, scope });
}

function tokens(adapter: ImportAdapter | null, path: string): string[] {
  const out = new Set<string>();
  const pattern = adapter?.attachments?.idPattern;
  if (pattern) {
    const g = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
    for (const m of path.matchAll(g)) if (m[1]) out.add(m[1]);
  }
  for (const t of path.split(/[^A-Za-z0-9_-]+/)) if (t.length >= 3 && t.length <= 64) out.add(t);
  // "12345 - Clinic van" and "12345_Clinic" both carry 12345.
  for (const t of path.split(/[^A-Za-z0-9]+/)) if (t.length >= 3 && t.length <= 64) out.add(t);
  return [...out].slice(0, MAX_TOKENS);
}

/** Match each path to one row, by id first and then by title. Paths a zip tool adds are left out. */
export async function matchAttachments(input: { adapter: ImportAdapter | null; paths: readonly string[]; rows: readonly AttachmentRow[]; keyOf: (id: string) => Promise<string> }): Promise<{ matched: AttachmentMatch[]; unmatched: AttachmentMiss[] }> {
  const byKey = new Map(input.rows.map((r) => [r.key, r.line]));
  const titleCount = new Map<string, number>();
  for (const r of input.rows) {
    const t = fold(r.title);
    if (t.length >= 4) titleCount.set(t, (titleCount.get(t) ?? 0) + 1);
  }
  const titles = input.rows.map((r) => ({ line: r.line, t: fold(r.title) })).filter((x) => titleCount.get(x.t) === 1);
  const matched: AttachmentMatch[] = [];
  const unmatched: AttachmentMiss[] = [];
  for (const path of input.paths.slice(0, MAX_ATTACHMENT_PATHS)) {
    if (isIgnoredPath(path)) continue;
    const name = baseName(path);
    const byId = new Set<number>();
    for (const t of tokens(input.adapter, path)) {
      const line = byKey.get(await input.keyOf(t));
      if (line !== undefined) byId.add(line);
    }
    if (byId.size === 1) {
      matched.push({ path, name, line: [...byId][0]!, by: "id" });
      continue;
    }
    if (byId.size > 1) {
      unmatched.push({ path, name, why: "ambiguous" });
      continue;
    }
    const segments = path
      .split("/")
      .filter(Boolean)
      .map((s, i, all) => fold(i === all.length - 1 ? s.replace(/\.[A-Za-z0-9]{1,5}$/, "") : s));
    const hits = new Set(titles.filter(({ t }) => segments.some((s) => s === t || s.startsWith(`${t} `) || s.endsWith(` ${t}`))).map((x) => x.line));
    if (hits.size === 1) matched.push({ path, name, line: [...hits][0]!, by: "title" });
    else unmatched.push({ path, name, why: hits.size > 1 ? "ambiguous" : "no_match" });
  }
  return { matched, unmatched };
}

const MIME: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  txt: "text/plain",
  csv: "text/csv",
  rtf: "application/rtf",
  odt: "application/vnd.oasis.opendocument.text",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

/** A file's type from its name; unknown types are stored as plain bytes. */
export const mimeFor = (name: string): string => MIME[/\.([A-Za-z0-9]{1,5})$/.exec(name)?.[1]?.toLowerCase() ?? ""] ?? "application/octet-stream";
