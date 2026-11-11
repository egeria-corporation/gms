// @vitest-environment node
// SPDX-License-Identifier: AGPL-3.0-only
// The launch port (api/launch.ts) on two backends: the web HTTP client against the real API Worker
// in-process, and the in-browser mock, with one set of assertions. A route the Worker does not
// serve would show here as an empty answer where the mock has data.
import { beforeAll, describe, expect, it } from "vitest";
import { ApiError } from "../src/api/client.ts";
import { createHttpLaunchApi, type LaunchApi } from "../src/api/launch.ts";
import { APPLICANT_IDS } from "../src/mocks/applicant.ts";
import { demoSession } from "../src/mocks/auth.ts";
import { createMockLaunchApi, LAUNCH_PEOPLE, seedLaunchStore } from "../src/mocks/launch.ts";
import { IDS } from "../src/mocks/store.ts";
import { loadApi, type ApiHarness } from "./api-harness.ts";

interface Backend {
  funder: LaunchApi;
  applicant: LaunchApi;
  /** No session: what the public pages can read. */
  visitor: LaunchApi;
  funderHandle: string;
  funderWorkspaceId: string;
  programId: string;
  applicationId: string;
  /** A member of the funder workspace who can own a program. */
  memberId: string;
  /** Whether this backend can list sign-in sessions for the test person. */
  sessionId: string;
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

interface Scenario {
  funder: Record<string, string>;
  applicant: Record<string, string>;
  uuid: { comp: string; loi: string };
  call: (who: Record<string, string>, method: string, path: string, body?: unknown) => Promise<{ status: number; body: { data: { id: string } } }>;
}
interface Helpers {
  harness(): Promise<ApiHarness & { sessions: { rows: Record<string, unknown>[] }; session(userId: string, opts?: { sessionId?: string }): Promise<string> }>;
  BASE: string;
  USER_ADMIN: string;
  WS_FUNDER: string;
  WS_APPLICANT: string;
}

async function realBackend(): Promise<Backend> {
  const helpers = (await loadApi()) as unknown as Helpers;
  const sc = (await import(/* @vite-ignore */ new URL("../../api/test/scenario.ts", import.meta.url).href)) as { scenario: (h: ApiHarness) => Promise<Scenario>; USER_APPLICANT: string };
  const h = await helpers.harness();
  const s = await sc.scenario(h);
  const program = await s.call(s.funder, "POST", "/gms/programs", { name: "Community Health 2027", budgetAmountMinor: 120_000_000 });
  const started = await s.call(s.applicant, "POST", "/common-grants/applications/start", { competitionId: s.uuid.comp });
  const app = started.body.data.id;
  await s.call(s.applicant, "PUT", `/common-grants/applications/${app}/forms/${s.uuid.loi}`, { response: { projectTitle: "Mobile Health Navigation for Rural Families", requestedAmount: { amount: "150000.00", currency: "USD" }, need: "Families travel long distances for care." } });
  expect((await s.call(s.applicant, "PUT", `/common-grants/applications/${app}/submit`)).status).toBe(200);

  const SESSION = "5e000000-0000-4000-8000-000000000001";
  const OTHER = "5e000000-0000-4000-8000-000000000002";
  h.sessions.rows.push(
    { userId: helpers.USER_ADMIN, id: SESSION, createdAt: "2027-04-01T09:00:00Z", lastActiveAt: "2027-04-20T09:00:00Z", userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36", ip: "203.0.113.24", aal: "aal2" },
    { userId: helpers.USER_ADMIN, id: OTHER, createdAt: "2027-03-01T09:00:00Z", lastActiveAt: null, userAgent: null, ip: null, aal: "aal1" },
  );
  const inProcess: typeof fetch = async (input, init) => {
    const req = input instanceof Request ? input : new Request(input, init);
    const u = new URL(req.url);
    const body = req.method === "GET" || req.method === "HEAD" ? undefined : await req.text();
    return h.request(u.pathname + u.search, { method: req.method, headers: req.headers, ...(body !== undefined ? { body } : {}) });
  };
  const client = (userId: string | null, workspaceId: string | null, sessionId?: string) => createHttpLaunchApi({ baseUrl: helpers.BASE, token: async () => (userId ? h.session(userId, sessionId ? { sessionId } : {}) : null), workspaceId: () => workspaceId, fetch: inProcess });
  const handle = String((await h.repos.table("workspaces").find({ id: helpers.WS_FUNDER }))[0]!.handle);
  return {
    funder: client(helpers.USER_ADMIN, helpers.WS_FUNDER, SESSION),
    applicant: client(sc.USER_APPLICANT, helpers.WS_APPLICANT),
    visitor: client(null, null),
    funderHandle: handle,
    funderWorkspaceId: helpers.WS_FUNDER,
    programId: program.body.data.id,
    applicationId: `app_${app}`,
    memberId: helpers.USER_ADMIN,
    sessionId: OTHER,
  };
}

async function mockBackend(): Promise<Backend> {
  const store = seedLaunchStore();
  const api = createMockLaunchApi({ session: async () => demoSession(), store });
  const visitor = createMockLaunchApi({ session: async () => null, store });
  return {
    funder: api,
    applicant: api,
    visitor,
    funderHandle: "riverbend",
    funderWorkspaceId: "10000000-0000-4000-8000-0000000000aa",
    programId: IDS.programHealth27,
    applicationId: `app_${APPLICANT_IDS.appClinic}`,
    memberId: LAUNCH_PEOPLE.dana.userId,
    sessionId: store.sessions.find((s) => !s.current)!.id,
  };
}

describe.each([
  ["the API Worker over HTTP", realBackend],
  ["the mock API", mockBackend],
])("LaunchApi contract: %s", (_name, make) => {
  let b: Backend;
  beforeAll(async () => {
    b = await make();
  });

  it("says, with or without a session, whether payments through Passport are on", async () => {
    // The switch itself belongs to the installation (the API's test harness runs with it on).
    const config = await b.visitor.config();
    expect(config).toMatchObject({ facilitatedPayments: expect.any(Boolean) });
    // Which optional connections this server can make, each a plain yes or no.
    expect(Object.values(config.available ?? {}).every((v) => typeof v === "boolean")).toBe(true);
    expect(Object.keys(config.available ?? {}).sort()).toEqual(["assistant", "customMcp", "googleWorkspace", "mercury", "openGrants"]);
    expect(await b.funder.config()).toEqual(config);
  });

  it("lists the person's sessions, marks the current one, and ends another", async () => {
    const before = await b.funder.sessions();
    expect(before.length).toBe(2);
    expect(before.filter((s) => s.current)).toHaveLength(1);
    const current = before.find((s) => s.current)!;
    expect(current).toMatchObject({ device: "Chrome on macOS", ip: "203.0.113.24", mfa: true });
    expect(typeof current.createdAt).toBe("string");
    // The session in use is ended by signing out, not from the list.
    expect((await failure(b.funder.signOutSession(current.id))).status).toBe(409);
    expect(await b.funder.signOutSession(b.sessionId)).toEqual({ ended: true });
    expect((await b.funder.sessions()).map((s) => s.id)).toEqual([current.id]);
  });

  it("gives a program an owner and takes it away", async () => {
    const owner = await b.funder.setProgramOwner(b.programId, b.memberId);
    expect(owner).toMatchObject({ userId: b.memberId, name: expect.any(String) });
    expect((await b.funder.programOwners())[b.programId]).toEqual(owner);
    expect(await b.funder.setProgramOwner(b.programId, null)).toBeNull();
    expect((await b.funder.programOwners())[b.programId]).toBeUndefined();
  });

  it("returns outcome totals in one shape, empty when no report has been accepted", async () => {
    const outcomes = await b.funder.programOutcomes(b.programId);
    expect(outcomes).toEqual({ reportsAccepted: 0, totals: [] });
  });

  it("stores a program's budget categories without duplicates", async () => {
    expect(await b.funder.putBudgetCategories(b.programId, ["Personnel", "Travel"])).toEqual(["Personnel", "Travel"]);
    expect(await b.funder.budgetCategories(b.programId)).toEqual(["Personnel", "Travel"]);
  });

  it("reports an organization's representatives with a state, never contact details", async () => {
    const reps = await b.applicant.representatives();
    expect(["ok", "not_shared", "not_linked", "unknown"]).toContain(reps.state);
    for (const r of reps.items) {
      expect(Object.keys(r).sort()).toEqual(["name", "title", "verified", "verifiedAt"]);
      expect(typeof r.verified).toBe("boolean");
    }
  });

  it("offers interview times, shows them to both sides, and confirms only an offered one", async () => {
    const slots = ["2027-05-04T17:00:00Z", "2027-05-05T18:30:00Z"];
    const offered = await b.funder.proposeInterview(b.applicationId, { slots, note: "Video call", location: "Online" });
    expect(offered.proposed).toMatchObject({ slots, note: "Video call", location: "Online" });
    expect(offered.confirmed).toBeNull();
    expect((await b.applicant.interview(b.applicationId, "applicant")).proposed?.slots).toEqual(slots);
    expect((await failure(b.applicant.confirmInterview(b.applicationId, "2027-06-01T10:00:00Z"))).status).toBe(422);
    const confirmed = await b.applicant.confirmInterview(b.applicationId, slots[1]!);
    expect(confirmed.confirmed).toMatchObject({ slot: slots[1], at: expect.any(String) });
    expect((await b.funder.interview(b.applicationId, "funder")).confirmed?.slot).toBe(slots[1]);
  });

  it("reads member activity for a workspace", async () => {
    const activity = await b.funder.memberActivity(b.funderWorkspaceId);
    expect(activity.length).toBeGreaterThan(0);
    for (const a of activity) expect(a).toEqual({ userId: expect.any(String), lastActiveAt: a.lastActiveAt === null ? null : expect.any(String), organization: a.organization === null ? null : expect.any(String) });
  });

  it("keeps the funder's contacts: all for applicants, only the public ones on the public page", async () => {
    const contacts = [
      { name: "Dana Ortiz", title: "Program officer", email: "grants@riverbendcf.example", phone: null, public: true },
      { name: "Sam Whitfield", title: null, email: "sam.whitfield@riverbendcf.example", phone: "555-0100", public: false },
    ];
    expect(await b.funder.putContacts(contacts)).toEqual(contacts);
    expect(await b.funder.contacts()).toEqual(contacts);
    expect((await b.visitor.publicContacts(b.funderHandle)).map((c) => c.name)).toEqual(["Dana Ortiz"]);
    expect((await failure(b.funder.putContacts([{ name: "No Email", title: null, email: "", phone: null, public: false }]))).status).toBe(400);
  });

  it("has no signature records for an award nobody has signed", async () => {
    expect(await b.funder.signatures("awd_00000000-0000-7000-8000-00000000dead")).toEqual([]);
  });

  it("suggests nobody from the directory for a query too short to search", async () => {
    expect(await b.funder.directorySuggest("a")).toEqual([]);
  });
});
