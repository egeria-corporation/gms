// SPDX-License-Identifier: AGPL-3.0-only
// Reports: every reporting requirement across the organization's grants, and the selected report
// in an editor: prefilled, autosaved, submitted once, answered when returned, and shared with
// another funder by consent once accepted.
import { Link, useSearchParams } from "react-router";
import { Check, ClipboardCheck, TriangleExclamationPoint } from "lucide-react";
import { useApplicantQuery } from "../../api/applicantHooks.ts";
import type { MyRequirement } from "../../api/applicantMore.ts";
import { useWorkspace } from "../../app/workspace.tsx";
import { accentOf, FunderChip, timeAgo } from "../../components/applicant.tsx";
import { ApplicantShell } from "../../components/shells.tsx";
import { StatusBadge } from "../../components/status.tsx";
import { EmptyState, ErrorBanner, Loading } from "../../components/ui.tsx";
import { formatDate } from "../../lib/format.ts";
import { actionFor, byUrgency, duePhrase, ReportForm, ReportLoading, ReturnedBanner, SECTION_ICON, sectionId, ShareReport, summaryLine, useReport, useReports, type ReportsData } from "./report.tsx";
import { ReportBudget } from "./reportBudget.tsx";

function Editor({ requirement, data, onChanged }: { requirement: MyRequirement; data: ReportsData; onChanged: () => void }) {
  const report = useReport(requirement, onChanged);
  const ws = useWorkspace("applicant");
  const org = useApplicantQuery((api) => api.organization(), []);
  const l = report.loaded;
  const funder = requirement.funder?.name ?? "your funder";
  const due = duePhrase(requirement);
  const blockers = report.showAll || report.serverErrors.length ? report.errors : [];
  return (
    <>
      <div className="card" id="editor" tabIndex={-1} style={{ padding: "14px 20px", display: "flex", alignItems: "center", gap: "16px", flexWrap: "wrap" }}>
        <FunderChip name={requirement.funder?.name} accent={accentOf(requirement.funder?.brand)} />
        <div style={{ display: "flex", flexDirection: "column", gap: "2px", minWidth: "0" }}>
          <h2 style={{ fontSize: "20px" }}>
            {requirement.title} · {requirement.award?.title ?? "Grant"}
          </h2>
          <div className="row small muted" style={{ gap: "10px", flexWrap: "wrap" }}>
            {l && <span>Report form v{l.form.formVersion}</span>}
            {l && <span aria-hidden="true">·</span>}
            <span className="b" style={due.urgent ? { color: "var(--s-warn-fg)" } : undefined}>
              {due.text}
            </span>
            {requirement.releasesTrancheId && (
              <>
                <span aria-hidden="true">·</span>
                <span>Accepting it releases a payment</span>
              </>
            )}
          </div>
        </div>
        <div className="row" style={{ marginLeft: "auto", gap: "14px", flexWrap: "wrap" }}>
          {l && <StatusBadge kind="submission" status={l.submission.status} />}
          <span className="notice" role="status" aria-live="polite">
            {report.save.state === "saving" && "Saving…"}
            {report.save.state === "saved" && (
              <>
                <Check className="ic" aria-hidden="true" style={{ color: "var(--s-ok-fg)" }} />
                Saved {report.save.at ? timeAgo(report.save.at) : ""}
              </>
            )}
            {report.save.state === "error" && "Not saved"}
          </span>
          {report.editable && (
            <button className="btn btn-primary" type="button" disabled={report.submit.state === "sending" || !l?.def} onClick={() => void report.send()}>
              {report.submit.state === "sending" ? "Submitting…" : l?.submission.status === "returned" ? "Resubmit report" : "Submit report"}
            </button>
          )}
        </div>
      </div>

      <ReportLoading report={report} />
      {report.save.state === "error" && <ErrorBanner error={report.save.error} title="Your last change was not saved" />}

      {report.status === "idle" && !l && (
        <div className="card">
          <EmptyState
            icon={ClipboardCheck}
            title={`${requirement.title} has not been started`}
            actions={
              <button className="btn btn-primary" type="button" onClick={report.start}>
                {actionFor(requirement)?.label ?? "Start report"}
              </button>
            }
          >
            Starting fills in what Passport and your last accepted report already hold. Every carried value is marked with where it came from.
          </EmptyState>
        </div>
      )}

      {l && (
        <div style={{ display: "grid", gridTemplateColumns: "248px minmax(0, 1fr) 300px", gap: "20px", alignItems: "start" }}>
          <aside className="card" style={{ padding: "12px" }}>
            <div className="eyebrow" style={{ padding: "4px 10px 10px" }}>
              Sections · {report.sections.filter((s) => s.state === "done").length} of {report.sections.length} complete
            </div>
            <nav className="sec" aria-label="Report sections">
              {report.sections.map((s) => {
                const Icon = SECTION_ICON[s.state];
                return (
                  <a key={s.label} href={`#${sectionId(s.label)}`} className={`s-${s.state}`}>
                    <Icon className="ic" aria-hidden="true" />
                    <div>
                      <div className="nm">{s.label}</div>
                      <div className="st">{s.note}</div>
                    </div>
                    <span className="meta"></span>
                  </a>
                );
              })}
            </nav>
          </aside>
          <section style={{ display: "flex", flexDirection: "column", gap: "20px", minWidth: "0" }} aria-label="Report">
            <ReturnedBanner submission={l.submission} funder={funder} />
            <ReportForm report={report} passportUrl={org.status === "ready" ? org.data.editUrl : null} />
            <ReportBudget awardId={requirement.awardId} base={`/w/${ws.handle}`} />
          </section>
          <aside style={{ display: "flex", flexDirection: "column", gap: "16px" }} aria-label="Report status">
            <div className="card">
              <div className="card-h">
                <h3>{report.editable ? "Before you submit" : "Status"}</h3>
              </div>
              <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "10px", fontSize: "14px" }}>
                {report.editable ? (
                  blockers.length ? (
                    <>
                      <span className="eyebrow" style={{ color: "var(--s-dng-fg)" }}>
                        To fix · {blockers.length}
                      </span>
                      <ul style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                        {blockers.map((e, i) => (
                          <li key={`${e.field}-${i}`} className="row" style={{ gap: "8px", alignItems: "flex-start" }}>
                            <TriangleExclamationPoint className="ic" aria-hidden="true" style={{ color: "var(--s-dng-fg)", marginTop: "3px" }} />
                            <span>{e.message}</span>
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : (
                    <p className="muted">Your work is saved as you type. Submitting sends the report to {funder} and locks it.</p>
                  )
                ) : (
                  <>
                    <p>
                      {l.submission.status === "accepted" ? `Accepted by ${funder}.` : `Sent to ${funder} on ${formatDate(l.submission.submittedAt)}.`}
                    </p>
                    {l.submission.reviewNote && l.submission.status === "accepted" && <p className="muted">“{l.submission.reviewNote}”</p>}
                  </>
                )}
                {report.submit.error && !blockers.length ? <ErrorBanner error={report.submit.error} title="The report was not submitted" /> : null}
              </div>
            </div>
            <ShareReport loaded={l} requirement={requirement} funders={data.funders} onShared={onChanged} />
          </aside>
        </div>
      )}
    </>
  );
}

export default function Reports() {
  const ws = useWorkspace("applicant");
  const base = `/w/${ws.handle}`;
  const query = useReports(ws.id);
  const [params, setParams] = useSearchParams();
  const list = query.status === "ready" ? [...query.data.requirements].sort(byUrgency) : [];
  // The link may carry the id with or without its `req_` prefix.
  const bare = (id: string | null) => (id ?? "").replace(/^req_/, "");
  const selected = list.find((r) => bare(r.id) === bare(params.get("r"))) ?? list[0] ?? null;
  return (
    <>
      <title>{`Reports — ${ws.name}`}</title>
      <ApplicantShell active="Reports">
        <main className="main">
          <nav className="crumbs" aria-label="Breadcrumb">
            <Link to={base}>Dashboard</Link>
            <span aria-hidden="true">›</span>
            <span aria-current="page">Reports</span>
          </nav>
          <div className="ph">
            <div>
              <div className="title">
                <h1>Reports</h1>
              </div>
              {list.length > 0 && (
                <div className="meta">
                  {summaryLine(list).map((part, i) => (
                    <span key={part} className="row" style={{ gap: "14px" }}>
                      {i > 0 && <span aria-hidden="true">·</span>}
                      <span>{part}</span>
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div className="actions">
              <Link to={`${base}/grants`} className="btn btn-secondary">
                Awarded funding
              </Link>
            </div>
          </div>
          {query.status === "loading" && <Loading label="Loading reports" />}
          {query.status === "error" && <ErrorBanner error={query.error} onRetry={query.reload} />}
          {query.status === "ready" && list.length === 0 && (
            <div className="card">
              <EmptyState icon={ClipboardCheck} title="Nothing to report yet">
                When a grant is active, the reports its funder asks for appear here with their due dates.
              </EmptyState>
            </div>
          )}
          {query.status === "ready" && list.length > 0 && (
            <>
              <div className="tbl-wrap" tabIndex={0} role="region" aria-label="Reporting requirements, scrollable">
                <table className="tbl" style={{ fontSize: "15px" }}>
                  <caption className="sr">Reporting requirements</caption>
                  <thead>
                    <tr>
                      <th scope="col">Funder</th>
                      <th scope="col">Requirement</th>
                      <th scope="col">Grant</th>
                      <th scope="col">Due</th>
                      <th scope="col">Status</th>
                      <th scope="col">
                        <span className="sr">Action</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((r) => {
                      const action = actionFor(r);
                      return (
                        <tr key={r.id} className={r.id === selected?.id ? "sel" : undefined}>
                          <td>
                            <FunderChip name={r.funder?.name} accent={accentOf(r.funder?.brand)} />
                          </td>
                          <td className="b">{r.title}</td>
                          <td>{r.award?.title ?? "—"}</td>
                          <td>{formatDate(r.dueAt)}</td>
                          <td>
                            <StatusBadge kind="requirement" status={r.status} />
                          </td>
                          <td>
                            {action && (
                              <button className={`btn btn-sm ${action.primary ? "btn-primary" : "btn-secondary"}`} type="button" aria-label={`${action.label}: ${r.title}, ${r.funder?.name ?? "funder"}`} aria-pressed={r.id === selected?.id} onClick={() => setParams({ r: r.id })}>
                                {action.label}
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {selected && <Editor key={selected.id} requirement={selected} data={query.data} onChanged={query.reload} />}
            </>
          )}
        </main>
      </ApplicantShell>
    </>
  );
}
