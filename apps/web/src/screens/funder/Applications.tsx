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
import { StatusBadge, STATUS, VerificationBadge } from "../../components/status.tsx";
import { EmptyState, ErrorBanner, Field, Loading, PageHeader } from "../../components/ui.tsx";
import { formatMinor } from "../../lib/format.ts";
import ApplicationsEmpty from "./ApplicationsEmpty.tsx";
import { approvalTargets, Avatar, EligibilityMark, usePeople } from "./shared.tsx";

const PAGE_SIZE = 25;
const FILTER_KEYS = ["stage", "status", "eligibility", "level", "tag", "assignee"] as const;
type FilterKey = (typeof FILTER_KEYS)[number];

interface View {
  key: string;
  label: string;
  filter: Partial<Record<FilterKey, string>>;
}
const VIEWS: View[] = [
  { key: "all", label: "All", filter: {} },
  { key: "needs-screening", label: "Needs screening", filter: { status: "submitted" } },
  { key: "under-review", label: "Under review", filter: { status: "under_review" } },
  { key: "review-complete", label: "Review complete", filter: { status: "recommended" } },
  { key: "flagged", label: "Flagged", filter: { tag: "flagged" } },
  { key: "eligibility-fail", label: "Eligibility fail", filter: { eligibility: "false" } },
  { key: "unassigned", label: "Unassigned", filter: { assignee: "unassigned" } },
];

const SORTABLE: Record<string, string> = { Title: "title", Status: "status", Requested: "requestedAmount", Submitted: "submittedAt" };

function DeclineDialog({ ids, sample, onClose, onDone }: { ids: string[]; sample: InboxApplication | undefined; onClose: () => void; onDone: (message: string) => void }) {
  const templates = useApiQuery((api) => api.listTemplates("email"), []);
  const [templateId, setTemplateId] = useState("");
  const [rationale, setRationale] = useState("");
  const [preview, setPreview] = useState<Rendered | null>(null);
  const all = [...(templates.data?.items ?? []), ...(templates.data?.builtIn ?? [])];
  const chosen = templateId || all[0]?.id || "";
  const render = useApiMutation((api) => api.renderTemplate(chosen, { ...(sample ? { applicationId: sample.id } : {}), fields: { decision: { message: rationale.trim() || "After review, this application will not move forward." } } }));
  const decline = useApiMutation((api) => api.bulkApplications({ applicationIds: ids, action: "decline", params: { letterTemplateId: chosen, sendLetter: true, ...(rationale.trim() ? { rationale: rationale.trim() } : {}) } }));

  return (
    <Dialog open onClose={onClose} labelledBy="decline-title" size="lg">
      <div className="hd">
        <div>
          <h2 id="decline-title">Decline {ids.length === 1 ? "1 application" : `${ids.length} applications`}</h2>
          <p className="small muted">Each applicant receives the letter below. Review it before anything is sent.</p>
        </div>
      </div>
      <div className="bd">
        {templates.status === "loading" && <Loading label="Loading templates" />}
        {templates.status === "error" && <ErrorBanner error={templates.error} onRetry={templates.reload} />}
        {(render.error !== null || decline.error !== null) && <ErrorBanner error={render.error ?? decline.error} />}
        <div className="fld-row">
          <Field id="decline-template" label="Letter template">
            <select
              className="sel"
              id="decline-template"
              value={chosen}
              onChange={(e) => {
                setTemplateId(e.target.value);
                setPreview(null);
              }}
            >
              {all.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                  {t.builtIn ? " (built in)" : ` v${t.version}`}
                </option>
              ))}
            </select>
          </Field>
          <Field id="decline-reason" label="Reason shown in the letter" help="Fills the decision.message merge field.">
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
          <section aria-label="Letter preview" className="letter">
            <div className="small muted">Preview for {sample?.applicant.name ?? "the first applicant"}</div>
            {preview.subject && <div className="b">{preview.subject}</div>}
            <div style={{ whiteSpace: "pre-wrap" }}>{preview.text}</div>
          </section>
        )}
      </div>
      <div className="ft">
        <button type="button" className="btn btn-secondary" onClick={onClose}>
          Cancel
        </button>
        {!preview ? (
          <button type="button" className="btn btn-primary" disabled={!chosen || render.state === "saving"} onClick={async () => setPreview((await render.run()) ?? null)}>
            Preview letter
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-danger-solid"
            disabled={decline.state === "saving"}
            onClick={async () => {
              const r = await decline.run();
              if (r) onDone(`${r.succeeded.length} declined · ${r.lettersSent} ${r.lettersSent === 1 ? "letter" : "letters"} sent${r.failed.length ? ` · ${r.failed.length} could not be declined` : ""}`);
            }}
          >
            Decline and send {ids.length === 1 ? "letter" : `${ids.length} letters`}
          </button>
        )}
      </div>
    </Dialog>
  );
}

export default function Applications() {
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
        <option value="">Any</option>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
  const sortHeader = (label: string, numeric = false) => {
    const k = SORTABLE[label]!;
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
      <title>{`Applications — ${ws.name}`}</title>
      <FunderShell active="Applications">
        <main className="main">
          <PageHeader
            crumbs={[{ label: ws.name, to: base }, { label: "Applications" }]}
            title="Applications"
            meta={
              <>
                <span>{competitions.data?.map((c) => c.title).join(", ") || "No competitions yet"}</span>
                <span>·</span>
                <span>{totalAll} received</span>
              </>
            }
            actions={
              <div className="seg" role="group" aria-label="Row density">
                <button type="button" className={compact ? "" : "on"} aria-pressed={!compact} onClick={() => setCompact(false)}>
                  Comfortable
                </button>
                <button type="button" className={compact ? "on" : ""} aria-pressed={compact} onClick={() => setCompact(true)}>
                  Compact
                </button>
              </div>
            }
          />

          <div className="tabs" role="tablist" aria-label="Saved views">
            {VIEWS.map((v) => (
              <button key={v.key} type="button" role="tab" aria-selected={viewKey === v.key} className={viewKey === v.key ? "tab on" : "tab"} onClick={() => setParams(v.key === "all" ? {} : { view: v.key })}>
                {v.label}
                {viewCount(v) !== null && <span className="n">{viewCount(v)}</span>}
              </button>
            ))}
            <button type="button" role="tab" aria-selected={viewKey === "agent"} className={viewKey === "agent" ? "tab on" : "tab"} onClick={() => setParams({ view: "agent" })}>
              <Bot className="ic" aria-hidden="true" />
              Agent proposals<span className="n">{proposals.size}</span>
            </button>
          </div>

          <div className="filterbar">
            {select("stage", "Stage", [...new Map(stages.map((s) => [s.key, s.label])).entries()])}
            {select("status", "Status", Object.entries(STATUS.application).filter(([k]) => k !== "draft").map(([k, v]) => [k, v.label]))}
            {select("eligibility", "Eligibility", [["true", "Pass"], ["false", "Fail"], ["unknown", "Unknown"]])}
            {select("level", "Passport level", [["L3", "L3"], ["L2", "L2"], ["L1", "L1"], ["L0", "L0"]])}
            {select("tag", "Tag", [...new Set([...tags, ...(params.get("tag") ? [params.get("tag")!] : [])])].map((t) => [t, t]))}
            {select("assignee", "Assignee", [["unassigned", "Unassigned"], ...people.map((p): [string, string] => [p.userId, p.name])])}
            {filtered && (
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setParams({})}>
                Clear filters
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
              <span>{selected.length} selected</span>
              <span style={{ opacity: ".4" }}>|</span>
              <button type="button" className="btn" onClick={() => setDeclining(true)}>
                Decline
              </button>
              <Link to={`${base}/reviews/assign`} className="btn">
                Assign reviewers
              </Link>
              <button type="button" className="iconbtn" style={{ marginLeft: "auto", color: "#fff" }} aria-label="Clear selection" onClick={() => setSelected([])}>
                <X className="ic" aria-hidden="true" />
              </button>
            </div>
          )}

          {list.status === "loading" && <Loading label="Loading applications" />}
          {list.status === "error" && <ErrorBanner error={list.error} onRetry={list.reload} />}
          {list.status === "ready" && (
            <div className="tbl-wrap" tabIndex={0} role="region" aria-label="Applications, scrollable">
              <table className={compact ? "tbl tbl-compact" : "tbl"} aria-label="Applications">
                <thead>
                  <tr>
                    <th style={{ width: "36px" }}>
                      <input type="checkbox" aria-label="Select all on this page" checked={allSelected} onChange={() => setSelected(allSelected ? [] : rows.map((r) => r.id))} />
                    </th>
                    <th>Applicant</th>
                    {sortHeader("Title")}
                    <th>Stage</th>
                    {sortHeader("Status")}
                    <th>Eligibility</th>
                    {sortHeader("Requested", true)}
                    <th className="num">Score</th>
                    {sortHeader("Submitted")}
                    <th className="num">Days in stage</th>
                    <th>Assignee</th>
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
                            <input type="checkbox" aria-label={`Select ${r.applicant.name ?? r.title}`} checked={selected.includes(r.id)} onChange={() => toggle(r.id)} />
                          </td>
                          <td style={{ padding: "6px 12px" }}>
                            <div className="ent">
                              <Link to={to} className="nm">
                                {r.applicant.name ?? "Applicant"}
                              </Link>
                              <div className="sub">
                                <VerificationBadge verification={r.applicant.verification} level={r.applicant.level ?? r.verificationLevelAtSubmit} />
                                {r.tags.map((t) => (
                                  <span key={t} className="tag">
                                    {t}
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
                                <span className="ag">{proposal.requestedBy.clientId ?? "An agent"}</span> proposed a decline · awaiting approval
                                <button type="button" className="btn btn-sm btn-primary" disabled={decide.state === "saving"} onClick={async () => (await decide.run(proposal, true)) && (approvals.reload(), list.reload(), totals.reload())}>
                                  Approve
                                </button>
                                <button type="button" className="btn btn-sm btn-danger" disabled={decide.state === "saving"} onClick={async () => (await decide.run(proposal, false)) && approvals.reload()}>
                                  Reject
                                </button>
                                <Link to={`${base}/approvals`} className="small b">
                                  Open
                                </Link>
                              </div>
                            )}
                          </td>
                          <td>{stageLabel(r.stage)}</td>
                          <td>
                            {proposal ? (
                              <span className="bdg bdg-agent">
                                <Bot className="ic" aria-hidden="true" />
                                Decline proposed
                              </span>
                            ) : (
                              <StatusBadge kind="application" status={r.status} />
                            )}
                          </td>
                          <td>
                            <EligibilityMark value={r.eligibility} />
                          </td>
                          <td className="num">{formatMinor(r.requestedAmountMinor, r.currency)}</td>
                          <td className="num">{scores.data?.has(r.id) ? <span title={`Mean of ${scores.data.get(r.id)!.n} submitted reviews`}>{scores.data.get(r.id)!.mean.toFixed(1)}</span> : <span className="muted">—</span>}</td>
                          <td>{r.submittedAt ? new Date(r.submittedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) : "—"}</td>
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
                  <EmptyState icon={Inbox} title="No applications match">
                    Change or clear the filters to see more.
                  </EmptyState>
                ) : (
                  <EmptyState icon={Inbox} title="No applications yet" actions={<Link to={`/w/${ws.handle}/opportunities`}>Go to opportunities</Link>}>
                    Applications arrive here once an opportunity is open and someone applies.
                  </EmptyState>
                )
              )}
            </div>
          )}

          {pages > 1 && (
            <nav className="row" aria-label="Pages" style={{ justifyContent: "flex-end" }}>
              <button type="button" className="btn btn-sm btn-secondary" disabled={page <= 1} onClick={() => set({ page: String(page - 1) })}>
                Previous
              </button>
              <span className="small muted">
                Page {page} of {pages}
              </span>
              <button type="button" className="btn btn-sm btn-secondary" disabled={page >= pages} onClick={() => set({ page: String(page + 1) })}>
                Next
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
