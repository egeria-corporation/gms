// SPDX-License-Identifier: AGPL-3.0-only
// One approval request in full, so a person can read exactly what they are approving: the tool
// input as the agent sent it, each application it would act on with the rule it failed, and the
// letter each applicant would receive, rendered by the server from the template.
import { useState } from "react";
import { Link } from "react-router";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useApiQuery } from "../../api/hooks.ts";
import { ErrorBanner, Loading } from "../../components/ui.tsx";
import { formatMinor } from "../../lib/format.ts";
import { approvalTargets } from "./shared.tsx";

const TEMPLATE_FOR: Record<string, string> = { decline_application: "builtin:decline" };

export function ApprovalDetail({ approvalId, base, title }: { approvalId: string; base: string; title: string }) {
  const [letter, setLetter] = useState(0);
  const detail = useApiQuery(
    async (api) => {
      const approval = await api.getApproval(approvalId);
      const targets = approvalTargets(approval.input);
      const applications = await Promise.all(targets.map((id) => api.getApplication(id).catch(() => null)));
      return { approval, applications: applications.filter((a) => a !== null) };
    },
    [approvalId],
  );
  const input = (detail.data?.approval.input ?? {}) as Record<string, unknown>;
  const templateId = typeof input.letterTemplateId === "string" ? input.letterTemplateId : typeof input.templateId === "string" ? input.templateId : detail.data ? TEMPLATE_FOR[detail.data.approval.tool] : undefined;
  const apps = detail.data?.applications ?? [];
  const index = Math.min(letter, Math.max(0, apps.length - 1));
  const current = apps[index];
  const preview = useApiQuery(async (api) => (templateId && current ? api.renderTemplate(templateId, { applicationId: current.id, ...(typeof input.rationale === "string" ? { fields: { decision: { message: input.rationale } } } : {}) }) : null), [templateId, current?.id]);

  return (
    <section className="card" aria-labelledby="request-detail-h">
      <div className="card-h">
        <h3 id="request-detail-h">Request detail</h3>
        <span className="small muted">{title}</span>
      </div>
      <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        {detail.status === "loading" && <Loading label="Loading the request" />}
        {detail.status === "error" && <ErrorBanner error={detail.error} onRetry={detail.reload} />}
        {detail.data && (
          <>
            <div className="col" style={{ gap: "6px" }}>
              <span className="eyebrow">Exact inputs</span>
              <pre tabIndex={0} aria-label="Tool input as the agent sent it" style={{ margin: 0, maxHeight: "200px", overflow: "auto" }}>
                {JSON.stringify({ tool: detail.data.approval.tool, input: detail.data.approval.input }, null, 2)}
              </pre>
            </div>
            {apps.length > 0 && (
              <div className="col" style={{ gap: "6px" }}>
                <span className="eyebrow">{apps.length === 1 ? "1 application affected" : `${apps.length} applications affected`}</span>
                <div className="tbl-wrap" tabIndex={0} role="region" aria-label="Applications affected, scrollable">
                  <table className="tbl mini" aria-label="Applications affected">
                    <thead>
                      <tr>
                        <th>Applicant</th>
                        <th>Failed rule</th>
                        <th className="num">Requested</th>
                      </tr>
                    </thead>
                    <tbody>
                      {apps.map((a) => {
                        const failed = a.eligibilityResults?.results.filter((r) => r.outcome === "fail") ?? [];
                        const unknown = a.eligibilityResults?.results.filter((r) => r.outcome === "unknown") ?? [];
                        return (
                          <tr key={a.id}>
                            <td>
                              <Link to={`${base}/applications/${a.id}`} className="b">
                                {a.applicant.name ?? "Applicant"}
                              </Link>
                            </td>
                            <td>{failed.length ? failed.map((r) => r.label).join("; ") : unknown.length ? `Unknown: ${unknown.map((r) => r.label).join("; ")}` : "None — every rule passes"}</td>
                            <td className="num">{formatMinor(a.requestedAmountMinor, a.currency)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            {templateId && current && (
              <div className="col" style={{ gap: "6px" }}>
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <span className="eyebrow">
                    Letter preview · {index + 1} of {apps.length}
                  </span>
                  <span className="row" style={{ gap: "4px" }}>
                    <button type="button" className="iconbtn" aria-label="Previous letter" disabled={index === 0} onClick={() => setLetter(index - 1)}>
                      <ChevronLeft className="ic" aria-hidden="true" />
                    </button>
                    <button type="button" className="iconbtn" aria-label="Next letter" disabled={index >= apps.length - 1} onClick={() => setLetter(index + 1)}>
                      <ChevronRight className="ic" aria-hidden="true" />
                    </button>
                  </span>
                </div>
                {preview.status === "loading" && <Loading label="Rendering the letter" />}
                {preview.status === "error" && <ErrorBanner error={preview.error} title="This letter could not be rendered" />}
                {preview.data && (
                  <div className="letter" aria-label={`Letter to ${current.applicant.name ?? "the applicant"}`} role="group">
                    {preview.data.subject && <div className="b">{preview.data.subject}</div>}
                    <div style={{ whiteSpace: "pre-wrap" }}>{preview.data.text}</div>
                  </div>
                )}
                <p className="small muted">Rendered by the server from the template with each applicant’s own fields. Identifiers are never merged into outgoing mail.</p>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
