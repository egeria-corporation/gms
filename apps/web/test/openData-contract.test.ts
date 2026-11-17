// @vitest-environment node
// SPDX-License-Identifier: AGPL-3.0-only
// The open data web HTTP client (api/openData.ts) against the real API Worker in-process, so the
// Reporting panel's calls are the ones the server answers.
import { describe, expect, it } from "vitest";
import { createHttpOpenDataApi, fileNameFor, rangeQuery } from "../src/api/openData.ts";
import { loadApi } from "./api-harness.ts";

describe("open data HTTP client against the API", () => {
  it("reads the summary, downloads a file and saves settings through the routes the server serves", async () => {
    const helpers = await loadApi();
    const h = await helpers.harness();
    const funder = helpers.WS_FUNDER;
    const applicant = "33333333-3333-4333-8333-333333333333";
    await h.repos.table("awards").insert({ workspace_id: funder, title: "Navigator program", status: "active", recipient_workspace_id: applicant, funding: { awardedAmount: { amount: "50000.00", currency: "USD" } }, key_dates: { awardDate: { name: "Award date", eventType: "singleDate", date: "2027-03-01" } } });
    await h.repos.table("awards").insert({ workspace_id: funder, title: "Offer pending", status: "offered", recipient_workspace_id: applicant, funding: { awardedAmount: { amount: "1.00", currency: "USD" } } });
    const inProcess: typeof fetch = async (input, init) => {
      const req = input instanceof Request ? input : new Request(input, init);
      const u = new URL(req.url);
      const body = req.method === "GET" ? undefined : await req.text();
      return h.request(u.pathname + u.search, { method: req.method, headers: req.headers, ...(body !== undefined ? { body } : {}) });
    };
    const api = createHttpOpenDataApi({ baseUrl: helpers.BASE, token: () => h.session(helpers.USER_ADMIN), workspaceId: () => funder, handle: () => "riverbend", fetch: inProcess });
    const range = { from: "2027-01-01", to: "2027-12-31" };
    expect(rangeQuery(range)).toBe("?year=2027");
    const s = await api.summary(range);
    expect(s.counts).toMatchObject({ inRange: 2, exported: 1, leftOut: 1, nameOnly: 1 });
    expect(s.years).toEqual([2027]);
    expect(s.leftOut).toEqual([{ reason: "not_accepted", label: "Not accepted yet", count: 1 }]);
    const file = await api.download("360giving-csv", range, s.draft);
    expect(file.filename).toBe("360giving-riverbend-2027-01-01-to-2027-12-31-DRAFT.csv");
    expect(await file.blob.text()).toContain("Recipient Org:Identifier");
    await expect(api.saveSettings({ publishFeed: true })).rejects.toThrow(/prefix/);
    expect(await api.saveSettings({ threeSixtyGivingPrefix: "360G-riverbend", publishFeed: true })).toEqual({ threeSixtyGivingPrefix: "360G-riverbend", publishFeed: true, feedUrl: `${helpers.BASE}/gms/open-data/riverbend/360giving.json` });
    expect((await api.summary(range)).draft).toBe(false);
    expect(fileNameFor("commongrants-json", "riverbend", { from: null, to: null }, false)).toBe("commongrants-riverbend-all.json");
    const row = (await api.summary(range)).awards.find((a) => a.title === "Navigator program")!;
    expect(await api.setConfidential(row.awardId, true)).toEqual({ awardId: row.awardId, confidential: true });
    expect((await api.summary(range)).counts.exported).toBe(0);
  });
});
