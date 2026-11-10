// SPDX-License-Identifier: AGPL-3.0-only
// Review assignment matrix: reviewers down the side, applications across. A cell assigns or
// removes one reviewer; auto-assign fills the gaps by capacity and shows what it would do before
// doing it; a conflict of interest shows as a hatched cell that cannot be assigned.
import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { Check, ClipboardCheck, Slash, UserPlus, Zap } from "lucide-react";
import { useApiMutation, useApiQuery } from "../../api/hooks.ts";
import type { AutoAssignResult, ReviewAssignment as Assignment, ReviewerInvitation } from "../../api/funder.ts";
import { useWorkspace } from "../../app/workspace.tsx";
import { Dialog } from "../../components/Dialog.tsx";
import { FunderShell } from "../../components/shells.tsx";
import { EmptyState, ErrorBanner, Field, Loading, Notice, PageHeader } from "../../components/ui.tsx";
import { usePeople, type Person } from "./shared.tsx";

const REVIEWER_ROLES = ["reviewer", "external_reviewer", "program_officer", "admin", "finance"];
const STATUS_TEXT: Record<Assignment["status"], string> = { assigned: "Assigned", coi_declared: "No conflict declared", in_progress: "Scoring", submitted: "Submitted", recused: "Recused" };

function AutoAssignDialog({ competitionId, stage, onClose, onDone }: { competitionId: string; stage: string; onClose: () => void; onDone: (r: AutoAssignResult) => void }) {
  const [per, setPer] = useState("2");
  const [plan, setPlan] = useState<AutoAssignResult | null>(null);
  const run = useApiMutation((api, dryRun: boolean) => api.autoAssign({ competitionId, stage, reviewersPerApplication: Math.max(1, Number(per) || 1), dryRun }));
  return (
    <Dialog open onClose={onClose} labelledBy="auto-title">
      <div className="hd">
        <h2 id="auto-title">Auto-assign reviewers</h2>
      </div>
      <div className="bd">
        {run.error !== null && <ErrorBanner error={run.error} />}
        <Field id="auto-per" label="Reviewers per application" help="Fills the gaps only; existing assignments stay. Declared conflicts are skipped.">
          <input
            className="inp"
            id="auto-per"
            inputMode="numeric"
            value={per}
            onChange={(e) => {
              setPer(e.target.value);
              setPlan(null);
            }}
            style={{ width: "100px" }}
          />
        </Field>
        {plan && (
          <Notice tone={plan.unfilled.length ? "warn" : "info"} title={`${plan.assignments.length} new ${plan.assignments.length === 1 ? "assignment" : "assignments"} would be made`}>
            {plan.unfilled.length > 0 && `${plan.unfilled.length} application(s) would still be short of reviewers. `}
            {plan.coiFlags.length > 0 && `${plan.coiFlags.length} possible conflict(s) were skipped.`}
          </Notice>
        )}
      </div>
      <div className="ft">
        <button type="button" className="btn btn-secondary" onClick={onClose}>
          Cancel
        </button>
        {!plan ? (
          <button type="button" className="btn btn-primary" disabled={run.state === "saving"} onClick={async () => setPlan((await run.run(true)) ?? null)}>
            Preview
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-primary"
            disabled={run.state === "saving" || plan.assignments.length === 0}
            onClick={async () => {
              const r = await run.run(false);
              if (r) onDone(r);
            }}
          >
            Assign {plan.assignments.length}
          </button>
        )}
      </div>
    </Dialog>
  );
}

function InviteDialog({ competitionId, onClose, onDone }: { competitionId: string; onClose: () => void; onDone: (i: ReviewerInvitation) => void }) {
  const [email, setEmail] = useState("");
  const invite = useApiMutation((api) => api.inviteReviewer({ email: email.trim(), competitionId }));
  return (
    <Dialog open onClose={onClose} labelledBy="invite-title">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const r = await invite.run();
          if (r) onDone(r);
        }}
      >
        <div className="hd">
          <h2 id="invite-title">Invite an external reviewer</h2>
        </div>
        <div className="bd">
          {invite.error !== null && <ErrorBanner error={invite.error} />}
          <Field id="invite-email" label="Email" required help="They see only the applications assigned to them in this competition, with personal details masked.">
            <input className="inp" id="invite-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </Field>
        </div>
        <div className="ft">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={invite.state === "saving" || !email.trim()}>
            Send invitation
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export default function ReviewAssignment() {
  const ws = useWorkspace("funder");
  const base = `/w/${ws.handle}`;
  const [params, setParams] = useSearchParams();
  const { people, person } = usePeople();
  const competitions = useApiQuery((api) => api.listCompetitions(), []);
  const competition = competitions.data?.find((c) => c.id === params.get("competition")) ?? competitions.data?.[0];
  const stage = competition?.stages.find((s) => s.key === params.get("stage")) ?? competition?.stages[competition.stages.length - 1];
  const apps = useApiQuery(async (api) => (competition && stage ? (await api.listApplications({ competitionId: competition.id, stage: stage.key, pageSize: 100 })).items : []), [competition?.id, stage?.key]);
  const assignments = useApiQuery(async (api) => (competition && stage ? api.listAssignments({ competitionId: competition.id, stage: stage.key }) : []), [competition?.id, stage?.key]);
  const [dialog, setDialog] = useState<"auto" | "invite" | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const toggle = useApiMutation(async (api, applicationId: string, reviewer: Person, existing: Assignment | undefined) => {
    if (existing) return api.updateAssignment(existing.id, { action: "recuse", reason: "Removed by program staff" });
    return api.createAssignment({ applicationId, reviewerUserId: reviewer.userId, ...(stage ? { stage: stage.key } : {}) });
  });

  const rows = (apps.data ?? []).filter((a) => !["declined", "withdrawn", "draft"].includes(a.status));
  const all = assignments.data ?? [];
  const ids = new Set([...people.filter((p) => REVIEWER_ROLES.includes(p.role)).map((p) => p.userId), ...all.map((a) => a.reviewerUserId)]);
  const reviewers = [...ids].map((id) => person(id)!);
  const cell = (appId: string, userId: string) => all.filter((a) => a.applicationId === appId && a.reviewerUserId === userId).sort((p, q) => (p.status === "recused" ? 1 : 0) - (q.status === "recused" ? 1 : 0))[0];
  const active = (appId: string) => all.filter((a) => a.applicationId === appId && a.status !== "recused").length;
  const loading = competitions.status === "loading" || apps.status === "loading" || assignments.status === "loading";

  return (
    <>
      <title>{`Review assignment — ${ws.name}`}</title>
      <FunderShell active="Reviews">
        <main className="main">
          <PageHeader
            crumbs={[{ label: ws.name, to: base }, { label: "Reviews" }, { label: "Assign" }]}
            title="Review assignment"
            meta={
              competition && stage ? (
                <>
                  <span>{competition.title}</span>
                  <span>·</span>
                  <label className="row">
                    Stage
                    <select className="sel" style={{ width: "auto", height: "28px" }} value={stage.key} onChange={(e) => setParams({ competition: competition.id, stage: e.target.value })}>
                      {competition.stages.map((s) => (
                        <option key={s.key} value={s.key}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <span>·</span>
                  <span>{rows.length} applications</span>
                </>
              ) : undefined
            }
            actions={
              competition && stage ? (
                <>
                  <button type="button" className="btn btn-secondary" onClick={() => setDialog("auto")}>
                    <Zap className="ic" aria-hidden="true" />
                    Auto-assign…
                  </button>
                  <button type="button" className="btn btn-secondary" onClick={() => setDialog("invite")}>
                    <UserPlus className="ic" aria-hidden="true" />
                    Invite external reviewer…
                  </button>
                  <Link to="/review/assignments" className="btn btn-secondary">
                    My assignments
                  </Link>
                  <Link to={`${base}/competitions/${competition.id}/panel`} className="btn btn-primary">
                    Open panel
                  </Link>
                </>
              ) : undefined
            }
          />
          {note && (
            <div className="bnr bnr-ok" role="status">
              <div className="t">{note}</div>
            </div>
          )}
          {toggle.error !== null && <ErrorBanner error={toggle.error} title="That assignment was not changed" />}
          {loading && <Loading label="Loading assignments" />}
          {assignments.status === "error" && <ErrorBanner error={assignments.error} onRetry={assignments.reload} />}
          {!loading && !competition && (
            <EmptyState icon={ClipboardCheck} title="No competition to review yet">
              Open a competition and reviews are assigned here once applications arrive.
            </EmptyState>
          )}
          {!loading && competition && rows.length === 0 && (
            <EmptyState icon={ClipboardCheck} title="No applications at this stage">
              Advance applications to this stage, then assign reviewers.
            </EmptyState>
          )}
          {!loading && rows.length > 0 && (
            <div className="tbl-wrap" tabIndex={0} role="region" aria-label="Reviewers by application, scrollable">
              <table className="tbl mx" aria-label="Reviewers by application">
                <thead>
                  <tr>
                    <th>Reviewer</th>
                    {rows.map((a) => (
                      <th key={a.id}>
                        <div className="col" style={{ gap: "2px", alignItems: "center" }}>
                          <Link to={`${base}/applications/${a.id}`}>{a.applicant.name ?? a.title}</Link>
                          <span className="xs muted" style={{ textTransform: "none", letterSpacing: 0 }}>
                            {active(a.id)} assigned
                          </span>
                        </div>
                      </th>
                    ))}
                    <th className="num">Load</th>
                  </tr>
                </thead>
                <tbody>
                  {reviewers.map((r) => (
                    <tr key={r.userId}>
                      <td style={{ padding: "6px 12px" }}>
                        <div className="ent">
                          <span className="nm">{r.name}</span>
                          <span className="small muted">{r.role.replace(/_/g, " ") || "reviewer"}</span>
                        </div>
                      </td>
                      {rows.map((a) => {
                        const x = cell(a.id, r.userId);
                        const coi = x?.status === "recused" && x.coi.declared === true;
                        const on = !!x && x.status !== "recused";
                        const locked = x?.status === "submitted" || x?.status === "in_progress";
                        const label = `${r.name} on ${a.applicant.name ?? a.title}: ${coi ? "conflict of interest declared" : x ? STATUS_TEXT[x.status] : "not assigned"}`;
                        return (
                          <td key={a.id}>
                            <button
                              type="button"
                              className={coi ? "cell coi" : on ? "cell on" : "cell"}
                              aria-pressed={on}
                              aria-label={label}
                              title={label}
                              disabled={coi || locked || toggle.state === "saving"}
                              onClick={async () => (await toggle.run(a.id, r, on ? x : undefined)) && assignments.reload()}
                            >
                              {coi ? <Slash className="ic ic-sm" aria-hidden="true" /> : on ? <Check className="ic ic-sm" aria-hidden="true" /> : null}
                            </button>
                            {x && !coi && x.status !== "assigned" && x.status !== "recused" && <div className="xs muted">{STATUS_TEXT[x.status]}</div>}
                          </td>
                        );
                      })}
                      <td className="num">{all.filter((a) => a.reviewerUserId === r.userId && a.status !== "recused").length}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="notice">A hatched cell is a declared conflict of interest. A reviewer who has started scoring cannot be removed here.</p>
        </main>
      </FunderShell>
      {dialog === "auto" && competition && stage && (
        <AutoAssignDialog
          competitionId={competition.id}
          stage={stage.key}
          onClose={() => setDialog(null)}
          onDone={(r) => {
            setDialog(null);
            setNote(`${r.created} ${r.created === 1 ? "assignment" : "assignments"} made${r.unfilled.length ? ` · ${r.unfilled.length} application(s) still short` : ""}`);
            assignments.reload();
          }}
        />
      )}
      {dialog === "invite" && competition && (
        <InviteDialog
          competitionId={competition.id}
          onClose={() => setDialog(null)}
          onDone={(i) => {
            setDialog(null);
            setNote(i.emailed ? `Invitation sent to ${i.email}` : `Invitation created for ${i.email}; the email could not be sent, share the link from Settings`);
          }}
        />
      )}
    </>
  );
}
