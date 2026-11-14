// SPDX-License-Identifier: AGPL-3.0-only
// In-browser implementation of the outside-applications port. It shares the applicant mock's store
// (members, the answer library, tasks, built-in applications and saved listings) so the pipeline,
// the funder records and the dashboard tell one story, and it follows the contract's rules closely
// enough for the screens to behave the same in mock mode: stage moves follow the machine, a
// submission needs its date and method and leaves an "as submitted" PDF with its hash, an award
// needs an amount, consulting requests are limited per application and per day.
import type { AppDocument, Answer, OpenGrantsListing, Task } from "../api/applicant.ts";
import { ApiError } from "../api/client.ts";
import {
  toListItem,
  minorOf,
  type ConsultingPreview,
  type FunderRecord,
  type FunderRecordApplication,
  type ImportField,
  type ImportRow,
  type OutsideAnswer,
  type OutsideApi,
  type OutsideApplication,
  type OutsideDetail,
  type OutsideEvent,
  type OutsideListItem,
  type OutsideQuestion,
  type PipelineItem,
} from "../api/outside.ts";
import type { Session } from "../auth/types.ts";
import { parseCsv } from "../lib/csv.ts";
import { parseDollars } from "../lib/format.ts";
import { countText, isOverLimit, OUTSIDE_STAGES, parseQuestions, plainMoves, STAGE_LABELS, TRANSITIONS, type OutsideStage } from "../lib/outside.ts";
import { APPLICANT_IDS, type ApplicantStore } from "./applicant.ts";

/** Where consulting requests go on every install unless the server is told otherwise. */
export const CONSULTING_REQUEST_TO = "hello@agents.opengrants.io";
export const CONSULTING_LIMITS = { perApplication: 3, perWorkspace: 10, windowMs: 24 * 60 * 60 * 1000 };
const ANSWERS_CAP = 20_000;

const clone = <T>(v: T): T => structuredClone(v);
const notFound = (what: string) => new ApiError(404, `${what} not found`);
const invalid = (field: string, message: string) => new ApiError(422, message, [{ field, message }]);

export interface MockQuestion extends Omit<OutsideQuestion, "answer"> {
  versions: OutsideAnswer[];
}
export interface MockRecord extends OutsideApplication {
  questions: MockQuestion[];
  documents: AppDocument[];
  activity: OutsideEvent[];
}
interface StoredFile {
  name: string;
  mime: string;
  bytes: Uint8Array;
}
export interface OutsideStore {
  applications: MockRecord[];
  funderRecords: Omit<FunderRecord, "applications">[];
  calendarFeed: { token: string; createdAt: string } | null;
  consulting: { applicationId: string; at: string; preview: ConsultingPreview }[];
  files: Record<string, StoredFile>;
}

export const OUTSIDE_IDS = {
  northwind: "oap_d1000000-0000-7000-8000-000000000001",
  larkspur: "oap_d1000000-0000-7000-8000-000000000002",
  pinecrest: "oap_d1000000-0000-7000-8000-000000000003",
  harvest: "oap_d1000000-0000-7000-8000-000000000004",
  /** Awarded, with obligations (v1.7). */
  cedar: "oap_d1000000-0000-7000-8000-000000000005",
  /** Declined, with a next cycle. */
  lakeshore: "oap_d1000000-0000-7000-8000-000000000006",
  /** Deciding whether to apply (go/no-go). */
  meadow: "oap_d1000000-0000-7000-8000-000000000007",
  recNorthwind: "fdr_d2000000-0000-7000-8000-000000000001",
  recPinecrest: "fdr_d2000000-0000-7000-8000-000000000002",
} as const;

function record(over: Partial<MockRecord> & Pick<MockRecord, "id" | "title" | "funderName" | "stage">): MockRecord {
  const at = "2026-10-01T15:00:00Z";
  return {
    programName: null,
    funderRecordId: null,
    source: "manual",
    sourceRef: null,
    listing: null,
    listingUrl: null,
    portalUrl: null,
    previousStage: null,
    currency: "USD",
    askAmount: null,
    askByYear: [],
    loiDue: null,
    fullDue: null,
    internalDue: null,
    rolling: false,
    submittedAt: null,
    submissionMethod: null,
    confirmationRef: null,
    receiptDocumentId: null,
    snapshotDocumentId: null,
    snapshotSha256: null,
    decidedAt: null,
    awardedAmount: null,
    awardByYear: [],
    grantStart: null,
    grantEnd: null,
    decisionNotes: null,
    nextCycleOn: null,
    owner: { userId: APPLICANT_IDS.maria, name: "Maria Santos" },
    customFields: {},
    archivedAt: null,
    createdAt: at,
    updatedAt: at,
    requiredDocuments: [],
    goNoGo: null,
    closedOutAt: null,
    awardLetterDocumentId: null,
    questions: [],
    documents: [],
    activity: [{ id: `${over.id}-created`, type: "outside_application.created", at, actor: `user:${APPLICANT_IDS.maria}`, data: { stage: over.stage } }],
    ...over,
  };
}

const question = (id: string, position: number, prompt: string, over: Partial<MockQuestion> = {}): MockQuestion => ({
  id,
  phase: "full",
  section: null,
  position,
  prompt,
  guidance: null,
  limitKind: null,
  limitValue: null,
  required: true,
  assigneeUserId: null,
  status: "empty",
  obligationId: null,
  versions: [],
  ...over,
});

export const day = (offset: number, from = new Date()) => new Date(from.getTime() + offset * 86_400_000).toISOString().slice(0, 10);
export { question as mockQuestion };

export function seedOutsideStore(): OutsideStore {
  const I = APPLICANT_IDS;
  const answered = (qid: string, body: string, version = 1): OutsideAnswer[] =>
    Array.from({ length: version }, (_, i) => ({ id: `${qid}-v${i + 1}`, questionId: qid, version: i + 1, body: i + 1 === version ? body : body.split(". ")[0] + ".", provenance: "user", libraryAnswerId: null, createdBy: I.maria, createdAt: `2026-10-0${i + 2}T16:00:00Z` }));
  return {
    applications: [
      record({
        id: OUTSIDE_IDS.northwind,
        title: "Family Navigation Expansion",
        programName: "Community Health Access",
        funderName: "Northwind Health Trust",
        funderRecordId: OUTSIDE_IDS.recNorthwind,
        stage: "drafting",
        previousStage: "invited",
        portalUrl: "https://apply.northwind.example/portal",
        listingUrl: "https://northwind.example/grants/community-health-access",
        askAmount: { amount: "120000.00", currency: "USD" },
        askByYear: [
          { year: 2027, amountMinor: 6000000 },
          { year: 2028, amountMinor: 6000000 },
        ],
        loiDue: day(-30),
        fullDue: day(23),
        internalDue: day(16),
        customFields: { "Program officer": "Ruth Calloway" },
        questions: [
          question("oqn_d3000000-0000-7000-8000-000000000001", 1, "Describe the need your project addresses and who it serves. (250 words)", { limitKind: "words", limitValue: 250, status: "draft", assigneeUserId: I.maria, versions: answered("oqn_d3000000-0000-7000-8000-000000000001", "Families in the Alder Creek valley travel more than forty minutes to reach a clinic. Many miss appointments because of the distance.", 2) }),
          question("oqn_d3000000-0000-7000-8000-000000000002", 2, "How will you measure success? Maximum 1,500 characters including spaces.", { limitKind: "chars", limitValue: 1500, assigneeUserId: I.jamal }),
          question("oqn_d3000000-0000-7000-8000-000000000003", 3, "Briefly describe your organization's history and mission.", { required: false, status: "approved", versions: answered("oqn_d3000000-0000-7000-8000-000000000003", "Alder Creek Family Services helps rural families reach the health care, housing and food they need to stay well and stay together.") }),
        ],
        activity: [
          { id: "oev-1", type: "outside_application.created", at: "2026-09-12T15:00:00Z", actor: `user:${I.maria}`, data: { stage: "prospect" } },
          { id: "oev-2", type: "outside_application.stage_changed", at: "2026-09-20T15:00:00Z", actor: `user:${I.maria}`, data: { from: "prospect", to: "loi" } },
          { id: "oev-3", type: "outside_application.stage_changed", at: "2026-10-18T15:00:00Z", actor: `user:${I.jamal}`, data: { from: "loi", to: "invited" } },
          { id: "oev-4", type: "outside_application.stage_changed", at: "2026-10-21T15:00:00Z", actor: `user:${I.maria}`, data: { from: "invited", to: "drafting" } },
        ],
      }),
      record({ id: OUTSIDE_IDS.larkspur, title: "Food Security Planning Grant", funderName: "Larkspur Foundation", stage: "prospect", rolling: true, askAmount: { amount: "25000.00", currency: "USD" }, owner: null }),
      record({
        id: OUTSIDE_IDS.pinecrest,
        title: "Youth Mentoring Pilot",
        funderName: "Pinecrest Family Foundation",
        funderRecordId: OUTSIDE_IDS.recPinecrest,
        stage: "submitted",
        previousStage: "drafting",
        askAmount: { amount: "40000.00", currency: "USD" },
        fullDue: day(-12),
        submittedAt: day(-14),
        submissionMethod: "email",
        confirmationRef: "PFF-2026-0418",
        owner: { userId: I.jamal, name: "Jamal Reed" },
      }),
      record({ id: OUTSIDE_IDS.harvest, title: "Winter Pantry Support", funderName: "Harvest Table Fund", stage: "loi", loiDue: day(6), askAmount: { amount: "15000.00", currency: "USD" }, owner: { userId: I.jamal, name: "Jamal Reed" } }),
      record({
        id: OUTSIDE_IDS.cedar,
        title: "School-Based Health Clinics",
        programName: "Healthy Schools",
        funderName: "Cedar Valley Community Fund",
        stage: "awarded",
        previousStage: "submitted",
        askAmount: { amount: "60000.00", currency: "USD" },
        fullDue: day(-300),
        submittedAt: day(-305),
        submissionMethod: "portal",
        confirmationRef: "CVCF-1182",
        decidedAt: `${day(-250)}T16:00:00Z`,
        awardedAmount: { amount: "60000.00", currency: "USD" },
        awardByYear: [
          { year: Number(day(-220).slice(0, 4)), amountMinor: 3000000 },
          { year: Number(day(-220).slice(0, 4)) + 1, amountMinor: 3000000 },
        ],
        grantStart: day(-220),
        grantEnd: day(510),
        questions: [
          question("oqn_d3000000-0000-7000-8000-000000000011", 1, "Describe the progress made in the first six months.", { phase: "report", obligationId: "obl_d5000000-0000-7000-8000-000000000001", limitKind: "words", limitValue: 300, status: "approved", versions: answered("oqn_d3000000-0000-7000-8000-000000000011", "Both school clinics opened in the first term. Nurses saw 412 students, and 37 families were referred to a medical home.") }),
          question("oqn_d3000000-0000-7000-8000-000000000012", 2, "What challenges did you meet, and how did you respond?", { phase: "report", obligationId: "obl_d5000000-0000-7000-8000-000000000001", status: "approved", versions: answered("oqn_d3000000-0000-7000-8000-000000000012", "Consent forms came back slowly. We moved them into the enrollment packet and doubled the return rate.") }),
        ],
        activity: [
          { id: "oev-c1", type: "outside_application.submitted", at: `${day(-305)}T16:00:00Z`, actor: `user:${I.maria}`, data: { method: "portal" } },
          { id: "oev-c2", type: "outside_application.decided", at: `${day(-250)}T16:00:00Z`, actor: `user:${I.maria}`, data: { outcome: "awarded" } },
        ],
      }),
      record({
        id: OUTSIDE_IDS.lakeshore,
        title: "Community Clinics Initiative",
        programName: "Community Clinics",
        funderName: "Lakeshore Health Fund",
        stage: "declined",
        previousStage: "submitted",
        askAmount: { amount: "75000.00", currency: "USD" },
        submittedAt: day(-70),
        submissionMethod: "email",
        decidedAt: `${day(-20)}T16:00:00Z`,
        decisionNotes: "The panel funded projects further along. They encouraged us to apply again next cycle.",
        nextCycleOn: day(75),
        owner: { userId: I.jamal, name: "Jamal Reed" },
      }),
      record({ id: OUTSIDE_IDS.meadow, title: "Senior Ride Program", funderName: "Meadowlark Foundation", stage: "deciding", previousStage: "prospect", fullDue: day(45), askAmount: { amount: "30000.00", currency: "USD" } }),
    ],
    funderRecords: [
      {
        id: OUTSIDE_IDS.recNorthwind,
        name: "Northwind Health Trust",
        website: "https://northwind.example",
        notes: "Prefers outcomes framed around appointments kept. Ruth asked for a call before the full proposal.",
        contacts: [
          { name: "Ruth Calloway", role: "Program officer", email: "ruth.calloway@northwind.example" },
          { name: "Grants office", email: "grants@northwind.example" },
        ],
        portalUrl: "https://apply.northwind.example/portal",
        portalLoginHolder: "Jamal Reed",
        createdAt: "2026-09-12T15:00:00Z",
        updatedAt: "2026-10-21T15:00:00Z",
      },
      { id: OUTSIDE_IDS.recPinecrest, name: "Pinecrest Family Foundation", website: null, notes: null, contacts: [], portalUrl: null, portalLoginHolder: null, createdAt: "2026-08-01T15:00:00Z", updatedAt: "2026-08-01T15:00:00Z" },
    ],
    calendarFeed: null,
    consulting: [],
    files: {},
  };
}

// ------------------------------------------------------------------------------------ files

const ASCII: Record<string, string> = { "‘": "'", "’": "'", "“": '"', "”": '"', "–": "-", "—": "-", "…": "...", " ": " " };
const pdfText = (s: string) => s.replace(/[^\x20-\x7E]/g, (c) => ASCII[c] ?? "?").replace(/([\\()])/g, "\\$1");

function wrap(line: string, width = 92): string[] {
  if (line.length <= width) return [line];
  const out: string[] = [];
  let cur = "";
  for (const w of line.split(/\s+/)) {
    if ((cur + " " + w).trim().length > width) {
      if (cur) out.push(cur);
      cur = w;
    } else cur = (cur + " " + w).trim();
  }
  if (cur) out.push(cur);
  return out;
}

/** A plain, valid PDF of text lines (Helvetica, US Letter), for the mock's "as submitted" copy. */
export function textPdf(lines: string[]): Uint8Array {
  const all = lines.flatMap((l) => (l ? wrap(l) : [""]));
  const pages: string[][] = [];
  for (let i = 0; i < all.length || i === 0; i += 50) pages.push(all.slice(i, i + 50));
  const objects: string[] = [];
  const kids = pages.map((_, i) => `${3 + i * 2} 0 R`).join(" ");
  const font = 3 + pages.length * 2;
  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  objects.push(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
  pages.forEach((p, i) => {
    const stream = `BT /F1 10 Tf 54 740 Td 14 TL ${p.map((l) => `(${pdfText(l)}) Tj T*`).join(" ")} ET`;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${4 + i * 2} 0 R /Resources << /Font << /F1 ${font} 0 R >> >> >>`);
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((n) => `${String(n).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    const digest = await subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  // Test environments without WebCrypto: a stable stand-in of the same length.
  let h = 0x811c9dc5;
  for (const b of bytes) h = Math.imul(h ^ b, 0x01000193) >>> 0;
  return h.toString(16).padStart(8, "0").repeat(8);
}

const fromBase64 = (b64: string): Uint8Array => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

// ------------------------------------------------------------------------------------ the port

export interface MockOutsideOptions {
  session: () => Promise<Session | null>;
  applicant: ApplicantStore;
  store?: OutsideStore;
  now?: () => Date;
  actor?: { userId: string; name: string };
  /** Where the calendar feed is served; the page's own origin by default. */
  origin?: string;
}

export function createMockOutsideApi(opts: MockOutsideOptions): OutsideApi & { store: OutsideStore } {
  const store = opts.store ?? seedOutsideStore();
  const A = opts.applicant;
  const now = () => (opts.now ?? (() => new Date()))().toISOString();
  const actor = opts.actor ?? { userId: APPLICANT_IDS.maria, name: "Maria Santos" };
  const uuid = () => crypto.randomUUID();

  async function signedIn() {
    if (!(await opts.session())) throw new ApiError(401, "Sign in to continue");
  }
  const appOf = (id: string): MockRecord => {
    const a = store.applications.find((x) => x.id === id);
    if (!a) throw notFound("Application");
    return a;
  };
  const questionOf = (qid: string): { app: MockRecord; q: MockQuestion } => {
    for (const app of store.applications) {
      const q = app.questions.find((x) => x.id === qid);
      if (q) return { app, q };
    }
    throw notFound("Question");
  };
  const writable = (a: MockRecord) => {
    if (a.archivedAt) throw new ApiError(409, "This application is archived. Unarchive it to make changes");
  };
  const log = (a: MockRecord, type: string, data: Record<string, unknown> = {}) => {
    a.updatedAt = now();
    a.activity.push({ id: uuid(), type: `outside_application.${type}`, at: a.updatedAt, actor: `user:${actor.userId}`, data });
  };
  const memberName = (userId: string | null | undefined) => A.members.find((m) => m.userId === userId)?.name ?? null;
  const latest = (q: MockQuestion) => q.versions[q.versions.length - 1] ?? null;
  /** The application's own questions; report questions belong to their obligation. */
  const own = (a: MockRecord) => a.questions.filter((q) => !q.obligationId);
  const viewQuestion = (q: MockQuestion): OutsideQuestion => {
    const { versions: _v, ...rest } = q;
    return clone({ ...rest, answer: latest(q) });
  };
  const viewApp = (a: MockRecord): OutsideApplication => {
    const { questions: _q, documents: _d, activity: _e, ...rest } = a;
    return clone(rest);
  };
  const tasksOf = (id: string): Task[] => A.tasks.filter((t) => t.subjectType === "outside_application" && t.subjectId === id);
  const viewDetail = (a: MockRecord): OutsideDetail =>
    clone({ ...viewApp(a), questions: [...a.questions].sort((x, y) => x.position - y.position).map(viewQuestion), documents: a.documents, tasks: tasksOf(a.id), activity: a.activity });
  const listItem = (a: MockRecord): OutsideListItem =>
    toListItem({ ...viewApp(a), questionCounts: { total: own(a).length, approved: own(a).filter((q) => q.status === "approved").length } });

  const storeFile = async (name: string, mime: string, bytes: Uint8Array): Promise<AppDocument> => {
    const doc: AppDocument = { id: `doc_${uuid()}`, name, mime, size: bytes.length, sha256: await sha256(bytes), source: "upload", passportDocumentId: null, scanStatus: "clean", uploadedAt: now() };
    store.files[doc.id] = { name, mime, bytes };
    return doc;
  };

  const asText = (a: MockRecord, format: "txt" | "md") => {
    const lines: string[] = [];
    const h = (t: string) => (format === "md" ? `# ${t}` : t.toUpperCase());
    lines.push(h(a.title), `${a.funderName}${a.programName ? ` · ${a.programName}` : ""}`, "");
    [...own(a)]
      .sort((x, y) => x.position - y.position)
      .forEach((q, i) => {
        lines.push(format === "md" ? `## ${i + 1}. ${q.prompt}` : `${i + 1}. ${q.prompt}`, "", latest(q)?.body || "(no answer yet)", "");
      });
    return lines.join("\n");
  };

  const CLOSED = new Set<OutsideStage>(["awarded", "declined", "withdrawn", "not_pursuing"]);
  const REOPEN_FALLBACK: Readonly<Record<string, OutsideStage>> = { awarded: "submitted", declined: "submitted", withdrawn: "drafting", not_pursuing: "prospect" };
  const pipelineItems = (): PipelineItem[] => {
    const gms = A.applications.map((x): PipelineItem => {
      const c = A.competitions.find((k) => k.id === x.competitionId);
      const stage = c?.stages.find((s) => s.key === x.stage);
      const editable = x.status === "draft" || x.status === "revision_requested";
      return { kind: "gms_application", id: `app_${x.uuid}`, title: x.title, funderName: A.funders[x.funderWorkspaceId]?.name ?? null, status: x.status, nextDeadline: editable ? (stage?.closes?.slice(0, 10) ?? null) : null, url: `/applications/app_${x.uuid}${editable ? "/edit" : ""}` };
    });
    const saved = A.saved
      .filter((s) => s.source === "gms" && !s.externalId.startsWith("alert:"))
      .map((s): PipelineItem => ({ kind: "saved_gms", id: s.id, title: s.title, funderName: null, status: "saved", nextDeadline: null, url: s.url ?? null }));
    const outside = store.applications
      .filter((a) => !a.archivedAt)
      .map((a): PipelineItem => {
        const next = [a.internalDue, a.loiDue, a.fullDue].filter((d): d is string => !!d && d >= now().slice(0, 10)).sort()[0] ?? null;
        return { kind: "outside_application", id: a.id, title: a.title, funderName: a.funderName, stage: a.stage, nextDeadline: CLOSED.has(a.stage) || a.stage === "submitted" ? null : next, url: `/outside/${a.id}` };
      });
    return [...outside, ...gms, ...saved];
  };

  const funderView = (r: Omit<FunderRecord, "applications">): FunderRecord => {
    const mine = store.applications
      .filter((a) => a.funderRecordId === r.id)
      .map((a): FunderRecordApplication => ({ kind: "outside_application", id: a.id, title: a.title, stage: a.stage, askAmount: a.askAmount, awardedAmount: a.awardedAmount, submittedAt: a.submittedAt, decidedAt: a.decidedAt }));
    const matched = A.applications
      .filter((x) => A.funders[x.funderWorkspaceId]?.name === r.name)
      .map((x): FunderRecordApplication => ({ kind: "gms_application", id: `app_${x.uuid}`, title: x.title, status: x.status, submittedAt: x.submittedAt, nameMatch: true }));
    return clone({ ...r, applications: [...mine, ...matched] });
  };
  const recordOf = (id: string) => {
    const r = store.funderRecords.find((x) => x.id === id);
    if (!r) throw notFound("Funder record");
    return r;
  };
  const checkRecord = (input: { name?: string; contacts?: unknown[] }, except?: string) => {
    if (input.name !== undefined) {
      if (!input.name.trim()) throw invalid("name", "Give the funder a name");
      if (store.funderRecords.some((x) => x.id !== except && x.name.toLowerCase() === input.name!.trim().toLowerCase())) throw new ApiError(409, "You already have a record for this funder");
    }
    if (input.contacts && input.contacts.length > 20) throw invalid("contacts", "Keep to 20 contacts or fewer");
  };

  const previewOf = (a: MockRecord, input: { contactName: string; contactEmail: string; message?: string; includeAnswers?: boolean }): ConsultingPreview => {
    if (!input.contactName.trim()) throw invalid("contactName", "Enter your name");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(input.contactEmail.trim())) throw invalid("contactEmail", "Enter a full email address");
    // As the Worker sends it: every question in full (an unanswered one with an empty answer), and
    // whether the email, which numbers them and cuts the whole at 20,000 characters, will be cut.
    const answers = input.includeAnswers ? [...own(a)].sort((x, y) => x.phase.localeCompare(y.phase) || x.position - y.position).map((q) => ({ prompt: q.prompt, body: latest(q)?.body ?? "" })) : null;
    const truncated = !!answers && answers.map((x, i) => `${i + 1}. ${x.prompt}\n${x.body.trim() || "(no answer yet)"}`).join("\n\n").length > ANSWERS_CAP;
    const organization = A.organization.displayName ?? "Your organization";
    return {
      to: CONSULTING_REQUEST_TO,
      replyTo: input.contactEmail.trim(),
      subject: `Consulting request: ${a.title} (${organization})`,
      organization,
      contactName: input.contactName.trim(),
      contactEmail: input.contactEmail.trim(),
      title: a.title,
      funder: a.funderName,
      deadlines: { loiDue: a.loiDue, fullDue: a.fullDue, internalDue: a.internalDue, rolling: a.rolling },
      ask: a.askAmount,
      listingUrl: a.listingUrl,
      portalUrl: a.portalUrl,
      stage: a.stage,
      questionCount: own(a).length,
      message: input.message?.trim() || null,
      answers,
      answersTruncated: truncated,
    };
  };

  const api: OutsideApi = {
    async list(filter = {}) {
      await signedIn();
      const q = filter.q?.trim().toLowerCase();
      return store.applications
        .filter((a) => (filter.archived ? !!a.archivedAt : !a.archivedAt))
        .filter((a) => !filter.stage || a.stage === filter.stage)
        .filter((a) => !q || `${a.title} ${a.funderName} ${a.programName ?? ""}`.toLowerCase().includes(q))
        .sort((x, y) => y.updatedAt.localeCompare(x.updatedAt))
        .map(listItem);
    },
    async create(input) {
      await signedIn();
      if (!input.title?.trim()) throw invalid("title", "Give the application a title");
      if (!input.funderName?.trim()) throw invalid("funderName", "Name the funder");
      if (input.source === "opengrants" && input.sourceRef) {
        const existing = store.applications.find((a) => a.source === "opengrants" && a.sourceRef === input.sourceRef);
        if (existing) return viewApp(existing);
      }
      const at = now();
      const stage = input.stage ?? "drafting";
      const match = store.funderRecords.find((r) => r.name.toLowerCase() === input.funderName.trim().toLowerCase());
      const a = record({
        id: `oap_${uuid()}`,
        title: input.title.trim(),
        funderName: input.funderName.trim(),
        funderRecordId: match?.id ?? null,
        programName: input.programName?.trim() || null,
        stage,
        source: input.source,
        sourceRef: input.sourceRef ?? null,
        listing: input.listing ?? null,
        listingUrl: input.listingUrl ?? input.listing?.url ?? null,
        portalUrl: input.portalUrl ?? null,
        loiDue: input.loiDue ?? null,
        fullDue: input.fullDue ?? null,
        internalDue: input.internalDue ?? null,
        rolling: input.rolling ?? false,
        askAmount: input.askAmount ?? null,
        owner: { userId: actor.userId, name: actor.name },
        createdAt: at,
        updatedAt: at,
        activity: [{ id: uuid(), type: "outside_application.created", at, actor: `user:${actor.userId}`, data: { stage, source: input.source } }],
      });
      store.applications.unshift(a);
      return viewApp(a);
    },
    async get(id) {
      await signedIn();
      return viewDetail(appOf(id));
    },
    async update(id, patch) {
      await signedIn();
      const a = appOf(id);
      writable(a);
      if (patch.title !== undefined && !patch.title.trim()) throw invalid("title", "Give the application a title");
      if (patch.customFields && Object.keys(patch.customFields).length > 30) throw invalid("customFields", "Keep to 30 fields or fewer");
      const { ownerUserId, ...rest } = patch;
      Object.assign(a, rest);
      if (ownerUserId !== undefined) a.owner = ownerUserId ? { userId: ownerUserId, name: memberName(ownerUserId) } : null;
      if (patch.funderRecordId) a.funderName = recordOf(patch.funderRecordId).name;
      a.updatedAt = now();
      return viewApp(a);
    },
    async move(id, to) {
      await signedIn();
      const a = appOf(id);
      writable(a);
      if (!plainMoves(a.stage).includes(to) && !(a.stage === "submitted" && to === "withdrawn")) throw new ApiError(409, `This application cannot move from ${STAGE_LABELS[a.stage]} to ${STAGE_LABELS[to] ?? to}`);
      const from = a.stage;
      a.previousStage = from;
      a.stage = to;
      log(a, "stage_changed", { from, to });
      return viewApp(a);
    },
    async submit(id, input) {
      await signedIn();
      const a = appOf(id);
      writable(a);
      if (!TRANSITIONS[a.stage].includes("submitted")) throw new ApiError(409, "Only an application being drafted can be marked submitted");
      if (!input.submittedAt) throw invalid("submittedAt", "Enter the date you submitted");
      if (!input.method) throw invalid("method", "Choose how you submitted");
      // As the Worker: the person records a submission already made, so never one dated after today.
      if (input.submittedAt.slice(0, 10) > now().slice(0, 10)) throw invalid("submittedAt", "The submission date cannot be in the future");
      const lines = [
        `${a.title} - as submitted`,
        `Funder: ${a.funderName}`,
        `Submitted ${input.submittedAt} by ${input.method.replace("_", ".")}${input.confirmationRef ? `, confirmation ${input.confirmationRef}` : ""}`,
        "",
        ...[...own(a)].sort((x, y) => x.position - y.position).flatMap((q, i) => [`${i + 1}. ${q.prompt}`, latest(q)?.body || "(no answer)", ""]),
      ];
      const doc = await storeFile(`${a.title} - as submitted.pdf`, "application/pdf", textPdf(lines));
      a.documents.push(doc);
      Object.assign(a, { previousStage: a.stage, stage: "submitted", submittedAt: input.submittedAt, submissionMethod: input.method, confirmationRef: input.confirmationRef?.trim() || null, receiptDocumentId: input.receiptDocumentId ?? null, snapshotDocumentId: doc.id, snapshotSha256: doc.sha256 });
      log(a, "submitted", { submittedAt: input.submittedAt, method: input.method });
      return viewApp(a);
    },
    async decide(id, input) {
      await signedIn();
      const a = appOf(id);
      writable(a);
      if (!TRANSITIONS[a.stage].includes(input.outcome)) throw new ApiError(409, `A decision of ${STAGE_LABELS[input.outcome]} cannot be recorded at ${STAGE_LABELS[a.stage]}`);
      if (input.outcome === "awarded") {
        const minor = minorOf(input.awardedAmount);
        if (minor === null || minor < 0) throw invalid("awardedAmount", "Enter the amount awarded");
      }
      Object.assign(a, {
        previousStage: a.stage,
        stage: input.outcome,
        decidedAt: now(),
        awardedAmount: input.outcome === "awarded" ? input.awardedAmount : null,
        awardByYear: input.outcome === "awarded" ? (input.awardByYear ?? []) : [],
        grantStart: input.grantStart ?? null,
        grantEnd: input.grantEnd ?? null,
        decisionNotes: input.notes?.trim() || null,
        nextCycleOn: input.nextCycleOn ?? null,
      });
      log(a, "decided", { outcome: input.outcome });
      return viewApp(a);
    },
    async reopen(id) {
      await signedIn();
      const a = appOf(id);
      writable(a);
      if (!CLOSED.has(a.stage)) throw new ApiError(409, "Only a decided or closed application can be reopened");
      const from = a.stage;
      // As the Worker's machine: back to the earlier open stage (or the fallback for the closed one),
      // and a reopened decision is no longer a decision.
      a.stage = a.previousStage && !CLOSED.has(a.previousStage) ? a.previousStage : (REOPEN_FALLBACK[from] ?? "drafting");
      a.previousStage = from;
      if (from === "awarded" || from === "declined") Object.assign(a, { decidedAt: null, awardedAmount: null, awardByYear: [], grantStart: null, grantEnd: null });
      log(a, "reopened", { from, to: a.stage });
      return viewApp(a);
    },
    async archive(id) {
      await signedIn();
      const a = appOf(id);
      a.archivedAt ??= now();
      log(a, "archived");
      return viewApp(a);
    },
    async unarchive(id) {
      await signedIn();
      const a = appOf(id);
      a.archivedAt = null;
      log(a, "unarchived");
      return viewApp(a);
    },

    async addQuestions(id, questions) {
      await signedIn();
      const a = appOf(id);
      writable(a);
      if (questions.length === 0 || questions.some((q) => !q.prompt?.trim())) throw invalid("prompt", "Each question needs its text");
      let pos = Math.max(0, ...a.questions.map((q) => q.position));
      const made = questions.map((q) =>
        question(`oqn_${uuid()}`, ++pos, q.prompt.trim(), { phase: q.obligationId ? "report" : (q.phase ?? "full"), section: q.section ?? null, guidance: q.guidance ?? null, limitKind: q.limitKind ?? null, limitValue: q.limitValue ?? null, required: q.required ?? true, assigneeUserId: q.assigneeUserId ?? null, obligationId: q.obligationId ?? null }),
      );
      a.questions.push(...made);
      a.updatedAt = now();
      return made.map(viewQuestion);
    },
    async updateQuestion(qid, patch) {
      await signedIn();
      const { app, q } = questionOf(qid);
      writable(app);
      if (patch.prompt !== undefined && !patch.prompt.trim()) throw invalid("prompt", "The question needs its text");
      const from = q.status;
      if (patch.status === "approved" && from !== "approved") {
        // As the Worker: approving is for a workspace admin or the application's owner.
        const role = A.members.find((m) => m.userId === actor.userId)?.role;
        if (role !== "admin" && app.owner?.userId !== actor.userId) throw new ApiError(403, "Only a workspace admin or the application's owner can approve an answer");
      }
      Object.assign(q, patch);
      app.updatedAt = now();
      if (patch.status && patch.status !== from) log(app, "question_status_changed", { questionId: q.id, from, to: patch.status });
      return viewQuestion(q);
    },
    async deleteQuestion(qid) {
      await signedIn();
      const { app, q } = questionOf(qid);
      writable(app);
      app.questions.splice(app.questions.indexOf(q), 1);
    },
    async parseQuestions(id, text) {
      await signedIn();
      const a = appOf(id);
      if (!text.trim()) throw invalid("text", "Paste the questions first");
      return parseQuestions(text, a.stage === "loi" ? "loi" : "full");
    },
    async putAnswer(qid, input) {
      await signedIn();
      const { app, q } = questionOf(qid);
      writable(app);
      const lib: Answer | undefined = input.libraryAnswerId ? A.answers.find((x) => x.id === input.libraryAnswerId) : undefined;
      if (input.libraryAnswerId && !lib) throw notFound("Library answer");
      if (input.provenance === "prior_submission") {
        // Reuse needs an answer from an earlier report in this workspace.
        const source = store.applications.flatMap((x) => x.questions).flatMap((x) => (x.obligationId ? x.versions : [])).find((x) => x.id === input.sourceAnswerId);
        if (!source) throw invalid("sourceAnswerId", "Choose an answer from an earlier report");
      }
      const provenance = lib ? "library" : input.provenance === "assist" ? "assist" : input.provenance === "prior_submission" ? "prior_submission" : "user";
      const v: OutsideAnswer = { id: uuid(), questionId: qid, version: (latest(q)?.version ?? 0) + 1, body: input.body, provenance, libraryAnswerId: lib?.id ?? null, createdBy: actor.userId, createdAt: now() };
      q.versions.push(v);
      if (q.status === "empty" && input.body.trim()) q.status = "draft";
      if (lib) (lib.usedIn as unknown as unknown[]).push({ outsideApplicationId: app.id, questionId: qid, version: lib.version, insertedAt: v.createdAt });
      app.updatedAt = v.createdAt;
      const counts = countText(input.body);
      return clone({ ...v, counts, overLimit: isOverLimit(counts, q.limitKind, q.limitValue) });
    },
    async answerHistory(qid) {
      await signedIn();
      return clone([...questionOf(qid).q.versions].reverse());
    },
    async exportApplication(id, format) {
      await signedIn();
      const a = appOf(id);
      const base = a.title.replace(/[^\w -]+/g, "").trim() || "application";
      if (format === "pdf") return { filename: `${base}.pdf`, blob: new Blob([textPdf(asText(a, "txt").split("\n")) as BlobPart], { type: "application/pdf" }) };
      return { filename: `${base}.${format}`, blob: new Blob([asText(a, format)], { type: format === "md" ? "text/markdown" : "text/plain" }) };
    },

    async uploadDocument(id, input) {
      await signedIn();
      const a = appOf(id);
      writable(a);
      let doc: AppDocument;
      if ("contentBase64" in input) doc = await storeFile(input.name, input.mime, fromBase64(input.contentBase64));
      else doc = { id: `doc_${uuid()}`, name: input.name, mime: input.mime, size: input.size, sha256: input.sha256, source: "passport_locker", passportDocumentId: input.passportDocumentId, scanStatus: "not_scanned", uploadedAt: now() };
      a.documents.push(doc);
      a.updatedAt = now();
      return clone(doc);
    },
    async documentFile(id, documentId) {
      await signedIn();
      const a = appOf(id);
      const doc = a.documents.find((d) => d.id === documentId);
      const f = store.files[documentId];
      if (!doc || !f) throw notFound("Document");
      return { filename: f.name, blob: new Blob([f.bytes as BlobPart], { type: f.mime }) };
    },
    async createTask(id, input) {
      await signedIn();
      appOf(id);
      if (!input.title.trim()) throw invalid("title", "Give the task a title");
      const t: Task = { id: uuid(), subjectType: "outside_application", subjectId: id, title: input.title.trim(), assigneeUserId: input.assigneeUserId ?? null, dueAt: input.dueAt ?? null, doneAt: null, createdAt: now() };
      A.tasks.push(t);
      return clone(t);
    },

    async pipeline() {
      await signedIn();
      return clone(pipelineItems());
    },

    async funderRecords() {
      await signedIn();
      return [...store.funderRecords].sort((x, y) => x.name.localeCompare(y.name)).map(funderView);
    },
    async funderRecord(id) {
      await signedIn();
      return funderView(recordOf(id));
    },
    async createFunderRecord(input) {
      await signedIn();
      checkRecord(input);
      const at = now();
      const r = { id: `fdr_${uuid()}`, name: input.name.trim(), website: input.website ?? null, notes: input.notes ?? null, contacts: input.contacts ?? [], portalUrl: input.portalUrl ?? null, portalLoginHolder: input.portalLoginHolder ?? null, createdAt: at, updatedAt: at };
      store.funderRecords.push(r);
      // As the Worker: outside applications already naming this funder are linked to the new record.
      for (const a of store.applications) if (!a.funderRecordId && a.funderName && a.funderName.trim().toLowerCase() === r.name.toLowerCase()) a.funderRecordId = r.id;
      return funderView(r);
    },
    async updateFunderRecord(id, patch) {
      await signedIn();
      const r = recordOf(id);
      checkRecord(patch, id);
      Object.assign(r, { ...patch, ...(patch.name ? { name: patch.name.trim() } : {}), updatedAt: now() });
      if (patch.name) for (const a of store.applications) if (a.funderRecordId === id) a.funderName = r.name;
      return funderView(r);
    },
    async deleteFunderRecord(id) {
      await signedIn();
      const r = recordOf(id);
      store.funderRecords.splice(store.funderRecords.indexOf(r), 1);
      for (const a of store.applications) if (a.funderRecordId === id) a.funderRecordId = null;
    },

    async createCalendarFeed() {
      await signedIn();
      const token = [...crypto.getRandomValues(new Uint8Array(24))].map((b) => b.toString(16).padStart(2, "0")).join("");
      store.calendarFeed = { token, createdAt: now() };
      const origin = opts.origin ?? globalThis.location?.origin ?? "https://gms.opengrants.io";
      return { url: `${origin}/gms/cal/${token}.ics` };
    },
    async deleteCalendarFeed() {
      await signedIn();
      store.calendarFeed = null;
    },

    async importCsv(input) {
      await signedIn();
      const rows = parseCsv(input.csv);
      const header = rows[0] ?? [];
      const body = rows.slice(1);
      if (!header.length) throw invalid("csv", "The file has no header row");
      if (body.length > 500) throw invalid("csv", "Import at most 500 rows at a time");
      const col = (f: ImportField) => (input.mapping[f] ? header.indexOf(input.mapping[f]!) : -1);
      const ALLOWED = new Set<string>(["prospect", "deciding", "loi", "invited", "drafting"]);
      const preview: ImportRow[] = body.map((cells, i) => {
        const values: ImportRow["values"] = {};
        for (const f of Object.keys(input.mapping) as ImportField[]) {
          const c = col(f);
          if (c >= 0 && cells[c]?.trim()) values[f] = cells[c]!.trim();
        }
        const problems: ImportRow["problems"] = [];
        if (!values.title) problems.push({ field: "title", message: "No title" });
        if (!values.funderName) problems.push({ field: "funderName", message: "No funder" });
        for (const f of ["loiDue", "fullDue", "internalDue"] as const) if (values[f] && !/^\d{4}-\d{2}-\d{2}$/.test(values[f]!)) problems.push({ field: f, message: "Write dates as YYYY-MM-DD" });
        if (values.stage && !ALLOWED.has(values.stage.toLowerCase())) problems.push({ field: "stage", message: OUTSIDE_STAGES.includes(values.stage.toLowerCase() as OutsideStage) ? "Record submissions and decisions on the application after it is imported" : "Unknown stage" });
        if (values.askAmount && parseDollars(values.askAmount) === null) problems.push({ field: "askAmount", message: "Write the amount in dollars, such as 25000" });
        return { row: i + 2, values, problems };
      });
      const created: OutsideListItem[] = [];
      if (!input.dryRun) {
        for (const r of preview.filter((x) => x.problems.length === 0)) {
          const v = r.values;
          const minor = v.askAmount ? parseDollars(v.askAmount) : null;
          const made = await api.create({
            source: "import",
            title: v.title!,
            funderName: v.funderName!,
            ...(v.programName ? { programName: v.programName } : {}),
            ...(v.loiDue ? { loiDue: v.loiDue } : {}),
            ...(v.fullDue ? { fullDue: v.fullDue } : {}),
            ...(v.internalDue ? { internalDue: v.internalDue } : {}),
            ...(v.listingUrl ? { listingUrl: v.listingUrl } : {}),
            ...(v.portalUrl ? { portalUrl: v.portalUrl } : {}),
            ...(minor !== null ? { askAmount: { amount: (minor / 100).toFixed(2), currency: "USD" } } : {}),
          });
          const a = appOf(made.id);
          if (v.stage && v.stage.toLowerCase() !== a.stage) a.stage = v.stage.toLowerCase() as OutsideStage;
          created.push(listItem(a));
        }
      }
      return { dryRun: input.dryRun, rows: preview, created };
    },
    async exportAll(format) {
      await signedIn();
      const items = store.applications.map(viewApp);
      if (format === "json") return { filename: "applications.json", blob: new Blob([JSON.stringify(items, null, 2)], { type: "application/json" }) };
      const cols = ["title", "funderName", "programName", "stage", "loiDue", "fullDue", "internalDue", "askAmount", "submittedAt", "decidedAt", "listingUrl", "portalUrl"] as const;
      const cell = (v: unknown) => `"${String(v ?? "").replace(/^([=+\-@])/, "'$1").replace(/"/g, '""')}"`;
      const lines = [cols.join(","), ...items.map((a) => cols.map((c) => cell(c === "askAmount" ? a.askAmount?.amount : a[c])).join(","))];
      return { filename: "applications.csv", blob: new Blob([lines.join("\r\n")], { type: "text/csv" }) };
    },

    async consultingPreview(id, input) {
      await signedIn();
      return clone(previewOf(appOf(id), input));
    },
    async sendConsulting(id, input) {
      await signedIn();
      const a = appOf(id);
      const preview = previewOf(a, input);
      const since = Date.parse(now()) - CONSULTING_LIMITS.windowMs;
      const recent = store.consulting.filter((c) => Date.parse(c.at) > since);
      if (recent.filter((c) => c.applicationId === id).length >= CONSULTING_LIMITS.perApplication) throw new ApiError(429, "You have sent 3 requests for this application today. The team will reply to the ones already sent");
      if (recent.length >= CONSULTING_LIMITS.perWorkspace) throw new ApiError(429, "Your workspace has sent 10 requests today. Try again tomorrow");
      const at = now();
      store.consulting.push({ applicationId: id, at, preview });
      log(a, "consulting_requested", { to: preview.to });
      return { sentAt: at, to: preview.to, replyTo: preview.replyTo };
    },

    async openGrantsListing(listingId) {
      await signedIn();
      const l: OpenGrantsListing | undefined = A.openGrants?.find((x) => x.id === listingId);
      if (!l) throw new ApiError(404, "not_available");
      return clone(l);
    },
  };
  return Object.assign(api, { store });
}
