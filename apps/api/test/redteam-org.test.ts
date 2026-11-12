// SPDX-License-Identifier: AGPL-3.0-only
// Red team (2026-11): two ways a stranger ended up administering a real organization's applicant
// workspace and holding its Passport consent, and the same for a funder's identity.
//   1. The consent callback linked the organization to whoever was named in `state`, with no check
//      that the browser returning from Passport belonged to that person.
//   2. `POST /gms/workspaces` stored any `passportOrgId`, so a workspace could be parked on an
//      organization before it arrived; the real organization then joined it as an editor.
import { decryptSecret, fixtureFetch, type Fixture } from "@gms/passport-client";
import { beforeEach, describe, expect, it } from "vitest";
import { ORG_RIVERBEND, TEST_CREDENTIALS_KEY, WEB, WS_FUNDER, bearer, harness, type Harness } from "./helpers.ts";
import { ALDER_ORG, ALDER_PROFILE, ORG_ALDER } from "./scenario.ts";

const ATTACKER = "abababab-abab-4bab-8bab-abababababab";
const VICTIM = "12121212-1212-4212-8212-121212121212"; // a real representative of Alder Creek
const jwt = (claims: Record<string, unknown>) => `h.${btoa(JSON.stringify(claims)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}.s`;
const env = <T>(data: T) => ({ status: 200, message: "Success", data });
const token = (n: number): Fixture => ({ method: "POST", path: "/oauth/token", status: 200, body: { access_token: jwt({ "https://commongrants.org/org_id": ORG_ALDER, n }), refresh_token: `rt-${n}`, expires_in: 600, scope: "org:read org.changes:read org.changes:write payee:read" } });
const ORG: Fixture = { method: "GET", path: `/common-grants/orgs/${ORG_ALDER}`, status: 200, body: env(ALDER_ORG) };
const PROFILE: Fixture = { method: "GET", path: `/passport/orgs/${ORG_ALDER}/profile`, status: 200, body: env(ALDER_PROFILE) };

let h: Harness;
beforeEach(async () => {
  h = await harness();
});
const session = async (user: string) => ({ ...bearer(await h.session(user)).headers, "Content-Type": "application/json" });

/** Start as `user`, then follow Passport's redirect in a browser with no GMS credentials. */
async function startAndReturn(user: string) {
  const start = await h.request("/gms/passport/consent/start", { method: "POST", headers: await session(user), body: "{}" });
  const state = new URL(((await start.json()) as { data: { authorizeUrl: string } }).data.authorizeUrl).searchParams.get("state")!;
  const cb = await h.request(`/gms/passport/consent/callback?code=the-code&state=${encodeURIComponent(state)}`);
  return { state, cb, location: new URL(cb.headers.get("Location")!) };
}
const finish = async (user: string, code: string, state: string) => h.request("/gms/passport/consent/finish", { method: "POST", headers: await session(user), body: JSON.stringify({ code, state }) });
const counts = async () => ({ workspaces: await h.repos.table("workspaces").count({ passport_org_id: ORG_ALDER }), links: await h.repos.table("passport_links").count({ mode: "applicant_consent" }) });

describe("Passport consent is finished by the person who started it", () => {
  it("the callback links nothing: it hands the code back to the web app, and Passport is not called", async () => {
    const fx = fixtureFetch([token(1), ORG, PROFILE]);
    h.passport.fetch = fx.fetch;
    const { cb, location } = await startAndReturn(ATTACKER);
    expect(cb.status).toBe(302);
    expect(location.origin + location.pathname).toBe(`${WEB}/onboarding/applicant`);
    expect(location.searchParams.get("passport")).toBe("finish");
    // The code and state travel in the fragment, which is never sent to a server or in a Referer.
    expect(location.search).not.toContain("the-code");
    expect(new URLSearchParams(location.hash.slice(1)).get("code")).toBe("the-code");
    expect(cb.headers.get("Cache-Control")).toBe("no-store");
    expect(cb.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(fx.calls).toHaveLength(0);
    expect(await counts()).toEqual({ workspaces: 0, links: 0 });
  });

  it("another account cannot finish it: the victim's approval never links the organization to the attacker", async () => {
    const fx = fixtureFetch([token(1), ORG, PROFILE]);
    h.passport.fetch = fx.fetch;
    // The attacker starts the flow and sends the Passport link to the victim, who approves. The
    // victim's browser comes back with the victim's code and the attacker's state.
    const { state, location } = await startAndReturn(ATTACKER);
    const code = new URLSearchParams(location.hash.slice(1)).get("code")!;
    // In the victim's browser the web app finishes with the victim's own session: refused.
    const res = await finish(VICTIM, code, state);
    expect(res.status).toBe(403);
    expect(((await res.json()) as { errors: { code: string }[] }).errors[0]!.code).toBe("consent_not_yours");
    // Without a session at all: refused.
    expect((await h.request("/gms/passport/consent/finish", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code, state }) })).status).toBe(401);
    // The code was never redeemed, and nobody was linked or added anywhere.
    expect(fx.calls).toHaveLength(0);
    expect(await counts()).toEqual({ workspaces: 0, links: 0 });
    expect(await h.repos.table("workspace_members").count({ user_id: ATTACKER })).toBe(0);
    expect(await h.repos.table("workspace_members").count({ user_id: VICTIM })).toBe(0);
  });

  it("the person who started it finishes it and becomes the workspace admin", async () => {
    h.passport.fetch = fixtureFetch([token(1), ORG, PROFILE]).fetch;
    const { state, location } = await startAndReturn(VICTIM);
    const res = await finish(VICTIM, new URLSearchParams(location.hash.slice(1)).get("code")!, state);
    expect(res.status).toBe(200);
    const out = ((await res.json()) as { data: { workspaceId: string; handle: string; redirect: string } }).data;
    expect(new URL(out.redirect).searchParams.get("passport")).toBe("linked");
    const ws = (await h.repos.table("workspaces").one({ passport_org_id: ORG_ALDER, kind: "applicant" }))!;
    expect(out.workspaceId).toBe(ws.id);
    expect(await h.repos.table("workspace_members").one({ workspace_id: ws.id, user_id: VICTIM })).toMatchObject({ role: "admin" });
    const link = (await h.repos.table("passport_links").one({ workspace_id: ws.id, mode: "applicant_consent", revoked_at: null }))!;
    expect(await decryptSecret(link.refresh_token_enc!, TEST_CREDENTIALS_KEY)).toBe("rt-1");
  });
});

describe("a workspace gets its Passport organization only from Passport", () => {
  it("POST /gms/workspaces refuses passportOrgId", async () => {
    for (const kind of ["applicant", "funder"]) {
      const made = await h.request("/gms/workspaces", { method: "POST", headers: await session(ATTACKER), body: JSON.stringify({ kind, handle: `alder-creek-${kind}`, displayName: "Alder Creek Family Services", passportOrgId: ORG_ALDER }) });
      expect(made.status, kind).toBe(400);
    }
    expect(await h.repos.table("workspaces").count({ passport_org_id: ORG_ALDER })).toBe(0);
  });

  it("a workspace parked on an organization does not capture it: the real organization gets its own workspace and its consent", async () => {
    // A row from before the fix: the attacker's workspace carries the organization's id with no Passport proof behind it.
    const squat = await h.repos.table("workspaces").insert({ kind: "applicant", handle: "alder-creek-fs", display_name: "Alder Creek Family Services", passport_org_id: ORG_ALDER, status: "active" });
    await h.repos.table("workspace_members").insert({ workspace_id: squat.id, user_id: ATTACKER, role: "admin" });

    h.passport.fetch = fixtureFetch([token(7), ORG, PROFILE]).fetch;
    const { state, location } = await startAndReturn(VICTIM);
    expect((await finish(VICTIM, new URLSearchParams(location.hash.slice(1)).get("code")!, state)).status).toBe(200);

    const mine = (await h.repos.table("workspaces").one({ passport_org_id: ORG_ALDER, kind: "applicant" }))!;
    expect(mine.id).not.toBe(squat.id);
    expect(mine).toMatchObject({ verification_level: "L3", ein: "001234567" });
    expect(await h.repos.table("workspace_members").one({ workspace_id: mine.id, user_id: VICTIM })).toMatchObject({ role: "admin" });
    expect(await h.repos.table("workspace_members").count({ workspace_id: mine.id, user_id: ATTACKER })).toBe(0);
    // The parked workspace lost its claim and holds nothing of the organization's.
    const parked = (await h.repos.table("workspaces").one({ id: squat.id }))!;
    expect(parked).toMatchObject({ passport_org_id: null, verification_level: null, org_projection: null });
    expect(await h.repos.table("passport_links").count({ workspace_id: squat.id })).toBe(0);
    expect((await h.ledger.list({ workspaceId: squat.id })).map((e) => e.eventType)).toContain("workspace.passport_claim_released");
    const who = { ...(await session(ATTACKER)), "X-GMS-Workspace": mine.id };
    expect((await h.request("/gms/me/organization", { headers: who })).status).toBe(403);
  });

  it("a funder workspace has no Passport organization until its client is verified against that organization", async () => {
    const SOURCES = (status: number): Fixture => ({ method: "GET", path: `/passport/funders/${ORG_RIVERBEND}/sources`, status, body: status === 200 ? { status: 200, message: "Success", items: [], paginationInfo: { page: 1, pageSize: 100, totalItems: 0, totalPages: 0 } } : { status, message: "Forbidden", errors: [{ code: "forbidden" }] } });
    const TOKEN: Fixture = { method: "POST", path: "/oauth/token", status: 200, body: { access_token: "t", token_type: "Bearer", expires_in: 3600, scope: "org:read payee:read" } };
    const made = await h.request("/gms/workspaces", { method: "POST", headers: await session(VICTIM), body: JSON.stringify({ kind: "funder", handle: "riverbend-two", displayName: "Riverbend" }) });
    const wsId = ((await made.json()) as { data: { workspace: { id: string; passportOrgId: string | null } } }).data.workspace.id;
    const who = { ...(await session(VICTIM)), "X-GMS-Workspace": wsId };
    const link = (body: unknown) => h.request(`/gms/workspaces/${wsId}/passport/link`, { method: "POST", headers: who, body: JSON.stringify(body) });

    // No organization named and none on the workspace: nothing to verify against.
    expect((await link({ clientId: "pc_x", clientSecret: "a-client-secret" })).status).toBe(409);
    // Passport refuses this client for that organization: nothing is saved, the id is not taken.
    h.passport.fetch = fixtureFetch([TOKEN, SOURCES(403)]).fetch;
    expect((await link({ clientId: "pc_x", clientSecret: "a-client-secret", passportOrgId: ORG_RIVERBEND })).status).toBe(422);
    expect((await h.repos.table("workspaces").one({ id: wsId }))!.passport_org_id).toBeNull();
    // Passport accepts it: the workspace now carries the organization, taken from an unproven holder if there is one.
    const parked = (await h.repos.table("workspaces").find({ passport_org_id: ORG_RIVERBEND, kind: "funder" }))[0]!;
    await h.repos.table("passport_links").remove({ workspace_id: parked.id });
    h.passport.fetch = fixtureFetch([TOKEN, SOURCES(200)]).fetch;
    expect((await link({ clientId: "pc_x", clientSecret: "a-client-secret", passportOrgId: ORG_RIVERBEND })).status).toBe(201);
    expect((await h.repos.table("workspaces").one({ id: wsId }))!.passport_org_id).toBe(ORG_RIVERBEND);
    expect((await h.repos.table("workspaces").one({ id: parked.id }))!.passport_org_id).toBeNull();
    // A workspace whose own client was verified for the organization keeps it: a second claimant is refused.
    const other = await h.request("/gms/workspaces", { method: "POST", headers: await session(ATTACKER), body: JSON.stringify({ kind: "funder", handle: "riverbend-three", displayName: "Riverbend" }) });
    const otherId = ((await other.json()) as { data: { workspace: { id: string } } }).data.workspace.id;
    h.passport.fetch = fixtureFetch([TOKEN, SOURCES(200)]).fetch;
    const second = await h.request(`/gms/workspaces/${otherId}/passport/link`, { method: "POST", headers: { ...(await session(ATTACKER)), "X-GMS-Workspace": otherId }, body: JSON.stringify({ clientId: "pc_y", clientSecret: "another-client-secret", passportOrgId: ORG_RIVERBEND }) });
    expect(second.status).toBe(409);
    expect((await h.repos.table("workspaces").one({ id: wsId }))!.passport_org_id).toBe(ORG_RIVERBEND);
  });
});

describe("a self-declared funder that links Passport (NP-06)", () => {
  const TOKEN: Fixture = { method: "POST", path: "/oauth/token", status: 200, body: { access_token: "t", token_type: "Bearer", expires_in: 3600, scope: "org:read payee:read" } };
  const SOURCES: Fixture = { method: "GET", path: `/passport/funders/${ORG_RIVERBEND}/sources`, status: 200, body: { status: 200, message: "Success", items: [], paginationInfo: { page: 1, pageSize: 100, totalItems: 0, totalPages: 0 } } };
  const setup = async () => {
    // The harness's Riverbend workspace holds the id with no proof; free it.
    await h.repos.table("workspaces").update({ id: WS_FUNDER }, { passport_org_id: null, profile_source: "none" });
    const made = await h.request("/gms/workspaces", { method: "POST", headers: await session(VICTIM), body: JSON.stringify({ kind: "funder", handle: "big-famous", displayName: "Big Famous Foundation", profile: { legalName: "Big Famous Foundation", ein: "131234567" } }) });
    const wsId = ((await made.json()) as { data: { workspace: { id: string } } }).data.workspace.id;
    const who = { ...(await session(VICTIM)), "X-GMS-Workspace": wsId };
    const link = () => h.request(`/gms/workspaces/${wsId}/passport/link`, { method: "POST", headers: who, body: JSON.stringify({ clientId: "pc_x", clientSecret: "a-client-secret", passportOrgId: ORG_RIVERBEND }) });
    return { wsId, link };
  };

  it("takes its legal name and EIN from the Passport record", async () => {
    const { wsId, link } = await setup();
    const ORG: Fixture = { method: "GET", path: `/common-grants/orgs/${ORG_RIVERBEND}`, status: 200, body: { status: 200, message: "Success", data: { id: ORG_RIVERBEND, name: "Riverbend Community Foundation", identifiers: { "org:us:ein": { id: "001000001" } } } } };
    h.passport.fetch = fixtureFetch([TOKEN, SOURCES, ORG]).fetch;
    expect((await link()).status).toBe(201);
    expect(await h.repos.table("workspaces").one({ id: wsId })).toMatchObject({ passport_org_id: ORG_RIVERBEND, legal_name: "Riverbend Community Foundation", ein: "001000001", profile_source: "passport", self_declared_profile: null });
  });

  it("clears the typed ones when Passport does not answer for the record", async () => {
    const { wsId, link } = await setup();
    h.passport.fetch = fixtureFetch([TOKEN, SOURCES]).fetch;
    expect((await link()).status).toBe(201);
    expect(await h.repos.table("workspaces").one({ id: wsId })).toMatchObject({ passport_org_id: ORG_RIVERBEND, legal_name: null, ein: null });
  });
});
