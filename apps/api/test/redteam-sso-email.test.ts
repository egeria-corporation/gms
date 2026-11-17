// SPDX-License-Identifier: AGPL-3.0-only
// Red team: a SAML identity provider can assert any email address (docs/sso.md), and parts of the
// GMS act on a session's address. Riverbend's domain is registered for provider A and Cascade
// County's for provider B. Provider A's session asserting someone else's address, on a domain A was
// never registered for, must be refused at every place that authorizes or links by email:
//   * centrally: every route that accepts a person's session (auth/middleware.ts, `personSession`);
//   * workspace, draft, guest reviewer and award invitations, and peer-funder links;
//   * the gallery's and the partner directory's moderators (email entries never match an SSO session);
//   * joining a workspace through single sign-on;
// and the right-domain session still works. Sign in with Passport never adopts an SSO account by
// its address (passport-signin.test.ts, identity-port.test.ts).
import { SignJWT } from "jose";
import { beforeEach, describe, expect, it } from "vitest";
import { assertSsoEmailBound } from "../src/services/sso.ts";
import { SESSION_SECRET, USER_ADMIN, WS_APPLICANT, WS_FUNDER, WS_OTHER, bearer, harness, type Harness } from "./helpers.ts";
import { scenario, type Scenario } from "./scenario.ts";

const SUPABASE = "https://abcdefghijklmnopqrst.supabase.co";
const PROVIDER_A = "a1a1a1a1-1111-4111-8111-a1a1a1a1a1a1";
const PROVIDER_B = "b2b2b2b2-2222-4222-8222-b2b2b2b2b2b2";
const PROVIDER_C = "c3c3c3c3-3333-4333-8333-c3c3c3c3c3c3";
const RIVERBEND = "riverbendcf.org";
const CASCADE = "cascadecounty.example";
/** The account an identity provider made: a new Supabase user, whatever address it asserted. */
const SSO_USER = "5e5e5e5e-5555-4555-8555-5e5e5e5e5e5e";

let h: Harness;
let s: Scenario;

/** A Supabase session asserting `email`, through `provider` (single sign-on) or by email code (`null`). */
async function session(userId: string, email: string | null, provider: string | null) {
  const iat = Math.floor(h.clock.now.getTime() / 1000);
  const amr = provider ? [{ method: "sso/saml", timestamp: iat, provider }] : [{ method: "otp", timestamp: iat }];
  return new SignJWT({ aal: "aal2", ...(email ? { email } : {}), role: "authenticated", amr }).setProtectedHeader({ alg: "HS256", typ: "JWT" }).setSubject(userId).setAudience("authenticated").setIssuedAt(iat).setExpirationTime(iat + 3600).sign(new TextEncoder().encode(SESSION_SECRET));
}
async function call(token: string, method: string, path: string, opts: { ws?: string; body?: unknown; lang?: string } = {}) {
  const res = await h.request(path, {
    method,
    headers: { ...bearer(token).headers, ...(opts.ws ? { "X-GMS-Workspace": opts.ws } : {}), ...(opts.lang ? { "Accept-Language": opts.lang } : {}), ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}) },
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  });
  const json = (await res.json().catch(() => ({}))) as { data?: Record<string, unknown>; message?: string; errors?: { code: string; detailLocalized?: string }[] };
  return { status: res.status, code: json.errors?.[0]?.code, data: json.data as Record<string, unknown> & { token?: string }, message: json.message, detail: json.errors?.[0]?.detailLocalized };
}
async function activeDomain(workspaceId: string, domain: string, provider: string, status: "active" | "pending" = "active") {
  const at = h.clock.now.toISOString();
  await h.repos.table("workspace_sso_domains").insert({ workspace_id: workspaceId, domain, status, require_sso: false, provider_id: provider, verification_token: "t".repeat(43), verified_at: at, last_checked_at: at, last_check_result: "matched", activated_at: status === "active" ? at : null, created_by: USER_ADMIN });
}
const refused = (r: { status: number; code?: string }) => expect({ status: r.status, code: r.code }).toEqual({ status: 403, code: "sso_domain_mismatch" });

beforeEach(async () => {
  h = await harness();
  h.env.SUPABASE_URL = SUPABASE;
  s = await scenario(h);
  await activeDomain(WS_FUNDER, RIVERBEND, PROVIDER_A);
  await activeDomain(WS_OTHER, CASCADE, PROVIDER_B);
  h.mailer.sent.length = 0;
});

describe("centrally: a single sign-on session speaks only for addresses on its provider's domains", () => {
  it("refuses provider A's session asserting an address on B's domain, on every kind of route, before the address is read", async () => {
    const forged = await session(SSO_USER, `dana@${CASCADE}`, PROVIDER_A);
    for (const [method, path, ws] of [
      ["GET", "/gms/me"],
      ["GET", "/gms/workspaces"],
      ["GET", "/gms/whoami", WS_FUNDER],
      ["GET", "/gms/whoami", WS_OTHER],
      ["GET", "/gms/gallery/moderation/me"],
      ["GET", "/gms/partners/moderation/me"],
      ["POST", "/gms/sso/join"],
      ["GET", "/oauth/authorize/request?req=anything"],
    ] as [string, string, string?][]) {
      const r = await call(forged, method, path, { ws, ...(method === "POST" ? { body: {} } : {}) });
      expect({ path, status: r.status, code: r.code }).toEqual({ path, status: 403, code: "sso_domain_mismatch" });
    }
    // The migration-request form accepts no token at all, or a person's own session: not this one.
    refused(await call(forged, "POST", "/gms/migration-requests/preview", { body: {} }));
  });

  it("refuses an address on no registered domain, a domain still pending, and a session with no address", async () => {
    refused(await call(await session(SSO_USER, "someone@gmail.com", PROVIDER_A), "GET", "/gms/me"));
    await activeDomain(WS_FUNDER, "riverbend.example", PROVIDER_A, "pending");
    refused(await call(await session(SSO_USER, "helen@riverbend.example", PROVIDER_A), "GET", "/gms/me"));
    refused(await call(await session(SSO_USER, null, PROVIDER_A), "GET", "/gms/me"));
  });

  it("says why in the person's language", async () => {
    const r = await call(await session(SSO_USER, `dana@${CASCADE}`, PROVIDER_A), "GET", "/gms/me", { lang: "es" });
    expect(r.message).toBe("Your organization's single sign-on cannot sign you in with this email address. Sign in with a code sent to your email instead");
    expect(r.detail).toBe("El inicio de sesión único de su organización no puede iniciar su sesión con esta dirección de correo electrónico. Inicie sesión con un código enviado a su correo electrónico.");
  });

  it("admits the right-domain session, any address by email code, and API tokens are untouched", async () => {
    expect((await call(await session(SSO_USER, `Helen.Ortiz@${RIVERBEND.toUpperCase()}`, PROVIDER_A), "GET", "/gms/me")).status).toBe(200);
    expect((await call(await session(SSO_USER, `dana@${CASCADE}`, PROVIDER_B), "GET", "/gms/me")).status).toBe(200);
    // With two providers in amr, one registered for the address's domain is enough.
    const iat = Math.floor(h.clock.now.getTime() / 1000);
    const both = await new SignJWT({ aal: "aal2", email: `dana@${CASCADE}`, role: "authenticated", amr: [{ method: "sso/saml", timestamp: iat, provider: PROVIDER_A }, { method: "sso/saml", timestamp: iat - 1, provider: PROVIDER_B }] }).setProtectedHeader({ alg: "HS256", typ: "JWT" }).setSubject(SSO_USER).setAudience("authenticated").setIssuedAt(iat).setExpirationTime(iat + 3600).sign(new TextEncoder().encode(SESSION_SECRET));
    expect((await call(both, "GET", "/gms/me")).status).toBe(200);
    expect((await call(await session(SSO_USER, `dana@${CASCADE}`, null), "GET", "/gms/me")).status).toBe(200);
  });

  it("follows the registration: a removed domain stops admitting its provider's sessions", async () => {
    const helen = await session(SSO_USER, `helen@${RIVERBEND}`, PROVIDER_A);
    expect((await call(helen, "GET", "/gms/me")).status).toBe(200);
    await h.repos.table("workspace_sso_domains").remove({ domain: RIVERBEND });
    refused(await call(helen, "GET", "/gms/me"));
  });

  it("is one check, readable on its own", async () => {
    await expect(assertSsoEmailBound(h.repos, { email: `dana@${CASCADE}`, ssoProviderIds: [PROVIDER_B] })).resolves.toBeUndefined();
    await expect(assertSsoEmailBound(h.repos, { email: `dana@${CASCADE}` })).resolves.toBeUndefined();
    await expect(assertSsoEmailBound(h.repos, { email: `dana@${CASCADE}`, ssoProviderIds: [PROVIDER_A] })).rejects.toMatchObject({ status: 403, code: "sso_domain_mismatch" });
    await expect(assertSsoEmailBound(h.repos, { email: "not-an-address", ssoProviderIds: [PROVIDER_A] })).rejects.toMatchObject({ code: "sso_domain_mismatch" });
  });
});

describe("invitations: an SSO session asserting the invitee's address cannot accept", () => {
  it("a workspace invitation (token only): refused to A's session for the invitee's address on B's domain; B's accepts", async () => {
    const invited = `new.officer@${CASCADE}`;
    const inv = await call((await h.session(USER_ADMIN)) as string, "POST", `/gms/workspaces/${WS_FUNDER}/invitations`, { ws: WS_FUNDER, body: { email: invited, role: "program_officer" } });
    expect(inv.status).toBe(201);
    refused(await call(await session(SSO_USER, invited, PROVIDER_A), "POST", "/gms/invitations/accept", { body: { token: inv.data.token } }));
    expect(await h.repos.table("workspace_members").one({ workspace_id: WS_FUNDER, user_id: SSO_USER })).toBeNull();
    expect((await h.repos.table("invitations").find({ workspace_id: WS_FUNDER }))[0]!.accepted_at).toBeNull();
    const ok = await call(await session(SSO_USER, invited, PROVIDER_B), "POST", "/gms/invitations/accept", { body: { token: inv.data.token } });
    expect(ok.status).toBe(200);
    expect(await h.repos.table("workspace_members").one({ workspace_id: WS_FUNDER, user_id: SSO_USER })).toMatchObject({ role: "program_officer" });
  });

  it("a draft invitation (matched by address): refused to a provider that was not registered for the invitee's domain; the registered one accepts", async () => {
    const cowriter = "lena@fischergrants.example";
    const oa = (await s.call<{ data: { id: string } }>(s.applicant, "POST", "/gms/outside-applications", { title: "Rural clinics 2027", funderName: "Northwind Family Foundation", fullDue: "2027-06-01", stage: "drafting" })).body.data;
    const qs = (await s.call<{ data: { id: string }[] }>(s.applicant, "POST", `/gms/outside-applications/${oa.id}/questions`, { questions: [{ prompt: "Describe the need your project addresses." }] })).body.data;
    expect((await s.call(s.applicant, "POST", "/gms/draft-invitations", { email: cowriter, draft: { kind: "outside_application", id: oa.id, questionId: qs[0]!.id } })).status).toBe(201);
    const mail = [...h.mailer.sent].reverse().find((m) => m.to.includes(cowriter))!;
    const token = new URL(mail.text.match(/https:\/\/\S+/)![0]).searchParams.get("token")!;
    for (const p of [PROVIDER_A, PROVIDER_B]) refused(await call(await session(SSO_USER, cowriter, p), "POST", "/gms/invitations/accept", { body: { token } }));
    expect(await h.repos.table("workspace_members").one({ workspace_id: WS_APPLICANT, user_id: SSO_USER })).toBeNull();
    // Fischer Grants' own identity provider, registered for its domain, speaks for its address.
    await activeDomain(WS_OTHER, "fischergrants.example", PROVIDER_C);
    const ok = await call(await session(SSO_USER, cowriter, PROVIDER_C), "POST", "/gms/invitations/accept", { body: { token } });
    expect(ok.status).toBe(200);
    expect(ok.data).toMatchObject({ role: "consultant" });
  });

  it("a guest reviewer invitation: refused to A's session for the reviewer's address", async () => {
    const reviewer = `hollis@${CASCADE}`;
    const inv = await call((await h.session(USER_ADMIN)) as string, "POST", "/gms/review-assignments/invite", { ws: WS_FUNDER, body: { email: reviewer, competitionId: s.compId } });
    expect(inv.status).toBe(201);
    refused(await call(await session(SSO_USER, reviewer, PROVIDER_A), "POST", "/gms/invitations/accept", { body: { token: inv.data.token } }));
    expect(await h.repos.table("workspace_members").count({ user_id: SSO_USER })).toBe(0);
    expect((await call(await session(SSO_USER, reviewer, PROVIDER_B), "POST", "/gms/invitations/accept", { body: { token: inv.data.token } })).data).toMatchObject({ role: "external_reviewer" });
  });

  it("an award invitation (matched by address): lookup, accept and decline refused to A's session; B's sees it is for them", async () => {
    const invited = `jo.grant@${CASCADE}`;
    const award = await call((await h.session(USER_ADMIN)) as string, "POST", "/gms/awards/direct", { ws: WS_FUNDER, body: { recipient: { organizationName: "Alder Creek Family Services", contactEmail: invited }, title: "Emergency operating support", amount: { value: "25000.00", currency: "USD" }, startDate: "2027-05-01", endDate: "2028-04-30" } });
    expect(award.status).toBe(201);
    const mail = [...h.mailer.sent].reverse().find((m) => m.text.includes("/awards/claim#token="))!;
    const token = decodeURIComponent(/\/awards\/claim#token=([^\s]+)/.exec(mail.text)![1]!);
    await h.repos.table("workspace_members").insert({ workspace_id: WS_APPLICANT, user_id: SSO_USER, role: "admin" });
    const forged = await session(SSO_USER, invited, PROVIDER_A);
    refused(await call(forged, "POST", "/gms/award-invitations/lookup", { body: { token } }));
    refused(await call(forged, "POST", "/gms/award-invitations/accept", { body: { token, workspaceId: WS_APPLICANT } }));
    refused(await call(forged, "POST", "/gms/award-invitations/decline", { body: { token } }));
    expect((await h.repos.table("award_invitations").find({}))[0]).toMatchObject({ accepted_at: null, declined_at: null });
    expect((await call(await session(SSO_USER, invited, PROVIDER_B), "POST", "/gms/award-invitations/lookup", { body: { token } })).data).toMatchObject({ status: "pending", emailMatches: true });
  });

  it("a peer funder's link: claimed only by a session that is not refused first", async () => {
    refused(await call(await session(SSO_USER, `director@${CASCADE}`, PROVIDER_A), "POST", "/gms/referrals/claim", { body: { token: "gms_pinv_made-up-for-this-test", source: "invite" } }));
  });
});

describe("moderators: an email entry never matches a single sign-on session; a user id always does", () => {
  const MOD_EMAIL = `mod@${RIVERBEND}`;

  it("the gallery's moderators", async () => {
    h.env.GALLERY_MODERATORS = `${MOD_EMAIL}, ${SSO_USER}`;
    const ADA = "ada0ada0-0000-4000-8000-00000000ada0";
    // Riverbend's own provider asserts the moderator's address: still not a moderator.
    const sso = await session(ADA, MOD_EMAIL, PROVIDER_A);
    expect((await call(sso, "GET", "/gms/gallery/moderation/me")).data).toEqual({ moderator: false });
    expect(await call(sso, "GET", "/gms/gallery/moderation/queue")).toMatchObject({ status: 403, code: "not_a_moderator" });
    // Another provider asserting it is refused before the list is read.
    refused(await call(await session(ADA, MOD_EMAIL, PROVIDER_B), "GET", "/gms/gallery/moderation/queue"));
    // The same address by email code, and the listed user id through SSO, are moderators.
    expect((await call(await session(ADA, MOD_EMAIL, null), "GET", "/gms/gallery/moderation/me")).data).toEqual({ moderator: true });
    expect((await call(await session(SSO_USER, `someone@${RIVERBEND}`, PROVIDER_A), "GET", "/gms/gallery/moderation/queue")).status).toBe(200);
  });

  it("the partner directory's moderators (DIRECTORY_MODERATORS, else GALLERY_MODERATORS)", async () => {
    for (const env of ["DIRECTORY_MODERATORS", "GALLERY_MODERATORS"] as const) {
      h.env.DIRECTORY_MODERATORS = undefined;
      h.env.GALLERY_MODERATORS = undefined;
      h.env[env] = MOD_EMAIL;
      const sso = await session(SSO_USER, MOD_EMAIL, PROVIDER_A);
      expect((await call(sso, "GET", "/gms/partners/moderation/me")).data, env).toEqual({ moderator: false });
      expect(await call(sso, "GET", "/gms/partners/moderation/queue")).toMatchObject({ status: 403, code: "not_a_directory_moderator" });
      expect((await call(await session(SSO_USER, MOD_EMAIL, null), "GET", "/gms/partners/moderation/me")).data, env).toEqual({ moderator: true });
    }
  });
});

describe("joining through single sign-on", () => {
  it("refuses A's session for an address on B's domain outright (it used to answer with nothing joined)", async () => {
    h.directory.users.set(USER_ADMIN, { email: `dana@${CASCADE}`, name: "Dana Ortiz" });
    await h.repos.table("workspace_members").insert({ workspace_id: WS_OTHER, user_id: USER_ADMIN, role: "program_officer" });
    refused(await call(await session(SSO_USER, `dana@${CASCADE}`, PROVIDER_A), "POST", "/gms/sso/join", { body: {} }));
    expect(await h.repos.table("workspace_members").count({ user_id: SSO_USER })).toBe(0);
    expect((await call(await session(SSO_USER, `dana@${CASCADE}`, PROVIDER_B), "POST", "/gms/sso/join", { body: {} })).data).toMatchObject({ joined: [{ workspaceId: WS_OTHER, role: "program_officer" }] });
  });
});
