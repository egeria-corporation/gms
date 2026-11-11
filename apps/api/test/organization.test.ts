// SPDX-License-Identifier: AGPL-3.0-only
// The applicant's link to Passport: consent (authorization code + PKCE), the cached record,
// readiness, refresh with a rotating refresh token, and who-has-access.
import { decryptSecret, fixtureFetch, type Fixture } from "@gms/passport-client";
import { beforeEach, describe, expect, it } from "vitest";
import { PASSPORT, TEST_CREDENTIALS_KEY, USER_ADMIN, WEB, WS_APPLICANT, WS_FUNDER, bearer, harness, type Harness } from "./helpers.ts";
import { ALDER_ORG, ALDER_PROFILE, ORG_ALDER } from "./scenario.ts";

const NEW_USER = "12121212-1212-4212-8212-121212121212";
const SECOND_USER = "13131313-1313-4313-8313-131313131313";
const jwt = (claims: Record<string, unknown>) => `h.${btoa(JSON.stringify(claims)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}.s`;
const env = <T>(data: T) => ({ status: 200, message: "Success", data });

const token = (n: number): Fixture => ({ method: "POST", path: "/oauth/token", status: 200, body: { access_token: jwt({ "https://commongrants.org/org_id": ORG_ALDER, n }), refresh_token: `rt-${n}`, expires_in: 600, scope: "org:read org.changes:read org.changes:write" } });
/** Where a person opens Passport: its web app, not the API at PASSPORT. */
const PASSPORT_WEB = PASSPORT.replace("//passport.", "//app.passport.");
const ORG: Fixture = { method: "GET", path: `/common-grants/orgs/${ORG_ALDER}`, status: 200, body: env(ALDER_ORG) };
const PROFILE: Fixture = { method: "GET", path: `/passport/orgs/${ORG_ALDER}/profile`, status: 200, body: env(ALDER_PROFILE) };

let h: Harness;
beforeEach(async () => {
  h = await harness();
});

const session = async (user: string) => ({ ...bearer(await h.session(user)).headers, "Content-Type": "application/json" });

async function consent(user: string, fixtures: Fixture[], body: Record<string, unknown> = {}) {
  const fx = fixtureFetch(fixtures);
  h.passport.fetch = fx.fetch;
  const start = await h.request("/gms/passport/consent/start", { method: "POST", headers: await session(user), body: JSON.stringify(body) });
  expect(start.status).toBe(200);
  const { authorizeUrl } = ((await start.json()) as { data: { authorizeUrl: string } }).data;
  const state = new URL(authorizeUrl).searchParams.get("state")!;
  const cb = await h.request(`/gms/passport/consent/callback?code=the-code&state=${encodeURIComponent(state)}`);
  return { fx, authorizeUrl, state, cb, location: new URL(cb.headers.get("Location")!) };
}

describe("Passport consent", () => {
  it("sends the browser to Passport with PKCE and the consent scopes", async () => {
    const { authorizeUrl } = await consent(NEW_USER, [token(1), ORG, PROFILE]);
    const url = new URL(authorizeUrl);
    expect(url.origin + url.pathname).toBe(`${PASSPORT}/oauth/authorize`);
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ response_type: "code", client_id: "gms-test-client", redirect_uri: "https://gms.test/gms/passport/consent/callback", scope: "org:read org.changes:read org.changes:write payee:read", code_challenge_method: "S256" });
    // The verifier is not readable from the URL.
    expect(url.searchParams.get("state")).not.toContain("the-code");
  });

  it("creates the applicant workspace, caches the record and profile, and stores the refresh token encrypted", async () => {
    // The harness's own applicant workspace is unlinked, so this organization is new here.
    const { fx, cb, location } = await consent(NEW_USER, [token(1), ORG, PROFILE]);
    expect(cb.status).toBe(302);
    expect(location.origin + location.pathname).toBe(`${WEB}/onboarding/applicant`);
    expect(location.searchParams.get("passport")).toBe("linked");
    const ws = (await h.repos.table("workspaces").one({ passport_org_id: ORG_ALDER }))!;
    expect(ws).toMatchObject({ kind: "applicant", handle: "alder-creek-family-services", display_name: "Alder Creek Family Services", verification_level: "L3", ein: "001234567" });
    expect(location.searchParams.get("ws")).toBe(ws.handle);
    expect((ws.org_projection as { name: string }).name).toBe("Alder Creek Family Services");
    expect((ws.profile_projection as { fields: unknown[] }).fields).toHaveLength(3);
    expect(await h.repos.table("workspace_members").one({ workspace_id: ws.id, user_id: NEW_USER })).toMatchObject({ role: "admin" });
    const link = (await h.repos.table("passport_links").one({ workspace_id: ws.id, mode: "applicant_consent" }))!;
    expect(link.refresh_token_enc).not.toContain("rt-1");
    expect(await decryptSecret(link.refresh_token_enc!, TEST_CREDENTIALS_KEY)).toBe("rt-1");
    // The code was exchanged with the verifier, and both reads used the bearer.
    expect(String(fx.calls[0]!.body)).toMatch(/grant_type=authorization_code.*code_verifier=/);
    expect(fx.calls.slice(1).map((c) => c.path)).toEqual([`/common-grants/orgs/${ORG_ALDER}`, `/passport/orgs/${ORG_ALDER}/profile`]);
    expect((await h.ledger.list({ workspaceId: ws.id })).map((e) => e.eventType)).toEqual(expect.arrayContaining(["workspace.created", "member.added", "passport.linked"]));
  });

  it("joins a second person from the same organization as an editor, without a second workspace", async () => {
    await consent(NEW_USER, [token(1), ORG, PROFILE]);
    await consent(SECOND_USER, [token(2), ORG, PROFILE]);
    const all = await h.repos.table("workspaces").find({ passport_org_id: ORG_ALDER });
    expect(all).toHaveLength(1);
    expect(await h.repos.table("workspace_members").one({ workspace_id: all[0]!.id, user_id: SECOND_USER })).toMatchObject({ role: "editor" });
    expect(await h.repos.table("passport_links").count({ workspace_id: all[0]!.id, revoked_at: null })).toBe(1);
  });

  it("links an existing unlinked workspace the person administers", async () => {
    await h.repos.table("workspace_members").insert({ workspace_id: WS_APPLICANT, user_id: NEW_USER, role: "admin" });
    const { location } = await consent(NEW_USER, [token(1), ORG, PROFILE], { workspaceId: WS_APPLICANT, returnTo: "/w/alder-creek/organization" });
    expect(location.pathname).toBe("/w/alder-creek/organization");
    expect(await h.repos.table("workspaces").one({ id: WS_APPLICANT })).toMatchObject({ passport_org_id: ORG_ALDER, verification_level: "L3" });
    expect(await h.repos.table("workspaces").count({ passport_org_id: ORG_ALDER })).toBe(1);
  });

  it("still links when the organization has no confirmed profile yet", async () => {
    const { location } = await consent(NEW_USER, [token(1), ORG, { method: "GET", path: `/passport/orgs/${ORG_ALDER}/profile`, status: 404, body: { status: 404, message: "Not found", errors: [{ code: "not_found" }] } }]);
    expect(location.searchParams.get("passport")).toBe("linked");
    expect((await h.repos.table("workspaces").one({ passport_org_id: ORG_ALDER }))!.profile_projection).toBeNull();
  });

  it("redirects with a reason and changes nothing for a forged state, a refusal or a Passport outage", async () => {
    const forged = await h.request("/gms/passport/consent/callback?code=x&state=not-a-sealed-state");
    expect(new URL(forged.headers.get("Location")!).searchParams.get("reason")).toBe("invalid_state");

    const { state } = await consent(NEW_USER, [token(1), ORG, PROFILE]);
    await h.repos.table("workspaces").remove({ passport_org_id: ORG_ALDER });
    const declined = await h.request(`/gms/passport/consent/callback?error=access_denied&state=${encodeURIComponent(state)}`);
    expect(new URL(declined.headers.get("Location")!).searchParams.get("reason")).toBe("declined");

    h.passport.fetch = () => Promise.reject(new Error("down"));
    const down = await h.request(`/gms/passport/consent/callback?code=c&state=${encodeURIComponent(state)}`);
    expect(new URL(down.headers.get("Location")!).searchParams.get("reason")).toBe("passport_unavailable");

    h.clock.now = new Date(h.clock.now.getTime() + 11 * 60 * 1000);
    h.passport.fetch = fixtureFetch([token(1), ORG, PROFILE]).fetch;
    const late = await h.request(`/gms/passport/consent/callback?code=c&state=${encodeURIComponent(state)}`);
    expect(new URL(late.headers.get("Location")!).searchParams.get("reason")).toBe("expired");
    expect(await h.repos.table("workspaces").count({ passport_org_id: ORG_ALDER })).toBe(0);
  });

  it("needs a signed-in person to start", async () => {
    expect((await h.request("/gms/passport/consent/start", { method: "POST" })).status).toBe(401);
  });
});

describe("the cached organization", () => {
  async function linked() {
    await consent(NEW_USER, [token(1), ORG, PROFILE]);
    const ws = (await h.repos.table("workspaces").one({ passport_org_id: ORG_ALDER }))!;
    return { ws, who: { ...(await session(NEW_USER)), "X-GMS-Workspace": ws.id } };
  }

  it("serves the organization, the folded profile and where to edit it", async () => {
    const { who } = await linked();
    const r = await h.request("/gms/me/organization", { headers: who });
    const d = ((await r.json()) as { data: Record<string, unknown> }).data;
    expect(d).toMatchObject({ linked: true, level: "L3", verifiedAt: "2027-01-12T17:20:00Z", profile: { commonApp: { irs: { subsection: "03" }, financials: { budget: 2_400_000, totalRevenue: 2_310_000 } } }, editUrl: `${PASSPORT_WEB}/orgs/${ORG_ALDER}` });
    expect((d.organization as { name: string }).name).toBe("Alder Creek Family Services");
    expect((d.profileSources as Record<string, string>)["/commonApp/financials/totalRevenue"]).toBe("irs_990");
  });

  it("reports readiness as pass, fail or unknown per check", async () => {
    const { who, ws } = await linked();
    const read = async () => ((await (await h.request("/gms/me/readiness", { headers: who })).json()) as { data: { checks: { key: string; state: string; fixHref: string | null }[]; summary: { ready: boolean; fail: number; unknown: number } } }).data;
    const ready = await read();
    expect(ready.summary).toMatchObject({ ready: true, fail: 0, unknown: 0 });
    expect(ready.checks.map((c) => c.key)).toEqual(["passport_linked", "organization_active", "organization_verified", "identity_verified", "payee_verified"]);

    await h.repos.table("workspaces").update({ id: ws.id }, { verification_level: "L1" });
    const partial = await read();
    expect(partial.checks.filter((c) => c.state === "fail").map((c) => c.key)).toEqual(["identity_verified", "payee_verified"]);
    expect(partial.checks.find((c) => c.key === "payee_verified")!.fixHref).toBe(`${PASSPORT_WEB}/orgs/${ORG_ALDER}`);

    // An unlinked workspace knows nothing about the organization: unknown, never a guess.
    const bare = { ...(await session(USER_ADMIN)), "X-GMS-Workspace": WS_APPLICANT };
    await h.repos.table("workspace_members").insert({ workspace_id: WS_APPLICANT, user_id: USER_ADMIN, role: "admin" });
    const none = ((await (await h.request("/gms/me/readiness", { headers: bare })).json()) as { data: { checks: { key: string; state: string }[] } }).data;
    expect(none.checks.map((c) => c.state)).toEqual(["fail", "unknown", "unknown", "unknown", "unknown"]);
  });

  it("lists the Passport locker as references and marks what can be attached", async () => {
    const { who, ws } = await linked();
    const docs = [
      { id: "0193a1c0-0000-7000-8000-0000000d0c01", kind: "determination_letter", name: "IRS determination letter.pdf", mimeType: "application/pdf", sha256: "a".repeat(64), source: "upload", uploadedAt: "2027-01-12T17:00:00Z", expiresAt: null, lastModifiedAt: "2027-01-12T17:00:00Z" },
      { id: "0193a1c0-0000-7000-8000-0000000d0c03", kind: "other", name: "Board roster (Drive)", mimeType: "application/vnd.google-apps.document", sha256: null, source: "google_drive", uploadedAt: "2027-02-10T17:00:00Z", expiresAt: null, lastModifiedAt: "2027-02-10T17:00:00Z" },
    ];
    const fx = fixtureFetch([token(2), { method: "GET", path: `/passport/orgs/${ORG_ALDER}/documents`, status: 200, body: { status: 200, message: "Success", items: docs, paginationInfo: { page: 1, pageSize: 2, totalItems: 2, totalPages: 1 } } }]);
    h.passport.fetch = fx.fetch;
    const r = await h.request("/gms/me/documents", { headers: who });
    expect(r.status).toBe(200);
    const list = ((await r.json()) as { data: { id: string; attachable: boolean; sha256: string | null }[] }).data;
    expect(list.map((d) => [d.id.slice(-2), d.attachable])).toEqual([["01", true], ["03", false]]);
    expect(JSON.stringify(list)).not.toMatch(/storage|path/i);
    // The rotated refresh token is kept, as on any consented read.
    const link = (await h.repos.table("passport_links").one({ workspace_id: ws.id, revoked_at: null }))!;
    expect(await decryptSecret(link.refresh_token_enc!, TEST_CREDENTIALS_KEY)).toBe("rt-2");

    h.passport.fetch = () => Promise.reject(new Error("down"));
    expect((await h.request("/gms/me/documents", { headers: who })).status).toBe(503);
  });

  it("refreshes from Passport and persists the rotated refresh token", async () => {
    const { who, ws } = await linked();
    const moved = { ...ALDER_ORG, customFields: { ...ALDER_ORG.customFields, verificationLevel: { name: "verificationLevel", fieldType: "string", value: "L2" } } };
    const fx = fixtureFetch([token(2), { ...ORG, body: env(moved) }, { ...PROFILE, body: env({ ...ALDER_PROFILE, level: "L2" }) }]);
    h.passport.fetch = fx.fetch;
    const r = await h.request("/gms/me/organization/refresh", { method: "POST", headers: who });
    expect(r.status).toBe(200);
    expect(((await r.json()) as { data: { level: string } }).data.level).toBe("L2");
    expect(String(fx.calls[0]!.body)).toContain("refresh_token=rt-1");
    const link = (await h.repos.table("passport_links").one({ workspace_id: ws.id, revoked_at: null }))!;
    expect(await decryptSecret(link.refresh_token_enc!, TEST_CREDENTIALS_KEY)).toBe("rt-2");
    expect((await h.ledger.list({ workspaceId: ws.id })).map((e) => e.eventType)).toContain("organization.level_changed");
  });

  it("keeps the cache when Passport is down, and asks to reconnect when consent was withdrawn", async () => {
    const { who, ws } = await linked();
    h.passport.fetch = () => Promise.reject(new Error("down"));
    expect((await h.request("/gms/me/organization/refresh", { method: "POST", headers: who })).status).toBe(503);
    expect((await h.repos.table("workspaces").one({ id: ws.id }))!.verification_level).toBe("L3");

    h.passport.fetch = fixtureFetch([{ method: "POST", path: "/oauth/token", status: 400, body: { error: "invalid_grant" } }]).fetch;
    const gone = await h.request("/gms/me/organization/refresh", { method: "POST", headers: who });
    expect(gone.status).toBe(409);
    expect(((await gone.json()) as { errors: { code: string }[] }).errors[0]!.code).toBe("passport_consent_revoked");
    expect(await h.repos.table("passport_links").count({ workspace_id: ws.id, revoked_at: null })).toBe(0);
  });

  it("lists who has access and lets an admin revoke it", async () => {
    const { who, ws } = await linked();
    const c = await h.repos.table("consents").insert({ applicant_workspace_id: ws.id, funder_workspace_id: WS_FUNDER, basis: "application", scopes: ["org:read"], granted_at: "2027-02-03T00:00:00Z" });
    const list = ((await (await h.request("/gms/my/consents", { headers: who })).json()) as { data: { id: string; funder: { name: string }; basis: string; revokedAt: string | null }[] }).data;
    expect(list).toEqual([expect.objectContaining({ id: c.id, basis: "application", revokedAt: null, funder: expect.objectContaining({ name: "Riverbend Community Foundation" }) })]);
    expect((await h.request(`/gms/my/consents/${c.id}`, { method: "DELETE", headers: who })).status).toBe(200);
    expect((await h.repos.table("consents").one({ id: c.id }))!.revoked_at).toBeTruthy();
  });
});

describe("GET /gms/me", () => {
  it("returns each workspace with handle, kind, role and brand", async () => {
    const r = await h.request("/gms/me", { headers: await session(USER_ADMIN) });
    const d = ((await r.json()) as { data: { workspaces: Record<string, unknown>[] } }).data;
    expect(d.workspaces).toEqual([expect.objectContaining({ handle: "riverbend", kind: "funder", role: "admin", displayName: "Riverbend Community Foundation", requiresMfa: true, brand: { accent: "#1F6F8B", onAccent: "#FFFFFF" } })]);
  });
});
