// SPDX-License-Identifier: AGPL-3.0-only
// Funder routes the fuller screens need beyond funder.ts and funderMoney.ts: the award lifecycle
// (suspend, resume, complete, cancel), the award letter, bulk sends, one approval with its exact
// inputs, and the drafting assistant. The assistant only ever returns drafts: nothing it produces
// is saved, sent or scored. HTTP here and the mock in mocks/funderFull.ts answer one interface, and
// test/funderFull-contract.test.ts holds both to the real Worker.
import type { Approval, AwardDetail, FunderHttpIo, SendResult } from "./funder.ts";

export interface AssistQuota {
  used: number;
  limit: number;
  remaining: number;
  /** When the monthly count resets. */
  resetsAt: string;
}
/** `enabled` is false when the assistant is switched off for this install; `quota` is null then. */
export interface AssistStatus {
  enabled: boolean;
  quota: AssistQuota | null;
}
export interface AssistQuote {
  /** The form field the applicant's words came from. */
  field: string;
  text: string;
}
interface AssistDraft {
  draft: true;
  model: string;
  quota: AssistQuota;
  cautions: string[];
}
export interface SummaryDraft extends AssistDraft {
  summary: string;
  strengths: string[];
  openQuestions: string[];
  quotes: AssistQuote[];
  /** What the funder's own connected systems said, each with the server it came from. */
  fromExternalSystems: { server: string; note: string }[];
}
export interface ComparisonDraft extends AssistDraft {
  rubricId: string;
  criteria: { key: string; evidence: AssistQuote[]; observations: string; gaps: string[] }[];
}

export interface LetterDraft extends AssistDraft {
  templateId: string;
  subject: string;
  /** The letter, with the template's merge fields left exactly as written. */
  body: string;
  mergeFieldsUsed: string[];
}

export interface SendInput {
  templateId: string;
  recipients: { applicationId?: string; awardId?: string }[];
  subjectOverride?: string;
  /** Extra merge fields applied to every recipient. */
  fields?: Record<string, unknown>;
}

export interface FunderFullApi {
  // ---- award lifecycle ----
  suspendAward(id: string, reason: string): Promise<AwardDetail>;
  resumeAward(id: string): Promise<AwardDetail>;
  /** Refused while any tranche is still open. */
  completeAward(id: string): Promise<AwardDetail>;
  cancelAward(id: string, reason: string): Promise<AwardDetail>;
  awardLetterPdf(id: string): Promise<Blob>;

  // ---- communications ----
  /** One letter per recipient from a template. A person only; agents get an approval request. */
  sendCommunication(input: SendInput): Promise<SendResult>;

  // ---- approvals ----
  getApproval(id: string): Promise<Approval>;

  // ---- assistant (drafts only) ----
  assistStatus(): Promise<AssistStatus>;
  assistSummarize(applicationId: string): Promise<SummaryDraft>;
  assistCompareRubric(applicationId: string, rubricId: string): Promise<ComparisonDraft>;
  /** A letter drafted from a template. Never saved as a template version and never sent. */
  assistDraftLetter(templateId: string, input: { purpose: string; tone?: string; applicationId?: string }): Promise<LetterDraft>;
}

type Json = { data?: unknown; message?: string; errors?: unknown[] };

export function createHttpFunderFullApi(io: FunderHttpIo): FunderFullApi {
  const e = encodeURIComponent;
  async function send(method: string, path: string, body?: unknown): Promise<Response> {
    const token = await io.token();
    const ws = io.workspaceId();
    const res = await (io.fetch ?? fetch)(`${io.baseUrl}${path}`, {
      method,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(ws ? { "X-GMS-Workspace": ws } : {}), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as Json;
      throw io.fail(res.status, j.message ?? `Request failed (${res.status})`, j.errors ?? []);
    }
    return res;
  }
  const data = async <T>(method: string, path: string, body?: unknown) => ((await (await send(method, path, body)).json()) as Json).data as T;

  return {
    suspendAward: (id, reason) => data("POST", `/gms/awards/${e(id)}/suspend`, { reason }),
    resumeAward: (id) => data("POST", `/gms/awards/${e(id)}/resume`, {}),
    completeAward: (id) => data("POST", `/gms/awards/${e(id)}/complete`, {}),
    cancelAward: (id, reason) => data("POST", `/gms/awards/${e(id)}/cancel`, { reason }),
    awardLetterPdf: async (id) => (await send("GET", `/gms/awards/${e(id)}/letter.pdf`)).blob(),
    sendCommunication: (input) => data("POST", "/gms/communications/send", input),
    getApproval: (id) => data("GET", `/gms/approvals/${e(id)}`),
    assistStatus: () => data("GET", "/gms/assist/status"),
    assistSummarize: (applicationId) => data("POST", "/gms/assist/summarize", { applicationId }),
    assistCompareRubric: (applicationId, rubricId) => data("POST", "/gms/assist/compare-rubric", { applicationId, rubricId }),
    assistDraftLetter: (templateId, input) => data("POST", "/gms/assist/draft-letter", { templateId, purpose: input.purpose, ...(input.tone ? { tone: input.tone } : {}), ...(input.applicationId ? { applicationId: input.applicationId } : {}) }),
  };
}
