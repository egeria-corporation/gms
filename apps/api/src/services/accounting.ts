// SPDX-License-Identifier: AGPL-3.0-only
// QuickBooks Online sync (v1.13.0, docs/accounting.md): grant payments written to the funder's books
// so nobody retypes them. Record-keeping, not a money path. Nothing here pays, schedules or moves
// money, reads or sends a bank's number, sets a payout destination or touches an award's disbursed
// amount: it reads payments the GMS has already recorded and writes one expense for each.
//
//   * Connecting QuickBooks is `/gms/connectors/quickbooks` (services/integrations.ts), a workspace
//     admin, signed in. The mapping and the switch are here: finance staff or admins, in person.
//   * The mapping, set once: the expense account grants post to, the bank account in QuickBooks'
//     chart of accounts they are paid from, a class or a location per program (if the funder uses
//     them), a vendor per grantee (matched by the organization's name, or created with that name
//     only), and the company's currency.
//   * Sync is off until a person turns it on. From then, the jobs Worker writes one expense for each
//     payment recorded in the GMS (paid elsewhere, or disbursed through Passport and mirrored),
//     once: the entry is claimed in accounting_entries (unique per payment) before QuickBooks is
//     called, and carries the GMS's own reference, so a retry after a crash finds it there.
//   * Edits and voids in the GMS after an entry was posted mark it "needs attention". The GMS never
//     changes or deletes anything in the books; a person fixes QuickBooks and says so here.
//   * Agents read the setting and the reconciliation view (REST with payments:read, and the MCP
//     tool get_accounting_sync); every write here refuses agent and API-client tokens.
import { DEFAULT_LOCALE, isLocale, type Locale } from "@gms/i18n";
import { ConnectorAuthError, ConnectorScopeError, ConnectorScopeUnverifiedError, ConnectorUnavailableError, quickBooksName, SourceReadError, type QuickBooksBooks, type QuickBooksRef } from "@gms/connectors";
import { z } from "zod";
import { ApiError, notFound } from "../lib/errors.ts";
import { parse } from "../lib/input.ts";
import { apiId, bareUuid } from "../lib/ids.ts";
import { audit, authorize, systemContext, type BaseContext, type ServiceContext, type ServiceWorkspace } from "./context.ts";
import { humanOnly } from "./integrations.ts";
import { namesShared, sharingWith } from "./profile.ts";
import { RepoError, type Row } from "./repos/types.ts";

export const ACCOUNTING_PROVIDER = "quickbooks" as const;
/** Who sets up and reads the sync: a funder's admins and finance staff (and their agents, reading). */
export const ACCOUNTING_ROLES = ["admin", "finance"] as const;
/** Entries written per workspace per run; the next run (fifteen minutes on) picks up the rest. */
export const ENTRIES_PER_RUN = 20;
/** A payment QuickBooks refused, or could not be reached for, is tried this many times in all, then waits for a person. */
export const MAX_ATTEMPTS = 3;
/** An entry still "posting" after this long was interrupted: the next run looks it up by its reference first. */
export const STUCK_POSTING_MS = 15 * 60_000;
/** Payments the reconciliation view lists, newest first; and how many it compares with QuickBooks at a time. */
export const VIEW_LIMIT = 200;
export const COMPARE_LIMIT = 25;
/** Programs and grantees a mapping can name. */
const MAP_LIMIT = 500;
/** The ledger events that record a payment in the GMS: Passport settled it, or a person recorded it as paid elsewhere. */
const RECORDED = ["tranche.settle", "tranche.record_external"] as const;

type Link = Row<"accounting_links">;
type Entry = Row<"accounting_entries">;
type Tranche = Row<"tranches">;
type Award = Row<"awards">;
type RefMap = Record<string, QuickBooksRef>;

export type EntryStatus = "posting" | "posted" | "needs_attention" | "failed" | "handled";
export type EntryReason = "changed" | "voided" | "removed" | "vendor_unclear" | "vendor_refused" | "currency" | "refused" | "unreachable";

const reader = (ctx: ServiceContext): Promise<ServiceWorkspace> => authorize(ctx, { scope: "payments:read", kind: "funder", roles: ACCOUNTING_ROLES });
/** A person in the GMS, never an agent or API client: this decides what is written to the funder's books. */
async function writer(ctx: ServiceContext): Promise<ServiceWorkspace> {
  const ws = await authorize(ctx, { scope: "payments:release", kind: "funder", roles: ACCOUNTING_ROLES, person: true });
  humanOnly(ctx);
  return ws;
}

const port = (ctx: Pick<ServiceContext, "ports">): QuickBooksBooks | undefined => ctx.ports.quickbooks;
function needPort(ctx: Pick<ServiceContext, "ports">): QuickBooksBooks {
  const p = port(ctx);
  if (!p) throw new ApiError(503, "connector_not_configured", "QuickBooks through Composio is not configured on this server");
  return p;
}

/** What a failed Composio or QuickBooks call means for the person on the Accounting screen. */
function booksError(e: unknown): never {
  if (e instanceof ConnectorScopeError) throw new ApiError(422, "connector_scope_rejected", e.message);
  if (e instanceof ConnectorScopeUnverifiedError) throw new ApiError(422, "connector_scope_unverified", e.message);
  if (e instanceof ConnectorAuthError) throw new ApiError(409, "quickbooks_not_connected", "Connect QuickBooks first");
  if (e instanceof ConnectorUnavailableError) throw new ApiError(503, "connector_unavailable", "QuickBooks could not be reached. Nothing was changed");
  if (e instanceof SourceReadError) throw new ApiError(422, "quickbooks_refused", e.message);
  throw e;
}

const refMap = (v: unknown): RefMap => (v && typeof v === "object" && !Array.isArray(v) ? (v as RefMap) : {});
const refOf = (id: string | null, name: string | null): QuickBooksRef | null => (id && name ? { id, name } : null);
const linkOf = (ctx: Pick<ServiceContext, "repos">, wsId: string) => ctx.repos.table("accounting_links").one({ workspace_id: wsId, provider: ACCOUNTING_PROVIDER });

// ------------------------------------------------------------------------------------ the setting

/** The sync setting of this workspace, its programs with their class or location, and how many entries are in each state. */
export async function getAccounting(ctx: ServiceContext) {
  const ws = await reader(ctx);
  const p = port(ctx);
  const [link, row, programs] = await Promise.all([linkOf(ctx, ws.id), ctx.repos.table("connector_accounts").one({ workspace_id: ws.id, provider: ACCOUNTING_PROVIDER }), ctx.repos.table("programs").find({ workspace_id: ws.id }, { orderBy: "name", limit: MAP_LIMIT })]);
  // A read never starts a connection; an unreachable Composio reads as not connected.
  const connected = p ? (await p.status(ws.id).catch(() => ({ connected: false }))).connected : false;
  const entries = link ? await ctx.repos.table("accounting_entries").find({ workspace_id: ws.id, provider: ACCOUNTING_PROVIDER }, { limit: 5000 }) : [];
  const count = (s: EntryStatus) => entries.filter((e) => e.status === s).length;
  const programMap = refMap(link?.program_map);
  return {
    configured: !!p,
    connected,
    connection: row?.status ?? "not_connected",
    settings: {
      expense: refOf(link?.expense_ref ?? null, link?.expense_name ?? null),
      paidFrom: refOf(link?.paid_from_ref ?? null, link?.paid_from_name ?? null),
      tracking: (link?.tracking ?? "none") as "none" | "class" | "department",
      vendorPolicy: (link?.vendor_policy ?? "create") as "create" | "ask",
      currency: link?.currency ?? "USD",
      syncEnabled: link?.sync_enabled ?? false,
      syncFrom: link?.sync_from ?? null,
      locale: (link?.locale ?? "en") as Locale,
      updatedAt: link?.updated_at ?? null,
    },
    programs: programs.map((pr) => ({ programId: pr.id, name: pr.name, ref: programMap[pr.id] ?? null })),
    counts: { posted: count("posted") + count("handled"), needsAttention: count("needs_attention"), failed: count("failed"), posting: count("posting") },
  };
}

/** What the funder can choose from in QuickBooks: expense and bank accounts, classes, locations. Read live, ids and names only. */
export async function getAccountingOptions(ctx: ServiceContext) {
  const ws = await reader(ctx);
  const p = needPort(ctx);
  try {
    const [expenseAccounts, bankAccounts, classes, departments] = await Promise.all([p.listAccounts(ws.id, "expense"), p.listAccounts(ws.id, "bank"), p.listClasses(ws.id), p.listDepartments(ws.id)]);
    return { expenseAccounts, bankAccounts, classes, departments };
  } catch (e) {
    booksError(e);
  }
}

const refId = z.string().regex(/^\d{1,20}$/, "Choose a QuickBooks record");
export const accountingSettingsInput = z
  .object({
    expenseId: refId,
    paidFromId: refId,
    tracking: z.enum(["none", "class", "department"]),
    /** Program id → class or location id (null: none for that program). */
    programs: z.record(z.string(), refId.nullable()).optional(),
    vendorPolicy: z.enum(["create", "ask"]),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/, "A three-letter currency code")
      .optional(),
    syncEnabled: z.boolean(),
  })
  .strict();

/**
 * Save the mapping, and turn the sync on or off. A person only. Every QuickBooks record named must be
 * one QuickBooks lists for this connection now; its name is taken from there. Turning the sync on
 * starts from this moment: payments recorded before it are never posted.
 */
export async function putAccountingSettings(ctx: ServiceContext, body: unknown) {
  const ws = await writer(ctx);
  // Who may do this is settled before the body is read: a caller who may not gets 403, never 400.
  const input = parse(accountingSettingsInput, body);
  const p = needPort(ctx);
  const programIds = new Set((await ctx.repos.table("programs").find({ workspace_id: ws.id }, { limit: 5000 })).map((x) => x.id));
  const wanted = Object.entries(input.programs ?? {});
  if (wanted.length > MAP_LIMIT) throw new ApiError(422, "too_many", `At most ${MAP_LIMIT} programs`);
  for (const [id] of wanted) if (!programIds.has(id.toLowerCase())) throw new ApiError(422, "unknown_program", "A program named is not one of this workspace's");
  let lists: { expense: QuickBooksRef[]; bank: QuickBooksRef[]; tracked: QuickBooksRef[] };
  try {
    const [expense, bank, tracked] = await Promise.all([p.listAccounts(ws.id, "expense"), p.listAccounts(ws.id, "bank"), input.tracking === "class" ? p.listClasses(ws.id) : input.tracking === "department" ? p.listDepartments(ws.id) : Promise.resolve([])]);
    lists = { expense, bank, tracked };
  } catch (e) {
    booksError(e);
  }
  const expense = lists.expense.find((a) => a.id === input.expenseId);
  if (!expense) throw new ApiError(422, "unknown_account", "That expense account is not in QuickBooks, or is not active");
  const paidFrom = lists.bank.find((a) => a.id === input.paidFromId);
  if (!paidFrom) throw new ApiError(422, "unknown_account", "That bank account is not in QuickBooks, or is not active");
  const programMap: RefMap = {};
  if (input.tracking !== "none") {
    for (const [id, ref] of wanted) {
      if (ref === null) continue;
      const found = lists.tracked.find((c) => c.id === ref);
      if (!found) throw new ApiError(422, "unknown_class", input.tracking === "class" ? "That class is not in QuickBooks, or is not active" : "That location is not in QuickBooks, or is not active");
      programMap[id.toLowerCase()] = { id: found.id, name: quickBooksName(found.name) };
    }
  }
  const existing = await linkOf(ctx, ws.id);
  const turnedOn = input.syncEnabled && !existing?.sync_enabled;
  if (turnedOn && !(await p.status(ws.id).catch(() => ({ connected: false }))).connected) throw new ApiError(409, "quickbooks_not_connected", "Connect QuickBooks before turning the sync on");
  const now = ctx.now().toISOString();
  const locale: Locale = isLocale(ctx.locale) ? ctx.locale : DEFAULT_LOCALE;
  const patch = {
    expense_ref: expense.id,
    expense_name: quickBooksName(expense.name),
    paid_from_ref: paidFrom.id,
    paid_from_name: quickBooksName(paidFrom.name),
    tracking: input.tracking,
    program_map: programMap as unknown as Link["program_map"],
    vendor_policy: input.vendorPolicy,
    ...(input.currency ? { currency: input.currency } : {}),
    sync_enabled: input.syncEnabled,
    ...(turnedOn ? { sync_from: now, locale } : {}),
    updated_by: ctx.actor.userId,
  };
  const row = existing ? (await ctx.repos.table("accounting_links").update({ id: existing.id }, patch))[0]! : await ctx.repos.table("accounting_links").insert({ workspace_id: ws.id, provider: ACCOUNTING_PROVIDER, ...patch, ...(input.syncEnabled ? { sync_from: now, locale } : {}) });
  await audit(ctx, "accounting.settings_changed", "workspace", ws.id, { provider: ACCOUNTING_PROVIDER, syncEnabled: row.sync_enabled, tracking: row.tracking, vendorPolicy: row.vendor_policy, programs: Object.keys(programMap).length });
  return getAccounting(ctx);
}

// ------------------------------------------------------------------------------------ vendors

/** The organizations this workspace has paid or will pay, with the funder's name for each (Passport's while the record is shared). */
async function grantees(ctx: Pick<ServiceContext, "repos">, wsId: string): Promise<{ id: string; name: string }[]> {
  const awards = await ctx.repos.table("awards").find({ workspace_id: wsId }, { limit: 5000 });
  const ids = [...new Set(awards.map((a) => a.recipient_workspace_id).filter((x): x is string => !!x))].slice(0, MAP_LIMIT);
  if (!ids.length) return [];
  const [rows, shared] = await Promise.all([ctx.repos.table("workspaces").find({ id: ids }), sharingWith(ctx, wsId, ids)]);
  return rows.map((r) => ({ id: r.id, name: namesShared(r, shared.has(r.id)).name })).sort((a, b) => a.name.localeCompare(b.name));
}

/** Each grantee with its vendor: the one chosen, else QuickBooks' vendor of exactly that name (a suggestion). */
export async function getAccountingVendors(ctx: ServiceContext) {
  const ws = await reader(ctx);
  const p = needPort(ctx);
  const [link, list] = await Promise.all([linkOf(ctx, ws.id), grantees(ctx, ws.id)]);
  const vendors = await p.listVendors(ws.id).catch(booksError);
  const map = refMap(link?.vendor_map);
  const key = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
  return {
    vendorPolicy: (link?.vendor_policy ?? "create") as "create" | "ask",
    vendors: vendors.slice(0, 5000).map((v) => ({ id: v.id, name: v.name })),
    grantees: list.map((g) => {
      const named = vendors.filter((v) => key(v.name) === key(quickBooksName(g.name)));
      return { granteeId: g.id, name: g.name, vendor: map[g.id] ?? null, suggestion: named.length === 1 ? { id: named[0]!.id, name: named[0]!.name } : null };
    }),
  };
}

export const accountingVendorsInput = z
  .object({ vendors: z.array(z.object({ granteeId: z.string(), vendorId: refId.nullable() }).strict()).min(1).max(MAP_LIMIT) })
  .strict();

/** Choose the vendor of each grantee (null: back to matching by name, or creating one). A person only. */
export async function putAccountingVendors(ctx: ServiceContext, body: unknown) {
  const ws = await writer(ctx);
  const input = parse(accountingVendorsInput, body);
  const p = needPort(ctx);
  const known = new Set((await grantees(ctx, ws.id)).map((g) => g.id));
  const vendors = await p.listVendors(ws.id).catch(booksError);
  const link = (await linkOf(ctx, ws.id)) ?? (await ctx.repos.table("accounting_links").insert({ workspace_id: ws.id, provider: ACCOUNTING_PROVIDER, updated_by: ctx.actor.userId }));
  const map = { ...refMap(link.vendor_map) };
  for (const v of input.vendors) {
    const id = bareUuid(v.granteeId, "Grantee");
    if (!known.has(id)) throw notFound("Grantee");
    if (v.vendorId === null) {
      delete map[id];
      continue;
    }
    const found = vendors.find((x) => x.id === v.vendorId);
    if (!found) throw new ApiError(422, "unknown_vendor", "That vendor is not in QuickBooks, or is not active");
    map[id] = { id: found.id, name: quickBooksName(found.name) };
  }
  await ctx.repos.table("accounting_links").update({ id: link.id }, { vendor_map: map as unknown as Link["vendor_map"], updated_by: ctx.actor.userId });
  await audit(ctx, "accounting.vendors_changed", "workspace", ws.id, { provider: ACCOUNTING_PROVIDER, chosen: input.vendors.length });
  return getAccountingVendors(ctx);
}

// ------------------------------------------------------------------------- the reconciliation view

export type ViewStatus = EntryStatus | "waiting" | "not_synced";

const day = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : null);
const externalPaidOn = (t: Tranche): string | null => {
  const paid = (t.external as { paidAt?: unknown } | null)?.paidAt;
  return typeof paid === "string" && /^\d{4}-\d{2}-\d{2}/.test(paid) ? paid.slice(0, 10) : null;
};

const entryView = (e: Entry) => ({
  id: e.id,
  status: e.status as EntryStatus,
  reason: (e.reason ?? null) as EntryReason | null,
  quickbooksId: e.external_id,
  reference: e.doc_number,
  posted: { amountMinor: e.amount_minor, currency: e.currency, paidOn: e.paid_on, vendorName: e.vendor_name },
  postedAt: e.posted_at,
  attention: (e.attention ?? null) as Record<string, unknown> | null,
  attentionAt: e.attention_at,
  handledAt: e.handled_at,
  attempts: e.attempts,
});

/**
 * The GMS's recorded payments next to their QuickBooks entries and statuses, newest first. Read only:
 * nothing read from QuickBooks is ever written into the GMS. With `compare`, the entries shown are
 * read back from QuickBooks (at most COMPARE_LIMIT) to say whether each still matches.
 */
export async function listAccountingEntries(ctx: ServiceContext, opts: { compare?: boolean } = {}) {
  const ws = await reader(ctx);
  const link = await linkOf(ctx, ws.id);
  const [tranches, entries] = await Promise.all([
    ctx.repos.table("tranches").find({ workspace_id: ws.id, status: ["settled", "returned"] }, { orderBy: "updated_at", ascending: false, limit: VIEW_LIMIT }),
    ctx.repos.table("accounting_entries").find({ workspace_id: ws.id, provider: ACCOUNTING_PROVIDER }, { orderBy: "created_at", ascending: false, limit: 5000 }),
  ]);
  // Entries of payments no longer listed (removed, or older than the list) still show.
  const shown = new Set(tranches.map((t) => t.id));
  const extra = entries.filter((e) => !e.tranche_id || !shown.has(e.tranche_id)).slice(0, VIEW_LIMIT);
  const extraTranches = extra.some((e) => e.tranche_id) ? await ctx.repos.table("tranches").find({ id: extra.flatMap((e) => (e.tranche_id ? [e.tranche_id] : [])), workspace_id: ws.id }) : [];
  const all = [...tranches, ...extraTranches];
  const awards = all.length ? await ctx.repos.table("awards").find({ id: [...new Set(all.map((t) => t.award_id))], workspace_id: ws.id }) : [];
  const recipients = await ctx.repos.table("workspaces").find({ id: [...new Set(awards.map((a) => a.recipient_workspace_id).filter((x): x is string => !!x))] });
  const shared = await sharingWith(ctx, ws.id, recipients.map((r) => r.id));
  const byTranche = new Map(entries.filter((e) => e.tranche_id).map((e) => [e.tranche_id!, e]));
  // Recorded since the sync was turned on, by the same ledger events the job reads.
  const since = link?.sync_enabled && link.sync_from ? new Set((await Promise.all(RECORDED.map((eventType) => ctx.ledger.list({ workspaceId: ws.id, subjectType: "tranche", eventType, from: link.sync_from!, limit: 500 })))).flat().map((e) => e.subjectId)) : new Set<string>();
  const payment = (t: Tranche) => {
    const a = awards.find((x) => x.id === t.award_id);
    const r = recipients.find((x) => x.id === a?.recipient_workspace_id);
    return { trancheId: apiId("tranche", t.id), awardId: apiId("award", t.award_id), awardTitle: a?.title ?? null, grantee: r ? namesShared(r, shared.has(r.id)).name : null, seq: t.seq, amountMinor: t.amount_minor, currency: t.currency, paidOn: externalPaidOn(t) ?? day(t.released_at) ?? day(t.updated_at), mode: t.mode, status: t.status };
  };
  const statusOf = (t: Tranche, e: Entry | undefined): ViewStatus => {
    if (e) return e.status as EntryStatus;
    return t.status === "settled" && since.has(t.id) ? "waiting" : "not_synced";
  };
  const items = [
    ...all.map((t) => {
      const e = byTranche.get(t.id);
      return { payment: payment(t), quickbooks: { status: statusOf(t, e), entry: e ? entryView(e) : null } };
    }),
    ...extra.filter((e) => !e.tranche_id).map((e) => ({ payment: null, quickbooks: { status: e.status as ViewStatus, entry: entryView(e) } })),
  ];
  if (opts.compare) {
    const p = needPort(ctx);
    const posted = items.filter((i) => i.quickbooks.entry?.quickbooksId).slice(0, COMPARE_LIMIT);
    for (const i of posted) {
      const e = i.quickbooks.entry!;
      try {
        const seen = await p.getExpense(ws.id, e.quickbooksId!);
        Object.assign(i.quickbooks, { inQuickBooks: !seen ? "missing" : seen.amountMinor === e.posted.amountMinor && seen.date === e.posted.paidOn ? "matches" : "differs" });
      } catch (err) {
        booksError(err);
      }
    }
  }
  return { syncEnabled: link?.sync_enabled ?? false, syncFrom: link?.sync_from ?? null, items };
}

/** A person says a payment that needed attention is now right in QuickBooks (they fixed it there). The GMS changes nothing in the books. */
export async function markEntryHandled(ctx: ServiceContext, entryId: string) {
  const ws = await writer(ctx);
  const e = await ctx.repos.table("accounting_entries").one({ id: bareUuid(entryId, "Entry"), workspace_id: ws.id });
  if (!e) throw notFound("Entry");
  if (e.status !== "needs_attention") throw new ApiError(409, "invalid_transition", "Only an entry that needs attention can be marked as handled");
  const t = e.tranche_id ? await ctx.repos.table("tranches").one({ id: e.tranche_id, workspace_id: ws.id }) : null;
  const now = ctx.now().toISOString();
  // What the books now hold is taken to be the payment as it is, so a later change is noticed again.
  const facts = t ? { amount_minor: t.amount_minor, currency: t.currency, ...(t.mode === "resolve" && externalPaidOn(t) ? { paid_on: externalPaidOn(t)! } : {}) } : {};
  const acknowledged = { ...((e.attention as Record<string, unknown> | null) ?? {}), status: t?.status ?? "removed" };
  const [row] = await ctx.repos.table("accounting_entries").update({ id: e.id, status: "needs_attention" }, { status: "handled", reason: null, handled_by: ctx.actor.userId, handled_at: now, attention: acknowledged as Entry["attention"], ...facts });
  if (!row) throw new ApiError(409, "conflict", "This entry changed while you were working. Reload and try again");
  await audit(ctx, "accounting.entry_handled", "accounting_entry", e.id, { provider: ACCOUNTING_PROVIDER, reason: e.reason, quickbooksId: e.external_id });
  return entryView(row);
}

/** Try a payment that is not in QuickBooks again on the next run. A person only. */
export async function retryEntry(ctx: ServiceContext, entryId: string) {
  const ws = await writer(ctx);
  const e = await ctx.repos.table("accounting_entries").one({ id: bareUuid(entryId, "Entry"), workspace_id: ws.id });
  if (!e) throw notFound("Entry");
  if (e.status !== "failed") throw new ApiError(409, "invalid_transition", "Only an entry that is not in QuickBooks can be tried again");
  const [row] = await ctx.repos.table("accounting_entries").update({ id: e.id, status: "failed" }, { attempts: 1 });
  if (!row) throw new ApiError(409, "conflict", "This entry changed while you were working. Reload and try again");
  await audit(ctx, "accounting.entry_retry", "accounting_entry", e.id, { provider: ACCOUNTING_PROVIDER, reason: e.reason });
  return entryView(row);
}

// ------------------------------------------------------------------------------------ the job

const MEMO: Record<Locale, (seq: number, award: string, program: string | null) => string> = {
  en: (seq, award, program) => `Grant payment ${seq}: ${award}${program ? ` (${program})` : ""}. Recorded by OpenGrants GMS.`,
  es: (seq, award, program) => `Pago ${seq} de la subvención: ${award}${program ? ` (${program})` : ""}. Registrado por OpenGrants GMS.`,
};

/** The GMS's reference for a payment, written on its entry (QuickBooks' DocNumber, at most 21 characters). */
export const referenceOf = (trancheId: string) => `GMS-${trancheId.replace(/-/g, "").slice(-16)}`;

/** When the payment was made, for the books: the date the funder recorded for a payment made elsewhere, else the day Passport settled it. */
async function paidOnOf(base: BaseContext, t: Tranche): Promise<string> {
  const external = t.mode === "resolve" ? externalPaidOn(t) : null;
  if (external) return external;
  const events = await base.ledger.list({ workspaceId: t.workspace_id, subjectType: "tranche", subjectId: t.id, limit: 200 });
  const settled = events.filter((e) => (RECORDED as readonly string[]).includes(e.eventType)).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))[0];
  return day(settled?.occurredAt) ?? day(t.released_at) ?? day(t.updated_at)!;
}

interface Run {
  base: BaseContext;
  books: QuickBooksBooks;
  ws: Row<"workspaces">;
  out: { posted: number; failed: number; attention: number; skipped: number };
}

/** Payments whose entry no longer matches: changed, voided or removed after posting. Nothing is written to QuickBooks. */
async function markChanged(run: Run, link: Link): Promise<void> {
  const { base, ws } = run;
  const entries = await base.repos.table("accounting_entries").find({ workspace_id: ws.id, provider: ACCOUNTING_PROVIDER, status: ["posted", "handled"] }, { limit: 5000 });
  if (!entries.length) return;
  const tranches = await base.repos.table("tranches").find({ id: entries.flatMap((e) => (e.tranche_id ? [e.tranche_id] : [])), workspace_id: ws.id });
  const now = base.now().toISOString();
  for (const e of entries) {
    const t = tranches.find((x) => x.id === e.tranche_id);
    const state = t?.status ?? "removed";
    // A void or removal a person already handled in QuickBooks is not raised again.
    const acknowledged = e.status === "handled" ? (e.attention as { status?: unknown } | null)?.status : undefined;
    let reason: "changed" | "voided" | "removed" | null = null;
    let attention: Record<string, unknown> = {};
    if (state !== "settled") [reason, attention] = state === acknowledged ? [null, {}] : [state === "removed" ? "removed" : "voided", { status: state }];
    else if (!t) continue;
    else if (t.amount_minor !== e.amount_minor || t.currency !== e.currency) [reason, attention] = ["changed", { amountMinor: { posted: e.amount_minor, now: t.amount_minor }, ...(t.currency !== e.currency ? { currency: { posted: e.currency, now: t.currency } } : {}) }];
    else if (t.mode === "resolve" && externalPaidOn(t) && externalPaidOn(t) !== e.paid_on) [reason, attention] = ["changed", { paidOn: { posted: e.paid_on, now: externalPaidOn(t) } }];
    if (!reason) continue;
    const [hit] = await base.repos.table("accounting_entries").update({ id: e.id, status: e.status }, { status: "needs_attention", reason, attention: attention as Entry["attention"], attention_at: now });
    if (!hit) continue;
    run.out.attention++;
    await audit(systemContext(base, { job: "accounting-sync" }, { id: ws.id, kind: "funder" }), "accounting.needs_attention", "accounting_entry", e.id, { provider: ACCOUNTING_PROVIDER, reason, quickbooksId: e.external_id, ...(link.sync_enabled ? {} : { syncOff: true }) });
  }
}

/** Claim one payment for posting. Null when it was posted before, is being posted, or waits for a person. */
async function claim(run: Run, link: Link, t: Tranche, award: Award): Promise<{ entry: Entry; again: boolean } | null> {
  const { base, ws } = run;
  const memo = MEMO[isLocale(link.locale) ? link.locale : DEFAULT_LOCALE](t.seq, award.title, award.program_id ? ((await base.repos.table("programs").one({ id: award.program_id }))?.name ?? null) : null).slice(0, 1000);
  const facts = { amount_minor: t.amount_minor, currency: t.currency, paid_on: await paidOnOf(base, t), memo };
  try {
    return { entry: await base.repos.table("accounting_entries").insert({ workspace_id: ws.id, provider: ACCOUNTING_PROVIDER, tranche_id: t.id, doc_number: referenceOf(t.id), status: "posting", ...facts }), again: false };
  } catch (e) {
    if (!(e instanceof RepoError && e.kind === "conflict")) throw e;
  }
  const prior = await base.repos.table("accounting_entries").one({ workspace_id: ws.id, tranche_id: t.id });
  if (!prior) return null;
  const stuck = prior.status === "posting" && Date.parse(prior.updated_at) < base.now().getTime() - STUCK_POSTING_MS;
  const vendorChosen = !!award.recipient_workspace_id && !!refMap(link.vendor_map)[award.recipient_workspace_id];
  const retry =
    prior.status === "failed" &&
    (prior.reason === "currency" ? t.currency === link.currency : prior.reason === "vendor_unclear" || prior.reason === "vendor_refused" ? vendorChosen || prior.attempts < MAX_ATTEMPTS : prior.attempts < MAX_ATTEMPTS);
  if (!stuck && !retry) return null;
  // Taken only while it is still in the state just read, so two runs never post it twice.
  const [taken] = await base.repos.table("accounting_entries").update({ id: prior.id, status: prior.status, attempts: prior.attempts }, { status: "posting", reason: null, attempts: Math.min(prior.attempts + 1, 20), ...facts });
  return taken ? { entry: taken, again: true } : null;
}

async function fail(run: Run, entry: Entry, reason: EntryReason): Promise<void> {
  await run.base.repos.table("accounting_entries").update({ id: entry.id, status: "posting" }, { status: "failed", reason });
  run.out.failed++;
}

/** The vendor of a payment's grantee: the one chosen, else QuickBooks' only vendor of that name, else (if allowed) a new one with the name only. */
async function vendorFor(run: Run, link: Link, award: Award): Promise<QuickBooksRef | "vendor_unclear" | "vendor_refused"> {
  const { base, books, ws } = run;
  const granteeId = award.recipient_workspace_id;
  if (!granteeId) return "vendor_unclear";
  const chosen = refMap(link.vendor_map)[granteeId];
  if (chosen) return chosen;
  const grantee = await base.repos.table("workspaces").one({ id: granteeId });
  if (!grantee) return "vendor_unclear";
  const name = namesShared(grantee, (await sharingWith(base, ws.id, [granteeId])).has(granteeId)).name;
  const matches = await books.findVendors(ws.id, name);
  let vendor: QuickBooksRef;
  if (matches.length === 1) vendor = { id: matches[0]!.id, name: matches[0]!.name };
  else if (matches.length > 1 || link.vendor_policy !== "create") return "vendor_unclear";
  else {
    try {
      const made = await books.createVendor(ws.id, name);
      vendor = { id: made.id, name: made.name };
    } catch (e) {
      if (e instanceof SourceReadError) return "vendor_refused";
      throw e;
    }
  }
  // Kept, so the next payment to this grantee uses the same vendor without asking QuickBooks again.
  const fresh = (await linkOf(base, ws.id)) ?? link;
  await base.repos.table("accounting_links").update({ id: fresh.id }, { vendor_map: { ...refMap(fresh.vendor_map), [granteeId]: { id: vendor.id, name: quickBooksName(vendor.name) } } as unknown as Link["vendor_map"] });
  return vendor;
}

/** Write one payment's expense. Returns false when nothing more should be tried this run (the connection is not usable). */
async function post(run: Run, link: Link, t: Tranche, award: Award): Promise<boolean> {
  const { base, books, ws } = run;
  const claimed = await claim(run, link, t, award);
  if (!claimed) {
    run.out.skipped++;
    return true;
  }
  const { entry, again } = claimed;
  if (t.currency !== link.currency) {
    await fail(run, entry, "currency");
    return true;
  }
  try {
    // A run interrupted between QuickBooks taking the entry and the GMS keeping its id: find it by its reference.
    const found = again ? await books.findExpense(ws.id, entry.doc_number) : null;
    const vendor = found ? null : await vendorFor(run, link, award);
    if (vendor === "vendor_unclear" || vendor === "vendor_refused") {
      await fail(run, entry, vendor);
      return true;
    }
    const tracked = link.tracking !== "none" && award.program_id ? (refMap(link.program_map)[award.program_id] ?? null) : null;
    const id = found
      ? found.id
      : (
          await books.createExpense(ws.id, {
            paidFromId: link.paid_from_ref!,
            expenseId: link.expense_ref!,
            vendorId: vendor!.id,
            amountMinor: entry.amount_minor,
            currency: entry.currency,
            date: entry.paid_on,
            memo: entry.memo,
            docNumber: entry.doc_number,
            classId: link.tracking === "class" ? (tracked?.id ?? null) : null,
            departmentId: link.tracking === "department" ? (tracked?.id ?? null) : null,
          })
        ).id;
    await base.repos.table("accounting_entries").update({ id: entry.id, status: "posting" }, { status: "posted", external_id: id, posted_at: base.now().toISOString(), ...(vendor ? { vendor_ref: vendor.id, vendor_name: quickBooksName(vendor.name) } : {}) });
    run.out.posted++;
    await audit(systemContext(base, { job: "accounting-sync" }, { id: ws.id, kind: "funder" }), "accounting.entry_posted", "accounting_entry", entry.id, { provider: ACCOUNTING_PROVIDER, trancheId: t.id, quickbooksId: id, reference: entry.doc_number, amountMinor: entry.amount_minor });
    return true;
  } catch (e) {
    const stop = e instanceof ConnectorAuthError || e instanceof ConnectorScopeError || e instanceof ConnectorScopeUnverifiedError || e instanceof ConnectorUnavailableError;
    await fail(run, entry, stop ? "unreachable" : e instanceof SourceReadError ? "refused" : "unreachable");
    return !stop;
  }
}

/**
 * Write the expenses due for every workspace with the sync on, and mark entries whose payment
 * changed. Called by the jobs Worker every fifteen minutes, after the tranche jobs. One failing
 * workspace does not stop the others.
 */
export async function syncAccounting(base: BaseContext): Promise<{ workspaces: number; posted: number; failed: number; attention: number; skipped: number }> {
  const out = { workspaces: 0, posted: 0, failed: 0, attention: 0, skipped: 0 };
  const books = base.ports.quickbooks;
  if (!books) return out;
  const links = await base.repos.table("accounting_links").find({ provider: ACCOUNTING_PROVIDER }, { limit: 5000 });
  for (const link of links) {
    try {
      const ws = await base.repos.table("workspaces").one({ id: link.workspace_id });
      if (!ws || ws.kind !== "funder") continue;
      const run: Run = { base, books, ws, out };
      // Changes are noticed even while the sync is off: the books still hold what was posted.
      await markChanged(run, link);
      if (!link.sync_enabled || !link.sync_from || ws.status !== "active") continue;
      out.workspaces++;
      const recorded = (await Promise.all(RECORDED.map((eventType) => base.ledger.list({ workspaceId: ws.id, subjectType: "tranche", eventType, from: link.sync_from!, limit: 500 })))).flat();
      const retries = await base.repos.table("accounting_entries").find({ workspace_id: ws.id, provider: ACCOUNTING_PROVIDER, status: ["failed", "posting"] }, { limit: 500 });
      const ids = [...new Set([...recorded.map((e) => e.subjectId), ...retries.flatMap((e) => (e.tranche_id ? [e.tranche_id] : []))])];
      if (!ids.length) continue;
      const done = new Set((await base.repos.table("accounting_entries").find({ workspace_id: ws.id, provider: ACCOUNTING_PROVIDER, tranche_id: ids, status: ["posted", "handled", "needs_attention"] }, { limit: 5000 })).map((e) => e.tranche_id));
      const tranches = (await base.repos.table("tranches").find({ id: ids.filter((id) => !done.has(id)), workspace_id: ws.id, status: "settled" }, { orderBy: "updated_at", limit: 500 })).slice(0, ENTRIES_PER_RUN);
      const awards = tranches.length ? await base.repos.table("awards").find({ id: [...new Set(tranches.map((t) => t.award_id))], workspace_id: ws.id }) : [];
      for (const t of tranches) {
        // Turned off or changed since the run began: stop at once, and post with what is set now.
        const live = await linkOf(base, ws.id);
        if (!live?.sync_enabled || !live.expense_ref || !live.paid_from_ref) break;
        const award = awards.find((a) => a.id === t.award_id);
        if (!award) continue;
        if (!(await post(run, live, t, award))) break;
      }
    } catch {
      out.failed++;
    }
  }
  return out;
}
