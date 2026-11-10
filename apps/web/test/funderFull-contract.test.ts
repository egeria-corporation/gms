// @vitest-environment node
// SPDX-License-Identifier: AGPL-3.0-only
// The fuller funder routes (api/funderFull.ts) on two backends: the web HTTP client against the
// real API Worker in-process, and the in-browser mock, with one set of assertions. Also covers the
// existing calls the restored screens lean on (ledger for activity, ranking for scores).
import { beforeAll, describe, expect, it } from "vitest";
import { ApiError, type GmsApi } from "../src/api/client.ts";
import { createMockApi } from "../src/mocks/api.ts";
import { demoSession } from "../src/mocks/auth.ts";
import { MOCK_IDS } from "../src/mocks/funder.ts";
import { IDS, seedStore } from "../src/mocks/store.ts";
import { httpApiFor, loadApi, type ApiHarness } from "./api-harness.ts";

interface Backend {
  api: GmsApi;
  competitionId: string;
  applicationId: string;
}

async function failure(p: Promise<unknown>): Promise<ApiError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ApiError) return e;
    throw e;
  }
  throw new Error("Expected the call to be refused");
}

interface Scenario {
  applicant: Record<string, string>;
  compId: string;
  uuid: { comp: string; loi: string };
  call: (who: Record<string, string>, method: string, path: string, body?: unknown) => Promise<{ status: number; body: { data: { id: string } } }>;
}

async function realBackend(): Promise<Backend> {
  const helpers = await loadApi();
  const { scenario } = (await import(/* @vite-ignore */ new URL("../../api/test/scenario.ts", import.meta.url).href)) as { scenario: (h: ApiHarness) => Promise<Scenario> };
  const h = await helpers.harness();
  const s = await scenario(h);
  const started = await s.call(s.applicant, "POST", "/common-grants/applications/start", { competitionId: s.uuid.comp });
  const id = started.body.data.id;
  await s.call(s.applicant, "PUT", `/common-grants/applications/${id}/forms/${s.uuid.loi}`, { response: { projectTitle: "Mobile Health Navigation for Rural Families", requestedAmount: { amount: "150000.00", currency: "USD" }, summary: "Expand mobile health navigation to six communities." } });
  expect((await s.call(s.applicant, "PUT", `/common-grants/applications/${id}/submit`)).status).toBe(200);
  const api = httpApiFor(helpers, h, helpers.USER_ADMIN);
  await api.workspace("riverbend");
  return { api, competitionId: s.compId, applicationId: `app_${id}` };
}

async function mockBackend(): Promise<Backend> {
  const api = createMockApi({ session: async () => demoSession(), store: seedStore() });
  await api.workspace("riverbend");
  return { api, competitionId: IDS.compHealth27, applicationId: MOCK_IDS.copper };
}

describe.each([
  ["the API Worker over HTTP", realBackend],
  ["the mock API", mockBackend],
])("FunderFullApi contract: %s", (_name, make) => {
  let b: Backend;
  let awardId: string;

  beforeAll(async () => {
    b = await make();
    const proposed = await b.api.proposeDecisions(b.competitionId, [{ applicationId: b.applicationId, outcome: "approve", amountMinor: 9_000_000 }]);
    const committed = await b.api.commitDecisions({ competitionId: b.competitionId, decisionIds: [proposed.decisions[0]!.id] });
    awardId = committed.results.find((r) => r.awardId)!.awardId!;
  });

  it("says whether the assistant is on, and drafts or refuses accordingly", async () => {
    const status = await b.api.assistStatus();
    expect(typeof status.enabled).toBe("boolean");
    if (status.enabled) {
      expect(status.quota).toMatchObject({ used: expect.any(Number), limit: expect.any(Number), remaining: expect.any(Number), resetsAt: expect.any(String) });
      const draft = await b.api.assistSummarize(b.applicationId);
      expect(draft).toMatchObject({ draft: true, summary: expect.any(String), strengths: expect.any(Array), openQuestions: expect.any(Array), quotes: expect.any(Array), cautions: expect.any(Array) });
      expect(draft.quota.used).toBe(status.quota!.used + 1);
    } else {
      expect(status.quota).toBeNull();
      expect((await failure(b.api.assistSummarize(b.applicationId))).status).toBe(404);
    }
  });

  it("answers 404 for an approval that does not exist", async () => {
    expect((await failure(b.api.getApproval("apr_00000000-0000-7000-8000-00000000ffff"))).status).toBe(404);
  });

  it("sends a templated message to chosen applications and logs it", async () => {
    const templates = await b.api.listTemplates("email");
    const template = [...templates.items, ...templates.builtIn].find((t) => /decline/i.test(t.name))!;
    expect(template).toBeTruthy();
    const result = await b.api.sendCommunication({ templateId: template.id, recipients: [{ applicationId: b.applicationId }], fields: { decision: { message: "After review, this application will not move forward." } } });
    expect(result).toMatchObject({ templateId: expect.any(String), requested: 1, sent: expect.any(Number), results: [{ subject: { type: "application", id: expect.any(String) }, sent: expect.any(Boolean) }] });
    const log = await b.api.listCommunications();
    expect(log.some((c) => c.batch === result.batch || c.templateName === template.name)).toBe(true);
  });

  it("serves the award letter and walks the award lifecycle with refusals", async () => {
    const letter = await b.api.awardLetterPdf(awardId);
    expect(letter.size).toBeGreaterThan(0);
    // An offered award is not active: it cannot be suspended, resumed or completed.
    expect([409, 422]).toContain((await failure(b.api.suspendAward(awardId, "Paused pending a site visit."))).status);
    expect([409, 422]).toContain((await failure(b.api.resumeAward(awardId))).status);
    expect([409, 422]).toContain((await failure(b.api.completeAward(awardId))).status);
    const cancelled = await b.api.cancelAward(awardId, "Declined by the grantee.");
    expect(cancelled).toMatchObject({ id: awardId, status: "cancelled" });
    expect((await b.api.getAward(awardId)).status).toBe("cancelled");
    expect((await b.api.listAwards()).find((a) => a.id === awardId)?.status).toBe("cancelled");
  });

  it("lists ledger events in the shape the activity timeline reads", async () => {
    const ledger = await b.api.listLedger({ pageSize: 50 });
    expect(ledger.items.length).toBeGreaterThan(0);
    for (const e of ledger.items) expect(e).toMatchObject({ id: expect.any(String), actor: expect.any(String), eventType: expect.any(String), subjectType: expect.any(String), subjectId: expect.any(String), occurredAt: expect.any(String) });
  });

  it("ranks applications with the mean the applications table shows as Score", async () => {
    const ranking = await b.api.getRanking(b.competitionId);
    expect(ranking.rubric).toMatchObject({ id: expect.any(String) });
    for (const row of ranking.items) expect(row).toMatchObject({ applicationId: expect.any(String), n: expect.any(Number) });
  });
});
