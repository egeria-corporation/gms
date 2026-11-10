// SPDX-License-Identifier: AGPL-3.0-only
// Phase 1 flow through the HTTP routes: program → opportunity → forms → competition → launch
// check → open, then the public and CommonGrants reads of what was published.
import { describe, expect, it } from "vitest";
import { USER_ADMIN, USER_AUDITOR, USER_OFFICER, WS_APPLICANT, WS_FUNDER, WS_OTHER, bearer, clientCredentialsToken, harness, type Harness } from "./helpers.ts";

type H = Record<string, string>;
const json = (h: H, body: unknown, method = "POST"): RequestInit => ({ method, headers: { ...h, "Content-Type": "application/json" }, body: JSON.stringify(body) });
const as = async (h: Harness, userId: string, workspaceId = WS_FUNDER): Promise<H> => ({ ...bearer(await h.session(userId)).headers, "X-GMS-Workspace": workspaceId });
const data = async <T>(res: Response) => ((await res.json()) as { data: T }).data;
const errorCode = async (res: Response) => ((await res.json()) as { errors: { code: string }[] }).errors[0]!.code;

const LOI_SCHEMA = {
  type: "object",
  properties: {
    legalName: { type: "string" },
    projectTitle: { type: "string", minLength: 5, maxLength: 120 },
    summary: { type: "string", "x-wordCount": { max: 200 } },
    requestedAmount: { type: "object" },
  },
  required: ["legalName", "projectTitle", "requestedAmount"],
};
const LOI_UI = {
  type: "VerticalLayout",
  elements: [
    { type: "Control", scope: "#/properties/legalName", options: { widget: "passportField" } },
    { type: "Control", scope: "#/properties/projectTitle" },
    { type: "Control", scope: "#/properties/summary" },
    { type: "Control", scope: "#/properties/requestedAmount", options: { widget: "money", widgetOptions: { currency: "USD" } } },
  ],
};
const LOI = { title: "Letter of intent", purpose: "loi", jsonSchema: LOI_SCHEMA, uiSchema: LOI_UI, mappingFromCommonGrants: { legalName: { field: "name" } }, mappingToCommonGrants: { title: { field: "projectTitle" } } };

const OPP = {
  title: "Community Health Grants 2027",
  description: "Grants for community health navigation in Riverbend County.",
  funding: { totalAmountAvailable: { amount: "1200000.00", currency: "USD" }, minAwardAmount: { amount: "50000.00", currency: "USD" }, maxAwardAmount: { amount: "150000.00", currency: "USD" } },
  keyDates: { closeDate: { name: "Full proposal deadline", eventType: "singleDate", date: "2027-04-30" } },
  acceptedApplicantTypes: ["non_profit_with_501c3"],
  eligibilityRules: { all: [{ path: "profile.commonApp.irs.subsection", op: "in", value: ["03"], missing: "unknown", label: "501(c)(3) in good standing" }] },
};

/** Program, published opportunity, published LOI form, competition with one stage, opened. */
async function launch(h: Harness, who: H) {
  const program = await data<{ id: string }>(await h.request("/gms/programs", json(who, { name: "Community Health 2027", fiscalYear: 2027, budgetAmountMinor: 120_000_000 })));
  const opp = await data<{ id: string; slug: string }>(await h.request("/gms/opportunities", json(who, { ...OPP, programId: program.id })));
  const form = await data<{ id: string; version: number }>(await h.request("/gms/forms", json(who, LOI)));
  await h.request(`/gms/forms/${form.id}/publish`, { method: "POST", headers: who });
  const rubric = await data<{ id: string }>(await h.request("/gms/rubrics", json(who, { name: "LOI screen", criteria: [{ key: "fit", label: "Fit", weight: 1, scale: { type: "numeric", min: 1, max: 5 } }] })));
  const comp = await data<{ id: string }>(await h.request("/gms/competitions", json(who, { opportunityId: opp.id, title: "Community Health Grants 2027" })));
  const stages = [{ key: "loi", label: "Letter of intent", forms: { [form.id]: 1 }, opens: "2027-02-01T08:00:00Z", closes: "2027-04-30T00:00:00Z", rubricId: rubric.id }];
  return { program, opp, form, rubric, comp, stages };
}

describe("programs and rubrics", () => {
  it("creates, lists and updates programs, and puts budget changes on the ledger", async () => {
    const h = await harness();
    const officer = await as(h, USER_OFFICER);
    const created = await h.request("/gms/programs", json(officer, { name: "Housing Stability 2027", budgetAmountMinor: 80_000_000 }));
    expect(created.status).toBe(201);
    const program = await data<{ id: string; currency: string }>(created);
    expect(program.currency).toBe("USD");
    await h.request(`/gms/programs/${program.id}`, json(officer, { budgetAmountMinor: 90_000_000 }, "PATCH"));
    const list = (await (await h.request("/gms/programs", { headers: officer })).json()) as { items: { budgetAmountMinor: number }[]; paginationInfo: { totalItems: number } };
    expect(list.paginationInfo.totalItems).toBe(1);
    expect(list.items[0]!.budgetAmountMinor).toBe(90_000_000);
    const [, updated] = await h.ledger.list({ workspaceId: WS_FUNDER, subjectType: "program" });
    expect(updated!.data).toMatchObject({ budgetFromMinor: 80_000_000, budgetToMinor: 90_000_000 });
  });

  it("enforces scope, workspace kind and workspace isolation in one place", async () => {
    const h = await harness();
    const officer = await as(h, USER_OFFICER);
    const program = await data<{ id: string }>(await h.request("/gms/programs", json(officer, { name: "Community Health 2027" })));

    // An auditor reads but cannot write.
    const auditor = await as(h, USER_AUDITOR);
    expect((await h.request(`/gms/programs/${program.id}`, { headers: auditor })).status).toBe(200);
    const denied = await h.request("/gms/programs", json(auditor, { name: "Nope" }));
    expect(denied.status).toBe(403);
    expect(await errorCode(denied)).toBe("insufficient_scope");

    // A token is bound to what it was granted: this client has no programs scope.
    const token = await clientCredentialsToken(h);
    expect((await h.request("/gms/programs", bearer(token))).status).toBe(403);

    // The same person in an applicant workspace: funder routes do not exist for that workspace.
    const applicant = await as(h, USER_OFFICER, WS_APPLICANT);
    expect(await errorCode(await h.request("/gms/opportunities", { headers: applicant }))).toBe("wrong_workspace_kind");

    // Another funder's admin cannot see this program by id.
    const other = "abababab-abab-4bab-8bab-abababababab";
    await h.repos.table("workspace_members").insert({ workspace_id: WS_OTHER, user_id: other, role: "admin" });
    expect((await h.request(`/gms/programs/${program.id}`, { headers: await as(h, other, WS_OTHER) })).status).toBe(404);
  });

  it("validates rubrics and lists the shared library alongside the workspace's own", async () => {
    const h = await harness();
    const officer = await as(h, USER_OFFICER);
    await h.repos.table("rubrics").insert({ workspace_id: null, name: "General proposal rubric", criteria: [], overall: {} });
    expect((await h.request("/gms/rubrics", json(officer, { name: "Bad", criteria: [{ key: "a", label: "A", weight: 1, scale: { type: "numeric", min: 5, max: 1 } }] }))).status).toBe(400);
    expect((await h.request("/gms/rubrics", json(officer, { name: "Dupes", criteria: [1, 2].map(() => ({ key: "a", label: "A", weight: 1, scale: { type: "numeric", min: 1, max: 5 } })) }))).status).toBe(400);
    await h.request("/gms/rubrics", json(officer, { name: "LOI screen", criteria: [{ key: "fit", label: "Fit", weight: 1, scale: { type: "numeric", min: 1, max: 5 } }] }));
    const list = (await (await h.request("/gms/rubrics", { headers: officer })).json()) as { items: { name: string; shared: boolean }[] };
    expect(list.items.map((r) => [r.name, r.shared])).toEqual([
      ["LOI screen", false],
      ["General proposal rubric", true],
    ]);
  });
});

describe("forms", () => {
  it("rejects a definition outside the supported subset, naming the path", async () => {
    const h = await harness();
    const officer = await as(h, USER_OFFICER);
    const res = await h.request("/gms/forms", json(officer, { title: "Bad", jsonSchema: { type: "object", properties: { a: { type: "string", contentEncoding: "base64" } } }, uiSchema: { type: "VerticalLayout", elements: [] } }));
    expect(res.status).toBe(422);
    const body = (await res.json()) as { errors: { field?: string }[] };
    expect(body.errors.some((e) => e.field?.startsWith("jsonSchema"))).toBe(true);
  });

  it("versions forms: drafts are editable, published versions are immutable, the next draft supersedes", async () => {
    const h = await harness();
    const officer = await as(h, USER_OFFICER);
    const form = await data<{ id: string; version: number; status: string }>(await h.request("/gms/forms", json(officer, LOI)));
    expect(form).toMatchObject({ version: 1, status: "draft" });
    expect(form.id).toMatch(/^frm_/);
    expect((await h.request(`/gms/forms/${form.id}`, json(officer, { title: "LOI" }, "PATCH"))).status).toBe(200);
    // No second draft while one is open.
    expect(await errorCode(await h.request(`/gms/forms/${form.id}/versions`, { method: "POST", headers: officer }))).toBe("draft_exists");

    expect(await data<{ status: string }>(await h.request(`/gms/forms/${form.id}/publish`, { method: "POST", headers: officer }))).toMatchObject({ status: "published" });
    expect(await errorCode(await h.request(`/gms/forms/${form.id}`, json(officer, { title: "Changed" }, "PATCH")))).toBe("form_published");

    const v2 = await data<{ version: number; status: string; supersedesFormVersion: number }>(await h.request(`/gms/forms/${form.id}/versions`, { method: "POST", headers: officer }));
    expect(v2).toMatchObject({ version: 2, status: "draft", supersedesFormVersion: 1 });
    const got = await data<{ version: number; versions: { version: number; status: string }[] }>(await h.request(`/gms/forms/${form.id}`, { headers: officer }));
    expect(got.version).toBe(2);
    expect(got.versions).toMatchObject([
      { version: 1, status: "published" },
      { version: 2, status: "draft" },
    ]);
    expect(await data<{ title: string }>(await h.request(`/gms/forms/${form.id}?version=1`, { headers: officer }))).toMatchObject({ title: "LOI" });
    expect((await h.ledger.list({ workspaceId: WS_FUNDER, subjectType: "form" })).map((e) => e.eventType)).toEqual(["form.created", "form.updated", "form.published", "form.version_created"]);
  });

  it("copies a library form into the workspace and test-fills it deterministically", async () => {
    const h = await harness();
    const officer = await as(h, USER_OFFICER);
    const lib = await h.repos.table("forms").insert({ workspace_id: null, title: "Common LOI", json_schema: LOI_SCHEMA, ui_schema: LOI_UI, purpose: "loi", published_at: "2027-01-01T00:00:00Z" });
    const library = (await (await h.request("/gms/forms/library", { headers: officer })).json()) as { items: { id: string; shared: boolean }[] };
    expect(library.items).toMatchObject([{ id: `frm_${lib.id}`, shared: true }]);

    const copy = await data<{ id: string; purpose: string; jsonSchema: unknown }>(await h.request("/gms/forms", json(officer, { title: "Riverbend LOI", copyFrom: { id: library.items[0]!.id } })));
    expect(copy.id).not.toBe(library.items[0]!.id);
    expect(copy).toMatchObject({ purpose: "loi", jsonSchema: LOI_SCHEMA });

    const fill = async () => data<{ response: Record<string, unknown> }>(await h.request(`/gms/forms/${copy.id}/test-fill`, json(officer, { seed: 7 })));
    const a = await fill();
    expect(a).toEqual(await fill());
    expect(Object.keys(a.response)).toEqual(expect.arrayContaining(["legalName", "projectTitle", "requestedAmount"]));
  });
});

describe("opportunities and competitions", () => {
  it("publishes an opportunity as a valid CommonGrants record and emits opportunity.published", async () => {
    const h = await harness();
    const officer = await as(h, USER_OFFICER);
    h.webhooks.subscriptions.push({ id: "5b5b5b5b-5b5b-4b5b-8b5b-5b5b5b5b5b5b", workspaceId: WS_FUNDER, url: "https://hooks.riverbendcf.example/gms", eventTypes: [], secretEnc: "x", active: true });
    const opp = await data<{ id: string; slug: string; status: string; published: boolean }>(await h.request("/gms/opportunities", json(officer, OPP)));
    expect(opp).toMatchObject({ slug: "community-health-grants-2027", status: "forecasted", published: false });
    expect(opp.id).toMatch(/^opp_/);

    const preview = await data<{ commonGrants: { title: string }; publicUrl: string }>(await h.request(`/gms/opportunities/${opp.id}/preview`, { method: "POST", headers: officer }));
    expect(preview.publicUrl).toBe("https://app.gms.test/f/riverbend/o/community-health-grants-2027");

    const published = await data<{ status: string; publishedAt: string }>(await h.request(`/gms/opportunities/${opp.id}/publish`, json(officer, {})));
    expect(published).toMatchObject({ status: "open", publishedAt: "2027-04-16T17:00:00.000Z" });
    const [row] = await h.repos.table("opportunities").find({ workspace_id: WS_FUNDER });
    expect(row!.cg).toMatchObject({ title: OPP.title, status: { value: "open" } });
    expect(h.webhooks.deliveries.map((d) => d.eventType)).toEqual(["opportunity.published"]);
    expect((await h.ledger.list({ workspaceId: WS_FUNDER, subjectType: "opportunity" })).map((e) => e.eventType)).toEqual(["opportunity.created", "opportunity.published"]);

    expect(await data<{ status: string }>(await h.request(`/gms/opportunities/${opp.id}/close`, { method: "POST", headers: officer }))).toMatchObject({ status: "closed" });
    expect(await errorCode(await h.request(`/gms/opportunities/${opp.id}/publish`, json(officer, {})))).toBe("invalid_transition");
  });

  it("refuses to publish without a description, and rejects malformed eligibility rules and duplicate slugs", async () => {
    const h = await harness();
    const officer = await as(h, USER_OFFICER);
    const bare = await data<{ id: string }>(await h.request("/gms/opportunities", json(officer, { title: "Housing Stability 2027" })));
    expect(await errorCode(await h.request(`/gms/opportunities/${bare.id}/publish`, json(officer, {})))).toBe("guard_failed");
    expect((await h.request("/gms/opportunities", json(officer, { title: "Bad rules", eligibilityRules: { all: [{ path: "org.name", op: "roughly", value: 1 }] } }))).status).toBe(422);
    expect((await h.request("/gms/opportunities", json(officer, { title: "Housing Stability 2027" }))).status).toBe(409);
  });

  it("walks the launch checklist from failing to ready, then opens", async () => {
    const h = await harness();
    const officer = await as(h, USER_OFFICER);
    const { opp, form, comp, stages } = await launch(h, officer);
    type Check = { ready: boolean; summary: { pass: number; fail: number }; items: { key: string; state: string; label: string; reason: string; fixHref: string | null }[] };
    const check = async () => data<Check>(await h.request(`/gms/competitions/${comp.id}/launch-check`, { method: "POST", headers: officer }));

    const first = await check();
    expect(first.ready).toBe(false);
    expect(first.items.filter((i) => i.state === "fail").map((i) => i.key)).toEqual(["opportunity_published", "stages", "stage_forms", "forms_published", "stage_dates", "rubrics"]);
    expect(first.items[0]).toMatchObject({ fixHref: `/w/riverbend/opportunities/${opp.id}/edit` });
    // Opening is refused with the first failing line as the reason.
    const refused = await h.request(`/gms/competitions/${comp.id}/open`, { method: "POST", headers: officer });
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { message: string }).message).toContain("opportunity is published");

    // A draft form version cannot be pinned.
    await h.request(`/gms/forms/${form.id}/versions`, { method: "POST", headers: officer });
    expect((await h.request(`/gms/competitions/${comp.id}/stages`, json(officer, { stages: [{ ...stages[0], forms: { [form.id]: 2 } }] }, "PUT"))).status).toBe(422);
    // entryFrom must name an earlier stage.
    expect((await h.request(`/gms/competitions/${comp.id}/stages`, json(officer, { stages: [{ ...stages[0], entryFrom: ["full"] }] }, "PUT"))).status).toBe(422);

    const withStages = await data<{ stages: { key: string; forms: Record<string, number> }[]; forms: Record<string, number> }>(await h.request(`/gms/competitions/${comp.id}/stages`, json(officer, { stages }, "PUT")));
    expect(withStages.forms).toEqual({ [form.id]: 1 });
    await h.request(`/gms/opportunities/${opp.id}/publish`, json(officer, {}));

    const ready = await check();
    expect(ready).toMatchObject({ ready: true, summary: { fail: 0 } });
    expect(ready.items.every((i) => i.state === "pass" && i.fixHref === null)).toBe(true);

    expect(await data<{ status: string }>(await h.request(`/gms/competitions/${comp.id}/open`, { method: "POST", headers: officer }))).toMatchObject({ status: "open" });
    // Stages are frozen once open; moving to a new form version needs migrate.
    expect(await errorCode(await h.request(`/gms/competitions/${comp.id}/stages`, json(officer, { stages }, "PUT")))).toBe("competition_not_draft");
    expect(await errorCode(await h.request(`/gms/competitions/${comp.id}/forms`, json(officer, { forms: { [form.id]: 1 } }, "PUT")))).toBe("migrate_required");
    expect((await h.request(`/gms/competitions/${comp.id}/forms`, json(officer, { forms: { [form.id]: 1 }, migrate: true }, "PUT"))).status).toBe(200);
    expect((await h.ledger.list({ workspaceId: WS_FUNDER, subjectType: "competition" })).map((e) => e.eventType)).toEqual(["competition.created", "competition.stages_set", "competition.opened", "competition.forms_set"]);
  });

  it("sets a rubric per stage and evaluates eligibility with unknown kept apart from fail", async () => {
    const h = await harness();
    const officer = await as(h, USER_OFFICER);
    const { opp, comp, stages, rubric } = await launch(h, officer);
    await h.request(`/gms/competitions/${comp.id}/stages`, json(officer, { stages: [{ ...stages[0], rubricId: null }] }, "PUT"));
    const set = await data<{ stages: { rubricId: string | null }[] }>(await h.request(`/gms/competitions/${comp.id}/rubric`, json(officer, { rubricId: rubric.id, stage: "loi" }, "PUT")));
    expect(set.stages[0]!.rubricId).toBe(rubric.id);

    const run = async (profile: unknown) => data<{ eligible: boolean | "unknown" }>(await h.request("/gms/eligibility/evaluate", json(officer, { opportunityId: opp.id, profile })));
    expect((await run({ commonApp: { irs: { subsection: "03" } } })).eligible).toBe(true);
    expect((await run({ commonApp: { irs: { subsection: "06" } } })).eligible).toBe(false);
    expect((await run({})).eligible).toBe("unknown");
  });

  it("reads an applicant's cached Passport record for eligibility only with their consent", async () => {
    const h = await harness();
    const officer = await as(h, USER_OFFICER);
    const { opp } = await launch(h, officer);
    await h.repos.table("workspaces").update({ id: WS_APPLICANT }, { org_projection: { name: "Alder Creek Family Services" }, profile_projection: { fields: [{ path: "/commonApp/irs/subsection", value: "03" }] } });
    const body = { opportunityId: opp.id, applicantWorkspaceId: WS_APPLICANT };
    expect((await h.request("/gms/eligibility/evaluate", json(officer, body))).status).toBe(404);
    await h.repos.table("consents").insert({ applicant_workspace_id: WS_APPLICANT, funder_workspace_id: WS_FUNDER, basis: "application", granted_at: h.clock.now.toISOString() });
    expect(await data<{ eligible: boolean }>(await h.request("/gms/eligibility/evaluate", json(officer, body)))).toMatchObject({ eligible: true });
    await h.repos.table("consents").update({ applicant_workspace_id: WS_APPLICANT }, { revoked_at: h.clock.now.toISOString() });
    expect((await h.request("/gms/eligibility/evaluate", json(officer, body))).status).toBe(404);
  });
});

describe("public and CommonGrants reads", () => {
  it("serves published records to anyone and keeps drafts to the owning workspace", async () => {
    const h = await harness();
    const officer = await as(h, USER_OFFICER);
    const { opp, form, comp, stages } = await launch(h, officer);
    const oppUuid = opp.id.slice(4);
    const compUuid = comp.id.slice(4);
    const formUuid = form.id.slice(4);
    await h.request(`/gms/competitions/${comp.id}/stages`, json(officer, { stages }, "PUT"));

    // Nothing is public yet.
    expect(((await (await h.request("/common-grants/opportunities")).json()) as { items: unknown[] }).items).toEqual([]);
    expect((await h.request(`/common-grants/opportunities/${oppUuid}`)).status).toBe(404);
    expect((await h.request(`/common-grants/forms/${formUuid}`)).status).toBe(404);
    expect((await h.request("/gms/public/funders/riverbend/opportunities/community-health-grants-2027")).status).toBe(404);
    // The owner reads its own draft with a session; a bad token is not treated as anonymous.
    expect((await h.request(`/common-grants/opportunities/${oppUuid}`, { headers: officer })).status).toBe(200);
    expect((await h.request(`/common-grants/opportunities/${oppUuid}`, bearer("not-a-token"))).status).toBe(401);

    await h.request(`/gms/opportunities/${opp.id}/publish`, json(officer, {}));
    await h.request(`/gms/competitions/${comp.id}/open`, { method: "POST", headers: officer });

    const list = (await (await h.request("/common-grants/opportunities")).json()) as { items: { id: string; source: string }[]; paginationInfo: { totalItems: number } };
    expect(list.paginationInfo.totalItems).toBe(1);
    expect(list.items[0]).toMatchObject({ id: oppUuid, source: "https://app.gms.test/f/riverbend/o/community-health-grants-2027" });

    const details = await data<{ competitions: { id: string; customFields: { gms: { value: { stages: { key: string }[] } } }; forms: { forms: Record<string, { jsonSchema: unknown; uiSchema: unknown; mappingFromCommonGrants: unknown }> } }[] }>(await h.request(`/common-grants/opportunities/${oppUuid}`));
    expect(details.competitions).toHaveLength(1);
    expect(details.competitions[0]!.customFields.gms.value.stages.map((s) => s.key)).toEqual(["loi"]);
    expect(details.competitions[0]!.forms.forms[formUuid]).toMatchObject({ jsonSchema: LOI_SCHEMA, mappingFromCommonGrants: { legalName: { field: "name" } } });

    expect(await data<{ id: string }>(await h.request(`/common-grants/competitions/${compUuid}`))).toMatchObject({ id: compUuid });
    const cgForm = await data<{ id: string; uiSchema: unknown }>(await h.request(`/common-grants/forms/${formUuid}`));
    expect(cgForm).toMatchObject({ id: formUuid, uiSchema: LOI_UI });
    expect(((await (await h.request("/common-grants/forms")).json()) as { items: { id: string }[] }).items.map((f) => f.id)).toEqual([formUuid]);
    // A version that no public competition pins stays private.
    await h.request(`/gms/forms/${form.id}/versions`, { method: "POST", headers: officer });
    expect((await h.request(`/common-grants/forms/${formUuid}?version=2`)).status).toBe(404);
    expect((await h.request(`/common-grants/forms/${formUuid}?version=2`, { headers: officer })).status).toBe(200);
  });

  it("searches published opportunities with CommonGrants filters and sorting", async () => {
    const h = await harness();
    const officer = await as(h, USER_OFFICER);
    for (const [title, max] of [["Community Health Grants 2027", "150000.00"], ["Housing Stability 2027", "40000.00"]] as const) {
      const o = await data<{ id: string }>(await h.request("/gms/opportunities", json(officer, { ...OPP, title, funding: { ...OPP.funding, maxAwardAmount: { amount: max, currency: "USD" } } })));
      await h.request(`/gms/opportunities/${o.id}/publish`, json(officer, {}));
    }
    const search = async (body: unknown) => (await (await h.request("/common-grants/opportunities/search", json({}, body))).json()) as { items: { title: string }[]; sortInfo: { sortBy: string }; filterInfo: { filters: unknown } };
    const big = await search({ filters: { maxAwardAmountRange: { operator: "between", value: { min: { amount: "100000", currency: "USD" }, max: { amount: "500000", currency: "USD" } } } } });
    expect(big.items.map((i) => i.title)).toEqual(["Community Health Grants 2027"]);
    const sorted = await search({ sorting: { sortBy: "title", sortOrder: "desc" } });
    expect(sorted.items.map((i) => i.title)).toEqual(["Housing Stability 2027", "Community Health Grants 2027"]);
    expect(sorted.sortInfo.sortBy).toBe("title");
    expect((await search({ search: "housing" })).items).toHaveLength(1);
    expect((await h.request("/common-grants/opportunities/search", json({}, { sorting: { sortBy: "nonsense" } }))).status).toBe(400);
  });

  it("gives the funder page published fields only, in the funder's brand, and lists it in the sitemap", async () => {
    const h = await harness();
    const officer = await as(h, USER_OFFICER);
    const { opp, comp, stages } = await launch(h, officer);
    await h.request("/gms/opportunities", json(officer, { title: "Unpublished draft", description: "Not yet." }));
    await h.request(`/gms/competitions/${comp.id}/stages`, json(officer, { stages }, "PUT"));
    await h.request(`/gms/opportunities/${opp.id}/publish`, json(officer, {}));
    await h.request(`/gms/competitions/${comp.id}/open`, { method: "POST", headers: officer });

    const pageRes = await h.request("/gms/public/funders/riverbend");
    expect(pageRes.headers.get("Cache-Control")).toContain("s-maxage");
    const page = await data<{ funder: { name: string; brand: { accent: string } }; opportunities: { title: string }[] }>(pageRes);
    expect(page.funder).toMatchObject({ name: "Riverbend Community Foundation", brand: { accent: "#1F6F8B" } });
    expect(page.opportunities.map((o) => o.title)).toEqual([OPP.title]);

    const res = await h.request("/gms/public/funders/riverbend/opportunities/community-health-grants-2027");
    const text = await res.text();
    const detail = JSON.parse(text).data as { opportunity: { eligibility: string[] }; competitions: { stages: { label: string }[] }[]; links: { json: string } };
    expect(detail.opportunity.eligibility).toEqual(["501(c)(3) in good standing"]);
    expect(detail.competitions[0]!.stages).toMatchObject([{ label: "Letter of intent" }]);
    expect(detail.links.json).toBe(`https://gms.test/common-grants/opportunities/${opp.id.slice(4)}`);
    // Internal fields never reach the public payload.
    for (const secret of ["eligibilityRules", "settings", "rubricId", "workspace_id", "passport_org_id"]) expect(text).not.toContain(secret);
    expect((await h.request("/gms/public/funders/alder-creek")).status).toBe(404);

    const sitemap = await h.request("/sitemap.xml");
    expect(sitemap.headers.get("Content-Type")).toContain("application/xml");
    const xml = await sitemap.text();
    expect(xml).toContain("<loc>https://app.gms.test/f/riverbend</loc>");
    expect(xml).toContain("<loc>https://app.gms.test/f/riverbend/o/community-health-grants-2027</loc>");
    expect(xml).not.toContain("unpublished-draft");

    expect(await (await h.request("/openapi.json")).json()).toMatchObject({ info: { title: "OpenGrants GMS API" } });
  });

  it("lets an admin read back the opportunity it manages with filters", async () => {
    const h = await harness();
    const admin = await as(h, USER_ADMIN);
    const { opp, program } = await launch(h, admin);
    const list = (await (await h.request(`/gms/opportunities?programId=${program.id}&status=forecasted`, { headers: admin })).json()) as { items: { id: string }[] };
    expect(list.items.map((o) => o.id)).toEqual([opp.id]);
    expect(((await (await h.request("/gms/opportunities?status=closed", { headers: admin })).json()) as { items: unknown[] }).items).toEqual([]);
    expect(((await (await h.request(`/gms/competitions?opportunityId=${opp.id}`, { headers: admin })).json()) as { items: unknown[] }).items).toHaveLength(1);
  });
});
