// SPDX-License-Identifier: AGPL-3.0-only
// Review F-01: any funder workspace could make any applicant workspace its grantee by importing a
// CSV row with that organization's name or EIN, then read its Passport and payee facts and email it
// from the GMS. These tests pin the fix: an import links only organizations already connected to
// the funder, the dry run reveals nothing about others, and reminders and the grantee view need the
// organization's consent, as sending a communication always did.
import { beforeEach, describe, expect, it } from "vitest";
import { evaluateRequirements } from "../src/jobs.ts";
import type { BaseContext } from "../src/services/context.ts";
import { MANUAL_REMINDER_INTERVAL_HOURS } from "../src/services/requirements.ts";
import { BASE, PASSPORT, TEST_CREDENTIALS_KEY, USER_ADMIN, USER_OFFICER, WEB, WS_APPLICANT, WS_FUNDER, WS_OTHER, bearer, harness, type Harness } from "./helpers.ts";
import { ORG_ALDER, scenario, type Scenario } from "./scenario.ts";

let h: Harness;
let s: Scenario;
/** An admin of a second funder (Cascade County) that Alder Creek has never dealt with. */
let stranger: Record<string, string>;
let funderAdmin: Record<string, string>;

const MAPPING = { recipientName: "Organization", recipientEin: "EIN", title: "Grant", awardedAmount: "Amount" };
const headers = async (user: string, ws: string) => ({ ...bearer(await h.session(user)).headers, "X-GMS-Workspace": ws, "Content-Type": "application/json" });
const data = async <T>(who: Record<string, string>, method: string, path: string, body?: unknown): Promise<T> => {
  const r = await s.call<{ data: T }>(who, method, path, method === "GET" ? undefined : (body ?? {}));
  if (r.status >= 300) throw new Error(`${method} ${path} -> ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.data;
};
const base = (): BaseContext => ({ repos: h.repos, ledger: h.ledger, webhooks: h.webhooks, now: () => h.clock.now, ports: { mailer: h.mailer, storage: h.storage }, config: { baseUrl: BASE, webBaseUrl: WEB, passportBaseUrl: PASSPORT, credentialsKey: TEST_CREDENTIALS_KEY, passportClient: null, mailFrom: "OpenGrants GMS <notices@gms.test>", webhookSecretKey: TEST_CREDENTIALS_KEY } });

type ImportResult = { dryRun: boolean; rows: number; created: number; failed: number; unmatchedRecipients: number; results: { row: number; ok: boolean; awardId?: string; matchedRecipient?: boolean }[] };
const importCsv = (who: Record<string, string>, csv: string, dryRun?: boolean) => data<ImportResult>(who, "POST", "/gms/imports/csv", { csv, mapping: MAPPING, ...(dryRun ? { dryRun } : {}) });

/** Alder Creek applies to the scenario funder (Riverbend): that is a connection. */
async function applyToFunder() {
  const started = await s.call<{ data: { id: string } }>(s.applicant, "POST", "/common-grants/applications/start", { competitionId: s.uuid.comp });
  const app = started.body.data.id;
  await s.call(s.applicant, "PUT", `/common-grants/applications/${app}/forms/${s.uuid.loi}`, { response: { projectTitle: "Mobile Health Navigation", requestedAmount: { amount: "50000.00", currency: "USD" } } });
  expect((await s.call(s.applicant, "PUT", `/common-grants/applications/${app}/submit`)).status).toBe(200);
}

/** An award attached to Alder Creek the way an import did before the fix, with Passport payee facts cached on its workspace. */
async function plantImportedAward(funder: string) {
  return h.repos.table("awards").insert({ workspace_id: funder, recipient_workspace_id: WS_APPLICANT, title: "Historical grant", status: "active", conditions: ["imported"], funding: { awardedAmount: { amount: "1000.00", currency: "USD" } } as never });
}

beforeEach(async () => {
  h = await harness();
  s = await scenario(h);
  await h.repos.table("workspaces").update({ id: WS_APPLICANT }, { ein: "001234567", settings: { passportPayee: { active: true, pendingDestinationChange: { bankName: "Harbor Bank", last4: "0001", requestedAt: "2027-04-01T00:00:00Z" } } } as never });
  await h.repos.table("workspace_members").insert({ workspace_id: WS_OTHER, user_id: USER_ADMIN, role: "admin" });
  stranger = await headers(USER_ADMIN, WS_OTHER);
  funderAdmin = await headers(USER_ADMIN, WS_FUNDER);
});

describe("CSV award import links only connected organizations", () => {
  const csv = "Organization,EIN,Grant,Amount\nAlder Creek Family Services,00-1234567,Confirm payout details,1000\nAlder Creek Family Services,,Second row by name,500\nNobody Real Org,98-7654321,Made up,700\n";

  it("an unrelated funder cannot match an organization by EIN or name, and the dry run reads exactly as no match", async () => {
    const dry = await importCsv(stranger, csv, true);
    // A real organization on this instance and a made-up one report the same way.
    expect(dry).toEqual({ dryRun: true, rows: 3, created: 0, failed: 0, unmatchedRecipients: 3, results: [2, 3, 4].map((row) => ({ row, ok: true, matchedRecipient: false })) });

    const real = await importCsv(stranger, csv);
    expect(real).toMatchObject({ created: 3, unmatchedRecipients: 3 });
    expect(real.results.every((r) => r.matchedRecipient === false)).toBe(true);
    const awards = await h.repos.table("awards").find({ workspace_id: WS_OTHER });
    expect(awards.map((a) => a.recipient_workspace_id)).toEqual([null, null, null]);
    // Kept as a named recipient, for the funder's own records.
    expect(awards.map((a) => (a.recipient_individual as { name?: string; imported?: boolean } | null)?.name).sort()).toEqual(["Alder Creek Family Services", "Alder Creek Family Services", "Nobody Real Org"]);

    // Alder Creek did not become its grantee, and sees no award from it.
    expect((await s.call<{ items: unknown[] }>(stranger, "GET", "/gms/grantees")).body.items).toEqual([]);
    expect((await s.call(stranger, "GET", `/gms/grantees/${WS_APPLICANT}`)).status).toBe(404);
    expect(await h.repos.table("awards").count({ recipient_workspace_id: WS_APPLICANT })).toBe(0);
  });

  it("matches an organization that applied to this funder", async () => {
    await applyToFunder();
    const dry = await importCsv(funderAdmin, csv, true);
    expect(dry.results.map((r) => r.matchedRecipient)).toEqual([true, true, false]);
    await importCsv(funderAdmin, csv);
    const linked = await h.repos.table("awards").find({ workspace_id: WS_FUNDER, recipient_workspace_id: WS_APPLICANT });
    expect(linked.map((a) => a.title).sort()).toEqual(["Confirm payout details", "Second row by name"]);
  });

  it("matches an organization that shared a report with this funder (a live consent)", async () => {
    await h.repos.table("consents").insert({ applicant_workspace_id: WS_APPLICANT, funder_workspace_id: WS_OTHER, basis: "shared_submission", scopes: ["submission:read"], granted_at: h.clock.now.toISOString() });
    expect((await importCsv(stranger, csv, true)).results.map((r) => r.matchedRecipient)).toEqual([true, true, false]);
    // Once the consent is withdrawn, the organization is no longer connected.
    await h.repos.table("consents").update({ applicant_workspace_id: WS_APPLICANT, funder_workspace_id: WS_OTHER }, { revoked_at: h.clock.now.toISOString() });
    expect((await importCsv(stranger, csv, true)).results.map((r) => r.matchedRecipient)).toEqual([false, false, false]);
  });

  it("an award an earlier import attached is not a connection by itself", async () => {
    await plantImportedAward(WS_OTHER);
    expect((await importCsv(stranger, csv, true)).unmatchedRecipients).toBe(3);
  });
});

describe("the grantee view shows Passport and payee facts only by consent", () => {
  it("hides the Passport id, legal name, level and payee status of an organization that has not shared its record", async () => {
    await plantImportedAward(WS_OTHER);
    const list = await s.call<{ items: Record<string, unknown>[] }>(stranger, "GET", "/gms/grantees");
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0]).toMatchObject({ workspaceId: WS_APPLICANT, name: "Alder Creek Family Services", legalName: null, passportOrgId: null, verificationLevel: null, payee: null });
    const detail = await data<Record<string, unknown>>(stranger, "GET", `/gms/grantees/${WS_APPLICANT}`);
    expect(detail).toMatchObject({ consent: false, organization: null, selfDeclared: null, passportOrgId: null, verificationLevel: null, legalName: null, payee: null, payeeStatus: null, lastSyncedAt: null });
    expect(JSON.stringify(detail)).not.toContain("Harbor Bank");
    expect(JSON.stringify(detail)).not.toContain(ORG_ALDER);
  });

  it("shows them to a funder the organization applied to", async () => {
    await applyToFunder();
    const detail = await data<Record<string, unknown>>(s.funder, "GET", `/gms/grantees/${WS_APPLICANT}`);
    expect(detail).toMatchObject({ consent: true, passportOrgId: ORG_ALDER, verificationLevel: "L3", payee: { pendingDestinationChange: true, active: true }, payeeStatus: { pendingDestinationChange: { bankName: "Harbor Bank", last4: "0001" }, active: true } });
  });
});

describe("report reminders go only to organizations that share their record, at most one by hand a day", () => {
  async function requirementOn(funder: Record<string, string>, awardId: string) {
    return data<{ id: string }>(funder, "POST", `/gms/awards/awd_${awardId}/requirements`, { type: "report", title: "Verify your bank account", dueAt: "2027-06-01T00:00:00Z" });
  }

  it("refuses a manual reminder to an organization that has not shared its record, and the plan sends none", async () => {
    const award = await plantImportedAward(WS_OTHER);
    const req = await requirementOn(stranger, award.id);
    const res = await s.call<{ message: string; errors?: { code: string }[] }>(stranger, "POST", `/gms/requirements/${req.id}/remind`);
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/has not shared its record/);
    expect(h.mailer.sent).toHaveLength(0);
    // The planned reminders skip it too.
    h.clock.now = new Date("2027-05-20T09:00:00Z");
    expect((await evaluateRequirements(base())).reminders).toBe(0);
    expect(h.mailer.sent).toHaveLength(0);
  });

  it("sends one manual reminder per requirement per interval, gives the place back when the send fails, and says when to try again", async () => {
    await applyToFunder();
    const award = await h.repos.table("awards").insert({ workspace_id: WS_FUNDER, recipient_workspace_id: WS_APPLICANT, title: "Mobile Health Navigation", status: "active", funding: { awardedAmount: { amount: "50000.00", currency: "USD" } } as never });
    const req = await requirementOn(s.funder, award.id);
    const before = h.mailer.sent.length; // the acknowledgment of the application

    h.mailer.failNext = new Error("provider down");
    expect((await s.call(s.funder, "POST", `/gms/requirements/${req.id}/remind`)).status).toBe(500);
    expect((await data<{ sent: boolean }>(s.funder, "POST", `/gms/requirements/${req.id}/remind`)).sent).toBe(true);
    expect(h.mailer.sent).toHaveLength(before + 1);

    const again = await s.call<{ message: string }>(s.funder, "POST", `/gms/requirements/${req.id}/remind`);
    expect(again.status).toBe(429);
    expect(again.body.message).toMatch(new RegExp(`already sent in the last ${MANUAL_REMINDER_INTERVAL_HOURS} hours. You can send another after`));
    // Parallel clicks get one email through at most.
    const burst = await Promise.all([1, 2, 3].map(() => s.call(s.funder, "POST", `/gms/requirements/${req.id}/remind`)));
    expect(burst.map((r) => r.status)).toEqual([429, 429, 429]);
    expect(h.mailer.sent).toHaveLength(before + 1);

    // A day later (and a fresh session) the next one goes out.
    h.clock.now = new Date(h.clock.now.getTime() + MANUAL_REMINDER_INTERVAL_HOURS * 3_600_000 + 60_000);
    const later = await headers(USER_OFFICER, WS_FUNDER);
    expect((await data<{ sent: boolean }>(later, "POST", `/gms/requirements/${req.id}/remind`)).sent).toBe(true);
    expect(h.mailer.sent).toHaveLength(before + 2);
    // Manual sends never stand in for a planned reminder.
    h.clock.now = new Date("2027-05-20T09:00:00Z");
    expect((await evaluateRequirements(base())).reminders).toBe(1);
  });

  it("a burst of first reminders lets one through", async () => {
    await applyToFunder();
    const award = await h.repos.table("awards").insert({ workspace_id: WS_FUNDER, recipient_workspace_id: WS_APPLICANT, title: "Mobile Health Navigation", status: "active", funding: { awardedAmount: { amount: "50000.00", currency: "USD" } } as never });
    const req = await requirementOn(s.funder, award.id);
    const before = h.mailer.sent.length;
    const burst = await Promise.all([1, 2, 3, 4].map(() => s.call(s.funder, "POST", `/gms/requirements/${req.id}/remind`)));
    expect(burst.map((r) => r.status).sort()).toEqual([200, 429, 429, 429]);
    expect(h.mailer.sent).toHaveLength(before + 1);
  });
});
