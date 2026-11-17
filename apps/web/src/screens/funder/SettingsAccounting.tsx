// SPDX-License-Identifier: AGPL-3.0-only
// Settings › Accounting (v1.13.0, docs/accounting.md): the QuickBooks sync of a funder workspace.
// Record-keeping only: each grant payment recorded in the GMS becomes one expense in QuickBooks, so
// nobody retypes it. Nothing here pays, schedules or moves money. A workspace admin connects
// QuickBooks through Composio; admins and finance staff set the mapping once (accounts, a class or
// location per program, a vendor per grantee) and turn the sync on. The reconciliation view below
// shows each payment next to its QuickBooks entry, read only. Status is always an icon and words.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router";
import { BookOpenCheck, CircleCheck, CircleDashed, Plug, RefreshCw, Unplug } from "lucide-react";
import type { AccountingEntries, AccountingItem, AccountingSync, AccountingVendors } from "../../api/accounting.ts";
import { useAccountingMutation, useAccountingQuery } from "../../api/accountingHooks.ts";
import { useAppConfig } from "../../api/launchHooks.ts";
import { useWorkspace } from "../../app/workspace.tsx";
import { QuickBooksBadge } from "../../components/InQuickBooks.tsx";
import { FunderShell } from "../../components/shells.tsx";
import { ErrorBanner, Field, Loading, Notice, PageHeader } from "../../components/ui.tsx";
import { formatDate, formatMinor } from "../../lib/format.ts";
import { translator, useExtrasMessages } from "../../i18n/index.tsx";
import { SettingsNav } from "./SettingsPassport.tsx";

const t = translator("extras");

function Card({ id, title, sub, state, children }: { id: string; title: string; sub?: string; state?: ReactNode; children: ReactNode }) {
  return (
    <section className="card" aria-labelledby={`${id}-h`}>
      <div className="card-h">
        <div>
          <h2 id={`${id}-h`} style={{ fontSize: "18px" }}>
            {title}
          </h2>
          {sub && <p className="small muted">{sub}</p>}
        </div>
        {state}
      </div>
      <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        {children}
      </div>
    </section>
  );
}

function Saved({ text }: { text: string }) {
  return (
    <span className="notice" role="status">
      <CircleCheck className="ic" aria-hidden="true" />
      {text}
    </span>
  );
}

// ------------------------------------------------------------------------------- connection

function Connection({ sync, admin, onChange }: { sync: AccountingSync; admin: boolean; onChange: () => void }) {
  const ws = useWorkspace("funder");
  const location = useLocation();
  const navigate = useNavigate();
  const connect = useAccountingMutation((api) => api.connect(`/w/${ws.handle}/settings/accounting`));
  const disconnect = useAccountingMutation((api) => api.disconnect());
  const back = useRef(new URLSearchParams(location.search).get("connected") === "quickbooks");
  // Back from QuickBooks' sign-in: read the connection again once, then tidy the address.
  useEffect(() => {
    if (!back.current) return;
    back.current = false;
    onChange();
    navigate(location.pathname, { replace: true });
  }, [onChange]);
  const pending = !sync.connected && sync.connection === "pending";
  const state = sync.connected ? (
    <span className="bdg bdg-ok">
      <CircleCheck className="ic" aria-hidden="true" />
      {t("accounting.connected")}
    </span>
  ) : (
    <span className={pending ? "bdg bdg-info" : "bdg bdg-neutral"}>
      <CircleDashed className="ic" aria-hidden="true" />
      {pending ? t("accounting.signInStarted") : t("accounting.notConnected")}
    </span>
  );
  const busy = connect.state === "saving" || disconnect.state === "saving";
  return (
    <Card id="acc-qb" title="QuickBooks Online" sub={t("accounting.quickbooks.sub")} state={state}>
      {(connect.error !== null || disconnect.error !== null) && <ErrorBanner error={connect.error ?? disconnect.error} />}
      {!admin ? (
        !sync.connected && <p className="small muted" style={{ margin: 0 }}>{t("accounting.adminConnects")}</p>
      ) : sync.connected ? (
        <div className="row wrap" style={{ gap: "10px" }}>
          <button
            type="button"
            className="btn btn-sm btn-danger"
            disabled={busy}
            onClick={async () => {
              if (await disconnect.run()) onChange();
            }}
          >
            <Unplug className="ic" aria-hidden="true" />
            {t("accounting.disconnect")}
          </button>
          <span className="small muted">{t("accounting.disconnectHelp")}</span>
        </div>
      ) : (
        <div className="row wrap" style={{ gap: "10px" }}>
          <button
            type="button"
            className="btn btn-sm btn-secondary"
            disabled={busy}
            onClick={async () => {
              const next = await connect.run();
              if (!next) return;
              if (!next.connected && next.connectUrl) window.location.assign(next.connectUrl);
              else onChange();
            }}
          >
            <Plug className="ic" aria-hidden="true" />
            {pending ? t("accounting.continueSignIn") : t("accounting.connect")}
          </button>
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------------- mapping

function Mapping({ sync, onSaved }: { sync: AccountingSync; onSaved: (next: AccountingSync) => void }) {
  const options = useAccountingQuery((api) => api.options(), []);
  const s = sync.settings;
  const [expenseId, setExpense] = useState(s.expense?.id ?? "");
  const [paidFromId, setPaidFrom] = useState(s.paidFrom?.id ?? "");
  const [tracking, setTracking] = useState(s.tracking);
  const [programs, setPrograms] = useState<Record<string, string>>(() => Object.fromEntries(sync.programs.flatMap((p) => (p.ref ? [[p.programId, p.ref.id]] : []))));
  const [vendorPolicy, setVendorPolicy] = useState(s.vendorPolicy);
  const [syncEnabled, setSyncEnabled] = useState(s.syncEnabled);
  const [saved, setSaved] = useState<boolean | null>(null);
  const save = useAccountingMutation((api) =>
    api.saveSettings({ expenseId, paidFromId, tracking, vendorPolicy, syncEnabled, ...(tracking === "none" ? {} : { programs: Object.fromEntries(sync.programs.map((p) => [p.programId, programs[p.programId] || null])) }) }),
  );
  if (options.status === "loading") return <Loading label={t("accounting.loading")} />;
  if (options.status === "error") return <ErrorBanner error={options.error} onRetry={options.reload} />;
  const o = options.data;
  const tracked = tracking === "class" ? o.classes : tracking === "department" ? o.departments : [];
  return (
    <Card id="acc-map" title={t("accounting.mapping.title")} sub={t("accounting.mapping.sub")}>
      <form
        className="col"
        style={{ gap: "12px" }}
        onSubmit={async (e) => {
          e.preventDefault();
          setSaved(null);
          const next = await save.run();
          if (next) {
            setSaved(next.settings.syncEnabled);
            onSaved(next);
          }
        }}
      >
        <Field id="acc-expense" label={t("accounting.mapping.expense")} help={t("accounting.mapping.expenseHelp")}>
          <select id="acc-expense" className="sel" value={expenseId} onChange={(e) => setExpense(e.target.value)} style={{ maxWidth: "360px" }}>
            <option value="">{t("accounting.mapping.choose")}</option>
            {o.expenseAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </Field>
        <Field id="acc-paid-from" label={t("accounting.mapping.paidFrom")} help={t("accounting.mapping.paidFromHelp")}>
          <select id="acc-paid-from" className="sel" value={paidFromId} onChange={(e) => setPaidFrom(e.target.value)} style={{ maxWidth: "360px" }}>
            <option value="">{t("accounting.mapping.choose")}</option>
            {o.bankAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </Field>
        <fieldset className="col" style={{ gap: "6px", border: 0, padding: 0, margin: 0 }}>
          <legend className="b">{t("accounting.mapping.tracking")}</legend>
          {(["none", "class", "department"] as const).map((k) => (
            <label key={k} className="row" style={{ gap: "8px" }}>
              <input type="radio" name="acc-tracking" checked={tracking === k} onChange={() => setTracking(k)} />
              <span>{k === "none" ? t("accounting.mapping.trackNone") : k === "class" ? t("accounting.mapping.trackClass") : t("accounting.mapping.trackDepartment")}</span>
            </label>
          ))}
        </fieldset>
        {tracking !== "none" &&
          sync.programs.map((p) => (
            <Field key={p.programId} id={`acc-prog-${p.programId}`} label={t("accounting.mapping.programLabel", { program: p.name })}>
              <select id={`acc-prog-${p.programId}`} className="sel" value={programs[p.programId] ?? ""} onChange={(e) => setPrograms({ ...programs, [p.programId]: e.target.value })} style={{ maxWidth: "360px" }}>
                <option value="">{t("accounting.mapping.noneForProgram")}</option>
                {tracked.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
          ))}
        <fieldset className="col" style={{ gap: "6px", border: 0, padding: 0, margin: 0 }}>
          <legend className="b">{t("accounting.mapping.vendorPolicy")}</legend>
          <label className="row" style={{ gap: "8px" }}>
            <input type="radio" name="acc-vendor-policy" checked={vendorPolicy === "create"} onChange={() => setVendorPolicy("create")} />
            <span>{t("accounting.mapping.vendorCreate")}</span>
          </label>
          <label className="row" style={{ gap: "8px" }}>
            <input type="radio" name="acc-vendor-policy" checked={vendorPolicy === "ask"} onChange={() => setVendorPolicy("ask")} />
            <span>{t("accounting.mapping.vendorAsk")}</span>
          </label>
        </fieldset>
        <label className="row" style={{ gap: "8px" }}>
          <input type="checkbox" checked={syncEnabled} onChange={(e) => setSyncEnabled(e.target.checked)} />
          <span className="b">{t("accounting.mapping.syncOn")}</span>
        </label>
        <p className="small muted" style={{ margin: 0 }}>
          {t("accounting.mapping.syncHelp")}
        </p>
        {save.error !== null && <ErrorBanner error={save.error} />}
        {saved !== null && <Saved text={saved ? t("accounting.mapping.savedOn") : t("accounting.mapping.savedOff")} />}
        <div className="row wrap" style={{ gap: "10px" }}>
          <button type="submit" className="btn btn-primary btn-sm" disabled={!expenseId || !paidFromId || save.state === "saving"}>
            {t("accounting.mapping.save")}
          </button>
        </div>
      </form>
    </Card>
  );
}

// ---------------------------------------------------------------------------------- vendors

function Vendors({ data, onSaved }: { data: AccountingVendors; onSaved: (next: AccountingVendors) => void }) {
  const [chosen, setChosen] = useState<Record<string, string>>(() => Object.fromEntries(data.grantees.map((g) => [g.granteeId, g.vendor?.id ?? ""])));
  const [saved, setSaved] = useState(false);
  const save = useAccountingMutation((api) => api.saveVendors({ vendors: data.grantees.map((g) => ({ granteeId: g.granteeId, vendorId: chosen[g.granteeId] || null })) }));
  return (
    <Card id="acc-vendors" title={t("accounting.vendors.title")} sub={t("accounting.vendors.sub")}>
      {data.grantees.length === 0 ? (
        <p className="small muted" style={{ margin: 0 }}>
          {t("accounting.vendors.none")}
        </p>
      ) : (
        <form
          className="col"
          style={{ gap: "12px" }}
          onSubmit={async (e) => {
            e.preventDefault();
            setSaved(false);
            const next = await save.run();
            if (next) {
              setSaved(true);
              onSaved(next);
            }
          }}
        >
          {data.grantees.map((g) => (
            <Field key={g.granteeId} id={`acc-v-${g.granteeId}`} label={g.name} help={!g.vendor && g.suggestion ? t("accounting.vendors.matched", { vendor: g.suggestion.name }) : undefined}>
              <select id={`acc-v-${g.granteeId}`} className="sel" value={chosen[g.granteeId] ?? ""} onChange={(e) => setChosen({ ...chosen, [g.granteeId]: e.target.value })} style={{ maxWidth: "360px" }}>
                <option value="">{data.vendorPolicy === "create" ? t("accounting.vendors.byNameOrCreate") : t("accounting.vendors.byName")}</option>
                {data.vendors.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
            </Field>
          ))}
          {save.error !== null && <ErrorBanner error={save.error} />}
          {saved && <Saved text={t("accounting.vendors.saved")} />}
          <div className="row wrap" style={{ gap: "10px" }}>
            <button type="submit" className="btn btn-secondary btn-sm" disabled={save.state === "saving"}>
              {t("accounting.vendors.save")}
            </button>
          </div>
        </form>
      )}
    </Card>
  );
}

// ------------------------------------------------------------------------- reconciliation

const REASON: Record<string, () => string> = {
  changed: () => t("accounting.reason.changed"),
  voided: () => t("accounting.reason.voided"),
  removed: () => t("accounting.reason.removed"),
  vendor_unclear: () => t("accounting.reason.vendorUnclear"),
  vendor_refused: () => t("accounting.reason.vendorRefused"),
  currency: () => t("accounting.reason.currency"),
  refused: () => t("accounting.reason.refused"),
  unreachable: () => t("accounting.reason.unreachable"),
};
const COMPARED: Record<string, () => string> = {
  matches: () => t("accounting.compare.matches"),
  differs: () => t("accounting.compare.differs"),
  missing: () => t("accounting.compare.missing"),
};

function EntryRow({ item, writer, onChanged }: { item: AccountingItem; writer: boolean; onChanged: () => void }) {
  const e = item.quickbooks.entry;
  const handled = useAccountingMutation((api) => api.handled(e!.id));
  const retry = useAccountingMutation((api) => api.retry(e!.id));
  const p = item.payment;
  const amount = p ? formatMinor(p.amountMinor, p.currency) : e ? formatMinor(e.posted.amountMinor, e.posted.currency) : "";
  return (
    <tr>
      <td className="b">{p?.grantee ?? t("accounting.entries.removed")}</td>
      <td>
        {p ? (
          <>
            {p.awardTitle}
            <div className="small muted">{t("accounting.entries.paymentN", { seq: p.seq })}</div>
          </>
        ) : (
          e?.posted.vendorName
        )}
      </td>
      <td className="num">{amount}</td>
      <td>{formatDate(p?.paidOn ?? e?.posted.paidOn)}</td>
      <td>
        <QuickBooksBadge status={item.quickbooks.status} />
        {e?.reason && <div className="small">{REASON[e.reason]?.()}</div>}
        {item.quickbooks.inQuickBooks && <div className="small muted">{COMPARED[item.quickbooks.inQuickBooks]?.()}</div>}
      </td>
      <td className="small">{e?.quickbooksId ? t("accounting.entries.ref", { reference: e.reference }) : "—"}</td>
      <td>
        {writer && e?.status === "needs_attention" && (
          <button
            type="button"
            className="btn btn-sm btn-secondary"
            disabled={handled.state === "saving"}
            onClick={async () => {
              if (await handled.run()) onChanged();
            }}
          >
            {t("accounting.entries.handled")}
          </button>
        )}
        {writer && e?.status === "failed" && (
          <button
            type="button"
            className="btn btn-sm btn-secondary"
            disabled={retry.state === "saving"}
            onClick={async () => {
              if (await retry.run()) onChanged();
            }}
          >
            {t("accounting.entries.retry")}
          </button>
        )}
        {(handled.error !== null || retry.error !== null) && <ErrorBanner error={handled.error ?? retry.error} />}
      </td>
    </tr>
  );
}

function Entries({ writer, version }: { writer: boolean; version: number }) {
  const [compare, setCompare] = useState(false);
  const q = useAccountingQuery((api) => api.entries(compare), [compare, version]);
  const data: AccountingEntries | undefined = q.data;
  return (
    <Card id="acc-entries" title={t("accounting.entries.title")} sub={t("accounting.entries.sub")}>
      <div className="row wrap" style={{ gap: "10px" }}>
        <button type="button" className="btn btn-sm btn-ghost" disabled={q.status === "loading"} onClick={() => (compare ? q.reload() : setCompare(true))}>
          <RefreshCw className="ic" aria-hidden="true" />
          {t("accounting.entries.compare")}
        </button>
      </div>
      {q.status === "loading" && <Loading label={t("accounting.loading")} />}
      {q.status === "error" && <ErrorBanner error={q.error} onRetry={q.reload} />}
      {data && (
        <div className="tbl-wrap" tabIndex={0} role="region" aria-label={t("accounting.entries.scrollable")}>
          <table className="tbl" aria-label={t("accounting.entries.table")}>
            <thead>
              <tr>
                <th>{t("accounting.entries.grantee")}</th>
                <th>{t("accounting.entries.award")}</th>
                <th className="num">{t("accounting.entries.amount")}</th>
                <th>{t("accounting.entries.paidOn")}</th>
                <th>{t("accounting.entries.status")}</th>
                <th>{t("accounting.entries.entry")}</th>
                <th>
                  <span className="sr">{t("accounting.entries.actions")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((i, n) => (
                <EntryRow key={i.payment?.trancheId ?? i.quickbooks.entry?.id ?? n} item={i} writer={writer} onChanged={q.reload} />
              ))}
              {!data.items.length && (
                <tr>
                  <td colSpan={7} className="muted">
                    {t("accounting.entries.none")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

// ------------------------------------------------------------------------------------- page

export default function SettingsAccounting() {
  useExtrasMessages();
  const ws = useWorkspace("funder");
  const base = `/w/${ws.handle}`;
  const available = useAppConfig().available?.quickbooks === true;
  const role = ws.member.role ?? "admin";
  const writer = role === "admin" || role === "finance";
  const [version, setVersion] = useState(0);
  // Reloaded in place (the screen stays) after a connection change; the mapping's answer replaces it directly.
  const sync = useAccountingQuery((api) => api.sync(), []);
  const connected = sync.status === "ready" && sync.data.connected;
  const [vendorsVersion, setVendorsVersion] = useState(0);
  const vendors = useAccountingQuery((api) => (connected ? api.vendors() : Promise.resolve(null)), [connected, vendorsVersion]);
  const bump = () => setVersion((v) => v + 1);
  const reconnected = () => {
    sync.reload();
    bump();
  };
  return (
    <FunderShell active="Settings">
      <title>{t("accounting.pageTitle", { name: ws.name })}</title>
      <main className="main">
        <PageHeader crumbs={[{ label: ws.name, to: base }, { label: t("accounting.settings"), to: `${base}/settings` }, { label: t("accounting.title") }]} title={t("accounting.title")} meta={<span>{ws.name}</span>} />
        <div style={{ display: "grid", gridTemplateColumns: "220px minmax(0, 1fr)", gap: "20px", alignItems: "start" }}>
          <SettingsNav base={base} active="accounting" />
          <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
            {!available ? (
              <Notice tone="neu" title={t("accounting.notConfiguredTitle")}>
                {t("accounting.notConfiguredBody")}
              </Notice>
            ) : !writer ? (
              <Notice tone="neu" title={t("accounting.notYoursTitle")}>
                {t("accounting.notYoursBody")}
              </Notice>
            ) : (
              <>
                <Notice tone="info" title={t("accounting.recordKeepingTitle")}>
                  {t("accounting.recordKeepingBody")}
                </Notice>
                {sync.status === "loading" && <Loading label={t("accounting.loading")} />}
                {sync.status === "error" && <ErrorBanner error={sync.error} onRetry={sync.reload} />}
                {sync.status === "ready" && (
                  <>
                    <Connection sync={sync.data} admin={role === "admin"} onChange={reconnected} />
                    {sync.data.connected && (
                      <Mapping
                        sync={sync.data}
                        onSaved={(next) => {
                          sync.set(next);
                          setVendorsVersion((v) => v + 1);
                          bump();
                        }}
                      />
                    )}
                    {sync.data.settings.syncEnabled && sync.data.settings.syncFrom && (
                      <p className="small muted row" style={{ gap: "6px", margin: 0 }}>
                        <BookOpenCheck className="ic" aria-hidden="true" />
                        {t("accounting.syncSince", { when: formatDate(sync.data.settings.syncFrom) })}
                      </p>
                    )}
                    {connected && vendors.status === "error" && <ErrorBanner error={vendors.error} onRetry={vendors.reload} />}
                    {connected && vendors.status === "ready" && vendors.data && (
                      <Vendors
                        key={vendorsVersion}
                        data={vendors.data}
                        onSaved={(next) => {
                          vendors.set(next);
                          bump();
                        }}
                      />
                    )}
                    <Entries writer={writer} version={version} />
                  </>
                )}
              </>
            )}
          </div>
        </div>
      </main>
    </FunderShell>
  );
}
