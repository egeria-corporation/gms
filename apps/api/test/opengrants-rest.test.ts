// SPDX-License-Identifier: AGPL-3.0-only
// The OpenGrants REST client (https://ops.opengrants.io/openapi.json). Fixtures follow the shapes the
// live API returned on 2026-11-11: `results[]` for search, `matches[]` for matching.
import { describe, expect, it } from "vitest";
import { OpenGrantsProfileError, OpenGrantsUnavailableError, OpenGrantsUnsupportedError, RestOpenGrantsClient, amountRange } from "../src/services/ports.ts";

const BASE = "https://ops.test/functions/v1";

const SEARCH = {
  results: [
    {
      id: "c2d6723c-8404-42c4-920f-9fbb1d0d8ccb",
      title: "Rural Clinics Fund",
      description: "Operating support for rural clinics. ".repeat(20),
      amount_min: 5000,
      amount_max: 25000,
      deadline_date: "2027-03-01",
      status: "open",
      funder_name: "Example Health Foundation",
      listing_url: "https://funder.example/rural-clinics",
    },
    { id: "", title: "No id, dropped" },
    { id: "9b1f0c1e-0000-4000-8000-000000000002", title: "Bare listing", amount_min: null, amount_max: null, deadline_date: null, funder_name: null, listing_url: null, description: null },
  ],
  pagination: { total: 3 },
};

const MATCH = {
  count: 1,
  matches: [{ id: "0cd294f4-1c31-4a9d-8d97-2b63b241bdce", title: "Rural Health Grant", funder: "Example Cares", match_score: 86.4, why_it_fits: "strong topical match; open nationally", award_min_usd: null, award_max_usd: 30000, deadline: null, url: "https://funder.example/cares" }],
};

function client(respond: (url: string, init?: RequestInit) => Response) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const c = new RestOpenGrantsClient(`${BASE}/`, "og-test-key", async (url, init) => {
    calls.push({ url, ...(init ? { init } : {}) });
    return respond(url, init);
  });
  return { c, calls };
}

describe("RestOpenGrantsClient", () => {
  it("searches grants with the key, the query and the applicant's state", async () => {
    const { c, calls } = client(() => Response.json(SEARCH));
    const r = await c.call("search", { query: "rural health" }, { region: "CA", orgType: "nonprofit" });
    const url = new URL(calls[0]!.url);
    expect(url.origin + url.pathname).toBe(`${BASE}/grants-api`);
    expect(Object.fromEntries(url.searchParams)).toEqual({ limit: "20", search: "rural health", search_mode: "hybrid", states: "CA", include_national: "true" });
    expect((calls[0]!.init!.headers as Record<string, string>).Authorization).toBe("Bearer og-test-key");
    expect(r.items).toHaveLength(2);
    expect(r.items[0]).toMatchObject({
      id: "c2d6723c-8404-42c4-920f-9fbb1d0d8ccb",
      title: "Rural Clinics Fund",
      funder: "Example Health Foundation",
      url: "https://funder.example/rural-clinics",
      source: "https://funder.example/rural-clinics",
      deadline: "2027-03-01",
      amount: "$5,000 – $25,000",
    });
    expect((r.items[0]!.summary as string).length).toBeLessThanOrEqual(320);
    // A listing with nothing but an id and a title still shows; missing fields are left out, not "null".
    expect(r.items[1]).toEqual({ id: "9b1f0c1e-0000-4000-8000-000000000002", title: "Bare listing" });
  });

  it("browses without a query or a state", async () => {
    const { c, calls } = client(() => Response.json({ results: [] }));
    expect((await c.call("search", {}, {})).items).toEqual([]);
    expect(Object.fromEntries(new URL(calls[0]!.url).searchParams)).toEqual({ limit: "20" });
  });

  it("matches on the organization's mission, state and type, and nothing else", async () => {
    const { c, calls } = client(() => Response.json(MATCH));
    const r = await c.call("match", {}, { mission: "Clinics for rural families", region: "CA", orgType: "nonprofit", revenueBand: "1m_5m" });
    expect(calls[0]!.url).toBe(`${BASE}/match-grants-api`);
    expect(calls[0]!.init!.method).toBe("POST");
    expect(JSON.parse(calls[0]!.init!.body as string)).toEqual({ profile: { mission: "Clinics for rural families", geography: "CA", applicant_type: "nonprofit" }, limit: 20 });
    expect(r.items).toEqual([
      { id: "0cd294f4-1c31-4a9d-8d97-2b63b241bdce", title: "Rural Health Grant", funder: "Example Cares", url: "https://funder.example/cares", source: "https://funder.example/cares", amount: "up to $30,000", summary: "strong topical match; open nationally", matchScore: 86 },
    ]);
  });

  it("asks for a mission before matching instead of sending an empty profile", async () => {
    const { c, calls } = client(() => Response.json(MATCH));
    await expect(c.call("match", {}, { region: "CA" })).rejects.toBeInstanceOf(OpenGrantsProfileError);
    expect(calls).toHaveLength(0);
  });

  it("says which tools the REST API does not have", async () => {
    const { c } = client(() => Response.json({}));
    await expect(c.call("alerts", {}, {})).rejects.toBeInstanceOf(OpenGrantsUnsupportedError);
    await expect(c.call("eligibility", {}, {})).rejects.toBeInstanceOf(OpenGrantsUnsupportedError);
  });

  it("reports a refused key, a rate limit, a network failure and a non-JSON body as unavailable", async () => {
    for (const status of [401, 403, 429, 500]) {
      await expect(client(() => Response.json({ error: "x" }, { status })).c.call("search", {}, {})).rejects.toMatchObject({ name: "OpenGrantsUnavailableError", status });
    }
    await expect(
      client(() => {
        throw new TypeError("network down");
      }).c.call("search", {}, {}),
    ).rejects.toBeInstanceOf(OpenGrantsUnavailableError);
    await expect(client(() => new Response("<html>", { status: 200 })).c.call("search", {}, {})).rejects.toBeInstanceOf(OpenGrantsUnavailableError);
  });

  it("formats award amounts", () => {
    expect(amountRange(5000, 25000)).toBe("$5,000 – $25,000");
    expect(amountRange(null, 30000)).toBe("up to $30,000");
    expect(amountRange(5000, null)).toBe("from $5,000");
    expect(amountRange(10000, 10000)).toBe("$10,000");
    expect(amountRange(null, null)).toBeUndefined();
    expect(amountRange(0, "x")).toBeUndefined();
  });
});
