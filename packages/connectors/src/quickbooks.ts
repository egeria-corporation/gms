// SPDX-License-Identifier: AGPL-3.0-only
// QuickBooks Online through Composio (v1.13.0, docs/accounting.md). Record-keeping, not a money path:
// the GMS writes one expense per grant payment that was already made (paid elsewhere, or disbursed
// through Passport), so the funder's books show it without retyping. Nothing here pays, schedules or
// moves money, and no bank details are read, stored or sent.
//
// One Composio auth config (`COMPOSIO_QUICKBOOKS_AUTH_CONFIG_ID`, toolkit `quickbooks`) with the
// accounting scope only (`com.intuit.quickbooks.accounting`); Intuit's Payments and Payroll scopes are
// refused and such a connection is deleted at Composio (APP_SCOPE_RULES in ./apps.ts). The Composio
// entity is the funder workspace id; Composio holds the Intuit token and the company (realm) id.
//
// The entry is an expense: QuickBooks' Purchase with PaymentType "Cash", which is what QuickBooks'
// own Expense form writes for a payment from a bank account. Not a bill payment, which needs a
// bill to pay first (two entries, and an open Accounts Payable bill in between that QuickBooks' bill
// pay could pay a second time); not a check, which QuickBooks can queue for printing. A Purchase
// names a vendor, the expense account it posts to, the bank account in the chart of accounts the
// money left from (a QuickBooks id, never a bank's own number), an optional class or department,
// the date, the amount and a memo.
//
// Only the tools in QUICKBOOKS_TOOLS run, with the arguments written below. Every QuickBooks record
// read here is cut down where it is parsed to an id, a name and a type: an account's own number,
// balances, a vendor's tax and bank fields, addresses and contacts are dropped before anything else
// sees them, and none is ever logged or stored. Slugs and arguments were checked with Composio's
// tool search and schemas on 2026-11-17; nothing here has run against Composio or QuickBooks.
import { ComposioApp, type Connection } from "./apps.ts";
import { ComposioClient } from "./composio.ts";
import { ConnectorAuthError, ConnectorUnavailableError } from "./index.ts";
import { dig, SourceReadError } from "./tabular.ts";

/** The tools QuickBooks may execute. Nothing else is ever sent to Composio's tool endpoint for it. */
export const QUICKBOOKS_TOOLS = {
  queryAccounts: "QUICKBOOKS_QUERY_ACCOUNTS",
  queryVendors: "QUICKBOOKS_QUERY_VENDORS",
  createVendor: "QUICKBOOKS_CREATE_VENDOR",
  /** Only two queries: active classes, and one expense by the GMS's own reference (DocNumber). */
  queryEntities: "QUICKBOOKS_QUERY_ENTITIES",
  listDepartments: "QUICKBOOKS_LIST_DEPARTMENTS",
  createExpense: "QUICKBOOKS_CREATE_PURCHASE",
  getExpense: "QUICKBOOKS_GET_PURCHASE",
} as const;
export type QuickBooksTool = (typeof QUICKBOOKS_TOOLS)[keyof typeof QUICKBOOKS_TOOLS];

/** QuickBooks' Expense form for a bank account. Never "Check" (QuickBooks can queue a check to print). */
export const EXPENSE_PAYMENT_TYPE = "Cash";
/** The chart-of-accounts types each choice lists. A grant is paid from a bank account and posts to an expense. */
export const ACCOUNT_TYPES = { expense: ["Expense", "Other Expense"], bank: ["Bank"] } as const;
/** Currencies without minor units, which the GMS does not post (its amounts are in hundredths). */
const ZERO_DECIMAL = new Set(["JPY", "KRW", "VND", "CLP", "ISK", "UGX", "XAF", "XOF", "PYG"]);

export interface QuickBooksRef {
  /** QuickBooks' own id for the record (digits). */
  id: string;
  name: string;
}
export interface QuickBooksVendor extends QuickBooksRef {
  active: boolean;
}

/** One expense as the GMS writes it. Ids are QuickBooks records chosen by the funder; no bank's number. */
export interface ExpenseEntry {
  /** The bank account in QuickBooks' chart of accounts the payment left from. */
  paidFromId: string;
  /** The expense account grants post to. */
  expenseId: string;
  vendorId: string;
  /** In hundredths of `currency`. */
  amountMinor: number;
  currency: string;
  /** YYYY-MM-DD */
  date: string;
  /** Award and program, in the funder's words. */
  memo: string;
  /** The GMS's reference for the payment, so a retry finds the entry instead of writing a second one. */
  docNumber: string;
  classId?: string | null;
  departmentId?: string | null;
}

/** An expense as read back: what the reconciliation view compares. */
export interface ExpenseSeen {
  id: string;
  amountMinor: number | null;
  date: string | null;
  docNumber: string | null;
}

export interface QuickBooksBooks extends Connection {
  readonly provider: "quickbooks";
  /** Active accounts of the chart of accounts: expense accounts, or bank accounts. Id, name and nothing else. */
  listAccounts(entityId: string, kind: keyof typeof ACCOUNT_TYPES): Promise<QuickBooksRef[]>;
  listVendors(entityId: string): Promise<QuickBooksVendor[]>;
  /** Vendors whose display name is exactly `name` (case and spacing aside). */
  findVendors(entityId: string, name: string): Promise<QuickBooksVendor[]>;
  /** A vendor with the organization's name and nothing else: no address, contact, tax or bank field. */
  createVendor(entityId: string, name: string): Promise<QuickBooksVendor>;
  listClasses(entityId: string): Promise<QuickBooksRef[]>;
  listDepartments(entityId: string): Promise<QuickBooksRef[]>;
  /** The expense the GMS wrote under this reference, if there is one. */
  findExpense(entityId: string, docNumber: string): Promise<ExpenseSeen | null>;
  createExpense(entityId: string, entry: ExpenseEntry): Promise<{ id: string }>;
  /** Read one expense; null when QuickBooks does not return it (deleted there, or not readable). */
  getExpense(entityId: string, id: string): Promise<ExpenseSeen | null>;
}

// ------------------------------------------------------------------------------------- parsing

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

export const QUICKBOOKS_ID = /^\d{1,20}$/;
export const DOC_NUMBER = /^[A-Za-z0-9-]{1,21}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const PAGES = 5;
const PAGE_SIZE = 1000;

/**
 * A QuickBooks name as the GMS shows and keeps it: one line, at most 100 characters, and no long run
 * of digits. A funder may have named a bank account after its number; five digits or more become
 * "•••" and the last four, so a full number never reaches the GMS's pages or tables.
 */
export function quickBooksName(value: unknown, fallback = "Untitled"): string {
  const flat = [...(typeof value === "string" ? value : "")]
    .map((ch) => (ch.charCodeAt(0) < 0x20 || ch.charCodeAt(0) === 0x7f ? " " : ch))
    .join("")
    .replace(/\d{5,}/g, (run) => `•••${run.slice(-4)}`)
    .replace(/\s+/g, " ")
    .trim();
  return (flat.length > 100 ? flat.slice(0, 100).trim() : flat) || fallback;
}

/** An organization's name as a QuickBooks vendor: QuickBooks refuses a colon, a tab or a new line in a name. */
export function vendorNameOf(name: string): string {
  return quickBooksName(name.replace(/[:\t\r\n]/g, " "), "Grantee");
}

/** A string literal in QuickBooks' query language. */
export function qbLiteral(value: string): string {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

/** The records of one entity from a query answer (`QueryResponse.<Entity>`), however Composio wraps it. */
export function queryRows(data: unknown, entity: string): Record<string, unknown>[] {
  return arr(rec(dig(data, "QueryResponse"))[entity]).map(rec);
}

/** Id and name only. Every other field of the record (an account's own number, balances) is dropped here. */
export function refOf(r: Record<string, unknown>): QuickBooksRef | null {
  const id = str(r.Id);
  if (!id || !QUICKBOOKS_ID.test(id)) return null;
  return { id, name: quickBooksName(r.FullyQualifiedName ?? r.Name ?? r.DisplayName) };
}

/** Id, display name and whether it is active. A vendor's tax, bank, address and contact fields are dropped here. */
export function vendorOf(r: Record<string, unknown>): QuickBooksVendor | null {
  const id = str(r.Id);
  if (!id || !QUICKBOOKS_ID.test(id)) return null;
  return { id, name: quickBooksName(r.DisplayName ?? r.CompanyName), active: r.Active !== false };
}

const same = (a: string, b: string) => a.trim().replace(/\s+/g, " ").toLowerCase() === b.trim().replace(/\s+/g, " ").toLowerCase();

/** A Purchase as read back (`data` itself, or `data.Purchase`). */
export function expenseOf(data: unknown): ExpenseSeen | null {
  const d = rec(data);
  const p = str(d.Id) ? d : rec(d.Purchase ?? rec(d.response_data).Purchase ?? d.response_data);
  const id = str(p.Id);
  if (!id || !QUICKBOOKS_ID.test(id)) return null;
  const total = typeof p.TotalAmt === "number" ? Math.round(p.TotalAmt * 100) : null;
  const date = str(p.TxnDate);
  const doc = str(p.DocNumber);
  return { id, amountMinor: total, date: date && DATE.test(date) ? date : null, docNumber: doc };
}

/** One line of text for a memo: no control characters, at most 1,000 characters. */
const memoText = (s: string) =>
  [...s]
    .map((ch) => (ch.charCodeAt(0) < 0x20 || ch.charCodeAt(0) === 0x7f ? " " : ch))
    .join("")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1000);

/** The exact arguments of QUICKBOOKS_CREATE_PURCHASE for one grant payment. Nothing else is ever sent. */
export function expenseArgs(e: ExpenseEntry): Record<string, unknown> {
  for (const id of [e.paidFromId, e.expenseId, e.vendorId]) if (!QUICKBOOKS_ID.test(id)) throw new SourceReadError("That is not a QuickBooks record");
  if (e.classId != null && !QUICKBOOKS_ID.test(e.classId)) throw new SourceReadError("That is not a QuickBooks class");
  if (e.departmentId != null && !QUICKBOOKS_ID.test(e.departmentId)) throw new SourceReadError("That is not a QuickBooks location");
  if (!DATE.test(e.date)) throw new SourceReadError("That is not a date");
  if (!DOC_NUMBER.test(e.docNumber)) throw new SourceReadError("That is not a reference QuickBooks takes");
  if (!Number.isSafeInteger(e.amountMinor) || e.amountMinor <= 0) throw new SourceReadError("The amount must be more than zero");
  if (!/^[A-Z]{3}$/.test(e.currency) || ZERO_DECIMAL.has(e.currency)) throw new SourceReadError("The GMS posts amounts in currencies with cents only");
  const amount = Number((e.amountMinor / 100).toFixed(2));
  const memo = memoText(e.memo);
  return {
    PaymentType: EXPENSE_PAYMENT_TYPE,
    AccountRef: { value: e.paidFromId },
    EntityRef: { value: e.vendorId },
    TxnDate: e.date,
    TotalAmt: amount,
    DocNumber: e.docNumber,
    PrivateNote: memo,
    ...(e.departmentId ? { DepartmentRef: { value: e.departmentId } } : {}),
    Line: [
      {
        Amount: amount,
        DetailType: "AccountBasedExpenseLineDetail",
        Description: memo,
        AccountBasedExpenseLineDetail: { AccountRef: { value: e.expenseId }, ...(e.classId ? { ClassRef: { value: e.classId } } : {}) },
      },
    ],
  };
}

// ----------------------------------------------------------------------------------- connector

const FAILED_READ = "QuickBooks did not answer. Try again in a few minutes";

export class ComposioQuickBooksBooks extends ComposioApp implements QuickBooksBooks {
  readonly provider = "quickbooks" as const;

  /** Every page of one query (QuickBooks answers at most 1,000 rows a page), up to 5,000 rows. */
  private async pages(entityId: string, slug: QuickBooksTool, base: string, entity: string): Promise<Record<string, unknown>[]> {
    const out: Record<string, unknown>[] = [];
    for (let page = 0; page < PAGES; page++) {
      const rows = queryRows(await this.run(entityId, slug, { query: `${base} STARTPOSITION ${page * PAGE_SIZE + 1} MAXRESULTS ${PAGE_SIZE}` }, FAILED_READ), entity);
      out.push(...rows);
      if (rows.length < PAGE_SIZE) break;
    }
    return out;
  }

  private async refs(entityId: string, slug: QuickBooksTool, base: string, entity: string): Promise<QuickBooksRef[]> {
    return (await this.pages(entityId, slug, base, entity))
      .flatMap((r) => {
        const ref = refOf(r);
        return ref ? [ref] : [];
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async listAccounts(entityId: string, kind: keyof typeof ACCOUNT_TYPES): Promise<QuickBooksRef[]> {
    const types = ACCOUNT_TYPES[kind].map(qbLiteral).join(", ");
    return this.refs(entityId, QUICKBOOKS_TOOLS.queryAccounts, `SELECT * FROM Account WHERE Active = true AND AccountType IN (${types})`, "Account");
  }

  async listVendors(entityId: string): Promise<QuickBooksVendor[]> {
    return (await this.pages(entityId, QUICKBOOKS_TOOLS.queryVendors, "SELECT * FROM Vendor WHERE Active = true", "Vendor"))
      .flatMap((r) => {
        const v = vendorOf(r);
        return v ? [v] : [];
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async findVendors(entityId: string, name: string): Promise<QuickBooksVendor[]> {
    const wanted = vendorNameOf(name);
    const data = await this.run(entityId, QUICKBOOKS_TOOLS.queryVendors, { query: `SELECT * FROM Vendor WHERE DisplayName = ${qbLiteral(wanted)} MAXRESULTS 10` }, FAILED_READ);
    return queryRows(data, "Vendor").flatMap((r) => {
      const v = vendorOf(r);
      return v && same(v.name, wanted) ? [v] : [];
    });
  }

  async createVendor(entityId: string, name: string): Promise<QuickBooksVendor> {
    const display = vendorNameOf(name);
    // The organization's name, twice (as QuickBooks shows it and as the company), and nothing else.
    const data = await this.run(entityId, QUICKBOOKS_TOOLS.createVendor, { display_name: display, company_name: display }, "QuickBooks did not create the vendor. A customer, employee or vendor may already have this name: choose the vendor in Settings › Accounting");
    const v = vendorOf(rec(dig(data, "Vendor") ?? data));
    if (!v) throw new ConnectorUnavailableError("quickbooks", "QuickBooks did not return the new vendor");
    return v;
  }

  async listClasses(entityId: string): Promise<QuickBooksRef[]> {
    return this.refs(entityId, QUICKBOOKS_TOOLS.queryEntities, "SELECT * FROM Class WHERE Active = true", "Class");
  }

  async listDepartments(entityId: string): Promise<QuickBooksRef[]> {
    return this.refs(entityId, QUICKBOOKS_TOOLS.listDepartments, "SELECT * FROM Department WHERE Active = true", "Department");
  }

  async findExpense(entityId: string, docNumber: string): Promise<ExpenseSeen | null> {
    if (!DOC_NUMBER.test(docNumber)) throw new SourceReadError("That is not a reference QuickBooks takes");
    const data = await this.run(entityId, QUICKBOOKS_TOOLS.queryEntities, { query: `SELECT * FROM Purchase WHERE DocNumber = ${qbLiteral(docNumber)} MAXRESULTS 5` }, FAILED_READ);
    for (const r of queryRows(data, "Purchase")) {
      const seen = expenseOf(r);
      if (seen && seen.docNumber === docNumber) return seen;
    }
    return null;
  }

  async createExpense(entityId: string, entry: ExpenseEntry): Promise<{ id: string }> {
    const args = expenseArgs(entry);
    const data = await this.run(entityId, QUICKBOOKS_TOOLS.createExpense, args, "QuickBooks did not take the entry. Check the accounts, vendor and class chosen in Settings › Accounting");
    const seen = expenseOf(data);
    if (!seen) throw new ConnectorUnavailableError("quickbooks", "QuickBooks did not return the new entry");
    return { id: seen.id };
  }

  async getExpense(entityId: string, id: string): Promise<ExpenseSeen | null> {
    if (!QUICKBOOKS_ID.test(id)) return null;
    return this.wrap(async () => {
      const account = await this.active(entityId);
      if (!account) throw new ConnectorAuthError("composio");
      const r = await this.cfg.client.executeTool(QUICKBOOKS_TOOLS.getExpense, { connectedAccountId: account.id, userId: entityId, arguments: { purchase_id: id } });
      return r.successful ? expenseOf(r.data) : null;
    });
  }
}

// ------------------------------------------------------------------------------------- fixture

/** Stands in for QuickBooks in tests, local runs and the e2e flows: a small chart of accounts, vendors and classes. */
export class FixtureQuickBooksBooks implements QuickBooksBooks {
  readonly provider = "quickbooks" as const;
  connected = true;
  /** Every call, by method, with its arguments: tests read what would have been sent. */
  readonly calls: { method: string; args: unknown }[] = [];
  readonly expenses = new Map<string, ExpenseEntry & { id: string }>();
  /** Vendor names QuickBooks refuses to create (a customer has the name). */
  refuseVendor = new Set<string>();
  /** When set, the next createExpense fails like QuickBooks refusing it. */
  refuseNextExpense = false;
  private seq = 100;
  constructor(
    public accounts: { expense: QuickBooksRef[]; bank: QuickBooksRef[] } = {
      expense: [
        { id: "61", name: "Grants and assistance" },
        { id: "62", name: "Program expenses" },
      ],
      bank: [{ id: "35", name: "Operating checking" }],
    },
    public vendors: QuickBooksVendor[] = [{ id: "56", name: "Alder Creek Family Services", active: true }],
    public classes: QuickBooksRef[] = [
      { id: "5000000000000012345", name: "Community health" },
      { id: "5000000000000012346", name: "Youth programs" },
    ],
    public departments: QuickBooksRef[] = [{ id: "1", name: "Main office" }],
  ) {}
  private live(method: string, args: unknown) {
    this.calls.push({ method, args });
    if (!this.connected) throw new ConnectorAuthError("composio");
  }
  async status(entityId: string, opts: { link?: boolean } = {}) {
    if (this.connected) return { connected: true, connectUrl: null };
    return { connected: false, connectUrl: opts.link ? `https://composio.invalid/connect/quickbooks?entity=${encodeURIComponent(entityId)}` : null };
  }
  async disconnect() {
    this.connected = false;
  }
  async listAccounts(_entityId: string, kind: keyof typeof ACCOUNT_TYPES) {
    this.live("listAccounts", { kind });
    return [...this.accounts[kind]];
  }
  async listVendors() {
    this.live("listVendors", {});
    return this.vendors.filter((v) => v.active);
  }
  async findVendors(_entityId: string, name: string) {
    this.live("findVendors", { name });
    return this.vendors.filter((v) => same(v.name, vendorNameOf(name)));
  }
  async createVendor(_entityId: string, name: string) {
    this.live("createVendor", { display_name: vendorNameOf(name), company_name: vendorNameOf(name) });
    if (this.refuseVendor.has(name)) throw new SourceReadError("QuickBooks did not create the vendor. A customer, employee or vendor may already have this name: choose the vendor in Settings › Accounting");
    const v = { id: String(++this.seq), name: vendorNameOf(name), active: true };
    this.vendors.push(v);
    return v;
  }
  async listClasses() {
    this.live("listClasses", {});
    return [...this.classes];
  }
  async listDepartments() {
    this.live("listDepartments", {});
    return [...this.departments];
  }
  async findExpense(_entityId: string, docNumber: string) {
    this.live("findExpense", { docNumber });
    const e = [...this.expenses.values()].find((x) => x.docNumber === docNumber);
    return e ? { id: e.id, amountMinor: e.amountMinor, date: e.date, docNumber: e.docNumber } : null;
  }
  async createExpense(_entityId: string, entry: ExpenseEntry) {
    const args = expenseArgs(entry);
    this.live("createExpense", args);
    if (this.refuseNextExpense) {
      this.refuseNextExpense = false;
      throw new SourceReadError("QuickBooks did not take the entry. Check the accounts, vendor and class chosen in Settings › Accounting");
    }
    const id = String(++this.seq);
    this.expenses.set(id, { ...entry, id });
    return { id };
  }
  async getExpense(_entityId: string, id: string) {
    this.live("getExpense", { id });
    const e = this.expenses.get(id);
    return e ? { id, amountMinor: e.amountMinor, date: e.date, docNumber: e.docNumber } : null;
  }
}

// ------------------------------------------------------------------------------------- wiring

/** The Worker settings QuickBooks reads (names only; values are Wrangler secrets). */
export interface QuickBooksEnv {
  COMPOSIO_API_KEY?: string;
  COMPOSIO_QUICKBOOKS_AUTH_CONFIG_ID?: string;
}

/**
 * QuickBooks for a Worker, only when the Composio key and its own auth config are set: otherwise it
 * is absent, and Settings › Accounting is hidden. `callback` builds the page Composio returns to.
 */
export function quickBooksPort(env: QuickBooksEnv, callback: (returnTo: string | undefined, provider: "quickbooks") => string): { quickbooks?: QuickBooksBooks } {
  if (!env.COMPOSIO_API_KEY || !env.COMPOSIO_QUICKBOOKS_AUTH_CONFIG_ID) return {};
  const client = new ComposioClient({ apiKey: env.COMPOSIO_API_KEY });
  return { quickbooks: new ComposioQuickBooksBooks({ client, authConfigId: env.COMPOSIO_QUICKBOOKS_AUTH_CONFIG_ID, callbackUrl: (_entityId, returnTo) => callback(returnTo, "quickbooks") }) };
}
