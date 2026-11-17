// SPDX-License-Identifier: AGPL-3.0-only
// "Applications from social" in the reach report (v1.9.0): an application started from a shared
// social link (`?utm_source=social` on the CommonGrants start, whose body takes no other field)
// records that source on its started event, and the reach report of that opportunity counts it.
// Any other source is not recorded, and the start body is unchanged.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startSourceOf } from "../src/services/apply.ts";
import { harness, type Harness } from "./helpers.ts";
import { scenario, type Scenario } from "./scenario.ts";

let h: Harness;
let s: Scenario;

beforeEach(async () => {
  h = await harness();
  s = await scenario(h);
});
afterEach(() => {
  delete h.env.ZERNIO_API_KEY;
  delete h.env.ZERNIO_WEBHOOK_SECRET;
});

describe("applications from social", () => {
  it("records utm_source=social on the started event and counts it in the reach report", async () => {
    const res = await h.request("/common-grants/applications/start?utm_source=social", { method: "POST", headers: { ...s.applicant, "Content-Type": "application/json" }, body: JSON.stringify({ competitionId: s.uuid.comp }) });
    expect(res.status).toBe(201);
    const started = await h.repos.table("application_events").find({ type: "started" });
    expect(started.map((e) => e.payload)).toEqual([{ utmSource: "social" }]);
    // Starting again returns the same application and records nothing more.
    expect((await h.request("/common-grants/applications/start?utm_source=social", { method: "POST", headers: { ...s.applicant, "Content-Type": "application/json" }, body: JSON.stringify({ competitionId: s.uuid.comp }) })).status).toBe(200);
    expect(await h.repos.table("application_events").count({ type: "started" })).toBe(1);
    h.env.ZERNIO_API_KEY = "zk_test_made_up";
    h.env.ZERNIO_WEBHOOK_SECRET = "zernio-webhook-secret-for-unit-tests";
    const reach = await s.call<{ data: { applicationsFromSocial: number | null } }>(s.funder, "GET", `/gms/social/posts?subjectType=opportunity&subjectId=${s.uuid.opp}`);
    expect(reach.status).toBe(200);
    expect(reach.body.data.applicationsFromSocial).toBe(1);
  });

  it("records no other source, and the start body takes no source field", () => {
    expect(startSourceOf("social")).toEqual({ utmSource: "social" });
    for (const v of [undefined, "", "newsletter", "SOCIAL", "social "]) expect(startSourceOf(v)).toEqual({});
  });

  it("an unknown source leaves the started event without a payload", async () => {
    const res = await h.request("/common-grants/applications/start?utm_source=newsletter", { method: "POST", headers: { ...s.applicant, "Content-Type": "application/json" }, body: JSON.stringify({ competitionId: s.uuid.comp }) });
    expect(res.status).toBe(201);
    expect((await h.repos.table("application_events").find({ type: "started" })).map((e) => e.payload)).toEqual([{}]);
  });
});
