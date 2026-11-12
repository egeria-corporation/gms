// SPDX-License-Identifier: AGPL-3.0-only
// Review F-01: any funder workspace could make any applicant workspace its grantee by importing a
// CSV row with that organization's name or EIN, then read its Passport and payee facts and email it
// from the GMS. These tests pin the fix: an import links only organizations already connected to
// the funder, the dry run reveals nothing about others, and reminders and the grantee view need the
// organization's consent, as sending a communication always did.
import { encryptSecret, fixtureFetch } from "@gms/passport-client";
import { beforeEach, describe, expect, it } from "vitest";
import { WORKSPACE_CLAIM } from "../src/auth/scopes.ts";
import { evaluateRequirements, syncPassport } from "../src/jobs.ts";
import { mirrorAward } from "../src/services/awards.ts";
import { systemContext, type BaseContext } from "../src/services/context.ts";
import { processPassportEvent } from "../src/services/inbound.ts";
import { PAYEE_NOT_SHARED } from "../src/services/payments.ts";
import { MANUAL_REMINDER_INTERVAL_HOURS } from "../src/services/requirements.ts";
import { BASE, CLIENT_AGENT, PASSPORT, TEST_CREDENTIALS_KEY, USER_ADMIN, USER_OFFICER, WEB, WS_APPLICANT, WS_FUNDER, WS_OTHER, bearer, harness, type Harness } from "./helpers.ts";
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

describe("payment views apply the same rule: Passport facts only by consent", () => {
  /** A tranche on an award, held because of a payee fact (as a Passport event would have held it). */
  async function heldTranche(funder: string, awardId: string) {
    const schedule = await h.repos.table("payment_schedules").insert({ workspace_id: funder, award_id: awardId, currency: "USD" });
    const id = crypto.randomUUID();
    await h.repos.table("tranches").insert({ id, workspace_id: funder, award_id: awardId, schedule_id: schedule.id, seq: 1, amount_minor: 100_000, currency: "USD", condition: { type: "manual" } as never, status: "held", hold_reason: "pending_destination_change", idempotency_key: `trn_${id}` });
    return id;
  }
  const agentFor = (ws: string) => h.forge({ sub: USER_ADMIN, client_id: CLIENT_AGENT, scope: "payments:read grantees:read awards:read", [WORKSPACE_CLAIM]: ws, jti: `tok-${ws}` });
  const mcp = async (token: string, name: string, args: Record<string, unknown>) => {
    const res = await h.request("/mcp", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) });
    return JSON.stringify(await res.json());
  };
  const hidden = (text: string) => {
    expect(text).not.toContain("Harbor Bank");
    expect(text).not.toContain("0001");
    expect(text).not.toContain("pending_destination_change");
    expect(text).not.toContain(ORG_ALDER);
  };

  it("an organization that has not shared its record shows as not shared in the tranche list, readiness, alerts and award views, over REST and MCP", async () => {
    const award = await plantImportedAward(WS_OTHER);
    const trancheId = await heldTranche(WS_OTHER, award.id);

    const list = await s.call<{ items: { holdReason: string; recipient: Record<string, unknown> }[] }>(stranger, "GET", "/gms/tranches");
    expect(list.body.items[0]).toMatchObject({ holdReason: "held_at_passport", recipient: { workspaceId: WS_APPLICANT, verificationLevel: null, pendingDestinationChange: null } });
    hidden(JSON.stringify(list.body));

    const ready = await data<{ releasable: boolean; checks: { key: string; state: string; reason: string }[]; tranche: { holdReason: string }; banner: { detail: string } | null; destination: unknown }>(stranger, "GET", `/gms/tranches/trn_${trancheId}/readiness`);
    expect(ready.releasable).toBe(false);
    expect(ready.checks.find((c) => c.key === "payee_credential")).toMatchObject({ state: "fail", reason: `${PAYEE_NOT_SHARED}.` });
    expect(ready).toMatchObject({ tranche: { holdReason: "held_at_passport" }, destination: null });
    hidden(JSON.stringify(ready));

    const alerts = await data<{ kind: string; detail: string }[]>(stranger, "GET", "/gms/payments/alerts");
    expect(alerts.map((a) => a.kind).sort()).toEqual(["held", "record_not_shared"]);
    hidden(JSON.stringify(alerts));

    const detail = await data<{ recipient: { level: string | null }; tranches: { holdReason: string }[] }>(stranger, "GET", `/gms/awards/awd_${award.id}`);
    expect(detail.recipient.level).toBeNull();
    expect(detail.tranches[0]!.holdReason).toBe("held_at_passport");
    hidden(JSON.stringify(detail));
    hidden(JSON.stringify(await data(stranger, "GET", `/gms/awards/awd_${award.id}/schedule`)));
    await h.repos.table("tranches").update({ id: trancheId }, { due_at: new Date(h.clock.now.getTime() + 86_400_000).toISOString() });
    const upcoming = await data<{ items: { holdReason: string }[] }>(stranger, "GET", "/gms/payments/upcoming");
    expect(upcoming.items[0]!.holdReason).toBe("held_at_passport");
    hidden(JSON.stringify(await s.call(stranger, "GET", `/common-grants/awards/${award.id}`)));
    await h.repos.table("requirements").insert({ workspace_id: WS_OTHER, award_id: award.id, type: "report", title: "Report", due_at: "2027-06-01T00:00:00Z", status: "due" });
    const due = await s.call<{ items: { recipient: { verification: { level: string | null } } }[] }>(stranger, "GET", "/gms/requirements/due");
    expect(due.body.items[0]!.recipient.verification.level).toBeNull();
    hidden(JSON.stringify(due.body));

    // The MCP tools read the same services.
    const token = await agentFor(WS_OTHER);
    hidden(await mcp(token, "list_tranches", {}));
    hidden(await mcp(token, "check_payment_readiness", { trancheId: `trn_${trancheId}` }));
    hidden(await mcp(token, "get_award", { awardId: `awd_${award.id}` }));
    hidden(await mcp(token, "get_passport_status", { applicantWorkspaceId: WS_APPLICANT }));
  });

  it("a funder the organization applied to still sees them", async () => {
    await applyToFunder();
    const award = await h.repos.table("awards").insert({ workspace_id: WS_FUNDER, recipient_workspace_id: WS_APPLICANT, title: "Mobile Health Navigation", status: "active", funding: { awardedAmount: { amount: "50000.00", currency: "USD" } } as never });
    const trancheId = await heldTranche(WS_FUNDER, award.id);
    const list = await s.call<{ items: { holdReason: string; recipient: Record<string, unknown> }[] }>(s.funder, "GET", "/gms/tranches");
    expect(list.body.items[0]).toMatchObject({ holdReason: "pending_destination_change", recipient: { verificationLevel: "L3", pendingDestinationChange: true } });
    const alerts = await data<{ kind: string; detail: string }[]>(s.funder, "GET", "/gms/payments/alerts");
    expect(alerts.find((a) => a.kind === "destination_change_pending")!.detail).toContain("Harbor Bank •••• 0001");
    const ready = await data<{ checks: { key: string; reason: string }[] }>(s.funder, "GET", `/gms/tranches/trn_${trancheId}/readiness`);
    expect(ready.checks.find((c) => c.key === "payee_credential")!.reason).not.toBe(`${PAYEE_NOT_SHARED}.`);
  });

  it("Passport's events and the sync job reach only funders the organization shares with, and no award is recorded at Passport for the others", async () => {
    await applyToFunder();
    const mine = await h.repos.table("awards").insert({ workspace_id: WS_FUNDER, recipient_workspace_id: WS_APPLICANT, title: "Mobile Health Navigation", status: "active", funding: { awardedAmount: { amount: "50000.00", currency: "USD" } } as never });
    const theirs = await plantImportedAward(WS_OTHER);
    const ready = async (funder: string, awardId: string) => {
      const schedule = await h.repos.table("payment_schedules").insert({ workspace_id: funder, award_id: awardId, currency: "USD" });
      const id = crypto.randomUUID();
      await h.repos.table("tranches").insert({ id, workspace_id: funder, award_id: awardId, schedule_id: schedule.id, seq: 1, amount_minor: 100_000, currency: "USD", condition: { type: "manual" } as never, status: "ready", idempotency_key: `trn_${id}` });
      return id;
    };
    const [t1, t2] = [await ready(WS_FUNDER, mine.id), await ready(WS_OTHER, theirs.id)];
    await processPassportEvent(base(), { id: "evt_1", type: "payee.destination.change_pending", orgId: ORG_ALDER, occurredAt: h.clock.now.toISOString(), data: { orgId: ORG_ALDER, handle: null, destinationId: "dst_1", state: "pending", bankName: "Harbor Bank", last4: "0001", requestedAt: h.clock.now.toISOString() } } as never);
    expect((await h.repos.table("tranches").one({ id: t1 }))!.status).toBe("held");
    expect((await h.repos.table("tranches").one({ id: t2 }))!.status).toBe("ready");
    const alerted = h.ledger.events.filter((e) => e.eventType === "payments.alert.destination_change_pending").map((e) => e.workspaceId);
    expect(alerted).toEqual([WS_FUNDER]);

    // The sync job asks Passport only about grantees that share with the funder asking.
    await h.repos.table("workspaces").update({ id: WS_OTHER }, { passport_org_id: "0190a000-0000-7000-8000-0000000000ff" });
    await h.repos.table("passport_links").insert({ workspace_id: WS_OTHER, mode: "funder_client", client_id: "pc_cascade", client_secret_enc: await encryptSecret("passport-client-secret-for-tests", TEST_CREDENTIALS_KEY), scopes: ["org:read"], linked_at: h.clock.now.toISOString(), last_ok_at: h.clock.now.toISOString() });
    const fx = fixtureFetch([{ method: "POST", path: "/oauth/token", status: 200, body: { access_token: "passport-access-token-for-tests", token_type: "Bearer", expires_in: 3600, scope: "org:read payee:read" } }]);
    h.passport.fetch = fx.fetch;
    await syncPassport({ ...base(), config: { ...base().config, passportFetch: fx.fetch } });
    expect(fx.calls.some((c) => c.path.startsWith(`/passport/payees/`))).toBe(false);

    // Mirroring: a new award is not recorded at Passport for an organization that does not share with the funder.
    const out = await mirrorAward(systemContext({ ...base(), config: { ...base().config, passportAwardWrite: true, passportFetch: fx.fetch } }, { job: "test" }, { id: WS_OTHER, kind: "funder" }), theirs);
    expect(out).toMatchObject({ state: "skipped", reason: expect.stringMatching(/does not share its record/) });
    expect(fx.calls.some((c) => c.path.includes("/awards"))).toBe(false);
  });
});
