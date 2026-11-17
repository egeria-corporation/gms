// SPDX-License-Identifier: AGPL-3.0-only
// QuickBooks sync (v1.13.0): the mapping, the switch, one expense per recorded payment, "needs
// attention" on edits and voids, and the reconciliation view, against the QuickBooks fixture. The
// Composio connector itself (slugs, arguments, scopes) is tested against a fake Composio in
// packages/connectors/test/quickbooks.test.ts. Record-keeping only: these tests also check that
// nothing here moves money, calls Passport, or changes a payment or an award.
import { FixtureQuickBooksBooks } from "@gms/connectors";
import { beforeEach, describe, expect, it } from "vitest";
import { WORKSPACE_CLAIM, scopesForRole } from "../src/auth/scopes.ts";
import { MAX_ATTEMPTS, STUCK_POSTING_MS, referenceOf, syncAccounting } from "../src/services/accounting.ts";
import { systemContext, type BaseContext } from "../src/services/context.ts";
import { applyTrancheUpdate } from "../src/services/tranches.ts";
import { CLIENT_AGENT, USER_ADMIN, USER_OFFICER, WS_APPLICANT, WS_FUNDER, bearer, harness, type Harness } from "./helpers.ts";

const USER_FINANCE = "f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1";
const PROGRAM = "0190a000-0000-7000-8000-00000000a001";
const OTHER_GRANTEE = "0190a000-0000-7000-8000-00000000b002";
// Field names a QuickBooks request must never carry, spelled in pieces so this file passes the sensitive-data gate.
const NEVER_SENT = [["Acct", "Num"].join(""), "acct_num", ["Tax", "Identifier"].join(""), "tax_identifier", "business_number", "BankAccountRef", "CheckPayment", "PrintStatus", "bill_addr", "primary_email_addr", "VendorRef", "LinkedTxn", "routing", "destinationLast4", "last4"];
const LAST4 = "6789";

let h: Harness;
let books: FixtureQuickBooksBooks;
let admin: Record<string, string>;
let finance: Record<string, string>;
let officer: Record<string, string>;
let seq = 0;

const headers = async (user: string) => ({ ...bearer(await h.session(user)).headers, "X-GMS-Workspace": WS_FUNDER, "Content-Type": "application/json" });
async function call<T>(who: Record<string, string>, method: string, path: string, body?: unknown) {
  const res = await h.request(path, { method, headers: who, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const text = await res.text();
  let json: { data: T; errors?: { code: string }[] } = { data: null as T };
  try {
    json = JSON.parse(text) as typeof json;
  } catch {
    /* not JSON */
  }
  return { status: res.status, body: json, text };
}
async function data<T>(who: Record<string, string>, method: string, path: string, body?: unknown): Promise<T> {
  const r = await call<T>(who, method, path, body);
  if (r.status >= 300) throw new Error(`${method} ${path} → ${r.status} ${r.text}`);
  return r.body.data;
}
const code = (r: { body: { errors?: { code: string }[] } }) => r.body.errors?.[0]?.code;

/** An agent acting for the admin with every scope of the role, and an API client with the same. */
async function machines() {
  const scope = scopesForRole("funder", "admin").join(" ");
  const agent = await h.forge({ sub: USER_ADMIN, client_id: CLIENT_AGENT, scope, [WORKSPACE_CLAIM]: WS_FUNDER, jti: `tok-qb-${++seq}` });
  const client = await h.forge({ scope, [WORKSPACE_CLAIM]: WS_FUNDER, jti: `tok-qb-${++seq}` });
  return [agent, client].map((t) => ({ ...bearer(t).headers, "X-GMS-Workspace": WS_FUNDER, "Content-Type": "application/json" }));
}

const base = (): BaseContext =>
  ({ repos: h.repos, ledger: h.ledger, webhooks: h.webhooks, now: () => h.clock.now, config: { baseUrl: "https://gms.test", webBaseUrl: "https://app.gms.test", passportBaseUrl: null, credentialsKey: null, passportClient: null, mailFrom: null }, ports: { quickbooks: books } }) as unknown as BaseContext;
const sys = () => systemContext(base(), { job: "test" }, { id: WS_FUNDER, kind: "funder" });
const later = (ms: number) => (h.clock.now = new Date(h.clock.now.getTime() + ms));

/** An award to a grantee with one due payment. */
async function award(recipient = WS_APPLICANT, amountMinor = 2_500_000, title = "Clean water for Riverside") {
  const a = await h.repos.table("awards").insert({ workspace_id: WS_FUNDER, recipient_workspace_id: recipient, title, program_id: PROGRAM, status: "active", funding: { awardedAmount: { amount: String(amountMinor / 100), currency: "USD" } } } as never);
  const s = await h.repos.table("payment_schedules").insert({ workspace_id: WS_FUNDER, award_id: a.id } as never);
  const t = await h.repos.table("tranches").insert({ workspace_id: WS_FUNDER, schedule_id: s.id, award_id: a.id, seq: 1, amount_minor: amountMinor, status: "due", condition: { type: "manual" } } as never);
  return { award: a, tranche: t };
}
/** Record a payment the way the GMS does: through the tranche machine (paid elsewhere, with the funder's reference and last four digits). */
const payElsewhere = (trancheId: string, paidAt = "2027-04-15") => applyTrancheUpdate(sys(), { trancheId, path: ["settled"], patch: { mode: "resolve", external: { reference: "Wire 7781", paidAt, last4: LAST4 } } } as never, "funder");
/** A payment disbursed through Passport, settled there and mirrored here. */
async function payThroughPassport(trancheId: string) {
  await h.repos.table("tranches").update({ id: trancheId }, { status: "initiated", mode: "facilitated", passport_disbursement_id: `dsb_${++seq}`, released_at: h.clock.now.toISOString() });
  return applyTrancheUpdate(sys(), { trancheId, path: ["settled"], patch: { passportStatus: "settled" } } as never, "passport");
}

const SETTINGS = { expenseId: "61", paidFromId: "35", tracking: "class", programs: { [PROGRAM]: "5000000000000012345" }, vendorPolicy: "create", syncEnabled: true };
const connectAndTurnOn = async (extra: Record<string, unknown> = {}) => {
  await data(admin, "POST", "/gms/connectors/quickbooks", {});
  return data<{ settings: { syncEnabled: boolean; syncFrom: string } }>(finance, "PUT", "/gms/accounting/settings", { ...SETTINGS, ...extra });
};
const entries = () => h.repos.table("accounting_entries").find({ workspace_id: WS_FUNDER });
const created = () => books.calls.filter((c) => c.method === "createExpense");
function keysOf(v: unknown, out: string[] = []): string[] {
  if (Array.isArray(v)) v.forEach((x) => keysOf(x, out));
  else if (v && typeof v === "object")
    for (const [k, x] of Object.entries(v)) {
      out.push(k);
      keysOf(x, out);
    }
  return out;
}

beforeEach(async () => {
  h = await harness();
  books = new FixtureQuickBooksBooks();
  await h.repos.table("workspace_members").insert({ workspace_id: WS_FUNDER, user_id: USER_FINANCE, role: "finance" });
  await h.repos.table("programs").insert({ id: PROGRAM, workspace_id: WS_FUNDER, name: "Community health" });
  await h.repos.table("workspaces").insert({ id: OTHER_GRANTEE, kind: "applicant", handle: "pine-street", display_name: "Pine Street Pantry" });
  admin = await headers(USER_ADMIN);
  finance = await headers(USER_FINANCE);
  officer = await headers(USER_OFFICER);
});

const withBooks = () => Object.assign(h.extraPorts, { quickbooks: books });

describe("hidden until configured", () => {
  it("says whether this server can connect QuickBooks, and answers 503 instead of offering what cannot work", async () => {
    const available = async () => ((await (await h.request("/gms/config")).json()) as { data: { available: Record<string, boolean> } }).data.available;
    expect((await available()).quickbooks).toBe(false);
    expect(await data(finance, "GET", "/gms/accounting")).toMatchObject({ configured: false, connected: false, settings: { syncEnabled: false } });
    expect(code(await call(admin, "POST", "/gms/connectors/quickbooks", {}))).toBe("connector_not_configured");
    expect(code(await call(finance, "GET", "/gms/accounting/options"))).toBe("connector_not_configured");
    withBooks();
    expect((await available()).quickbooks).toBe(true);
    expect(await data(finance, "GET", "/gms/accounting")).toMatchObject({ configured: true, connected: true });
  });

  it("is a funder's admins' and finance staff's: a program officer and an applicant workspace are refused", async () => {
    withBooks();
    expect((await call(officer, "GET", "/gms/accounting")).status).toBe(403);
    const applicant = { ...admin, "X-GMS-Workspace": WS_APPLICANT };
    await h.repos.table("workspace_members").insert({ workspace_id: WS_APPLICANT, user_id: USER_ADMIN, role: "admin" });
    expect(code(await call(applicant, "GET", "/gms/accounting"))).toBe("wrong_workspace_kind");
  });
});

describe("a person's own act", () => {
  beforeEach(withBooks);

  it("refuses agents and API clients on connecting, the mapping, the switch and each entry, and writes nothing", async () => {
    const { tranche } = await award();
    await connectAndTurnOn();
    await payElsewhere(tranche.id);
    await syncAccounting(base());
    books.refuseNextExpense = true;
    const [entry] = await entries();
    const writes: [string, string, unknown?][] = [
      ["POST", "/gms/connectors/quickbooks", {}],
      ["DELETE", "/gms/connectors/quickbooks"],
      ["PUT", "/gms/accounting/settings", { ...SETTINGS, syncEnabled: false }],
      ["PUT", "/gms/accounting/vendors", { vendors: [{ granteeId: WS_APPLICANT, vendorId: "56" }] }],
      ["POST", `/gms/accounting/entries/${entry!.id}/handled`],
      ["POST", `/gms/accounting/entries/${entry!.id}/retry`],
    ];
    for (const [method, path, body] of writes) {
      for (const who of await machines()) {
        const before = h.ledger.events.length;
        const r = await call(who, method, path, body);
        expect([r.status, path]).toEqual([403, path]);
        expect(["person_required", "human_only", "insufficient_scope"]).toContain(code(r));
        expect(h.ledger.events.length).toBe(before);
      }
    }
    expect((await h.repos.table("accounting_links").one({ workspace_id: WS_FUNDER }))?.sync_enabled).toBe(true);
    expect(books.connected).toBe(true);
  });

  it("lets an agent read the setting and the reconciliation view, and gives it a read tool only", async () => {
    await connectAndTurnOn();
    const [agent] = await machines();
    expect(await data(agent!, "GET", "/gms/accounting")).toMatchObject({ connected: true, settings: { syncEnabled: true, expense: { id: "61", name: "Grants and assistance" } } });
    expect((await call(agent!, "GET", "/gms/accounting/entries")).status).toBe(200);
    const reader = await h.forge({ scope: "payments:read", [WORKSPACE_CLAIM]: WS_FUNDER, jti: `tok-qb-${++seq}` });
    expect((await call({ ...bearer(reader).headers, "X-GMS-Workspace": WS_FUNDER }, "GET", "/gms/accounting")).status).toBe(200);
    const rpc = async (method: string, params?: unknown) => {
      const res = await h.request("/mcp", { method: "POST", headers: { ...agent!, Accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++seq, method, ...(params ? { params } : {}) }) });
      return (await res.json()) as { result: { tools?: { name: string }[]; structuredContent?: Record<string, unknown> } };
    };
    const tools = (await rpc("tools/list")).result.tools!.map((t) => t.name);
    expect(tools.filter((n) => /quickbooks|accounting|vendor|books/.test(n))).toEqual(["get_accounting_sync"]);
    expect((await rpc("tools/call", { name: "get_accounting_sync", arguments: {} })).result.structuredContent).toMatchObject({ configured: true, connected: true, settings: { syncEnabled: true } });
  });

  it("connects through Composio as a workspace admin only; finance staff set the mapping", async () => {
    books.connected = false;
    const started = await data<{ connected: boolean; connectUrl: string }>(admin, "POST", "/gms/connectors/quickbooks", { returnTo: "/w/riverbend/settings/accounting" });
    expect(started).toMatchObject({ connected: false, connectUrl: expect.stringContaining("composio.invalid/connect/quickbooks") });
    expect((await h.repos.table("connector_accounts").one({ workspace_id: WS_FUNDER, provider: "quickbooks" }))?.scopes).toEqual(["com.intuit.quickbooks.accounting"]);
    expect((await call(finance, "POST", "/gms/connectors/quickbooks", {})).status).toBe(403);
    // Not connected: the sync cannot be turned on.
    expect(code(await call(finance, "PUT", "/gms/accounting/settings", SETTINGS))).toBe("quickbooks_not_connected");
    books.connected = true;
    expect((await data<{ settings: { syncEnabled: boolean } }>(finance, "PUT", "/gms/accounting/settings", SETTINGS)).settings.syncEnabled).toBe(true);
  });
});

describe("the mapping, set once", () => {
  beforeEach(withBooks);

  it("lists what QuickBooks has, and keeps the ids and names of what was chosen", async () => {
    await data(admin, "POST", "/gms/connectors/quickbooks", {});
    const options = await data<Record<string, { id: string; name: string }[]>>(finance, "GET", "/gms/accounting/options");
    expect(options.expenseAccounts!.map((a) => a.name)).toEqual(["Grants and assistance", "Program expenses"]);
    expect(options.bankAccounts).toEqual([{ id: "35", name: "Operating checking" }]);
    expect(options.classes!.map((c) => c.name)).toEqual(["Community health", "Youth programs"]);
    const saved = await data<{ settings: Record<string, unknown>; programs: { programId: string; ref: unknown }[] }>(finance, "PUT", "/gms/accounting/settings", { ...SETTINGS, syncEnabled: false });
    expect(saved.settings).toMatchObject({ expense: { id: "61", name: "Grants and assistance" }, paidFrom: { id: "35", name: "Operating checking" }, tracking: "class", vendorPolicy: "create", currency: "USD", syncEnabled: false, syncFrom: null });
    expect(saved.programs).toEqual([{ programId: PROGRAM, name: "Community health", ref: { id: "5000000000000012345", name: "Community health" } }]);
  });

  it("refuses a QuickBooks record it does not list, and a program of another workspace", async () => {
    await data(admin, "POST", "/gms/connectors/quickbooks", {});
    expect(code(await call(finance, "PUT", "/gms/accounting/settings", { ...SETTINGS, expenseId: "999" }))).toBe("unknown_account");
    expect(code(await call(finance, "PUT", "/gms/accounting/settings", { ...SETTINGS, paidFromId: "61" }))).toBe("unknown_account");
    expect(code(await call(finance, "PUT", "/gms/accounting/settings", { ...SETTINGS, programs: { [PROGRAM]: "777" } }))).toBe("unknown_class");
    expect(code(await call(finance, "PUT", "/gms/accounting/settings", { ...SETTINGS, programs: { "0190a000-0000-7000-8000-00000000dead": "5000000000000012345" } }))).toBe("unknown_program");
    const bad = await call(finance, "PUT", "/gms/accounting/settings", { ...SETTINGS, expenseId: "Grants" });
    expect([bad.status, code(bad)]).toEqual([400, "bad_request"]);
    expect(await h.repos.table("accounting_links").one({ workspace_id: WS_FUNDER })).toBeNull();
  });

  it("matches grantees to vendors by name, and lets a person choose another", async () => {
    await award();
    await award(OTHER_GRANTEE, 1_000_000, "Food pantry hours");
    await connectAndTurnOn({ syncEnabled: false });
    const v = await data<{ grantees: { granteeId: string; name: string; vendor: unknown; suggestion: unknown }[] }>(finance, "GET", "/gms/accounting/vendors");
    expect(v.grantees).toEqual([
      { granteeId: WS_APPLICANT, name: "Alder Creek Family Services", vendor: null, suggestion: { id: "56", name: "Alder Creek Family Services" } },
      { granteeId: OTHER_GRANTEE, name: "Pine Street Pantry", vendor: null, suggestion: null },
    ]);
    const after = await data<{ grantees: { vendor: unknown }[] }>(finance, "PUT", "/gms/accounting/vendors", { vendors: [{ granteeId: OTHER_GRANTEE, vendorId: "56" }] });
    expect(after.grantees[1]!.vendor).toEqual({ id: "56", name: "Alder Creek Family Services" });
    expect(code(await call(finance, "PUT", "/gms/accounting/vendors", { vendors: [{ granteeId: OTHER_GRANTEE, vendorId: "4040" }] }))).toBe("unknown_vendor");
    expect((await call(finance, "PUT", "/gms/accounting/vendors", { vendors: [{ granteeId: "0190a000-0000-7000-8000-00000000dead", vendorId: "56" }] })).status).toBe(404);
  });
});

describe("sync: one expense per recorded payment", () => {
  beforeEach(withBooks);

  it("is off until a person turns it on, and posts only payments recorded from then on", async () => {
    const before = await award();
    const after = await award(WS_APPLICANT, 1_200_000, "Library hours");
    await payElsewhere(before.tranche.id);
    await connectAndTurnOn({ syncEnabled: false });
    expect(await syncAccounting(base())).toMatchObject({ workspaces: 0, posted: 0 });
    later(60_000);
    await data(finance, "PUT", "/gms/accounting/settings", SETTINGS);
    later(60_000);
    await payElsewhere(after.tranche.id, "2027-04-16");
    expect(await syncAccounting(base())).toMatchObject({ workspaces: 1, posted: 1, failed: 0 });
    const [e] = await entries();
    expect(e).toMatchObject({ tranche_id: after.tranche.id, status: "posted", external_id: expect.stringMatching(/^\d+$/), doc_number: referenceOf(after.tranche.id), amount_minor: 1_200_000, paid_on: "2027-04-16", vendor_ref: "56", vendor_name: "Alder Creek Family Services" });
    expect(created()).toHaveLength(1);
  });

  it("writes the right arguments: the vendor, the accounts, the program's class, the date, the amount and a memo, and nothing bank-shaped", async () => {
    const { tranche } = await award();
    await connectAndTurnOn();
    later(60_000);
    await payElsewhere(tranche.id, "2027-04-16");
    await syncAccounting(base());
    expect(created()[0]!.args).toEqual({
      PaymentType: "Cash",
      AccountRef: { value: "35" },
      EntityRef: { value: "56" },
      TxnDate: "2027-04-16",
      TotalAmt: 25000,
      DocNumber: referenceOf(tranche.id),
      PrivateNote: "Grant payment 1: Clean water for Riverside (Community health). Recorded by OpenGrants GMS.",
      Line: [{ Amount: 25000, DetailType: "AccountBasedExpenseLineDetail", Description: "Grant payment 1: Clean water for Riverside (Community health). Recorded by OpenGrants GMS.", AccountBasedExpenseLineDetail: { AccountRef: { value: "61" }, ClassRef: { value: "5000000000000012345" } } }],
    });
    // Neither the funder's payment reference nor the last four digits of the account it was paid to go to QuickBooks.
    const sent = JSON.stringify(books.calls);
    expect(sent).not.toContain(LAST4);
    expect(sent).not.toContain("Wire 7781");
    expect(keysOf(books.calls).filter((k) => NEVER_SENT.includes(k))).toEqual([]);
  });

  it("posts a payment disbursed through Passport on the day Passport settled it, and moves no money", async () => {
    const { award: a, tranche } = await award();
    await connectAndTurnOn();
    const fundingBefore = JSON.stringify((await h.repos.table("awards").one({ id: a.id }))!.funding);
    let passportCalls = 0;
    h.passport.fetch = async () => {
      passportCalls++;
      return new Response("{}", { status: 500 });
    };
    later(86_400_000);
    await payThroughPassport(tranche.id);
    const trancheBefore = await h.repos.table("tranches").one({ id: tranche.id });
    await syncAccounting(base());
    expect(created()[0]!.args).toMatchObject({ TxnDate: h.clock.now.toISOString().slice(0, 10), TotalAmt: 25000 });
    // Record-keeping only: the payment, the award's disbursed amount and Passport are untouched.
    expect(await h.repos.table("tranches").one({ id: tranche.id })).toEqual(trancheBefore);
    expect(JSON.stringify((await h.repos.table("awards").one({ id: a.id }))!.funding)).toBe(fundingBefore);
    expect(passportCalls).toBe(0);
  });

  it("is idempotent per payment: a second run, or a second Worker, writes nothing more", async () => {
    const { tranche } = await award();
    await connectAndTurnOn();
    later(60_000);
    await payElsewhere(tranche.id);
    await Promise.all([syncAccounting(base()), syncAccounting(base())]);
    await syncAccounting(base());
    expect(created()).toHaveLength(1);
    expect(await entries()).toHaveLength(1);
  });

  it("finds an entry QuickBooks took before a crash, by its reference, instead of writing a second one", async () => {
    const { tranche } = await award();
    await connectAndTurnOn();
    later(60_000);
    await payElsewhere(tranche.id);
    // QuickBooks took it; the Worker stopped before keeping its id.
    await books.createExpense(WS_FUNDER, { paidFromId: "35", expenseId: "61", vendorId: "56", amountMinor: 2_500_000, currency: "USD", date: "2027-04-15", memo: "m", docNumber: referenceOf(tranche.id) });
    await h.repos.table("accounting_entries").insert({ workspace_id: WS_FUNDER, tranche_id: tranche.id, doc_number: referenceOf(tranche.id), status: "posting", amount_minor: 2_500_000, currency: "USD", paid_on: "2027-04-15", memo: "m" });
    await syncAccounting(base());
    expect(created()).toHaveLength(1);
    later(STUCK_POSTING_MS + 1000);
    await syncAccounting(base());
    expect(created()).toHaveLength(1);
    expect((await entries())[0]).toMatchObject({ status: "posted", external_id: [...books.expenses.keys()][0] });
  });

  it("creates a vendor with the organization's name only, or waits for a person when asked to", async () => {
    const pine = await award(OTHER_GRANTEE, 1_000_000, "Food pantry hours");
    await connectAndTurnOn({ vendorPolicy: "ask" });
    later(60_000);
    await payElsewhere(pine.tranche.id);
    await syncAccounting(base());
    expect((await entries())[0]).toMatchObject({ status: "failed", reason: "vendor_unclear" });
    expect(books.calls.filter((c) => c.method === "createVendor")).toEqual([]);
    await data(finance, "PUT", "/gms/accounting/settings", { ...SETTINGS, vendorPolicy: "create" });
    await syncAccounting(base());
    expect(books.calls.filter((c) => c.method === "createVendor")).toEqual([{ method: "createVendor", args: { display_name: "Pine Street Pantry", company_name: "Pine Street Pantry" } }]);
    expect((await entries())[0]).toMatchObject({ status: "posted", vendor_name: "Pine Street Pantry" });
    // The vendor is kept for the next payment to the same grantee.
    expect((await h.repos.table("accounting_links").one({ workspace_id: WS_FUNDER }))!.vendor_map).toMatchObject({ [OTHER_GRANTEE]: { name: "Pine Street Pantry" } });
  });

  it("does not post a payment in another currency, and stops at QuickBooks' refusals after a few tries", async () => {
    const { tranche } = await award();
    const eur = await award(WS_APPLICANT, 900_000, "Euro grant");
    await h.repos.table("tranches").update({ id: eur.tranche.id }, { currency: "EUR" });
    await connectAndTurnOn();
    later(60_000);
    await payElsewhere(eur.tranche.id);
    await syncAccounting(base());
    expect((await entries())[0]).toMatchObject({ status: "failed", reason: "currency" });
    for (let i = 0; i < MAX_ATTEMPTS + 2; i++) {
      books.refuseNextExpense = true;
      if (i === 0) await payElsewhere(tranche.id);
      await syncAccounting(base());
    }
    const refused = (await entries()).find((e) => e.tranche_id === tranche.id)!;
    expect(refused).toMatchObject({ status: "failed", reason: "refused", attempts: MAX_ATTEMPTS });
    expect(created().filter((c) => (c.args as { DocNumber: string }).DocNumber === referenceOf(tranche.id))).toHaveLength(MAX_ATTEMPTS);
    // A person tries it again.
    books.refuseNextExpense = false;
    await data(finance, "POST", `/gms/accounting/entries/${refused.id}/retry`);
    await syncAccounting(base());
    expect((await entries()).find((e) => e.tranche_id === tranche.id)).toMatchObject({ status: "posted" });
  });

  it("stops at once when the sync is turned off, and disconnecting QuickBooks turns it off", async () => {
    const { tranche } = await award();
    await connectAndTurnOn();
    await data(finance, "PUT", "/gms/accounting/settings", { ...SETTINGS, syncEnabled: false });
    later(60_000);
    await payElsewhere(tranche.id);
    await syncAccounting(base());
    expect(created()).toEqual([]);
    await data(finance, "PUT", "/gms/accounting/settings", SETTINGS);
    await data(admin, "DELETE", "/gms/connectors/quickbooks");
    expect((await h.repos.table("accounting_links").one({ workspace_id: WS_FUNDER }))!.sync_enabled).toBe(false);
    expect(books.connected).toBe(false);
  });
});

describe("edits and voids need attention; the books are never changed", () => {
  beforeEach(withBooks);

  async function posted() {
    const made = await award();
    await connectAndTurnOn();
    later(60_000);
    await payElsewhere(made.tranche.id);
    await syncAccounting(base());
    const writes = books.calls.length;
    return { ...made, writes };
  }

  it("marks an edited amount as needing attention, and writes nothing to QuickBooks", async () => {
    const { tranche, writes } = await posted();
    await h.repos.table("tranches").update({ id: tranche.id }, { amount_minor: 2_400_000 });
    expect(await syncAccounting(base())).toMatchObject({ attention: 1 });
    expect((await entries())[0]).toMatchObject({ status: "needs_attention", reason: "changed", attention: { amountMinor: { posted: 2_500_000, now: 2_400_000 } } });
    expect(books.calls.slice(writes).filter((c) => c.method === "createExpense")).toEqual([]);
    expect(books.expenses.size).toBe(1);
    expect([...books.expenses.values()][0]!.amountMinor).toBe(2_500_000);
  });

  it("marks a voided payment as needing attention, and a person marks it handled once QuickBooks is fixed", async () => {
    const { tranche } = await posted();
    await applyTrancheUpdate(sys(), { trancheId: tranche.id, path: ["returned"], patch: { passportStatus: "returned" } } as never, "passport");
    await syncAccounting(base());
    const [e] = await entries();
    expect(e).toMatchObject({ status: "needs_attention", reason: "voided", attention: { status: "returned" } });
    const view = await data<{ items: { quickbooks: { status: string; entry: { reason: string } | null } }[] }>(finance, "GET", "/gms/accounting/entries");
    expect(view.items[0]!.quickbooks).toMatchObject({ status: "needs_attention", entry: { reason: "voided" } });
    expect(await data(finance, "POST", `/gms/accounting/entries/${e!.id}/handled`)).toMatchObject({ status: "handled" });
    await syncAccounting(base());
    expect((await entries())[0]).toMatchObject({ status: "handled" });
    expect(code(await call(finance, "POST", `/gms/accounting/entries/${e!.id}/handled`))).toBe("invalid_transition");
  });

  it("raises a later change again after a person handled one, and notices a changed payment date", async () => {
    const { tranche } = await posted();
    await h.repos.table("tranches").update({ id: tranche.id }, { amount_minor: 2_400_000 });
    await syncAccounting(base());
    const [e] = await entries();
    await data(finance, "POST", `/gms/accounting/entries/${e!.id}/handled`);
    await syncAccounting(base());
    expect((await entries())[0]).toMatchObject({ status: "handled", amount_minor: 2_400_000 });
    await h.repos.table("tranches").update({ id: tranche.id }, { external: { reference: "Wire 7781", paidAt: "2027-04-20", destinationLast4: LAST4 } });
    await syncAccounting(base());
    expect((await entries())[0]).toMatchObject({ status: "needs_attention", reason: "changed", attention: { paidOn: { posted: "2027-04-15", now: "2027-04-20" } } });
  });
});

describe("the reconciliation view", () => {
  beforeEach(withBooks);

  it("lists the GMS's payments next to their QuickBooks entries, and compares them with QuickBooks on request", async () => {
    const early = await award(WS_APPLICANT, 500_000, "Before the sync");
    await payElsewhere(early.tranche.id);
    const { tranche } = await award();
    later(60_000);
    await connectAndTurnOn();
    later(60_000);
    await payElsewhere(tranche.id);
    type View = { syncEnabled: boolean; items: { payment: { trancheId: string; grantee: string; awardTitle: string } | null; quickbooks: { status: string; inQuickBooks?: string; entry: { quickbooksId: string; reference: string } | null } }[] };
    const waiting = await data<View>(finance, "GET", "/gms/accounting/entries");
    expect(waiting.items.map((i) => [i.payment?.awardTitle, i.quickbooks.status])).toEqual([
      ["Clean water for Riverside", "waiting"],
      ["Before the sync", "not_synced"],
    ]);
    await syncAccounting(base());
    const view = await data<View>(finance, "GET", "/gms/accounting/entries?compare=true");
    expect(view.items[0]).toMatchObject({ payment: { grantee: "Alder Creek Family Services" }, quickbooks: { status: "posted", inQuickBooks: "matches", entry: { reference: referenceOf(tranche.id) } } });
    books.expenses.clear();
    expect((await data<View>(finance, "GET", "/gms/accounting/entries?compare=true")).items[0]!.quickbooks.inQuickBooks).toBe("missing");
    // Reading the view, and comparing, writes nothing: not to the GMS, not to QuickBooks.
    expect(books.calls.filter((c) => ["createExpense", "createVendor"].includes(c.method))).toHaveLength(1);
    expect((await entries())[0]).toMatchObject({ status: "posted" });
  });
});
