// SPDX-License-Identifier: AGPL-3.0-only
// The QuickBooks sync in the browser (VITE_USE_MOCKS=true): a small chart of accounts, classes and
// vendors, and the server's rules for what the screens show (the sync is off until turned on; only
// payments recorded after that are posted, once each; nothing bank-shaped is kept). Nothing leaves
// the page. While the sync is on, a payment the Payments center records is posted at once, standing
// in for the jobs Worker.
import { ApiError } from "../api/client.ts";
import type { AccountingApi, AccountingEntry, AccountingItem, AccountingSync, AccountingVendors, QuickBooksRef } from "../api/accounting.ts";
import type { TrancheRow } from "../api/funderMoney.ts";

interface StoredLink {
  expense: QuickBooksRef | null;
  paidFrom: QuickBooksRef | null;
  tracking: "none" | "class" | "department";
  programs: Record<string, QuickBooksRef>;
  vendors: Record<string, QuickBooksRef>;
  vendorPolicy: "create" | "ask";
  syncEnabled: boolean;
  syncFrom: string | null;
  updatedAt: string | null;
  /** Payments already settled when the sync was turned on: never posted. */
  before: string[];
}

export interface AccountingStore {
  connected: Record<string, boolean>;
  links: Record<string, StoredLink>;
  /** By workspace, then tranche id. */
  entries: Record<string, Record<string, AccountingEntry>>;
  expenseAccounts: QuickBooksRef[];
  bankAccounts: QuickBooksRef[];
  classes: QuickBooksRef[];
  departments: QuickBooksRef[];
  qbVendors: QuickBooksRef[];
  seq: number;
}

export function seedAccountingStore(): AccountingStore {
  return {
    connected: {},
    links: {},
    entries: {},
    expenseAccounts: [
      { id: "61", name: "Grants and assistance" },
      { id: "62", name: "Program expenses" },
    ],
    bankAccounts: [{ id: "35", name: "Operating checking •••4410" }],
    classes: [
      { id: "5000000000000012345", name: "Community health" },
      { id: "5000000000000012346", name: "Youth programs" },
    ],
    departments: [{ id: "1", name: "Main office" }],
    qbVendors: [{ id: "56", name: "Alder Creek Family Services" }],
    seq: 240,
  };
}

export interface MockAccountingOptions {
  store: AccountingStore;
  workspace: () => string | null;
  tranches: () => Promise<TrancheRow[]>;
  programs: () => Promise<{ id: string; name: string }[]>;
  now?: () => Date;
}

const emptyLink = (): StoredLink => ({ expense: null, paidFrom: null, tracking: "none", programs: {}, vendors: {}, vendorPolicy: "create", syncEnabled: false, syncFrom: null, updatedAt: null, before: [] });
const fail = (status: number, message: string, code: string) => new ApiError(status, message, [{ code, message }]);
const key = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
const day = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : null);

export function createMockAccountingApi(opts: MockAccountingOptions): AccountingApi {
  const { store } = opts;
  const now = () => (opts.now ?? (() => new Date()))().toISOString();
  const ws = () => opts.workspace() ?? "";
  const link = () => (store.links[ws()] ??= emptyLink());
  const entries = () => (store.entries[ws()] ??= {});
  const connected = () => store.connected[ws()] === true;
  const needConnected = () => {
    if (!connected()) throw fail(409, "Connect QuickBooks first", "quickbooks_not_connected");
  };
  const paidOn = (t: TrancheRow) => day(t.external?.paidAt) ?? day(t.releasedAt) ?? day(now())!;

  /** Stands in for the jobs Worker: post what is due, and mark what changed. */
  async function run(): Promise<TrancheRow[]> {
    const rows = await opts.tranches();
    const l = link();
    const mine = entries();
    for (const t of rows) {
      const e = mine[t.id];
      if (e && (e.status === "posted" || e.status === "handled") && t.status !== "settled") Object.assign(e, { status: "needs_attention", reason: "voided", attention: { status: t.status }, attentionAt: now() });
      if (e || !l.syncEnabled || !connected() || t.status !== "settled" || l.before.includes(t.id) || !l.expense || !l.paidFrom) continue;
      const grantee = t.recipient?.workspaceId ?? null;
      let vendor = grantee ? l.vendors[grantee] : undefined;
      if (!vendor && t.recipient) {
        vendor = store.qbVendors.find((v) => key(v.name) === key(t.recipient!.name));
        if (!vendor && l.vendorPolicy === "create") store.qbVendors.push((vendor = { id: String(++store.seq), name: t.recipient.name }));
        if (vendor && grantee) l.vendors[grantee] = vendor;
      }
      const base = { id: `ent-${t.id}`, reference: `GMS-${t.id.replace(/[^0-9a-f]/g, "").slice(-16)}`, posted: { amountMinor: t.amountMinor, currency: t.currency, paidOn: paidOn(t), vendorName: vendor?.name ?? null }, attention: null, attentionAt: null, handledAt: null, attempts: 1 };
      mine[t.id] = vendor ? { ...base, status: "posted", reason: null, quickbooksId: String(++store.seq), postedAt: now() } : { ...base, status: "failed", reason: "vendor_unclear", quickbooksId: null, postedAt: null };
    }
    return rows;
  }

  async function sync(): Promise<AccountingSync> {
    await run();
    const l = link();
    const list = Object.values(entries());
    const count = (...s: string[]) => list.filter((e) => s.includes(e.status)).length;
    const programs = await opts.programs().catch(() => []);
    return {
      configured: true,
      connected: connected(),
      connection: connected() ? "active" : "not_connected",
      settings: { expense: l.expense, paidFrom: l.paidFrom, tracking: l.tracking, vendorPolicy: l.vendorPolicy, currency: "USD", syncEnabled: l.syncEnabled, syncFrom: l.syncFrom, locale: "en", updatedAt: l.updatedAt },
      programs: programs.map((p) => ({ programId: p.id, name: p.name, ref: l.programs[p.id] ?? null })),
      counts: { posted: count("posted", "handled"), needsAttention: count("needs_attention"), failed: count("failed"), posting: count("posting") },
    };
  }

  async function vendors(): Promise<AccountingVendors> {
    needConnected();
    const rows = await opts.tranches();
    const l = link();
    const grantees = new Map<string, string>();
    for (const t of rows) if (t.recipient) grantees.set(t.recipient.workspaceId, t.recipient.name);
    return {
      vendorPolicy: l.vendorPolicy,
      vendors: [...store.qbVendors],
      grantees: [...grantees.entries()]
        .sort((a, b) => a[1].localeCompare(b[1]))
        .map(([id, name]) => {
          const named = store.qbVendors.filter((v) => key(v.name) === key(name));
          return { granteeId: id, name, vendor: l.vendors[id] ?? null, suggestion: named.length === 1 ? named[0]! : null };
        }),
    };
  }

  const entryById = (id: string): AccountingEntry => {
    const e = Object.values(entries()).find((x) => x.id === id);
    if (!e) throw fail(404, "Entry not found", "not_found");
    return e;
  };

  return {
    sync,
    async connect() {
      store.connected[ws()] = true;
      return { connected: true, status: "active", connectUrl: null };
    },
    async disconnect() {
      store.connected[ws()] = false;
      link().syncEnabled = false;
      return { connected: false, status: "revoked", connectUrl: null };
    },
    async options() {
      needConnected();
      return { expenseAccounts: [...store.expenseAccounts], bankAccounts: [...store.bankAccounts], classes: [...store.classes], departments: [...store.departments] };
    },
    async saveSettings(input) {
      needConnected();
      const expense = store.expenseAccounts.find((a) => a.id === input.expenseId);
      const paidFrom = store.bankAccounts.find((a) => a.id === input.paidFromId);
      if (!expense || !paidFrom) throw fail(422, "That account is not in QuickBooks, or is not active", "unknown_account");
      const tracked = input.tracking === "class" ? store.classes : input.tracking === "department" ? store.departments : [];
      const programs: Record<string, QuickBooksRef> = {};
      for (const [id, ref] of Object.entries(input.programs ?? {})) {
        const found = tracked.find((c) => c.id === ref);
        if (found) programs[id] = found;
      }
      const l = link();
      const turnedOn = input.syncEnabled && !l.syncEnabled;
      if (turnedOn) l.before = (await opts.tranches()).filter((t) => t.status === "settled").map((t) => t.id);
      Object.assign(l, { expense, paidFrom, tracking: input.tracking, programs, vendorPolicy: input.vendorPolicy, syncEnabled: input.syncEnabled, updatedAt: now(), ...(turnedOn ? { syncFrom: now() } : {}) });
      return sync();
    },
    vendors,
    async saveVendors(input) {
      needConnected();
      const l = link();
      for (const v of input.vendors) {
        if (v.vendorId === null) delete l.vendors[v.granteeId];
        else {
          const found = store.qbVendors.find((x) => x.id === v.vendorId);
          if (!found) throw fail(422, "That vendor is not in QuickBooks, or is not active", "unknown_vendor");
          l.vendors[v.granteeId] = found;
        }
      }
      return vendors();
    },
    async entries(compare) {
      const rows = await run();
      const l = link();
      const mine = entries();
      const items: AccountingItem[] = rows
        .filter((t) => t.status === "settled" || t.status === "returned" || mine[t.id])
        .sort((a, b) => (b.releasedAt ?? "").localeCompare(a.releasedAt ?? ""))
        .map((t) => {
          const e = mine[t.id] ?? null;
          const status: AccountingItem["quickbooks"]["status"] = e ? e.status : "not_synced";
          return {
            payment: { trancheId: t.id, awardId: t.awardId, awardTitle: t.award?.title ?? null, grantee: t.recipient?.name ?? null, seq: t.seq, amountMinor: t.amountMinor, currency: t.currency, paidOn: paidOn(t), mode: t.mode ?? null, status: t.status },
            quickbooks: { status, entry: e ? { ...e } : null, ...(compare && e?.quickbooksId ? { inQuickBooks: "matches" as const } : {}) },
          };
        });
      return { syncEnabled: l.syncEnabled, syncFrom: l.syncFrom, items };
    },
    async handled(id) {
      const e = entryById(id);
      if (e.status !== "needs_attention") throw fail(409, "Only an entry that needs attention can be marked as handled", "invalid_transition");
      Object.assign(e, { status: "handled", reason: null, handledAt: now() });
      return { ...e };
    },
    async retry(id) {
      const e = entryById(id);
      if (e.status !== "failed") throw fail(409, "Only an entry that is not in QuickBooks can be tried again", "invalid_transition");
      const tranche = Object.entries(entries()).find(([, x]) => x === e)?.[0];
      if (tranche) delete entries()[tranche];
      await run();
      return { ...(tranche ? (entries()[tranche] ?? e) : e) };
    },
  };
}
