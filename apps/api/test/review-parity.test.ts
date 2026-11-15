// SPDX-License-Identifier: AGPL-3.0-only
// Review parity (v1.8.0): the competition's conflict-of-interest policy that every reviewer signs
// before anything in the competition opens for them; the conflicts register; anonymized review
// (one test per route a reviewer can reach); and the board docket PDF.
import { inflateSync } from "node:zlib";
import { constants } from "node:zlib";
import { APPLICANT_PLACEHOLDER, DEFAULT_COI_POLICY } from "@gms/review";
import { beforeEach, describe, expect, it } from "vitest";
import { WORKSPACE_CLAIM } from "../src/auth/scopes.ts";
import { CLIENT_AGENT, USER_ADMIN, USER_AUDITOR, USER_OFFICER, WS_APPLICANT, WS_FUNDER, bearer, clientCredentialsToken, harness, type Harness } from "./helpers.ts";
import { ALDER_ORG, scenario, type Scenario } from "./scenario.ts";
import { signCoiPolicy } from "./coi.ts";

const R1 = "c0a00000-0000-4000-8000-000000000001";
const R2 = "c0a00000-0000-4000-8000-000000000002";
const EXT = "c0a00000-0000-4000-8000-000000000003";

let h: Harness;
let s: Scenario;
let r1: Record<string, string>;
let r2: Record<string, string>;
let appA: string; // bare uuid
let appB: string;
let compUuid: string;

const headers = async (user: string, ws = WS_FUNDER) => ({ ...bearer(await h.session(user)).headers, "X-GMS-Workspace": ws, "Content-Type": "application/json" });
const data = async <T>(who: Record<string, string>, method: string, path: string, body?: unknown): Promise<T> => {
  const r = await s.call<{ data: T }>(who, method, path, method === "GET" ? undefined : (body ?? {}));
  if (r.status >= 300) throw new Error(`${method} ${path} -> ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.data;
};
const ledger = (type: string) => h.ledger.events.filter((e) => e.eventType === type);

/** Anything that would say who applied, in any case: the names, the website and email domain, the EIN. */
const IDENTITY = /alder|aldercreekfs|001234567|00-1234567|0193a1c0-0000-7000-8000-0000000000a1/i;
const shows = (x: unknown) => IDENTITY.test(JSON.stringify(x));

const NEED = "Alder Creek Family Services has run the valley's only clinic since 1998. Our annual report is at https://www.aldercreekfs.example/report, or write to info@aldercreekfs.example. EIN 00-1234567.";

/** The first application goes through the protocol routes; later ones (one per applicant per competition) are copies with their own answers. */
async function submit(projectTitle: string, need: string): Promise<string> {
  const first = (await h.repos.table("applications").find({ competition_id: s.uuid.comp }))[0];
  if (first) {
    const { id: _id, created_at: _c, updated_at: _u, ...copy } = first;
    const app = await h.repos.table("applications").insert({ ...copy, title: projectTitle, requested_amount_minor: 9_000_000 });
    const resp = (await h.repos.table("form_responses").one({ application_id: first.id }))!;
    const { id: _rid, created_at: _rc, updated_at: _ru, ...r } = resp;
    await h.repos.table("form_responses").insert({ ...r, application_id: app.id, response: { legalName: "Alder Creek Family Services", projectTitle, requestedAmount: { amount: "90000.00", currency: "USD" }, need } as never });
    return app.id;
  }
  const started = await s.call<{ data: { id: string } }>(s.applicant, "POST", "/common-grants/applications/start", { competitionId: s.uuid.comp });
  const id = started.body.data.id;
  await s.call(s.applicant, "PUT", `/common-grants/applications/${id}/forms/${s.uuid.loi}`, { response: { projectTitle, requestedAmount: { amount: "150000.00", currency: "USD" }, need } });
  expect((await s.call(s.applicant, "PUT", `/common-grants/applications/${id}/submit`)).status).toBe(200);
  return id;
}
const assign = async (appUuid: string, reviewer: string) => (await data<{ id: string }>(s.funder, "POST", "/gms/review-assignments", { applicationId: `app_${appUuid}`, reviewerUserId: reviewer })).id;
const sign = (who: Record<string, string>, body: Record<string, unknown> = {}) => s.call<{ data: Record<string, unknown>; message: string; errors?: { code: string }[] }>(who, "POST", `/gms/competitions/${s.compId}/coi-policy/sign`, { policyVersion: 1, signedName: "Morgan Reviewer", agree: true, ...body });
const anonymize = (on = true, extra: Record<string, unknown> = {}) => data(s.funder, "PUT", `/gms/competitions/${s.compId}/review-settings`, { stage: "loi", anonymized: on, ...extra });

beforeEach(async () => {
  h = await harness();
  s = await scenario(h);
  compUuid = s.uuid.comp;
  // The organization's website, so the domain is something to hide.
  await h.repos.table("workspaces").update({ id: WS_APPLICANT }, { org_projection: { ...ALDER_ORG, socials: { website: "https://www.aldercreekfs.example" } } });
  for (const [user, role, scope] of [[R1, "reviewer", {}], [R2, "reviewer", {}], [EXT, "external_reviewer", { competitionIds: [compUuid] }]] as const) await h.repos.table("workspace_members").insert({ workspace_id: WS_FUNDER, user_id: user, role, scope: scope as never });
  h.directory.users.set(R1, { email: "morgan@reviewers.example", name: "Morgan Reviewer" });
  h.directory.users.set(R2, { email: "riley@reviewers.example", name: "Riley Reviewer" });
  r1 = await headers(R1);
  r2 = await headers(R2);
  appA = await submit("Alder Creek Family Services: mobile health navigation", NEED);
  h.clock.now = new Date(h.clock.now.getTime() + 60_000);
  appB = await submit("Harbor outreach vans", "Two vans reach families on the coast road every week.");
  h.mailer.sent.length = 0;
});

// ------------------------------------------------------------------------------------ the COI gate

describe("the conflict-of-interest policy", () => {
  it("serves the plain-language default until the funder writes one", async () => {
    await assign(appA, R1);
    const p = await data<{ version: number; text: string; isDefault: boolean; signed: boolean; mySignature: unknown }>(r1, "GET", `/gms/competitions/${s.compId}/coi-policy`);
    expect(p).toMatchObject({ version: 1, text: DEFAULT_COI_POLICY, isDefault: true, signed: false, mySignature: null });
  });

  it("opens nothing in the competition before the reviewer signs: assignment reads say only to sign first", async () => {
    const id = await assign(appA, R1);
    const list = await data<{ id: string; applicationTitle: string | null; policyRequired: boolean; review: unknown }[]>(r1, "GET", "/gms/review-assignments");
    expect(list).toEqual([expect.objectContaining({ id, applicationTitle: null, policyRequired: true, review: null })]);
    const one = await s.call<{ message: string; errors: { code: string; detail: string }[] }>(r1, "GET", `/gms/review-assignments/${id}`);
    expect(one.status).toBe(409);
    expect(one.body.message).toMatch(/^Sign the conflict-of-interest policy first/);
    expect(one.body.errors.map((e) => e.code)).toEqual(["coi_policy_unsigned", "coi_policy_unsigned"]);
    expect(one.body.errors[1]).toMatchObject({ field: "competitionId", detail: s.compId });
    expect(JSON.stringify(one.body)).not.toMatch(/mobile health/i);
    // The application itself, on every route, and the scoring actions.
    expect((await s.call(r1, "GET", `/gms/applications/app_${appA}`)).status).toBe(404);
    expect((await s.call<{ items: unknown[] }>(r1, "GET", "/gms/applications")).body.items).toEqual([]);
    expect((await s.call(r1, "GET", `/common-grants/applications/${appA}`)).status).toBe(404);
    expect((await s.call(r1, "PATCH", `/gms/review-assignments/${id}`, { action: "declare_coi", hasConflict: false })).status).toBe(409);
    expect((await s.call(r1, "GET", `/gms/reviews?applicationId=app_${appA}`)).status).toBe(409);
    // Recusing is always open.
    expect((await s.call(r1, "PATCH", `/gms/review-assignments/${id}`, { action: "recuse", reason: "I sit on their board" })).status).toBe(200);
  });

  it("holds staff who review alongside reviewers to the same signature for their own assignments", async () => {
    const id = await assign(appA, USER_OFFICER);
    const mine = await data<{ id: string; policyRequired: boolean; applicationTitle: string | null }[]>(s.funder, "GET", `/gms/review-assignments?reviewerUserId=${USER_OFFICER}`);
    expect(mine.find((a) => a.id === id)).toMatchObject({ policyRequired: true, applicationTitle: null });
    expect((await s.call(s.funder, "GET", `/gms/review-assignments/${id}`)).status).toBe(409);
    // Staff still read the application itself, and see everyone else's assignments in full.
    expect((await s.call(s.funder, "GET", `/gms/applications/app_${appA}`)).status).toBe(200);
    await assign(appB, R1);
    expect((await data<{ reviewerUserId: string; policyRequired: boolean }[]>(s.funder, "GET", "/gms/review-assignments")).filter((a) => a.reviewerUserId === R1).every((a) => !a.policyRequired)).toBe(true);
    expect((await sign(s.funder, { signedName: "Dana Ortiz" })).status).toBe(201);
    expect((await s.call(s.funder, "GET", `/gms/review-assignments/${id}`)).status).toBe(200);
  });

  it("opens the competition once signed, records the typed name and time, and is signed once", async () => {
    const id = await assign(appA, R1);
    const signed = await sign(r1);
    expect(signed.status).toBe(201);
    expect(signed.body.data).toMatchObject({ policyVersion: 1, signedName: "Morgan Reviewer", signedAt: h.clock.now.toISOString(), current: true, alreadySigned: false });
    expect(await h.repos.table("coi_policies").count({ competition_id: compUuid })).toBe(1);
    expect(ledger("review.coi_policy_signed")).toHaveLength(1);
    expect((await s.call(r1, "GET", `/gms/review-assignments/${id}`)).status).toBe(200);
    const again = await sign(r1);
    expect(again.status).toBe(200);
    expect(again.body.data.alreadySigned).toBe(true);
    expect(await h.repos.table("coi_signatures").count({ competition_id: compUuid })).toBe(1);
  });

  it("asks reviewers to sign again when the funder changes the policy, and refuses a stale version", async () => {
    const id = await assign(appA, R1);
    await sign(r1);
    expect((await s.call(r1, "PUT", `/gms/competitions/${s.compId}/coi-policy`, { text: "A reviewer cannot write the policy." })).status).toBe(403);
    const v2 = await data<{ version: number; isDefault: boolean }>(s.funder, "PUT", `/gms/competitions/${s.compId}/coi-policy`, { text: "Our policy: declare every organization you have worked with in the last five years." });
    expect(v2).toMatchObject({ version: 2, isDefault: false });
    expect((await s.call(r1, "GET", `/gms/review-assignments/${id}`)).status).toBe(409);
    expect((await sign(r1, { policyVersion: 1 })).body.errors?.[0]?.code).toBe("policy_changed");
    expect((await sign(r1, { policyVersion: 2 })).status).toBe(201);
    expect((await s.call(r1, "GET", `/gms/review-assignments/${id}`)).status).toBe(200);
  });

  it("can be signed only by the person, never by an agent or an API client", async () => {
    await assign(appA, R1);
    const agent = await h.forge({ sub: R1, client_id: CLIENT_AGENT, scope: "reviews:read reviews:write applications:read", [WORKSPACE_CLAIM]: WS_FUNDER, jti: "tok-reviewer-agent" });
    const byAgent = await sign({ ...bearer(agent).headers, "Content-Type": "application/json" });
    expect(byAgent.status).toBe(403);
    expect(byAgent.body.errors?.[0]?.code).toBe("person_required");
    const client = await clientCredentialsToken(h, "reviews:write");
    expect([401, 403]).toContain((await sign({ ...bearer(client).headers, "Content-Type": "application/json" })).status);
    expect(await h.repos.table("coi_signatures").count({ competition_id: compUuid })).toBe(0);
    // No MCP tool signs either.
    const tools = await h.request("/mcp", { method: "POST", headers: { ...bearer(agent).headers, "Content-Type": "application/json", Accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
    const names = ((await tools.json()) as { result: { tools: { name: string }[] } }).result.tools.map((t) => t.name);
    expect(names).toContain("get_conflicts_register");
    expect(names.filter((n) => /(^|_)sign(_|$)/.test(n))).toEqual([]);
  });

  it("feeds declared conflicts into the assignment exclusion and recuses what the reviewer already holds, without saying who applied", async () => {
    const id = await assign(appA, R1);
    const signed = await sign(r1, { conflicts: [{ name: "alder creek family services, inc." }, { name: "Some Other Group" }] });
    // The answer echoes what was typed, never which of it applied.
    expect(signed.body.data).not.toHaveProperty("matched");
    expect(JSON.stringify(signed.body)).not.toMatch(/workspaceId|a1a1/i);
    expect((await h.repos.table("coi_signatures").one({ reviewer_user_id: R1 }))!.declared_org_ids).toEqual([WS_APPLICANT]);
    const row = (await h.repos.table("review_assignments").one({ id }))!;
    expect(row).toMatchObject({ status: "recused", coi: { declared: true, source: "policy" } });
    // The reviewer's own list leaves it out; a new assignment to the same organization is refused.
    expect(await data<unknown[]>(r1, "GET", "/gms/review-assignments")).toEqual([]);
    const refused = await s.call<{ errors: { code: string }[] }>(s.funder, "POST", "/gms/review-assignments", { applicationId: `app_${appB}`, reviewerUserId: R1 });
    expect(refused.status).toBe(409);
    expect(refused.body.errors.map((e) => e.code)).toEqual(["conflict_of_interest", "declared_org"]);
    // Auto-assignment skips them too.
    const plan = await data<{ assignments: { applicationId: string; reviewerUserId: string }[] }>(s.funder, "POST", "/gms/review-assignments/auto", { competitionId: s.compId, stage: "loi", reviewersPerApplication: 2, dryRun: true });
    expect(plan.assignments.some((a) => a.reviewerUserId === R1)).toBe(false);
  });
});

describe("live panels are not interrupted (competitions created before migration 0033)", () => {
  /** A competition that was reviewing when v1.8.0 arrived: 0033 set its coi_policy_required to false. */
  const existing = () => h.repos.table("competitions").update({ id: compUuid }, { coi_policy_required: false });

  it("new competitions require the policy by default", async () => {
    expect((await h.repos.table("competitions").one({ id: compUuid }))!.coi_policy_required).toBe(true);
    await assign(appA, R1);
    expect(await data<{ required: boolean }>(r1, "GET", `/gms/competitions/${s.compId}/coi-policy`)).toMatchObject({ required: true, signed: false });
  });

  it("a reviewer mid-review on an existing competition keeps opening and scoring without signing", async () => {
    await existing();
    const id = await assign(appA, R1);
    expect(await data<{ id: string; policyRequired: boolean; applicationTitle: string | null }[]>(r1, "GET", "/gms/review-assignments")).toEqual([expect.objectContaining({ id, policyRequired: false, applicationTitle: expect.stringContaining("mobile health") })]);
    expect((await s.call(r1, "GET", `/gms/review-assignments/${id}`)).status).toBe(200);
    expect((await s.call(r1, "GET", `/gms/applications/app_${appA}`)).status).toBe(200);
    expect((await s.call(r1, "GET", `/common-grants/applications/${appA}`)).status).toBe(200);
    expect((await s.call(r1, "PATCH", `/gms/review-assignments/${id}`, { action: "declare_coi", hasConflict: false })).status).toBe(200);
    expect(await data<{ required: boolean }>(r1, "GET", `/gms/competitions/${s.compId}/coi-policy`)).toMatchObject({ required: false });
    expect(await h.repos.table("coi_signatures").count({ competition_id: compUuid })).toBe(0);
  });

  it("the funder turns it on in the competition's settings; then each reviewer signs before it opens again", async () => {
    await existing();
    const id = await assign(appA, R1);
    expect((await s.call(r1, "GET", `/gms/review-assignments/${id}`)).status).toBe(200);
    // A reviewer cannot change it, and neither can an agent or an API client acting for staff.
    expect((await s.call(r1, "PUT", `/gms/competitions/${s.compId}/coi-policy`, { required: true })).status).toBe(403);
    const agent = await h.forge({ sub: USER_ADMIN, client_id: CLIENT_AGENT, scope: "reviews:read reviews:write", [WORKSPACE_CLAIM]: WS_FUNDER, jti: "tok-coi-required-agent" });
    const byAgent = await s.call<{ errors: { code: string }[] }>({ ...bearer(agent).headers, "Content-Type": "application/json" }, "PUT", `/gms/competitions/${s.compId}/coi-policy`, { required: true });
    expect(byAgent.status).toBe(403);
    expect(byAgent.body.errors[0]?.code).toBe("human_only");
    const client = await clientCredentialsToken(h, "reviews:write");
    expect([401, 403]).toContain((await s.call({ ...bearer(client).headers, "Content-Type": "application/json" }, "PUT", `/gms/competitions/${s.compId}/coi-policy`, { required: true })).status);
    expect((await h.repos.table("competitions").one({ id: compUuid }))!.coi_policy_required).toBe(false);

    const on = await data<{ required: boolean; version: number }>(s.funder, "PUT", `/gms/competitions/${s.compId}/coi-policy`, { required: true });
    expect(on).toMatchObject({ required: true, version: 1 });
    expect(ledger("competition.coi_policy_required_set").map((e) => e.data)).toEqual([expect.objectContaining({ required: true })]);
    expect((await s.call(r1, "GET", `/gms/review-assignments/${id}`)).status).toBe(409);
    expect((await sign(r1)).status).toBe(201);
    expect((await s.call(r1, "GET", `/gms/review-assignments/${id}`)).status).toBe(200);
    // Turning it off again opens the competition to reviewers who have not signed.
    await assign(appA, R2);
    expect((await data<{ policyRequired: boolean }[]>(r2, "GET", "/gms/review-assignments"))[0]!.policyRequired).toBe(true);
    await data(s.funder, "PUT", `/gms/competitions/${s.compId}/coi-policy`, { required: false });
    expect((await data<{ policyRequired: boolean }[]>(r2, "GET", "/gms/review-assignments"))[0]!.policyRequired).toBe(false);
  });

  it("a text change and the switch can go together, and an empty change is refused", async () => {
    await existing();
    const both = await data<{ required: boolean; version: number; isDefault: boolean }>(s.funder, "PUT", `/gms/competitions/${s.compId}/coi-policy`, { text: "Declare every organization you have worked with in the last five years.", required: true });
    expect(both).toMatchObject({ required: true, version: 1, isDefault: false });
    expect((await s.call(s.funder, "PUT", `/gms/competitions/${s.compId}/coi-policy`, {})).status).toBe(400);
  });
});

describe("the conflicts register", () => {
  it("shows staff who signed and when, the declared conflicts with their matches, and recusals with reasons; it downloads as CSV", async () => {
    await assign(appA, R1);
    await assign(appB, R2);
    await sign(r1, { conflicts: [{ name: "Alder Creek Family Services" }, { name: "=HYPERLINK(\"http://x.example\")", website: "x.example" }] });
    await data(r2, "PATCH", `/gms/review-assignments/${(await h.repos.table("review_assignments").one({ reviewer_user_id: R2 }))!.id}`, { action: "recuse", reason: "Former employer" }).catch(() => undefined);
    const reg = await data<{ counts: Record<string, number>; reviewers: { userId: string; signed: boolean; signature: { signedName: string; signedAt: string; declared: { name: string; matches: { name: string }[] }[] } | null }[]; recusals: { reviewerUserId: string; source: string; reason: string; applicant: string }[] }>(s.funder, "GET", `/gms/competitions/${s.compId}/conflicts-register`);
    const morgan = reg.reviewers.find((r) => r.userId === R1)!;
    expect(morgan.signed).toBe(true);
    expect(morgan.signature).toMatchObject({ signedName: "Morgan Reviewer", signedAt: h.clock.now.toISOString() });
    expect(morgan.signature!.declared[0]).toEqual({ name: "Alder Creek Family Services", matches: [{ workspaceId: WS_APPLICANT, name: "Alder Creek Family Services" }] });
    expect(morgan.signature!.declared[1]!.matches).toEqual([]);
    expect(reg.reviewers.find((r) => r.userId === R2)).toMatchObject({ signed: false, signature: null });
    expect(reg.recusals).toEqual(expect.arrayContaining([expect.objectContaining({ reviewerUserId: R1, source: "declared_at_signing", reason: "Declared when signing the conflict-of-interest policy", applicant: "Alder Creek Family Services" })]));
    expect(reg.counts).toMatchObject({ signed: 1, declared: 2 });

    const csv = await h.request(`/gms/competitions/${s.compId}/conflicts-register.csv`, { headers: s.funder });
    expect(csv.status).toBe(200);
    expect(csv.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(csv.headers.get("Content-Disposition")).toMatch(/attachment; filename="conflicts-register-community-health-grants-2027\.csv"/);
    const text = await csv.text();
    expect(text.split("\r\n")[0]).toBe("Entry,Reviewer,Email,Signed name,Signed at,Policy version,Current policy,Organization declared,Website declared,Matched applicant,Application,Stage,Reason,At");
    expect(text).toContain("Signature,Morgan Reviewer,morgan@reviewers.example,Morgan Reviewer");
    expect(text).toContain("Declared conflict,Morgan Reviewer");
    expect(text).toContain("Recusal (declared at signing),Morgan Reviewer");
    expect(text).toContain("Signature,Riley Reviewer,riley@reviewers.example,,,,not signed");
    // A typed value a spreadsheet would run is neutralized.
    expect(text).toContain(`"'=HYPERLINK(""http://x.example"")"`);
  });

  it("is staff only, and reviewers see only their own signature", async () => {
    await assign(appA, R1);
    await sign(r1);
    expect((await s.call(r1, "GET", `/gms/competitions/${s.compId}/conflicts-register`)).status).toBe(403);
    expect((await s.call(r1, "GET", `/gms/competitions/${s.compId}/conflicts-register.csv`)).status).toBe(403);
    expect((await s.call(await headers(USER_AUDITOR), "GET", `/gms/competitions/${s.compId}/conflicts-register`)).status).toBe(200);
    expect((await data<{ mySignature: { signedName: string } }>(r1, "GET", `/gms/competitions/${s.compId}/coi-policy`)).mySignature.signedName).toBe("Morgan Reviewer");
    expect((await data<{ mySignature: unknown }>(r2, "GET", `/gms/competitions/${s.compId}/coi-policy`)).mySignature).toBeNull();
  });
});

// ------------------------------------------------------------------------------------ anonymized review

describe("anonymized review", () => {
  let mine: string;
  beforeEach(async () => {
    // A file reference in the answers, and the reviewers have signed.
    const resp = (await h.repos.table("form_responses").one({ application_id: appA, form_id: s.uuid.loi }))!;
    await h.repos.table("form_responses").update({ id: resp.id }, { response: { ...(resp.response as object), letter: { documentId: "0190d000-0000-7000-8000-000000000001", name: "Alder Creek support letter.pdf" } } as never });
    await signCoiPolicy(h, WS_FUNDER, compUuid, [R1, R2, EXT]);
    mine = await assign(appA, R1);
  });

  it("is off by default, a per-stage setting only program staff change", async () => {
    expect((await data<{ stages: { key: string; anonymized: boolean }[] }>(s.funder, "GET", `/gms/competitions/${s.compId}/review-settings`)).stages.map((x) => [x.key, x.anonymized])).toEqual([["loi", false], ["full", false]]);
    expect(shows(await data(r1, "GET", `/gms/applications/app_${appA}`))).toBe(true);
    expect((await s.call(r1, "PUT", `/gms/competitions/${s.compId}/review-settings`, { stage: "loi", anonymized: true })).status).toBe(403);
    expect((await s.call(s.funder, "PUT", `/gms/competitions/${s.compId}/review-settings`, { stage: "nope", anonymized: true })).status).toBe(422);
    const set = await anonymize();
    expect(set).toMatchObject({ stages: [{ key: "loi", anonymized: true, reviewMode: "blind", panelOpen: false }, { key: "full", anonymized: false }] });
    expect(ledger("competition.review_settings_set")).toHaveLength(1);
  });

  it("application detail: the code instead of the organization, identifying fields gone, free text redacted, files renamed", async () => {
    await anonymize();
    const d = await data<{ title: string; applicant: { name: string; workspaceId: string | null; handle: string | null }; anonymized: { code: string }; organization: unknown; attestationUrl: unknown; formResponses: { response: Record<string, unknown>; masked: string[] }[]; timeline: Record<string, unknown>[] }>(r1, "GET", `/gms/applications/app_${appA}`);
    expect(d.applicant).toMatchObject({ name: "Applicant A-1001", workspaceId: null, handle: null });
    expect(d.anonymized).toEqual({ code: "A-1001" });
    expect(d.organization).toBeNull();
    expect(d.attestationUrl).toBeNull();
    expect(d.title).toBe(`${APPLICANT_PLACEHOLDER}: mobile health navigation`);
    const r = d.formResponses[0]!;
    expect(r.response.legalName).toBeUndefined(); // a Passport field: identifying
    expect(r.masked).toContain("/legalName");
    // The free-text case: the organization's name, website, email and EIN become "[applicant]".
    expect(r.response.need).toBe(`${APPLICANT_PLACEHOLDER} has run the valley's only clinic since 1998. Our annual report is at ${APPLICANT_PLACEHOLDER}, or write to ${APPLICANT_PLACEHOLDER}. EIN ${APPLICANT_PLACEHOLDER}.`);
    expect(r.response.letter).toEqual({ documentId: "0190d000-0000-7000-8000-000000000001", name: "Attachment 1.pdf" });
    expect(d.timeline.every((e) => !("actor" in e))).toBe(true);
    expect(shows(d)).toBe(false);
    // Staff always see everything.
    const staff = await data<{ applicant: { name: string }; formResponses: { response: Record<string, unknown> }[] }>(s.funder, "GET", `/gms/applications/app_${appA}`);
    expect(staff.applicant.name).toBe("Alder Creek Family Services");
    expect(staff.formResponses[0]!.response.need).toBe(NEED);
  });

  it("a field the form marks identifying is hidden; a stage that is not anonymized is untouched", async () => {
    await h.repos.table("forms").update({ id: s.uuid.loi }, { field_meta: { "/projectTitle": { identifying: true } } as never });
    await anonymize();
    const d = await data<{ formResponses: { response: Record<string, unknown>; masked: string[] }[] }>(r1, "GET", `/gms/applications/app_${appA}`);
    expect(d.formResponses[0]!.response.projectTitle).toBeUndefined();
    expect(d.formResponses[0]!.masked).toContain("/projectTitle");
    await anonymize(false);
    expect((await data<{ formResponses: { response: Record<string, unknown> }[] }>(r1, "GET", `/gms/applications/app_${appA}`)).formResponses[0]!.response.projectTitle).toBe("Alder Creek Family Services: mobile health navigation");
  });

  it("the inbox list: no name, and searching for the name finds nothing", async () => {
    await anonymize();
    const list = await s.call<{ items: { id: string; title: string; applicant: { name: string } }[] }>(r1, "GET", "/gms/applications");
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0]!.applicant.name).toBe("Applicant A-1001");
    expect(shows(list.body)).toBe(false);
    expect((await s.call<{ items: unknown[] }>(r1, "GET", "/gms/applications?q=alder")).body.items).toEqual([]);
  });

  it("the CommonGrants routes and their search", async () => {
    await anonymize();
    const app = await s.call(r1, "GET", `/common-grants/applications/${appA}`);
    expect(app.status).toBe(200);
    expect(shows(app.body)).toBe(false);
    const form = await s.call(r1, "GET", `/common-grants/applications/${appA}/forms/${s.uuid.loi}`);
    expect(form.status).toBe(200);
    expect(shows(form.body)).toBe(false);
    const found = await s.call<{ items: unknown[] }>(r1, "POST", "/common-grants/applications/search", {});
    expect(found.body.items).toHaveLength(1);
    expect(shows(found.body)).toBe(false);
    expect((await s.call<{ items: unknown[] }>(r1, "POST", "/common-grants/applications/search", { search: "alder" })).body.items).toEqual([]);
  });

  it("assignments: the list and the working view", async () => {
    await anonymize();
    const list = await data<{ applicantCode: string; anonymized: boolean; applicationTitle: string }[]>(r1, "GET", "/gms/review-assignments");
    expect(list[0]).toMatchObject({ applicantCode: "A-1001", anonymized: true, applicationTitle: `${APPLICANT_PLACEHOLDER}: mobile health navigation` });
    expect(shows(list)).toBe(false);
    const view = await data<{ applicantCode: string; application: unknown }>(r1, "GET", `/gms/review-assignments/${mine}`);
    expect(view.applicantCode).toBe("A-1001");
    expect(shows(view)).toBe(false);
  });

  it("other reviewers' narratives and comments", async () => {
    await anonymize(true, { reviewMode: "open" });
    const theirs = await assign(appA, R2);
    await data(r2, "PATCH", `/gms/review-assignments/${theirs}`, { action: "declare_coi", hasConflict: false });
    await data(r2, "PATCH", `/gms/review-assignments/${theirs}`, { action: "submit", scores: { fit: { value: 4, comment: "Alder Creek knows the valley." } }, narrative: "I have visited Alder Creek Family Services; strong team." });
    const reviews = await data<{ own: boolean; narrative: string; scores: Record<string, { comment: string }> }[]>(r1, "GET", `/gms/reviews?applicationId=app_${appA}`);
    const other = reviews.find((r) => !r.own)!;
    expect(other.narrative).toBe(`I have visited ${APPLICANT_PLACEHOLDER}; strong team.`);
    expect(other.scores.fit!.comment).toBe(`${APPLICANT_PLACEHOLDER} knows the valley.`);
    expect(shows(reviews)).toBe(false);
  });

  it("the ranking, the panel, attachments and threads stay closed to reviewers", async () => {
    await anonymize();
    expect((await s.call(r1, "GET", `/gms/competitions/${s.compId}/ranking`)).status).toBe(403);
    expect((await s.call(r1, "GET", `/gms/competitions/${s.compId}/panel-summary`)).status).toBe(403);
    expect((await s.call(r1, "GET", `/gms/competitions/${s.compId}/notes`)).status).toBe(403);
    expect((await s.call(r1, "GET", `/gms/applications/app_${appA}/budget`)).status).toBe(404);
    expect((await s.call(r1, "GET", `/gms/my/applications/app_${appA}/attachments`)).status).toBe(404);
    expect((await s.call(r1, "GET", `/gms/threads?subjectType=application&subjectId=${appA}`)).status).toBe(404);
    // Staff ranking names the applicant, as it always did.
    expect(shows(await data(s.funder, "GET", `/gms/competitions/${s.compId}/ranking`))).toBe(true);
  });

  it("notifications: no in-app notice names the applicant, and a thread message is never mailed to a reviewer", async () => {
    await anonymize();
    const thread = await data<{ id: string }>(s.applicant, "POST", "/gms/threads", { subjectId: `app_${appA}`, visibility: "shared" });
    h.mailer.sent.length = 0;
    await data(s.applicant, "POST", `/gms/threads/${thread.id}/messages`, { body: "Alder Creek Family Services here: a question about the budget." });
    const to = h.mailer.sent.flatMap((m) => m.to);
    expect(to).toContain("helen.ortiz@riverbendcf.example");
    expect(to).not.toContain("morgan@reviewers.example");
    expect(to).not.toContain("riley@reviewers.example");
    const notes = await data(r1, "GET", "/gms/notifications");
    expect(shows(notes)).toBe(false);
  });

  it("the assistant's context", async () => {
    await anonymize();
    h.env.ASSISTANT_ENABLED = "true";
    h.llmAnswer.value = { summary: "A clinic outreach plan.", strengths: [], openQuestions: [], quotes: [], fromExternalSystems: [], cautions: [] };
    const r = await s.call(r1, "POST", "/gms/assist/summarize", { applicationId: `app_${appA}` });
    expect(r.status).toBe(200);
    const prompt = h.llm.requests.at(-1)!;
    expect(IDENTITY.test(prompt.system + prompt.user)).toBe(false);
    expect(prompt.user).toContain(APPLICANT_PLACEHOLDER);
  });

  it("MCP: the same service layer, the same view", async () => {
    await anonymize();
    const agent = await h.forge({ sub: R1, client_id: CLIENT_AGENT, scope: "applications:read reviews:read", [WORKSPACE_CLAIM]: WS_FUNDER, jti: "tok-reviewer-mcp" });
    let seq = 0;
    const tool = async (name: string, args: Record<string, unknown>) => {
      const res = await h.request("/mcp", { method: "POST", headers: { ...bearer(agent).headers, "Content-Type": "application/json", Accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++seq, method: "tools/call", params: { name, arguments: args } }) });
      return ((await res.json()) as { result: { structuredContent: unknown; content: { text: string }[]; isError: boolean } }).result;
    };
    const one = await tool("get_application", { applicationId: `app_${appA}` });
    expect(one.isError).toBe(false);
    expect(JSON.stringify(one)).toContain("Applicant A-1001");
    expect(shows(one)).toBe(false);
    const list = await tool("list_applications", {});
    expect(shows(list)).toBe(false);
    const assignments = await tool("list_review_assignments", {});
    expect(shows(assignments)).toBe(false);
    expect((await tool("rank_applications", { competitionId: s.compId })).isError).toBe(true);
    // The resource reads through the same functions.
    const res = await h.request("/mcp", { method: "POST", headers: { ...bearer(agent).headers, "Content-Type": "application/json", Accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 99, method: "resources/read", params: { uri: `gms://application/${appA}` } }) });
    expect(shows(await res.json())).toBe(false);
  });

  it("an external reviewer is anonymized too, and codes are stable per competition", async () => {
    await anonymize();
    await assign(appB, EXT);
    const ext = await headers(EXT);
    const d = await data<{ applicant: { name: string } }>(ext, "GET", `/gms/applications/app_${appB}`);
    expect(d.applicant.name).toBe("Applicant A-1002");
    expect(shows(d)).toBe(false);
    // A later application does not move the codes of earlier ones.
    h.clock.now = new Date(h.clock.now.getTime() + 60_000);
    await submit("A third plan", "More vans.");
    expect((await data<{ applicant: { name: string } }>(r1, "GET", `/gms/applications/app_${appA}`)).applicant.name).toBe("Applicant A-1001");
  });

  it("the advanced stage counts: an application whose current stage is anonymized is anonymized for its reviewers", async () => {
    await data(s.funder, "PUT", `/gms/competitions/${s.compId}/review-settings`, { stage: "full", anonymized: true });
    await h.repos.table("applications").update({ id: appA }, { stage: "full" });
    expect(shows(await data(r1, "GET", `/gms/applications/app_${appA}`))).toBe(false);
  });
});

// ------------------------------------------------------------------------------------ the board docket

/** The text a PDF draws: the standard fonts write hex strings in Flate-compressed content streams. */
function pdfText(bytes: Uint8Array): string {
  const buf = Buffer.from(bytes);
  const out: string[] = [];
  let i = 0;
  while ((i = buf.indexOf("stream", i)) !== -1) {
    let start = i + 6;
    if (buf[start] === 0x0d) start++;
    if (buf[start] === 0x0a) start++;
    const end = buf.indexOf("endstream", start);
    if (end < 0) break;
    try {
      const txt = inflateSync(buf.subarray(start, end), { finishFlush: constants.Z_SYNC_FLUSH }).toString("latin1");
      for (const m of txt.matchAll(/<([0-9A-Fa-f]*)>\s*Tj/g)) out.push(Buffer.from(m[1]!, "hex").toString("latin1"));
    } catch {
      // Not a content stream.
    }
    i = end + 9;
  }
  return out.join("\n");
}

describe("the board docket", () => {
  beforeEach(async () => {
    await signCoiPolicy(h, WS_FUNDER, compUuid, [R1, R2]);
    for (const [who, user, narrative, visibility] of [[r1, R1, "Strong plan; the panel should fund it.", "panel"], [r2, R2, "PRIVATE NOTE for staff: budget looks padded. EIN 12-3456789.", "funder_only"]] as const) {
      const id = await assign(appA, user);
      await data(who, "PATCH", `/gms/review-assignments/${id}`, { action: "declare_coi", hasConflict: false });
      await data(who, "PATCH", `/gms/review-assignments/${id}`, { action: "submit", scores: { fit: { value: user === R1 ? 5 : 3, comment: user === R1 ? "Fits the program well." : "STAFF ONLY comment." } }, narrative, recommendation: "fund", visibility });
    }
    await data(s.funder, "POST", "/gms/decisions/propose", { competitionId: s.compId, decisions: [{ applicationId: `app_${appA}`, outcome: "approve", amountMinor: 12_000_000 }] });
  });

  const build = async (body: Record<string, unknown> = {}) => {
    const made = await s.call<{ data: { docketId: string; downloadPath: string; applications: number; sha256: string; includeFunderOnlyComments: boolean } }>(s.funder, "POST", `/gms/competitions/${s.compId}/dockets`, body);
    expect(made.status).toBe(201);
    const res = await h.request(made.body.data.downloadPath, { headers: s.funder });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(res.headers.get("X-Content-SHA256")).toBe(made.body.data.sha256);
    // Lines of a paragraph are drawn one by one; read the text as one run of words.
    return { meta: made.body.data, text: pdfText(bytes).replace(/\s+/g, " ") };
  };

  it("has a cover, the summary table and a page per application, without funder-only comments by default", async () => {
    const { meta, text } = await build();
    expect(meta).toMatchObject({ applications: 2, includeFunderOnlyComments: false });
    expect(text).toContain("Board docket");
    expect(text).toContain("Community Health Grants 2027");
    for (const col of ["Applicant", "Request", "Recommended", "Average score", "Recommendation"]) expect(text).toContain(col);
    expect(text).toContain("Alder Creek Family Services");
    expect(text).toContain("$150,000");
    expect(text).toContain("$120,000");
    expect(text).toContain("Approve (proposed)");
    expect(text).toContain("Scores by criterion");
    expect(text).toContain("Strong plan; the panel should fund it.");
    expect(text).toContain("Fits the program well.");
    expect(text).toContain("Reviewer 1");
    expect(text).not.toContain("PRIVATE NOTE");
    expect(text).not.toContain("STAFF ONLY");
    expect(text).toContain("comments marked for program staff only are not included");
    // Reviewers are not named; nothing the form marks identifying or personal is printed.
    expect(text).not.toContain("Morgan");
    expect(text).not.toContain("001234567");
    // Stored under the workspace in the EXPORTS bucket.
    expect([...h.exportFiles.files.keys()]).toEqual([`exports/${WS_FUNDER}/dockets/${compUuid}/${meta.docketId}.pdf`]);
    expect(ledger("competition.docket_created")).toHaveLength(1);
  });

  it("includes funder-only comments only when asked, and never a number that could identify someone", async () => {
    const { text } = await build({ includeFunderOnlyComments: true });
    expect(text).toContain("PRIVATE NOTE for staff: budget looks padded. EIN [number removed].");
    expect(text).toContain("STAFF ONLY comment.");
    expect(text).toContain("(funder only)");
    expect(text).not.toContain("12-3456789");
  });

  it("prints a picked set of applications", async () => {
    const { meta, text } = await build({ applicationIds: [`app_${appB}`] });
    expect(meta.applications).toBe(1);
    expect(text).toContain("Harbor outreach vans");
    expect(text).not.toContain("mobile health navigation");
  });

  it("is for funder staff only, kept private, and needs the EXPORTS bucket", async () => {
    expect((await s.call(r1, "POST", `/gms/competitions/${s.compId}/dockets`, {})).status).toBe(403);
    expect((await s.call(await headers(USER_AUDITOR), "POST", `/gms/competitions/${s.compId}/dockets`, {})).status).toBe(403);
    const { meta } = await build();
    expect((await s.call(r1, "GET", `/gms/competitions/${s.compId}/dockets/${meta.docketId}`)).status).toBe(403);
    expect((await h.request(`/gms/competitions/${s.compId}/dockets/${meta.docketId}`)).status).toBe(401);
    expect((await s.call(await headers(USER_ADMIN), "GET", `/gms/competitions/${s.compId}/dockets/00000000-0000-4000-8000-000000000000`)).status).toBe(404);
    h.withoutPorts.add("exportFiles");
    expect((await s.call(s.funder, "POST", `/gms/competitions/${s.compId}/dockets`, {})).status).toBe(503);
    void USER_OFFICER;
  });
});
