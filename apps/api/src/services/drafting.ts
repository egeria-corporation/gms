// SPDX-License-Identifier: AGPL-3.0-only
// Write faster (v1.6.0): the assistant drafts an answer to an outside application's question from
// the organization's own content, and reads a funder's guidelines (pasted, or uploaded through the
// guidelines route) into proposed questions. Both return drafts and save nothing but the call log;
// a person accepts a draft through the ordinary answer save with provenance `assist`.
//
// What the model may read (owner decision D5): the question, up to eight library answers chosen
// here by a plain word-overlap score, the organization's profile facts, and a funder's guidelines
// the person pasted or uploaded for this purpose. Never a vault document, an attachment, a
// receipt or any other file of the organization.
import { draftAnswer, isStale, looksLikePdf, MAX_DRAFT_LIBRARY_ANSWERS, MAX_GUIDELINES_BYTES, MAX_GUIDELINES_PAGES, MAX_GUIDELINES_TEXT, pdfPageCount, pickLibraryAnswers, readGuidelines, type GuidelinesReading, type GuidelinesSource, type LimitKind, type OrganizationFacts } from "@gms/assist";
import { sha256Hex } from "@gms/documents";
import { countFor, countText, type QuestionPhase } from "@gms/forms";
import { cleanLine, cleanText } from "@gms/notify";
import { z } from "zod";
import { ApiError } from "../lib/errors.ts";
import { assistantDisabled, assistantOn, quota, runAssist } from "./assist.ts";
import { authorize, type ServiceContext } from "./context.ts";
import { docView, limitOf, loadOutside, loadQuestion, writable } from "./outside.ts";
import { orgFacts } from "./profile.ts";
import type { Row } from "./repos/types.ts";
import { refuseSensitiveFilename, VAULT_TYPES, type VaultType } from "./vault.ts";

type Ws = Row<"workspaces">;

// ------------------------------------------------------------------------------------ material

const str = (v: unknown, max = 2000): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

/** The six profile facts the drafting assistant may use: legal name, mission, address, year founded, budget, programs. */
export function profileFactsOf(ws: Ws): OrganizationFacts {
  const { org, profile } = orgFacts(ws);
  const o = org as Record<string, unknown>;
  const primary = ((o.addresses as { primary?: Record<string, unknown> } | undefined)?.primary ?? null) as Record<string, unknown> | null;
  const address = primary ? [primary.street1, primary.street2, primary.city, primary.stateOrProvince, primary.postalCode, primary.country].map((v) => str(v, 200)).filter(Boolean).join(", ") || null : null;
  const commonApp = ((profile as Record<string, unknown> | null)?.commonApp ?? null) as Record<string, unknown> | null;
  const financials = (commonApp?.financials ?? null) as Record<string, unknown> | null;
  const budgetRaw = financials?.budget;
  const budget = typeof budgetRaw === "number" ? `USD ${budgetRaw.toLocaleString("en-US")}` : typeof budgetRaw === "object" && budgetRaw && "amount" in budgetRaw ? `${str((budgetRaw as { currency?: unknown }).currency, 3) ?? "USD"} ${str((budgetRaw as { amount?: unknown }).amount, 30)}` : str(budgetRaw, 100);
  const programsRaw = commonApp?.programs;
  const programs = Array.isArray(programsRaw) ? programsRaw.map((p) => (typeof p === "string" ? str(p, 200) : str((p as { name?: unknown } | null)?.name, 200))).filter((p): p is string => !!p).slice(0, 20) : null;
  return {
    legalName: str(o.name, 200) ?? ws.legal_name ?? ws.display_name,
    mission: str(o.mission),
    address,
    yearFounded: str(o.yearFounded, 4),
    budget,
    programs: programs?.length ? programs : null,
  };
}

/** The latest version of every library answer in the workspace. */
export async function latestLibrary(ctx: ServiceContext, workspaceId: string) {
  const rows = await ctx.repos.table("answers").find({ workspace_id: workspaceId }, { orderBy: "version", ascending: false });
  const latest = new Map<string, Row<"answers">>();
  for (const r of rows) if (!latest.has(r.key)) latest.set(r.key, r);
  return [...latest.values()];
}

// ------------------------------------------------------------------------------------ draft an answer

export const draftInput = z.object({}).strict();

/**
 * Draft an answer to an outside application's question. Saves nothing: the person accepts the
 * text with `PUT /gms/outside-questions/{qid}/answer` and `provenance: "assist"`.
 */
export async function draftOutsideAnswer(ctx: ServiceContext, qid: string) {
  const { ws, q, row } = await loadQuestion(ctx, qid, "applications:write");
  writable(row);
  await authorize(ctx, { scope: "assist", kind: "applicant" });
  await authorize(ctx, { scope: "library:read", kind: "applicant" });
  if (!assistantOn(ctx)) throw assistantDisabled();
  const workspace = (await ctx.repos.table("workspaces").one({ id: ws.id }))!;
  const today = ctx.now().toISOString().slice(0, 10);
  const chosen = pickLibraryAnswers(`${q.prompt}\n${q.guidance ?? ""}`, await latestLibrary(ctx, ws.id), MAX_DRAFT_LIBRARY_ANSWERS);
  const limit = limitOf(q);
  const material = {
    question: { prompt: q.prompt, guidance: q.guidance, limit },
    library: chosen.map((a) => ({ id: a.id, title: a.title, body: a.body, lastVerifiedAt: a.last_verified_at })),
    organization: profileFactsOf(workspace),
    today,
  };
  const r = await runAssist(ctx, ws, "draft_answer", `outside_question:${q.id}`, (llm, remaining) =>
    draftAnswer(llm, material, { measure: (text, kind: LimitKind) => countFor(countText(text), kind), allowRetry: remaining >= 2 }),
  );
  const out = r.output;
  return {
    questionId: q.id,
    outsideApplicationId: row.id,
    draft: out.draft,
    usedAnswerIds: out.usedAnswerIds,
    usedAnswers: chosen.filter((a) => out.usedAnswerIds.includes(a.id)).map((a) => ({ id: a.id, key: a.key, title: a.title, version: a.version, lastVerifiedAt: a.last_verified_at, stale: isStale(a.last_verified_at, today) })),
    offeredAnswerIds: chosen.map((a) => a.id),
    unknowns: out.unknowns,
    staleFlags: out.staleFlags,
    counts: countText(out.draft),
    limit,
    overLimit: out.overLimit,
    retried: out.retried,
    saved: false,
    provenance: "assist" as const,
    model: r.model,
    quota: r.quota,
  };
}

// ------------------------------------------------------------------------------------ read a funder's guidelines

/** Words in a required document's label → the vault type it matches. */
const DOC_TYPE_WORDS: [RegExp, VaultType][] = [
  [/\b(irs|determination|501\s*\(?c\)?\s*\(?3\)?|tax[-\s]?exempt)/i, "irs_letter"],
  [/\baudit/i, "audit"],
  [/\b(financial|990|balance sheet|income statement|statement of activities)/i, "financials"],
  [/\bboard\b|\btrustees?\b|\bdirectors\b/i, "board_list"],
  [/\bbudget/i, "budget"],
  [/\bannual report/i, "annual_report"],
  [/\blogo/i, "logo"],
];
export const docTypeForLabel = (label: string): VaultType | null => DOC_TYPE_WORDS.find(([re]) => re.test(label))?.[1] ?? null;

const isoDate = (v: string | null | undefined) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().startsWith(v) ? v : null);

/** The model's reading, as the paste flow proposes it: cleaned, capped, with limits only when complete. */
function proposal(reading: GuidelinesReading, fallbackPhase: QuestionPhase) {
  const questions = reading.questions
    .map((q) => ({ prompt: cleanText(q.prompt).slice(0, 5000), limitKind: q.limitKind ?? null, limitValue: q.limitValue ?? null, phase: q.phase ?? fallbackPhase }))
    .filter((q) => q.prompt.length > 0)
    .slice(0, 150)
    .map((q) => ({ prompt: q.prompt, phase: q.phase, ...(q.limitKind && q.limitValue ? { limitKind: q.limitKind, limitValue: q.limitValue } : {}) }));
  const seen = new Set<string>();
  const requiredDocuments = reading.requiredDocuments
    .map((l) => cleanLine(l).slice(0, 200))
    .filter((l) => l && !seen.has(l.toLowerCase()) && seen.add(l.toLowerCase()))
    .slice(0, 50)
    .map((label) => ({ label, docType: docTypeForLabel(label) }));
  return { questions, requiredDocuments, deadlines: { loiDue: isoDate(reading.deadlines.loiDue), fullDue: isoDate(reading.deadlines.fullDue) } };
}

async function readWithAssistant(ctx: ServiceContext, row: Row<"outside_applications">, source: GuidelinesSource, phase: QuestionPhase) {
  const ws = await authorize(ctx, { scope: "assist", kind: "applicant" });
  const r = await runAssist(ctx, ws, "parse_guidelines", `outside_application:${row.id}`, (llm) => readGuidelines(llm, source));
  return { mode: "ai" as const, ...proposal(r.output, phase), cautions: r.output.cautions.slice(0, 4), saved: false, model: r.model, quota: r.quota };
}

/** `POST /outside-applications/{id}/questions/parse` with `mode: "ai"`: pasted guidelines, at most 60,000 characters. */
export async function parseGuidelinesText(ctx: ServiceContext, id: string, text: string, phase: QuestionPhase) {
  const { row } = await loadOutside(ctx, id, "applications:write");
  writable(row);
  if (!assistantOn(ctx)) throw assistantDisabled();
  if (text.length > MAX_GUIDELINES_TEXT) throw new ApiError(422, "too_long", `Paste up to ${MAX_GUIDELINES_TEXT.toLocaleString("en-US")} characters of the funder's guidelines at a time`, [{ code: "too_long", field: "text" }]);
  if (!text.trim()) throw new ApiError(422, "empty", "Paste the funder's guidelines first", [{ code: "empty", field: "text" }]);
  return readWithAssistant(ctx, row, { text }, phase);
}

export const GUIDELINE_MIMES = ["application/pdf", "text/plain"] as const;
export const guidelinesInput = z
  .object({
    name: z.string().trim().min(1).max(300),
    mime: z.enum(GUIDELINE_MIMES),
    contentBase64: z.string().min(1).max(Math.ceil((MAX_GUIDELINES_BYTES * 4) / 3) + 8),
    phase: z.enum(["loi", "full"]).optional(),
  })
  .strict();

/**
 * Keep a funder's guidelines (a PDF or plain-text file, up to 10 MB and 50 pages) as a document of
 * the application, typed `funder_guidelines`, and read it with the assistant: the file goes to the
 * Anthropic API as a document input. The same file uploaded again is kept once. Nothing else is
 * saved: the proposal comes back for review.
 */
export async function uploadGuidelines(ctx: ServiceContext, id: string, input: z.output<typeof guidelinesInput>) {
  const { ws, row } = await loadOutside(ctx, id, "applications:write");
  writable(row);
  await authorize(ctx, { scope: "assist", kind: "applicant" });
  if (!assistantOn(ctx)) throw assistantDisabled();
  refuseSensitiveFilename(input.name);
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(input.contentBase64), (c) => c.charCodeAt(0));
  } catch {
    throw new ApiError(400, "bad_request", "contentBase64 is not valid base64");
  }
  if (!bytes.byteLength) throw new ApiError(422, "empty", "The file is empty");
  if (bytes.byteLength > MAX_GUIDELINES_BYTES) throw new ApiError(413, "too_large", "Guidelines files up to 10 MB can be read");
  let source: GuidelinesSource;
  if (input.mime === "application/pdf") {
    if (!looksLikePdf(bytes)) throw new ApiError(422, "not_a_pdf", "This file is not a PDF");
    const pages = pdfPageCount(bytes);
    if (pages > MAX_GUIDELINES_PAGES) throw new ApiError(422, "too_many_pages", `Guidelines of up to ${MAX_GUIDELINES_PAGES} pages can be read; this file has ${pages}`);
    source = { document: { kind: "pdf", base64: input.contentBase64.replace(/\s+/g, ""), title: input.name } };
  } else {
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new ApiError(422, "not_text", "This file is not plain text");
    }
    if (text.length > MAX_GUIDELINES_TEXT) throw new ApiError(422, "too_long", `A text file of up to ${MAX_GUIDELINES_TEXT.toLocaleString("en-US")} characters can be read`);
    source = { document: { kind: "text", text, title: input.name } };
  }
  // Refuse before anything is stored when the month's calls are spent.
  const q = await quota(ctx, ws);
  if (q.remaining <= 0) throw new ApiError(429, "assist_quota_exhausted", `This workspace has used the assistant ${q.limit} times this month, its monthly limit. The count resets on ${q.resetsAt.slice(0, 10)}`);
  if (!ctx.ports.storage) throw new ApiError(503, "storage_unavailable", "File storage is not configured on this server");
  const sha256 = await sha256Hex(bytes);
  let doc = await ctx.repos.table("documents").one({ workspace_id: ws.id, subject_type: "outside_application", subject_id: row.id, doc_type: "funder_guidelines", sha256 });
  if (!doc) {
    const stored = await ctx.ports.storage.put(`outside/${row.id}/guidelines/${sha256}`, bytes, input.mime);
    doc = await ctx.repos.table("documents").insert({ workspace_id: ws.id, owner_workspace_id: ws.id, subject_type: "outside_application", subject_id: row.id, name: input.name, mime: input.mime, size: bytes.byteLength, sha256, storage: stored.storage, path: stored.path, uploaded_by: ctx.actor.userId, doc_type: "funder_guidelines" });
  }
  return { document: docView(doc), ...(await readWithAssistant(ctx, row, source, input.phase ?? "full")) };
}

/** Whether a vault type is one of the eight. */
export const isVaultType = (t: unknown): t is VaultType => typeof t === "string" && (VAULT_TYPES as readonly string[]).includes(t);
