// SPDX-License-Identifier: AGPL-3.0-only
// The public page data the share cards and the funder page read: whether each listed opportunity
// takes applications now, and a sitemap that keeps forecasted and closed calls findable.
import { describe, expect, it } from "vitest";
import { USER_OFFICER, WS_FUNDER, bearer, harness, type Harness } from "./helpers.ts";

type H = Record<string, string>;
const json = (h: H, body: unknown, method = "POST"): RequestInit => ({ method, headers: { ...h, "Content-Type": "application/json" }, body: JSON.stringify(body) });
const data = async <T>(res: Response) => ((await res.json()) as { data: T }).data;

const OPP = {
  description: "Grants for community health navigation in Riverbend County.",
  funding: { minAwardAmount: { amount: "50000.00", currency: "USD" }, maxAwardAmount: { amount: "150000.00", currency: "USD" } },
  keyDates: { closeDate: { name: "Deadline", eventType: "singleDate", date: "2027-09-30" } },
  acceptedApplicantTypes: ["non_profit_with_501c3"],
};

async function setup(h: Harness) {
  let who: H = {};
  // Moves the clock and signs in again, since a session lasts an hour.
  const at = async (iso: string) => {
    h.clock.now = new Date(iso);
    who = { ...bearer(await h.session(USER_OFFICER)).headers, "X-GMS-Workspace": WS_FUNDER };
  };
  // After the harness made the funder (2027-04-16), so the funder page takes its latest opportunity's date.
  await at("2027-05-05T10:00:00Z");
  const make = async (title: string) => data<{ id: string; slug: string }>(await h.request("/gms/opportunities", json(who, { ...OPP, title })));
  const competition = async (oppId: string) => data<{ id: string }>(await h.request("/gms/competitions", json(who, { opportunityId: oppId, title: "Round 1" })));

  // Open, with an open competition: takes applications.
  const open = await make("Open Call");
  const form = await data<{ id: string }>(await h.request("/gms/forms", json(who, { title: "Application", purpose: "application", jsonSchema: { type: "object", properties: { a: { type: "string" } } }, uiSchema: { type: "VerticalLayout", elements: [{ type: "Control", scope: "#/properties/a" }] } })));
  await h.request(`/gms/forms/${form.id}/publish`, { method: "POST", headers: who });
  const rubric = await data<{ id: string }>(await h.request("/gms/rubrics", json(who, { name: "Screen", criteria: [{ key: "fit", label: "Fit", weight: 1, scale: { type: "numeric", min: 1, max: 5 } }] })));
  const comp = await competition(open.id);
  await h.request(`/gms/competitions/${comp.id}/stages`, json(who, { stages: [{ key: "full", label: "Full application", forms: { [form.id]: 1 }, opens: "2027-05-01T00:00:00Z", closes: "2027-09-30T00:00:00Z", rubricId: rubric.id }] }, "PUT"));
  await h.request(`/gms/opportunities/${open.id}/publish`, json(who, { status: "open" }));
  const opened = await h.request(`/gms/competitions/${comp.id}/open`, { method: "POST", headers: who });
  // Open, but no competition is open yet.
  const waiting = await make("Waiting Call");
  await competition(waiting.id);
  await h.request(`/gms/opportunities/${waiting.id}/publish`, json(who, { status: "open" }));
  // Forecasted.
  const forecast = await make("Forecast Call");
  await h.request(`/gms/opportunities/${forecast.id}/publish`, json(who, { status: "forecasted" }));
  // Closed after it was published.
  const closed = await make("Closed Call");
  await h.request(`/gms/opportunities/${closed.id}/publish`, json(who, { status: "open" }));
  await at("2027-06-10T12:00:00Z");
  await h.request(`/gms/opportunities/${closed.id}/close`, { method: "POST", headers: who });
  // Never published.
  await make("Draft Call");
  return { who, opened, waiting };
}

describe("public funder page cards", () => {
  it("say which opportunities take applications now: open, with an open competition", async () => {
    const h = await harness();
    const { opened } = await setup(h);
    expect(opened.status).toBe(200);
    const page = await data<{ opportunities: { title: string; status: string; acceptingApplications: boolean }[] }>(await h.request("/gms/public/funders/riverbend"));
    const byTitle = Object.fromEntries(page.opportunities.map((o) => [o.title, o]));
    expect(Object.keys(byTitle).sort()).toEqual(["Closed Call", "Forecast Call", "Open Call", "Waiting Call"]);
    expect(byTitle["Open Call"]).toMatchObject({ status: "open", acceptingApplications: true });
    expect(byTitle["Waiting Call"]).toMatchObject({ status: "open", acceptingApplications: false });
    expect(byTitle["Forecast Call"]).toMatchObject({ status: "forecasted", acceptingApplications: false });
    expect(byTitle["Closed Call"]).toMatchObject({ status: "closed", acceptingApplications: false });

    const detail = await data<{ opportunity: { acceptingApplications: boolean } }>(await h.request("/gms/public/funders/riverbend/opportunities/open-call"));
    expect(detail.opportunity.acceptingApplications).toBe(true);
    const closedDetail = await h.request("/gms/public/funders/riverbend/opportunities/closed-call");
    expect(closedDetail.status).toBe(200);
    expect((await data<{ opportunity: { acceptingApplications: boolean } }>(closedDetail)).opportunity.acceptingApplications).toBe(false);
  });
});

describe("sitemap", () => {
  it("lists forecasted and closed calls that are still public, each with its last change", async () => {
    const h = await harness();
    const { who, waiting } = await setup(h);
    // Taken off the sitemap by its funder: stays on the page, leaves the sitemap.
    await h.request(`/gms/opportunities/${waiting.id}`, json(who, { publish: { publicPage: true, sitemap: false } }, "PATCH"));
    const xml = await (await h.request("/sitemap.xml")).text();
    const entries = Object.fromEntries([...xml.matchAll(/<url><loc>([^<]+)<\/loc><lastmod>([^<]+)<\/lastmod><\/url>/g)].map((m) => [m[1]!, m[2]!]));
    const base = "https://app.gms.test/f/riverbend";
    expect(Object.keys(entries).filter((k) => k.includes("/f/")).sort()).toEqual([base, `${base}/o/closed-call`, `${base}/o/forecast-call`, `${base}/o/open-call`]);
    expect(entries[`${base}/o/closed-call`]).toBe("2027-06-10T12:00:00.000Z");
    expect(entries[`${base}/o/forecast-call`]).toBe("2027-05-05T10:00:00.000Z");
    // The funder page changed when its latest listed opportunity did.
    expect(entries[base]).toBe("2027-06-10T12:00:00.000Z");
    expect(xml).not.toContain("draft-call");
  });

  it("lists the switch pages and the template gallery's approved items, and nothing pending, declined or withdrawn", async () => {
    const h = await harness();
    const item = (slug: string, status: string, published: string) => h.repos.table("gallery_items").insert({ slug, kind: "rubric", title: slug, summary: "A rubric.", tags: {} as never, author_workspace_id: null, licence: "CC-BY-4.0", status, version: 1, snapshot: { forms: [], rubrics: [], emails: [] } as never, uses_count: 0, published_at: published, withdrawn_at: status === "withdrawn" ? published : null });
    await item("five-criterion-rubric", "approved", "2026-11-15T00:00:00.000Z");
    await item("board-rubric", "approved", "2027-02-01T09:00:00.000Z");
    await item("gone-rubric", "withdrawn", "2027-03-01T09:00:00.000Z");
    // A submission waiting for a moderator is not an item at all.
    await h.repos.table("gallery_submissions").insert({ workspace_id: WS_FUNDER, kind: "rubric", title: "Pending rubric", summary: "Waiting.", tags: {} as never, snapshot: { forms: [], rubrics: [], emails: [] } as never, source_type: "rubric", source_id: "00000000-0000-4000-8000-000000000001", source_version: 1, status: "pending", submitted_by: USER_OFFICER });
    const xml = await (await h.request("/sitemap.xml")).text();
    const entries = Object.fromEntries([...xml.matchAll(/<url><loc>([^<]+)<\/loc><lastmod>([^<]+)<\/lastmod><\/url>/g)].map((m) => [m[1]!, m[2]!]));
    const web = "https://app.gms.test";
    const systems = ["good-grants", "submittable", "surveymonkey-apply", "foundant", "zengine", "fluxx", "smartsimple", "cybergrants", "openwater", "spreadsheets"];
    for (const p of ["/switch", ...systems.map((x) => `/switch/${x}`)]) expect(entries[`${web}${p}`], p).toBe("2026-11-15T00:00:00.000Z");
    expect(Object.keys(entries).filter((k) => k.includes("/switch")).length).toBe(11);
    expect(entries[`${web}/templates`]).toBe("2027-02-01T09:00:00.000Z");
    expect(entries[`${web}/templates/board-rubric`]).toBe("2027-02-01T09:00:00.000Z");
    expect(entries[`${web}/templates/five-criterion-rubric`]).toBe("2026-11-15T00:00:00.000Z");
    expect(xml).not.toMatch(/gone-rubric|Pending rubric|pending-rubric/);
  });
});
