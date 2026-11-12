// SPDX-License-Identifier: AGPL-3.0-only
// Using the GMS without Passport (docs/decisions.md, 2026-11-12): a self-declared profile that is
// never shown as verified, eligibility that does not rest on it unless the funder accepts it, the
// two opportunity options, readiness, letters, linking later, and the workspace-creation caps.
import { beforeEach, describe, expect, it } from "vitest";
import { WORKSPACE_CREATION_LIMITS } from "../src/lib/rate-limit.ts";
import { orgFacts, recipientEmails, replaceProfileWithPassport, verificationOf } from "../src/services/profile.ts";
import { USER_ADMIN, USER_OFFICER, WS_APPLICANT, WS_FUNDER, bearer, harness, type Harness } from "./helpers.ts";
import { USER_APPLICANT, scenario, type Scenario } from "./scenario.ts";

const json = (h: Record<string, string>, body: unknown, method = "POST"): RequestInit => ({ method, headers: { ...h, "Content-Type": "application/json" }, body: JSON.stringify(body) });
const data = async <T>(res: Response) => ((await res.json()) as { data: T }).data;
const code = async (res: Response) => ((await res.json()) as { errors: { code: string }[] }).errors[0]!.code;

const PROFILE = { legalName: "Lakeside Pantry Inc.", contactEmail: "Office@Lakeside.example", website: "https://lakeside.example", ein: "12-3456789", address: { city: "Portland", region: "OR", country: "us" }, orgType: "non_profit_with_501c3" };

describe("creating a workspace without Passport", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await harness();
  });
  const person = (n: number) => `f0f0f0f0-f0f0-4f0f-8f0f-${String(n).padStart(12, "0")}`;
  const create = async (user: string, body: Record<string, unknown>, ip = "203.0.113.7") => h.request("/gms/workspaces", json({ ...bearer(await h.session(user)).headers, "CF-Connecting-IP": ip }, { kind: "applicant", displayName: "Lakeside Pantry", ...body }));

  it("stores a self-declared profile, shows it as not verified and ledgers field names only", async () => {
    const res = await create(person(1), { handle: "lakeside", profile: PROFILE });
    expect(res.status).toBe(201);
    const { workspace } = await data<{ workspace: { id: string; profileSource: string; verification: unknown; profile: Record<string, unknown> } }>(res);
    expect(workspace.profileSource).toBe("self_declared");
    expect(workspace.verification).toEqual({ source: "self_declared", level: null });
    expect(workspace.profile).toMatchObject({ legalName: "Lakeside Pantry Inc.", contactEmail: "office@lakeside.example", ein: "123456789", address: { country: "US" } });
    const row = (await h.repos.table("workspaces").one({ id: workspace.id }))!;
    expect(row).toMatchObject({ profile_source: "self_declared", passport_org_id: null, legal_name: "Lakeside Pantry Inc." });
    const ev = (await h.ledger.list({ workspaceId: workspace.id })).find((e) => e.eventType === "workspace.profile_updated")!;
    expect(ev.data).toEqual({ fields: ["address", "contactEmail", "ein", "legalName", "orgType", "website"], source: "self_declared" });
    expect(JSON.stringify(ev.data)).not.toContain("lakeside");
  });

  it("still refuses a Passport organization id, and a profile that is not organization facts", async () => {
    expect((await create(person(1), { handle: "parked", passportOrgId: "0193a1c0-0000-7000-8000-0000000000a1" })).status).toBe(400);
    expect((await create(person(1), { handle: "bad-key", profile: { ...PROFILE, taxpayerNumber: "1" } })).status).toBe(400);
    expect((await create(person(1), { handle: "bad-ein", profile: { ...PROFILE, ein: "1234" } })).status).toBe(400);
    expect((await create(person(1), { handle: "bad-web", profile: { ...PROFILE, website: "http://lakeside.example" } })).status).toBe(400);
    expect((await create(person(1), { handle: "no-name", profile: { contactEmail: "a@b.example" } })).status).toBe(400);
  });

  it("caps creation per person and per network address per day, counting only workspaces made", async () => {
    // A taken handle does not use up the day.
    for (let i = 0; i < 3; i++) expect((await create(person(1), { handle: "riverbend" })).status).toBe(409);
    for (let i = 0; i < WORKSPACE_CREATION_LIMITS.perUserPerDay; i++) expect((await create(person(1), { handle: `mine-${i}` })).status).toBe(201);
    const over = await create(person(1), { handle: "one-more" });
    expect(over.status).toBe(429);
    expect(await code(over)).toBe("too_many_workspaces");
    // Someone else on another network is not affected.
    expect((await create(person(2), { handle: "elsewhere" }, "198.51.100.9")).status).toBe(201);
    // Many people behind one address reach that address's cap.
    let made = WORKSPACE_CREATION_LIMITS.perUserPerDay;
    for (let n = 10; made < WORKSPACE_CREATION_LIMITS.perAddressPerDay; n++, made++) expect((await create(person(n), { handle: `addr-${n}` })).status).toBe(201);
    expect(await code(await create(person(99), { handle: "addr-over" }))).toBe("too_many_workspaces");
    // The next day counts afresh.
    h.clock.now = new Date(h.clock.now.getTime() + 86_400_000);
    expect((await create(person(1), { handle: "next-day" })).status).toBe(201);
  });
});

describe("the self-declared profile", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await harness();
    // USER_OFFICER is already an editor of the applicant workspace in the harness.
    await h.repos.table("workspace_members").insert({ workspace_id: WS_APPLICANT, user_id: USER_APPLICANT, role: "admin" });
  });
  const as = async (user: string) => ({ ...bearer(await h.session(user)).headers, "X-GMS-Workspace": WS_APPLICANT });
  const patch = async (user: string, body: unknown) => h.request(`/gms/workspaces/${WS_APPLICANT}/profile`, json(await as(user), body, "PATCH"));

  it("lets an admin start and edit it as a merge patch; null removes a field", async () => {
    expect((await patch(USER_APPLICANT, { contactEmail: "a@b.example" })).status).toBe(422);
    const first = await data<{ source: string; selfDeclared: Record<string, unknown> }>(await patch(USER_APPLICANT, { legalName: "Lakeside Pantry Inc.", mission: "Food for every family." }));
    expect(first).toMatchObject({ source: "self_declared", selfDeclared: { legalName: "Lakeside Pantry Inc.", mission: "Food for every family." } });
    const second = await data<{ selfDeclared: Record<string, unknown> }>(await patch(USER_APPLICANT, { mission: null, contactEmail: "office@lakeside.example" }));
    expect(second.selfDeclared).toEqual({ legalName: "Lakeside Pantry Inc.", contactEmail: "office@lakeside.example" });
    const events = (await h.ledger.list({ workspaceId: WS_APPLICANT })).filter((e) => e.eventType === "workspace.profile_updated").map((e) => e.data);
    expect(events).toEqual([{ fields: ["legalName", "mission"], source: "self_declared" }, { fields: ["contactEmail", "mission"], source: "self_declared" }]);
  });

  it("is for admins only", async () => {
    expect((await patch(USER_OFFICER, { legalName: "Mine now" })).status).toBe(403);
  });

  it("is refused for a Passport workspace: its record is edited in Passport", async () => {
    await h.repos.table("workspaces").update({ id: WS_APPLICANT }, { passport_org_id: "0193a1c0-0000-7000-8000-0000000000a1", profile_source: "passport" });
    const res = await patch(USER_APPLICANT, { legalName: "Renamed" });
    expect(res.status).toBe(409);
    expect(await code(res)).toBe("profile_from_passport");
  });

  it("is replaced by the Passport record when the workspace links, with the differing fields ledgered", async () => {
    await patch(USER_APPLICANT, { legalName: "Lakeside Pantry", contactEmail: "office@lakeside.example", ein: "123456789" });
    const ws = (await h.repos.table("workspaces").one({ id: WS_APPLICANT }))!;
    const base = { repos: h.repos, ledger: h.ledger, webhooks: h.webhooks, now: () => h.clock.now, config: { baseUrl: "", webBaseUrl: "", passportBaseUrl: null, credentialsKey: null, passportClient: null, mailFrom: null }, ports: {} };
    const ctx = { ...base, actor: { kind: "user" as const, userId: USER_APPLICANT, clientId: null, ledger: { kind: "user" as const, userId: USER_APPLICANT }, id: `user:${USER_APPLICANT}` }, workspace: null, scopes: [] };
    const cols = await replaceProfileWithPassport(ctx, ws, { name: "Lakeside Pantry Inc.", emails: { primary: "office@lakeside.example" }, identifiers: { "org:us:ein": { id: "123456789" } } });
    expect(cols).toEqual({ profile_source: "passport", self_declared_profile: null });
    const ev = (await h.ledger.list({ workspaceId: WS_APPLICANT })).find((e) => e.eventType === "workspace.profile_replaced_by_passport")!;
    expect(ev.data).toEqual({ fieldsDiffered: ["legalName"] });
  });
});

describe("facts, verification and letters", () => {
  const row = (over: Record<string, unknown>) => ({ id: WS_APPLICANT, passport_org_id: null, profile_source: "none", self_declared_profile: null, verification_level: null, org_projection: null, profile_projection: null, ...over }) as never;

  it("builds a CommonGrants-shaped organization from the profile, with nothing of Passport's", () => {
    const f = orgFacts(row({ profile_source: "self_declared", self_declared_profile: { legalName: "Lakeside", ein: "123456789", address: { region: "OR" } } }));
    expect(f).toMatchObject({ source: "self_declared", level: null, profile: null, attestationUrl: null });
    expect(f.org).toEqual({ name: "Lakeside", identifiers: { "org:us:ein": { id: "123456789" } }, addresses: { primary: { stateOrProvince: "OR" } } });
  });

  it("never reports a level for anything not from Passport", () => {
    expect(verificationOf(row({ verification_level: "L3" }))).toEqual({ source: "none", level: null });
    expect(verificationOf(row({ passport_org_id: "0193a1c0-0000-7000-8000-0000000000a1", profile_source: "passport", verification_level: "L2" }))).toEqual({ source: "passport", level: "L2" });
  });

  it("writes to the Passport email, else the workspace's admins; never to a self-declared contact address (NP-01)", async () => {
    const h = await harness();
    await h.repos.table("workspace_members").insert({ workspace_id: WS_APPLICANT, user_id: USER_ADMIN, role: "admin" });
    const ctx = { repos: h.repos, ports: { directory: h.directory }, now: () => h.clock.now };
    expect(await recipientEmails(ctx, row({ passport_org_id: "0193a1c0-0000-7000-8000-0000000000a1", profile_source: "passport", org_projection: { emails: { primary: "grants@alder.example" } } }))).toEqual(["grants@alder.example"]);
    expect(await recipientEmails(ctx, row({ profile_source: "self_declared", self_declared_profile: { legalName: "L", contactEmail: "office@lakeside.example" } }))).toEqual(["helen.ortiz@riverbendcf.example"]);
    expect(await recipientEmails(ctx, row({}))).toEqual(["helen.ortiz@riverbendcf.example"]);
    // A stale projection on a workspace without a Passport organization is not a Passport address.
    expect(await recipientEmails(ctx, row({ org_projection: { emails: { primary: "stale@alder.example" } } }))).toEqual(["helen.ortiz@riverbendcf.example"]);
  });
});

describe("applying without Passport", () => {
  let h: Harness;
  let s: Scenario;
  beforeEach(async () => {
    h = await harness();
    s = await scenario(h);
    // The scenario's applicant is set up without Passport instead.
    await h.repos.table("workspaces").update({ id: WS_APPLICANT }, { passport_org_id: null, org_projection: null, profile_projection: null, verification_level: null, profile_source: "self_declared", self_declared_profile: { legalName: "Lakeside Pantry Inc.", contactEmail: "office@lakeside.example", address: { region: "OR" } } });
  });
  const start = () => s.call<{ data: { formResponses: Record<string, { response: Record<string, unknown>; customFields: { gms: { value: { provenance: Record<string, string> } } } }>; customFields: { gms: { value: { eligibility: { eligible: unknown; results: { outcome: string; selfReported?: boolean }[] } } } } } }>(s.applicant, "POST", "/common-grants/applications/start", { competitionId: s.uuid.comp });
  const setOptions = (publish: Record<string, boolean>, eligibilityRules?: unknown) => s.call(s.funder, "PATCH", `/gms/opportunities/${s.oppId}`, { publish, ...(eligibilityRules ? { eligibilityRules } : {}) });

  it("prefills from the profile, marks it as entered by the applicant and leaves it editable", async () => {
    const res = await start();
    expect(res.status).toBe(201);
    const loi = res.body.data.formResponses[s.uuid.loi]!;
    expect(loi.response.legalName).toBe("Lakeside Pantry Inc.");
    expect(loi.customFields.gms.value.provenance["/legalName"]).toBe("self_declared");
    const appId = (res.body.data as unknown as { id: string }).id;
    const put = await s.call<{ data: { response: Record<string, unknown>; customFields: Record<string, unknown> } }>(s.applicant, "PUT", `/common-grants/applications/${appId}/forms/${s.uuid.loi}`, { response: { legalName: "Lakeside Pantry" } });
    expect(put.body.data.response.legalName).toBe("Lakeside Pantry");
    expect(put.body.data.customFields.gmsRejected).toBeUndefined();
  });

  it("holds eligibility for review on self-reported facts unless the funder accepts them; Passport-only rules need review", async () => {
    const region = { path: "org.addresses.primary.stateOrProvince", op: "in", value: ["OR"], label: "Serves the region" };
    expect((await setOptions({}, region)).status).toBe(200);
    let e = (await start()).body.data.customFields.gms.value.eligibility;
    expect(e.eligible).toBe("unknown");
    expect(e.results[0]).toMatchObject({ outcome: "unknown", selfReported: true });

    await h.repos.table("applications").remove({ applicant_workspace_id: WS_APPLICANT });
    await setOptions({ acceptSelfReported: true });
    e = (await start()).body.data.customFields.gms.value.eligibility;
    expect(e.eligible).toBe(true);

    await h.repos.table("applications").remove({ applicant_workspace_id: WS_APPLICANT });
    await setOptions({}, { path: "org.addresses.primary.stateOrProvince", op: "in", value: ["WA"] });
    expect((await start()).body.data.customFields.gms.value.eligibility.eligible).toBe(false);

    await h.repos.table("applications").remove({ applicant_workspace_id: WS_APPLICANT });
    await setOptions({}, { path: "org.customFields.verificationLevel.value", op: "gte", value: "L2", order: ["L0", "L1", "L2", "L3"], missing: "pass" });
    expect((await start()).body.data.customFields.gms.value.eligibility.eligible).toBe("unknown");
  });

  it("sends the acknowledgment to the admins, never to the self-declared contact address (NP-01)", async () => {
    await h.repos.table("workspaces").update({ id: WS_APPLICANT }, { self_declared_profile: { legalName: "Lakeside Pantry Inc.", contactEmail: "victim@thirdparty.example", address: { region: "OR" } } });
    h.directory.users.set(USER_APPLICANT, { email: "maria@lakeside.example", name: "Maria" });
    const app = (await start()).body.data as unknown as { id: string };
    await s.call(s.applicant, "PUT", `/common-grants/applications/${app.id}/forms/${s.uuid.loi}`, { response: { projectTitle: "CLICK http://evil.example to claim", requestedAmount: { amount: "1000.00", currency: "USD" } } });
    const sub = await s.call(s.applicant, "PUT", `/common-grants/applications/${app.id}/submit`);
    expect(sub.status).toBe(200);
    const to = h.mailer.sent.flatMap((m) => m.to);
    expect(to).not.toContain("victim@thirdparty.example");
    expect(to).toContain("maria@lakeside.example");
  });

  it("refuses to start when the opportunity requires Passport, with a plain message", async () => {
    const opts = await s.call<{ data: { applicantOptions: unknown } }>(s.funder, "PATCH", `/gms/opportunities/${s.oppId}`, { publish: { requirePassport: true } });
    expect(opts.body.data.applicantOptions).toEqual({ requirePassport: true, acceptSelfReported: false });
    const res = await start();
    expect(res.status).toBe(403);
    expect((res.body as unknown as { errors: { code: string; detail?: string }[] }).errors[0]!.code).toBe("passport_required");
  });

  it("shows the funder the applicant as not verified", async () => {
    const res = await start();
    const appId = (res.body.data as unknown as { id: string }).id;
    await h.repos.table("applications").update({ id: appId }, { submitted_at: h.clock.now.toISOString(), status: "submitted" });
    const list = await s.call<{ items: { applicant: { verification: unknown } }[] }>(s.funder, "GET", "/gms/applications");
    expect(list.body.items[0]!.applicant.verification).toEqual({ source: "self_declared", level: null });
    void WS_FUNDER;
  });
});

describe("GET /gms/config", () => {
  it("says which Passport features this server can offer", async () => {
    const h = await harness();
    const read = async () => (await data<{ passport: unknown }>(await h.request("/gms/config"))).passport;
    expect(await read()).toEqual({ signIn: true, linking: true, payments: true });
    h.env.PAYMENTS_FACILITATED = "false";
    expect(await read()).toEqual({ signIn: true, linking: true, payments: false });
    delete h.env.PASSPORT_GMS_CLIENT_SECRET;
    expect(await read()).toEqual({ signIn: false, linking: false, payments: false });
  });
});

describe("what funders and the public are told", () => {
  it("marks a funder's public page with how its organization is verified", async () => {
    const h = await harness();
    const page = async (handle: string) => data<{ funder?: { verification: unknown }; verification?: unknown }>(await h.request(`/gms/public/funders/${handle}`));
    const of = (p: { funder?: { verification: unknown }; verification?: unknown }) => p.funder?.verification ?? p.verification;
    expect(of(await page("riverbend"))).toMatchObject({ source: "passport" });
    await h.repos.table("workspaces").update({ id: "22222222-2222-4222-8222-222222222222" }, { profile_source: "self_declared", self_declared_profile: { legalName: "Cascade County", mission: "Public health.", contactEmail: "private@cascade.example" } });
    const other = await page("cascade-county");
    expect(of(other)).toEqual({ source: "self_declared", level: null });
    expect(JSON.stringify(other)).not.toContain("private@cascade.example");
  });

  it("shows a grantee's verification in the list and keeps the self-declared profile apart from the Passport record", async () => {
    const h = await harness();
    const s = await scenario(h);
    await s.call(s.applicant, "POST", "/common-grants/applications/start", { competitionId: s.uuid.comp });
    await h.repos.table("applications").update({ applicant_workspace_id: WS_APPLICANT }, { submitted_at: h.clock.now.toISOString(), status: "submitted" });
    await h.repos.table("consents").insert({ applicant_workspace_id: WS_APPLICANT, funder_workspace_id: WS_FUNDER, basis: "application", granted_at: h.clock.now.toISOString() });
    await h.repos.table("workspaces").update({ id: WS_APPLICANT }, { passport_org_id: null, org_projection: null, profile_source: "self_declared", self_declared_profile: { legalName: "Lakeside Pantry Inc." } });
    const list = await s.call<{ items: { verification: unknown }[] }>(s.funder, "GET", "/gms/grantees");
    expect(list.body.items[0]!.verification).toEqual({ source: "self_declared", level: null });
    const detail = await s.call<{ data: { organization: unknown; selfDeclared: unknown } }>(s.funder, "GET", `/gms/grantees/${WS_APPLICANT}`);
    expect(detail.body.data).toMatchObject({ organization: null, selfDeclared: { legalName: "Lakeside Pantry Inc." } });
  });
});
