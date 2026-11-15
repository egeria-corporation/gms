// @vitest-environment node
// SPDX-License-Identifier: AGPL-3.0-only
// Review parity (v1.8.0) on two backends: the web HTTP client against the real API Worker
// in-process, and the in-browser mock. The stage's review settings, the conflict-of-interest
// policy and its signature, the conflicts register (JSON and CSV) and the board docket: a path,
// verb, body field or response shape that drifts fails here.
import { beforeAll, describe, expect, it } from "vitest";
import { ApiError, type GmsApi } from "../src/api/client.ts";
import { createMockApi } from "../src/mocks/api.ts";
import { demoSession } from "../src/mocks/auth.ts";
import { USERS } from "../src/mocks/funder.ts";
import { IDS, seedStore } from "../src/mocks/store.ts";
import { httpApiFor, loadApi, type ApiHarness } from "./api-harness.ts";

interface Backend {
  /** Program staff. */
  api: GmsApi;
  /** The reviewer who signs (the same person in the mock). */
  reviewer: GmsApi;
  reviewerUserId: string;
  competitionId: string;
  stage: string;
}

interface Scenario {
  applicant: Record<string, string>;
  compId: string;
  uuid: { comp: string; loi: string };
  call: (who: Record<string, string>, method: string, path: string, body?: unknown) => Promise<{ status: number; body: { data: { id: string } } }>;
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

async function realBackend(): Promise<Backend> {
  const helpers = await loadApi();
  const more = (await import(/* @vite-ignore */ new URL("../../api/test/helpers.ts", import.meta.url).href)) as { USER_OFFICER: string };
  const { scenario } = (await import(/* @vite-ignore */ new URL("../../api/test/scenario.ts", import.meta.url).href)) as { scenario: (h: ApiHarness) => Promise<Scenario> };
  const h = await helpers.harness();
  const s = await scenario(h);
  const started = await s.call(s.applicant, "POST", "/common-grants/applications/start", { competitionId: s.uuid.comp });
  const id = started.body.data.id;
  await s.call(s.applicant, "PUT", `/common-grants/applications/${id}/forms/${s.uuid.loi}`, { response: { projectTitle: "Mobile Health Navigation for Rural Families", requestedAmount: { amount: "150000.00", currency: "USD" }, need: "Families travel 46 miles to reach primary care." } });
  expect((await s.call(s.applicant, "PUT", `/common-grants/applications/${id}/submit`)).status).toBe(200);
  const api = httpApiFor(helpers, h, helpers.USER_ADMIN);
  const reviewer = httpApiFor(helpers, h, more.USER_OFFICER, "officer@riverbendcf.example");
  await api.workspace("riverbend");
  await reviewer.workspace("riverbend");
  return { api, reviewer, reviewerUserId: more.USER_OFFICER, competitionId: s.compId, stage: "loi" };
}

async function mockBackend(): Promise<Backend> {
  const api = createMockApi({ session: async () => demoSession(), store: seedStore() });
  await api.workspace("riverbend");
  return { api, reviewer: api, reviewerUserId: USERS.dana, competitionId: IDS.compHealth27, stage: "full" };
}

describe.each([
  ["the API Worker over HTTP", realBackend],
  ["the mock API", mockBackend],
])("Review parity contract: %s", (_name, make) => {
  let b: Backend;
  beforeAll(async () => {
    b = await make();
  });

  it("reads and sets a stage's review settings; anonymized review is off by default", async () => {
    const before = await b.api.getReviewSettings(b.competitionId);
    const stage = before.stages.find((s) => s.key === b.stage)!;
    expect(stage).toMatchObject({ key: b.stage, anonymized: false, reviewMode: "blind", panelOpen: false });
    expect(typeof stage.label).toBe("string");
    const after = await b.api.putReviewSettings(b.competitionId, { stage: b.stage, anonymized: true });
    expect(after.stages.find((s) => s.key === b.stage)!.anonymized).toBe(true);
    expect([404, 422]).toContain((await failure(b.api.putReviewSettings(b.competitionId, { stage: "no-such-stage", anonymized: true }))).status);
  });

  it("serves the policy, takes a new version, and the reviewer signs it once", async () => {
    const p = await b.reviewer.getCoiPolicy(b.competitionId);
    expect(p.competitionId).toBe(b.competitionId);
    expect(p.text.length).toBeGreaterThan(100);
    const v = await b.api.putCoiPolicy(b.competitionId, { text: "Declare every organization you have worked with in the last five years." });
    // A new version, or version 1 when the default had not been written down yet (nobody had signed it).
    expect(v.version).toBeGreaterThanOrEqual(p.version);
    expect(v).toMatchObject({ isDefault: false, signed: false, text: "Declare every organization you have worked with in the last five years." });
    expect((await failure(b.reviewer.signCoiPolicy(b.competitionId, { policyVersion: v.version + 1, signedName: "Dana Ortiz", agree: true }))).status).toBe(409);
    const signed = await b.reviewer.signCoiPolicy(b.competitionId, { policyVersion: v.version, signedName: "Dana Ortiz", agree: true, conflicts: [{ name: "Some Other Group" }] });
    expect(signed).toMatchObject({ competitionId: b.competitionId, policyVersion: v.version, signedName: "Dana Ortiz", current: true, alreadySigned: false, declared: [{ name: "Some Other Group" }] });
    expect(signed.signedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect((await b.reviewer.signCoiPolicy(b.competitionId, { policyVersion: v.version, signedName: "Dana Ortiz", agree: true })).alreadySigned).toBe(true);
    expect((await b.reviewer.getCoiPolicy(b.competitionId)).signed).toBe(true);
  });

  it("turns signing off and on: new competitions require it, and the switch changes nothing else", async () => {
    const p = await b.api.getCoiPolicy(b.competitionId);
    expect(p.required).toBe(true);
    const off = await b.api.putCoiPolicy(b.competitionId, { required: false });
    expect(off).toMatchObject({ required: false, version: p.version, text: p.text, isDefault: p.isDefault });
    expect((await b.reviewer.getCoiPolicy(b.competitionId)).required).toBe(false);
    expect((await b.api.putCoiPolicy(b.competitionId, { required: true })).required).toBe(true);
  });

  it("lists the conflicts register and downloads it as CSV", async () => {
    const reg = await b.api.getConflictsRegister(b.competitionId);
    expect(reg.competitionId).toBe(b.competitionId);
    const me = reg.reviewers.find((r) => r.userId === b.reviewerUserId)!;
    expect(me.signed).toBe(true);
    expect(me.signature).toMatchObject({ signedName: "Dana Ortiz", current: true });
    expect(me.signature!.declared[0]).toMatchObject({ name: "Some Other Group", matches: [] });
    expect(Array.isArray(reg.recusals)).toBe(true);
    expect(reg.counts.signed).toBeGreaterThan(0);
    const csv = await b.api.conflictsRegisterCsv(b.competitionId);
    expect(csv.type).toMatch(/^text\/csv/);
    expect((await csv.text()).split("\r\n")[0]).toMatch(/^Entry,Reviewer,/);
  });

  it("builds a board docket and downloads it as a PDF", async () => {
    const d = await b.api.createDocket(b.competitionId, { stage: b.stage });
    expect(d).toMatchObject({ competitionId: b.competitionId, includeFunderOnlyComments: false });
    expect(d.applications).toBeGreaterThan(0);
    expect(d.downloadPath).toContain(`/dockets/${d.docketId}`);
    const pdf = await b.api.docketPdf(b.competitionId, d.docketId);
    expect(pdf.type).toBe("application/pdf");
    expect(new TextDecoder().decode((await pdf.arrayBuffer()).slice(0, 5))).toBe("%PDF-");
  });
});
