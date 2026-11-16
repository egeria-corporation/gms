// SPDX-License-Identifier: AGPL-3.0-only
// Red team: the apply widget's data route (`/gms/public/embed/...`) answers exactly when the public
// opportunity page does, and carries nothing that page hides: not for a draft, a closed call, a
// call the funder keeps off its public page, a suspended funder, or a call with a draft round,
// private contacts and rule internals. Every value it sends is on the page or follows from it.
import { describe, expect, it } from "vitest";
import { USER_ADMIN, USER_OFFICER, WS_FUNDER, bearer, harness, type Harness } from "./helpers.ts";

type H = Record<string, string>;
const json = (h: H, body: unknown, method = "POST"): RequestInit => ({ method, headers: { ...h, "Content-Type": "application/json" }, body: JSON.stringify(body) });
const data = async <T>(res: Response) => ((await res.json()) as { data: T }).data;
/** Written into everything the public page hides; the widget must never carry it. */
const MARK = "zzhidden";

const OPP = {
  description: "Grants for community health navigation in Riverbend County.",
  funding: { minAwardAmount: { amount: "50000.00", currency: "USD" }, maxAwardAmount: { amount: "150000.00", currency: "USD" } },
  keyDates: { closeDate: { name: "Deadline", eventType: "singleDate", date: "2027-09-30" }, postDate: { name: "Opens", eventType: "singleDate", date: "2027-01-05" } },
  acceptedApplicantTypes: ["non_profit_with_501c3"],
  eligibilityRules: { all: ["Serves the region", "Budget under $5M", "Nonprofit", "Two audits"].map((label, i) => ({ path: `profile.commonApp.${MARK}${i}`, op: "exists", missing: "unknown", label })) },
};

interface Widget {
  funder: { handle: string; name: string; brand: Record<string, unknown>; verified: boolean };
  opportunity: Record<string, unknown> & { eligibility: string[]; moreEligibility: number; status: string };
  acceptingApplications: boolean;
  poweredBy: boolean;
  links: { page: string };
}
interface Page {
  funder: { handle: string; name: string; poweredBy?: boolean; verification: { source: string } };
  opportunity: { status: string; acceptingApplications: boolean; eligibility: string[] };
  competitions: { status: string }[];
  links: { page: string };
}

async function setup(h: Harness) {
  const officer = { ...bearer(await h.session(USER_OFFICER)).headers, "X-GMS-Workspace": WS_FUNDER };
  const admin = { ...bearer(await h.session(USER_ADMIN)).headers, "X-GMS-Workspace": WS_FUNDER };
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await h.request(path, body === undefined ? { method, headers: officer } : json(officer, body, method));
    if (res.status >= 300) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
    return data<{ id: string; slug: string }>(res);
  };
  // What the page hides: a private contact, the funder's settings, rule paths, a draft round.
  expect((await h.request("/gms/contacts", json(admin, { contacts: [{ name: "Dana Ortiz", email: "dana.ortiz@riverbendcf.example", public: true }, { name: `${MARK} Whitfield`, email: `${MARK}@riverbendcf.example` }] }, "PUT"))).status).toBe(200);
  expect((await h.request(`/gms/workspaces/${WS_FUNDER}`, json(admin, { settings: { internalNote: `${MARK} note` } }, "PATCH"))).status).toBeLessThan(300);

  const form = await call("POST", "/gms/forms", { title: "Application", purpose: "application", jsonSchema: { type: "object", properties: { a: { type: "string" } } }, uiSchema: { type: "VerticalLayout", elements: [{ type: "Control", scope: "#/properties/a" }] } });
  await call("POST", `/gms/forms/${form.id}/publish`);
  const make = async (title: string) => call("POST", "/gms/opportunities", { ...OPP, title });
  const round = async (oppId: string, title: string, open: boolean) => {
    const comp = await call("POST", "/gms/competitions", { opportunityId: oppId, title, description: `${title} description` });
    await call("PUT", `/gms/competitions/${comp.id}/stages`, { stages: [{ key: "full", label: "Full application", forms: { [form.id]: 1 }, opens: "2027-01-01T00:00:00Z", closes: "2099-09-30T00:00:00Z", decisionRequired: false }] });
    if (open) await call("POST", `/gms/competitions/${comp.id}/open`);
  };

  const draft = await make("Draft Call");
  await round(draft.id, `${MARK} draft call round`, false);

  const open = await make("Open Call");
  await call("POST", `/gms/opportunities/${open.id}/publish`, { status: "open" });
  await round(open.id, "Round 1", true);
  await round(open.id, `${MARK} next round`, false);

  const closed = await make("Closed Call");
  await call("POST", `/gms/opportunities/${closed.id}/publish`, { status: "open" });
  await call("POST", `/gms/opportunities/${closed.id}/close`);

  const forecast = await make("Forecast Call");
  await call("POST", `/gms/opportunities/${forecast.id}/publish`, { status: "forecasted" });

  const offPage = await make("Off Page Call");
  await call("PATCH", `/gms/opportunities/${offPage.id}`, { publish: { publicPage: false } });
  await call("POST", `/gms/opportunities/${offPage.id}/publish`, { status: "open" });
  await round(offPage.id, "Hidden round", true);

  return { slugs: { draft: draft.slug, open: open.slug, closed: closed.slug, forecast: forecast.slug, offPage: offPage.slug } };
}

/** Every string and number in a JSON value. */
const leaves = (v: unknown): (string | number)[] => (typeof v === "string" || typeof v === "number" ? [v] : Array.isArray(v) ? v.flatMap(leaves) : v && typeof v === "object" ? Object.values(v).flatMap(leaves) : []);

async function both(h: Harness, handle: string, slug: string) {
  const page = await h.request(`/gms/public/funders/${handle}/opportunities/${slug}`);
  const widget = await h.request(`/gms/public/embed/funders/${handle}/opportunities/${slug}`);
  return { page: { status: page.status, text: await page.text() }, widget: { status: widget.status, text: await widget.text() } };
}

describe("the apply widget's data and the public page", () => {
  it("answers 404 wherever the page does: a draft, a call off its public page, an unknown funder or call", async () => {
    const h = await harness();
    const { slugs } = await setup(h);
    for (const [handle, slug] of [["riverbend", slugs.draft], ["riverbend", slugs.offPage], ["riverbend", "no-such-call"], ["nobody", slugs.open]] as const) {
      const r = await both(h, handle, slug);
      expect(r.page.status, `${handle}/${slug}`).toBe(404);
      expect(r.widget.status, `${handle}/${slug}`).toBe(404);
      expect(r.widget.text.toLowerCase()).not.toContain(MARK);
      for (const word of ["Draft Call", "Off Page Call", "Hidden round"]) expect(r.widget.text).not.toContain(word);
    }
  });

  it("answers 404 for every call of a suspended funder", async () => {
    const h = await harness();
    const { slugs } = await setup(h);
    await h.repos.table("workspaces").update({ id: WS_FUNDER }, { status: "suspended" });
    for (const slug of Object.values(slugs)) {
      const r = await both(h, "riverbend", slug);
      expect([r.page.status, r.widget.status], slug).toEqual([404, 404]);
    }
  });

  it("for open, closed and forecasted calls sends only what the page shows, or what follows from it", async () => {
    const h = await harness();
    const { slugs } = await setup(h);
    for (const slug of [slugs.open, slugs.closed, slugs.forecast]) {
      const r = await both(h, "riverbend", slug);
      expect([r.page.status, r.widget.status], slug).toEqual([200, 200]);
      const page = (JSON.parse(r.page.text) as { data: Page }).data;
      const widget = (JSON.parse(r.widget.text) as { data: Widget }).data;
      // Nothing the page hides: no draft round, no private contact, no settings, no rule paths.
      expect(r.widget.text.toLowerCase(), slug).not.toContain(MARK);
      expect(r.page.text.toLowerCase(), slug).not.toContain(MARK);
      // Every string and number is on the page, apart from how many more rules there are.
      const onPage = new Set(leaves(page).map(String));
      const { moreEligibility, ...rest } = widget.opportunity;
      for (const v of leaves({ ...widget, opportunity: rest })) expect(onPage.has(String(v)), `${slug}: ${String(v)}`).toBe(true);
      expect(moreEligibility).toBe(Math.max(0, page.opportunity.eligibility.length - widget.opportunity.eligibility.length));
      // The yes/no answers are the page's own.
      expect(widget.acceptingApplications, slug).toBe(page.opportunity.acceptingApplications);
      expect(widget.poweredBy).toBe(page.funder.poweredBy !== false);
      expect(widget.funder.verified).toBe(page.funder.verification.source === "passport");
      expect(widget.opportunity.status).toBe(page.opportunity.status);
      expect(widget.links.page).toBe(page.links.page);
    }
    const open = (JSON.parse((await both(h, "riverbend", slugs.open)).widget.text) as { data: Widget }).data;
    expect(open.acceptingApplications).toBe(true);
    for (const slug of [slugs.closed, slugs.forecast]) expect((JSON.parse((await both(h, "riverbend", slug)).widget.text) as { data: Widget }).data.acceptingApplications, slug).toBe(false);
  });

  it("does not open a call when the page would not: closing it or taking it off the page closes the widget too", async () => {
    const h = await harness();
    const { slugs } = await setup(h);
    const officer = { ...bearer(await h.session(USER_OFFICER)).headers, "X-GMS-Workspace": WS_FUNDER };
    const [opp] = await h.repos.table("opportunities").find({ workspace_id: WS_FUNDER, slug: slugs.open });
    expect((await h.request(`/gms/opportunities/opp_${opp!.id}`, json(officer, { publish: { publicPage: false } }, "PATCH"))).status).toBe(200);
    const r = await both(h, "riverbend", slugs.open);
    expect([r.page.status, r.widget.status]).toEqual([404, 404]);
  });
});
