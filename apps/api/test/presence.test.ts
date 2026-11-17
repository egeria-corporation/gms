// SPDX-License-Identifier: AGPL-3.0-only
// Live co-editing (F1): the pass to a draft's live channel. Only the people who may open the draft
// get one, through the same check that opens it: the applicant's team and the consultants or
// cowriters it names. The funder, its reviewers, another workspace, agents and API clients do not,
// so they can neither join the channel nor receive its updates (the realtime policies of migration
// 0050 admit a session only with a live pass: supabase/tests/database/50_co_editing.test.sql).
import { beforeEach, describe, expect, it } from "vitest";
import { SCOPES, WORKSPACE_CLAIM, scopesForRole } from "../src/auth/scopes.ts";
import { PRESENCE_PASS_RENEW_MS, PRESENCE_PASS_TTL_MS } from "../src/services/presence.ts";
import { CLIENT_AGENT, USER_ADMIN, USER_OFFICER, WS_APPLICANT, WS_FUNDER, WS_OTHER, harness, type Harness } from "./helpers.ts";
import { USER_APPLICANT, USER_APPLICANT_EDITOR, scenario, type Scenario } from "./scenario.ts";

const VIEWER = "71717171-7171-4717-8717-717171717171";
const CONSULTANT = "72727272-7272-4727-8727-727272727272";
const COWRITER = "73737373-7373-4737-8737-737373737373";
const STRANGER = "74747474-7474-4747-8747-747474747474";
const REVIEWER = "75757575-7575-4757-8757-757575757575";
const sid = (n: number) => `5e550000-0000-4000-8000-${String(n).padStart(12, "0")}`;

let h: Harness;
let s: Scenario;
let appId: string;
let appUuid: string;
let oaId: string;
let otherOa: string;

async function as(user: string, ws: string, sessionId: string | null = sid(1)) {
  const token = await h.session(user, sessionId ? { sessionId } : {});
  return { Authorization: `Bearer ${token}`, "X-GMS-Workspace": ws, "Content-Type": "application/json" };
}
async function pass(headers: Record<string, string>, draft: { kind: string; id: string }) {
  const res = await h.request("/gms/presence/passes", { method: "POST", headers, body: JSON.stringify({ draft }) });
  const text = await res.text();
  return { status: res.status, text, body: JSON.parse(text) as { data?: { topic: string; expiresAt: string; renewAfterSeconds: number; canWrite: boolean }; errors?: { code?: string }[] } };
}
const code = (r: { body: { errors?: { code?: string }[] } }) => r.body.errors?.[0]?.code;

beforeEach(async () => {
  h = await harness();
  s = await scenario(h);
  const started = await s.call<{ data: { id: string } }>(s.applicant, "POST", "/common-grants/applications/start", { competitionId: s.uuid.comp });
  expect(started.status).toBe(201);
  appUuid = started.body.data.id;
  appId = `app_${appUuid}`;
  const oa = await h.repos.table("outside_applications").insert({ workspace_id: WS_APPLICANT, title: "Rural clinics 2027", funder_name: "Northwind Family Foundation", stage: "drafting" } as never);
  const other = await h.repos.table("outside_applications").insert({ workspace_id: WS_APPLICANT, title: "Another draft", funder_name: "Larkspur Fund", stage: "drafting" } as never);
  oaId = oa.id;
  otherOa = other.id;
  const members = h.repos.table("workspace_members");
  await members.insert({ workspace_id: WS_APPLICANT, user_id: VIEWER, role: "viewer" });
  await members.insert({ workspace_id: WS_APPLICANT, user_id: CONSULTANT, role: "consultant", scope: { applicationIds: [appUuid] } });
  await members.insert({ workspace_id: WS_APPLICANT, user_id: COWRITER, role: "consultant", scope: { outsideApplicationIds: [oaId] } });
  await members.insert({ workspace_id: WS_OTHER, user_id: STRANGER, role: "admin" } as never);
  await members.insert({ workspace_id: WS_FUNDER, user_id: REVIEWER, role: "reviewer" });
});

describe("a pass to a built-in draft's live channel", () => {
  it("is issued to the team for its session, and renewing it keeps one pass", async () => {
    const first = await pass(await as(USER_APPLICANT, WS_APPLICANT), { kind: "application", id: appId });
    expect(first.status, first.text).toBe(200);
    expect(first.body.data).toEqual({ topic: `draft:application:${appUuid}`, expiresAt: new Date(h.clock.now.getTime() + PRESENCE_PASS_TTL_MS).toISOString(), renewAfterSeconds: PRESENCE_PASS_RENEW_MS / 1000, canWrite: true });
    const rows = await h.repos.table("presence_passes").find({});
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ workspace_id: WS_APPLICANT, user_id: USER_APPLICANT, session_id: sid(1), topic: `draft:application:${appUuid}`, can_write: true });

    h.clock.now = new Date(h.clock.now.getTime() + PRESENCE_PASS_RENEW_MS);
    const again = await pass(await as(USER_APPLICANT, WS_APPLICANT), { kind: "application", id: appId });
    expect(again.status).toBe(200);
    expect(await h.repos.table("presence_passes").count({})).toBe(1);
    expect((await h.repos.table("presence_passes").one({ user_id: USER_APPLICANT }))!.expires_at).toBe(again.body.data!.expiresAt);
    // Nothing of the draft travels with the pass, and nothing is put in the ledger.
    expect(again.text).not.toMatch(/Community Health|legalName|projectTitle/);
  });

  it("lets an editor and the consultant it names write, and a viewer only be present", async () => {
    expect((await pass(await as(USER_APPLICANT_EDITOR, WS_APPLICANT), { kind: "application", id: appId })).body.data?.canWrite).toBe(true);
    expect((await pass(await as(CONSULTANT, WS_APPLICANT), { kind: "application", id: appId })).body.data?.canWrite).toBe(true);
    const viewer = await pass(await as(VIEWER, WS_APPLICANT), { kind: "application", id: appId });
    expect(viewer.status, viewer.text).toBe(200);
    expect(viewer.body.data?.canWrite).toBe(false);
  });

  it("is refused to everyone who cannot open the draft", async () => {
    const refused = [
      ["the funder's program officer", await as(USER_OFFICER, WS_FUNDER)],
      ["the funder's admin", await as(USER_ADMIN, WS_FUNDER)],
      ["a reviewer", await as(REVIEWER, WS_FUNDER)],
      ["another applicant workspace", await as(STRANGER, WS_OTHER)],
      ["a cowriter invited into an outside draft only", await as(COWRITER, WS_APPLICANT)],
    ] as const;
    for (const [who, headers] of refused) {
      const r = await pass(headers, { kind: "application", id: appId });
      expect([who, r.status], r.text).toEqual([who, r.status === 403 ? 403 : 404]);
      expect(r.text).not.toContain(appUuid);
    }
    // A consultant the draft does not name.
    await h.repos.table("workspace_members").update({ workspace_id: WS_APPLICANT, user_id: CONSULTANT }, { scope: { applicationIds: [] } });
    expect((await pass(await as(CONSULTANT, WS_APPLICANT), { kind: "application", id: appId })).status).toBe(404);
    // Someone removed from the team, and someone whose access has expired.
    await h.repos.table("workspace_members").remove({ workspace_id: WS_APPLICANT, user_id: VIEWER });
    expect((await pass(await as(VIEWER, WS_APPLICANT), { kind: "application", id: appId })).status).toBe(403);
    await h.repos.table("workspace_members").update({ workspace_id: WS_APPLICANT, user_id: USER_APPLICANT_EDITOR }, { expires_at: new Date(h.clock.now.getTime() - 1000).toISOString() });
    expect((await pass(await as(USER_APPLICANT_EDITOR, WS_APPLICANT), { kind: "application", id: appId })).status).toBe(403);
    expect(await h.repos.table("presence_passes").count({})).toBe(0);
  });

  it("ends with the draft: once submitted there is no channel, and the funder still gets none", async () => {
    await h.repos.table("applications").update({ id: appUuid }, { status: "submitted", submitted_at: h.clock.now.toISOString() });
    const team = await pass(await as(USER_APPLICANT, WS_APPLICANT), { kind: "application", id: appId });
    expect([team.status, code(team)]).toEqual([409, "not_a_draft"]);
    expect((await pass(await as(USER_OFFICER, WS_FUNDER), { kind: "application", id: appId })).status).toBe(404);
  });
});

describe("a pass to an outside draft's live channel", () => {
  it("is issued to the team and to the cowriter invited into it, and to no other draft", async () => {
    const team = await pass(await as(USER_APPLICANT, WS_APPLICANT), { kind: "outside_application", id: oaId });
    expect(team.status, team.text).toBe(200);
    expect(team.body.data).toMatchObject({ topic: `draft:outside:${oaId}`, canWrite: true });
    const cowriter = await pass(await as(COWRITER, WS_APPLICANT, sid(2)), { kind: "outside_application", id: oaId });
    expect(cowriter.status, cowriter.text).toBe(200);
    expect(cowriter.body.data?.canWrite).toBe(true);
    expect((await pass(await as(COWRITER, WS_APPLICANT, sid(2)), { kind: "outside_application", id: otherOa })).status).toBe(404);
    // Another workspace and the funder: refused before anything of the draft is looked at.
    for (const headers of [await as(STRANGER, WS_OTHER), await as(USER_OFFICER, WS_FUNDER)]) expect([403, 404]).toContain((await pass(headers, { kind: "outside_application", id: oaId })).status);
    expect(await h.repos.table("presence_passes").count({ user_id: [STRANGER, USER_OFFICER] })).toBe(0);
  });

  it("is read-only for an archived application", async () => {
    await h.repos.table("outside_applications").update({ id: oaId }, { archived_at: h.clock.now.toISOString() });
    expect((await pass(await as(USER_APPLICANT, WS_APPLICANT), { kind: "outside_application", id: oaId })).body.data?.canWrite).toBe(false);
  });
});

describe("who a pass is for", () => {
  it("refuses agents and API clients, whatever they hold, and writes nothing", async () => {
    const agent = await h.forge({ sub: USER_APPLICANT, client_id: CLIENT_AGENT, scope: scopesForRole("applicant", "admin").join(" "), [WORKSPACE_CLAIM]: WS_APPLICANT, jti: "tok-presence-agent" });
    const client = await h.forge({ scope: SCOPES.join(" "), [WORKSPACE_CLAIM]: WS_APPLICANT, jti: "tok-presence-client" });
    for (const token of [agent, client]) {
      const r = await pass({ Authorization: `Bearer ${token}`, "X-GMS-Workspace": WS_APPLICANT, "Content-Type": "application/json" }, { kind: "application", id: appId });
      expect([r.status, code(r)], r.text).toEqual([403, "person_required"]);
    }
    expect(await h.repos.table("presence_passes").count({})).toBe(0);
  });

  it("needs a sign-in session it can be bound to", async () => {
    const r = await pass(await as(USER_APPLICANT, WS_APPLICANT, null), { kind: "application", id: appId });
    expect([r.status, code(r)]).toEqual([403, "session_required"]);
    const bad = await pass(await as(USER_APPLICANT, WS_APPLICANT), { kind: "spreadsheet", id: appId });
    expect(bad.status).toBe(400);
  });

  it("clears the person's expired passes when a new one is issued", async () => {
    await pass(await as(USER_APPLICANT, WS_APPLICANT, sid(1)), { kind: "application", id: appId });
    h.clock.now = new Date(h.clock.now.getTime() + PRESENCE_PASS_TTL_MS + 1000);
    await pass(await as(USER_APPLICANT, WS_APPLICANT, sid(3)), { kind: "outside_application", id: oaId });
    const rows = await h.repos.table("presence_passes").find({ user_id: USER_APPLICANT });
    expect(rows.map((r) => r.topic)).toEqual([`draft:outside:${oaId}`]);
  });
});
