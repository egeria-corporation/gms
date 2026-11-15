// SPDX-License-Identifier: AGPL-3.0-only
// Send to the funder (C4): an outside application handed to a funder who is not on the GMS, as one
// clean package. The package is
//   - a PDF: a cover (organization, funder, program, ask, deadlines), every question with its latest
//     answer in order, the budget summary when the application has one (the ask by year), and the
//     list of attached files;
//   - a ZIP: that PDF, the attached files under their original names, and `answers.txt`.
// The files are the documents the person attached to this application and the vault documents
// they used for its required documents. Nothing else: no other vault document, no file of another
// application, never the funder's own guidelines, the award letter, the receipt or the GMS's
// "as submitted" copy. The footer line says how it was made unless the workspace turned
// "Powered by" off (`settings.poweredBy`).
//
// Before anything is built, every answer goes through the importers' sensitive screen: an answer
// that looks like a bank, card or identity number stops the package, naming the question.
//
// Download (PDF or ZIP) is a read: anyone who may open the application, agents included (the MCP
// tool `get_send_package` describes it). Emailing it is a person's (admins and editors), never an
// agent's: a preview first, and the email sent is exactly the preview (`digest`). Five emails per
// application per UTC day, counted in Postgres (`package_sends`, migration 0040).
import { renderPdf, sha256Hex, type Block } from "@gms/documents";
import { sensitiveValue, type DropReason } from "@gms/importers";
import { base64Of, cleanLine, cleanText, fromWithName, PACKAGE_FOOTER, PACKAGE_MESSAGE_MAX, sendPackageEmail, sendsAttachments, type EmailAttachment, type OutboundEmailWithAttachments } from "@gms/notify";
import { toMoney } from "@gms/protocol";
import { z } from "zod";
import { ApiError } from "../lib/errors.ts";
import { maskEmail } from "./award-invitations.ts";
import { printMoney } from "./awards.ts";
import { audit, authorize, type ServiceContext } from "./context.ts";
import { loadOutside, questionsWithAnswers, requirePerson, writable } from "./outside.ts";
import { poweredByOf } from "./powered-by.ts";
import { RepoError, type Row } from "./repos/types.ts";
import { zipStored } from "./send-package-zip.ts";
import { requiredOf, SENSITIVE_FILENAME } from "./vault.ts";

type Oa = Row<"outside_applications">;
type Doc = Row<"documents">;

/** Package emails per outside application per UTC day. One place to relax. */
export const PACKAGE_EMAILS_PER_DAY = 5;
/** Who may email the package: the people who write applications. Downloads follow the application's read roles. */
export const PACKAGE_EMAIL_ROLES: readonly string[] = ["admin", "editor"];
/** The files attached to one email, at most this many bytes in all (Resend takes 40 MB after encoding). */
export const PACKAGE_EMAIL_MAX_BYTES = 20 * 1024 * 1024;
/** A downloaded package, at most this many bytes of attachments. */
export const PACKAGE_MAX_BYTES = 60 * 1024 * 1024;
/** Documents of the application that are never part of a package: the funder's own and the GMS's records. */
export const PACKAGE_EXCLUDED_DOC_TYPES: readonly string[] = ["funder_guidelines", "award_letter"];

const DEADLINE_LABEL = { loi: "Letter of inquiry due", full: "Application due" } as const;
const PHASE_LABEL: Record<string, string> = { loi: "Letter of inquiry", full: "Full application", report: "Report" };

// ------------------------------------------------------------------------------------ the sensitive screen

/** Runs of nine or more digits, single spaces or dashes allowed between them. */
const DIGIT_RUN = /\d(?:[ -]?\d){8,}/g;

/**
 * Why an answer would be refused, or null: the importers' cell screen (`sensitiveValue`) on every
 * run of digits in it, with the question's prompt as the column header (so a question that asks for
 * the EIN may hold one, and one that asks for a phone number a phone number).
 */
export function sensitiveAnswer(body: string, prompt: string): Exclude<DropReason, "header"> | null {
  for (const m of body.matchAll(DIGIT_RUN)) {
    const why = sensitiveValue(m[0], prompt);
    if (why) return why;
  }
  return null;
}

const REASON_TEXT: Record<Exclude<DropReason, "header">, string> = {
  bank_routing: "looks like it holds bank details",
  identity_number: "looks like it holds a person's identity number",
  long_number: "looks like it holds an account or card number",
};

// ------------------------------------------------------------------------------------ the package

interface PackageFile {
  documentId: string;
  /** The name in the ZIP and in the email: the original name, made unique. */
  name: string;
  originalName: string;
  source: "application" | "vault";
  /** For a vault document: the required document it was used for. */
  requiredFor: string | null;
  mime: string;
  size: number;
  sha256: string;
  doc: Doc;
}

const safeName = (name: string) =>
  cleanLine(name)
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/^[.\s]+/, "")
    .slice(0, 200) || "file";

/** Names unique in the ZIP, case-insensitively: "Budget.pdf", "Budget (2).pdf". */
function uniqueNames(names: readonly string[], taken: Set<string>): string[] {
  return names.map((raw) => {
    const name = safeName(raw);
    const dot = name.lastIndexOf(".");
    const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
    let candidate = name;
    for (let n = 2; taken.has(candidate.toLowerCase()); n++) candidate = `${stem} (${n})${ext}`;
    taken.add(candidate.toLowerCase());
    return candidate;
  });
}

const baseName = (title: string) => title.replace(/[^A-Za-z0-9 _-]+/g, "").trim().replace(/\s+/g, "-").slice(0, 80) || "application";

const latestOf = (...isos: (string | null | undefined)[]) => isos.filter((x): x is string => !!x).sort().at(-1)!;

/** Everything the package holds, read once. Throws 422 naming the questions whose answers look sensitive. */
async function gather(ctx: ServiceContext, row: Oa, opts: { screen: boolean }) {
  const ws = await ctx.repos.table("workspaces").one({ id: row.workspace_id });
  const organization = ws?.legal_name ?? ws?.display_name ?? "Organization";
  const qa = await questionsWithAnswers(ctx, row);
  const questions = qa.map(({ q, latest }, i) => ({ id: q.id, number: i + 1, phase: q.phase, section: q.section, prompt: q.prompt, answer: latest?.body ?? "", answeredAt: latest?.created_at ?? null, updatedAt: q.updated_at }));
  const blocked = questions.flatMap((q) => {
    const why = q.answer ? sensitiveAnswer(q.answer, q.prompt) : null;
    return why ? [{ questionId: q.id, number: q.number, prompt: q.prompt, reason: why, message: `The answer to question ${q.number} (“${cleanLine(q.prompt).slice(0, 120)}”) ${REASON_TEXT[why]}. Take the number out of the answer, then try again.` }] : [];
  });
  if (opts.screen && blocked.length) {
    throw new ApiError(422, "sensitive_answer", blocked.length === 1 ? blocked[0]!.message : `${blocked.length} answers look like they hold bank, card or identity numbers: questions ${blocked.map((b) => b.number).join(", ")}. Take the numbers out, then try again.`, blocked.map((b) => ({ code: "sensitive_answer", field: `questions[${b.number - 1}]`, detail: b.message })));
  }

  // The files: the application's own attachments and the vault documents used for its checklist.
  const own = (await ctx.repos.table("documents").find({ workspace_id: row.workspace_id, subject_type: "outside_application", subject_id: row.id }, { orderBy: "created_at" })).filter(
    (d) => d.id !== row.snapshot_document_id && d.id !== row.receipt_document_id && !PACKAGE_EXCLUDED_DOC_TYPES.includes(d.doc_type ?? ""),
  );
  const used = requiredOf(row).filter((i) => i.status === "attached" && i.documentId);
  const vaultDocs = used.length ? await ctx.repos.table("documents").find({ workspace_id: row.workspace_id, subject_type: "vault", id: used.map((i) => i.documentId!) }) : [];
  const vaultFiles = used.flatMap((i) => {
    const d = vaultDocs.find((v) => v.id === i.documentId);
    return d ? [{ d, requiredFor: i.label }] : [];
  });
  const seen = new Set<string>();
  const candidates = [...own.map((d) => ({ d, source: "application" as const, requiredFor: null })), ...vaultFiles.map((v) => ({ ...v, source: "vault" as const }))].filter((c) => !seen.has(c.d.id) && seen.add(c.d.id));
  const inLocker = candidates.filter((c) => c.d.passport_document_id);
  // A name that says it is a bank or tax form never goes out, whatever was let in before.
  const refusedNames = candidates.filter((c) => !c.d.passport_document_id && SENSITIVE_FILENAME.test(c.d.name.normalize("NFKC")));
  const kept = candidates.filter((c) => !c.d.passport_document_id && !refusedNames.includes(c));

  const base = baseName(row.title);
  const taken = new Set([`${base}.pdf`.toLowerCase(), "answers.txt"]);
  const names = uniqueNames(
    kept.map((c) => c.d.name),
    taken,
  );
  const files: PackageFile[] = kept.map((c, i) => ({ documentId: c.d.id, name: names[i]!, originalName: c.d.name, source: c.source, requiredFor: c.requiredFor, mime: c.d.mime, size: c.d.size, sha256: c.d.sha256, doc: c.d }));
  const notIncluded = [
    ...inLocker.map((c) => ({ documentId: c.d.id, name: c.d.name, reason: "passport_locker" as const, message: "Kept in the Passport locker, so the GMS has no copy to send. Attach it from Passport yourself." })),
    ...refusedNames.map((c) => ({ documentId: c.d.id, name: c.d.name, reason: "sensitive_name" as const, message: "Its name says it is a bank or tax form, which is never sent from the GMS." })),
  ];

  const deadlines: { kind: "loi" | "full"; label: string; date: string }[] = (["loi", "full"] as const).flatMap((k) => {
    const date = k === "loi" ? row.loi_due : row.full_due;
    return date ? [{ kind: k, label: DEADLINE_LABEL[k], date }] : [];
  });
  if (row.rolling && !deadlines.length) deadlines.push({ kind: "full", label: "Deadline", date: "Rolling" });
  const byYear = (Array.isArray(row.ask_by_year) ? (row.ask_by_year as { year: number; amountMinor: number }[]) : []).filter((y) => Number.isInteger(y.year) && Number.isInteger(y.amountMinor)).sort((a, b) => a.year - b.year);
  const budget = byYear.length ? { byYear: byYear.map((y) => ({ year: y.year, amount: toMoney(y.amountMinor, row.currency), printed: printMoney(y.amountMinor, row.currency) })), total: printMoney(byYear.reduce((n, y) => n + y.amountMinor, 0), row.currency) } : null;
  // The answers' date: the latest change to anything in the package, so the same content gives the same bytes.
  const asOf = latestOf(row.updated_at, row.created_at, ...questions.map((q) => q.answeredAt), ...questions.map((q) => q.updatedAt), ...files.map((f) => f.doc.updated_at ?? f.doc.created_at));
  return {
    organization,
    footer: ws ? poweredByOf(ws) : true,
    questions,
    blocked,
    files,
    notIncluded,
    deadlines,
    budget,
    ask: row.ask_amount_minor === null ? null : printMoney(row.ask_amount_minor, row.currency),
    askMoney: row.ask_amount_minor === null ? null : toMoney(row.ask_amount_minor, row.currency),
    asOf,
    filenames: { pdf: `${base}.pdf`, zip: `${base}-package.zip` },
  };
}
type Gathered = Awaited<ReturnType<typeof gather>>;

const paragraphsOf = (text: string) => text.split(/\n{2,}/).map((p) => p.replace(/\n/g, " ").trim()).filter(Boolean);
const dateOnly = (iso: string) => iso.slice(0, 10);

/** The package PDF: cover, questions and answers, budget summary, attachments. Deterministic for the same content. */
async function packagePdf(row: Oa, g: Gathered): Promise<Uint8Array> {
  const cover: [string, string][] = [
    ["Organization", g.organization],
    ["Funder", row.funder_name ?? "Not stated"],
    ...(row.program_name ? [["Program", row.program_name] as [string, string]] : []),
    ["Amount requested", g.ask ?? "Not stated"],
    ...(g.deadlines.length ? g.deadlines.map((d) => [d.label, d.date] as [string, string]) : [["Deadline", "Not stated"] as [string, string]]),
    ["Answers as of", dateOnly(g.asOf)],
  ];
  const blocks: Block[] = [{ type: "heading", level: 1, text: row.title }, { type: "fields", rows: cover }, { type: "paragraph", text: `${g.questions.length} question${g.questions.length === 1 ? "" : "s"}, ${g.files.length} attached file${g.files.length === 1 ? "" : "s"}.` }];
  // The questions start on a page of their own (a space taller than the page).
  blocks.push({ type: "space", height: 1000 }, { type: "heading", level: 2, text: "Questions and answers" });
  const phases = new Set(g.questions.map((q) => q.phase));
  let phase: string | null = null;
  for (const q of g.questions) {
    if (phases.size > 1 && q.phase !== phase) {
      phase = q.phase;
      blocks.push({ type: "heading", level: 2, text: PHASE_LABEL[q.phase] ?? q.phase });
    }
    blocks.push({ type: "heading", level: 3, text: `${q.number}. ${q.prompt}` });
    const body = paragraphsOf(cleanText(q.answer));
    if (!body.length) blocks.push({ type: "paragraph", text: "No answer given." });
    for (const p of body) blocks.push({ type: "paragraph", text: p });
  }
  if (!g.questions.length) blocks.push({ type: "paragraph", text: "This application has no questions." });
  if (g.budget) {
    blocks.push({ type: "heading", level: 2, text: "Budget summary" }, { type: "fields", rows: [...g.budget.byYear.map((y) => [String(y.year), y.printed] as [string, string]), ["Total", g.budget.total]] });
  }
  blocks.push({ type: "heading", level: 2, text: "Attachments" });
  blocks.push(g.files.length ? { type: "list", ordered: true, items: g.files.map((f) => (f.requiredFor ? `${f.name} (${f.requiredFor})` : f.name)) } : { type: "paragraph", text: "No files are attached." });
  return renderPdf({ title: row.title, header: g.organization, ...(g.footer ? { footer: PACKAGE_FOOTER } : {}), createdAt: g.asOf, blocks });
}

/** `answers.txt`: the questions and answers as plain text, to paste into a funder's portal. */
function answersText(row: Oa, g: Gathered): string {
  const head = [row.title, `Organization: ${g.organization}`, ...(row.funder_name ? [`Funder: ${row.funder_name}`] : []), ...(row.program_name ? [`Program: ${row.program_name}`] : [])].join("\n");
  const body = g.questions.map((q) => `${q.number}. ${cleanLine(q.prompt)}\n\n${cleanText(q.answer) || "(no answer given)"}`);
  return [head, ...body, ...(g.footer ? [`--\n${PACKAGE_FOOTER}`] : [])].join("\n\n") + "\n";
}

async function fileBytes(ctx: ServiceContext, f: PackageFile): Promise<Uint8Array> {
  const bytes = ctx.ports.storage ? await ctx.ports.storage.get({ storage: f.doc.storage as "supabase" | "r2", path: f.doc.path }) : null;
  if (!bytes) throw new ApiError(503, "storage_unavailable", `“${f.originalName}” could not be read from storage, so the package cannot be made`);
  return bytes;
}

function assertSize(g: Gathered, max: number, code: string, what: string) {
  const total = g.files.reduce((n, f) => n + f.size, 0);
  if (total > max) throw new ApiError(413, code, `The attached files come to ${Math.ceil(total / 1024 / 1024)} MB. ${what} up to ${Math.floor(max / 1024 / 1024)} MB of files`);
}

// ------------------------------------------------------------------------------------ reads

const fileView = (f: PackageFile) => ({ documentId: f.documentId, name: f.name, originalName: f.originalName, source: f.source, requiredFor: f.requiredFor, mime: f.mime, size: f.size, sha256: f.sha256 });
const todayOf = (ctx: ServiceContext) => ctx.now().toISOString().slice(0, 10);
const sentToday = async (ctx: ServiceContext, row: Oa) => ctx.repos.table("package_sends").count({ outside_application_id: row.id, day: todayOf(ctx) });

/** What the package holds and whether it can be sent: the dialog, and the MCP tool `get_send_package`. Builds nothing. */
export async function packageSummary(ctx: ServiceContext, id: string) {
  const { ws, row } = await loadOutside(ctx, id, "applications:read");
  const g = await gather(ctx, row, { screen: false });
  const used = await sentToday(ctx, row);
  const canEmail = ctx.actor.kind === "user" && !!ws.role && PACKAGE_EMAIL_ROLES.includes(ws.role);
  const mailReady = !!ctx.ports.mailer && !!ctx.config.mailFrom && sendsAttachments(ctx.ports.mailer);
  const total = g.files.reduce((n, f) => n + f.size, 0);
  const emailBlock = !canEmail
    ? ctx.actor.kind === "user"
      ? "Workspace admins and editors email the package"
      : "Only a person emails the package, in the GMS"
    : !mailReady
      ? "This server cannot email files. Download the package and send it from your own email"
      : row.archived_at
        ? "This application is archived. Unarchive it to send it"
        : total > PACKAGE_EMAIL_MAX_BYTES
          ? `The files are too large to email (up to ${PACKAGE_EMAIL_MAX_BYTES / 1024 / 1024} MB). Download the package and share it another way`
          : used >= PACKAGE_EMAILS_PER_DAY
            ? `This application's package was emailed ${PACKAGE_EMAILS_PER_DAY} times today, the most for one day. Try again tomorrow`
            : null;
  return {
    applicationId: row.id,
    title: row.title,
    cover: { organization: g.organization, funder: row.funder_name, program: row.program_name, ask: g.askMoney, askPrinted: g.ask, deadlines: g.deadlines.map((d) => ({ label: d.label, date: d.date })), answersAsOf: dateOnly(g.asOf) },
    questions: g.questions.map((q) => ({ id: q.id, number: q.number, phase: q.phase, prompt: q.prompt, answered: q.answer.trim().length > 0 })),
    budget: g.budget ? { byYear: g.budget.byYear.map((y) => ({ year: y.year, amount: y.amount })), total: g.budget.total } : null,
    attachments: g.files.map(fileView),
    notIncluded: g.notIncluded.map(({ documentId, name, reason, message }) => ({ documentId, name, reason, message })),
    footer: { shown: g.footer, text: PACKAGE_FOOTER, canChange: ctx.actor.kind === "user" && ws.role === "admin" },
    blocked: g.blocked.map(({ questionId, number, prompt, reason, message }) => ({ questionId, number, prompt, reason, message })),
    files: { pdf: g.filenames.pdf, zip: g.filenames.zip, contents: [g.filenames.pdf, ...g.files.map((f) => f.name), "answers.txt"] },
    totalBytes: total,
    downloads: { pdf: `/gms/outside-applications/${row.id}/package.pdf`, zip: `/gms/outside-applications/${row.id}/package.zip` },
    email: { available: emailBlock === null && g.blocked.length === 0, reason: g.blocked.length ? "An answer looks like it holds a bank, card or identity number" : emailBlock, perDay: PACKAGE_EMAILS_PER_DAY, sentToday: used, remainingToday: Math.max(0, PACKAGE_EMAILS_PER_DAY - used), maxBytes: PACKAGE_EMAIL_MAX_BYTES },
  };
}

/** The package PDF. */
export async function packagePdfFile(ctx: ServiceContext, id: string) {
  const { row } = await loadOutside(ctx, id, "applications:read");
  const g = await gather(ctx, row, { screen: true });
  const bytes = await packagePdf(row, g);
  return { bytes, filename: g.filenames.pdf, sha256: await sha256Hex(bytes) };
}

/** The package ZIP: the PDF, the attached files under their names, and answers.txt. */
export async function packageZipFile(ctx: ServiceContext, id: string) {
  const { row } = await loadOutside(ctx, id, "applications:read");
  const g = await gather(ctx, row, { screen: true });
  assertSize(g, PACKAGE_MAX_BYTES, "package_too_large", "A package holds");
  const pdf = await packagePdf(row, g);
  const entries = [{ name: g.filenames.pdf, bytes: pdf }];
  for (const f of g.files) entries.push({ name: f.name, bytes: await fileBytes(ctx, f) });
  entries.push({ name: "answers.txt", bytes: new TextEncoder().encode(answersText(row, g)) });
  const bytes = zipStored(entries, g.asOf);
  return { bytes, filename: g.filenames.zip, sha256: await sha256Hex(bytes) };
}

// ------------------------------------------------------------------------------------ the email

export const emailInput = z
  .object({
    to: z.string().trim().max(320).pipe(z.email()),
    message: z.string().transform(cleanText).pipe(z.string().max(PACKAGE_MESSAGE_MAX)).optional(),
  })
  .strict();
export const sendInput = emailInput.extend({ digest: z.string().regex(/^[0-9a-f]{64}$/, "The digest from the preview") }).strict();

/** The person's own name and sign-in address: the sender name and where replies go. Never typed. */
async function senderOf(ctx: ServiceContext) {
  const who = ctx.actor.userId && ctx.ports.directory ? (await ctx.ports.directory.lookup([ctx.actor.userId])).get(ctx.actor.userId) : undefined;
  const email = who?.email?.trim() ?? null;
  if (!email) throw new ApiError(422, "sender_unknown", "Your account has no email address for replies, so the package cannot be emailed. Download it and send it yourself");
  const fallback = email.split("@")[0]!.replace(/[._+-]+/g, " ").trim().replace(/\b\p{L}/gu, (ch) => ch.toUpperCase());
  return { name: cleanLine(who?.name ?? "") || fallback || email, email };
}

/** The email exactly as it would be sent, with the digest that ties a send to this preview. */
async function composeEmail(ctx: ServiceContext, id: string, input: z.output<typeof emailInput>) {
  requirePerson(ctx, "Emailing the package to a funder");
  const { ws, row } = await loadOutside(ctx, id, "applications:write");
  if (!ws.role || !PACKAGE_EMAIL_ROLES.includes(ws.role)) throw new ApiError(403, "insufficient_role", `This needs one of these roles: ${PACKAGE_EMAIL_ROLES.join(", ")}`);
  writable(row);
  const g = await gather(ctx, row, { screen: true });
  assertSize(g, PACKAGE_EMAIL_MAX_BYTES, "package_too_large_to_email", "One email carries");
  const { mailer } = ctx.ports;
  const mailFrom = ctx.config.mailFrom;
  if (!mailer || !mailFrom) throw new ApiError(503, "mail_not_configured", "This server cannot send email. Download the package and send it from your own email");
  if (!sendsAttachments(mailer)) throw new ApiError(503, "mail_attachments_unavailable", "This server cannot email files yet. Download the package and send it from your own email");
  const sender = await senderOf(ctx);
  const pdf = await packagePdf(row, g);
  const attachments: (EmailAttachment & { sha256: string })[] = [{ filename: g.filenames.pdf, content: base64Of(pdf), contentType: "application/pdf", sha256: await sha256Hex(pdf) }];
  for (const f of g.files) attachments.push({ filename: f.name, content: base64Of(await fileBytes(ctx, f)), contentType: f.mime, sha256: f.sha256 });
  const deadline = g.deadlines.length ? g.deadlines.map((d) => `${d.label} ${d.date}`).join("; ") : null;
  const mail = sendPackageEmail({ sender, organization: g.organization, title: row.title, funder: row.funder_name, program: row.program_name, ask: g.ask, deadline, message: input.message || null, attachments: attachments.map((a) => a.filename), footer: g.footer });
  const email = { from: fromWithName(sender.name, mailFrom), to: input.to.toLowerCase(), replyTo: sender.email, subject: mail.subject, text: mail.text, html: mail.html };
  const digest = await sha256Hex(new TextEncoder().encode(JSON.stringify({ ...email, attachments: attachments.map((a) => [a.filename, a.contentType, a.sha256]) })));
  return { ws, row, g, email, attachments, digest, sender };
}

/** Exactly what would be sent, and to whom. Nothing is sent or counted. */
export async function previewPackageEmail(ctx: ServiceContext, id: string, input: z.output<typeof emailInput>) {
  const { row, email, attachments, digest } = await composeEmail(ctx, id, input);
  const used = await sentToday(ctx, row);
  return { ...email, attachments: attachments.map((a) => ({ filename: a.filename, contentType: a.contentType, sha256: a.sha256, size: Math.floor((a.content.length * 3) / 4) - (a.content.endsWith("==") ? 2 : a.content.endsWith("=") ? 1 : 0) })), digest, perDay: PACKAGE_EMAILS_PER_DAY, remainingToday: Math.max(0, PACKAGE_EMAILS_PER_DAY - used) };
}

/** Take the first free place among today's sends of this application, or null when all are taken. */
async function claimSlot(ctx: ServiceContext, row: Oa, fields: { sentBy: string; toMasked: string; sha256: string; attachments: number }) {
  const day = todayOf(ctx);
  for (let slot = 1; slot <= PACKAGE_EMAILS_PER_DAY; slot++) {
    try {
      return await ctx.repos.table("package_sends").insert({ workspace_id: row.workspace_id, outside_application_id: row.id, day, slot, sent_by: fields.sentBy, to_masked: fields.toMasked, package_sha256: fields.sha256, attachment_count: fields.attachments });
    } catch (e) {
      if (e instanceof RepoError && e.kind === "conflict") continue;
      throw e;
    }
  }
  return null;
}

/** Send the package, if it is still exactly the preview the person saw (`digest`). Counted, recorded with a masked address, ledgered. */
export async function sendPackageEmailFor(ctx: ServiceContext, id: string, input: z.output<typeof sendInput>) {
  const { row, email, attachments, digest } = await composeEmail(ctx, id, input);
  if (digest !== input.digest) throw new ApiError(409, "preview_changed", "The package changed since the preview. Look at the preview again before sending");
  const masked = maskEmail(email.to);
  const claim = await claimSlot(ctx, row, { sentBy: ctx.actor.userId!, toMasked: masked, sha256: attachments[0]!.sha256, attachments: attachments.length - 1 });
  if (!claim) throw new ApiError(429, "too_many_package_emails", `This application's package can be emailed ${PACKAGE_EMAILS_PER_DAY} times a day. Try again tomorrow`);
  const outbound: OutboundEmailWithAttachments = {
    from: email.from,
    to: [email.to],
    replyTo: email.replyTo,
    subject: email.subject,
    text: email.text,
    html: email.html,
    attachments: attachments.map(({ filename, content, contentType }) => ({ filename, content, contentType })),
    idempotencyKey: `package:${claim.id}`,
    tags: [{ name: "kind", value: "send_package" }],
  };
  try {
    await ctx.ports.mailer!.send(outbound);
  } catch {
    await ctx.repos.table("package_sends").remove({ id: claim.id, sent_at: null }).catch(() => undefined);
    throw new ApiError(502, "mail_failed", "The package could not be sent. Try again in a few minutes");
  }
  const at = ctx.now().toISOString();
  await ctx.repos.table("package_sends").update({ id: claim.id }, { sent_at: at });
  await audit(ctx, "outside_application.package_sent", "outside_application", row.id, { sendId: claim.id, to: masked, sha256: attachments[0]!.sha256, attachments: attachments.length - 1, sentAt: at });
  return { sent: true, sendId: claim.id, sentAt: at, to: email.to, replyTo: email.replyTo, remainingToday: Math.max(0, PACKAGE_EMAILS_PER_DAY - (await sentToday(ctx, row))) };
}

// ------------------------------------------------------------------------------------ the footer setting

export const settingsInput = z.object({ poweredBy: z.boolean() }).strict();

/**
 * The footer line on this applicant workspace's packages: the same `settings.poweredBy` a funder
 * sets in Settings > Public page. Admins, in person.
 */
export async function setPackageFooter(ctx: ServiceContext, input: z.output<typeof settingsInput>) {
  requirePerson(ctx, "Changing the package footer");
  const ws = await authorize(ctx, { scope: "workspace:admin", kind: "applicant", roles: ["admin"], person: true });
  const row = (await ctx.repos.table("workspaces").one({ id: ws.id }))!;
  const settings = { ...((row.settings as Record<string, unknown> | null) ?? {}), poweredBy: input.poweredBy };
  await ctx.repos.table("workspaces").update({ id: ws.id }, { settings: settings as Row<"workspaces">["settings"] });
  await audit(ctx, "workspace.updated", "workspace", ws.id, { settings: { poweredBy: input.poweredBy } });
  return { poweredBy: input.poweredBy };
}
