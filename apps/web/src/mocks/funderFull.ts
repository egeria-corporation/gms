// SPDX-License-Identifier: AGPL-3.0-only
// Mock implementation of api/funderFull.ts. It sits on top of the other funder mocks: the award
// lifecycle is kept as an overlay on the awards they hold, a bulk send appears in the send log, and
// the assistant answers with fixed drafts built from the application's own fields. The assistant
// here is on, with the design's "14 of 40 this month" as its starting count.
import type { Approval, AwardDetail, AwardSummary, FunderApi, SentCommunication } from "../api/funder.ts";
import type { AssistQuota, FunderFullApi } from "../api/funderFull.ts";
import type { FunderMoneyApi } from "../api/funderMoney.ts";
import type { MockFunderCtx } from "./funder.ts";

type Inner = FunderApi & FunderMoneyApi;
type AwardStatus = AwardDetail["status"];

const OPEN_TRANCHES = ["scheduled", "due", "ready", "releasing", "initiated", "held"];
const QUOTA_LIMIT = 40;

/** A one-page stand-in PDF so "Open letter" has something to show in mock mode. */
const MOCK_PDF = new Blob(["%PDF-1.4\n% mock award letter\n"], { type: "application/pdf" });

export function createMockFunderFullApi(ctx: MockFunderCtx, inner: Inner): FunderFullApi & Pick<FunderApi, "getAward" | "listAwards" | "listCommunications"> {
  const status = new Map<string, AwardStatus>();
  const sent = new Map<string, SentCommunication[]>();
  let used = 14;
  const quota = (): AssistQuota => {
    const now = new Date(ctx.now());
    return { used, limit: QUOTA_LIMIT, remaining: Math.max(0, QUOTA_LIMIT - used), resetsAt: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString() };
  };
  const spend = () => {
    if (used >= QUOTA_LIMIT) throw ctx.fail(429, `This workspace has used its ${QUOTA_LIMIT} assistant drafts for the month.`);
    used += 1;
    return quota();
  };
  const withStatus = <T extends AwardDetail | AwardSummary>(a: T): T => (status.has(a.id) ? { ...a, status: status.get(a.id)! } : a);
  const move = async (id: string, from: AwardStatus[], to: AwardStatus, what: string): Promise<AwardDetail> => {
    const a = withStatus(await inner.getAward(id));
    if (!from.includes(a.status)) throw ctx.fail(409, `An award that is ${a.status} cannot be ${what}.`);
    status.set(a.id, to);
    return { ...a, status: to };
  };

  return {
    getAward: async (id) => withStatus(await inner.getAward(id)),
    listAwards: async (filter = {}) => {
      const all = (await inner.listAwards()).map(withStatus);
      return filter.status ? all.filter((a) => a.status === filter.status) : all;
    },
    async listCommunications() {
      const ws = (await ctx.ws()).record.id;
      return [...(sent.get(ws) ?? []), ...(await inner.listCommunications())];
    },

    suspendAward: (id) => move(id, ["active"], "suspended", "suspended"),
    resumeAward: (id) => move(id, ["suspended"], "active", "resumed"),
    async completeAward(id) {
      const a = withStatus(await inner.getAward(id));
      const open = a.tranches.filter((t) => OPEN_TRANCHES.includes(t.status)).length;
      if (open) throw ctx.fail(409, `${open} ${open === 1 ? "tranche is" : "tranches are"} still open. Settle or cancel ${open === 1 ? "it" : "them"} before completing the award.`);
      return move(id, ["active"], "completed", "completed");
    },
    cancelAward: (id) => move(id, ["offered", "accepted", "active", "suspended"], "cancelled", "cancelled"),
    awardLetterPdf: async (id) => {
      await inner.getAward(id);
      return MOCK_PDF;
    },

    async sendCommunication(input) {
      if (!input.recipients.length) throw ctx.fail(422, "Choose at least one recipient.");
      const templates = await inner.listTemplates();
      const template = [...templates.items, ...templates.builtIn].find((t) => t.id === input.templateId);
      if (!template) throw ctx.fail(404, "Template not found");
      const ws = (await ctx.ws()).record.id;
      const batch = `b0000000-0000-7000-8000-${String((sent.get(ws)?.length ?? 0) + 1).padStart(12, "0")}`;
      const rows: SentCommunication[] = input.recipients.map((r) => ({ status: "sent", subjectType: r.awardId ? "award" : "application", subjectId: (r.awardId ?? r.applicationId)!, template: template.id, templateName: template.name, batch, actor: "user:mock", at: ctx.now() }));
      sent.set(ws, [...rows, ...(sent.get(ws) ?? [])]);
      return { batch, templateId: template.id, requested: rows.length, sent: rows.length, results: rows.map((r) => ({ subject: { type: r.subjectType, id: r.subjectId }, sent: true })) };
    },

    async getApproval(id): Promise<Approval> {
      const found = (await inner.listApprovals()).find((a) => a.id === id);
      if (!found) throw ctx.fail(404, "Approval not found");
      return found;
    },

    assistStatus: async () => ({ enabled: true, quota: quota() }),
    async assistSummarize(applicationId) {
      const app = await inner.getApplication(applicationId);
      const org = app.applicant?.name ?? "The applicant";
      const q = spend();
      return {
        draft: true,
        model: "mock-model",
        quota: q,
        summary: `${org} asks for support for “${app.title}”. The request is at the ${app.stage} stage. This draft was written from the applicant's own answers; check each point against the application before relying on it.`,
        strengths: ["The need statement cites local data.", "The budget matches the requested amount."],
        openQuestions: ["Which partner clinics have confirmed in writing?", "How will outcomes be measured after the grant period?"],
        quotes: [{ field: "Need statement", text: "Families in the valley travel an average of 46 miles to reach a primary care provider." }],
        fromExternalSystems: [],
        cautions: ["Applicant-supplied text is quoted as written and has not been verified."],
      };
    },
    async assistCompareRubric(applicationId, rubricId) {
      await inner.getApplication(applicationId);
      const rubric = (await ctx.ws()).rubrics.find((r) => r.id === rubricId);
      if (!rubric) throw ctx.fail(404, "Rubric not found");
      const q = spend();
      return {
        draft: true,
        model: "mock-model",
        quota: q,
        rubricId,
        criteria: rubric.criteria.map((c) => ({ key: c.key, evidence: [{ field: "Approach & activities", text: "Two navigators cover a weekly route of six stops." }], observations: `The application speaks to “${c.label}” in its approach section; it gives no figures for the second year.`, gaps: ["No letter from a partner clinic is attached."] })),
        cautions: ["This is not a score. Reviewers score each criterion themselves."],
      };
    },
  };
}
