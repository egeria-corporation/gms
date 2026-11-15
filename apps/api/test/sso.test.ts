// SPDX-License-Identifier: AGPL-3.0-only
// Single sign-on for funder workspaces (docs/sso.md): the requirement on and off, other workspaces
// and tokens unaffected, the rule that the admin who turns it on is signed in through SSO, domain
// claiming, the DNS TXT proof against a fake resolver, joining through SSO, and the session claims.
import { SignJWT } from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ssoProvidersOf, verifySupabaseSession } from "../src/auth/session.ts";
import {
  CHALLENGE_PREFIX,
  DOH_ENDPOINT,
  checkChallenge,
  dohResolver,
  emailDomainOf,
  normalizeDomain,
  parseDohTxt,
  parseTxtData,
  serviceProviderOf,
  type TxtResolver,
} from "../src/services/sso.ts";
import { CLIENT_API, SESSION_SECRET, USER_ADMIN, USER_OFFICER, WS_APPLICANT, WS_FUNDER, WS_OTHER, authorizeAs, bearer, clientCredentialsToken, harness, type Harness } from "./helpers.ts";

const DOMAIN = "riverbendcf.org";
const PROVIDER = "5a5a5a5a-1111-4111-8111-5a5a5a5a5a5a";
const OTHER_PROVIDER = "6b6b6b6b-2222-4222-8222-6b6b6b6b6b6b";
const SSO_ADMIN = "a5a5a5a5-aaaa-4aaa-8aaa-a5a5a5a5a5a5";
const SUPABASE = "https://abcdefghijklmnopqrst.supabase.co";

let h: Harness;

/** A Supabase session for `userId` with the given address and, for an SSO sign-in, its `amr` entry. */
async function session(userId: string, opts: { email?: string; provider?: string | null; mfaFirst?: boolean } = {}) {
  const iat = Math.floor(h.clock.now.getTime() / 1000);
  const amr = [
    ...(opts.mfaFirst ? [{ method: "totp", timestamp: iat }] : []),
    opts.provider ? { method: "sso/saml", timestamp: iat - 5, provider: opts.provider } : { method: "otp", timestamp: iat - 5 },
  ];
  return new SignJWT({ aal: "aal2", email: opts.email ?? `person@${DOMAIN}`, role: "authenticated", amr })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(userId)
    .setAudience("authenticated")
    .setIssuedAt(iat)
    .setExpirationTime(iat + 3600)
    .sign(new TextEncoder().encode(SESSION_SECRET));
}

/** A response body read loosely: nested fields by name, leaves compared by the matchers. */
interface Body {
  [key: string]: Body & string;
}

const call = async (token: string, method: string, path: string, opts: { ws?: string; body?: unknown } = {}) => {
  const res = await h.request(path, {
    method,
    headers: { ...bearer(token).headers, ...(opts.ws ? { "X-GMS-Workspace": opts.ws } : {}), ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}) },
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  });
  const json = (await res.json().catch(() => ({}))) as { data?: Body; message?: string; errors?: { code: string }[] };
  return { status: res.status, data: json.data as Body, message: json.message, code: json.errors?.[0]?.code };
};

/** What the operator's gms.activate_sso_domain leaves behind: a proved domain, active with its provider. */
async function activeDomain(workspaceId: string, domain: string, opts: { provider?: string; required?: boolean } = {}) {
  const at = h.clock.now.toISOString();
  return h.repos.table("workspace_sso_domains").insert({ workspace_id: workspaceId, domain, status: "active", require_sso: opts.required ?? false, provider_id: opts.provider ?? PROVIDER, verification_token: "t".repeat(43), verified_at: at, last_checked_at: at, last_check_result: "matched", activated_at: at, created_by: USER_ADMIN });
}

beforeEach(async () => {
  h = await harness();
  h.env.SUPABASE_URL = SUPABASE;
});
afterEach(() => vi.restoreAllMocks());

describe("enforcement", () => {
  it("is off until the workspace requires it", async () => {
    await activeDomain(WS_FUNDER, DOMAIN);
    expect((await call(await session(USER_OFFICER), "GET", "/gms/whoami", { ws: WS_FUNDER })).status).toBe(200);
  });

  it("refuses a session that did not come through the domain's identity provider, and admits one that did", async () => {
    await activeDomain(WS_FUNDER, DOMAIN, { required: true });
    const email = await call(await session(USER_OFFICER), "GET", "/gms/whoami", { ws: WS_FUNDER });
    expect(email).toMatchObject({ status: 403, code: "sso_required", message: "This workspace requires single sign-on" });
    expect((await call(await session(USER_OFFICER, { provider: OTHER_PROVIDER }), "GET", "/gms/whoami", { ws: WS_FUNDER })).code).toBe("sso_required");
    expect((await call(await session(USER_OFFICER, { provider: PROVIDER }), "GET", "/gms/whoami", { ws: WS_FUNDER })).status).toBe(200);
    // With two-step verification on top, the SSO entry is not the first in `amr`; it still counts.
    expect((await call(await session(USER_OFFICER, { provider: PROVIDER, mfaFirst: true }), "GET", "/gms/whoami", { ws: WS_FUNDER })).status).toBe(200);
  });

  it("leaves members on other domains, and the same person's other workspaces, alone", async () => {
    await activeDomain(WS_FUNDER, DOMAIN, { required: true });
    expect((await call(await session(USER_OFFICER, { email: "dana@consultants.example" }), "GET", "/gms/whoami", { ws: WS_FUNDER })).status).toBe(200);
    // USER_OFFICER is also an editor of Alder Creek, which requires nothing.
    expect((await call(await session(USER_OFFICER), "GET", "/gms/whoami", { ws: WS_APPLICANT })).status).toBe(200);
    // A pending domain or an active one that is not required changes nothing either.
    await h.repos.table("workspace_members").insert({ workspace_id: WS_OTHER, user_id: USER_OFFICER, role: "program_officer" });
    await activeDomain(WS_OTHER, "cascadecounty.example");
    expect((await call(await session(USER_OFFICER, { email: "dana@cascadecounty.example" }), "GET", "/gms/whoami", { ws: WS_OTHER })).status).toBe(200);
  });

  it("does not touch API clients, which stay bound to their scopes", async () => {
    await activeDomain(WS_FUNDER, DOMAIN, { required: true });
    const token = await clientCredentialsToken(h, "applications:read");
    const who = await call(token, "GET", "/gms/whoami", { ws: WS_FUNDER });
    expect(who).toMatchObject({ status: 200, data: { kind: "client", clientId: CLIENT_API, scopes: ["applications:read"] } });
    expect((await call(token, "GET", "/gms/sso/settings", { ws: WS_FUNDER })).code).toBe("insufficient_scope");
  });

  it("refuses to connect an agent from a session that skipped single sign-on", async () => {
    // authorizeAs signs in as person@riverbendcf.example with an emailed code.
    await activeDomain(WS_FUNDER, "riverbendcf.example", { required: true });
    const { decision } = await authorizeAs(h, USER_OFFICER);
    expect(decision.status).toBe(403);
    expect(((await decision.json()) as { errors: { code: string }[] }).errors[0]!.code).toBe("sso_required");
  });
});

describe("settings", () => {
  it("shows pending domains, the DNS record and the service-provider values from config", async () => {
    const admin = await session(USER_ADMIN);
    const added = await call(admin, "POST", "/gms/sso/domains", { ws: WS_FUNDER, body: { domain: " RiverbendCF.ORG. " } });
    expect(added).toMatchObject({ status: 201, data: { domain: DOMAIN, status: "pending", stage: "add_dns_record", required: false, dns: { recordType: "TXT", recordName: `_gms-verify.${DOMAIN}` } } });
    expect(added.data.dns!.recordValue).toMatch(/^gms-verify=[A-Za-z0-9_-]{43}$/);
    const settings = await call(admin, "GET", "/gms/sso/settings", { ws: WS_FUNDER });
    expect(settings.data).toMatchObject({
      requireSso: false,
      canRequire: { ok: false },
      session: { signedInThroughSso: false },
      serviceProvider: { entityId: `${SUPABASE}/auth/v1/sso/saml/metadata`, metadataUrl: `${SUPABASE}/auth/v1/sso/saml/metadata`, metadataDownloadUrl: `${SUPABASE}/auth/v1/sso/saml/metadata?download=true`, acsUrl: `${SUPABASE}/auth/v1/sso/saml/acs` },
    });
    expect(settings.data.domains).toHaveLength(1);
    expect(h.ledger.events.some((e) => e.eventType === "sso_domain.added")).toBe(true);
  });

  it("is for admins of funder workspaces, and changed only by a signed-in person", async () => {
    expect((await call(await session(USER_OFFICER), "GET", "/gms/sso/settings", { ws: WS_FUNDER })).code).toBe("insufficient_scope");
    expect((await call(await session(USER_OFFICER), "GET", "/gms/sso/settings", { ws: WS_APPLICANT })).status).toBe(403);
    const client = await clientCredentialsToken(h, "workspace:admin");
    expect((await call(client, "GET", "/gms/sso/settings", { ws: WS_FUNDER })).status).toBe(200);
    expect((await call(client, "POST", "/gms/sso/domains", { ws: WS_FUNDER, body: { domain: DOMAIN } })).code).toBe("human_only");
    expect((await call(client, "PUT", "/gms/sso/requirement", { ws: WS_FUNDER, body: { require: false } })).code).toBe("human_only");
  });

  it("refuses bad domains and a domain another workspace has active, but lets two workspaces hold it pending", async () => {
    const admin = await session(USER_ADMIN);
    expect((await call(admin, "POST", "/gms/sso/domains", { ws: WS_FUNDER, body: { domain: "https://riverbendcf.example/x" } })).code).toBe("invalid_domain");
    expect((await call(admin, "POST", "/gms/sso/domains", { ws: WS_FUNDER, body: { domain: "co.uk" } })).code).toBe("invalid_domain");
    expect((await call(admin, "POST", "/gms/sso/domains", { ws: WS_FUNDER, body: { domain: "intranet.local" } })).code).toBe("invalid_domain");
    expect((await call(admin, "POST", "/gms/sso/domains", { ws: WS_FUNDER, body: { domain: "riverbend.org" } })).status).toBe(201);
    expect((await call(admin, "POST", "/gms/sso/domains", { ws: WS_FUNDER, body: { domain: "RIVERBEND.ORG" } })).code).toBe("domain_exists");
    await activeDomain(WS_OTHER, "cascade.org");
    expect((await call(admin, "POST", "/gms/sso/domains", { ws: WS_FUNDER, body: { domain: "cascade.org" } })).code).toBe("domain_in_use");
    // Pending elsewhere does not block: nobody can hold a domain hostage by adding it first.
    await h.repos.table("workspace_members").insert({ workspace_id: WS_OTHER, user_id: USER_ADMIN, role: "admin" });
    expect((await call(admin, "POST", "/gms/sso/domains", { ws: WS_OTHER, body: { domain: "riverbend.org" } })).status).toBe(201);
  });

  it("removes a domain, and only in its own workspace", async () => {
    const admin = await session(USER_ADMIN);
    const added = await call(admin, "POST", "/gms/sso/domains", { ws: WS_FUNDER, body: { domain: "riverbend.org" } });
    await h.repos.table("workspace_members").insert({ workspace_id: WS_OTHER, user_id: USER_ADMIN, role: "admin" });
    expect((await call(admin, "DELETE", `/gms/sso/domains/${added.data.id}`, { ws: WS_OTHER })).status).toBe(404);
    expect((await call(admin, "DELETE", `/gms/sso/domains/${added.data.id}`, { ws: WS_FUNDER })).data).toMatchObject({ removed: true, domain: "riverbend.org" });
    expect(await h.repos.table("workspace_sso_domains").count({ workspace_id: WS_FUNDER })).toBe(0);
  });
});

describe("requiring single sign-on (no lockout)", () => {
  it("needs an active domain and an admin signed in through it; turning it off is always allowed", async () => {
    const pending = await session(USER_ADMIN, { provider: PROVIDER });
    await call(pending, "POST", "/gms/sso/domains", { ws: WS_FUNDER, body: { domain: "riverbend.org" } });
    expect((await call(pending, "PUT", "/gms/sso/requirement", { ws: WS_FUNDER, body: { require: true } })).code).toBe("no_active_domain");

    await activeDomain(WS_FUNDER, DOMAIN);
    const byEmail = await call(await session(USER_ADMIN), "PUT", "/gms/sso/requirement", { ws: WS_FUNDER, body: { require: true } });
    expect(byEmail).toMatchObject({ status: 409, code: "sso_session_required" });
    expect((await call(await session(USER_ADMIN, { provider: OTHER_PROVIDER }), "PUT", "/gms/sso/requirement", { ws: WS_FUNDER, body: { require: true } })).code).toBe("sso_session_required");

    const sso = await session(USER_ADMIN, { provider: PROVIDER });
    expect((await call(sso, "GET", "/gms/sso/settings", { ws: WS_FUNDER })).data).toMatchObject({ canRequire: { ok: true }, session: { signedInThroughSso: true } });
    expect((await call(sso, "PUT", "/gms/sso/requirement", { ws: WS_FUNDER, body: { require: true } })).data).toMatchObject({ requireSso: true, requiredDomains: [DOMAIN] });
    // The pending domain is not required: nobody can sign in through it yet.
    const rows = await h.repos.table("workspace_sso_domains").find({ workspace_id: WS_FUNDER });
    expect(rows.map((r) => [r.domain, r.require_sso]).sort()).toEqual([["riverbend.org", false], [DOMAIN, true]]);
    expect(h.ledger.events.some((e) => e.eventType === "sso.required")).toBe(true);

    // The admin who turned it on is still in; the same admin by email code is not.
    expect((await call(sso, "GET", "/gms/whoami", { ws: WS_FUNDER })).status).toBe(200);
    expect((await call(await session(USER_ADMIN), "GET", "/gms/whoami", { ws: WS_FUNDER })).code).toBe("sso_required");

    expect((await call(sso, "PUT", "/gms/sso/requirement", { ws: WS_FUNDER, body: { require: false } })).data).toMatchObject({ requireSso: false, requiredDomains: [] });
    expect((await call(await session(USER_ADMIN), "GET", "/gms/whoami", { ws: WS_FUNDER })).status).toBe(200);
  });

  it("an admin whose own address is on an active domain must have come through that domain's provider", async () => {
    await activeDomain(WS_FUNDER, DOMAIN, { provider: PROVIDER });
    await activeDomain(WS_FUNDER, "riverbend.org", { provider: OTHER_PROVIDER });
    // Signed in through riverbend.org's provider, but the admin's address is on riverbendcf.example.
    expect((await call(await session(USER_ADMIN, { provider: OTHER_PROVIDER }), "PUT", "/gms/sso/requirement", { ws: WS_FUNDER, body: { require: true } })).code).toBe("sso_session_required");
  });
});

describe("DNS TXT proof", () => {
  const fake = (answers: Record<string, string[]>): TxtResolver => async (name) => ({ status: answers[name] ? 0 : 3, records: answers[name] ?? [] });

  it("matches the record at _gms-verify, or at the domain itself", async () => {
    expect(await checkChallenge(DOMAIN, "tok", fake({ [`_gms-verify.${DOMAIN}`]: [`${CHALLENGE_PREFIX}tok`] }))).toEqual({ result: "matched", at: `_gms-verify.${DOMAIN}` });
    expect(await checkChallenge(DOMAIN, "tok", fake({ [DOMAIN]: ["v=spf1 -all", `${CHALLENGE_PREFIX}tok`] }))).toEqual({ result: "matched", at: DOMAIN });
    expect(await checkChallenge(DOMAIN, "tok", fake({ [DOMAIN]: [`${CHALLENGE_PREFIX}other`] }))).toEqual({ result: "mismatch", found: 1 });
    expect(await checkChallenge(DOMAIN, "tok", fake({}))).toEqual({ result: "not_found" });
  });

  it("checks through Cloudflare's DNS over HTTPS and records the proof", async () => {
    const admin = await session(USER_ADMIN);
    const added = await call(admin, "POST", "/gms/sso/domains", { ws: WS_FUNDER, body: { domain: DOMAIN } });
    const value = added.data.dns!.recordValue as string;
    const asked: string[] = [];
    let published = false;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = new URL(String(input));
      asked.push(`${url.origin}${url.pathname}?${url.searchParams.get("name")}`);
      const name = url.searchParams.get("name")!;
      const data = published && name === `_gms-verify.${DOMAIN}` ? [{ name, type: 16, TTL: 300, data: `"${value}"` }] : [];
      return new Response(JSON.stringify({ Status: data.length ? 0 : 3, Answer: data }), { headers: { "Content-Type": "application/dns-json" } });
    });

    const first = await call(admin, "POST", `/gms/sso/domains/${added.data.id}/check`, { ws: WS_FUNDER });
    expect(first.data).toMatchObject({ check: { result: "not_found" }, domain: { stage: "add_dns_record", verifiedAt: null } });
    expect(asked).toEqual([`${DOH_ENDPOINT}?_gms-verify.${DOMAIN}`, `${DOH_ENDPOINT}?${DOMAIN}`]);

    // A second check within ten seconds answers from the last result without asking DNS again.
    published = true;
    expect((await call(admin, "POST", `/gms/sso/domains/${added.data.id}/check`, { ws: WS_FUNDER })).data.check!.result).toBe("not_found");
    expect(asked).toHaveLength(2);

    h.clock.now = new Date(h.clock.now.getTime() + 11_000);
    const second = await call(admin, "POST", `/gms/sso/domains/${added.data.id}/check`, { ws: WS_FUNDER });
    expect(second.data).toMatchObject({ check: { result: "matched" }, domain: { stage: "waiting_for_provider", status: "pending" } });
    expect(h.ledger.events.filter((e) => e.eventType === "sso_domain.verified")).toHaveLength(1);
  });

  it("records a resolver failure as an error, not as proof", async () => {
    const admin = await session(USER_ADMIN);
    const added = await call(admin, "POST", "/gms/sso/domains", { ws: WS_FUNDER, body: { domain: DOMAIN } });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("busy", { status: 503 }));
    expect((await call(admin, "POST", `/gms/sso/domains/${added.data.id}/check`, { ws: WS_FUNDER })).data).toMatchObject({ check: { result: "error" }, domain: { verifiedAt: null, lastCheckResult: "error" } });
  });

  it("parses DoH answers", async () => {
    expect(parseTxtData('"gms-verify=" "abc"')).toBe("gms-verify=abc");
    expect(parseTxtData('"a\\"b\\065"')).toBe('a"bA');
    expect(parseDohTxt({ Status: 0, Answer: [{ type: 16, data: '"x"' }, { type: 5, data: "cname." }] })).toEqual({ status: 0, records: ["x"] });
    const servfail = dohResolver(async () => new Response(JSON.stringify({ Status: 2 }), { status: 200 }));
    await expect(servfail("example.org")).rejects.toThrow(/RCODE 2/);
    const notJson = dohResolver(async () => new Response("<html>", { status: 200 }));
    await expect(notJson("example.org")).rejects.toThrow(/not answer with JSON/);
  });
});

describe("joining through single sign-on", () => {
  it("gives the SSO account the role the person's email-code account holds, once, and only through the domain's provider", async () => {
    await activeDomain(WS_FUNDER, DOMAIN, { required: true });
    // Helen's email-code account (USER_ADMIN) holds the admin role; her SSO account is SSO_ADMIN.
    h.directory.users.set(USER_ADMIN, { email: "helen.ortiz@riverbendcf.org", name: "Helen Ortiz" });
    const email = "Helen.Ortiz@riverbendcf.org";

    expect((await call(await session(SSO_ADMIN, { email }), "POST", "/gms/sso/join")).code).toBe("sso_session_required");
    expect((await call(await session(SSO_ADMIN, { email, provider: OTHER_PROVIDER }), "POST", "/gms/sso/join")).data).toEqual({ joined: [] });

    const sso = await session(SSO_ADMIN, { email, provider: PROVIDER });
    expect((await call(sso, "POST", "/gms/sso/join")).data).toEqual({ joined: [{ workspaceId: WS_FUNDER, handle: "riverbend", name: "Riverbend Community Foundation", role: "admin" }] });
    expect(await h.repos.table("workspace_members").one({ workspace_id: WS_FUNDER, user_id: SSO_ADMIN })).toMatchObject({ role: "admin", scope: { joinedThrough: "sso" } });
    expect(h.ledger.events.find((e) => e.eventType === "member.joined_through_sso")?.data).toMatchObject({ userId: SSO_ADMIN, fromUserId: USER_ADMIN, role: "admin", providerId: PROVIDER });
    expect((await call(sso, "POST", "/gms/sso/join")).data).toEqual({ joined: [] });
    expect((await call(sso, "GET", "/gms/whoami", { ws: WS_FUNDER })).data).toMatchObject({ userId: SSO_ADMIN, role: "admin" });
  });

  it("creates nothing for an address no member holds", async () => {
    await activeDomain(WS_FUNDER, DOMAIN);
    const sso = await session(SSO_ADMIN, { email: `new.person@${DOMAIN}`, provider: PROVIDER });
    expect((await call(sso, "POST", "/gms/sso/join")).data).toEqual({ joined: [] });
    expect(await h.repos.table("workspace_members").count({ user_id: SSO_ADMIN })).toBe(0);
  });
});

describe("session claims", () => {
  it("reads every sso/saml entry of amr, whatever its position", async () => {
    expect(ssoProvidersOf([{ method: "totp", timestamp: 2 }, { method: "sso/saml", timestamp: 1, provider: PROVIDER.toUpperCase() }])).toEqual([PROVIDER]);
    expect(ssoProvidersOf([{ method: "otp", timestamp: 1 }])).toEqual([]);
    expect(ssoProvidersOf(["sso/saml"])).toEqual([]);
    expect(ssoProvidersOf([{ method: "sso/saml", provider: "not-a-uuid" }])).toEqual([]);
    expect(ssoProvidersOf(undefined)).toEqual([]);
    const user = await verifySupabaseSession(await session(USER_ADMIN, { provider: PROVIDER }), { jwtSecret: SESSION_SECRET }, h.clock.now);
    expect(user.ssoProviderIds).toEqual([PROVIDER]);
    expect((await verifySupabaseSession(await session(USER_ADMIN), { jwtSecret: SESSION_SECRET }, h.clock.now)).ssoProviderIds).toBeUndefined();
  });

  it("derives addresses and domains", () => {
    expect(emailDomainOf("A@Sub.Example.ORG")).toBe("sub.example.org");
    expect(emailDomainOf("nobody")).toBeNull();
    expect(normalizeDomain("bücher.example.org")).toBe("xn--bcher-kva.example.org");
    expect(serviceProviderOf(`${SUPABASE}/`)).toMatchObject({ acsUrl: `${SUPABASE}/auth/v1/sso/saml/acs` });
    expect(serviceProviderOf(undefined)).toBeNull();
  });
});
