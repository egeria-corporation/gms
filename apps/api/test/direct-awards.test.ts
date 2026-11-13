// SPDX-License-Identifier: AGPL-3.0-only
// Giving an award directly (contract: direct awards). A funder admin or finance member offers an
// award by organization name and contact email; the invited person, signed in with that address,
// accepts for an applicant workspace they administer. Every refusal in the contract, the claim as
// one step through the award machine, what stays closed before acceptance, and what never reaches
// the ledger or the logs.
import { projectAward, ProjectionError } from "@gms/protocol";
import { SignJWT } from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WORKSPACE_CLAIM } from "../src/auth/scopes.ts";
import { redactString, setLogSink } from "../src/lib/log.ts";
import { RepoDirectAwardClaims } from "../src/services/direct-award-store.ts";
import { DIRECT_AWARD_INVITES_PER_DAY } from "../src/services/direct-awards.ts";
import { BASE, CLIENT_AGENT, SESSION_SECRET, USER_ADMIN, USER_OFFICER, WEB, WS_APPLICANT, WS_FUNDER, WS_OTHER, harness, type Harness } from "./helpers.ts";

const USER_FINANCE = "f1000000-0000-4000-8000-0000000000f1";
const USER_GRANTEE = "f1000000-0000-4000-8000-0000000000a1";
const USER_STRANGER = "f1000000-0000-4000-8000-0000000000b1";
const USER_OTHER_ADMIN = "f1000000-0000-4000-8000-0000000000c1";
const WS_GRANTEE_EDITOR = "f1000000-0000-4000-8000-0000000000e1";
const INVITED = "jo.grant@aldercreek.example";

let h: Harness;
let logs: string[];

/** A Supabase-style session for `userId` signed in with `email`. */
async function sessionAs(userId: string, email: string, aal: "aal1" | "aal2" = "aal2") {
  const iat = Math.floor(h.clock.now.getTime() / 1000);
  return new SignJWT({ aal, email, role: "authenticated" })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(userId)
    .setAudience("authenticated")
    .setIssuedAt(iat)
    .setExpirationTime(iat + 3600)
    .sign(new TextEncoder().encode(SESSION_SECRET));
}

async function call<T = { data: unknown }>(token: string, method: string, path: string, body?: unknown, ws?: string) {
  const res = await h.request(path, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(ws ? { "X-GMS-Workspace": ws } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: res.status, body: (await res.json().catch(() => null)) as T & { errors: { code: string }[]; message: string } };
}

const funderAs = async (userId: string) => (await sessionAs(userId, `${userId.slice(0, 4)}@riverbendcf.example`));
const create = async (token: string, overrides: Record<string, unknown> = {}, ws = WS_FUNDER) =>
  call<{ data: { id: string; status: string; emailed: boolean; recipient: { name: string; workspaceId: string | null; invitation: { email: string; status: string; sentAt: string; expiresAt: string } }; passport: { mirror: string } } }>(token, "POST", "/gms/awards/direct", { recipient: { organizationName: "Alder Creek Family Services", contactEmail: "Jo.Grant@AlderCreek.example" }, title: "Emergency operating support", amount: { value: "25000.00", currency: "USD" }, startDate: "2027-05-01", endDate: "2028-04-30", message: "Thank you for your work this winter.", ...overrides }, ws);

/** The token from the newest invitation email. */
const lastToken = () => {
  const mail = [...h.mailer.sent].reverse().find((m) => m.text.includes("/awards/claim#token="));
  return decodeURIComponent(/\/awards\/claim#token=([^\s]+)/.exec(mail!.text)![1]!);
};
const uuidOf = (awardId: string) => awardId.replace(/^awd_/, "");

let admin: string;
let grantee: string;

beforeEach(async () => {
  h = await harness();
  logs = [];
  setLogSink((line) => logs.push(line));
  // Riverbend is linked to Passport and verified there (L2), under its legal name.
  await h.repos.table("workspaces").update({ id: WS_FUNDER }, { legal_name: "Riverbend Community Foundation", verification_level: "L2" });
  await h.repos.table("workspace_members").insert({ workspace_id: WS_FUNDER, user_id: USER_FINANCE, role: "finance" });
  await h.repos.table("workspace_members").insert({ workspace_id: WS_APPLICANT, user_id: USER_GRANTEE, role: "admin" });
  await h.repos.table("workspace_members").insert({ workspace_id: WS_APPLICANT, user_id: USER_OTHER_ADMIN, role: "admin" });
  await h.repos.table("workspaces").insert({ id: WS_GRANTEE_EDITOR, kind: "applicant", handle: "alder-satellite", display_name: "Alder Satellite" });
  await h.repos.table("workspace_members").insert({ workspace_id: WS_GRANTEE_EDITOR, user_id: USER_GRANTEE, role: "editor" });
  admin = await funderAs(USER_ADMIN);
  grantee = await sessionAs(USER_GRANTEE, "JO.GRANT@aldercreek.example ");
});
afterEach(() => setLogSink(null));

describe("the funder gives an award directly", () => {
  it("creates it offered to the named organization, emails the invitation, and shows only the masked address", async () => {
    const r = await create(admin);
    expect(r.status).toBe(201);
    const award = r.body.data;
    expect(award).toMatchObject({ status: "offered", emailed: true, recipient: { name: "Alder Creek Family Services", workspaceId: null, invitation: { email: "j…@aldercreek.example", status: "sent", sentAt: h.clock.now.toISOString(), expiresAt: "2027-04-30T17:00:00.000Z" } }, passport: { mirror: "not_applicable" } });
    const row = (await h.repos.table("awards").one({ id: uuidOf(award.id) }))!;
    expect(row.recipient_individual).toEqual({ name: "Alder Creek Family Services" });
    expect(row.recipient_workspace_id).toBeNull();
    // The schedule exists like any offered award's.
    expect(await h.repos.table("tranches").count({ award_id: row.id })).toBeGreaterThan(0);

    const mail = h.mailer.sent.at(-1)!;
    expect(mail.to).toEqual([INVITED]);
    expect(mail.subject).toBe("Riverbend Community Foundation has offered Alder Creek Family Services a grant");
    // The token rides in the fragment, which no browser sends to a server.
    expect(mail.text).toContain(`${WEB}/awards/claim#token=gms_awi_`);
    expect(mail.text).not.toContain("?token=");
    expect(mail.html).toContain(`href="${WEB}/awards/claim#token=gms_awi_`);
    expect(mail.text).toContain("Thank you for your work this winter.");
    // Riverbend is verified with Passport: no "not verified" line.
    expect(mail.text).not.toContain("not verified with OpenGrants Passport");

    // Only the token's hash is stored.
    const token = lastToken();
    const inv = (await h.repos.table("award_invitations").one({ award_id: row.id }))!;
    expect(inv.token_hash).not.toBe(token);
    expect(inv.token_hash).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(token).toMatch(/^gms_awi_[A-Za-z0-9_-]{43}$/);
    expect(inv.email).toBe(INVITED);

    // The funder's list carries the invitation too.
    const list = await call<{ items: { id: string; recipient: { invitation?: { status: string } } }[] }>(admin, "GET", "/gms/awards", undefined, WS_FUNDER);
    expect(list.body.items.find((a) => a.id === award.id)?.recipient.invitation?.status).toBe("sent");
  });

  it("names a Passport funder by its legal name, whatever its workspace is called, and warns below L1", async () => {
    // An admin renames the workspace to a famous name: the email and the claim page keep the Passport name.
    await h.repos.table("workspaces").update({ id: WS_FUNDER }, { display_name: "Ford Foundation", org_projection: { name: "Riverbend Community Foundation" } });
    await create(admin);
    const mail = h.mailer.sent.at(-1)!;
    expect(mail.subject).toBe("Riverbend Community Foundation has offered Alder Creek Family Services a grant");
    expect(mail.text).not.toContain("Ford Foundation");
    const lookup = await call<{ data: { funder: Record<string, unknown> } }>(grantee, "POST", "/gms/award-invitations/lookup", { token: lastToken() });
    expect(lookup.body.data.funder).toEqual({ name: "Riverbend Community Foundation", workspaceName: "Ford Foundation", handle: "riverbend", verification: { source: "passport", level: "L2" }, verified: true });

    // Linked but only claimed (L0), or with no level recorded: not verified.
    for (const level of ["L0", null]) {
      await h.repos.table("workspaces").update({ id: WS_FUNDER }, { verification_level: level });
      await create(admin);
      expect(h.mailer.sent.at(-1)!.text).toContain("This funder's organization is not verified with OpenGrants Passport.");
      const l = await call<{ data: { funder: { verified: boolean } } }>(grantee, "POST", "/gms/award-invitations/lookup", { token: lastToken() });
      expect(l.body.data.funder.verified).toBe(false);
    }
  });

  it("says when the funder is not verified with Passport", async () => {
    const otherAdmin = "f1000000-0000-4000-8000-0000000000d1";
    await h.repos.table("workspace_members").insert({ workspace_id: WS_OTHER, user_id: otherAdmin, role: "admin" });
    expect((await create(await funderAs(otherAdmin), {}, WS_OTHER)).status).toBe(201);
    expect(h.mailer.sent.at(-1)!.text).toContain("This funder's organization is not verified with OpenGrants Passport.");
    expect(h.mailer.sent.at(-1)!.subject).toMatch(/^Cascade County Health Department has offered/);
  });

  it("is for the roles that make awards (admin, program officer), people only; finance may resend", async () => {
    const officerMade = await create(await funderAs(USER_OFFICER));
    expect(officerMade.status).toBe(201);
    const finance = await funderAs(USER_FINANCE);
    const byFinance = await create(finance);
    expect(byFinance.status).toBe(403);
    expect(byFinance.body.errors[0]!.code).toBe("insufficient_scope");
    expect((await call(finance, "POST", `/gms/awards/${officerMade.body.data.id}/invitation/resend`, {}, WS_FUNDER)).status).toBe(200);
    const auditor = await call(await funderAs("cccccccc-cccc-4ccc-8ccc-cccccccccccc"), "POST", `/gms/awards/${officerMade.body.data.id}/invitation/resend`, {}, WS_FUNDER);
    expect(auditor.status).toBe(403);
    // An applicant workspace cannot give awards.
    expect((await create(grantee, {}, WS_APPLICANT)).status).toBe(403);
    // An agent acting for the admin is refused over REST; over MCP its call waits for a person.
    const agent = await h.forge({ sub: USER_ADMIN, client_id: CLIENT_AGENT, scope: "awards:read awards:write", [WORKSPACE_CLAIM]: WS_FUNDER, jti: "tok-direct-agent" });
    const viaRest = await create(agent);
    expect(viaRest.status).toBe(403);
    expect(viaRest.body.errors[0]!.code).toBe("human_only");
    expect(await h.repos.table("award_invitations").count({})).toBe(1);
  });

  it("checks the input: plain text without links, a positive USD amount, a whole period, its own program", async () => {
    const bad = async (o: Record<string, unknown>) => (await create(admin, o)).status;
    expect(await bad({ message: "Details at https://example.org/award" })).toBe(400);
    expect(await bad({ message: "Write to grants@riverbendcf.example" })).toBe(400);
    expect(await bad({ message: "See www.example.com" })).toBe(400);
    expect(await bad({ title: "Visit riverbend-grants.com" })).toBe(400);
    // Any ending, and dots a mail program reads as dots.
    expect(await bad({ message: "Confirm your bank at grants-portal.ngo" })).toBe(400);
    expect(await bad({ title: "Ford grants at fordgrants.foundation" })).toBe(400);
    expect(await bad({ recipient: { organizationName: "Alder\uFF0Ede", contactEmail: INVITED } })).toBe(400);
    expect(await bad({ message: "Questions: agent.ai" })).toBe(400);
    expect(await bad({ message: "grants\u3002org" })).toBe(400);
    expect(await bad({ recipient: { organizationName: "Alder", contactEmail: "not-an-email" } })).toBe(400);
    expect(await bad({ amount: { value: "0.00", currency: "USD" } })).toBe(400);
    expect(await bad({ amount: { value: "100.00", currency: "EUR" } })).toBe(400);
    expect(await bad({ amount: { value: "1,000", currency: "USD" } })).toBe(400);
    expect(await bad({ startDate: "2027-05-01", endDate: undefined })).toBe(400);
    expect(await bad({ message: "x".repeat(2001) })).toBe(400);
    const elsewhere = await h.repos.table("programs").insert({ workspace_id: WS_OTHER, name: "Not yours" });
    expect(await bad({ programId: elsewhere.id })).toBe(404);
    expect(h.mailer.sent).toHaveLength(0);
    expect(await h.repos.table("awards").count({})).toBe(0);
  });

  it("refuses to send under a funder name that reads as a link, with a plain way out", async () => {
    await h.repos.table("workspaces").update({ id: WS_OTHER }, { display_name: "Cascade Health - verify at cascade-grants.foundation" });
    const otherAdmin = "f1000000-0000-4000-8000-0000000000d1";
    await h.repos.table("workspace_members").insert({ workspace_id: WS_OTHER, user_id: otherAdmin, role: "admin" });
    const r = await create(await funderAs(otherAdmin), {}, WS_OTHER);
    expect(r.status).toBe(422);
    expect(r.body.errors[0]!.code).toBe("funder_name_looks_like_link");
    expect(r.body.message).toContain("Rename the workspace");
    // A Passport funder is named by its legal name; when that reads as a link, Passport must fix it.
    await h.repos.table("workspaces").update({ id: WS_FUNDER }, { legal_name: "Riverbend．Foundation" });
    const linked = await create(admin);
    expect(linked.status).toBe(422);
    expect(linked.body.message).toContain("Passport");
    expect(h.mailer.sent).toHaveLength(0);
    expect(await h.repos.table("awards").count({})).toBe(0);
  });

  it("removes control and invisible format characters from free text before it is checked or stored", async () => {
    const r = await create(admin, { recipient: { organizationName: "Alder\u202E Creek\u200B\u0000 Family Services", contactEmail: INVITED }, title: "Emergency\u2066 operating\u2069 support\u0007", message: "Thank\u0000 you.\r\n\r\nSee\u200F you soon." });
    expect(r.status).toBe(201);
    const inv = (await h.repos.table("award_invitations").find({}))[0]!;
    expect(inv.organization_name).toBe("Alder Creek Family Services");
    expect(inv.message).toBe("Thank you.\n\nSee you soon.");
    expect((await h.repos.table("awards").one({ id: inv.award_id }))!.title).toBe("Emergency operating support");
    // A link hidden by a zero-width space is still a link.
    expect((await create(admin, { message: "exa\u200Bmple.org" })).status).toBe(400);
    // Nothing but control characters is no name at all.
    expect((await create(admin, { title: "\u0000\u200B" })).status).toBe(400);
  });

  it("refuses when mail is not configured, before anything is created", async () => {
    h.withoutPorts.add("mailer");
    const r = await create(admin);
    expect(r.status).toBe(503);
    expect(await h.repos.table("awards").count({})).toBe(0);
  });

  it(`limits a funder to ${DIRECT_AWARD_INVITES_PER_DAY} invitations, new and resent, per rolling 24 hours`, async () => {
    const first = (await create(admin)).body.data.id;
    for (let i = 1; i < DIRECT_AWARD_INVITES_PER_DAY - 1; i++) expect((await create(admin)).status).toBe(201);
    expect((await call(admin, "POST", `/gms/awards/${first}/invitation/resend`, {}, WS_FUNDER)).status).toBe(200);
    const over = await create(admin);
    expect(over.status).toBe(429);
    expect(over.body.errors[0]!.code).toBe("too_many_invitations");
    const resendOver = await call(admin, "POST", `/gms/awards/${first}/invitation/resend`, {}, WS_FUNDER);
    expect(resendOver.status).toBe(429);
    // Another funder has its own count.
    const otherAdmin = "f1000000-0000-4000-8000-0000000000d1";
    await h.repos.table("workspace_members").insert({ workspace_id: WS_OTHER, user_id: otherAdmin, role: "admin" });
    expect((await create(await funderAs(otherAdmin), {}, WS_OTHER)).status).toBe(201);
    // Rolling: a day later the earliest sends no longer count.
    h.clock.now = new Date(h.clock.now.getTime() + 24 * 3600_000 + 1000);
    expect((await create(await funderAs(USER_ADMIN))).status).toBe(201);
  });

  it("resends with a new link (the old one stops working), to a new address when given", async () => {
    const id = (await create(admin)).body.data.id;
    const oldToken = lastToken();
    h.clock.now = new Date(h.clock.now.getTime() + 3600_000);
    const r = await call<{ data: { emailed: boolean; recipient: { invitation: { email: string; sentAt: string } } } }>(admin, "POST", `/gms/awards/${id}/invitation/resend`, { contactEmail: "Director@AlderCreek.example" }, WS_FUNDER);
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ emailed: true, recipient: { invitation: { email: "d…@aldercreek.example", sentAt: h.clock.now.toISOString() } } });
    expect(h.mailer.sent.at(-1)!.to).toEqual(["director@aldercreek.example"]);
    const newToken = lastToken();
    expect(newToken).not.toBe(oldToken);
    expect((await call(grantee, "POST", "/gms/award-invitations/lookup", { token: oldToken })).body.errors[0]!.code).toBe("invitation_not_found");
    const inv = (await h.repos.table("award_invitations").one({ award_id: uuidOf(id) }))!;
    expect(inv).toMatchObject({ sent_count: 2, email: "director@aldercreek.example" });
    const ev = h.ledger.events.find((e) => e.eventType === "award.invitation_resent")!;
    expect(ev.data).toMatchObject({ email: "d…@aldercreek.example", sentCount: 2, addressChanged: true });
    // Another funder cannot resend it.
    const otherAdmin = "f1000000-0000-4000-8000-0000000000d1";
    await h.repos.table("workspace_members").insert({ workspace_id: WS_OTHER, user_id: otherAdmin, role: "admin" });
    expect((await call(await funderAs(otherAdmin), "POST", `/gms/awards/${id}/invitation/resend`, {}, WS_OTHER)).status).toBe(404);
  });
});

describe("before acceptance", () => {
  it("is not mirrored to Passport, releases no payment and stays out of CommonGrants output", async () => {
    h.env.PASSPORT_AWARD_WRITE = "true";
    const passportCalls: string[] = [];
    h.passport.fetch = async (input) => {
      passportCalls.push(String(input));
      return new Response("{}", { status: 500 });
    };
    const id = (await create(admin)).body.data.id;
    const award = (await h.repos.table("awards").one({ id: uuidOf(id) }))!;
    expect(award.passport_award_id).toBeNull();
    expect(passportCalls).toEqual([]);
    expect(h.ledger.events.filter((e) => e.eventType.startsWith("award.mirror"))).toEqual([]);

    const tranche = (await h.repos.table("tranches").find({ award_id: award.id }))[0]!;
    const finance = await funderAs(USER_FINANCE);
    const release = await call(finance, "POST", `/gms/tranches/trn_${tranche.id}/release`, {}, WS_FUNDER);
    expect(release.status).toBe(409);
    expect(release.body.errors[0]!.code).toBe("award_not_active");
    const recorded = await call(finance, "POST", `/gms/tranches/trn_${tranche.id}/record-external`, { reference: "CHK-1001", paidAt: "2027-04-16", destinationLast4: "6789" }, WS_FUNDER);
    expect(recorded.status).toBe(409);
    expect((await h.repos.table("tranches").one({ id: tranche.id }))!.status).toBe("scheduled");
    // Nor can the funder activate it.
    expect((await call(admin, "POST", `/gms/awards/${id}/activate`, {}, WS_FUNDER)).status).toBe(409);

    // A named organization is not a CommonGrants individual: the projection would not validate.
    expect(() => projectAward({ award: { id: award.id, title: award.title, description: null, status: "offered", funding: { awardedAmount: { amount: "25000.00", currency: "USD" } }, key_dates: {}, recipient_individual: award.recipient_individual as never, parent_award_id: null, created_at: award.created_at, updated_at: award.updated_at } }, { baseUrl: BASE })).toThrow(ProjectionError);
    const cg = await call<{ items: { id: string }[] }>(admin, "GET", "/common-grants/awards", undefined, WS_FUNDER);
    expect(cg.status).toBe(200);
    expect(cg.body.items.map((a) => a.id)).not.toContain(award.id);
    expect((await call(admin, "GET", `/common-grants/awards/${award.id}`, undefined, WS_FUNDER)).status).toBe(404);
    expect((await call(admin, "POST", "/common-grants/awards/search", {}, WS_FUNDER)).status).toBe(200);
  });
});

describe("the invited person", () => {
  it("looks the invitation up with the token in the body", async () => {
    await create(admin);
    const token = lastToken();
    const r = await call<{ data: Record<string, unknown> }>(grantee, "POST", "/gms/award-invitations/lookup", { token });
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual({
      status: "pending",
      funder: { name: "Riverbend Community Foundation", workspaceName: null, handle: "riverbend", verification: { source: "passport", level: "L2" }, verified: true },
      award: { title: "Emergency operating support", amount: { value: "25000.00", currency: "USD" }, startDate: "2027-05-01", endDate: "2028-04-30", message: "Thank you for your work this winter." },
      organizationName: "Alder Creek Family Services",
      invitedEmail: "j…@aldercreek.example",
      emailMatches: true,
      workspaces: [{ id: WS_APPLICANT, name: "Alder Creek Family Services", verification: { source: "none", level: null } }],
    });
    const stranger = await call<{ data: { emailMatches: boolean; workspaces: unknown[] } }>(await sessionAs(USER_STRANGER, "someone@else.example"), "POST", "/gms/award-invitations/lookup", { token });
    expect(stranger.body.data).toMatchObject({ emailMatches: false, workspaces: [] });
    const unknown = await call(grantee, "POST", "/gms/award-invitations/lookup", { token: `gms_awi_${"x".repeat(43)}` });
    expect(unknown.status).toBe(404);
    expect(unknown.body.errors[0]!.code).toBe("invitation_not_found");
    // Sign-in is required, and no API token is a signed-in person.
    expect((await h.request("/gms/award-invitations/lookup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) })).status).toBe(401);
    const agent = await h.forge({ sub: USER_GRANTEE, client_id: CLIENT_AGENT, scope: "awards:read awards:write", [WORKSPACE_CLAIM]: WS_APPLICANT, jti: "tok-grantee-agent" });
    expect((await call(agent, "POST", "/gms/award-invitations/lookup", { token })).status).toBe(401);
  });

  it("accepts in one step: the award moves to the workspace, accepted, with the consent, ledgered and announced", async () => {
    const id = (await create(admin)).body.data.id;
    const token = lastToken();
    h.mailer.sent.length = 0;
    await h.repos.table("workspace_members").insert({ workspace_id: WS_FUNDER, user_id: "f1000000-0000-4000-8000-0000000000aa", role: "reviewer" });
    h.directory.users.set(USER_FINANCE, { email: "finance@riverbendcf.example", name: "Finn Ance" });
    h.directory.users.set("f1000000-0000-4000-8000-0000000000aa", { email: "reviewer@university.example", name: "Rev" });

    const r = await call<{ data: { awardId: string; workspaceId: string } }>(grantee, "POST", "/gms/award-invitations/accept", { token, workspaceId: WS_APPLICANT });
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual({ awardId: id, workspaceId: WS_APPLICANT });

    const award = (await h.repos.table("awards").one({ id: uuidOf(id) }))!;
    expect(award).toMatchObject({ status: "accepted", cg_status: "awarded", recipient_workspace_id: WS_APPLICANT, recipient_individual: null });
    expect(await h.repos.table("consents").find({ applicant_workspace_id: WS_APPLICANT, funder_workspace_id: WS_FUNDER })).toEqual([expect.objectContaining({ basis: "award", scopes: ["org:read"], granted_by: USER_GRANTEE, revoked_at: null })]);
    expect((await h.repos.table("award_invitations").one({ award_id: award.id }))).toMatchObject({ accepted_by: USER_GRANTEE, accepted_workspace_id: WS_APPLICANT });

    const types = h.ledger.events.map((e) => e.eventType);
    expect(types).toEqual(expect.arrayContaining(["award.accept_offer", "award.invitation_accepted", "award.claimed", "consent.granted", "award.acceptance_signer_checked"]));
    const accepted = h.ledger.events.find((e) => e.eventType === "award.accept_offer")!;
    expect(accepted).toMatchObject({ workspaceId: WS_FUNDER, actor: `user:${USER_GRANTEE}`, data: { from: "offered", to: "accepted" } });
    // The funder's staff hear about it; a reviewer does not.
    expect(h.mailer.sent.map((m) => m.to[0]).sort()).toEqual(["dana.ortiz@riverbendcf.example", "finance@riverbendcf.example", "helen.ortiz@riverbendcf.example"]);
    expect(h.mailer.sent[0]!.text).toContain(`${WEB}/w/riverbend/awards/${id}`);

    // Both sides now see an accepted award; the funder sees the invitation accepted.
    const funderView = await call<{ data: { status: string; recipient: { workspaceId: string; invitation: { status: string } } } }>(admin, "GET", `/gms/awards/${id}`, undefined, WS_FUNDER);
    expect(funderView.body.data).toMatchObject({ status: "accepted", recipient: { workspaceId: WS_APPLICANT, invitation: { status: "accepted" } } });
    const mine = await call<{ items: { id: string; status: string }[] }>(grantee, "GET", "/gms/my/awards", undefined, WS_APPLICANT);
    expect(mine.body.items).toEqual([expect.objectContaining({ id, status: "accepted" })]);
    // Claimed, it projects to CommonGrants like any award, and validates.
    const cg = await call<{ data: { id: string; recipientIndividual?: unknown } }>(admin, "GET", `/common-grants/awards/${award.id}`, undefined, WS_FUNDER);
    expect(cg.status).toBe(200);
    expect(cg.body.data.recipientIndividual).toBeUndefined();
    expect((await call<{ items: { id: string }[] }>(admin, "GET", "/common-grants/awards", undefined, WS_FUNDER)).body.items.map((a) => a.id)).toContain(award.id);

    // Single use.
    const again = await call(grantee, "POST", "/gms/award-invitations/accept", { token, workspaceId: WS_APPLICANT });
    expect(again.status).toBe(409);
    expect(again.body.errors[0]!.code).toBe("invitation_used");
    expect((await call<{ data: { status: string } }>(grantee, "POST", "/gms/award-invitations/lookup", { token })).body.data.status).toBe("accepted");
  });

  it("is mirrored to Passport only once accepted", async () => {
    h.env.PASSPORT_AWARD_WRITE = "true";
    const id = (await create(admin)).body.data.id;
    expect((await call<{ data: { passport: { mirror: string } } }>(admin, "GET", `/gms/awards/${id}`, undefined, WS_FUNDER)).body.data.passport.mirror).toBe("not_applicable");
    await call(grantee, "POST", "/gms/award-invitations/accept", { token: lastToken(), workspaceId: WS_APPLICANT });
    // Now eligible like any accepted award; this test funder has no Passport client, so it waits.
    expect((await call<{ data: { passport: { mirror: string } } }>(admin, "GET", `/gms/awards/${id}`, undefined, WS_FUNDER)).body.data.passport.mirror).toBe("pending");
  });

  it("refuses: wrong address, not an admin, a funder workspace, no second step, an agent", async () => {
    await create(admin);
    const token = lastToken();
    const expectRefusal = async (who: string, body: Record<string, unknown>, status: number, code: string) => {
      const r = await call(who, "POST", "/gms/award-invitations/accept", body);
      expect(r.status).toBe(status);
      expect(r.body.errors[0]!.code).toBe(code);
      return r;
    };
    // Another admin of the same organization, signed in with their own address.
    const mismatch = await expectRefusal(await sessionAs(USER_OTHER_ADMIN, "director@aldercreek.example"), { token, workspaceId: WS_APPLICANT }, 403, "email_mismatch");
    expect(mismatch.body.message).toBe("Sign in with the address the invitation was sent to: j…@aldercreek.example");
    await expectRefusal(grantee, { token, workspaceId: WS_GRANTEE_EDITOR }, 403, "not_workspace_admin");
    await expectRefusal(grantee, { token, workspaceId: "f1000000-0000-4000-8000-0000000000ff" }, 403, "not_workspace_admin");
    await h.repos.table("workspace_members").insert({ workspace_id: WS_OTHER, user_id: USER_GRANTEE, role: "admin" });
    await expectRefusal(grantee, { token, workspaceId: WS_OTHER }, 403, "not_workspace_admin");
    await expectRefusal(await sessionAs(USER_GRANTEE, INVITED, "aal1"), { token, workspaceId: WS_APPLICANT }, 403, "mfa_required");
    const agent = await h.forge({ sub: USER_GRANTEE, client_id: CLIENT_AGENT, scope: "awards:read awards:write", [WORKSPACE_CLAIM]: WS_APPLICANT, jti: "tok-grantee-agent-2" });
    expect((await call(agent, "POST", "/gms/award-invitations/accept", { token, workspaceId: WS_APPLICANT })).status).toBe(401);
    // Nothing moved.
    expect((await h.repos.table("awards").find({ workspace_id: WS_FUNDER }))[0]).toMatchObject({ status: "offered", recipient_workspace_id: null });
    expect(await h.repos.table("consents").count({})).toBe(0);
  });

  it("refuses an expired link, and records the attempt once", async () => {
    await create(admin);
    const token = lastToken();
    h.clock.now = new Date(h.clock.now.getTime() + 14 * 86_400_000 + 1000);
    grantee = await sessionAs(USER_GRANTEE, INVITED);
    const r = await call(grantee, "POST", "/gms/award-invitations/accept", { token, workspaceId: WS_APPLICANT });
    expect(r.status).toBe(410);
    expect(r.body.errors[0]!.code).toBe("invitation_expired");
    expect((await call<{ data: { status: string } }>(grantee, "POST", "/gms/award-invitations/lookup", { token })).body.data.status).toBe("expired");
    expect(h.ledger.events.filter((e) => e.eventType === "award.invitation_expired")).toHaveLength(1);
    const view = await call<{ items: { recipient: { invitation: { status: string } } }[] }>(await funderAs(USER_ADMIN), "GET", "/gms/awards", undefined, WS_FUNDER);
    expect(view.body.items[0]!.recipient.invitation.status).toBe("expired");
  });

  it("refuses a withdrawn award: cancelling revokes the invitation", async () => {
    const id = (await create(admin)).body.data.id;
    const token = lastToken();
    const officer = await funderAs(USER_OFFICER);
    expect((await call(officer, "POST", `/gms/awards/${id}/cancel`, { reason: "Sent to the wrong organization" }, WS_FUNDER)).status).toBe(200);
    expect(h.ledger.events.some((e) => e.eventType === "award.invitation_revoked")).toBe(true);
    const r = await call(grantee, "POST", "/gms/award-invitations/accept", { token, workspaceId: WS_APPLICANT });
    expect(r.status).toBe(410);
    expect(r.body.errors[0]!.code).toBe("invitation_revoked");
    expect((await call<{ data: { status: string } }>(grantee, "POST", "/gms/award-invitations/lookup", { token })).body.data.status).toBe("revoked");
    const resend = await call(admin, "POST", `/gms/awards/${id}/invitation/resend`, {}, WS_FUNDER);
    expect(resend.status).toBe(409);
    expect(resend.body.errors[0]!.code).toBe("invitation_closed");
  });

  it("changes nothing when the claim itself is refused (a race lost after the checks)", async () => {
    const id = (await create(admin)).body.data.id;
    const spy = vi.spyOn(RepoDirectAwardClaims.prototype, "claim").mockResolvedValueOnce({ outcome: "used", consentId: null });
    const r = await call(grantee, "POST", "/gms/award-invitations/accept", { token: lastToken(), workspaceId: WS_APPLICANT });
    spy.mockRestore();
    expect(r.status).toBe(409);
    expect(r.body.errors[0]!.code).toBe("invitation_used");
    expect((await h.repos.table("awards").one({ id: uuidOf(id) }))).toMatchObject({ status: "offered", recipient_workspace_id: null });
    expect(await h.repos.table("consents").count({})).toBe(0);
    // The machine's ledger entry and webhooks follow the write, so neither happened.
    expect(h.ledger.events.some((e) => e.eventType === "award.accept_offer" || e.eventType === "award.claimed")).toBe(false);
  });

  it("does not add a second consent when the organization already shares its record", async () => {
    await h.repos.table("consents").insert({ applicant_workspace_id: WS_APPLICANT, funder_workspace_id: WS_FUNDER, basis: "application", scopes: ["org:read"] });
    await create(admin);
    expect((await call(grantee, "POST", "/gms/award-invitations/accept", { token: lastToken(), workspaceId: WS_APPLICANT })).status).toBe(200);
    expect((await h.repos.table("consents").find({ applicant_workspace_id: WS_APPLICANT })).map((c) => c.basis)).toEqual(["application"]);
    expect(h.ledger.events.some((e) => e.eventType === "consent.granted")).toBe(false);
  });

  it("declines: only the invited person; the funder is told and decides whether to withdraw", async () => {
    const id = (await create(admin)).body.data.id;
    const token = lastToken();
    h.mailer.sent.length = 0;
    const wrong = await call(await sessionAs(USER_STRANGER, "someone@else.example"), "POST", "/gms/award-invitations/decline", { token });
    expect(wrong.status).toBe(403);
    expect(wrong.body.errors[0]!.code).toBe("email_mismatch");
    // The reason is emailed to the funder's staff: plain text, no links.
    const linked = await call(grantee, "POST", "/gms/award-invitations/decline", { token, reason: "Please confirm at funder-help.ngo" });
    expect(linked.status).toBe(400);
    const r = await call<{ data: { status: string } }>(grantee, "POST", "/gms/award-invitations/decline", { token, reason: "We are not able\u202E to take on new funding this year.\u0000" });
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual({ status: "declined" });
    expect(h.mailer.sent.map((m) => m.to[0]).sort()).toEqual(["dana.ortiz@riverbendcf.example", "helen.ortiz@riverbendcf.example"]);
    expect(h.mailer.sent[0]!.text).toContain("We are not able to take on new funding this year.");
    expect((await h.repos.table("award_invitations").one({ award_id: uuidOf(id) }))!.decline_reason).toBe("We are not able to take on new funding this year.");
    const ev = h.ledger.events.find((e) => e.eventType === "award.invitation_declined")!;
    expect(ev.data).toMatchObject({ email: "j…@aldercreek.example", reasonGiven: true });
    expect(JSON.stringify(ev.data)).not.toContain("new funding");
    // The award stays offered until the funder withdraws it; the link is spent.
    expect((await h.repos.table("awards").one({ id: uuidOf(id) }))!.status).toBe("offered");
    expect((await call(grantee, "POST", "/gms/award-invitations/accept", { token, workspaceId: WS_APPLICANT })).body.errors[0]!.code).toBe("invitation_used");
    expect((await call(admin, "POST", `/gms/awards/${id}/invitation/resend`, {}, WS_FUNDER)).status).toBe(409);
    const view = await call<{ data: { recipient: { invitation: { status: string } } } }>(admin, "GET", `/gms/awards/${id}`, undefined, WS_FUNDER);
    expect(view.body.data.recipient.invitation.status).toBe("declined");
    expect((await call(await funderAs(USER_OFFICER), "POST", `/gms/awards/${id}/cancel`, { reason: "Declined" }, WS_FUNDER)).status).toBe(200);
    expect((await h.repos.table("award_invitations").one({ award_id: uuidOf(id) }))!.revoked_at).toBeNull();
  });
});

describe("what never leaves the invitation", () => {
  it("keeps the token and the full address out of the ledger, webhooks and logs", async () => {
    const id = (await create(admin)).body.data.id;
    const first = lastToken();
    await call(admin, "POST", `/gms/awards/${id}/invitation/resend`, {}, WS_FUNDER);
    const token = lastToken();
    await call(grantee, "POST", "/gms/award-invitations/lookup", { token });
    await call(await sessionAs(USER_OTHER_ADMIN, "director@aldercreek.example"), "POST", "/gms/award-invitations/accept", { token, workspaceId: WS_APPLICANT });
    await call(grantee, "POST", "/gms/award-invitations/accept", { token, workspaceId: WS_APPLICANT });
    await call(grantee, "POST", "/gms/award-invitations/accept", { token: first, workspaceId: WS_APPLICANT });

    const ledger = JSON.stringify(h.ledger.events);
    const hooks = JSON.stringify(h.webhooks);
    for (const secret of [first, token, INVITED, "Jo.Grant@AlderCreek.example"]) {
      expect(ledger).not.toContain(secret);
      expect(hooks).not.toContain(secret);
      expect(logs.join("\n")).not.toContain(secret);
    }
    expect(ledger).toContain("j…@aldercreek.example");
    expect(logs.length).toBeGreaterThan(0);
    // No table holds a token, only its hash.
    for (const table of ["awards", "award_invitations", "consents", "tranches", "requirements"] as const) expect(JSON.stringify(await h.repos.table(table).find({}))).not.toContain(token);
    // A token that reaches a log line by mistake is redacted.
    expect(redactString(`claim ${token}`)).toBe("claim gms_awi_[REDACTED]");
    // Also inside an encoded URL, where no word boundary precedes it.
    expect(redactString(`/signin?next=%2Fawards%2Fclaim%3Ftoken%3D${token}`)).toBe("/signin?next=%2Fawards%2Fclaim%3Ftoken%3Dgms_awi_[REDACTED]");
  });
});

describe("over MCP", () => {
  const rpc = async (token: string, name: string, args: Record<string, unknown>) => {
    const res = await h.request("/mcp", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) });
    return ((await res.json()) as { result: { isError: boolean; structuredContent: Record<string, unknown> } }).result;
  };
  const args = { organizationName: "Alder Creek Family Services", contactEmail: INVITED, title: "Emergency operating support", amount: { value: "25000.00", currency: "USD" } };

  it("a funder agent's request always waits for a person, then runs as that person", async () => {
    const agent = await h.forge({ sub: USER_ADMIN, client_id: CLIENT_AGENT, scope: "awards:read awards:write approvals:bypass", [WORKSPACE_CLAIM]: WS_FUNDER, jti: "tok-mcp-direct" });
    const out = await rpc(agent, "create_direct_award", args);
    expect(out.structuredContent).toMatchObject({ status: "pending_approval" });
    expect(await h.repos.table("awards").count({})).toBe(0);
    expect(h.mailer.sent).toHaveLength(0);
    const approvalId = (out.structuredContent as { approvalId: string }).approvalId;
    // Finance cannot approve it: it holds no awards:write, so it cannot give an award either.
    const finance = await funderAs(USER_FINANCE);
    const byFinance = await call(finance, "POST", `/gms/approvals/${approvalId}/decision`, { approve: true }, WS_FUNDER);
    expect(byFinance.status).toBe(403);
    expect(h.mailer.sent).toHaveLength(0);
    // A program officer may, and the call then runs as the officer.
    const byOfficer = await call<{ data: { status: string } }>(await funderAs(USER_OFFICER), "POST", `/gms/approvals/${approvalId}/decision`, { approve: true }, WS_FUNDER);
    expect(byOfficer.body.data.status).toBe("executed");
    expect(h.mailer.sent).toHaveLength(1);
  });

  it("the admin's approval creates the award and sends the invitation", async () => {
    const agent = await h.forge({ sub: USER_ADMIN, client_id: CLIENT_AGENT, scope: "awards:read awards:write", [WORKSPACE_CLAIM]: WS_FUNDER, jti: "tok-mcp-direct-2" });
    const out = await rpc(agent, "create_direct_award", args);
    const approvalId = (out.structuredContent as { approvalId: string }).approvalId;
    const ok = await call<{ data: { status: string } }>(admin, "POST", `/gms/approvals/${approvalId}/decision`, { approve: true }, WS_FUNDER);
    expect(ok.status).toBe(200);
    expect(ok.body.data.status).toBe("executed");
    expect(await h.repos.table("award_invitations").count({})).toBe(1);
    expect(h.mailer.sent.at(-1)!.to).toEqual([INVITED]);
    // The request is ledgered with the address masked; only the approval keeps it, to send the email.
    const requested = h.ledger.events.find((e) => e.eventType === "approval.requested")!;
    expect(requested.data).toMatchObject({ tool: "create_direct_award", input: { contactEmail: "j…@aldercreek.example" } });
    expect(JSON.stringify(h.ledger.events)).not.toContain(INVITED);
    // The input rules hold over MCP too.
    const linked = await rpc(agent, "create_direct_award", { ...args, message: "See https://example.org" });
    const linkedId = (linked.structuredContent as { approvalId: string }).approvalId;
    const refused = await call<{ data: { status: string } }>(admin, "POST", `/gms/approvals/${linkedId}/decision`, { approve: true }, WS_FUNDER);
    expect(refused.body.data).toMatchObject({ status: "failed", error: "The request is not valid" });
    expect(await h.repos.table("award_invitations").count({})).toBe(1);
  });

  it("no agent tool accepts or declines on the grantee's behalf", async () => {
    const res = await h.request("/mcp", { method: "POST", headers: { Authorization: `Bearer ${await h.forge({ sub: USER_GRANTEE, client_id: CLIENT_AGENT, scope: "awards:read awards:write", [WORKSPACE_CLAIM]: WS_APPLICANT, jti: "tok-mcp-grantee" })}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
    const names = ((await res.json()) as { result: { tools: { name: string }[] } }).result.tools.map((t) => t.name);
    expect(names.filter((n) => /invitation|claim|direct/.test(n))).toEqual([]);
  });
});
