// SPDX-License-Identifier: AGPL-3.0-only
// Reports at phone width, as the 390px artboard draws it: one card per requirement under "Due
// across funders", then the selected report in a single card with a full-width submit, then
// sharing. Same data and report logic as the desktop screen (../report.tsx).
import type { CSSProperties } from "react";
import { useSearchParams } from "react-router";
import { ClipboardCheck } from "lucide-react";
import { useApplicantQuery } from "../../../api/applicantHooks.ts";
import type { MyRequirement } from "../../../api/applicantMore.ts";
import { useWorkspace } from "../../../app/workspace.tsx";
import { accentOf, FunderChip } from "../../../components/applicant.tsx";
import { PhoneShell } from "../../../components/PhoneShell.tsx";
import { StatusBadge } from "../../../components/status.tsx";
import { EmptyState, ErrorBanner, Loading } from "../../../components/ui.tsx";
import { actionFor, byUrgency, duePhrase, ReportForm, ReportLoading, ReturnedBanner, ShareReport, useReport, useReports, type ReportsData } from "../report.tsx";

function Editor({ requirement, data, onChanged }: { requirement: MyRequirement; data: ReportsData; onChanged: () => void }) {
  const report = useReport(requirement, onChanged);
  const org = useApplicantQuery((api) => api.organization(), []);
  const l = report.loaded;
  const funder = requirement.funder?.name ?? "your funder";
  return (
    <>
      <section className="card" id="editor" aria-labelledby="ed-h">
        <div className="card-h" style={{ padding: "14px 16px", flexWrap: "wrap" }}>
          <div>
            <h3 id="ed-h" style={{ fontSize: "16px" }}>
              {requirement.title}
            </h3>
            <p className="small muted">
              {funder} · {duePhrase(requirement).text}
            </p>
          </div>
          {l ? <StatusBadge kind="submission" status={l.submission.status} /> : <StatusBadge kind="requirement" status={requirement.status} />}
        </div>
        <div className="card-b" style={{ padding: "14px 16px 16px", display: "flex", flexDirection: "column", gap: "16px" }}>
          <ReportLoading report={report} />
          {report.status === "idle" && !l && (
            <>
              <p className="small muted">Starting fills in what Passport and your last accepted report already hold. Every carried value is marked with where it came from.</p>
              <button className="btn btn-primary btn-lg btn-block" type="button" onClick={report.start}>
                {actionFor(requirement)?.label ?? "Start report"}
              </button>
            </>
          )}
          {l && (
            <>
              <ReturnedBanner submission={l.submission} funder={funder} />
              <ReportForm report={report} passportUrl={org.status === "ready" ? org.data.editUrl : null} />
              <span className="notice" role="status" aria-live="polite">
                {report.save.state === "saving" && "Saving…"}
                {report.save.state === "saved" && "Saved"}
                {report.save.state === "error" && "Your last change was not saved"}
              </span>
              {report.submit.error ? <ErrorBanner error={report.submit.error} title="The report was not submitted" /> : null}
              {report.editable && (
                <button className="btn btn-primary btn-lg btn-block" type="button" disabled={report.submit.state === "sending" || !l.def} onClick={() => void report.send()}>
                  {report.submit.state === "sending" ? "Submitting…" : l.submission.status === "returned" ? "Resubmit report" : "Submit report"}
                </button>
              )}
            </>
          )}
        </div>
      </section>
      {l && <ShareReport loaded={l} requirement={requirement} funders={data.funders} onShared={onChanged} />}
    </>
  );
}

export default function ReportsPhone() {
  const ws = useWorkspace("applicant");
  const query = useReports(ws.id);
  const [params, setParams] = useSearchParams();
  const list = query.status === "ready" ? [...query.data.requirements].sort(byUrgency) : [];
  const selected = list.find((r) => r.id === params.get("r")) ?? list[0] ?? null;
  return (
    <>
      <title>{`Reports — ${ws.name}`}</title>
      <PhoneShell title="Reports" active="Reports">
        <main className="main" style={{ flex: 1 }}>
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
              <section style={{ display: "flex", flexDirection: "column", gap: "10px" }} aria-labelledby="due-h">
                <h2 id="due-h" style={{ fontSize: "20px" }}>
                  Due across funders
                </h2>
                {list.map((r) => {
                  const action = actionFor(r);
                  const attention = r.status === "due" || r.status === "overdue" || r.status === "returned";
                  return (
                    <div
                      key={r.id}
                      className="card"
                      style={{ "--tenant": accentOf(r.funder?.brand) ?? "var(--og-gray-600)", padding: "14px 16px", display: "flex", flexDirection: "column", gap: "8px", ...(attention ? { borderColor: "var(--s-warn-bd)" } : {}) } as CSSProperties}
                    >
                      <FunderChip name={r.funder?.name} accent={accentOf(r.funder?.brand)} style={{ alignSelf: "flex-start" }} />
                      <div className="b" style={{ fontSize: "16px", color: "var(--og-navy-dark)" }}>
                        {r.title} · {r.award?.title ?? "Grant"}
                      </div>
                      <div className="row" style={{ justifyContent: "space-between", gap: "8px", flexWrap: "wrap" }}>
                        <span className="small muted">
                          {duePhrase(r).text}
                          {r.releasesTrancheId ? " · releases a payment" : ""}
                        </span>
                        <StatusBadge kind="requirement" status={r.status} />
                      </div>
                      {action && (
                        <button className={`btn btn-lg btn-block ${r.id === selected?.id ? "btn-secondary" : action.primary ? "btn-primary" : "btn-secondary"}`} type="button" aria-pressed={r.id === selected?.id} onClick={() => { setParams({ r: r.id }); document.getElementById("editor")?.scrollIntoView({ block: "start" }); }}>
                          {r.id === selected?.id ? "Open below" : action.label}
                          <span className="sr">
                            : {r.title}, {r.funder?.name ?? "funder"}
                          </span>
                        </button>
                      )}
                    </div>
                  );
                })}
              </section>
              {selected && <Editor key={selected.id} requirement={selected} data={query.data} onChanged={query.reload} />}
            </>
          )}
        </main>
      </PhoneShell>
    </>
  );
}
