// SPDX-License-Identifier: AGPL-3.0-only
// `/operator/measures` (F3, docs/measures.md): the growth measures for OpenGrants' operators. Nine
// numbers from the GMS's own database, each over the last 30 days with its 90-day target; a form
// to record a deal lost by its stated reason; and Google Search Console's clicks and impressions
// for the GMS's public pages, by kind of page. Counts only: nothing here names a person or an
// organization. Anyone who is not an operator is told so and sees no number.
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { ChartNoAxesColumn, CircleCheck, CircleMinus, ClipboardList, Hourglass, Plug, TrendingDown, Unplug } from "lucide-react";
import { LOST_DEAL_REASONS, type LostDealReason, type OperatorMeasures, type PageKind, type SearchConsoleReport, type SearchConsoleState } from "../../api/measures.ts";
import { useMeasuresMutation, useMeasuresQuery } from "../../api/measuresHooks.ts";
import { LanguageSwitcher } from "../../components/LanguageSwitcher.tsx";
import { ErrorBanner, Field, Loading, Notice } from "../../components/ui.tsx";
import { translator, useExtrasMessages } from "../../i18n/index.tsx";
import { formatDate } from "../../lib/format.ts";

const t = translator("extras");

type Look = "met" | "below" | "unknown" | "tracked";

function StatusPill({ look }: { look: Look }) {
  const map = {
    met: { cls: "bdg-ok", Icon: CircleCheck, label: t("measures.status.met") },
    below: { cls: "bdg-warn", Icon: TrendingDown, label: t("measures.status.below") },
    unknown: { cls: "bdg-neutral", Icon: Hourglass, label: t("measures.status.unknown") },
    tracked: { cls: "bdg-neutral", Icon: ClipboardList, label: t("measures.status.tracked") },
  }[look];
  return (
    <span className={`bdg ${map.cls}`} style={{ alignSelf: "flex-start" }}>
      <map.Icon className="ic" aria-hidden="true" />
      {map.label}
    </span>
  );
}

const lookOf = (value: number | null, met: boolean | null): Look => (value === null || met === null ? "unknown" : met ? "met" : "below");

function MeasureCard({ id, name, what, value, target, look, children }: { id: string; name: string; what: string; value: string; target: string; look: Look; children?: ReactNode }) {
  return (
    <li className="stat" aria-labelledby={`${id}-name`} style={{ gap: "8px" }}>
      <h2 id={`${id}-name`} className="stat-l" style={{ margin: 0 }}>
        {name}
      </h2>
      <span className="small muted">{what}</span>
      <span className="stat-v">{value}</span>
      <span className="stat-d">{target}</span>
      <StatusPill look={look} />
      {children && <div className="small muted">{children}</div>}
    </li>
  );
}

/** One decimal place at most (the server sends ratios to three). */
const one = (v: number) => Math.round(v * 10) / 10;
const pct = (v: number | null) => (v === null ? t("measures.noValue") : t("measures.percent", { value: v }));
const num = (v: number | null) => (v === null ? t("measures.noValue") : t("measures.number", { value: v }));

function organicNote(o: OperatorMeasures["organicVisits"]): string {
  switch (o.source) {
    case "search_console":
      return t("measures.organic.detail", { weekly: one(o.weeklyAverage ?? 0), impressions: o.impressions ?? 0 });
    case "not_configured":
      return t("measures.organic.notConfigured");
    case "not_connected":
      return t("measures.organic.notConnected");
    case "no_site":
      return t("measures.organic.noSite");
    default:
      return t("measures.organic.unavailable");
  }
}

function MeasureList({ m }: { m: OperatorMeasures }) {
  const perCall = m.newApplicantWorkspacesPerCall;
  const kit = m.shareKit;
  const o = m.organicVisits;
  const inv = m.invitedTeammatesJoined;
  return (
    <ul aria-label={t("measures.listLabel")} style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: "16px" }}>
      <MeasureCard id="m1" name={t("measures.m1.name")} what={t("measures.m1.what")} value={num(m.fundersWithOpenCall.value)} target={t("measures.target", { target: m.fundersWithOpenCall.target })} look={lookOf(m.fundersWithOpenCall.value, m.fundersWithOpenCall.met)} />
      <MeasureCard id="m2" name={t("measures.m2.name")} what={t("measures.m2.what")} value={num(m.activeApplicantWorkspaces.value)} target={t("measures.target", { target: m.activeApplicantWorkspaces.target })} look={lookOf(m.activeApplicantWorkspaces.value, m.activeApplicantWorkspaces.met)} />
      <MeasureCard id="m3" name={t("measures.m3.name")} what={t("measures.m3.what")} value={perCall.value === null ? t("measures.noValue") : t("measures.decimal", { value: one(perCall.value) })} target={t("measures.targetOrMore", { target: perCall.target })} look={lookOf(perCall.value, perCall.met)}>
        {perCall.callsPublished === 0 ? t("measures.m3.noCalls") : t("measures.m3.detail", { workspaces: perCall.newApplicantWorkspaces, calls: perCall.callsPublished })}
      </MeasureCard>
      <MeasureCard id="m4" name={t("measures.m4.name")} what={t("measures.m4.what")} value={num(m.fundersJoinedFromApplicantLinks.value)} target={t("measures.target", { target: m.fundersJoinedFromApplicantLinks.target })} look={lookOf(m.fundersJoinedFromApplicantLinks.value, m.fundersJoinedFromApplicantLinks.met)}>
        {t("measures.m4.detail")}
      </MeasureCard>
      <MeasureCard id="m5" name={t("measures.m5.name", { days: m.switchedFundersWithCall.withinDays })} what={t("measures.m5.what")} value={num(m.switchedFundersWithCall.value)} target={t("measures.target", { target: m.switchedFundersWithCall.target })} look={lookOf(m.switchedFundersWithCall.value, m.switchedFundersWithCall.met)} />
      <MeasureCard id="m6" name={t("measures.m6.name")} what={t("measures.m6.what")} value={pct(kit.value)} target={t("measures.targetShare", { target: kit.target })} look={lookOf(kit.value, kit.met)}>
        {kit.awardsEligible === 0 ? t("measures.m6.noAwards") : t("measures.m6.detail", { shared: kit.awardsShared, eligible: kit.awardsEligible })}{" "}
        {kit.clicksPerPost === null ? t("measures.m6.noClicks", { posts: kit.posts }) : t("measures.m6.clicks", { posts: kit.posts, clicks: kit.clicks, perPost: one(kit.clicksPerPost) })}
      </MeasureCard>
      <MeasureCard id="m7" name={t("measures.m7.name")} what={t("measures.m7.what")} value={num(o.value)} target={o.target.value === null ? t("measures.m7.targetLater", { multiple: o.target.multiple }) : t("measures.m7.target", { multiple: o.target.multiple, target: o.target.value })} look={o.source !== "search_console" ? "unknown" : lookOf(o.value, o.met)}>
        {organicNote(o)}
      </MeasureCard>
      <MeasureCard id="m8" name={t("measures.m8.name")} what={t("measures.m8.what")} value={pct(inv.value)} target={t("measures.targetShare", { target: inv.target })} look={lookOf(inv.value, inv.met)}>
        {inv.sent === 0 ? t("measures.m8.noInvitations") : t("measures.m8.detail", { accepted: inv.accepted, sent: inv.sent })}
      </MeasureCard>
      <MeasureCard id="m9" name={t("measures.m9.name")} what={t("measures.m9.what")} value={num(m.dealsLost.total)} target={t("measures.m9.target")} look="tracked">
        {t("measures.m9.detail")}
      </MeasureCard>
    </ul>
  );
}

/** Each reason's words, looked up when shown (never a table built once, which would keep one language). */
function reasonLabel(r: LostDealReason): string {
  switch (r) {
    case "forms":
      return t("measures.reason.forms");
    case "reviews":
      return t("measures.reason.reviews");
    case "reporting":
      return t("measures.reason.reporting");
    case "payments":
      return t("measures.reason.payments");
    case "procurement":
      return t("measures.reason.procurement");
    case "languages":
      return t("measures.reason.languages");
    case "integrations":
      return t("measures.reason.integrations");
    case "data_migration":
      return t("measures.reason.data_migration");
    case "support":
      return t("measures.reason.support");
    case "went_elsewhere":
      return t("measures.reason.went_elsewhere");
    case "timing":
      return t("measures.reason.timing");
    case "no_decision":
      return t("measures.reason.no_decision");
    default:
      return t("measures.reason.other");
  }
}

function LostDeals({ m, onRecorded }: { m: OperatorMeasures; onRecorded: () => void }) {
  const today = new Date().toISOString().slice(0, 10);
  const [reason, setReason] = useState<LostDealReason>("forms");
  const [lostOn, setLostOn] = useState(today);
  const [done, setDone] = useState<string | null>(null);
  const record = useMeasuresMutation((api, input: { reason: LostDealReason; lostOn: string }) => api.recordLostDeal(input));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setDone(null);
    const r = await record.run({ reason, lostOn });
    if (r) {
      setDone(t("measures.lost.done", { reason: reasonLabel(r.reason) }));
      onRecorded();
    }
  };
  const rows = m.dealsLost.byReason.filter((x) => x.count > 0);
  return (
    <section className="card" aria-labelledby="lost-title">
      <div className="card-h">
        <h2 id="lost-title" style={{ fontSize: "17px", margin: 0 }}>
          {t("measures.lost.title")}
        </h2>
      </div>
      <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        <p className="muted" style={{ margin: 0 }}>
          {t("measures.lost.help")}
        </p>
        {record.error !== null && <ErrorBanner error={record.error} />}
        {done && <Notice tone="ok" title={done} />}
        <form onSubmit={submit} style={{ display: "flex", gap: "16px", flexWrap: "wrap", alignItems: "flex-end" }}>
          <div style={{ flex: "2 1 280px" }}>
            <Field id="lost-reason" label={t("measures.lost.reason")}>
              <select id="lost-reason" className="sel" value={reason} onChange={(e) => setReason(e.target.value as LostDealReason)}>
                {LOST_DEAL_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {reasonLabel(r)}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div style={{ flex: "1 1 160px" }}>
            <Field id="lost-day" label={t("measures.lost.day")}>
              <input id="lost-day" className="inp" type="date" value={lostOn} max={today} onChange={(e) => setLostOn(e.target.value)} />
            </Field>
          </div>
          <div className="fld">
            <button type="submit" className="btn btn-primary" disabled={record.state === "saving" || !lostOn}>
              <ClipboardList className="ic" aria-hidden="true" />
              {t("measures.lost.record")}
            </button>
          </div>
        </form>
        <div className="tbl-wrap" tabIndex={0} role="region" aria-label={t("measures.lost.byReason")}>
          <table className="tbl">
            <caption className="sr">{t("measures.lost.byReason")}</caption>
            <thead>
              <tr>
                <th scope="col">{t("measures.lost.colReason")}</th>
                <th scope="col">{t("measures.lost.colCount")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={2}>{t("measures.lost.none")}</td>
                </tr>
              ) : (
                rows.map((x) => (
                  <tr key={x.reason}>
                    <td>{reasonLabel(x.reason)}</td>
                    <td>{t("measures.number", { value: x.count })}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function kindLabel(k: PageKind): string {
  switch (k) {
    case "home":
      return t("measures.kind.home");
    case "funder":
      return t("measures.kind.funder");
    case "opportunity":
      return t("measures.kind.opportunity");
    case "fund":
      return t("measures.kind.fund");
    case "awards":
      return t("measures.kind.awards");
    case "award":
      return t("measures.kind.award");
    case "switch":
      return t("measures.kind.switch");
    case "templates":
      return t("measures.kind.templates");
    case "for_funders":
      return t("measures.kind.for_funders");
    case "partners":
      return t("measures.kind.partners");
    default:
      return t("measures.kind.other");
  }
}

function problemLabel(p: NonNullable<SearchConsoleState["problem"]>): string {
  if (p === "too_broad") return t("measures.sc.problem.too_broad");
  if (p === "unreachable") return t("measures.sc.problem.unreachable");
  return t("measures.sc.problem.reconnect");
}

function Report({ report }: { report: SearchConsoleReport }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      <p className="small muted" style={{ margin: 0 }}>
        {t("measures.sc.range", { start: formatDate(report.range.start), end: formatDate(report.range.end) })}
      </p>
      <p style={{ margin: 0, fontWeight: 700 }}>{t("measures.sc.totals", { clicks: report.totals.clicks, impressions: report.totals.impressions })}</p>
      <div className="tbl-wrap" tabIndex={0} role="region" aria-label={t("measures.sc.byKind")}>
        <table className="tbl">
          <caption className="sr">{t("measures.sc.byKind")}</caption>
          <thead>
            <tr>
              <th scope="col">{t("measures.sc.colKind")}</th>
              <th scope="col">{t("measures.sc.colClicks")}</th>
              <th scope="col">{t("measures.sc.colImpressions")}</th>
            </tr>
          </thead>
          <tbody>
            {report.pages.length === 0 ? (
              <tr>
                <td colSpan={3}>{t("measures.sc.noPages")}</td>
              </tr>
            ) : (
              report.pages.map((p) => (
                <tr key={p.kind}>
                  <td>{kindLabel(p.kind)}</td>
                  <td>{t("measures.number", { value: p.clicks })}</td>
                  <td>{t("measures.number", { value: p.impressions })}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SearchConsole({ onChanged }: { onChanged: () => void }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [version, setVersion] = useState(0);
  const state = useMeasuresQuery((api) => api.searchConsole(), [version]);
  const connect = useMeasuresMutation((api) => api.connectSearchConsole());
  const disconnect = useMeasuresMutation((api) => api.disconnectSearchConsole());
  const choose = useMeasuresMutation((api, siteUrl: string) => api.chooseSite(siteUrl));
  const site = state.status === "ready" ? state.data.site : null;
  const connected = state.status === "ready" && state.data.connected;
  const report = useMeasuresQuery((api) => (connected && site ? api.searchConsoleReport() : Promise.resolve(null)), [connected, site, version]);
  const [pick, setPick] = useState("");
  const back = useRef(new URLSearchParams(location.search).get("connected") === "google_search_console");
  const changed = () => {
    setVersion((n) => n + 1);
    onChanged();
  };
  const run = connect.run;
  // Back from the Google sign-in: ask once whether the connection is now there, then tidy the address.
  useEffect(() => {
    if (!back.current) return;
    back.current = false;
    void run().then(() => {
      changed();
      navigate(location.pathname, { replace: true });
    });
  }, [run]);

  if (state.status === "loading") return <Loading label={t("measures.sc.loading")} />;
  if (state.status === "error") return <ErrorBanner error={state.error} onRetry={state.reload} />;
  const s: SearchConsoleState = state.data;
  // Hidden until the server has its auth config (COMPOSIO_SEARCH_CONSOLE_AUTH_CONFIG_ID).
  if (!s.available) return null;
  const start = async () => {
    const next = await connect.run();
    if (!next) return;
    if (!next.connected && next.connectUrl) window.location.assign(next.connectUrl);
    else changed();
  };
  const stop = async () => {
    if (await disconnect.run()) changed();
  };
  const use = async (e: FormEvent) => {
    e.preventDefault();
    const value = pick || s.sites[0]?.siteUrl;
    if (value && (await choose.run(value))) changed();
  };
  const busy = connect.state === "saving" || disconnect.state === "saving" || choose.state === "saving";
  return (
    <section className="card" aria-labelledby="sc-title">
      <div className="card-h" style={{ flexWrap: "wrap" }}>
        <h2 id="sc-title" style={{ fontSize: "17px", margin: 0 }} className="row">
          <ChartNoAxesColumn className="ic" aria-hidden="true" />
          {t("measures.sc.title")}
        </h2>
        <span className={`bdg ${s.connected ? "bdg-ok" : "bdg-neutral"}`}>
          {s.connected ? <CircleCheck className="ic" aria-hidden="true" /> : <CircleMinus className="ic" aria-hidden="true" />}
          {s.connected ? t("measures.sc.connected") : t("measures.sc.notConnected")}
        </span>
      </div>
      <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        <p className="muted" style={{ margin: 0 }}>
          {t("measures.sc.intro")}
        </p>
        {(connect.error ?? disconnect.error ?? choose.error) !== null && <ErrorBanner error={connect.error ?? disconnect.error ?? choose.error} />}
        {s.problem && <Notice tone="warn" title={problemLabel(s.problem)} />}
        {!s.connected && (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px", alignItems: "flex-start" }}>
            <button type="button" className="btn btn-primary" onClick={start} disabled={busy}>
              <Plug className="ic" aria-hidden="true" />
              {t("measures.sc.connect")}
            </button>
            <span className="help">{t("measures.sc.connectHelp")}</span>
          </div>
        )}
        {s.connected && s.sites.length === 0 && <Notice tone="warn" title={t("measures.sc.noProperty")} />}
        {s.connected && s.sites.length > 0 && (
          <form onSubmit={use} style={{ display: "flex", gap: "16px", flexWrap: "wrap", alignItems: "flex-end" }}>
            <div style={{ flex: "1 1 280px" }}>
              <Field id="sc-site" label={t("measures.sc.property")} help={t("measures.sc.propertyHelp")}>
                <select id="sc-site" className="sel" value={pick || site || s.sites[0]!.siteUrl} onChange={(e) => setPick(e.target.value)}>
                  {s.sites.map((x) => (
                    <option key={x.siteUrl} value={x.siteUrl}>
                      {x.siteUrl}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <div className="fld">
              <button type="submit" className="btn btn-secondary" disabled={busy}>
                {t("measures.sc.choose")}
              </button>
            </div>
          </form>
        )}
        {s.connected && site && (
          <>
            <p style={{ margin: 0 }}>{t("measures.sc.reading", { site })}</p>
            {report.status === "loading" && <Loading label={t("measures.sc.loadingReport")} />}
            {report.status === "error" && <ErrorBanner error={report.error} onRetry={report.reload} />}
            {report.status === "ready" && report.data && <Report report={report.data} />}
          </>
        )}
      </div>
      {s.connected && (
        <div className="card-f" style={{ justifyContent: "flex-end" }}>
          <button type="button" className="btn btn-secondary" onClick={stop} disabled={busy}>
            <Unplug className="ic" aria-hidden="true" />
            {t("measures.sc.disconnect")}
          </button>
        </div>
      )}
    </section>
  );
}

function Dashboard() {
  const [version, setVersion] = useState(0);
  const m = useMeasuresQuery((api) => api.measures(), [version]);
  const reload = () => setVersion((n) => n + 1);
  return (
    <>
      <p className="muted" style={{ margin: 0 }}>
        {t("measures.intro")}
      </p>
      {m.status === "loading" && <Loading label={t("measures.loading")} />}
      {m.status === "error" && <ErrorBanner error={m.error} onRetry={m.reload} />}
      {m.status === "ready" && (
        <>
          <p className="small muted" style={{ margin: 0 }}>
            {t("measures.window", { from: formatDate(m.data.window.from), to: formatDate(m.data.window.to) })}
          </p>
          <MeasureList m={m.data} />
          <LostDeals m={m.data} onRecorded={reload} />
        </>
      )}
      <SearchConsole onChanged={reload} />
    </>
  );
}

export default function Measures() {
  useExtrasMessages();
  const op = useMeasuresQuery((api) => api.isOperator(), []);
  return (
    <div className="gms pub gms-frame" style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>
      <title>{t("measures.pageTitle")}</title>
      <header style={{ borderBottom: "1px solid var(--og-gray-200)", background: "var(--og-white)" }}>
        <div className="wrap-c" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "24px", minHeight: "64px", flexWrap: "wrap" }}>
          <Link to="/" style={{ display: "flex", alignItems: "center", gap: "10px", textDecoration: "none", fontFamily: "var(--font-display)", fontWeight: 700, color: "var(--og-navy-dark)", fontSize: "16px" }}>
            <img src="/brand/opengrants-logo-black.png" alt="OpenGrants" style={{ height: "22px", width: "auto", display: "block" }} />
            <span style={{ color: "var(--og-teal-dark)", fontWeight: 500 }}>GMS</span>
          </Link>
          <nav aria-label={t("measures.nav")}>
            <Link to="/workspaces" className="btn btn-secondary">
              {t("measures.yourWorkspaces")}
            </Link>
          </nav>
        </div>
      </header>
      <main style={{ flex: 1 }}>
        <div className="wrap-c" style={{ display: "flex", flexDirection: "column", gap: "20px", paddingTop: "28px", paddingBottom: "48px" }}>
          <h1 style={{ fontSize: "28px", color: "var(--og-navy-dark)" }} className="row">
            <ChartNoAxesColumn className="ic ic-lg" aria-hidden="true" />
            {t("measures.title")}
          </h1>
          {op.status === "loading" && <Loading />}
          {op.status === "error" && <ErrorBanner error={op.error} onRetry={op.reload} />}
          {op.status === "ready" && !op.data && (
            <Notice tone="neu" title={t("measures.onlyOperators")}>
              {t("measures.onlyOperatorsNote")}
            </Notice>
          )}
          {op.status === "ready" && op.data && <Dashboard />}
        </div>
      </main>
      <footer className="pub-foot">
        <div className="wrap-c lang-row">
          <LanguageSwitcher />
        </div>
      </footer>
    </div>
  );
}

