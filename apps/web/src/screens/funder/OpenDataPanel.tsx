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
import { t } from "./i18n.ts";

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
        {t("openDataPanel.exported")}
      </span>
    );
  if (row.exported)
    return (
      <span className="bdg bdg-info">
        <UserRound className="ic" aria-hidden="true" />
        {t("openDataPanel.exportedNameOnly")}
      </span>
    );
  const Icon = row.reason === "confidential" ? Lock : CircleMinus;
  return (
    <span className="bdg bdg-neutral">
      <Icon className="ic" aria-hidden="true" />
      {t("openDataPanel.leftOut")} {row.reasonLabel ?? t("openDataPanel.notExported")}
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
          {t("openDataPanel.openData")}
        </h3>
        <span className="small muted">{t("openDataPanel.n360givingDataStandardAnd")}</span>
      </div>
      <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        <p className="small muted" style={{ margin: 0 }}>
          {t("openDataPanel.shareYourGrantsAs")}
        </p>

        <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", alignItems: "flex-end" }}>
          <div style={{ minWidth: "200px" }}>
            <Field id={`${uid}-period`} label={t("openDataPanel.period")}>
              <select
                className="sel"
                id={`${uid}-period`}
                value={periodValue(period)}
                onChange={(e) => {
                  const v = e.target.value;
                  setPeriod(v === "all" ? { kind: "all" } : v === "custom" ? { kind: "custom", from: `${thisYear}-01-01`, to: `${thisYear}-12-31` } : { kind: "year", year: Number(v) });
                }}
              >
                <option value="all">{t("openDataPanel.allYears")}</option>
                {years.map((y) => (
                  <option key={y} value={String(y)}>
                    {t("openDataPanel.awardsMadeIn", { y })}
                  </option>
                ))}
                <option value="custom">{t("openDataPanel.aDateRange")}</option>
              </select>
            </Field>
          </div>
          {period.kind === "custom" && (
            <>
              <Field id={`${uid}-from`} label={t("openDataPanel.from")}>
                <input className="inp" type="date" id={`${uid}-from`} value={period.from} onChange={(e) => setPeriod({ ...period, from: e.target.value })} />
              </Field>
              <Field id={`${uid}-to`} label={t("openDataPanel.to")}>
                <input className="inp" type="date" id={`${uid}-to`} value={period.to} onChange={(e) => setPeriod({ ...period, to: e.target.value })} />
              </Field>
            </>
          )}
        </div>

        {state.status === "loading" && <Loading label={t("openDataPanel.countingAwards")} />}
        {state.status === "error" && <ErrorBanner error={state.error} onRetry={reload} title={t("openDataPanel.theOpenDataSummary")} />}
        {note && <Notice tone="ok" title={note} />}
        {actionError !== null && <ErrorBanner error={actionError} />}

        {d && (
          <>
            {d.draft && (
              <Notice tone="warn" title={t("openDataPanel.theseFilesAreDrafts")}>
                {t("openDataPanel.untilYouAddYour")}{" "}
                <a href={d.registerUrl} target="_blank" rel="noreferrer noopener">
                  {t("openDataPanel.howToRegisterAs")}
                  <ExternalLink className="ic ic-sm" aria-hidden="true" style={{ marginLeft: "4px" }} />
                </a>
              </Notice>
            )}

            <div role="group" aria-label={t("openDataPanel.whatTheExportHolds")} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "12px" }}>
              <div className="stat">
                <span className="stat-l">{t("openDataPanel.willBeExported")}</span>
                <span className="stat-v">{d.counts.exported}</span>
                <span className="stat-d">{t("openDataPanel.ofAwardsInThe", { inRange: d.counts.inRange })}</span>
              </div>
              <div className="stat">
                <span className="stat-l">{t("openDataPanel.leftOut2")}</span>
                <span className="stat-v">{d.counts.leftOut}</span>
              </div>
              <div className="stat">
                <span className="stat-l">{t("openDataPanel.namedOnly")}</span>
                <span className="stat-v">{d.counts.nameOnly}</span>
                <span className="stat-d">{t("openDataPanel.notVerifiedAndShared")}</span>
              </div>
              <div className="stat">
                <span className="stat-l">{t("openDataPanel.commongrantsRecords")}</span>
                <span className="stat-v">{d.commonGrants.opportunities + d.commonGrants.awards}</span>
                <span className="stat-d">
                  {d.commonGrants.opportunities} {d.commonGrants.opportunities === 1 ? t("openDataPanel.opportunity") : t("openDataPanel.opportunities")}, {d.commonGrants.awards} {d.commonGrants.awards === 1 ? t("openDataPanel.award") : t("openDataPanel.awards")}
                </span>
              </div>
            </div>

            {d.leftOut.length > 0 && (
              <div>
                <h4 className="lbl" id={`${uid}-out`} style={{ marginBottom: "6px" }}>
                  {t("openDataPanel.leftOutAndWhy")}
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
                  {t("openDataPanel.download", { label })}
                </button>
              ))}
              {d.counts.exported === 0 && <span className="small muted">{t("openDataPanel.nothingInThisPeriod")}</span>}
            </div>

            {d.awards.length > 0 && (
              <details>
                <summary className="b" style={{ cursor: "pointer" }}>
                  {t("openDataPanel.awardsInThisPeriod", { inRange: d.counts.inRange })}
                </summary>
                <div className="tbl-wrap" tabIndex={0} role="region" aria-label={t("openDataPanel.awardsInThisPeriod2")} style={{ marginTop: "10px" }}>
                  <table className="tbl" aria-label={t("openDataPanel.awardsInThisPeriod3")}>
                    <thead>
                      <tr>
                        <th>{t("openDataPanel.award2")}</th>
                        <th>{t("openDataPanel.recipient")}</th>
                        <th>{t("openDataPanel.amount")}</th>
                        <th>{t("openDataPanel.awardDate")}</th>
                        <th>{t("openDataPanel.openData")}</th>
                        {isStaff && <th>{t("openDataPanel.confidential")}</th>}
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
                                  aria-label={t("openDataPanel.keepConfidential", { title: a.title })}
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
                                <span className="muted">
                                  <span aria-hidden="true">—</span>
                                  <span className="sr">{t("openDataPanel.notExportedAnyway")}</span>
                                </span>
                              )}
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {d.awardsShown < d.counts.inRange && <p className="small muted">{t("openDataPanel.theFirstAwardsAre", { awardsShown: d.awardsShown, inRange: d.counts.inRange })}</p>}
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
                    <Field id={`${uid}-prefix`} label={t("openDataPanel.n360givingPublisherPrefix")} help={t("openDataPanel.thePrefix360givingGave")} error={prefixError}>
                      <input className="inp mono" id={`${uid}-prefix`} value={prefix} placeholder={t("openDataPanel.n360g")} onChange={(e) => setPrefix(e.target.value)} autoComplete="off" spellCheck={false} aria-invalid={prefixError ? true : undefined} />
                    </Field>
                  </div>
                  <button type="submit" className="btn btn-secondary btn-sm" style={{ marginTop: "26px" }} disabled={busy !== null || prefix.trim() === savedPrefix}>
                    {t("openDataPanel.savePrefix")}
                  </button>
                </form>

                <div className="row" style={{ gap: "12px", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <div className="b" id={`${uid}-pub`}>
                      {t("openDataPanel.publishMyAwardsAs")}
                    </div>
                    <div className="small muted" id={`${uid}-pub-d`}>
                      {t("openDataPanel.offByDefaultWhen", { name: d.license.name })}
                      {!d.settings.threeSixtyGivingPrefix && t("openDataPanel.saveYour360givingPrefix")}
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
                      <Field id={`${uid}-feed`} label={t("openDataPanel.publicFeedAddress")} help={t("openDataPanel.n360givingJsonUpdatedAs")}>
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
                      {t("openDataPanel.copyFeedAddress")}
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
