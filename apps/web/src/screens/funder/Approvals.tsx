// SPDX-License-Identifier: AGPL-3.0-only
// Approvals: the human gate for agent actions. A pending card names the agent, the action it
// asked for and what approving would do; approving runs the action once, as the approver.
// Resolved requests keep who decided and when.
import { useState } from "react";
import { Link } from "react-router";
import { Bot, Check, CircleCheck, CircleX, Clock, TriangleExclamationPoint, X } from "lucide-react";
import { useApiMutation, useApiQuery } from "../../api/hooks.ts";
import type { Approval } from "../../api/funder.ts";
import { useWorkspace } from "../../app/workspace.tsx";
import { FunderShell } from "../../components/shells.tsx";
import { EmptyState, ErrorBanner, Loading, PageHeader } from "../../components/ui.tsx";
import { ApprovalDetail } from "./ApprovalDetail.tsx";
import { approvalTargets, dateTime, timeAgo, usePeople } from "./shared.tsx";
import { t } from "./i18n.ts";

const TOOL_TEXT: Record<string, (n: number) => string> = {
  decline_application: (n) => `Decline ${n === 1 ? "1 application" : `${n} applications`} and send the decline letter`,
  send_communication: () => "Send a templated message",
  commit_decisions: () => "Commit panel decisions",
  release_tranche: () => "Release a payment",
};
export const approvalTitle = (a: Approval) => TOOL_TEXT[a.tool]?.(Math.max(1, approvalTargets(a.input).length)) ?? a.description ?? a.tool.replace(/_/g, " ");
const impactOf = (a: Approval) => {
  const n = approvalTargets(a.input).length;
  if (a.tool === "decline_application") return `Will send ${n} ${n === 1 ? "letter" : "letters"} and set ${n} ${n === 1 ? "status" : "statuses"} to Declined`;
  return "Runs once, as you, when approved";
};

const RESOLVED_LOOK: Record<string, { label: string; tone: string; icon: typeof Check }> = {
  approved: { label: "Approved", tone: "ok", icon: CircleCheck },
  executed: { label: "Approved and done", tone: "ok", icon: CircleCheck },
  failed: { label: "Approved, but the action failed", tone: "dng", icon: TriangleExclamationPoint },
  rejected: { label: "Rejected", tone: "neutral", icon: CircleX },
  expired: { label: "Expired", tone: "neutral", icon: Clock },
};

/** One pending request. Also shown on the dashboard. */
export function ApprovalCard({ approval, base, onResolved, onOpen }: { approval: Approval; base: string; onResolved: () => void; onOpen?: () => void }) {
  const [note, setNote] = useState("");
  const decide = useApiMutation((api, approve: boolean) => api.decideApproval(approval.id, { approve, ...(note.trim() ? { note: note.trim() } : {}) }));
  const targets = approvalTargets(approval.input);
  const input = (approval.input ?? {}) as Record<string, unknown>;
  return (
    <article className="apr" aria-label={t("funderApprovals.approvalRequest", { approvalTitle: approvalTitle(approval) })}>
      <div className="hd">
        <Bot className="ic" aria-hidden="true" />
        {approval.requestedBy.clientId ?? t("funderApprovals.anAgent")} {t.rich("funderApprovals.requestsApproval", { timeAgo: timeAgo(approval.createdAt), span: (chunks) => <span style={{ marginLeft: "auto", fontWeight: 400, color: "#3C2380" }}>{chunks}</span> })}
      </div>
      <div className="bd">
        <div className="b" style={{ fontSize: "15px", color: "#0D2A43" }}>
          {approvalTitle(approval)}
        </div>
        <dl className="kv">
          <dt>{t("funderApprovals.tool")}</dt>
          <dd>
            {t.rich("funderApprovals.gated", { tool: approval.tool, span: (chunks) => <span className="mono">{chunks}</span> })}
          </dd>
          {typeof input.rationale === "string" && (
            <>
              <dt>{t("funderApprovals.why")}</dt>
              <dd>“{input.rationale}”</dd>
            </>
          )}
          {targets.length > 0 && (
            <>
              <dt>{t("funderApprovals.applications")}</dt>
              <dd>
                {targets.map((id, i) => (
                  <Link key={id} to={`${base}/applications/${id}`} style={{ marginRight: "8px" }}>
                    {t("funderApprovals.open")} {targets.length > 1 ? i + 1 : t("funderApprovals.application")}
                  </Link>
                ))}
              </dd>
            </>
          )}
        </dl>
        <div className="impact">
          <TriangleExclamationPoint className="ic" aria-hidden="true" style={{ color: "#7A4A00" }} />
          {impactOf(approval)}
        </div>
        <label className="sr" htmlFor={`note-${approval.id}`}>
          {t("funderApprovals.noteOptional")}
        </label>
        <input className="inp" id={`note-${approval.id}`} placeholder={t("funderApprovals.noteOptionalKeptWith")} value={note} onChange={(e) => setNote(e.target.value)} />
        {decide.error !== null && <ErrorBanner error={decide.error} />}
      </div>
      <div className="ft">
        <button type="button" className="btn btn-primary" disabled={decide.state === "saving"} onClick={async () => (await decide.run(true)) && onResolved()}>
          <Check className="ic" aria-hidden="true" />
          {t("funderApprovals.approve")}
        </button>
        <button type="button" className="btn btn-danger" disabled={decide.state === "saving"} onClick={async () => (await decide.run(false)) && onResolved()}>
          <X className="ic" aria-hidden="true" />
          {t("funderApprovals.reject")}
        </button>
        {onOpen && (
          <button type="button" className="btn btn-ghost" style={{ marginLeft: "auto" }} onClick={onOpen}>
            {t("funderApprovals.requestDetail")}
          </button>
        )}
      </div>
    </article>
  );
}

export default function Approvals() {
  const ws = useWorkspace("funder");
  const base = `/w/${ws.handle}`;
  const { person } = usePeople();
  const all = useApiQuery((api) => api.listApprovals(), []);
  const pending = all.data?.filter((a) => a.status === "pending") ?? [];
  const resolved = all.data?.filter((a) => a.status !== "pending") ?? [];
  const [opened, setOpened] = useState<string | null>(null);
  const shown = all.data?.find((a) => a.id === opened) ?? pending[0] ?? null;
  return (
    <>
      <title>{t("funderApprovals.approvals", { name: ws.name })}</title>
      <FunderShell active="Approvals">
        <main className="main">
          <PageHeader
            crumbs={[{ label: ws.name, to: base }, { label: t("funderApprovals.approvals2") }]}
            title={t("funderApprovals.approvals2")}
            meta={
              <>
                <span>{t("funderApprovals.pending", { count: pending.length })}</span>
                <span>·</span>
                <span>{t("funderApprovals.agentsProposePeopleDecide")}</span>
              </>
            }
            actions={
              <Link to={`${base}/settings/mcp`} className="btn btn-secondary">
                {t("funderApprovals.humanGates")}
              </Link>
            }
          />
          {all.status === "loading" && <Loading label={t("funderApprovals.loadingApprovals")} />}
          {all.status === "error" && <ErrorBanner error={all.error} onRetry={all.reload} />}
          {all.status === "ready" && (
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.2fr) minmax(0, 1fr)", gap: "20px", alignItems: "start" }}>
              <section className="col" style={{ gap: "16px" }} aria-label={t("funderApprovals.pending2")}>
                {pending.length === 0 && (
                  <div className="card">
                    <EmptyState icon={Bot} title={t("funderApprovals.noAgentRequests")}>
                      {t("funderApprovals.whenAConnectedAgent")}
                    </EmptyState>
                  </div>
                )}
                {pending.map((a) => (
                  <ApprovalCard key={a.id} approval={a} base={base} onResolved={all.reload} onOpen={() => setOpened(a.id)} />
                ))}
                {shown && <ApprovalDetail key={shown.id} approvalId={shown.id} base={base} title={approvalTitle(shown)} />}
              </section>
              <section className="card" aria-labelledby="resolved-h">
                <div className="card-h">
                  <h3 id="resolved-h">{t("funderApprovals.resolved")}</h3>
                  <span className="small muted">{resolved.length}</span>
                </div>
                {resolved.length === 0 ? (
                  <div className="card-b muted small">{t("funderApprovals.nothingResolvedYet")}</div>
                ) : (
                  <ul>
                    {resolved.map((a) => {
                      const look = RESOLVED_LOOK[a.status] ?? RESOLVED_LOOK.rejected!;
                      const Icon = look.icon;
                      return (
                        <li key={a.id} style={{ padding: "12px 20px", borderBottom: "1px solid #EEF3F3", display: "flex", flexDirection: "column", gap: "4px" }}>
                          <div className="row" style={{ justifyContent: "space-between", gap: "8px" }}>
                            <span className="b">{approvalTitle(a)}</span>
                            <span className={`bdg bdg-${look.tone}`}>
                              <Icon className="ic" aria-hidden="true" />
                              {look.label}
                            </span>
                          </div>
                          <div className="attrib">
                            <Bot className="ic" aria-hidden="true" />
                            <span className="ag">{a.requestedBy.clientId ?? t("funderApprovals.anAgent")}</span>
                            {a.decidedAt && (
                              <span>
                                {t("funderApprovals.decidedBy")} {person(a.decidedBy)?.name ?? t("funderApprovals.aMember")} · {dateTime(a.decidedAt)}
                              </span>
                            )}
                          </div>
                          <div className="row small" style={{ gap: "12px" }}>
                            <span className="muted">{t("funderApprovals.requested", { dateTime: dateTime(a.createdAt) })}</span>
                            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setOpened(a.id)} aria-label={t("funderApprovals.requestDetail2", { approvalTitle: approvalTitle(a) })}>
                              {t("funderApprovals.requestDetail")}
                            </button>
                          </div>
                          {a.note && <div className="small muted">“{a.note}”</div>}
                          {a.error && <div className="err-msg">{a.error}</div>}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            </div>
          )}
        </main>
      </FunderShell>
    </>
  );
}
