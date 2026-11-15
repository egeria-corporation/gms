// SPDX-License-Identifier: AGPL-3.0-only
// In-browser "Send to the funder" for mock mode and tests. Reads the outside-application and vault
// stores the other mocks share, so the package lists exactly what the screens show: the
// application's own files and the vault documents used for its checklist. The same rules as the
// server: answers screened for bank, card and identity numbers, the internal deadline left out, a
// preview first and exactly that email sent, five a day per application, the footer setting.
import { ApiError } from "../api/client.ts";
import type { PackageBlocked, PackageEmailInput, PackageEmailPreview, PackageFile, SendPackage, SendPackageApi } from "../api/sendPackage.ts";
import type { VaultDocument } from "../api/writeKeep.ts";
import type { Session } from "../auth/types.ts";
import type { MockRecord, OutsideStore } from "./outside.ts";

export const PACKAGE_FOOTER = "Prepared with the OpenGrants Grant Management System, free for funders and applicants · gms.opengrants.io";
export const PACKAGE_EMAILS_PER_DAY = 5;
const MAX_EMAIL_BYTES = 20 * 1024 * 1024;
const MAIL_FROM = "notify@gms.opengrants.io";

export interface SendPackageStore {
  footer: boolean;
  /** Emails sent: what the person confirmed, by application and day. */
  sent: { applicationId: string; day: string; to: string; preview: PackageEmailPreview }[];
}
export const seedSendPackageStore = (): SendPackageStore => ({ footer: true, sent: [] });

export interface MockSendPackageOptions {
  session: () => Promise<Session | null>;
  outside: OutsideStore;
  vault: () => VaultDocument[];
  organization: () => string;
  /** The signed-in person's name and email (the sender). */
  person: () => Promise<{ name: string; email: string } | null>;
  store?: SendPackageStore;
  now?: () => Date;
}

const DIGIT_RUN = /\d(?:[ -]?\d){8,}/g;
/** The server's screen in short: nine or more digits read as a bank, card or identity number, unless the question asks for an EIN (nine digits) or the run is a phone number. */
export function mockSensitive(body: string, prompt: string): PackageBlocked["reason"] | null {
  for (const m of body.matchAll(DIGIT_RUN)) {
    const v = m[0];
    if (/^\d{3}[-. ]\d{3}[-. ]\d{4}$/.test(v)) continue;
    const digits = v.replace(/[\s-]/g, "");
    if (digits.length === 9) {
      if (/\bein\b/i.test(prompt)) continue;
      return "identity_number";
    }
    if (digits.length >= 10 && digits.length <= 19) return "long_number";
  }
  return null;
}
const REASON = { bank_routing: "looks like it holds bank details", identity_number: "looks like it holds a person's identity number", long_number: "looks like it holds an account or card number" } as const;

const money = (minor: number, currency: string) => `${currency} ${Math.floor(minor / 100).toLocaleString("en-US")}.${String(minor % 100).padStart(2, "0")}`;
const base = (title: string) => title.replace(/[^A-Za-z0-9 _-]+/g, "").trim().replace(/\s+/g, "-").slice(0, 80) || "application";
const masked = (email: string) => `${email.slice(0, 1)}…${email.slice(email.lastIndexOf("@"))}`;

export function createMockSendPackageApi(opts: MockSendPackageOptions): SendPackageApi & { store: SendPackageStore } {
  const store = opts.store ?? seedSendPackageStore();
  const now = () => (opts.now ?? (() => new Date()))();
  const today = () => now().toISOString().slice(0, 10);

  async function signedIn() {
    if (!(await opts.session())) throw new ApiError(401, "Sign in to continue");
  }
  const appOf = (id: string): MockRecord => {
    const a = opts.outside.applications.find((x) => x.id === id);
    if (!a) throw new ApiError(404, "Outside application not found");
    return a;
  };

  function summaryOf(a: MockRecord): SendPackage {
    const questions = a.questions.filter((q) => !q.obligationId).sort((x, y) => (x.phase === y.phase ? x.position - y.position : x.phase === "loi" ? -1 : 1));
    const latest = (q: MockRecord["questions"][number]) => q.versions.at(-1)?.body ?? "";
    const blocked = questions.flatMap((q, i) => {
      const why = mockSensitive(latest(q), q.prompt);
      return why ? [{ questionId: q.id, number: i + 1, prompt: q.prompt, reason: why, message: `The answer to question ${i + 1} (“${q.prompt.slice(0, 120)}”) ${REASON[why]}. Take the number out of the answer, then try again.` }] : [];
    });
    const own = a.documents.filter((d) => d.id !== a.snapshotDocumentId && d.id !== a.receiptDocumentId && !["funder_guidelines", "award_letter"].includes((d as { docType?: string | null }).docType ?? ""));
    const vault = opts.vault();
    const used = a.requiredDocuments.flatMap((r) => {
      const v = r.status === "attached" && r.documentId ? vault.find((x) => x.id === r.documentId) : undefined;
      return v ? [{ v, label: r.label }] : [];
    });
    const taken = new Set([`${base(a.title)}.pdf`.toLowerCase(), "answers.txt"]);
    const unique = (name: string) => {
      const dot = name.lastIndexOf(".");
      const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
      let c = name;
      for (let n = 2; taken.has(c.toLowerCase()); n++) c = `${stem} (${n})${ext}`;
      taken.add(c.toLowerCase());
      return c;
    };
    const attachments: PackageFile[] = [
      ...own.map((d) => ({ documentId: d.id, name: unique(d.name), originalName: d.name, source: "application" as const, requiredFor: null, mime: d.mime, size: d.size, sha256: d.sha256 ?? "" })),
      ...used.map(({ v, label }) => ({ documentId: v.id, name: unique(v.name), originalName: v.name, source: "vault" as const, requiredFor: label, mime: v.mime, size: v.size, sha256: v.sha256 ?? "" })),
    ];
    const deadlines = [...(a.loiDue ? [{ label: "Letter of inquiry due", date: a.loiDue.slice(0, 10) }] : []), ...(a.fullDue ? [{ label: "Application due", date: a.fullDue.slice(0, 10) }] : [])];
    if (!deadlines.length && a.rolling) deadlines.push({ label: "Deadline", date: "Rolling" });
    const years = a.askByYear.map((y) => ({ year: y.year, minor: "amountMinor" in y && typeof y.amountMinor === "number" ? y.amountMinor : Math.round(Number((y as { amount?: { amount: string } }).amount?.amount ?? 0) * 100) }));
    const currency = a.askAmount?.currency ?? a.currency;
    const total = attachments.reduce((n, f) => n + f.size, 0);
    const sentToday = store.sent.filter((s) => s.applicationId === a.id && s.day === today()).length;
    const reason = blocked.length ? "An answer looks like it holds a bank, card or identity number" : a.archivedAt ? "This application is archived. Unarchive it to send it" : total > MAX_EMAIL_BYTES ? "The files are too large to email (up to 20 MB). Download the package and share it another way" : sentToday >= PACKAGE_EMAILS_PER_DAY ? `This application's package was emailed ${PACKAGE_EMAILS_PER_DAY} times today, the most for one day. Try again tomorrow` : null;
    return {
      applicationId: a.id,
      title: a.title,
      cover: { organization: opts.organization(), funder: a.funderName, program: a.programName, ask: a.askAmount, askPrinted: a.askAmount ? money(Math.round(Number(a.askAmount.amount) * 100), a.askAmount.currency) : null, deadlines, answersAsOf: a.updatedAt.slice(0, 10) },
      questions: questions.map((q, i) => ({ id: q.id, number: i + 1, phase: q.phase as "loi" | "full" | "report", prompt: q.prompt, answered: latest(q).trim().length > 0 })),
      budget: years.length ? { byYear: years.map((y) => ({ year: y.year, amount: { amount: (y.minor / 100).toFixed(2), currency } })), total: money(years.reduce((n, y) => n + y.minor, 0), currency) } : null,
      attachments,
      notIncluded: [],
      footer: { shown: store.footer, text: PACKAGE_FOOTER, canChange: true },
      blocked,
      files: { pdf: `${base(a.title)}.pdf`, zip: `${base(a.title)}-package.zip`, contents: [`${base(a.title)}.pdf`, ...attachments.map((f) => f.name), "answers.txt"] },
      totalBytes: total,
      downloads: { pdf: `/gms/outside-applications/${a.id}/package.pdf`, zip: `/gms/outside-applications/${a.id}/package.zip` },
      email: { available: reason === null, reason, perDay: PACKAGE_EMAILS_PER_DAY, sentToday, remainingToday: Math.max(0, PACKAGE_EMAILS_PER_DAY - sentToday), maxBytes: MAX_EMAIL_BYTES },
    };
  }

  const refuseBlocked = (p: SendPackage) => {
    if (p.blocked.length) throw new ApiError(422, p.blocked[0]!.message, p.blocked.map((b) => ({ code: "sensitive_answer", field: `questions[${b.number - 1}]`, detail: b.message })));
  };

  async function compose(id: string, input: PackageEmailInput): Promise<PackageEmailPreview> {
    await signedIn();
    const a = appOf(id);
    const p = summaryOf(a);
    refuseBlocked(p);
    if (a.archivedAt) throw new ApiError(409, "This application is archived. Unarchive it to change it");
    const to = input.to.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) throw new ApiError(400, "Enter the funder contact's full email address", [{ field: "to", message: "Enter a full email address" }]);
    const me = await opts.person();
    if (!me) throw new ApiError(422, "Your account has no email address for replies");
    const files = [p.files.pdf, ...p.attachments.map((f) => f.name)];
    const message = input.message?.trim() ?? "";
    const facts = [`Organization: ${p.cover.organization}`, `Application: ${a.title}`, `Funder: ${a.funderName}`, ...(a.programName ? [`Program: ${a.programName}`] : []), `Ask: ${p.cover.askPrinted ?? "Not stated"}`, ...(p.cover.deadlines.length ? [`Deadline: ${p.cover.deadlines.map((d) => `${d.label} ${d.date}`).join("; ")}`] : [])];
    const intro = `${me.name} of ${p.cover.organization} sends the application below for ${a.funderName}. The questions and answers are in the attached PDF, with the other files they named.`;
    const reply = `Reply to this email to reach ${me.name} (${me.email}).`;
    const text = [...(message ? [message] : []), intro, facts.join("\n"), `Attached:\n${files.map((f) => `- ${f}`).join("\n")}`, reply, ...(p.footer.shown ? [`--\n${PACKAGE_FOOTER}`] : [])].join("\n\n");
    const digest = Array.from(new TextEncoder().encode(JSON.stringify([to, text])))
      .reduce((h, b) => (h * 31 + b) >>> 0, 7)
      .toString(16)
      .padStart(64, "0");
    const sentToday = store.sent.filter((s) => s.applicationId === a.id && s.day === today()).length;
    return {
      from: `"${me.name}" <${MAIL_FROM}>`,
      to,
      replyTo: me.email,
      subject: `Application: ${a.title} (${p.cover.organization})`,
      text,
      html: text,
      attachments: files.map((f, i) => ({ filename: f, contentType: i === 0 ? "application/pdf" : (p.attachments[i - 1]?.mime ?? "application/octet-stream"), sha256: "", size: i === 0 ? 48_000 : (p.attachments[i - 1]?.size ?? 0) })),
      digest,
      perDay: PACKAGE_EMAILS_PER_DAY,
      remainingToday: Math.max(0, PACKAGE_EMAILS_PER_DAY - sentToday),
    };
  }

  return {
    store,
    async get(id) {
      await signedIn();
      return structuredClone(summaryOf(appOf(id)));
    },
    async download(id, kind) {
      await signedIn();
      const p = summaryOf(appOf(id));
      refuseBlocked(p);
      const body = kind === "pdf" ? `%PDF-1.4\n% ${p.title}\n` : `PK mock package: ${p.files.contents.join(", ")}`;
      return { blob: new Blob([body], { type: kind === "pdf" ? "application/pdf" : "application/zip" }), filename: kind === "pdf" ? p.files.pdf : p.files.zip };
    },
    previewEmail: (id, input) => compose(id, input),
    async sendEmail(id, input) {
      const preview = await compose(id, input);
      if (preview.digest !== input.digest) throw new ApiError(409, "The package changed since the preview. Look at the preview again before sending");
      if (preview.remainingToday <= 0) throw new ApiError(429, `This application's package can be emailed ${PACKAGE_EMAILS_PER_DAY} times a day. Try again tomorrow`);
      store.sent.push({ applicationId: id, day: today(), to: preview.to, preview });
      const a = appOf(id);
      a.activity.push({ id: crypto.randomUUID(), type: "outside_application.package_sent", at: now().toISOString(), data: { to: masked(preview.to), attachments: preview.attachments.length - 1 } });
      return { sent: true, sendId: crypto.randomUUID(), sentAt: now().toISOString(), to: preview.to, replyTo: preview.replyTo, remainingToday: preview.remainingToday - 1 };
    },
    async setFooter(poweredBy) {
      await signedIn();
      store.footer = poweredBy;
      return { poweredBy };
    },
  };
}
