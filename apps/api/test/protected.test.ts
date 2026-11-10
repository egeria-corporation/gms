// SPDX-License-Identifier: AGPL-3.0-only
import { record } from "@gms/ledger";
import { generateKeyPair } from "jose";
import { describe, expect, it } from "vitest";
import { WORKSPACE_HEADER } from "../src/auth/middleware.ts";
import { WORKSPACE_CLAIM } from "../src/auth/scopes.ts";
import { BASE, USER_ADMIN, USER_AUDITOR, USER_OFFICER, WS_FUNDER, WS_OTHER, bearer, clientCredentialsToken, harness } from "./helpers.ts";

const code = async (res: Response) => ((await res.json()) as { errors: { code: string }[] }).errors[0]!.code;

async function seeded() {
  const h = await harness();
  const at = { now: () => h.clock.now };
  await record(h.ledger, { workspaceId: WS_FUNDER, actor: { kind: "user", userId: USER_ADMIN }, eventType: "award.created", subjectType: "award", subjectId: "awd_1" }, at);
  await record(h.ledger, { workspaceId: WS_FUNDER, actor: { kind: "passport" }, eventType: "tranche.status_changed", subjectType: "tranche", subjectId: "trn_1", data: { to: "settled" } }, at);
  await record(h.ledger, { workspaceId: WS_OTHER, actor: { kind: "system", job: "seed" }, eventType: "award.created", subjectType: "award", subjectId: "awd_other" }, at);
  return h;
}

describe("the seven-step check on a protected route (GET /gms/ledger)", () => {
  it("serves the caller's workspace ledger to a client-credentials token with the right scope", async () => {
    const h = await seeded();
    const res = await h.request("/gms/ledger", bearer(await clientCredentialsToken(h)));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: number; items: { subjectId: string }[]; paginationInfo: Record<string, number> };
    expect(body.items.map((e) => e.subjectId)).toEqual(["awd_1", "trn_1"]);
    expect(body.paginationInfo).toEqual({ page: 1, pageSize: 100, totalItems: 2, totalPages: 1 });
  });

  it("1. rejects a missing or malformed token", async () => {
    const h = await seeded();
    const none = await h.request("/gms/ledger");
    expect(none.status).toBe(401);
    expect(none.headers.get("WWW-Authenticate")).toContain('Bearer realm="gms"');
    expect(await code(none)).toBe("missing_token");
    expect((await h.request("/gms/ledger", bearer("not-a-jwt"))).status).toBe(401);
  });

  it("2. rejects a token whose typ is not an access token", async () => {
    const h = await seeded();
    expect(await code(await h.request("/gms/ledger", bearer(await h.forge({}, { typ: "gms-authz-request+jwt" }))))).toBe("invalid_token");
  });

  it("3. rejects a token signed by another key", async () => {
    const h = await seeded();
    const { privateKey } = await generateKeyPair("ES256");
    const res = await h.request("/gms/ledger", bearer(await h.forge({}, { key: privateKey })));
    expect(res.status).toBe(401);
    expect(await code(res)).toBe("invalid_signature");
  });

  it("4. rejects an untrusted issuer", async () => {
    const h = await seeded();
    expect(await code(await h.request("/gms/ledger", bearer(await h.forge({ iss: "https://passport.opengrants.io" }))))).toBe("untrusted_issuer");
  });

  it("5. rejects a token minted for another audience", async () => {
    const h = await seeded();
    const res = await h.request("/gms/ledger", bearer(await h.forge({ aud: "https://passport.opengrants.io" })));
    expect(res.status).toBe(401);
    expect(await code(res)).toBe("invalid_audience");
  });

  it("6. rejects an expired token and one not yet valid", async () => {
    const h = await seeded();
    const token = await clientCredentialsToken(h);
    h.clock.now = new Date(h.clock.now.getTime() + 3_661_000);
    const res = await h.request("/gms/ledger", bearer(token));
    expect(res.status).toBe(401);
    expect(await code(res)).toBe("token_expired");
    const future = Math.floor(h.clock.now.getTime() / 1000) + 3600;
    expect((await h.request("/gms/ledger", bearer(await h.forge({ nbf: future, exp: future + 600 })))).status).toBe(401);
  });

  it("7a. rejects a token without the required scope", async () => {
    const h = await seeded();
    const res = await h.request("/gms/ledger", bearer(await clientCredentialsToken(h, "applications:read")));
    expect(res.status).toBe(403);
    expect(await code(res)).toBe("insufficient_scope");
    expect(res.headers.get("WWW-Authenticate")).toContain('scope="workspace:admin"');
  });

  it("7b. rejects a token used against another workspace, and a token bound to none", async () => {
    const h = await seeded();
    const res = await h.request("/gms/ledger", bearer(await clientCredentialsToken(h), { [WORKSPACE_HEADER]: WS_OTHER }));
    expect(res.status).toBe(403);
    expect(await code(res)).toBe("workspace_mismatch");
    expect(await code(await h.request("/gms/ledger", bearer(await h.forge({ [WORKSPACE_CLAIM]: undefined }))))).toBe("workspace_required");
    // A token for the other workspace never sees this workspace's rows.
    const other = await h.request("/gms/ledger", bearer(await h.forge({ [WORKSPACE_CLAIM]: WS_OTHER })));
    expect(((await other.json()) as { items: { subjectId: string }[] }).items.map((e) => e.subjectId)).toEqual(["awd_other"]);
  });
});

describe("signed-in people", () => {
  it("admins and auditors read the ledger; program officers do not", async () => {
    const h = await seeded();
    const get = async (userId: string) => h.request("/gms/ledger", bearer(await h.session(userId), { [WORKSPACE_HEADER]: WS_FUNDER }));
    expect((await get(USER_ADMIN)).status).toBe(200);
    expect((await get(USER_AUDITOR)).status).toBe(200);
    const officer = await get(USER_OFFICER);
    expect(officer.status).toBe(403);
    expect(await code(officer)).toBe("insufficient_role");
  });

  it("needs a workspace, a membership, MFA where the role demands it, and a live session", async () => {
    const h = await seeded();
    const session = await h.session(USER_ADMIN);
    expect(await code(await h.request("/gms/ledger", bearer(session)))).toBe("workspace_required");
    expect(await code(await h.request("/gms/ledger", bearer(session, { [WORKSPACE_HEADER]: WS_OTHER })))).toBe("workspace_mismatch");
    expect(await code(await h.request("/gms/ledger", bearer(await h.session(USER_ADMIN, { aal: "aal1" }), { [WORKSPACE_HEADER]: WS_FUNDER })))).toBe("mfa_required");
    const stale = await h.session(USER_ADMIN, { exp: Math.floor(h.clock.now.getTime() / 1000) - 3600 });
    expect((await h.request("/gms/ledger", bearer(stale, { [WORKSPACE_HEADER]: WS_FUNDER }))).status).toBe(401);
  });

  it("expired memberships lose access", async () => {
    const h = await seeded();
    h.members.memberships.find((m) => m.userId === USER_AUDITOR)!.expiresAt = new Date(h.clock.now.getTime() - 1000).toISOString();
    expect(await code(await h.request("/gms/ledger", bearer(await h.session(USER_AUDITOR), { [WORKSPACE_HEADER]: WS_FUNDER })))).toBe("membership_expired");
  });

  it("GET /gms/me lists the person's workspaces", async () => {
    const h = await seeded();
    const res = await h.request("/gms/me", bearer(await h.session(USER_OFFICER)));
    const { data } = (await res.json()) as { data: { workspaces: { kind: string; role: string }[] } };
    expect(data.workspaces.map((w) => `${w.kind}:${w.role}`).sort()).toEqual(["applicant:editor", "funder:program_officer"]);
    expect(BASE).toBeTruthy();
  });
});
