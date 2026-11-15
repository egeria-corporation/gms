// SPDX-License-Identifier: AGPL-3.0-only
// The embeddable apply widget's data and the funder's "Powered by" setting.
import { describe, expect, it } from "vitest";
import { USER_ADMIN, USER_OFFICER, WS_FUNDER, bearer, harness, type Harness } from "./helpers.ts";
import { scenario } from "./scenario.ts";

type H = Record<string, string>;
const json = (h: H, body: unknown, method = "POST"): RequestInit => ({ method, headers: { ...h, "Content-Type": "application/json" }, body: JSON.stringify(body) });
const as = async (h: Harness, userId: string): Promise<H> => ({ ...bearer(await h.session(userId)).headers, "X-GMS-Workspace": WS_FUNDER });
const data = async <T>(res: Response) => ((await res.json()) as { data: T }).data;

const OPP = {
  title: "Community Health Grants 2027",
  description: "Grants for community health navigation in Riverbend County.",
  funding: { minAwardAmount: { amount: "50000.00", currency: "USD" }, maxAwardAmount: { amount: "150000.00", currency: "USD" } },
  keyDates: { closeDate: { name: "Full proposal deadline", eventType: "singleDate", date: "2027-04-30" } },
  acceptedApplicantTypes: ["non_profit_with_501c3"],
  eligibilityRules: {
    all: ["501(c)(3) in good standing", "Located in Oregon", "Budget under $5M", "Two years of audited accounts"].map((label, i) => ({ path: `profile.commonApp.x${i}`, op: "exists", missing: "unknown", label })),
  },
};
const SLUG = "community-health-grants-2027";
const WIDGET = `/gms/public/embed/funders/riverbend/opportunities/${SLUG}`;

interface Widget {
  funder: { handle: string; name: string; verified: boolean };
  opportunity: { slug: string; title: string; status: string; closeDate: { name: string; date: string } | null; eligibility: string[]; moreEligibility: number };
  acceptingApplications: boolean;
  poweredBy: boolean;
  links: { page: string };
}

/** A published opportunity with a competition that has a stage and its form, not yet open. */
async function published(h: Harness, officer: H, status: "open" | "forecasted" = "open") {
  const opp = await data<{ id: string }>(await h.request("/gms/opportunities", json(officer, OPP)));
  const form = await data<{ id: string }>(await h.request("/gms/forms", json(officer, { title: "Letter of intent", purpose: "loi", jsonSchema: { type: "object", properties: { projectTitle: { type: "string" } } }, uiSchema: { type: "VerticalLayout", elements: [{ type: "Control", scope: "#/properties/projectTitle" }] } })));
  await h.request(`/gms/forms/${form.id}/publish`, { method: "POST", headers: officer });
  const comp = await data<{ id: string }>(await h.request("/gms/competitions", json(officer, { opportunityId: opp.id, title: OPP.title })));
  await h.request(`/gms/competitions/${comp.id}/stages`, json(officer, { stages: [{ key: "full", label: "Full proposal", forms: { [form.id]: 1 }, opens: "2027-02-01T08:00:00Z", closes: "2027-04-30T00:00:00Z", decisionRequired: false }] }, "PUT"));
  expect((await h.request(`/gms/opportunities/${opp.id}/publish`, json(officer, { status }))).status).toBe(200);
  return { opp, comp };
}

describe("the apply widget's data", () => {
  it("is 404 until the opportunity is published, then shows it without its competition open", async () => {
    const h = await harness();
    const officer = await as(h, USER_OFFICER);
    await h.request("/gms/opportunities", json(officer, { title: "Unpublished draft", description: "Not yet." }));
    expect((await h.request("/gms/public/embed/funders/riverbend/opportunities/unpublished-draft")).status).toBe(404);
    expect((await h.request("/gms/public/embed/funders/no-such-funder/opportunities/anything")).status).toBe(404);

    await published(h, officer);
    const res = await h.request(WIDGET);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toContain("s-maxage");
    const text = await res.text();
    const w = JSON.parse(text).data as Widget;
    expect(w.funder).toMatchObject({ handle: "riverbend", name: "Riverbend Community Foundation" });
    expect(w.opportunity).toMatchObject({ slug: SLUG, title: OPP.title, status: "open", closeDate: { name: "Full proposal deadline", date: "2027-04-30" } });
    // A short summary: three labels and a count of the rest.
    expect(w.opportunity.eligibility).toEqual(["501(c)(3) in good standing", "Located in Oregon", "Budget under $5M"]);
    expect(w.opportunity.moreEligibility).toBe(1);
    // Published, but no competition is open yet.
    expect(w.acceptingApplications).toBe(false);
    expect(w.poweredBy).toBe(true);
    expect(w.links.page).toBe(`https://app.gms.test/f/riverbend/o/${SLUG}`);
    for (const secret of ["eligibilityRules", "settings", "workspace_id", "passport_org_id", "contactEmail"]) expect(text).not.toContain(secret);
  });

  it("takes applications only while the opportunity and a competition are open", async () => {
    const h = await harness();
    const officer = await as(h, USER_OFFICER);
    const { opp, comp } = await published(h, officer);
    expect((await h.request(`/gms/competitions/${comp.id}/open`, { method: "POST", headers: officer })).status).toBe(200);
    expect((await data<Widget>(await h.request(WIDGET))).acceptingApplications).toBe(true);

    expect((await h.request(`/gms/opportunities/${opp.id}/close`, { method: "POST", headers: officer })).status).toBe(200);
    const closed = await data<Widget>(await h.request(WIDGET));
    expect(closed.opportunity.status).toBe("closed");
    expect(closed.acceptingApplications).toBe(false);
  });

  it("a forecasted opportunity is shown, not taking applications", async () => {
    const h = await harness();
    const officer = await as(h, USER_OFFICER);
    await published(h, officer, "forecasted");
    const w = await data<Widget>(await h.request(WIDGET));
    expect(w.opportunity.status).toBe("forecasted");
    expect(w.acceptingApplications).toBe(false);
  });
});

describe("the Powered by setting", () => {
  it("is on by default, an admin turns it off, and the change is on the ledger", async () => {
    const h = await harness();
    const officer = await as(h, USER_OFFICER);
    const admin = await as(h, USER_ADMIN);
    await published(h, officer);

    // Admin only.
    expect((await h.request(`/gms/workspaces/${WS_FUNDER}`, json(officer, { settings: { poweredBy: false } }, "PATCH"))).status).toBe(403);
    expect((await data<Widget>(await h.request(WIDGET))).poweredBy).toBe(true);
    expect((await h.request(`/gms/workspaces/${WS_FUNDER}`, json(admin, { settings: { poweredBy: "no" } }, "PATCH"))).status).toBe(422);

    expect((await h.request(`/gms/workspaces/${WS_FUNDER}`, json(admin, { settings: { poweredBy: false } }, "PATCH"))).status).toBe(200);
    expect((await data<Widget>(await h.request(WIDGET))).poweredBy).toBe(false);
    const [event] = await h.ledger.list({ workspaceId: WS_FUNDER, eventType: "workspace.updated" });
    expect(event!.data).toEqual({ fields: ["settings"], settings: { poweredBy: false } });
    expect(event!.actor).toBe(`user:${USER_ADMIN}`);

    // Removing the key turns it back on.
    expect((await h.request(`/gms/workspaces/${WS_FUNDER}`, json(admin, { settings: { poweredBy: null } }, "PATCH"))).status).toBe(200);
    expect((await data<Widget>(await h.request(WIDGET))).poweredBy).toBe(true);
  });

  it("names other settings it changed without copying their values to the ledger", async () => {
    const h = await harness();
    const admin = await as(h, USER_ADMIN);
    expect((await h.request(`/gms/workspaces/${WS_FUNDER}`, json(admin, { settings: { contactEmail: "grants@riverbendcf.example", transparency: true } }, "PATCH"))).status).toBe(200);
    const [event] = await h.ledger.list({ workspaceId: WS_FUNDER, eventType: "workspace.updated" });
    expect(event!.data).toEqual({ fields: ["settings"], settings: { contactEmail: "changed", transparency: true } });
  });
});

describe("the application receipt email", () => {
  const COMPLETE = { projectTitle: "Mobile Health Navigation for Rural Families", requestedAmount: { amount: "150000.00", currency: "USD" }, need: "Families travel 46 miles to reach primary care." };
  async function submitted(poweredBy?: boolean) {
    const h = await harness();
    const s = await scenario(h);
    if (poweredBy !== undefined) expect((await h.request(`/gms/workspaces/${WS_FUNDER}`, json(await as(h, USER_ADMIN), { settings: { poweredBy } }, "PATCH"))).status).toBe(200);
    const started = await s.call<{ data: { id: string } }>(s.applicant, "POST", "/common-grants/applications/start", { competitionId: s.uuid.comp });
    const uuid = started.body.data.id;
    await s.call(s.applicant, "PUT", `/common-grants/applications/${uuid}/forms/${s.uuid.loi}`, { response: COMPLETE });
    expect((await s.call(s.applicant, "PUT", `/common-grants/applications/${uuid}/submit`)).status).toBe(200);
    return { h, s, appId: `app_${uuid}` };
  }

  it("carries Powered by, linked to the landing page, by default", async () => {
    const { h } = await submitted();
    const [receipt] = h.mailer.sent;
    expect(receipt!.subject).toContain("We received your application");
    expect(receipt!.text).toContain("Powered by OpenGrants Grant Management System (https://app.gms.test/)");
    expect(receipt!.html).toContain('Powered by <a href="https://app.gms.test/">OpenGrants Grant Management System</a>');
  });

  it("leaves it out when the funder turned it off", async () => {
    const { h } = await submitted(false);
    expect(h.mailer.sent).toHaveLength(1);
    expect(h.mailer.sent[0]!.text).not.toContain("Powered by");
    expect(h.mailer.sent[0]!.html).not.toContain("Powered by");
  });

  it.each([
    ["revision request", "request-revision", { message: "Cite the county assessment." }],
    ["decline", "decline", { rationale: "Outside this cycle's priorities." }],
  ])("never adds it to a %s, even with the setting on", async (_name, action, body) => {
    const { h, s, appId } = await submitted(true);
    h.mailer.sent.length = 0;
    expect((await s.call(s.funder, "POST", `/gms/applications/${appId}/${action}`, body)).status).toBe(200);
    expect(h.mailer.sent).toHaveLength(1);
    expect(h.mailer.sent[0]!.text).not.toContain("Powered by");
    expect(h.mailer.sent[0]!.html).not.toContain("Powered by");
  });
});
