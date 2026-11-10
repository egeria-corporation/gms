// SPDX-License-Identifier: AGPL-3.0-only
// Panel: the ranking for a stage and the decisions made from it. The allocator meter is the one
// place the stage's money is summed: committed awards, plus the approvals typed here. While the
// approvals exceed what the program has left, Commit is disabled and says why; an admin can
// override with a reason, which is recorded.
import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { Check, Gavel, Lock, TriangleExclamationPoint } from "lucide-react";
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

interface Draft {
  outcome: DecisionOutcome | "";
  amount: string;
}
const OUTCOMES: [DecisionOutcome, string][] = [
  ["approve", "Approve"],
  ["waitlist", "Waitlist"],
  ["decline", "Decline"],
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
          problems.push(`Enter an amount for ${r.applicant ?? r.title}`);
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
  const blocked = inputs.problems[0] ?? (inputs.decisions.length === 0 ? "Choose a decision for at least one application" : over && !isAdmin ? `Approvals exceed the program budget by ${formatMinor(-remaining!)}. Lower an allocation, or ask an admin to override` : over && !override.trim() ? `Approvals exceed the program budget by ${formatMinor(-remaining!)}. Give a reason to override` : null);
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
      <title>{`Panel — ${competition.data?.title ?? "Competition"} — ${ws.name}`}</title>
      <FunderShell active="Reviews">
        <main className="main">
          <PageHeader
            crumbs={[{ label: ws.name, to: base }, { label: competition.data?.title ?? "Competition", to: `${base}/competitions/${compId}` }, { label: "Panel" }]}
            title="Panel and decisions"
            meta={
              <>
                <span>{competition.data?.title}</span>
                {competition.data && ranking.data && (
                  <>
                    <span>·</span>
                    <label className="row">
                      Stage
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
                      {ranking.data.rubric.name} v{ranking.data.rubric.version}
                    </span>
                  </>
                )}
              </>
            }
            actions={
              <Link to={`${base}/reviews/assign`} className="btn btn-secondary">
                Review assignments
              </Link>
            }
          />

          <section className="card" aria-labelledby="alloc-h" style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: "12px", position: "sticky", top: 0, zIndex: 2 }}>
            <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: "12px" }}>
              <h2 id="alloc-h" style={{ fontSize: "16px" }}>
                Program headroom
              </h2>
              <div className="row">
                <button type="button" className="btn btn-secondary" disabled={propose.state === "saving" || inputs.decisions.length === 0 || inputs.problems.length > 0} onClick={async () => (await propose.run()) && reload()}>
                  Save as proposed
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
                  Commit decisions
                </button>
              </div>
            </div>
            {allocation.status === "error" && <ErrorBanner error={allocation.error} onRetry={allocation.reload} />}
            <div className={over ? "mtr mtr-over" : "mtr"} role="group" aria-label="Program budget headroom">
              <div className="lbls">
                <span>
                  Available <b>{budget === null ? "No program budget set" : formatMinor(budget)}</b>
                </span>
                <span>
                  Allocated <b>{formatMinor(committed)}</b>
                </span>
                <span>
                  Pending <b>{formatMinor(pendingMinor)}</b>
                </span>
                <span>
                  Remaining <b>{remaining === null ? "—" : formatMinor(remaining)}</b>
                </span>
              </div>
              <div className="track">
                <div className="fill" style={{ width: pct(committed) }}></div>
                <div className="fill pend" style={{ width: pct(pendingMinor) }}></div>
              </div>
              {over && (
                <div className="over-msg" role="alert">
                  <TriangleExclamationPoint className="ic" aria-hidden="true" />
                  Over budget by {formatMinor(-remaining!)}
                </div>
              )}
            </div>
            {blocked && (
              <p className="small muted" id="commit-why">
                <Lock className="ic ic-sm" aria-hidden="true" /> {blocked}.
              </p>
            )}
            {over && isAdmin && (
              <Field id="override-reason" label="Override reason" help="Recorded in the ledger with your name and the amount over.">
                <input className="inp" id="override-reason" value={override} onChange={(e) => setOverride(e.target.value)} />
              </Field>
            )}
            {(propose.error !== null || commit.error !== null) && <ErrorBanner error={commit.error ?? propose.error} />}
            {result && (
              <div className="bnr bnr-ok" role="status">
                <Check className="ic" aria-hidden="true" />
                <div>
                  <div className="t">
                    {result.committed} {result.committed === 1 ? "decision" : "decisions"} committed
                  </div>
                  <div className="d">
                    {result.results
                      .filter((r) => r.awardId)
                      .map((r) => (
                        <Link key={r.decisionId} to={`${base}/awards/${r.awardId}/agreement`} style={{ marginRight: "12px" }}>
                          Open award for {rows.find((x) => x.applicationId === r.applicationId)?.applicant ?? "the applicant"}
                        </Link>
                      ))}
                    {result.override && <span>Override recorded: {result.override.reason}</span>}
                  </div>
                </div>
              </div>
            )}
          </section>

          {ranking.status === "loading" && <Loading label="Loading the ranking" />}
          {ranking.status === "error" && <ErrorBanner error={ranking.error} onRetry={ranking.reload} />}
          {ranking.status === "ready" && rows.length === 0 && (
            <EmptyState icon={Gavel} title="Nothing to rank at this stage">
              Applications appear here once they reach this stage.
            </EmptyState>
          )}
          {rows.length > 0 && (
            <div className="tbl-wrap" tabIndex={0} role="region" aria-label="Ranking and decisions, scrollable">
              <table className="tbl" aria-label="Ranking and decisions">
                <thead>
                  <tr>
                    <th style={{ width: "44px" }}>#</th>
                    <th>Applicant</th>
                    <th className="num">Requested</th>
                    <th className="num">Mean</th>
                    <th className="num">Median</th>
                    <th className="num">Spread</th>
                    <th className="num">n</th>
                    <th className="num">Allocation</th>
                    <th>Decision</th>
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
                              {r.pending > 0 && <span className="pill-warn">{r.pending} review(s) pending</span>}
                              <button type="button" className="btn btn-sm btn-ghost" aria-pressed={focused?.applicationId === r.applicationId} onClick={() => setFocus(r.applicationId)} aria-label={`Scores, notes and letter for ${name}`}>
                                Scores &amp; notes
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
                              {fmt(r.stdev)} <span className="sr">reviewers disagree</span>
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
                            <input className="inp alloc" inputMode="decimal" aria-label={`Allocation for ${name}`} value={d.amount} disabled={d.outcome !== "approve"} onChange={(e) => setDraft(r.applicationId, { amount: e.target.value }, r)} />
                          )}
                        </td>
                        <td>
                          {locked ? (
                            <span className="row" style={{ gap: "6px" }}>
                              <StatusBadge kind="application" status={r.status} />
                              <span className="small muted">Committed</span>
                            </span>
                          ) : (
                            <div className="seg" role="radiogroup" aria-label={`Decision for ${name}`}>
                              {OUTCOMES.map(([value, label]) => (
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
          <p className="notice">Spread is the standard deviation of reviewers’ overall scores (0–100); a flag means they disagree by more than the rubric’s threshold.</p>
          {confirming && (
            <Dialog open onClose={() => setConfirming(false)} labelledBy="commit-title">
              <div className="hd">
                <div>
                  <h2 id="commit-title" style={{ fontSize: "16px" }}>
                    Commit {inputs.decisions.length} {inputs.decisions.length === 1 ? "decision" : "decisions"}?
                  </h2>
                  <p className="small muted" style={{ marginTop: "4px" }}>
                    Decisions are final once committed. Each approval creates an award in Offered with its agreement draft, and every applicant gets a letter.
                  </p>
                </div>
              </div>
              <div className="bd" style={{ fontSize: "13px", gap: "8px" }}>
                {(
                  [
                    ["approve", "approved", "an award is created (Offered)"],
                    ["waitlist", "waitlisted", "status only"],
                    ["decline", "declined", "a decline letter is sent"],
                  ] as const
                ).map(([outcome, word, effect]) => {
                  const n = inputs.decisions.filter((d) => d.outcome === outcome).length;
                  return n ? (
                    <div key={outcome} className="row" style={{ gap: "8px" }}>
                      <Check className="ic" aria-hidden="true" style={{ color: "var(--s-ok-fg)" }} />
                      {n} {word} · {effect}
                    </div>
                  ) : null;
                })}
                {pendingMinor > 0 && (
                  <div className="row" style={{ gap: "8px" }}>
                    <Check className="ic" aria-hidden="true" style={{ color: "var(--s-ok-fg)" }} />
                    {formatMinor(pendingMinor)} committed from the program budget
                  </div>
                )}
                {over && override.trim() && (
                  <div className="row" style={{ gap: "8px" }}>
                    <TriangleExclamationPoint className="ic" aria-hidden="true" style={{ color: "var(--s-warn-fg)" }} />
                    Over budget · override recorded: {override.trim()}
                  </div>
                )}
                <div className="row muted" style={{ gap: "8px" }}>
                  <Lock className="ic" aria-hidden="true" />
                  Logged in the audit ledger. An agent can propose decisions but cannot commit them.
                </div>
                {commit.error !== null && <ErrorBanner error={commit.error} />}
              </div>
              <div className="ft">
                <button type="button" className="btn btn-secondary" onClick={() => setConfirming(false)}>
                  Cancel
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
                  Commit decisions
                </button>
              </div>
            </Dialog>
          )}
        </main>
      </FunderShell>
    </>
  );
}
