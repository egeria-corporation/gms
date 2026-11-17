// SPDX-License-Identifier: AGPL-3.0-only
// Files from a grants system's zip, attached to the awards an import created (v1.9.0). The import
// screen lists the zip's paths in the browser and sends the paths only; they are matched to the
// run's rows by the export's own id (hashed like the run's row keys, so no source id is stored) or
// by title (packages/importers/src/adapters/attachments.ts). The person then sends each matched
// file, one at a time; it is checked against the same match again, stored, and recorded as a
// document of the funder's own workspace (subject 'imported_award_file'), which the grantee never
// sees. Nothing reads a file's contents: no document AI.
import { ADAPTERS, ATTACHMENT_MISS_TEXT, baseName, idKey, matchAttachments, MAX_ATTACHMENT_BYTES, MAX_ATTACHMENT_PATHS, mimeFor, type AdapterKey, type AttachmentRow } from "@gms/importers";
import { z } from "zod";
import { forbidden } from "../auth/verify.ts";
import { ApiError } from "../lib/errors.ts";
import { apiId } from "../lib/ids.ts";
import { audit, guardWrite, type ServiceContext } from "./context.ts";
import { loadRun } from "./imports.ts";
import { sha256Hex } from "@gms/documents";
import type { Row } from "./repos/types.ts";
import { refuseSensitiveFilename } from "./vault.ts";

export const IMPORTED_FILE_SUBJECT = "imported_award_file";

const path = z.string().min(1).max(1000);
export const matchFilesInput = z.object({ paths: z.array(path).min(1).max(MAX_ATTACHMENT_PATHS) }).strict();
export const attachFileInput = z.object({ path, contentBase64: z.string().min(1).max(Math.ceil((MAX_ATTACHMENT_BYTES * 4) / 3) + 4) }).strict();

type Run = Row<"import_runs">;

/** The awards this run wrote, as attachment candidates. */
async function candidates(ctx: ServiceContext, run: Run): Promise<{ rows: AttachmentRow[]; entity: Map<number, string> }> {
  const log = await ctx.repos.table("import_rows").find({ run_id: run.id, workspace_id: run.workspace_id, outcome: "create" }, { notNull: ["written_at"], orderBy: "line" });
  return { rows: log.map((r) => ({ line: r.line, key: r.row_key, title: r.title })), entity: new Map(log.map((r) => [r.line, r.entity_id!])) };
}

async function finishedHistoryRun(ctx: ServiceContext, id: string) {
  const { ws, run } = await loadRun(ctx, id);
  if (run.target !== "award_history") throw new ApiError(422, "files_not_for_target", "Files are attached to imported grant history only");
  if (!run.finished_at) throw new ApiError(409, "import_not_finished", "Finish the import first, then add the files");
  const adapter = run.adapter ? (ADAPTERS[run.adapter as AdapterKey] ?? null) : null;
  const keyOf = idKey(run.target, { kind: run.source, ref: run.source_ref }, (run.mapping as Record<string, string>).sourceId ?? null);
  return { ws, run, adapter, keyOf };
}

/** Which of these paths match a record this import created, and why the others do not. Reads paths only. */
export async function matchImportFiles(ctx: ServiceContext, id: string, input: z.output<typeof matchFilesInput>) {
  const { run, adapter, keyOf } = await finishedHistoryRun(ctx, id);
  const { rows } = await candidates(ctx, run);
  const titles = new Map(rows.map((r) => [r.line, r.title]));
  const m = await matchAttachments({ adapter, paths: input.paths, rows, keyOf });
  return {
    matched: m.matched.map((x) => ({ path: x.path, name: x.name, line: x.line, title: titles.get(x.line) ?? "", by: x.by })),
    unmatched: m.unmatched.map((x) => ({ path: x.path, name: x.name, why: ATTACHMENT_MISS_TEXT[x.why] })),
  };
}

const fileView = (d: Row<"documents">, line: number | null) => ({ id: d.id, name: d.name, mime: d.mime, size: d.size, line, award: d.subject_id ? apiId("award", d.subject_id) : null, createdAt: d.created_at });

/**
 * Attach one file to the award its path matches. A person does this on the import screen (no API
 * client or agent attaches files, as none commits an import). The same file on the same award is
 * stored once.
 */
export async function attachImportFile(ctx: ServiceContext, id: string, input: z.output<typeof attachFileInput>) {
  if (ctx.actor.kind !== "user") throw forbidden("human_only", "A person adds the files, on the import screen");
  const { ws, run, adapter, keyOf } = await finishedHistoryRun(ctx, id);
  if (!adapter?.attachments) throw new ApiError(422, "files_not_for_source", "This import's source has no zip of files to add");
  const name = baseName(input.path).slice(0, 250);
  refuseSensitiveFilename(name);
  const { rows, entity } = await candidates(ctx, run);
  const [hit] = (await matchAttachments({ adapter, paths: [input.path], rows, keyOf })).matched;
  if (!hit) throw new ApiError(422, "file_not_matched", "No imported award matches this file's name");
  const awardId = entity.get(hit.line);
  if (!awardId || !(await ctx.repos.table("awards").one({ id: awardId, workspace_id: ws.id }))) throw new ApiError(409, "award_not_found", "The award this file belongs to is no longer there");
  if (!ctx.ports.storage) throw new ApiError(503, "storage_unavailable", "File storage is not configured on this server");
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(input.contentBase64), (c) => c.charCodeAt(0));
  } catch {
    throw new ApiError(400, "bad_request", "contentBase64 is not valid base64");
  }
  if (bytes.byteLength > MAX_ATTACHMENT_BYTES) throw new ApiError(413, "too_large", "Files up to 25 MB can be attached");
  if (bytes.byteLength === 0) throw new ApiError(422, "empty_file", "The file is empty");
  const sha256 = await sha256Hex(bytes);
  const existing = await ctx.repos.table("documents").one({ workspace_id: ws.id, subject_type: IMPORTED_FILE_SUBJECT, subject_id: awardId, sha256 });
  if (existing) return { file: fileView(existing, hit.line), created: false };
  const stored = await ctx.ports.storage.put(`imports/${run.id}/${sha256}`, bytes, mimeFor(name));
  const doc = await guardWrite("This file", () => ctx.repos.table("documents").insert({ workspace_id: ws.id, owner_workspace_id: ws.id, subject_type: IMPORTED_FILE_SUBJECT, subject_id: awardId, name, mime: mimeFor(name), size: bytes.byteLength, sha256, storage: stored.storage, path: stored.path, uploaded_by: ctx.actor.userId }));
  await audit(ctx, "import.file_attached", "import_run", run.id, { award: apiId("award", awardId), line: hit.line, by: hit.by, size: bytes.byteLength }, ws.id);
  return { file: fileView(doc, hit.line), created: true };
}

/** The files attached to this run's awards. */
export async function listImportFiles(ctx: ServiceContext, id: string) {
  const { run } = await loadRun(ctx, id);
  if (run.target !== "award_history") return [];
  const { entity } = await candidates(ctx, run);
  const lineOf = new Map([...entity].map(([line, award]) => [award, line]));
  const ids = [...lineOf.keys()];
  if (!ids.length) return [];
  const docs = await ctx.repos.table("documents").find({ workspace_id: run.workspace_id, subject_type: IMPORTED_FILE_SUBJECT, subject_id: ids }, { orderBy: "created_at" });
  return docs.map((d) => fileView(d, lineOf.get(d.subject_id!) ?? null));
}
