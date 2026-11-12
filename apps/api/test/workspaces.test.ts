// SPDX-License-Identifier: AGPL-3.0-only
import { fixtureFetch, type Fixture } from "@gms/passport-client";
import { describe, expect, it } from "vitest";
import { ORG_RIVERBEND, USER_ADMIN, USER_AUDITOR, USER_OFFICER, WS_APPLICANT, WS_FUNDER, WS_OTHER, bearer, clientCredentialsToken, harness, type Harness } from "./helpers.ts";

const NEW_USER = "f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0";
const json = (h: Record<string, string>, body: unknown, method = "POST"): RequestInit => ({ method, headers: { ...h, "Content-Type": "application/json" }, body: JSON.stringify(body) });
const auth = async (h: Harness, userId: string) => bearer(await h.session(userId)).headers;
const data = async <T>(res: Response) => ((await res.json()) as { data: T }).data;

describe("workspaces", () => {
  it("lets a signed-in person create a workspace and makes them its admin, on the ledger", async () => {
    const h = await harness();
    const who = await auth(h, NEW_USER);
    const res = await h.request("/gms/workspaces", json(who, { kind: "funder", handle: "northwind", displayName: "Northwind Family Foundation", brand: { accent: "#7A4F01" } }));
    expect(res.status).toBe(201);
    const { workspace, warnings } = await data<{ workspace: { id: string; brand: { accent: string; onAccent: string } }; warnings: string[] }>(res);
    expect(workspace.brand).toEqual({ accent: "#7A4F01", onAccent: "#FFFFFF" });
    expect(warnings).toEqual([]);

    const mine = await data<{ id: string; role: string; requiresMfa: boolean }[]>(await h.request("/gms/workspaces", { headers: who }));
    expect(mine).toMatchObject([{ id: workspace.id, role: "admin", requiresMfa: true }]);
    const events = await h.ledger.list({ workspaceId: workspace.id });
    expect(events.map((e) => e.eventType)).toEqual(["workspace.created", "member.added"]);
    expect(events[0]!.actor).toBe(`user:${NEW_USER}`);
  });

  it("refuses a taken handle and falls back to the system accent when contrast fails", async () => {
    const h = await harness();
    const who = await auth(h, NEW_USER);
    expect((await h.request("/gms/workspaces", json(who, { kind: "funder", handle: "riverbend", displayName: "Copycat" }))).status).toBe(409);
    const res = await h.request("/gms/workspaces", json(who, { kind: "applicant", handle: "pale-yellow", displayName: "Pale", brand: { accent: "#FFF9C4", onAccent: "#FFFFFF" } }));
    const { workspace, warnings } = await data<{ workspace: { brand: { accent: string } }; warnings: string[] }>(res);
    expect(workspace.brand.accent).toBe("#145450");
    expect(warnings).toHaveLength(1);
  });

  it("does not create workspaces for API tokens", async () => {
    const h = await harness();
    const token = await clientCredentialsToken(h);
    expect((await h.request("/gms/workspaces", json(bearer(token).headers, { kind: "funder", handle: "robots", displayName: "Robots" }))).status).toBe(401);
  });

  it("shows a workspace to its members and answers 403 to everyone else without confirming it exists", async () => {
    const h = await harness();
    const officer = await auth(h, USER_OFFICER);
    expect((await h.request(`/gms/workspaces/${WS_FUNDER}`, { headers: officer })).status).toBe(200);
    for (const id of [WS_OTHER, "99999999-9999-4999-8999-999999999999"]) {
      const res = await h.request(`/gms/workspaces/${id}`, { headers: officer });
      expect(res.status).toBe(403);
      expect(((await res.json()) as { errors: { code: string }[] }).errors[0]!.code).toBe("workspace_mismatch");
    }
  });

  it("keeps team management to admins and never leaves a workspace without one", async () => {
    const h = await harness();
    const admin = await auth(h, USER_ADMIN);
    const officer = await auth(h, USER_OFFICER);
    expect((await h.request(`/gms/workspaces/${WS_FUNDER}/members`, { headers: officer })).status).toBe(403);
    const list = (await (await h.request(`/gms/workspaces/${WS_FUNDER}/members`, { headers: admin })).json()) as { items: { userId: string; email: string | null; name: string | null }[]; paginationInfo: { totalItems: number } };
    expect(list.paginationInfo.totalItems).toBe(3);
    // Names and emails come from the auth directory; a person it does not know is listed without them.
    expect(list.items.find((m) => m.userId === USER_ADMIN)).toMatchObject({ email: "helen.ortiz@riverbendcf.example", name: "Helen Ortiz" });
    expect(list.items.find((m) => m.userId === USER_AUDITOR)).toMatchObject({ email: null, name: null });

    // An applicant role does not exist in a funder workspace.
    expect((await h.request(`/gms/workspaces/${WS_FUNDER}/members`, json(admin, { userId: NEW_USER, role: "editor" }))).status).toBe(422);
    expect((await h.request(`/gms/workspaces/${WS_FUNDER}/members`, json(admin, { userId: NEW_USER, role: "finance" }))).status).toBe(201);
    expect((await h.request(`/gms/workspaces/${WS_FUNDER}/members`, json(admin, { userId: NEW_USER, role: "finance" }))).status).toBe(409);

    const demote = await h.request(`/gms/workspaces/${WS_FUNDER}/members/${USER_ADMIN}`, json(admin, { role: "observer" }, "PATCH"));
    expect(((await demote.json()) as { errors: { code: string }[] }).errors[0]!.code).toBe("last_admin");
    expect((await h.request(`/gms/workspaces/${WS_FUNDER}/members/${USER_ADMIN}`, { method: "DELETE", headers: admin })).status).toBe(409);

    expect((await h.request(`/gms/workspaces/${WS_FUNDER}/members/${USER_AUDITOR}`, { method: "DELETE", headers: admin })).status).toBe(200);
    // The removed member loses access on their next request.
    expect((await h.request(`/gms/workspaces/${WS_FUNDER}`, { headers: await auth(h, USER_AUDITOR) })).status).toBe(403);
    expect((await h.ledger.list({ workspaceId: WS_FUNDER })).map((e) => e.eventType)).toEqual(["member.added", "member.removed"]);
  });

  it("invites by email with a one-time token that only its hash survives", async () => {
    const h = await harness();
    const admin = await auth(h, USER_ADMIN);
    const res = await h.request(`/gms/workspaces/${WS_FUNDER}/invitations`, json(admin, { email: "Hollis.Grant@reviewers.example", role: "external_reviewer", scope: { competitionIds: ["cmp_1"] } }));
    expect(res.status).toBe(201);
    const inv = await data<{ token: string; acceptUrl: string; email: string }>(res);
    expect(inv.email).toBe("hollis.grant@reviewers.example");
    const [stored] = await h.repos.table("invitations").find({ workspace_id: WS_FUNDER });
    expect(JSON.stringify(stored)).not.toContain(inv.token);

    const invitee = await auth(h, NEW_USER);
    const accepted = await h.request("/gms/invitations/accept", json(invitee, { token: inv.token }));
    expect(await data<{ role: string }>(accepted)).toMatchObject({ role: "external_reviewer" });
    expect(await h.members.getMembership(WS_FUNDER, NEW_USER)).toMatchObject({ role: "external_reviewer", scope: { competitionIds: ["cmp_1"] } });
    // A token works once.
    expect((await h.request("/gms/invitations/accept", json(invitee, { token: inv.token }))).status).toBe(404);
  });

  it("does not accept an expired invitation", async () => {
    const h = await harness();
    const res = await h.request(`/gms/workspaces/${WS_FUNDER}/invitations`, json(await auth(h, USER_ADMIN), { email: "late@reviewers.example", role: "reviewer", expiresInDays: 1 }));
    const { token } = await data<{ token: string }>(res);
    h.clock.now = new Date(h.clock.now.getTime() + 2 * 86_400_000);
    expect((await h.request("/gms/invitations/accept", json(await auth(h, NEW_USER), { token }))).status).toBe(404);
  });
});

describe("Passport link", () => {
  const tokenFixture: Fixture = { method: "POST", path: "/oauth/token", status: 200, body: { access_token: "passport-access-token-for-tests", token_type: "Bearer", expires_in: 3600, scope: "org:read payee:read" } };
  const sources = (canDebit: boolean): Fixture => ({
    method: "GET",
    path: `/passport/funders/${ORG_RIVERBEND}/sources`,
    status: 200,
    body: { status: 200, message: "Success", items: [{ id: "src_1", orgId: ORG_RIVERBEND, provider: "stripe", status: "verified", statusReason: null, bankName: "River City Credit Union", last4: "5520", canDebit, verifiedAt: "2027-01-12T00:00:00Z", createdAt: "2027-01-10T00:00:00Z" }], paginationInfo: { page: 1, pageSize: 100, totalItems: 1, totalPages: 1 } },
  });
  const creds = { clientId: "pc_riverbend_gms", clientSecret: "passport-client-secret-for-tests" };

  it("verifies the client against Passport, stores the secret encrypted and reports status", async () => {
    const h = await harness();
    const fx = fixtureFetch([tokenFixture, sources(true)]);
    h.passport.fetch = fx.fetch;
    const admin = await auth(h, USER_ADMIN);

    const before = await data<{ linked: boolean; check: { state: string } }>(await h.request(`/gms/workspaces/${WS_FUNDER}/passport/status`, { headers: admin }));
    expect(before).toMatchObject({ linked: false, check: { state: "fail" } });

    const res = await h.request(`/gms/workspaces/${WS_FUNDER}/passport/link`, json(admin, creds));
    expect(res.status).toBe(201);
    const body = await res.text();
    expect(body).not.toContain(creds.clientSecret);
    expect(JSON.parse(body).data).toMatchObject({ linked: true, clientId: creds.clientId, canDebit: true, check: { state: "pass" } });

    const [link] = await h.repos.table("passport_links").find({ workspace_id: WS_FUNDER });
    expect(link!.client_secret_enc).not.toContain(creds.clientSecret);
    expect(link!.scopes).toEqual(["org:read", "payee:read", "award:write", "disbursement:read", "disbursement:write"]);
    // The token request authenticated as the funder's client and asked for exactly those scopes.
    const tokenCall = fx.calls.find((c) => c.path === "/oauth/token")!;
    expect(tokenCall.headers.authorization).toMatch(/^Basic /);

    const status = await data<{ linked: boolean; check: { state: string }; lastOkAt: string }>(await h.request(`/gms/workspaces/${WS_FUNDER}/passport/status`, { headers: admin }));
    expect(status).toMatchObject({ linked: true, check: { state: "pass" } });
    expect((await h.ledger.list({ workspaceId: WS_FUNDER })).map((e) => e.eventType)).toEqual(["passport.linked"]);
    expect(JSON.stringify(await h.ledger.list({ workspaceId: WS_FUNDER }))).not.toContain(creds.clientSecret);
  });

  it("saves nothing when Passport rejects the client, and reports unknown when Passport is down", async () => {
    const h = await harness();
    const admin = await auth(h, USER_ADMIN);
    h.passport.fetch = fixtureFetch([{ method: "POST", path: "/oauth/token", status: 401, body: { error: "invalid_client" } }]).fetch;
    const rejected = await h.request(`/gms/workspaces/${WS_FUNDER}/passport/link`, json(admin, creds));
    expect(rejected.status).toBe(422);
    expect(await h.repos.table("passport_links").count({})).toBe(0);

    h.passport.fetch = fixtureFetch([tokenFixture, sources(false)]).fetch;
    expect((await h.request(`/gms/workspaces/${WS_FUNDER}/passport/link`, json(admin, creds))).status).toBe(201);
    h.passport.fetch = () => Promise.reject(new Error("network down"));
    const status = await data<{ linked: boolean; check: { state: string } }>(await h.request(`/gms/workspaces/${WS_FUNDER}/passport/status`, { headers: admin }));
    expect(status).toMatchObject({ linked: true, check: { state: "unknown" } });
  });

  it("is for funder admins who are signed in: not officers, not API clients, not applicants", async () => {
    const h = await harness();
    h.passport.fetch = fixtureFetch([tokenFixture, sources(true)]).fetch;
    expect((await h.request(`/gms/workspaces/${WS_FUNDER}/passport/link`, json(await auth(h, USER_OFFICER), creds))).status).toBe(403);
    const client = await clientCredentialsToken(h, "workspace:admin");
    const viaClient = await h.request(`/gms/workspaces/${WS_FUNDER}/passport/link`, json(bearer(client).headers, creds));
    expect(((await viaClient.json()) as { errors: { code: string }[] }).errors[0]!.code).toBe("person_required");
    expect((await h.request(`/gms/workspaces/${WS_APPLICANT}/passport/status`, { headers: await auth(h, USER_OFFICER) })).status).toBe(403);
  });

  it("unlinks by revoking, keeping the history", async () => {
    const h = await harness();
    h.passport.fetch = fixtureFetch([tokenFixture, sources(true)]).fetch;
    const admin = await auth(h, USER_ADMIN);
    await h.request(`/gms/workspaces/${WS_FUNDER}/passport/link`, json(admin, creds));
    await h.request(`/gms/workspaces/${WS_FUNDER}/passport/link`, json(admin, { ...creds, clientId: "pc_riverbend_gms_2" }));
    expect((await h.request(`/gms/workspaces/${WS_FUNDER}/passport/link`, { method: "DELETE", headers: admin })).status).toBe(200);
    const links = await h.repos.table("passport_links").find({ workspace_id: WS_FUNDER });
    expect(links).toHaveLength(2);
    expect(links.every((l) => l.revoked_at !== null)).toBe(true);
  });
});

describe("workspace settings an admin may set (NP-03)", () => {
  const server = { passportPayee: { active: false, pendingDestinationChange: { bankName: "Real Bank", last4: "0001", requestedAt: "2027-01-01T00:00:00Z" } }, assistMonthlyQuota: 50, contacts: [{ name: "A", email: "a@riverbendcf.example" }] };
  const setup = async () => {
    const h = await harness();
    await h.repos.table("workspaces").update({ id: WS_FUNDER }, { settings: server });
    const admin = { ...(await auth(h, USER_ADMIN)), "X-GMS-Workspace": WS_FUNDER };
    const patch = (settings: Record<string, unknown>) => h.request(`/gms/workspaces/${WS_FUNDER}`, json(admin, { settings }, "PATCH"));
    const stored = async () => (await h.repos.table("workspaces").one({ id: WS_FUNDER }))!.settings as Record<string, unknown>;
    return { h, patch, stored };
  };

  it.each([
    ["passportPayee", { active: true, pendingDestinationChange: null }],
    ["assistMonthlyQuota", 1_000_000],
    ["contacts", []],
  ])("cannot set or clear %s", async (key, value) => {
    const { patch, stored } = await setup();
    expect((await patch({ [key]: value })).status).toBe(200);
    expect((await stored())[key]).toEqual(server[key as keyof typeof server]);
    expect((await patch({ [key]: null })).status).toBe(200);
    expect((await stored())[key]).toEqual(server[key as keyof typeof server]);
  });

  it("drops keys it does not know, keeps what the server set when a client sends the whole object back", async () => {
    const { patch, stored } = await setup();
    expect((await patch({ ...server, passportPayee: null, invented: "x", gatedTools: ["release_tranche"], transparency: true })).status).toBe(200);
    const s = await stored();
    expect(s).toMatchObject({ ...server, gatedTools: ["release_tranche"], transparency: true });
    expect(s.invented).toBeUndefined();
  });

  it("checks the shape of the keys it allows", async () => {
    const { patch } = await setup();
    expect((await patch({ contactEmail: "not an address" })).status).toBe(422);
    expect((await patch({ defaultRail: "wire" })).status).toBe(422);
    expect((await patch({ contactEmail: "grants@riverbendcf.example", defaultRail: "standard" })).status).toBe(200);
  });
});
