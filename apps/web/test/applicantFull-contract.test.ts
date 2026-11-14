// @vitest-environment node
// SPDX-License-Identifier: AGPL-3.0-only
// One scenario, two backends, for the last part of the applicant port: (a) the web HTTP client
// against the real API Worker in-process, and (b) the in-browser mock. The same assertions run on
// both, on the fields the screens read.
import { beforeAll, describe, expect, it } from "vitest";
import { createHttpApplicantFullApi, describeDestination, toDocuments, toFaq, type ApplicantFullApi, type PayoutDestination } from "../src/api/applicantFull.ts";
import { ApiError } from "../src/api/client.ts";
import { seedApplicantStore } from "../src/mocks/applicant.ts";
import { createMockApplicantFullApi, seedFullStore } from "../src/mocks/applicantFull.ts";
import { demoSession } from "../src/mocks/auth.ts";
import { loadApi, type ApiHarness } from "./api-harness.ts";

interface Backend {
  full: ApplicantFullApi;
  workspaceId: string;
  funderHandle: string;
  slug: string;
  /** Paths the HTTP client asked for (the real backend only). */
  paths: string[];
}

async function realBackend(): Promise<Backend> {
  const helpers = await loadApi();
  const h: ApiHarness = await helpers.harness();
  const scn = (await import(/* @vite-ignore */ new URL("../../api/test/scenario.ts", import.meta.url).href)) as {
    scenario(h: ApiHarness): Promise<unknown>;
    USER_APPLICANT: string;
  };
  await scn.scenario(h);
  const ws = (helpers as unknown as { WS_APPLICANT: string }).WS_APPLICANT;
  const paths: string[] = [];
  const fetchInProcess: typeof fetch = async (input, init) => {
    const req = input instanceof Request ? input : new Request(input, init);
    const u = new URL(req.url);
    paths.push(u.pathname);
    const body = req.method === "GET" || req.method === "HEAD" ? undefined : await req.text();
    return h.request(u.pathname + u.search, { method: req.method, headers: req.headers, ...(body !== undefined ? { body } : {}) });
  };
  const full = createHttpApplicantFullApi({ baseUrl: helpers.BASE, token: () => h.session(scn.USER_APPLICANT, { aal: "aal2" }), workspaceId: () => ws, fetch: fetchInProcess });
  const page = (await (await fetchInProcess(`${helpers.BASE}/gms/public/funders/riverbend`)).json()) as { data: { opportunities: { slug: string }[] } };
  return { full, workspaceId: ws, funderHandle: "riverbend", slug: page.data.opportunities[0]!.slug, paths };
}

function mockBackend(): Backend {
  const store = seedApplicantStore();
  const full = createMockApplicantFullApi({ session: async () => demoSession(), store, full: seedFullStore(store) });
  return { full, workspaceId: store.organization.workspaceId, funderHandle: "riverbend", slug: "community-health-2027", paths: [] };
}

const status = async (p: Promise<unknown>): Promise<number> => {
  try {
    await p;
    return 200;
  } catch (e) {
    return e instanceof ApiError ? e.status : -1;
  }
};

for (const [name, make] of [
  ["the real API in-process", realBackend],
  ["the mock", async () => mockBackend()],
] as const) {
  describe(`applicant port, last part: ${name}`, () => {
    let b: Backend;
    beforeAll(async () => {
      b = await make();
    });

    it("creates a token whose secret is shown once, lists it, and revokes it", async () => {
      const before = (await b.full.apiTokens()).length;
      const token = await b.full.createApiToken({ name: "Contract test token", scopes: ["applications:read"] });
      expect(token.clientSecret.length).toBeGreaterThan(8);
      expect(token.scopes).toEqual(["applications:read"]);
      const listed = await b.full.apiTokens();
      expect(listed.length).toBe(before + 1);
      // The secret never comes back on a list.
      expect(JSON.stringify(listed)).not.toContain(token.clientSecret);
      const revoked = await b.full.revokeApiToken(token.id);
      expect(revoked.revokedAt).not.toBeNull();
    });

    it("refuses a token that could submit or sign", async () => {
      expect(await status(b.full.createApiToken({ name: "Too much", scopes: ["applications:submit"] }))).toBe(422);
      expect(await status(b.full.createApiToken({ name: "Too much", scopes: ["agreements:write"] }))).toBe(422);
    });

    it("exports the workspace as CommonGrants JSON plus the GMS's own records", async () => {
      const bundle = (await b.full.exportWorkspace()) as { commonGrants?: { protocol?: string; applications?: unknown[] }; gms?: { workspace?: { kind?: string } } };
      expect(bundle.commonGrants?.protocol).toBe("CommonGrants v0.5.0");
      expect(Array.isArray(bundle.commonGrants?.applications)).toBe(true);
      expect(bundle.gms?.workspace?.kind).toBe("applicant");
    });

    it("does not let the only admin leave", async () => {
      expect(await status(b.full.leaveWorkspace(b.workspaceId))).toBe(409);
    });

    it("reads the Passport locker as references, or says plainly that it cannot", async () => {
      const locker = await b.full.locker();
      expect(["ok", "unavailable"]).toContain(locker.state);
      for (const d of locker.items) {
        expect(typeof d.name).toBe("string");
        expect(typeof d.attachable).toBe("boolean");
        // References only: no bytes, no storage location.
        expect(Object.keys(d)).not.toContain("content");
        expect(Object.keys(d)).not.toContain("path");
      }
    });

    it("answers 404 for the payout destination of an award that is not the organization's", async () => {
      expect(await status(b.full.payoutDestination("awd_00000000-0000-7000-8000-00000000dead"))).toBe(404);
    });

    it("says whether the assistant is on", async () => {
      const s = await b.full.assistStatus();
      expect(typeof s.enabled).toBe("boolean");
      if (!s.enabled) expect(s.quota).toBeNull();
    });

    it("registers a funding alert and lists it", async () => {
      const alert = await b.full.createAlert("rural clinics");
      expect(alert.query).toBe("rural clinics");
      expect((await b.full.alerts()).some((a) => a.query === "rural clinics")).toBe(true);
      // The GMS keeps it; OpenGrants, whose API takes no alerts, is not asked.
      if (name.startsWith("the real")) {
        expect(b.paths).toContain("/gms/discover/alerts");
        expect(b.paths.some((p) => p.includes("/opengrants/"))).toBe(false);
      }
    });

    it("reads what a funder publishes: past awards, questions and guideline documents", async () => {
      const extras = await b.full.publicExtras(b.funderHandle);
      expect(Array.isArray(extras.pastAwards)).toBe(true);
      expect(Array.isArray(extras.faq)).toBe(true);
      for (const a of extras.pastAwards) expect(Number.isFinite(a.amountMinor)).toBe(true);
      const docs = await b.full.publicDocuments(b.funderHandle, b.slug);
      for (const d of docs) expect(d.url).toMatch(/^https:\/\//);
      expect(await status(b.full.publicExtras("no-such-funder"))).toBe(name.startsWith("the mock") ? 200 : 404);
    });
  });
}

describe("shapes the port normalizes", () => {
  it("reads published FAQ and documents whichever keys were used, and drops unusable entries", () => {
    expect(toFaq([{ q: "Who?", a: "Nonprofits." }, { question: "When?", answer: "April." }, { question: "", answer: "x" }, "junk"])).toEqual([
      { question: "Who?", answer: "Nonprofits." },
      { question: "When?", answer: "April." },
    ]);
    expect(toDocuments([{ name: "Guidelines.pdf", url: "https://funder.example/g.pdf" }, { name: "Local", url: "javascript:alert(1)" }, null])).toEqual([{ name: "Guidelines.pdf", url: "https://funder.example/g.pdf", kind: "document" }]);
  });

  it("explains every payout destination state in plain words", () => {
    const base: PayoutDestination = { state: "ok", bankName: "River City Credit Union", last4: "4821", status: "active", level: "L3", pendingChange: false, freezeUntil: null, manageUrl: null, reason: null };
    expect(describeDestination(base).tone).toBe("ok");
    expect(describeDestination({ ...base, pendingChange: true, freezeUntil: "2027-06-03T00:00:00Z" }).detail).toContain("2027-06-03");
    expect(describeDestination({ ...base, state: "none" }).title).toMatch(/No payout destination/);
    expect(describeDestination({ ...base, state: "not_linked" }).title).toMatch(/not connected/);
    expect(describeDestination({ ...base, state: "not_shared" }).detail).toMatch(/open it there/);
    expect(describeDestination({ ...base, state: "unknown" }).title).toMatch(/can't be reached/);
  });
});
