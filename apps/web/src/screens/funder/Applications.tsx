// SPDX-License-Identifier: AGPL-3.0-only
// The applications inbox. Views, filters, sort and page live in the URL so a view can be linked
// and comes back after a reload. Bulk decline previews the letter before anything is sent, and an
// agent's proposed declines wait here for a person to approve or reject them.
import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { ArrowDown, ArrowUp, Bot, Inbox, X } from "lucide-react";
import { useApiMutation, useApiQuery } from "../../api/hooks.ts";
import type { Approval, InboxApplication, Rendered } from "../../api/funder.ts";
import { useWorkspace } from "../../app/workspace.tsx";
import { Dialog } from "../../components/Dialog.tsx";
import { FunderShell } from "../../components/shells.tsx";
import { STATUS, StatusBadge, VerificationBadge, WorkspaceName } from "../../components/status.tsx";
import { EmptyState, ErrorBanner, Field, Loading, PageHeader } from "../../components/ui.tsx";
import { formatMinor } from "../../lib/format.ts";
import ApplicationsEmpty from "./ApplicationsEmpty.tsx";
import { approvalTargets, Avatar, EligibilityMark, usePeople } from "./shared.tsx";
import { intlLocale } from "../../i18n/index.tsx";
import { t, useFunderMessages } from "./i18n.ts";

const PAGE_SIZE = 25;
const FILTER_KEYS = ["stage", "status", "eligibility", "level", "tag", "assignee"] as const;
type FilterKey = (typeof FILTER_KEYS)[number];

interface View {
  key: string;
  readonly label: string;
  filter: Partial<Record<FilterKey, string>>;
}
const VIEWS: View[] = [
  { key: "all", get label() { return t("funderApplications.view.all"); }, filter: {} },
  { key: "needs-screening", get label() { return t("funderApplications.view.needsScreening"); }, filter: { status: "submitted" } },
  { key: "under-review", get label() { return t("funderApplications.view.underReview"); }, filter: { status: "under_review" } },
  { key: "review-complete", get label() { return t("funderApplications.view.reviewComplete"); }, filter: { status: "recommended" } },
  { key: "flagged", get label() { return t("funderApplications.view.flagged"); }, filter: { tag: "flagged" } },
  { key: "eligibility-fail", get label() { return t("funderApplications.view.eligibilityFail"); }, filter: { eligibility: "false" } },
  { key: "unassigned", get label() { return t("funderApplications.view.unassigned"); }, filter: { assignee: "unassigned" } },
];

const SORTABLE = { title: "title", status: "status", requested: "requestedAmount", submitted: "submittedAt" } as const;

function DeclineDialog({ ids, sample, onClose, onDone }: { ids: string[]; sample: InboxApplication | undefined; onClose: () => void; onDone: (message: string) => void }) {
  const templates = useApiQuery((api) => api.listTemplates("email"), []);
  const [templateId, setTemplateId] = useState("");
  const [rationale, setRationale] = useState("");
  const [preview, setPreview] = useState<Rendered | null>(null);
  const all = [...(templates.data?.items ?? []), ...(templates.data?.builtIn ?? [])];
  const chosen = templateId || all[0]?.id || "";
  const render = useApiMutation((api) => api.renderTemplate(chosen, { ...(sample ? { applicationId: sample.id } : {}), fields: { decision: { message: rationale.trim() || t("funderApplications.afterReviewThisApplication") } } }));
  const decline = useApiMutation((api) => api.bulkApplications({ applicationIds: ids, action: "decline", params: { letterTemplateId: chosen, sendLetter: true, ...(rationale.trim() ? { rationale: rationale.trim() } : {}) } }));

  return (
    <Dialog open onClose={onClose} labelledBy="decline-title" size="lg">
      <div className="hd">
        <div>
          <h2 id="decline-title">{t("funderApplications.declineCount", { count: ids.length })}</h2>
          <p className="small muted">{t("funderApplications.eachApplicantReceivesThe")}</p>
        </div>
      </div>
      <div className="bd">
        {templates.status === "loading" && <Loading label={t("funderApplications.loadingTemplates")} />}
        {templates.status === "error" && <ErrorBanner error={templates.error} onRetry={templates.reload} />}
        {(render.error !== null || decline.error !== null) && <ErrorBanner error={render.error ?? decline.error} />}
        <div className="fld-row">
          <Field id="decline-template" label={t("funderApplications.letterTemplate")}>
            <select
              className="sel"
              id="decline-template"
              value={chosen}
              onChange={(e) => {
                setTemplateId(e.target.value);
                setPreview(null);
              }}
            >
              {all.map((tpl) => (
                <option key={tpl.id} value={tpl.id}>
                  {tpl.name}
                  {tpl.builtIn ? t("funderApplications.builtIn") : t("funderApplications.v", { version: tpl.version })}
                </option>
              ))}
            </select>
          </Field>
          <Field id="decline-reason" label={t("funderApplications.reasonShownInThe")} help={t("funderApplications.fillsTheDecisionMessage")}>
            <input
              className="inp"
              id="decline-reason"
              value={rationale}
              onChange={(e) => {
                setRationale(e.target.value);
                setPreview(null);
              }}
            />
          </Field>
        </div>
        {preview && (
          <section aria-label={t("funderApplications.letterPreview")} className="letter">
            <div className="small muted">{t("funderApplications.previewFor", { name: sample?.applicant.name ?? t("funderApplications.theFirstApplicant") })}</div>
            {preview.subject && <div className="b">{preview.subject}</div>}
            <div style={{ whiteSpace: "pre-wrap" }}>{preview.text}</div>
          </section>
        )}
      </div>
      <div className="ft">
        <button type="button" className="btn btn-secondary" onClick={onClose}>
          {t("funderApplications.cancel")}
        </button>
        {!preview ? (
          <button type="button" className="btn btn-primary" disabled={!chosen || render.state === "saving"} onClick={async () => setPreview((await render.run()) ?? null)}>
            {t("funderApplications.previewLetter")}
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-danger-solid"
            disabled={decline.state === "saving"}
            onClick={async () => {
              const r = await decline.run();
              if (r) onDone(r.failed.length ? t("funderApplications.declinedSomeFailed", { declined: r.succeeded.length, letters: r.lettersSent, failed: r.failed.length }) : t("funderApplications.declinedSent", { declined: r.succeeded.length, letters: r.lettersSent }));
            }}
          >
            {t("funderApplications.declineAndSendLetters", { count: ids.length })}
          </button>
        )}
      </div>
    </Dialog>
  );
}

export default function Applications() {
  useFunderMessages();
  const ws = useWorkspace("funder");
  const base = `/w/${ws.handle}`;
  const [params, setParams] = useSearchParams();
  const { person, people } = usePeople();
  const [compact, setCompact] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [declining, setDeclining] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const viewKey = params.get("view") ?? "all";
  const view = VIEWS.find((v) => v.key === viewKey);
  const filter = useMemo(() => {
    const f: Partial<Record<FilterKey, string>> = { ...(view?.filter ?? {}) };
    for (const k of FILTER_KEYS) if (params.get(k)) f[k] = params.get(k)!;
    return f;
  }, [params, view]);
  const sortBy = params.get("sort") ?? "submittedAt";
  const sortOrder = (params.get("order") ?? (sortBy === "submittedAt" ? "desc" : "asc")) as "asc" | "desc";
  const page = Math.max(1, Number(params.get("page") ?? "1") || 1);
  const key = JSON.stringify([filter, sortBy, sortOrder, page]);

  const programs = useApiQuery((api) => api.listPrograms(), []);
  const competitions = useApiQuery((api) => api.listCompetitions(), []);
  const list = useApiQuery((api) => api.listApplications({ ...filter, sortBy, sortOrder, page, pageSize: PAGE_SIZE }), [key]);
  const totals = useApiQuery((api) => api.listApplications({ pageSize: 1 }), []);
  const approvals = useApiQuery((api) => api.listApprovals("pending"), []);
  // Mean review score per application at its current stage, from each competition's ranking.
  const scores = useApiQuery(
    async (api) => {
      const rankings = await Promise.all((competitions.data ?? []).map((c) => api.getRanking(c.id).catch(() => null)));
      return new Map(rankings.flatMap((r) => (r?.items ?? []).filter((i) => i.mean !== null).map((i) => [i.applicationId, { mean: i.mean as number, n: i.n }] as const)));
    },
    [competitions.data?.map((c) => c.id).join(",")],
  );
  const daysInStage = (r: InboxApplication) => {
    const since = r.submittedAt ?? r.updatedAt;
    return since ? Math.max(0, Math.floor((Date.now() - Date.parse(since)) / 86_400_000)) : null;
  };
  const decide = useApiMutation((api, a: Approval, approve: boolean) => api.decideApproval(a.id, { approve }));

  const set = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    if (!("page" in changes)) next.delete("page");
    setParams(next);
    setSelected([]);
  };

  if (programs.status === "ready" && programs.data.length === 0) return <ApplicationsEmpty />;

  const stages = competitions.data?.flatMap((c) => c.stages) ?? [];
  const stageLabel = (k: string) => stages.find((s) => s.key === k)?.label ?? k;
  const rows = list.data?.items ?? [];
  const counts = totals.data?.counts ?? {};
  const totalAll = Object.values(counts).reduce((a, b) => a + b, 0);
  const viewCount = (v: View) => (v.key === "all" ? totalAll : v.filter.status ? (counts[v.filter.status] ?? 0) : null);
  const proposals = new Map<string, Approval>();
  for (const a of approvals.data ?? []) for (const id of approvalTargets(a.input)) proposals.set(id, a);
  const pages = Math.max(1, Math.ceil((list.data?.total ?? 0) / PAGE_SIZE));
  const allSelected = rows.length > 0 && rows.every((r) => selected.includes(r.id));
  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const tags = [...new Set(rows.flatMap((r) => r.tags))];
  const filtered = FILTER_KEYS.some((k) => params.get(k)) || viewKey !== "all";

  const select = (k: FilterKey, label: string, options: [string, string][]) => (
    <label className={params.get(k) ? "fchip on" : "fchip"}>
      {label}:
      <select aria-label={label} value={params.get(k) ?? ""} onChange={(e) => set({ [k]: e.target.value || null })} style={{ border: 0, background: "transparent", font: "inherit", color: "inherit", fontWeight: 700 }}>
        <option value="">{t("funderApplications.any")}</option>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
  const sortHeader = (id: keyof typeof SORTABLE, label: string, numeric = false) => {
    const k = SORTABLE[id];
    const on = sortBy === k;
    return (
      <th className={numeric ? "num" : undefined} aria-sort={on ? (sortOrder === "asc" ? "ascending" : "descending") : "none"}>
        <button type="button" className="row" style={{ gap: "4px", border: 0, background: "transparent", font: "inherit", color: "inherit", cursor: "pointer", padding: 0, textTransform: "inherit", letterSpacing: "inherit", fontWeight: 700 }} onClick={() => set({ sort: k, order: on && sortOrder === "asc" ? "desc" : "asc" })}>
          {label}
          {on && (sortOrder === "asc" ? <ArrowUp className="ic ic-sm" aria-hidden="true" /> : <ArrowDown className="ic ic-sm" aria-hidden="true" />)}
        </button>
      </th>
    );
  };

  return (
    <>
      <title>{t("funderApplications.applications2", { name: ws.name })}</title>
      <FunderShell active="Applications">
        <main className="main">
          <PageHeader
            crumbs={[{ label: ws.name, to: base }, { label: t("funderApplications.applications3") }]}
            title={t("funderApplications.applications3")}
            meta={
              <>
                <span>{competitions.data?.map((c) => c.title).join(", ") || t("funderApplications.noCompetitionsYet")}</span>
                <span>·</span>
                <span>{t("funderApplications.received", { totalAll })}</span>
              </>
            }
            actions={
              <div className="seg" role="group" aria-label={t("funderApplications.rowDensity")}>
                <button type="button" className={compact ? "" : "on"} aria-pressed={!compact} onClick={() => setCompact(false)}>
                  {t("funderApplications.comfortable")}
                </button>
                <button type="button" className={compact ? "on" : ""} aria-pressed={compact} onClick={() => setCompact(true)}>
                  {t("funderApplications.compact")}
                </button>
              </div>
            }
          />

          <div className="tabs" role="tablist" aria-label={t("funderApplications.savedViews")}>
            {VIEWS.map((v) => (
              <button key={v.key} type="button" role="tab" aria-selected={viewKey === v.key} className={viewKey === v.key ? "tab on" : "tab"} onClick={() => setParams(v.key === "all" ? {} : { view: v.key })}>
                {v.label}
                {viewCount(v) !== null && <span className="n">{viewCount(v)}</span>}
              </button>
            ))}
            <button type="button" role="tab" aria-selected={viewKey === "agent"} className={viewKey === "agent" ? "tab on" : "tab"} onClick={() => setParams({ view: "agent" })}>
              <Bot className="ic" aria-hidden="true" />
              {t.rich("funderApplications.agentProposals", { size: proposals.size, span: (chunks) => <span className="n">{chunks}</span> })}
            </button>
          </div>

          <div className="filterbar">
            {select("stage", t("funderApplications.filter.stage"), [...new Map(stages.map((s) => [s.key, s.label])).entries()])}
            {select("status", t("funderApplications.filter.status"), Object.entries(STATUS.application).filter(([k]) => k !== "draft").map(([k, v]) => [k, v.label]))}
            {select("eligibility", t("funderApplications.filter.eligibility"), [["true", t("funderApplications.filter.pass")], ["false", t("funderApplications.filter.fail")], ["unknown", t("funderApplications.filter.unknown")]])}
            {select("level", t("funderApplications.filter.passportLevel"), [["L3", "L3"], ["L2", "L2"], ["L1", "L1"], ["L0", "L0"]])}
            {select("tag", t("funderApplications.filter.tag"), [...new Set([...tags, ...(params.get("tag") ? [params.get("tag")!] : [])])].map((item) => [item, item]))}
            {select("assignee", t("funderApplications.filter.assignee"), [["unassigned", t("funderApplications.filter.unassigned")], ...people.map((p): [string, string] => [p.userId, p.name])])}
            {filtered && (
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setParams({})}>
                {t("funderApplications.clearFilters")}
              </button>
            )}
          </div>

          {note && (
            <div className="bnr bnr-ok" role="status">
              <div className="t">{note}</div>
            </div>
          )}
          {decide.error !== null && <ErrorBanner error={decide.error} />}

          {selected.length > 0 && (
            <div className="bulkbar" role="status">
              <span>{t("funderApplications.selected", { count: selected.length })}</span>
              <span aria-hidden="true" style={{ opacity: ".4" }}>|</span>
              <button type="button" className="btn" onClick={() => setDeclining(true)}>
                {t("funderApplications.decline")}
              </button>
              <Link to={`${base}/reviews/assign`} className="btn">
                {t("funderApplications.assignReviewers")}
              </Link>
              <button type="button" className="iconbtn" style={{ marginLeft: "auto", color: "#fff" }} aria-label={t("funderApplications.clearSelection")} onClick={() => setSelected([])}>
                <X className="ic" aria-hidden="true" />
              </button>
            </div>
          )}

          {list.status === "loading" && <Loading label={t("funderApplications.loadingApplications")} />}
          {list.status === "error" && <ErrorBanner error={list.error} onRetry={list.reload} />}
          {list.status === "ready" && (
            <div className="tbl-wrap" tabIndex={0} role="region" aria-label={t("funderApplications.applicationsScrollable")}>
              <table className={compact ? "tbl tbl-compact" : "tbl"} aria-label={t("funderApplications.applications3")}>
                <thead>
                  <tr>
                    <th style={{ width: "36px" }}>
                      <input type="checkbox" aria-label={t("funderApplications.selectAllOnThis")} checked={allSelected} onChange={() => setSelected(allSelected ? [] : rows.map((r) => r.id))} />
                    </th>
                    <th>{t("funderApplications.applicant")}</th>
                    {sortHeader("title", t("funderApplications.column.title"))}
                    <th>{t("funderApplications.stage")}</th>
                    {sortHeader("status", t("funderApplications.column.status"))}
                    <th>{t("funderApplications.eligibility")}</th>
                    {sortHeader("requested", t("funderApplications.column.requested"), true)}
                    <th className="num">{t("funderApplications.score")}</th>
                    {sortHeader("submitted", t("funderApplications.column.submitted"))}
                    <th className="num">{t("funderApplications.daysInStage")}</th>
                    <th>{t("funderApplications.assignee")}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows
                    .filter((r) => viewKey !== "agent" || proposals.has(r.id))
                    .map((r) => {
                      const proposal = proposals.get(r.id);
                      const to = `${base}/applications/${r.id}`;
                      return (
                        <tr key={r.id} className={proposal ? "agent" : selected.includes(r.id) ? "sel" : undefined}>
                          <td>
                            <input type="checkbox" aria-label={t("funderApplications.select", { name: r.applicant.name ?? r.title })} checked={selected.includes(r.id)} onChange={() => toggle(r.id)} />
                          </td>
                          <td style={{ padding: "6px 12px" }}>
                            <div className="ent">
                              <Link to={to} className="nm">
                                {r.applicant.name ?? t("funderApplications.applicant")}
                              </Link>
                              <div className="sub">
                                <VerificationBadge verification={r.applicant.verification} level={r.applicant.level ?? r.verificationLevelAtSubmit} />
                                <WorkspaceName name={r.applicant.workspaceName} />
                                {r.tags.map((item) => (
                                  <span key={item} className="tag">
                                    {item}
                                  </span>
                                ))}
                              </div>
                            </div>
                          </td>
                          <td style={{ whiteSpace: "normal" }}>
                            <Link to={to} style={{ color: "#1E2D2B" }}>
                              {r.title}
                            </Link>
                            {proposal && (
                              <div className="attrib" style={{ marginTop: "4px" }}>
                                <Bot className="ic" aria-hidden="true" />
                                {t.rich("funderApplications.agentProposedDecline", { agent: proposal.requestedBy.clientId ?? t("funderApplications.anAgent"), ag: (chunks) => <span className="ag">{chunks}</span> })}
                                <button type="button" className="btn btn-sm btn-primary" disabled={decide.state === "saving"} onClick={async () => (await decide.run(proposal, true)) && (approvals.reload(), list.reload(), totals.reload())}>
                                  {t("funderApplications.approve")}
                                </button>
                                <button type="button" className="btn btn-sm btn-danger" disabled={decide.state === "saving"} onClick={async () => (await decide.run(proposal, false)) && approvals.reload()}>
                                  {t("funderApplications.reject")}
                                </button>
                                <Link to={`${base}/approvals`} className="small b" aria-label={t("funderApplications.openTheApprovalRequest")}>
                                  {t("funderApplications.open")}
                                </Link>
                              </div>
                            )}
                          </td>
                          <td>{stageLabel(r.stage)}</td>
                          <td>
                            {proposal ? (
                              <span className="bdg bdg-agent">
                                <Bot className="ic" aria-hidden="true" />
                                {t("funderApplications.declineProposed")}
                              </span>
                            ) : (
                              <StatusBadge kind="application" status={r.status} />
                            )}
                          </td>
                          <td>
                            <EligibilityMark value={r.eligibility} />
                          </td>
                          <td className="num">{formatMinor(r.requestedAmountMinor, r.currency)}</td>
                          <td className="num">{scores.data?.has(r.id) ? <span title={t("funderApplications.meanOfSubmittedReviews", { n: scores.data.get(r.id)!.n })}>{scores.data.get(r.id)!.mean.toFixed(1)}</span> : <span className="muted">—</span>}</td>
                          <td>{r.submittedAt ? new Date(r.submittedAt).toLocaleDateString(intlLocale(), { month: "short", day: "numeric", timeZone: "UTC" }) : "—"}</td>
                          <td className="num">{["draft", "accepted", "declined", "withdrawn"].includes(r.status) ? <span className="muted">—</span> : (daysInStage(r) ?? "—")}</td>
                          <td>
                            <Avatar person={person(r.assignedToUserId)} />
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
              {rows.length === 0 && (
                filtered ? (
                  <EmptyState icon={Inbox} title={t("funderApplications.noApplicationsMatch")}>
                    {t("funderApplications.changeOrClearThe")}
                  </EmptyState>
                ) : (
                  <EmptyState icon={Inbox} title={t("funderApplications.noApplicationsYet")} actions={<Link to={`/w/${ws.handle}/opportunities`}>{t("funderApplications.goToOpportunities")}</Link>}>
                    {t("funderApplications.applicationsArriveHereOnce")}
                  </EmptyState>
                )
              )}
            </div>
          )}

          {pages > 1 && (
            <nav className="row" aria-label={t("funderApplications.pages")} style={{ justifyContent: "flex-end" }}>
              <button type="button" className="btn btn-sm btn-secondary" disabled={page <= 1} onClick={() => set({ page: String(page - 1) })}>
                {t("funderApplications.previous")}
              </button>
              <span className="small muted">
                {t("funderApplications.pageOf", { page, pages })}
              </span>
              <button type="button" className="btn btn-sm btn-secondary" disabled={page >= pages} onClick={() => set({ page: String(page + 1) })}>
                {t("funderApplications.next")}
              </button>
            </nav>
          )}
        </main>
      </FunderShell>
      {declining && (
        <DeclineDialog
          ids={selected}
          sample={rows.find((r) => r.id === selected[0])}
          onClose={() => setDeclining(false)}
          onDone={(message) => {
            setDeclining(false);
            setSelected([]);
            setNote(message);
            list.reload();
            totals.reload();
          }}
        />
      )}
    </>
  );
}
