// SPDX-License-Identifier: AGPL-3.0-only
// Open data on the Reporting screen (docs/open-data.md): choose a year or a date range, see how
// many awards the 360Giving and CommonGrants exports will hold and which are left out and why,
// then download. A workspace admin adds the funder's 360Giving prefix and may switch on the public
// feed ("Publish my awards as open data", off by default); staff can keep an award confidential.
// The panel never shows a person's name: an award to an individual reads "An individual".
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { CircleCheck, CircleMinus, Copy, Download, ExternalLink, Globe, Lock, UserRound } from "lucide-react";
import { createHttpOpenDataApi, type OpenDataApi, type OpenDataAwardRow, type OpenDataFormat, type OpenDataRange, type OpenDataSummary } from "../../api/openData.ts";
import { useServices, type Services } from "../../app/services.tsx";
import { useCurrentWorkspace } from "../../app/workspace.tsx";
import { ErrorBanner, Field, Loading, Notice } from "../../components/ui.tsx";
import { env } from "../../env.ts";
import { copyText, downloadBlob } from "../../lib/browser.ts";
import { formatDate, formatMoney } from "../../lib/format.ts";
import { createMockOpenDataApi, seedOpenDataStore, type OpenDataStore } from "../../mocks/openData.ts";

/** Roles that may read the export (the server checks the same). */
const READERS = ["admin", "program_officer", "finance", "auditor"];
/** Roles that may keep an award confidential. */
const STAFF = ["admin", "program_officer"];
/** As the server checks it: `360G-` and the publisher's code. */
const PREFIX = /^360G-[A-Za-z0-9](?:[A-Za-z0-9_-]{0,58}[A-Za-z0-9])?$/;
const PREFIX_HELP = "A 360Giving prefix starts with 360G- followed by letters, numbers, hyphens or underscores, e.g. 360G-riverbend";

const ports = new WeakMap<object, { api: OpenDataApi; ws: { id: string | null; handle: string | null } }>();
const mockStores = new WeakMap<object, Map<string, OpenDataStore>>();

/** Mock mode: the open data fixtures for a workspace handle (Riverbend has awards; any other funder starts empty). */
export function mockOpenDataStore(services: Pick<Services, "auth">, handle: string): OpenDataStore {
  let byHandle = mockStores.get(services.auth);
  if (!byHandle) mockStores.set(services.auth, (byHandle = new Map()));
  let store = byHandle.get(handle);
  if (!store) {
    const seeded = seedOpenDataStore();
    store = handle === seeded.handle ? seeded : { ...seeded, handle, funderName: handle, awards: [], confidential: new Set(), opportunities: [] };
    byHandle.set(handle, store);
  }
  return store;
}

function useOpenDataApi(): OpenDataApi {
  const services = useServices();
  const workspace = useCurrentWorkspace();
  let port = ports.get(services.auth);
  if (!port) {
    const ws = { id: null as string | null, handle: null as string | null };
    const api: OpenDataApi = services.mock
      ? {
          summary: (r) => createMockOpenDataApi(mockOpenDataStore(services, ws.handle ?? "riverbend")).summary(r),
          download: (f, r, d) => createMockOpenDataApi(mockOpenDataStore(services, ws.handle ?? "riverbend")).download(f, r, d),
          saveSettings: (p) => createMockOpenDataApi(mockOpenDataStore(services, ws.handle ?? "riverbend")).saveSettings(p),
          setConfidential: (id, c) => createMockOpenDataApi(mockOpenDataStore(services, ws.handle ?? "riverbend")).setConfidential(id, c),
        }
      : createHttpOpenDataApi({ baseUrl: env.apiBaseUrl, token: async () => (await services.auth.getSession())?.accessToken ?? null, workspaceId: () => ws.id, handle: () => ws.handle });
    port = { api, ws };
    ports.set(services.auth, port);
  }
  if (workspace?.kind === "funder") {
    port.ws.id = workspace.id;
    port.ws.handle = workspace.handle;
  }
  return port.api;
}

type Period = { kind: "all" } | { kind: "year"; year: number } | { kind: "custom"; from: string; to: string };
const rangeOf = (p: Period): OpenDataRange => (p.kind === "all" ? { from: null, to: null } : p.kind === "year" ? { from: `${p.year}-01-01`, to: `${p.year}-12-31` } : { from: p.from || null, to: p.to || null });
const periodValue = (p: Period) => (p.kind === "year" ? String(p.year) : p.kind);

function OpenDataStatus({ row }: { row: OpenDataAwardRow }) {
  if (row.exported && !row.nameOnly)
    return (
      <span className="bdg bdg-ok">
        <CircleCheck className="ic" aria-hidden="true" />
        Exported
      </span>
    );
  if (row.exported)
    return (
      <span className="bdg bdg-info">
        <UserRound className="ic" aria-hidden="true" />
        Exported, name only
      </span>
    );
  const Icon = row.reason === "confidential" ? Lock : CircleMinus;
  return (
    <span className="bdg bdg-neutral">
      <Icon className="ic" aria-hidden="true" />
      Left out: {row.reasonLabel ?? "not exported"}
    </span>
  );
}

const FORMATS: { format: OpenDataFormat; label: string }[] = [
  { format: "360giving-json", label: "360Giving JSON" },
  { format: "360giving-csv", label: "360Giving CSV" },
  { format: "commongrants-json", label: "CommonGrants JSON" },
];

export function OpenDataPanel() {
  const api = useOpenDataApi();
  const workspace = useCurrentWorkspace();
  const role = workspace?.member.role;
  const uid = useId();
  const thisYear = new Date().getFullYear();
  const [period, setPeriod] = useState<Period>({ kind: "all" });
  const range = useMemo(() => rangeOf(period), [period]);
  const [state, setState] = useState<{ status: "loading" } | { status: "error"; error: unknown } | { status: "ready"; data: OpenDataSummary }>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const [actionError, setActionError] = useState<unknown>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [prefix, setPrefix] = useState("");
  const [prefixError, setPrefixError] = useState<string | null>(null);
  const seededPrefix = useRef(false);
  const knownYears = useRef<number[]>([]);
  const allowed = !role || READERS.includes(role);

  useEffect(() => {
    if (!allowed) return;
    let live = true;
    setState((s) => (s.status === "ready" ? s : { status: "loading" }));
    api.summary(range).then(
      (data) => {
        if (!live) return;
        setState({ status: "ready", data });
        if (!seededPrefix.current) {
          seededPrefix.current = true;
          setPrefix(data.settings.threeSixtyGivingPrefix ?? "");
        }
      },
      (error: unknown) => live && setState({ status: "error", error }),
    );
    return () => {
      live = false;
    };
  }, [api, range, attempt, allowed]);
  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  if (!allowed) return null;
  const isAdmin = role === "admin";
  const isStaff = !!role && STAFF.includes(role);

  const act = async (key: string, run: () => Promise<string | null>) => {
    setBusy(key);
    setActionError(null);
    setNote(null);
    try {
      const done = await run();
      if (done) setNote(done);
      reload();
    } catch (e) {
      setActionError(e);
    } finally {
      setBusy(null);
    }
  };
  const d = state.status === "ready" ? state.data : null;
  // The years the funder has awards in; the chosen year stays listed while it loads.
  if (d?.years.length) knownYears.current = d.years;
  const years = [...new Set([...knownYears.current, ...(period.kind === "year" ? [period.year] : [])])].sort((x, y) => y - x);
  const canDownload = (f: OpenDataFormat) => !!d && (f === "commongrants-json" ? d.counts.exported + d.commonGrants.opportunities > 0 : d.counts.exported > 0);
  const savedPrefix = d?.settings.threeSixtyGivingPrefix ?? "";

  return (
    <section className="card" aria-labelledby={`${uid}-h`} style={{ marginTop: "20px" }}>
      <div className="card-h">
        <h3 id={`${uid}-h`} className="row">
          <Globe className="ic" aria-hidden="true" />
          Open data
        </h3>
        <span className="small muted">360Giving Data Standard and CommonGrants</span>
      </div>
      <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        <p className="small muted" style={{ margin: 0 }}>
          Share your grants as open data: 360Giving files can appear in GrantNav and reach Candid, and CommonGrants records can be read by any CommonGrants tool. Only accepted grants go out. Offers, cancelled grants, grants to individuals and grants you keep confidential never do, and a grantee that has not verified with Passport and shared its record with you is named only, with no address.
        </p>

        <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", alignItems: "flex-end" }}>
          <div style={{ minWidth: "200px" }}>
            <Field id={`${uid}-period`} label="Period">
              <select
                className="sel"
                id={`${uid}-period`}
                value={periodValue(period)}
                onChange={(e) => {
                  const v = e.target.value;
                  setPeriod(v === "all" ? { kind: "all" } : v === "custom" ? { kind: "custom", from: `${thisYear}-01-01`, to: `${thisYear}-12-31` } : { kind: "year", year: Number(v) });
                }}
              >
                <option value="all">All years</option>
                {years.map((y) => (
                  <option key={y} value={String(y)}>
                    Awards made in {y}
                  </option>
                ))}
                <option value="custom">A date range</option>
              </select>
            </Field>
          </div>
          {period.kind === "custom" && (
            <>
              <Field id={`${uid}-from`} label="From">
                <input className="inp" type="date" id={`${uid}-from`} value={period.from} onChange={(e) => setPeriod({ ...period, from: e.target.value })} />
              </Field>
              <Field id={`${uid}-to`} label="To">
                <input className="inp" type="date" id={`${uid}-to`} value={period.to} onChange={(e) => setPeriod({ ...period, to: e.target.value })} />
              </Field>
            </>
          )}
        </div>

        {state.status === "loading" && <Loading label="Counting awards" />}
        {state.status === "error" && <ErrorBanner error={state.error} onRetry={reload} title="The open data summary did not load" />}
        {note && <Notice tone="ok" title={note} />}
        {actionError !== null && <ErrorBanner error={actionError} />}

        {d && (
          <>
            {d.draft && (
              <Notice tone="warn" title="These files are drafts">
                Until you add your 360Giving publisher prefix, identifiers start with DRAFT and 360Giving will not accept the file.{" "}
                <a href={d.registerUrl} target="_blank" rel="noreferrer noopener">
                  How to register as a 360Giving publisher
                  <ExternalLink className="ic ic-sm" aria-hidden="true" style={{ marginLeft: "4px" }} />
                </a>
              </Notice>
            )}

            <div role="group" aria-label="What the export holds" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "12px" }}>
              <div className="stat">
                <span className="stat-l">Will be exported</span>
                <span className="stat-v">{d.counts.exported}</span>
                <span className="stat-d">of {d.counts.inRange} awards in the period</span>
              </div>
              <div className="stat">
                <span className="stat-l">Left out</span>
                <span className="stat-v">{d.counts.leftOut}</span>
              </div>
              <div className="stat">
                <span className="stat-l">Named only</span>
                <span className="stat-v">{d.counts.nameOnly}</span>
                <span className="stat-d">not verified and shared</span>
              </div>
              <div className="stat">
                <span className="stat-l">CommonGrants records</span>
                <span className="stat-v">{d.commonGrants.opportunities + d.commonGrants.awards}</span>
                <span className="stat-d">
                  {d.commonGrants.opportunities} {d.commonGrants.opportunities === 1 ? "opportunity" : "opportunities"}, {d.commonGrants.awards} {d.commonGrants.awards === 1 ? "award" : "awards"}
                </span>
              </div>
            </div>

            {d.leftOut.length > 0 && (
              <div>
                <h4 className="lbl" id={`${uid}-out`} style={{ marginBottom: "6px" }}>
                  Left out, and why
                </h4>
                <ul aria-labelledby={`${uid}-out`} style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexWrap: "wrap", gap: "8px" }}>
                  {d.leftOut.map((r) => (
                    <li key={r.reason}>
                      <span className="bdg bdg-neutral">
                        {r.reason === "confidential" ? <Lock className="ic" aria-hidden="true" /> : <CircleMinus className="ic" aria-hidden="true" />}
                        {r.label}: {r.count}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="row" style={{ flexWrap: "wrap" }}>
              {FORMATS.map(({ format, label }) => (
                <button
                  key={format}
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={!canDownload(format) || busy !== null}
                  onClick={() =>
                    act(`download-${format}`, async () => {
                      const file = await api.download(format, range, d.draft);
                      downloadBlob(file.blob, file.filename);
                      return null;
                    })
                  }
                >
                  <Download className="ic" aria-hidden="true" />
                  Download {label}
                </button>
              ))}
              {d.counts.exported === 0 && <span className="small muted">Nothing in this period can be exported.</span>}
            </div>

            {d.awards.length > 0 && (
              <details>
                <summary className="b" style={{ cursor: "pointer" }}>
                  Awards in this period ({d.counts.inRange})
                </summary>
                <div className="tbl-wrap" tabIndex={0} role="region" aria-label="Awards in this period, scrollable" style={{ marginTop: "10px" }}>
                  <table className="tbl" aria-label="Awards in this period">
                    <thead>
                      <tr>
                        <th>Award</th>
                        <th>Recipient</th>
                        <th>Amount</th>
                        <th>Award date</th>
                        <th>Open data</th>
                        {isStaff && <th>Confidential</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {d.awards.map((a) => (
                        <tr key={a.awardId}>
                          <td>{a.title}</td>
                          <td>{a.recipientName}</td>
                          <td>{formatMoney(a.awardedAmount)}</td>
                          <td>{formatDate(a.awardDate)}</td>
                          <td>
                            <OpenDataStatus row={a} />
                          </td>
                          {isStaff && (
                            <td>
                              {a.exported || a.reason === "confidential" ? (
                                <input
                                  type="checkbox"
                                  aria-label={`Keep ${a.title} confidential`}
                                  checked={a.confidential}
                                  disabled={busy !== null}
                                  onChange={(e) => {
                                    const on = e.target.checked;
                                    void act(`conf-${a.awardId}`, async () => {
                                      await api.setConfidential(a.awardId, on);
                                      return on ? `${a.title} is kept confidential and will not be exported.` : `${a.title} can be exported again.`;
                                    });
                                  }}
                                />
                              ) : (
                                <span className="muted" aria-label="Not exported anyway">
                                  —
                                </span>
                              )}
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {d.awardsShown < d.counts.inRange && <p className="small muted">The first {d.awardsShown} awards are listed; the counts cover all {d.counts.inRange}.</p>}
              </details>
            )}

            {isAdmin && (
              <div style={{ borderTop: "1px solid var(--og-gray-200)", paddingTop: "16px", display: "flex", flexDirection: "column", gap: "14px" }}>
                <form
                  className="row"
                  style={{ alignItems: "flex-start", flexWrap: "wrap", gap: "10px" }}
                  onSubmit={(e) => {
                    e.preventDefault();
                    const value = prefix.trim();
                    if (value && !PREFIX.test(value)) {
                      setPrefixError(PREFIX_HELP);
                      return;
                    }
                    setPrefixError(null);
                    void act("prefix", async () => {
                      await api.saveSettings({ threeSixtyGivingPrefix: value || null });
                      return value ? "360Giving prefix saved." : "360Giving prefix removed.";
                    });
                  }}
                >
                  <div style={{ minWidth: "260px", flex: "1 1 260px", maxWidth: "380px" }}>
                    <Field id={`${uid}-prefix`} label="360Giving publisher prefix" help="The prefix 360Giving gave you when you registered, such as 360G-riverbend." error={prefixError}>
                      <input className="inp mono" id={`${uid}-prefix`} value={prefix} placeholder="360G-" onChange={(e) => setPrefix(e.target.value)} autoComplete="off" spellCheck={false} aria-invalid={prefixError ? true : undefined} />
                    </Field>
                  </div>
                  <button type="submit" className="btn btn-secondary btn-sm" style={{ marginTop: "26px" }} disabled={busy !== null || prefix.trim() === savedPrefix}>
                    Save prefix
                  </button>
                </form>

                <div className="row" style={{ gap: "12px", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <div className="b" id={`${uid}-pub`}>
                      Publish my awards as open data
                    </div>
                    <div className="small muted" id={`${uid}-pub-d`}>
                      Off by default. When on, anyone can read your exported awards, all years, at a public address you can give to 360Giving, under the {d.license.name} licence.
                      {!d.settings.threeSixtyGivingPrefix && " Save your 360Giving prefix first."}
                    </div>
                  </div>
                  <button
                    type="button"
                    className={`tog${d.settings.publishFeed ? " on" : ""}`}
                    role="switch"
                    aria-checked={d.settings.publishFeed}
                    aria-labelledby={`${uid}-pub`}
                    aria-describedby={`${uid}-pub-d`}
                    disabled={busy !== null || (!d.settings.publishFeed && !d.settings.threeSixtyGivingPrefix)}
                    onClick={() => {
                      const on = !d.settings.publishFeed;
                      void act("publish", async () => {
                        await api.saveSettings({ publishFeed: on });
                        return on ? "Your awards are published as open data." : "Your awards are no longer published as open data.";
                      });
                    }}
                  ></button>
                </div>

                {d.feedUrl && (
                  <div className="row" style={{ alignItems: "flex-start", flexWrap: "wrap", gap: "10px" }}>
                    <div style={{ flex: "1 1 320px" }}>
                      <Field id={`${uid}-feed`} label="Public feed address" help="360Giving JSON, updated as your awards change. Give this address to 360Giving when you submit your data.">
                        <input className="inp mono" id={`${uid}-feed`} value={d.feedUrl} readOnly />
                      </Field>
                    </div>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      style={{ marginTop: "26px" }}
                      onClick={() =>
                        act("copy", async () => {
                          const copied = await copyText(d.feedUrl!);
                          return copied ? "Feed address copied." : "Select the address and copy it.";
                        })
                      }
                    >
                      <Copy className="ic" aria-hidden="true" />
                      Copy feed address
                    </button>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
