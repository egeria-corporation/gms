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
import { approvalTargets, dateTime, timeAgo, usePeople } from "./shared.tsx";

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
export function ApprovalCard({ approval, base, onResolved }: { approval: Approval; base: string; onResolved: () => void }) {
  const [note, setNote] = useState("");
  const decide = useApiMutation((api, approve: boolean) => api.decideApproval(approval.id, { approve, ...(note.trim() ? { note: note.trim() } : {}) }));
  const targets = approvalTargets(approval.input);
  const input = (approval.input ?? {}) as Record<string, unknown>;
  return (
    <article className="apr" aria-label={`Approval request: ${approvalTitle(approval)}`}>
      <div className="hd">
        <Bot className="ic" aria-hidden="true" />
        {approval.requestedBy.clientId ?? "An agent"} requests approval
        <span style={{ marginLeft: "auto", fontWeight: 400, color: "#3C2380" }}>{timeAgo(approval.createdAt)}</span>
      </div>
      <div className="bd">
        <div className="b" style={{ fontSize: "15px", color: "#0D2A43" }}>
          {approvalTitle(approval)}
        </div>
        <dl className="kv">
          <dt>Tool</dt>
          <dd>
            <span className="mono">{approval.tool}</span> · gated
          </dd>
          {typeof input.rationale === "string" && (
            <>
              <dt>Why</dt>
              <dd>“{input.rationale}”</dd>
            </>
          )}
          {targets.length > 0 && (
            <>
              <dt>Applications</dt>
              <dd>
                {targets.map((id, i) => (
                  <Link key={id} to={`${base}/applications/${id}`} style={{ marginRight: "8px" }}>
                    Open {targets.length > 1 ? i + 1 : "application"}
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
          Note (optional)
        </label>
        <input className="inp" id={`note-${approval.id}`} placeholder="Note (optional), kept with the decision" value={note} onChange={(e) => setNote(e.target.value)} />
        {decide.error !== null && <ErrorBanner error={decide.error} />}
      </div>
      <div className="ft">
        <button type="button" className="btn btn-primary" disabled={decide.state === "saving"} onClick={async () => (await decide.run(true)) && onResolved()}>
          <Check className="ic" aria-hidden="true" />
          Approve
        </button>
        <button type="button" className="btn btn-danger" disabled={decide.state === "saving"} onClick={async () => (await decide.run(false)) && onResolved()}>
          <X className="ic" aria-hidden="true" />
          Reject
        </button>
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
  return (
    <>
      <title>{`Approvals — ${ws.name}`}</title>
      <FunderShell active="Approvals">
        <main className="main">
          <PageHeader
            crumbs={[{ label: ws.name, to: base }, { label: "Approvals" }]}
            title="Approvals"
            meta={
              <>
                <span>{pending.length} pending</span>
                <span>·</span>
                <span>Agents propose; people decide. Signing, accepting an award and releasing a payment can never be approved for an agent.</span>
              </>
            }
            actions={
              <Link to={`${base}/settings/mcp`} className="btn btn-secondary">
                Human gates
              </Link>
            }
          />
          {all.status === "loading" && <Loading label="Loading approvals" />}
          {all.status === "error" && <ErrorBanner error={all.error} onRetry={all.reload} />}
          {all.status === "ready" && (
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.2fr) minmax(0, 1fr)", gap: "20px", alignItems: "start" }}>
              <section className="col" style={{ gap: "16px" }} aria-label="Pending">
                {pending.length === 0 && (
                  <div className="card">
                    <EmptyState icon={Bot} title="No agent requests">
                      When a connected agent calls a gated tool, the request waits here for a person.
                    </EmptyState>
                  </div>
                )}
                {pending.map((a) => (
                  <ApprovalCard key={a.id} approval={a} base={base} onResolved={all.reload} />
                ))}
              </section>
              <section className="card" aria-labelledby="resolved-h">
                <div className="card-h">
                  <h3 id="resolved-h">Resolved</h3>
                  <span className="small muted">{resolved.length}</span>
                </div>
                {resolved.length === 0 ? (
                  <div className="card-b muted small">Nothing resolved yet.</div>
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
                            <span className="ag">{a.requestedBy.clientId ?? "An agent"}</span>
                            {a.decidedAt && (
                              <span>
                                · decided by {person(a.decidedBy)?.name ?? "a member"} · {dateTime(a.decidedAt)}
                              </span>
                            )}
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
