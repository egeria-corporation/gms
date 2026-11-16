// SPDX-License-Identifier: AGPL-3.0-only
// Panel: the ranking for a stage and the decisions made from it. The allocator meter is the one
// place the stage's money is summed: committed awards, plus the approvals typed here. While the
// approvals exceed what the program has left, Commit is disabled and says why; an admin can
// override with a reason, which is recorded.
import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { Check, FileText, Gavel, Lock, TriangleExclamationPoint } from "lucide-react";
import { useApiMutation, useApiQuery } from "../../api/hooks.ts";
import type { CommitResult, DecisionInput, DecisionOutcome, RankingRow } from "../../api/funder.ts";
import { useServices } from "../../app/services.tsx";
import { useWorkspace } from "../../app/workspace.tsx";
import { Dialog } from "../../components/Dialog.tsx";
import { FunderShell } from "../../components/shells.tsx";
import { StatusBadge } from "../../components/status.tsx";
import { EmptyState, ErrorBanner, Field, Loading, PageHeader } from "../../components/ui.tsx";
import { formatMinor, parseDollars } from "../../lib/format.ts";
import { DecisionSummary, PanelDetail, type DecisionTally } from "./PanelDetail.tsx";
import { DocketDialog } from "./ReviewParity.tsx";
import { t } from "./i18n.ts";

interface Draft {
  outcome: DecisionOutcome | "";
  amount: string;
}
const OUTCOMES = (): [DecisionOutcome, string][] => [
  ["approve", t("funderPanel.outcome.approve")],
  ["waitlist", t("funderPanel.outcome.waitlist")],
  ["decline", t("funderPanel.outcome.decline")],
];
const fmt = (n: number | null) => (n === null ? "—" : n.toFixed(1));

export default function Panel() {
  const ws = useWorkspace("funder");
  const base = `/w/${ws.handle}`;
  const { compId = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const { meState } = useServices();
  const isAdmin = meState.status === "ready" && meState.me.workspaces.find((w) => w.handle === ws.handle)?.role === "admin";
  const competition = useApiQuery((api) => api.getCompetition(compId), [compId]);
  const stageKey = params.get("stage") ?? undefined;
  const ranking = useApiQuery((api) => api.getRanking(compId, stageKey), [compId, stageKey]);
  const allocation = useApiQuery((api) => api.getAllocation(compId), [compId]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [override, setOverride] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<CommitResult | null>(null);
  const [docket, setDocket] = useState(false);

  useEffect(() => {
    if (!ranking.data) return;
    setDrafts(Object.fromEntries(ranking.data.items.map((r) => [r.applicationId, { outcome: r.decision?.outcome ?? "", amount: r.decision?.amountMinor ? String(r.decision.amountMinor / 100) : "" }])));
  }, [ranking.data]);

  const rows = ranking.data?.items ?? [];
  const openRows = rows.filter((r) => !r.decision?.committed);
  const inputs = useMemo((): { decisions: DecisionInput[]; problems: string[] } => {
    const decisions: DecisionInput[] = [];
    const problems: string[] = [];
    for (const r of openRows) {
      const d = drafts[r.applicationId];
      if (!d?.outcome) continue;
      if (d.outcome === "approve") {
        const minor = parseDollars(d.amount);
        if (minor === null || minor <= 0) {
          problems.push(t("funderPanel.problem.amountFor", { name: r.applicant ?? r.title }));
          continue;
        }
        decisions.push({ applicationId: r.applicationId, outcome: "approve", amountMinor: minor });
      } else decisions.push({ applicationId: r.applicationId, outcome: d.outcome });
    }
    return { decisions, problems };
  }, [drafts, openRows]);

  const a = allocation.data;
  const pendingMinor = inputs.decisions.reduce((n, d) => n + (d.outcome === "approve" ? (d.amountMinor ?? 0) : 0), 0);
  const budget = a?.budgetMinor ?? null;
  const committed = a?.committedMinor ?? 0;
  const remaining = budget === null ? null : budget - committed - pendingMinor;
  const over = remaining !== null && remaining < 0;
  const pct = (n: number) => (budget ? `${Math.min(100, Math.max(0, (n / budget) * 100))}%` : "0%");

  const propose = useApiMutation((api) => api.proposeDecisions(compId, inputs.decisions));
  const commit = useApiMutation(async (api) => {
    const proposed = await api.proposeDecisions(compId, inputs.decisions);
    return api.commitDecisions({ competitionId: compId, decisionIds: proposed.decisions.map((d) => d.id), ...(over && override.trim() ? { override: { reason: override.trim() } } : {}) });
  });
  const blocked = inputs.problems[0] ?? (inputs.decisions.length === 0 ? t("funderPanel.problem.noDecision") : over && !isAdmin ? t("funderPanel.problem.overAskAdmin", { amount: formatMinor(-remaining!) }) : over && !override.trim() ? t("funderPanel.problem.overGiveReason", { amount: formatMinor(-remaining!) }) : null);
  const setDraft = (id: string, patch: Partial<Draft>, row: RankingRow) =>
    setDrafts((d) => {
      const cur = d[id] ?? { outcome: "", amount: "" };
      const next = { ...cur, ...patch };
      if (patch.outcome === "approve" && !cur.amount && row.requestedAmountMinor) next.amount = String(row.requestedAmountMinor / 100);
      return { ...d, [id]: next };
    });
  const [focus, setFocus] = useState<string | null>(null);
  const focused = rows.find((r) => r.applicationId === focus) ?? rows[0];
  const tally: DecisionTally = {
    approve: inputs.decisions.filter((d) => d.outcome === "approve").length,
    decline: inputs.decisions.filter((d) => d.outcome === "decline").length,
    waitlist: inputs.decisions.filter((d) => d.outcome === "waitlist").length,
    approvedMinor: pendingMinor,
    undecided: Math.max(0, openRows.length - inputs.decisions.length - inputs.problems.length),
  };
  const reload = () => {
    ranking.reload();
    allocation.reload();
  };

  return (
    <>
      <title>{t("funderPanel.panel", { title: competition.data?.title ?? t("funderPanel.competition"), name: ws.name })}</title>
      <FunderShell active="Reviews">
        <main className="main">
          <PageHeader
            crumbs={[{ label: ws.name, to: base }, { label: competition.data?.title ?? t("funderPanel.competition"), to: `${base}/competitions/${compId}` }, { label: t("funderPanel.panel2") }]}
            title={t("funderPanel.panelAndDecisions")}
            meta={
              <>
                <span>{competition.data?.title}</span>
                {competition.data && ranking.data && (
                  <>
                    <span>·</span>
                    <label className="row">
                      {t("funderPanel.stage")}
                      <select className="sel" style={{ width: "auto", height: "28px" }} value={ranking.data.stage} onChange={(e) => setParams({ stage: e.target.value })}>
                        {competition.data.stages.map((s) => (
                          <option key={s.key} value={s.key}>
                            {s.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <span>·</span>
                    <span>
                      {t("funderPanel.v", { name: ranking.data.rubric.name, version: ranking.data.rubric.version })}
                    </span>
                  </>
                )}
              </>
            }
            actions={
              <>
                <Link to={`${base}/reviews/assign`} className="btn btn-secondary">
                  {t("funderPanel.reviewAssignments")}
                </Link>
                <button type="button" className="btn btn-secondary" aria-haspopup="dialog" disabled={!ranking.data} onClick={() => setDocket(true)}>
                  <FileText className="ic" aria-hidden="true" />
                  {t("funderPanel.boardDocket")}
                </button>
              </>
            }
          />

          <section className="card stick-head" aria-labelledby="alloc-h" style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: "12px" }}>
            <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: "12px" }}>
              <h2 id="alloc-h" style={{ fontSize: "16px" }}>
                {t("funderPanel.programHeadroom")}
              </h2>
              <div className="row">
                <button type="button" className="btn btn-secondary" disabled={propose.state === "saving" || inputs.decisions.length === 0 || inputs.problems.length > 0} onClick={async () => (await propose.run()) && reload()}>
                  {t("funderPanel.saveAsProposed")}
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={blocked !== null || commit.state === "saving"}
                  aria-describedby={blocked ? "commit-why" : undefined}
                  aria-haspopup="dialog"
                  onClick={() => setConfirming(true)}
                >
                  <Gavel className="ic" aria-hidden="true" />
                  {t("funderPanel.commitDecisions")}
                </button>
              </div>
            </div>
            {allocation.status === "error" && <ErrorBanner error={allocation.error} onRetry={allocation.reload} />}
            <div className={over ? "mtr mtr-over" : "mtr"} role="group" aria-label={t("funderPanel.programBudgetHeadroom")}>
              <div className="lbls">
                <span>
                  {t("funderPanel.available")} <b>{budget === null ? t("funderPanel.noProgramBudgetSet") : formatMinor(budget)}</b>
                </span>
                <span>
                  {t.rich("funderPanel.allocated", { amount: formatMinor(committed), b: (chunks) => <b>{chunks}</b> })}
                </span>
                <span>
                  {t.rich("funderPanel.pending", { amount: formatMinor(pendingMinor), b: (chunks) => <b>{chunks}</b> })}
                </span>
                <span>
                  {t("funderPanel.remaining")} <b>{remaining === null ? "—" : formatMinor(remaining)}</b>
                </span>
              </div>
              <div className="track">
                <div className="fill" style={{ width: pct(committed) }}></div>
                <div className="fill pend" style={{ width: pct(pendingMinor) }}></div>
              </div>
              {over && (
                <div className="over-msg" role="alert">
                  <TriangleExclamationPoint className="ic" aria-hidden="true" />
                  {t("funderPanel.overBudgetBy", { amount: formatMinor(-remaining!) })}
                </div>
              )}
            </div>
            {blocked && (
              <p className="small muted" id="commit-why">
                <Lock className="ic ic-sm" aria-hidden="true" /> {blocked}.
              </p>
            )}
            {over && isAdmin && (
              <Field id="override-reason" label={t("funderPanel.overrideReason")} help={t("funderPanel.recordedInTheLedger")}>
                <input className="inp" id="override-reason" value={override} onChange={(e) => setOverride(e.target.value)} />
              </Field>
            )}
            {(propose.error !== null || commit.error !== null) && <ErrorBanner error={commit.error ?? propose.error} />}
            {result && (
              <div className="bnr bnr-ok" role="status">
                <Check className="ic" aria-hidden="true" />
                <div>
                  <div className="t">
                    {t("funderPanel.decisionsCommitted", { count: result.committed })}
                  </div>
                  <div className="d">
                    {result.results
                      .filter((r) => r.awardId)
                      .map((r) => (
                        <Link key={r.decisionId} to={`${base}/awards/${r.awardId}/agreement`} style={{ marginRight: "12px" }}>
                          {t("funderPanel.openAwardFor", { name: rows.find((x) => x.applicationId === r.applicationId)?.applicant ?? t("funderPanel.theApplicant") })}
                        </Link>
                      ))}
                    {result.override && <span>{t("funderPanel.overrideRecorded", { reason: result.override.reason })}</span>}
                  </div>
                </div>
              </div>
            )}
          </section>

          {ranking.status === "loading" && <Loading label={t("funderPanel.loadingTheRanking")} />}
          {ranking.status === "error" && <ErrorBanner error={ranking.error} onRetry={ranking.reload} />}
          {ranking.status === "ready" && rows.length === 0 && (
            <EmptyState icon={Gavel} title={t("funderPanel.nothingToRankAt")}>
              {t("funderPanel.applicationsAppearHereOnce")}
            </EmptyState>
          )}
          {rows.length > 0 && (
            <div className="tbl-wrap" tabIndex={0} role="region" aria-label={t("funderPanel.rankingAndDecisionsScrollable")}>
              <table className="tbl" aria-label={t("funderPanel.rankingAndDecisions")}>
                <thead>
                  <tr>
                    <th style={{ width: "44px" }}>#</th>
                    <th>{t("funderPanel.applicant")}</th>
                    <th className="num">{t("funderPanel.requested")}</th>
                    <th className="num">{t("funderPanel.mean")}</th>
                    <th className="num">{t("funderPanel.median")}</th>
                    <th className="num">{t("funderPanel.spread")}</th>
                    <th className="num">{t("funderPanel.n")}</th>
                    <th className="num">{t("funderPanel.allocation")}</th>
                    <th>{t("funderPanel.decision2")}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const d = drafts[r.applicationId] ?? { outcome: "", amount: "" };
                    const name = r.applicant ?? r.title;
                    const locked = !!r.decision?.committed;
                    return (
                      <tr key={r.applicationId}>
                        <td>{r.rank === null ? <span className="muted">—</span> : <span className="rk">{r.rank}</span>}</td>
                        <td style={{ padding: "6px 12px" }}>
                          <div className="ent">
                            <Link to={`${base}/applications/${r.applicationId}`} className="nm">
                              {name}
                            </Link>
                            <span className="sub">
                              <span className="muted">{r.title}</span>
                              {r.pending > 0 && <span className="pill-warn">{t("funderPanel.reviewSPending", { pending: r.pending })}</span>}
                              <button type="button" className="btn btn-sm btn-ghost" aria-pressed={focused?.applicationId === r.applicationId} onClick={() => setFocus(r.applicationId)} aria-label={t("funderPanel.scoresNotesAndLetter", { name })}>
                                {t("funderPanel.scoresNotes")}
                              </button>
                            </span>
                          </div>
                        </td>
                        <td className="num">{formatMinor(r.requestedAmountMinor, r.currency)}</td>
                        <td className="num b">{fmt(r.mean)}</td>
                        <td className="num">{fmt(r.median)}</td>
                        <td className="num">
                          {r.spreadFlag ? (
                            <span className="row" style={{ gap: "4px", justifyContent: "flex-end", color: "#7A4A00", fontWeight: 700 }}>
                              <TriangleExclamationPoint className="ic ic-sm" aria-hidden="true" />
                              {fmt(r.stdev)} <span className="sr">{t("funderPanel.reviewersDisagree")}</span>
                            </span>
                          ) : (
                            fmt(r.stdev)
                          )}
                        </td>
                        <td className="num">{r.n}</td>
                        <td className="num">
                          {locked ? (
                            formatMinor(r.decision?.amountMinor ?? null)
                          ) : (
                            <input className="inp alloc" inputMode="decimal" aria-label={t("funderPanel.allocationFor", { name })} value={d.amount} disabled={d.outcome !== "approve"} onChange={(e) => setDraft(r.applicationId, { amount: e.target.value }, r)} />
                          )}
                        </td>
                        <td>
                          {locked ? (
                            <span className="row" style={{ gap: "6px" }}>
                              <StatusBadge kind="application" status={r.status} />
                              <span className="small muted">{t("funderPanel.committed2")}</span>
                            </span>
                          ) : (
                            <div className="seg" role="radiogroup" aria-label={t("funderPanel.decisionFor", { name })}>
                              {OUTCOMES().map(([value, label]) => (
                                <button key={value} type="button" role="radio" aria-checked={d.outcome === value} className={d.outcome === value ? "on" : undefined} onClick={() => setDraft(r.applicationId, { outcome: d.outcome === value ? "" : value }, r)}>
                                  {label}
                                </button>
                              ))}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {focused && ranking.data && (
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 2.2fr) minmax(0, 1fr)", gap: "20px", alignItems: "start" }}>
              <PanelDetail
                row={focused}
                stage={ranking.data.stage}
                rubricId={ranking.data.rubric.id}
                outcome={(drafts[focused.applicationId]?.outcome ?? "") as "approve" | "decline" | "waitlist" | ""}
                amountMinor={parseDollars(drafts[focused.applicationId]?.amount ?? "") ?? focused.decision?.amountMinor ?? null}
              />
              <DecisionSummary tally={tally} remainingMinor={remaining} />
            </div>
          )}
          <p className="notice">{t("funderPanel.spreadIsTheStandard")}</p>
          {confirming && (
            <Dialog open onClose={() => setConfirming(false)} labelledBy="commit-title">
              <div className="hd">
                <div>
                  <h2 id="commit-title" style={{ fontSize: "16px" }}>
                    {t("funderPanel.commit", { count: inputs.decisions.length })} {inputs.decisions.length === 1 ? t("funderPanel.decision") : t("funderPanel.decisions")}?
                  </h2>
                  <p className="small muted" style={{ marginTop: "4px" }}>
                    {t("funderPanel.decisionsAreFinalOnce")}
                  </p>
                </div>
              </div>
              <div className="bd" style={{ fontSize: "13px", gap: "8px" }}>
                {(
                  [
                    ["approve", (count: number) => t("funderPanel.effect.approve", { count })],
                    ["waitlist", (count: number) => t("funderPanel.effect.waitlist", { count })],
                    ["decline", (count: number) => t("funderPanel.effect.decline", { count })],
                  ] as const
                ).map(([outcome, effect]) => {
                  const n = inputs.decisions.filter((d) => d.outcome === outcome).length;
                  return n ? (
                    <div key={outcome} className="row" style={{ gap: "8px" }}>
                      <Check className="ic" aria-hidden="true" style={{ color: "var(--s-ok-fg)" }} />
                      {effect(n)}
                    </div>
                  ) : null;
                })}
                {pendingMinor > 0 && (
                  <div className="row" style={{ gap: "8px" }}>
                    <Check className="ic" aria-hidden="true" style={{ color: "var(--s-ok-fg)" }} />
                    {t("funderPanel.committedFromTheProgram", { amount: formatMinor(pendingMinor) })}
                  </div>
                )}
                {over && override.trim() && (
                  <div className="row" style={{ gap: "8px" }}>
                    <TriangleExclamationPoint className="ic" aria-hidden="true" style={{ color: "var(--s-warn-fg)" }} />
                    {t("funderPanel.overBudgetOverrideRecorded", { override: override.trim() })}
                  </div>
                )}
                <div className="row muted" style={{ gap: "8px" }}>
                  <Lock className="ic" aria-hidden="true" />
                  {t("funderPanel.loggedInTheAudit")}
                </div>
                {commit.error !== null && <ErrorBanner error={commit.error} />}
              </div>
              <div className="ft">
                <button type="button" className="btn btn-secondary" onClick={() => setConfirming(false)}>
                  {t("funderPanel.cancel")}
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={commit.state === "saving"}
                  onClick={async () => {
                    const r = await commit.run();
                    if (r) {
                      setConfirming(false);
                      setResult(r);
                      setOverride("");
                      reload();
                    }
                  }}
                >
                  <Gavel className="ic" aria-hidden="true" />
                  {t("funderPanel.commitDecisions")}
                </button>
              </div>
            </Dialog>
          )}
          {docket && ranking.data && <DocketDialog competitionId={compId} stage={ranking.data.stage} onClose={() => setDocket(false)} />}
        </main>
      </FunderShell>
    </>
  );
}
