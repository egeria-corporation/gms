// SPDX-License-Identifier: AGPL-3.0-only
// Mock of the review parity routes (v1.8.0) for mocks/funder.ts: the competition's conflict-of-
// interest policy and the reviewers' signatures, the conflicts register, the per-stage review
// settings (anonymized review) and the board docket. It follows the Worker's rules where a screen
// depends on them: where a competition requires its policy (new competitions do; one that was
// running before v1.8.0 does not until the funder turns it on), nothing in it opens in the reviewer
// portal before the reviewer has signed its current version, a policy change asks everyone to sign
// again, and in an
// anonymized stage the portal shows "Applicant A-1001" and "[applicant]" instead of who applied.
// The reviewer portal is the reviewer's own view here, whatever the demo person's role.
import type { CoiPolicy, CoiPolicyInput, CoiSigned, ConflictsRegister, DeclaredOrg, Docket, InboxApplication, ReviewAssignment, ReviewSettings, StageReviewSettings } from "../api/funder.ts";
import type { WorkspaceData } from "./store.ts";

/** The plain-language default (packages/review DEFAULT_COI_POLICY). */
export const MOCK_DEFAULT_COI_POLICY = [
  "Before you read any application in this competition, read this policy and sign it.",
  "You have a conflict of interest when you, someone in your household or a close business partner could gain or lose from an application's outcome, or when your relationship with an applicant would make it hard to judge it fairly. That includes being an employee, board member, volunteer leader, contractor or adviser of an applicant now or in the last three years, having a financial interest in an applicant or its project, and having helped write an application.",
  'If you know of a conflict now, list the organization when you sign. If you find one later, stop and choose "I have a conflict" on that application: you are recused and it does not open for you.',
  "Keep what you read confidential. Do not share, copy or discuss applications or scores outside this review, and do not contact applicants about their applications.",
].join("\n\n");

export const APPLICANT_PLACEHOLDER = "[applicant]";

export interface MockPolicy {
  competitionId: string;
  version: number;
  text: string;
  isDefault: boolean;
  at: string;
}
export interface MockSignature {
  competitionId: string;
  userId: string;
  version: number;
  signedName: string;
  signedAt: string;
  declared: DeclaredOrg[];
}
export interface ParityState {
  policies: MockPolicy[];
  signatures: MockSignature[];
  dockets: { id: string; competitionId: string; includeFunderOnlyComments: boolean }[];
  /** Competitions whose reviewers are not asked to sign (running before v1.8.0, until the funder turns it on). */
  notRequired: string[];
}

export function seedParity(competitionId: string, signedBy: { userId: string; name: string }[], at: string): ParityState {
  return {
    policies: [{ competitionId, version: 1, text: MOCK_DEFAULT_COI_POLICY, isDefault: true, at }],
    signatures: signedBy.map((p) => ({ competitionId, userId: p.userId, version: 1, signedName: p.name, signedAt: at, declared: [] })),
    dockets: [],
    notRequired: [],
  };
}

export const currentVersion = (p: ParityState, competitionId: string) => p.policies.filter((x) => x.competitionId === competitionId).reduce((m, x) => Math.max(m, x.version), 1);
export const hasSigned = (p: ParityState, competitionId: string, userId: string) => p.signatures.some((s) => s.competitionId === competitionId && s.userId === userId && s.version === currentVersion(p, competitionId));
export const isRequired = (p: ParityState, competitionId: string) => !p.notRequired.includes(competitionId);
/** The competition is open to this reviewer: it does not require the policy, or they signed its current version. */
export const cleared = (p: ParityState, competitionId: string, userId: string) => !isRequired(p, competitionId) || hasSigned(p, competitionId, userId);

type Stage = WorkspaceData["competitions"][number]["stages"][number] & { anonymized?: boolean; reviewMode?: StageReviewSettings["reviewMode"]; panelOpen?: boolean };
const stagesOf = (w: WorkspaceData, competitionId: string): Stage[] => (w.competitions.find((c) => c.id === competitionId)?.stages ?? []) as Stage[];
export const isAnonymized = (w: WorkspaceData, competitionId: string, stage: string) => stagesOf(w, competitionId).some((s) => s.key === stage && s.anonymized === true);

/** "A-1001", "A-1002", ...: the application's place in its competition. */
export const codeOf = (apps: InboxApplication[], app: InboxApplication) => `A-${1001 + Math.max(0, apps.filter((a) => a.competitionId === app.competitionId).findIndex((a) => a.id === app.id))}`;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Free text with the applicant's names and handle replaced. */
export function redact(text: string, app: InboxApplication): string {
  const names = [app.applicant.name, app.applicant.workspaceName, app.applicant.handle, app.applicant.handle?.replace(/-/g, " ")].filter((n): n is string => !!n && n.length >= 3).sort((a, b) => b.length - a.length);
  return names.reduce((t, n) => t.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escape(n)}(?![\\p{L}\\p{N}])`, "giu"), APPLICANT_PLACEHOLDER), text);
}
const redactDeep = (v: unknown, app: InboxApplication, files = { n: 0 }): unknown => {
  if (typeof v === "string") return redact(v, app);
  if (Array.isArray(v)) return v.map((x) => redactDeep(x, app, files));
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    const file = typeof o.documentId === "string" || typeof o.passportDocumentId === "string";
    const index = file ? ++files.n : 0;
    return Object.fromEntries(Object.entries(o).map(([k, x]) => [k, file && k === "name" ? `Attachment ${index}${typeof x === "string" && /\.(\w{1,8})$/.test(x) ? `.${/\.(\w{1,8})$/.exec(x)![1]!.toLowerCase()}` : ""}` : file && (k === "documentId" || k === "passportDocumentId") ? x : redactDeep(x, app, files)]));
  }
  return v;
};

/** The application detail as an anonymized reviewer reads it. */
export function anonymizeDetail(apps: InboxApplication[], app: InboxApplication): InboxApplication {
  const code = codeOf(apps, app);
  return {
    ...app,
    title: redact(app.title, app),
    applicant: { ...app.applicant, workspaceId: null, name: `Applicant ${code}`, workspaceName: null, handle: null },
    organization: null,
    attestationUrl: null,
    anonymized: { code },
    formResponses: (app.formResponses ?? []).map((r) => ({ ...r, response: redactDeep(Object.fromEntries(Object.entries(r.response).filter(([k]) => !["legalName", "ein", "orgName", "contact", "address", "phone"].includes(k))), app) as Record<string, unknown>, masked: [...r.masked, ...Object.keys(r.response).filter((k) => ["legalName", "ein", "orgName", "contact", "address", "phone"].includes(k)).map((k) => `/${k}`)] })),
    timeline: (app.timeline ?? []).map(({ actor: _actor, ...e }) => e),
  };
}

/** An assignment in the reviewer's own list: waiting for the policy, anonymized, or as it is. */
export function assignmentAsSeen(p: ParityState, w: WorkspaceData, apps: InboxApplication[], a: ReviewAssignment, me: string): ReviewAssignment {
  if (a.reviewerUserId !== me || !a.competitionId) return { ...a, applicantCode: null, anonymized: false, policyRequired: false };
  if (!cleared(p, a.competitionId, me)) return { ...a, applicationTitle: null, review: null, applicantCode: null, anonymized: false, policyRequired: true };
  const app = apps.find((x) => x.id === a.applicationId);
  if (!app || !isAnonymized(w, a.competitionId, a.stage)) return { ...a, applicantCode: null, anonymized: false, policyRequired: false };
  return { ...a, applicationTitle: a.applicationTitle === null ? null : redact(a.applicationTitle, app), applicantCode: codeOf(apps, app), anonymized: true, policyRequired: false };
}

export interface ParityIo {
  st: () => Promise<{ w: WorkspaceData; p: ParityState; apps: InboxApplication[]; assignments: ReviewAssignment[]; names: Record<string, string> }>;
  me: string;
  now: () => string;
  newId: () => string;
  fail: (status: number, message: string, errors?: unknown[]) => Error;
}

export function createMockParityApi(io: ParityIo) {
  const comp = (w: WorkspaceData, id: string) => {
    const c = w.competitions.find((x) => x.id === id || x.id.replace(/^cmp_/, "") === id.replace(/^cmp_/, ""));
    if (!c) throw io.fail(404, "Competition not found");
    return c;
  };
  const settingsOf = (w: WorkspaceData, id: string): ReviewSettings => {
    const c = comp(w, id);
    return { competitionId: c.id, stages: (c.stages as Stage[]).map((s) => ({ key: s.key, label: s.label, anonymized: s.anonymized === true, reviewMode: s.reviewMode ?? "blind", panelOpen: s.panelOpen === true, rubricId: s.rubricId ?? null })) };
  };
  const policyView = (p: ParityState, w: WorkspaceData, id: string): CoiPolicy => {
    const c = comp(w, id);
    const v = currentVersion(p, c.id);
    const cur = p.policies.find((x) => x.competitionId === c.id && x.version === v);
    const mine = p.signatures.filter((s) => s.competitionId === c.id && s.userId === io.me).sort((a, b) => b.version - a.version)[0];
    return { competitionId: c.id, competitionTitle: c.title, version: v, text: cur?.text ?? MOCK_DEFAULT_COI_POLICY, isDefault: cur?.isDefault ?? true, updatedAt: cur?.at ?? null, required: isRequired(p, c.id), signed: hasSigned(p, c.id, io.me), mySignature: mine ? { policyVersion: mine.version, signedName: mine.signedName, signedAt: mine.signedAt, current: mine.version === v, declared: mine.declared } : null };
  };
  const register = async (id: string): Promise<ConflictsRegister> => {
    const { w, p, apps, assignments, names } = await io.st();
    const c = comp(w, id);
    const v = currentVersion(p, c.id);
    const mineApps = apps.filter((a) => a.competitionId === c.id);
    const people = [...new Set([...assignments.filter((a) => a.competitionId === c.id).map((a) => a.reviewerUserId), ...p.signatures.filter((s) => s.competitionId === c.id).map((s) => s.userId)])];
    const reviewers = people.map((userId) => {
      const sig = p.signatures.filter((s) => s.competitionId === c.id && s.userId === userId).sort((a, b) => b.version - a.version)[0];
      return {
        userId,
        name: names[userId] ?? null,
        email: w.members.find((m) => m.userId === userId)?.email ?? null,
        role: w.members.find((m) => m.userId === userId)?.role ?? null,
        signed: !!sig && sig.version === v,
        signature: sig ? { policyVersion: sig.version, signedName: sig.signedName, signedAt: sig.signedAt, current: sig.version === v, declared: sig.declared.map((d) => ({ ...d, matches: mineApps.filter((a) => a.applicant.name?.toLowerCase() === d.name.trim().toLowerCase()).map((a) => ({ workspaceId: a.applicant.workspaceId ?? "", name: a.applicant.name ?? "" })) })) } : null,
        assigned: assignments.filter((a) => a.competitionId === c.id && a.reviewerUserId === userId).length,
      };
    });
    const recusals = assignments
      .filter((a) => a.competitionId === c.id && a.status === "recused")
      .map((a) => {
        const app = apps.find((x) => x.id === a.applicationId);
        return { assignmentId: a.id, reviewerUserId: a.reviewerUserId, reviewerName: names[a.reviewerUserId] ?? null, applicationId: a.applicationId, applicationTitle: app?.title ?? "", applicant: app?.applicant.name ?? null, stage: a.stage, source: a.coi.declared ? ("declared_conflict" as const) : ("recused" as const), reason: a.coi.reason, at: a.createdAt };
      });
    return { competitionId: c.id, competitionTitle: c.title, policy: { version: v, isDefault: p.policies.find((x) => x.competitionId === c.id && x.version === v)?.isDefault ?? true, updatedAt: p.policies.find((x) => x.competitionId === c.id && x.version === v)?.at ?? null }, counts: { reviewers: reviewers.length, signed: reviewers.filter((r) => r.signed).length, declared: reviewers.reduce((n, r) => n + (r.signature?.declared.length ?? 0), 0), recusals: recusals.length }, reviewers, recusals };
  };

  return {
    async getCoiPolicy(competitionId: string): Promise<CoiPolicy> {
      const { w, p } = await io.st();
      return policyView(p, w, competitionId);
    },
    async putCoiPolicy(competitionId: string, input: CoiPolicyInput): Promise<CoiPolicy> {
      const { w, p } = await io.st();
      const c = comp(w, competitionId);
      if (input.required !== undefined) p.notRequired = input.required ? p.notRequired.filter((x) => x !== c.id) : [...new Set([...p.notRequired, c.id])];
      if (!("text" in input) && !("useDefault" in input)) return policyView(p, w, c.id);
      const text = "text" in input ? input.text.trim() : MOCK_DEFAULT_COI_POLICY;
      if ("text" in input && text.length < 20) throw io.fail(400, "Write at least a sentence or two", [{ field: "text", message: "Too short" }]);
      const cur = policyView(p, w, c.id);
      if (cur.text !== text || cur.isDefault !== !("text" in input)) p.policies.push({ competitionId: c.id, version: cur.version + 1, text, isDefault: !("text" in input), at: io.now() });
      return policyView(p, w, c.id);
    },
    async signCoiPolicy(competitionId: string, input: { policyVersion: number; signedName: string; agree: true; conflicts?: DeclaredOrg[] }): Promise<CoiSigned> {
      const { w, p } = await io.st();
      const c = comp(w, competitionId);
      const v = currentVersion(p, c.id);
      if (input.policyVersion !== v) throw io.fail(409, "The policy changed since you opened it. Read the current version and sign that", [{ code: "policy_changed" }]);
      if (input.signedName.trim().length < 2) throw io.fail(400, "Type your full name", [{ field: "signedName", message: "Required" }]);
      const existing = p.signatures.find((s) => s.competitionId === c.id && s.userId === io.me && s.version === v);
      const sig = existing ?? { competitionId: c.id, userId: io.me, version: v, signedName: input.signedName.trim(), signedAt: io.now(), declared: (input.conflicts ?? []).filter((d) => d.name.trim()) };
      if (!existing) p.signatures.push(sig);
      return { competitionId: c.id, policyVersion: sig.version, signedName: sig.signedName, signedAt: sig.signedAt, current: true, declared: sig.declared, alreadySigned: !!existing };
    },
    getConflictsRegister: register,
    async conflictsRegisterCsv(competitionId: string): Promise<Blob> {
      const reg = await register(competitionId);
      const cell = (v: unknown) => {
        let s = v === null || v === undefined ? "" : String(v);
        if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
        return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const rows = [["Entry", "Reviewer", "Signed name", "Signed at", "Policy version", "Organization declared", "Reason"], ...reg.reviewers.map((r) => ["Signature", r.name ?? r.userId, r.signature?.signedName ?? "", r.signature?.signedAt ?? "", r.signature?.policyVersion ?? "not signed", "", ""]), ...reg.recusals.map((x) => ["Recusal", x.reviewerName ?? "", "", "", "", x.applicant ?? "", x.reason ?? ""])];
      return new Blob([rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n"], { type: "text/csv" });
    },
    async getReviewSettings(competitionId: string): Promise<ReviewSettings> {
      const { w } = await io.st();
      return settingsOf(w, competitionId);
    },
    async putReviewSettings(competitionId: string, input: { stage: string; anonymized?: boolean; reviewMode?: StageReviewSettings["reviewMode"]; panelOpen?: boolean }): Promise<ReviewSettings> {
      const { w } = await io.st();
      const c = comp(w, competitionId);
      const stage = (c.stages as Stage[]).find((s) => s.key === input.stage);
      if (!stage) throw io.fail(422, `This competition has no stage "${input.stage}"`);
      if (input.anonymized !== undefined) stage.anonymized = input.anonymized;
      if (input.reviewMode !== undefined) stage.reviewMode = input.reviewMode;
      if (input.panelOpen !== undefined) stage.panelOpen = input.panelOpen;
      return settingsOf(w, c.id);
    },
    async createDocket(competitionId: string, input: { applicationIds?: string[]; stage?: string; includeFunderOnlyComments?: boolean }): Promise<Docket> {
      const { w, p, apps } = await io.st();
      const c = comp(w, competitionId);
      const stage = input.stage ?? c.stages[c.stages.length - 1]?.key;
      const count = input.applicationIds?.length ?? apps.filter((a) => a.competitionId === c.id && a.stage === stage && a.status !== "draft").length;
      if (!count) throw io.fail(409, "No submitted applications in this stage yet");
      const id = io.newId();
      p.dockets.push({ id, competitionId: c.id, includeFunderOnlyComments: !!input.includeFunderOnlyComments });
      return { docketId: id, competitionId: c.id, applications: count, includeFunderOnlyComments: !!input.includeFunderOnlyComments, bytes: 1024, sha256: "0".repeat(64), createdAt: io.now(), downloadPath: `/gms/competitions/${c.id}/dockets/${id}` };
    },
    async docketPdf(competitionId: string, docketId: string): Promise<Blob> {
      const { p } = await io.st();
      if (!p.dockets.some((d) => d.id === docketId && d.competitionId.replace(/^cmp_/, "") === competitionId.replace(/^cmp_/, ""))) throw io.fail(404, "Docket not found");
      return new Blob(["%PDF-1.7\n% Board docket (demo)\n"], { type: "application/pdf" });
    },
  };
}
