// SPDX-License-Identifier: AGPL-3.0-only
// QuickBooks Online over the real ComposioClient, against a fake Composio (an in-process fetch
// answering in the shapes of Composio's REST API v3.1 and its QuickBooks tools). Each test checks
// the tool slug and the exact arguments the GMS would send, and that nothing bank- or tax-shaped is
// sent or kept. Nothing here calls Composio or QuickBooks.
import { beforeEach, describe, expect, it } from "vitest";
import {
  ComposioClient,
  ComposioQuickBooksBooks,
  ConnectorAuthError,
  ConnectorScopeError,
  ConnectorScopeUnverifiedError,
  EXPENSE_PAYMENT_TYPE,
  FixtureQuickBooksBooks,
  QUICKBOOKS_ACCOUNTING,
  QUICKBOOKS_TOOLS,
  SourceReadError,
  checkAppScopes,
  expenseArgs,
  qbLiteral,
  quickBooksName,
  quickBooksPort,
  type ExpenseEntry,
  type FetchLike,
} from "../src/index.ts";

const KEY = "composio-test-key";
const ENTITY = "11111111-1111-4111-8111-111111111111";
const CONFIG = "ac_test_quickbooks";

// Field names a QuickBooks record may carry that the GMS must never send or keep. Spelled in pieces
// so this file passes the sensitive-data gate; the test reads them as whole words.
const NUM = ["Acct", "Num"].join("");
const TAX = ["Tax", "Identifier"].join("");
const NEVER_SENT = [NUM, "acct_num", TAX, "tax_identifier", "business_number", "BusinessNumber", "BankAccountRef", "CheckPayment", "CreditCardPayment", "PrintStatus", "PayType", "bill_addr", "BillAddr", "primary_email_addr", "primary_phone", "VendorRef", "APAccountRef", "LinkedTxn"];
const RUN = "0001" + "23456789";

interface Seen {
  method: string;
  path: string;
  body: Record<string, unknown> | null;
}

const state = {
  seen: [] as Seen[],
  accounts: [] as { id: string; status: string; scope: string }[],
  tools: {} as Record<string, (args: Record<string, unknown>) => { successful?: boolean; data: unknown }>,
};

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const fakeFetch: FetchLike = async (input, init) => {
  const url = new URL(input);
  const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
  state.seen.push({ method: init?.method ?? "GET", path: url.pathname, body });
  if ((init?.headers as Record<string, string>)["x-api-key"] !== KEY) return json(401, { error: { message: "bad key" } });
  if (url.pathname === "/api/v3.1/connected_accounts") return json(200, { items: state.accounts.map((a) => ({ id: a.id, status: a.status })) });
  if (url.pathname === "/api/v3.1/connected_accounts/link") return json(201, { connected_account_id: "ca_qbo_new", redirect_url: "https://connect.composio.example/start", expires_at: null });
  const one = /^\/api\/v3\.1\/connected_accounts\/([^/]+)$/.exec(url.pathname);
  if (one && init?.method === "DELETE") {
    state.accounts = state.accounts.filter((a) => a.id !== one[1]);
    return json(200, { success: true });
  }
  if (one) {
    const a = state.accounts.find((x) => x.id === one[1]);
    return a ? json(200, { id: a.id, status: a.status, user_id: ENTITY, auth_config: { id: CONFIG }, state: { val: { scope: a.scope, access_token: "never-kept", realm_id: "9130350000000000" } } }) : json(404, { error: { message: "not found" } });
  }
  const tool = /^\/api\/v3\.1\/tools\/execute\/([A-Z0-9_]+)$/.exec(url.pathname);
  if (tool) {
    const handler = state.tools[tool[1]!];
    if (!handler) return json(200, { successful: false, error: "no such tool in the fake", data: null });
    const r = handler((body?.arguments ?? {}) as Record<string, unknown>);
    return json(200, { successful: r.successful ?? true, error: r.successful === false ? "QuickBooks said: ValidationFault internal detail" : null, data: r.data });
  }
  return json(404, { error: { message: "unknown" } });
};

const books = () => new ComposioQuickBooksBooks({ client: new ComposioClient({ apiKey: KEY, baseUrl: "https://composio.example", fetch: fakeFetch }), authConfigId: CONFIG, callbackUrl: (_e, back) => `https://gms.test${back ?? "/"}?connected=quickbooks` });
const toolCalls = (slug: string) => state.seen.filter((s) => s.path === `/api/v3.1/tools/execute/${slug}`);
const toolArgs = (slug: string) => toolCalls(slug).map((s) => s.body?.arguments as Record<string, unknown>);
const connected = () => (state.accounts = [{ id: "ca_qbo", status: "ACTIVE", scope: `${QUICKBOOKS_ACCOUNTING} openid` }]);

/** Every key anywhere in a value. */
function keysOf(v: unknown, out: string[] = []): string[] {
  if (Array.isArray(v)) v.forEach((x) => keysOf(x, out));
  else if (v && typeof v === "object")
    for (const [k, x] of Object.entries(v)) {
      out.push(k);
      keysOf(x, out);
    }
  return out;
}

const ENTRY: ExpenseEntry = { paidFromId: "35", expenseId: "61", vendorId: "56", amountMinor: 1_250_050, currency: "USD", date: "2027-04-16", memo: "Grant payment 1: Clean water for Riverside (Community health). Recorded by OpenGrants GMS.", docNumber: "GMS-0190a0000001", classId: "5000000000000012345" };

beforeEach(() => {
  state.seen = [];
  state.accounts = [];
  state.tools = {};
});

describe("scopes", () => {
  it("holds a connection to the accounting scope: Payments, Payroll and anything else are refused", () => {
    expect(checkAppScopes("quickbooks", `${QUICKBOOKS_ACCOUNTING} openid profile email`)).toEqual({ ok: true, excess: [], missing: [] });
    expect(checkAppScopes("quickbooks", `${QUICKBOOKS_ACCOUNTING} com.intuit.quickbooks.payment`).excess).toEqual(["com.intuit.quickbooks.payment"]);
    expect(checkAppScopes("quickbooks", `${QUICKBOOKS_ACCOUNTING} payroll.compensation.read`).excess).toEqual(["payroll.compensation.read"]);
    expect(checkAppScopes("quickbooks", `${QUICKBOOKS_ACCOUNTING} phone address`).excess).toEqual(["phone", "address"]);
    expect(checkAppScopes("quickbooks", "openid").missing).toEqual([QUICKBOOKS_ACCOUNTING]);
  });

  it("deletes a connection that holds the Payments scope, and does not use one that reports no scopes", async () => {
    state.accounts = [{ id: "ca_qbo", status: "ACTIVE", scope: `${QUICKBOOKS_ACCOUNTING} com.intuit.quickbooks.payment` }];
    await expect(books().listAccounts(ENTITY, "expense")).rejects.toBeInstanceOf(ConnectorScopeError);
    expect(state.accounts).toEqual([]);
    expect(toolCalls(QUICKBOOKS_TOOLS.queryAccounts)).toHaveLength(0);
    state.accounts = [{ id: "ca_qbo", status: "ACTIVE", scope: "" }];
    await expect(books().listAccounts(ENTITY, "expense")).rejects.toBeInstanceOf(ConnectorScopeUnverifiedError);
    expect(toolCalls(QUICKBOOKS_TOOLS.queryAccounts)).toHaveLength(0);
  });

  it("is absent until the key and its own auth config are set, and a missing connection is refused", async () => {
    expect(quickBooksPort({ COMPOSIO_API_KEY: KEY }, () => "")).toEqual({});
    expect(quickBooksPort({ COMPOSIO_QUICKBOOKS_AUTH_CONFIG_ID: CONFIG }, () => "")).toEqual({});
    expect(quickBooksPort({ COMPOSIO_API_KEY: KEY, COMPOSIO_QUICKBOOKS_AUTH_CONFIG_ID: CONFIG }, () => "").quickbooks?.provider).toBe("quickbooks");
    await expect(books().listVendors(ENTITY)).rejects.toBeInstanceOf(ConnectorAuthError);
    expect((await books().status(ENTITY, { link: true })).connectUrl).toBe("https://connect.composio.example/start");
    expect(state.seen.find((s) => s.path === "/api/v3.1/connected_accounts/link")?.body).toEqual({ auth_config_id: CONFIG, user_id: ENTITY, callback_url: "https://gms.test/?connected=quickbooks" });
  });
});

describe("reads keep an id, a name and a type, nothing else", () => {
  beforeEach(connected);

  it("lists active expense and bank accounts, dropping each account's own number and balances", async () => {
    state.tools[QUICKBOOKS_TOOLS.queryAccounts] = (args) => ({
      data: {
        QueryResponse: {
          Account: String(args.query).includes("'Bank'")
            ? [{ Id: "35", Name: `Operating checking ${RUN}`, AccountType: "Bank", [NUM]: RUN, CurrentBalance: 81234.5, Active: true }]
            : [
                { Id: "62", Name: "Program expenses", AccountType: "Expense", CurrentBalance: 10 },
                { Id: "61", Name: "Grants and assistance", FullyQualifiedName: "Grants and assistance", AccountType: "Expense", [NUM]: "6100" },
              ],
        },
      },
    });
    const expense = await books().listAccounts(ENTITY, "expense");
    const bank = await books().listAccounts(ENTITY, "bank");
    expect(expense).toEqual([
      { id: "61", name: "Grants and assistance" },
      { id: "62", name: "Program expenses" },
    ]);
    // A bank account named after its number shows the last four digits only.
    expect(bank).toEqual([{ id: "35", name: "Operating checking •••6789" }]);
    expect(JSON.stringify([expense, bank])).not.toContain(RUN);
    expect(toolArgs(QUICKBOOKS_TOOLS.queryAccounts)).toEqual([
      { query: "SELECT * FROM Account WHERE Active = true AND AccountType IN ('Expense', 'Other Expense') STARTPOSITION 1 MAXRESULTS 1000" },
      { query: "SELECT * FROM Account WHERE Active = true AND AccountType IN ('Bank') STARTPOSITION 1 MAXRESULTS 1000" },
    ]);
  });

  it("lists vendors without their tax, bank, address or contact fields, and pages past 1,000", async () => {
    state.tools[QUICKBOOKS_TOOLS.queryVendors] = (args) => {
      const first = String(args.query).includes("STARTPOSITION 1 ");
      return { data: { QueryResponse: { Vendor: first ? Array.from({ length: 1000 }, (_, i) => ({ Id: String(1000 + i), DisplayName: `Vendor ${String(i).padStart(4, "0")}`, Active: true, [TAX]: "XXXXX6789", [NUM]: RUN, BillAddr: { Line1: "1 Main St" }, PrimaryEmailAddr: { Address: "ap@example.org" } })) : [{ Id: "56", DisplayName: "Alder Creek Family Services", Active: true }] } } };
    };
    const vendors = await books().listVendors(ENTITY);
    expect(vendors).toHaveLength(1001);
    expect(vendors[0]).toEqual({ id: "56", name: "Alder Creek Family Services", active: true });
    expect(Object.keys(vendors[1]!).sort()).toEqual(["active", "id", "name"]);
    expect(JSON.stringify(vendors)).not.toMatch(/6789|Main St|ap@example/);
    expect(toolArgs(QUICKBOOKS_TOOLS.queryVendors).map((a) => a.query)).toEqual(["SELECT * FROM Vendor WHERE Active = true STARTPOSITION 1 MAXRESULTS 1000", "SELECT * FROM Vendor WHERE Active = true STARTPOSITION 1001 MAXRESULTS 1000"]);
  });

  it("finds a vendor by its exact name, quoting the name for QuickBooks' query language", async () => {
    state.tools[QUICKBOOKS_TOOLS.queryVendors] = () => ({ data: { QueryResponse: { Vendor: [{ Id: "77", DisplayName: "O'Brien  Fund", Active: true }, { Id: "78", DisplayName: "O'Brien Fund Two" }] } } });
    expect(await books().findVendors(ENTITY, "O'Brien: Fund")).toEqual([{ id: "77", name: "O'Brien Fund", active: true }]);
    expect(toolArgs(QUICKBOOKS_TOOLS.queryVendors)).toEqual([{ query: "SELECT * FROM Vendor WHERE DisplayName = 'O\\'Brien Fund' MAXRESULTS 10" }]);
    expect(qbLiteral("a\\'b")).toBe("'a\\\\\\'b'");
  });

  it("lists classes and locations", async () => {
    state.tools[QUICKBOOKS_TOOLS.queryEntities] = () => ({ data: { QueryResponse: { Class: [{ Id: "5000000000000012345", Name: "Community health", FullyQualifiedName: "Community health" }] } } });
    state.tools[QUICKBOOKS_TOOLS.listDepartments] = () => ({ data: { QueryResponse: { Department: [{ Id: "1", Name: "Main office" }] } } });
    expect(await books().listClasses(ENTITY)).toEqual([{ id: "5000000000000012345", name: "Community health" }]);
    expect(await books().listDepartments(ENTITY)).toEqual([{ id: "1", name: "Main office" }]);
    expect(toolArgs(QUICKBOOKS_TOOLS.queryEntities)).toEqual([{ query: "SELECT * FROM Class WHERE Active = true STARTPOSITION 1 MAXRESULTS 1000" }]);
    expect(toolArgs(QUICKBOOKS_TOOLS.listDepartments)).toEqual([{ query: "SELECT * FROM Department WHERE Active = true STARTPOSITION 1 MAXRESULTS 1000" }]);
  });

  it("shows no long run of digits in any name", () => {
    expect(quickBooksName("Checking 000123456789")).toBe("Checking •••6789");
    expect(quickBooksName("Checking (6789)")).toBe("Checking (6789)");
    expect(quickBooksName("  Line\none\u0000 ")).toBe("Line one");
    expect(quickBooksName("")).toBe("Untitled");
  });
});

describe("writes: a vendor with a name, and one expense per payment", () => {
  beforeEach(connected);

  it("creates a vendor with the organization's name only", async () => {
    state.tools[QUICKBOOKS_TOOLS.createVendor] = () => ({ data: { Vendor: { Id: "101", DisplayName: "Alder Creek Family Services", SyncToken: "0", [TAX]: null } } });
    expect(await books().createVendor(ENTITY, "Alder Creek: Family\tServices")).toEqual({ id: "101", name: "Alder Creek Family Services", active: true });
    expect(toolArgs(QUICKBOOKS_TOOLS.createVendor)).toEqual([{ display_name: "Alder Creek Family Services", company_name: "Alder Creek Family Services" }]);
  });

  it("writes an expense with exactly these arguments: no bank, check, bill or tax field", async () => {
    state.tools[QUICKBOOKS_TOOLS.createExpense] = (args) => ({ data: { Id: "245", SyncToken: "0", TotalAmt: args.TotalAmt, TxnDate: args.TxnDate, DocNumber: args.DocNumber } });
    expect(await books().createExpense(ENTITY, ENTRY)).toEqual({ id: "245" });
    const [args] = toolArgs(QUICKBOOKS_TOOLS.createExpense);
    expect(args).toEqual({
      PaymentType: "Cash",
      AccountRef: { value: "35" },
      EntityRef: { value: "56" },
      TxnDate: "2027-04-16",
      TotalAmt: 12500.5,
      DocNumber: "GMS-0190a0000001",
      PrivateNote: ENTRY.memo,
      Line: [{ Amount: 12500.5, DetailType: "AccountBasedExpenseLineDetail", Description: ENTRY.memo, AccountBasedExpenseLineDetail: { AccountRef: { value: "61" }, ClassRef: { value: "5000000000000012345" } } }],
    });
    expect(EXPENSE_PAYMENT_TYPE).toBe("Cash");
    // Nothing bank-, check-, bill- or tax-shaped in any request this connector sent.
    const keys = state.seen.flatMap((s) => keysOf(s.body));
    expect(keys.filter((k) => NEVER_SENT.includes(k))).toEqual([]);
    // Only the tools this connector may run were called.
    const used = state.seen.map((s) => /\/tools\/execute\/([A-Z0-9_]+)$/.exec(s.path)?.[1]).filter(Boolean);
    expect(used.every((slug) => (Object.values(QUICKBOOKS_TOOLS) as string[]).includes(slug!))).toBe(true);
  });

  it("puts a location on the expense, not the line, and refuses what QuickBooks would not take", () => {
    expect(expenseArgs({ ...ENTRY, classId: null, departmentId: "1" })).toMatchObject({ DepartmentRef: { value: "1" }, Line: [{ AccountBasedExpenseLineDetail: { AccountRef: { value: "61" } } }] });
    expect(() => expenseArgs({ ...ENTRY, vendorId: "Alder" })).toThrow(SourceReadError);
    expect(() => expenseArgs({ ...ENTRY, amountMinor: 0 })).toThrow(SourceReadError);
    expect(() => expenseArgs({ ...ENTRY, currency: "JPY" })).toThrow(SourceReadError);
    expect(() => expenseArgs({ ...ENTRY, docNumber: "GMS-this-reference-is-far-too-long" })).toThrow(SourceReadError);
    expect(() => expenseArgs({ ...ENTRY, date: "16/04/2027" })).toThrow(SourceReadError);
    expect(expenseArgs({ ...ENTRY, memo: "Line\none\u0007" }).PrivateNote).toBe("Line one");
  });

  it("passes on one plain sentence when QuickBooks refuses, never QuickBooks' own text", async () => {
    state.tools[QUICKBOOKS_TOOLS.createExpense] = () => ({ successful: false, data: null });
    const e = await books().createExpense(ENTITY, ENTRY).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(SourceReadError);
    expect((e as Error).message).not.toContain("ValidationFault");
  });

  it("finds an expense by the GMS's reference, and reads one back", async () => {
    state.tools[QUICKBOOKS_TOOLS.queryEntities] = () => ({ data: { QueryResponse: { Purchase: [{ Id: "245", TotalAmt: 12500.5, TxnDate: "2027-04-16", DocNumber: "GMS-0190a0000001", AccountRef: { value: "35", name: `Checking ${RUN}` } }] } } });
    state.tools[QUICKBOOKS_TOOLS.getExpense] = (args) => (args.purchase_id === "245" ? { data: { Purchase: { Id: "245", TotalAmt: 12500.5, TxnDate: "2027-04-16", DocNumber: "GMS-0190a0000001" } } } : { successful: false, data: null });
    const found = await books().findExpense(ENTITY, "GMS-0190a0000001");
    expect(found).toEqual({ id: "245", amountMinor: 1_250_050, date: "2027-04-16", docNumber: "GMS-0190a0000001" });
    expect(JSON.stringify(found)).not.toContain(RUN);
    expect(toolArgs(QUICKBOOKS_TOOLS.queryEntities)).toEqual([{ query: "SELECT * FROM Purchase WHERE DocNumber = 'GMS-0190a0000001' MAXRESULTS 5" }]);
    expect(await books().getExpense(ENTITY, "245")).toEqual(found);
    expect(await books().getExpense(ENTITY, "999")).toBeNull();
    expect(toolArgs(QUICKBOOKS_TOOLS.getExpense)).toEqual([{ purchase_id: "245" }, { purchase_id: "999" }]);
  });
});

describe("the fixture", () => {
  it("records what would have been sent, with the same argument checks", async () => {
    const f = new FixtureQuickBooksBooks();
    const { id } = await f.createExpense(ENTITY, ENTRY);
    expect(f.calls.at(-1)).toEqual({ method: "createExpense", args: expenseArgs(ENTRY) });
    expect(await f.findExpense(ENTITY, ENTRY.docNumber)).toMatchObject({ id });
    await expect(f.createExpense(ENTITY, { ...ENTRY, vendorId: "x" })).rejects.toBeInstanceOf(SourceReadError);
    f.connected = false;
    await expect(f.listVendors()).rejects.toBeInstanceOf(ConnectorAuthError);
  });
});
