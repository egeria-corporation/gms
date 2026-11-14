// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment node
// Quick setup through the web client, against the real API Worker in-process and against the mock:
// the same starter questions and criteria, the same reuse, the same checklist gate on opening.
import { describe, expect, it } from "vitest";
import type { GmsApi } from "../src/api/client.ts";
import { createMockApi } from "../src/mocks/api.ts";
import { demoSession } from "../src/mocks/auth.ts";
import { seedStore } from "../src/mocks/store.ts";
import { httpApiFor, loadApi } from "./api-harness.ts";

async function realBackend(): Promise<{ api: GmsApi; anonymous: GmsApi }> {
  const helpers = await loadApi();
  const h = await helpers.harness();
  return { api: httpApiFor(helpers, h, helpers.USER_ADMIN), anonymous: httpApiFor(helpers, h, null) };
}
async function mockBackend(): Promise<{ api: GmsApi; anonymous: GmsApi }> {
  const store = seedStore();
  return { api: createMockApi({ session: async () => demoSession(), store }), anonymous: createMockApi({ session: async () => null, store }) };
}

const QUESTIONS = ["Project title", "Project summary", "Amount requested", "How the funds will be used", "Expected outcomes", "Budget", "Contact name", "Contact email", "Contact phone"];
const CRITERIA = ["Alignment with the opportunity", "Feasibility", "Budget", "Community impact"];

describe.each([
  ["the API Worker over HTTP", realBackend],
  ["the mock API", mockBackend],
])("quick setup: %s", (_name, make) => {
  it("makes a competition that passes the checklist, reuses it, and opens through openCompetition", async () => {
    const { api, anonymous } = await make();
    await api.workspace("riverbend");
    const slug = `quick-${Math.random().toString(36).slice(2, 8)}`;
    const opp = await api.createOpportunity({
      title: "The Fund",
      slug,
      description: "General operating support for community organizations.",
      keyDates: { postDate: { name: "Opens", eventType: "singleDate", date: "2027-04-01" }, closeDate: { name: "Closes", eventType: "singleDate", date: "2027-06-30" } },
      acceptedApplicantTypes: ["non_profit_with_501c3"],
    });
    await api.publishOpportunity(opp.id, "open");
    expect((await anonymous.publicOpportunity("riverbend", slug)).competitions).toEqual([]);

    const first = await api.quickSetup(opp.id);
    expect(first.created).toEqual({ competition: true, form: true, rubric: true });
    expect(first.checklist.ready).toBe(true);
    expect(first.competition.stages).toHaveLength(1);
    expect(first.competition.stages[0]).toMatchObject({ label: "Application", opens: "2027-04-01T00:00:00Z", closes: "2027-06-30T23:59:59Z" });

    const form = await api.getForm(first.form!.id, first.form!.version);
    expect(form.status).toBe("published");
    expect(Object.values(form.jsonSchema.properties ?? {}).map((p) => (p as { title?: string }).title)).toEqual(QUESTIONS);
    const rubric = (await api.listRubrics()).find((r) => r.id === first.rubric!.id)!;
    expect(rubric.criteria.map((c) => c.label)).toEqual(CRITERIA);

    const again = await api.quickSetup(opp.id);
    expect(again.created).toEqual({ competition: false, form: false, rubric: false });
    expect([again.competition.id, again.form, again.rubric]).toEqual([first.competition.id, first.form, first.rubric]);
    expect((await api.listCompetitions({ opportunityId: opp.id })).length).toBe(1);

    expect((await api.openCompetition(first.competition.id)).status).toBe("open");
    expect((await anonymous.publicOpportunity("riverbend", slug)).competitions.map((c) => c.status)).toEqual(["open"]);
  });

  it("leaves opening refused while an item fails", async () => {
    const { api } = await make();
    await api.workspace("riverbend");
    // No closing date: the stage gets none, and the checklist says so.
    const opp = await api.createOpportunity({ title: "Rolling Fund", slug: `rolling-${Math.random().toString(36).slice(2, 8)}`, description: "Reviewed as requests arrive.", acceptedApplicantTypes: ["non_profit_with_501c3"] });
    await api.publishOpportunity(opp.id, "open");
    const out = await api.quickSetup(opp.id);
    expect(out.checklist.ready).toBe(false);
    expect(out.checklist.items.filter((i) => i.state !== "pass").map((i) => i.key)).toEqual(["stage_dates"]);
    await expect(api.openCompetition(out.competition.id)).rejects.toMatchObject({ status: 409 });
  });
});
