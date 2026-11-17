// SPDX-License-Identifier: AGPL-3.0-only
// Imported history in mock mode (VITE_USE_MOCKS=true): the past applications, reviews and reports a
// mock import writes (mocks/imports.ts), plus a few made-up records about Alder Creek Family
// Services so the grantee and award pages show the section. Linking follows the server
// (apps/api/src/services/history.ts): the export's own id first, then the exact name, and a name
// that fits more than one record links to none. Organizations are the fixture grantees, matched by
// exact name, as the server matches connected organizations.
import { sha256Hex, type AdapterKey, type PastApplicationRecord, type PastReportRecord, type PastReviewRecord, type PastTargetKey } from "@gms/importers";
import type { Session } from "../auth/types.ts";
import { ApiError } from "../api/client.ts";
import type { HistoryApi, HistoryApplication, HistoryApplicationDetail, HistoryList, HistoryReport, HistoryReview } from "../api/history.ts";
import { MONEY_IDS } from "./funderMoney.ts";

type Ref = { key: AdapterKey; system: string } | null;

export interface MockPastApplication extends Omit<HistoryApplication, "reviewCount" | "answerCount"> {
  answers: { question: string; answer: string }[];
  sourceKey: string | null;
  files: { id: string; name: string; mime: string; size: number }[];
}
export interface MockPastReview extends HistoryReview {
  applicationKey: string | null;
  organizationName: string | null;
  sourceKey: string | null;
}
export interface MockPastReport extends HistoryReport {
  sourceKey: string | null;
}

export interface HistoryStore {
  applications: MockPastApplication[];
  reviews: MockPastReview[];
  reports: MockPastReport[];
}

/** Funder roles that read imported history, as on the server (HISTORY_ROLES). */
const HISTORY_ROLES = ["admin", "program_officer", "finance", "observer", "auditor"];

/** The fixture grantees an imported record can be linked to, by exact name. */
const FIXTURE_ORGANIZATIONS: Record<string, string> = {
  "alder creek family services": MONEY_IDS.wsAlder,
  "harbor light shelter": MONEY_IDS.wsHarbor,
  "lakeside senior center": MONEY_IDS.wsLakeside,
  "northgate housing trust": MONEY_IDS.wsNorthgate,
  "copper valley clinic": MONEY_IDS.wsCopper,
};
const norm = (v: string | null | undefined) => (v ?? "").trim().replace(/\s+/g, " ").toLowerCase();
const SUBMITTABLE: Ref = { key: "submittable", system: "Submittable" };

export function seedHistoryStore(): HistoryStore {
  const imported = "2026-11-02T15:00:00.000Z";
  const award = { id: MONEY_IDS.awardAlder, title: "Mobile Health Navigation for Rural Families" };
  return {
    applications: [
      {
        id: "46a00000-0000-7000-8000-000000000001",
        title: "Mobile Health Navigation for Rural Families",
        organizationName: "Alder Creek Family Services",
        organizationId: MONEY_IDS.wsAlder,
        programName: "Community Health 2027",
        callTitle: "Community Health 2027 · Spring",
        submittedOn: "2026-10-20",
        outcome: "awarded",
        outcomeLabel: "Accepted",
        currency: "USD",
        requestedAmountMinor: 16_000_000,
        awardedAmountMinor: 15_000_000,
        award,
        sourceSystem: SUBMITTABLE,
        importedAt: imported,
        answers: [
          { question: "Project summary", answer: "Two community health navigators ride a weekly route to six rural stops, booking well-child visits and arranging transport." },
          { question: "How many families will you serve?", answer: "380 in the first year." },
        ],
        sourceKey: null,
        files: [],
      },
      {
        id: "46a00000-0000-7000-8000-000000000002",
        title: "After-school transport",
        organizationName: "Alder Creek Family Services",
        organizationId: MONEY_IDS.wsAlder,
        programName: null,
        callTitle: "Youth 2024",
        submittedOn: "2024-01-12",
        outcome: "declined",
        outcomeLabel: "Declined",
        currency: "USD",
        requestedAmountMinor: 1_500_000,
        awardedAmountMinor: null,
        award: null,
        sourceSystem: SUBMITTABLE,
        importedAt: imported,
        answers: [{ question: "Project summary", answer: "A van for after-school pick-up three days a week." }],
        sourceKey: null,
        files: [],
      },
    ],
    reviews: [
      { id: "46b00000-0000-7000-8000-000000000001", applicationId: "46a00000-0000-7000-8000-000000000001", applicationKey: null, applicationTitle: "Mobile Health Navigation for Rural Families", organizationName: null, reviewerName: "Jo Park", scores: [{ criterion: "Impact score", score: 5, outOf: 5 }, { criterion: "Feasibility score", score: 4, outOf: 5 }], totalScore: 9, recommendation: "Fund", comment: "A clear route plan and realistic targets.", reviewedOn: "2026-10-28", sourceSystem: SUBMITTABLE, sourceKey: null },
      { id: "46b00000-0000-7000-8000-000000000002", applicationId: "46a00000-0000-7000-8000-000000000002", applicationKey: null, applicationTitle: "After-school transport", organizationName: null, reviewerName: "Lee Moss", scores: [{ criterion: "Impact score", score: 2, outOf: 5 }], totalScore: 2, recommendation: "Decline", comment: "Outside this year's priorities.", reviewedOn: "2024-02-02", sourceSystem: SUBMITTABLE, sourceKey: null },
    ],
    reports: [
      { id: "46c00000-0000-7000-8000-000000000001", title: "2024 final report", organizationName: "Alder Creek Family Services", organizationId: MONEY_IDS.wsAlder, awardTitle: "Van route pilot", award: null, dueOn: "2025-01-31", submittedOn: "2025-01-24", state: "approved", stateLabel: "Approved", file: { id: "46d00000-0000-7000-8000-000000000001", name: "Final report 2024.pdf", mime: "application/pdf", size: 17 }, sourceSystem: SUBMITTABLE, importedAt: imported, sourceKey: null },
    ],
  };
}

const exportKey = (kind: "application" | "review" | "report", id: string) => sha256Hex(`history\n${kind}\n${id}`);
const one = <T>(xs: T[]): T | null => (xs.length === 1 ? xs[0]! : null);

/** The awards a mock import can link to: those mock grant history imports wrote, with the row keys that wrote them. */
export interface MockAwardLinks {
  /** The award a grant history import wrote for this export id, when exactly one did. */
  byExportId(id: string | null): Promise<{ id: string; title: string } | null>;
  /** Awards by exact title, with their recipient's name. */
  all: { id: string; title: string; recipientName: string }[];
}

const awardByName = (links: MockAwardLinks, title: string | null, organization: string | null) => (title ? one(links.all.filter((a) => norm(a.title) === norm(title) && (!organization || norm(a.recipientName) === norm(organization)))) : null);

/** Write one checked row of a mock history import; the id is the run log row's entity id. */
export async function writeMockHistory(store: HistoryStore, target: PastTargetKey, record: unknown, id: string, links: MockAwardLinks, system: Ref, now: string): Promise<"written" | "skipped"> {
  if (target === "history_applications") {
    const rec = record as PastApplicationRecord;
    const sourceKey = rec.sourceId ? await exportKey("application", rec.sourceId) : null;
    if (sourceKey && store.applications.some((a) => a.sourceKey === sourceKey && norm(a.title) === norm(rec.title) && norm(a.organizationName) === norm(rec.organizationName))) return "skipped";
    const award = (await links.byExportId(rec.sourceId)) ?? (rec.outcome === "declined" || rec.outcome === "withdrawn" ? null : awardByName(links, rec.title, rec.organizationName));
    store.applications.push({ id, title: rec.title, organizationName: rec.organizationName, organizationId: FIXTURE_ORGANIZATIONS[norm(rec.organizationName)] ?? null, programName: rec.programName, callTitle: rec.callTitle, submittedOn: rec.submittedOn, outcome: rec.outcome, outcomeLabel: rec.outcomeLabel, currency: rec.currency, requestedAmountMinor: rec.requestedAmountMinor, awardedAmountMinor: rec.awardedAmountMinor, award: award ? { id: award.id, title: award.title } : null, sourceSystem: system, importedAt: now, answers: rec.answers, sourceKey, files: [] });
    if (sourceKey) for (const r of store.reviews) if (!r.applicationId && r.applicationKey === sourceKey) r.applicationId = id;
    return "written";
  }
  if (target === "history_reviews") {
    const rec = record as PastReviewRecord;
    const applicationKey = rec.applicationRef ? await exportKey("application", rec.applicationRef) : null;
    const sourceKey = rec.sourceId ? await exportKey("review", rec.sourceId) : null;
    if (sourceKey && store.reviews.some((r) => r.sourceKey === sourceKey && r.applicationKey === applicationKey)) return "skipped";
    const byKey = applicationKey ? store.applications.filter((a) => a.sourceKey === applicationKey) : [];
    const application = byKey.length ? one(byKey) : rec.applicationTitle ? one(store.applications.filter((a) => a.title === rec.applicationTitle && (!rec.organizationName || norm(a.organizationName) === norm(rec.organizationName)))) : null;
    store.reviews.push({ id, applicationId: application?.id ?? null, applicationKey, applicationTitle: rec.applicationTitle, organizationName: rec.organizationName, reviewerName: rec.reviewerName, scores: rec.scores, totalScore: rec.totalScore, recommendation: rec.recommendation, comment: rec.comment, reviewedOn: rec.reviewedOn, sourceSystem: system, sourceKey });
    return "written";
  }
  const rec = record as PastReportRecord;
  const sourceKey = rec.sourceId ? await exportKey("report", rec.sourceId) : null;
  if (sourceKey && store.reports.some((r) => r.sourceKey === sourceKey && norm(r.title) === norm(rec.title))) return "skipped";
  let award = await links.byExportId(rec.awardRef);
  if (!award && rec.awardRef) {
    const key = await exportKey("application", rec.awardRef);
    award = one(store.applications.filter((a) => a.sourceKey === key))?.award ?? null;
  }
  award ??= awardByName(links, rec.awardTitle, rec.organizationName);
  store.reports.push({ id, title: rec.title, organizationName: rec.organizationName, organizationId: FIXTURE_ORGANIZATIONS[norm(rec.organizationName)] ?? null, awardTitle: rec.awardTitle, award: award ? { id: award.id, title: award.title } : null, dueOn: rec.dueOn, submittedOn: rec.submittedOn, state: rec.state, stateLabel: rec.stateLabel, file: null, sourceSystem: system, importedAt: now, sourceKey });
  return "written";
}

/** A file attached to a past report or application by a mock import: names and sizes only. */
export function attachMockHistoryFile(store: HistoryStore, target: PastTargetKey, entityId: string, file: { id: string; name: string; mime: string; size: number }): void {
  if (target === "history_reports") {
    const r = store.reports.find((x) => x.id === entityId);
    if (r) r.file = file;
  } else if (target === "history_applications") store.applications.find((x) => x.id === entityId)?.files.push(file);
}

export interface MockHistoryOptions {
  session: () => Promise<Session | null>;
  store: () => HistoryStore;
  workspace: () => { id: string; kind: "funder" | "applicant"; role: string } | null;
}

const byDate = (x: string | null, y: string | null) => (x === y ? 0 : x === null ? 1 : y === null ? -1 : x < y ? 1 : -1);
const clone = <T>(v: T): T => structuredClone(v);

export function createMockHistoryApi(opts: MockHistoryOptions): HistoryApi {
  async function access() {
    if (!(await opts.session())) throw new ApiError(401, "Sign in to continue");
    const ws = opts.workspace();
    if (!ws) throw new ApiError(400, "Open a workspace first");
    if (ws.kind !== "funder") throw new ApiError(403, "Imported history belongs to funder workspaces", [{ code: "wrong_workspace_kind" }]);
    if (!HISTORY_ROLES.includes(ws.role)) throw new ApiError(403, "Reviewers do not see imported history", [{ code: "insufficient_role" }]);
    return opts.store();
  }
  const view = (s: HistoryStore, a: MockPastApplication): HistoryApplication => {
    const { answers, sourceKey: _k, files: _f, ...rest } = a;
    return { ...rest, answerCount: answers.length, reviewCount: s.reviews.filter((r) => r.applicationId === a.id).length };
  };
  const reviewView = ({ applicationKey: _a, organizationName: _o, sourceKey: _k, ...r }: MockPastReview): HistoryReview => r;
  return {
    async list(q): Promise<HistoryList> {
      const s = await access();
      const fits = (x: { organizationId: string | null; award: { id: string } | null }) => ("organization" in q ? x.organizationId === q.organization : x.award?.id === q.award);
      return clone({
        applications: s.applications.filter(fits).sort((x, y) => byDate(x.submittedOn, y.submittedOn)).map((a) => view(s, a)),
        reports: s.reports.filter(fits).sort((x, y) => byDate(x.dueOn, y.dueOn)).map(({ sourceKey: _k, ...r }) => r),
        includes: { reviews: true, reports: true },
      });
    },
    async application(id): Promise<HistoryApplicationDetail> {
      const s = await access();
      const a = s.applications.find((x) => x.id === id);
      if (!a) throw new ApiError(404, "Past application not found");
      return clone({ ...view(s, a), answers: a.answers, reviews: s.reviews.filter((r) => r.applicationId === a.id).map(reviewView), files: a.files, includes: { reviews: true } });
    },
    async file(kind, id, docId): Promise<Blob> {
      const s = await access();
      const file = kind === "report" ? s.reports.find((r) => r.id === id)?.file : s.applications.find((a) => a.id === id)?.files.find((f) => f.id === docId);
      if (!file || file.id !== docId) throw new ApiError(404, "File not found");
      // Mock mode keeps a file's name and size only.
      return new Blob(["%PDF-1.4 made up"], { type: file.mime });
    },
  };
}
