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
import { VerificationBadge } from "../../components/status.tsx";
import { ReviewSettingsCard } from "./ReviewParity.tsx";
import { readyToCommit } from "../../lib/panelNav.ts";
import { t, useFunderMessages } from "./i18n.ts";

const REVIEWER_ROLES = ["reviewer", "external_reviewer", "program_officer", "admin", "finance"];
const STATUS_TEXT: Record<Assignment["status"], () => string> = {
  assigned: () => t("reviewAssignment.status.assigned"),
  coi_declared: () => t("reviewAssignment.status.coiDeclared"),
  in_progress: () => t("reviewAssignment.status.inProgress"),
  submitted: () => t("reviewAssignment.status.submitted"),
  recused: () => t("reviewAssignment.status.recused"),
};

function AutoAssignDialog({ competitionId, stage, onClose, onDone }: { competitionId: string; stage: string; onClose: () => void; onDone: (r: AutoAssignResult) => void }) {
  const [per, setPer] = useState("2");
  const [plan, setPlan] = useState<AutoAssignResult | null>(null);
  const run = useApiMutation((api, dryRun: boolean) => api.autoAssign({ competitionId, stage, reviewersPerApplication: Math.max(1, Number(per) || 1), dryRun }));
  return (
    <Dialog open onClose={onClose} labelledBy="auto-title">
      <div className="hd">
        <h2 id="auto-title">{t("reviewAssignment.autoAssignReviewers")}</h2>
      </div>
      <div className="bd">
        {run.error !== null && <ErrorBanner error={run.error} />}
        <Field id="auto-per" label={t("reviewAssignment.reviewersPerApplication")} help={t("reviewAssignment.fillsTheGapsOnly")}>
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
          <Notice tone={plan.unfilled.length ? "warn" : "info"} title={t("reviewAssignment.newWouldBeMade", { count: plan.assignments.length })}>
            {plan.unfilled.length > 0 && t("reviewAssignment.applicationSWouldStill", { count: plan.unfilled.length })}
            {plan.unfilled.length > 0 && plan.coiFlags.length > 0 && " "}
            {plan.coiFlags.length > 0 && t("reviewAssignment.possibleConflictSWere", { count: plan.coiFlags.length })}
          </Notice>
        )}
        {plan && plan.coiHints.length > 0 && (
          <Notice tone="warn" title={t("reviewAssignment.checkForAConflict", { count: plan.coiHints.length })}>
            {t("reviewAssignment.theApplicantsOwnProfile")}
          </Notice>
        )}
      </div>
      <div className="ft">
        <button type="button" className="btn btn-secondary" onClick={onClose}>
          {t("reviewAssignment.cancel")}
        </button>
        {!plan ? (
          <button type="button" className="btn btn-primary" disabled={run.state === "saving"} onClick={async () => setPlan((await run.run(true)) ?? null)}>
            {t("reviewAssignment.preview")}
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
            {t("reviewAssignment.assign", { count: plan.assignments.length })}
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
          <h2 id="invite-title">{t("reviewAssignment.inviteAnExternalReviewer")}</h2>
        </div>
        <div className="bd">
          {invite.error !== null && <ErrorBanner error={invite.error} />}
          <Field id="invite-email" label={t("reviewAssignment.email")} required help={t("reviewAssignment.theySeeOnlyThe")}>
            <input className="inp" id="invite-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </Field>
        </div>
        <div className="ft">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {t("reviewAssignment.cancel")}
          </button>
          <button type="submit" className="btn btn-primary" disabled={invite.state === "saving" || !email.trim()}>
            {t("reviewAssignment.sendInvitation")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export default function ReviewAssignment() {
  useFunderMessages();
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
  const [hint, setHint] = useState<string | null>(null);
  const toggle = useApiMutation(async (api, applicationId: string, reviewer: Person, existing: Assignment | undefined) => {
    if (existing) return api.updateAssignment(existing.id, { action: "recuse", reason: t("reviewAssignment.removedByStaff") });
    return api.createAssignment({ applicationId, reviewerUserId: reviewer.userId, ...(stage ? { stage: stage.key } : {}) });
  });

  const rows = (apps.data ?? []).filter((a) => !["declined", "withdrawn", "draft"].includes(a.status));
  const all = assignments.data ?? [];
  const ids = new Set([...people.filter((p) => REVIEWER_ROLES.includes(p.role)).map((p) => p.userId), ...all.map((a) => a.reviewerUserId)]);
  const reviewers = [...ids].map((id) => person(id)!);
  const cell = (appId: string, userId: string) => all.filter((a) => a.applicationId === appId && a.reviewerUserId === userId).sort((p, q) => (p.status === "recused" ? 1 : 0) - (q.status === "recused" ? 1 : 0))[0];
  const active = (appId: string) => all.filter((a) => a.applicationId === appId && a.status !== "recused").length;
  const loading = competitions.status === "loading" || apps.status === "loading" || assignments.status === "loading";
  const ready = readyToCommit(competitions.data ?? []);

  return (
    <>
      <title>{t("reviewAssignment.reviewAssignment", { name: ws.name })}</title>
      <FunderShell active="Reviews">
        <main className="main">
          <PageHeader
            crumbs={[{ label: ws.name, to: base }, { label: t("reviewAssignment.reviews") }, { label: t("reviewAssignment.assign2") }]}
            title={t("reviewAssignment.reviewAssignment2")}
            meta={
              competition && stage ? (
                <>
                  <span>{competition.title}</span>
                  <span>·</span>
                  <label className="row">
                    {t("reviewAssignment.stage")}
                    <select className="sel" style={{ width: "auto", height: "28px" }} value={stage.key} onChange={(e) => setParams({ competition: competition.id, stage: e.target.value })}>
                      {competition.stages.map((s) => (
                        <option key={s.key} value={s.key}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <span>·</span>
                  <span>{t("reviewAssignment.applications", { count: rows.length })}</span>
                </>
              ) : undefined
            }
            actions={
              competition && stage ? (
                <>
                  <button type="button" className="btn btn-secondary" onClick={() => setDialog("auto")}>
                    <Zap className="ic" aria-hidden="true" />
                    {t("reviewAssignment.autoAssign")}
                  </button>
                  <button type="button" className="btn btn-secondary" onClick={() => setDialog("invite")}>
                    <UserPlus className="ic" aria-hidden="true" />
                    {t("reviewAssignment.inviteExternalReviewer")}
                  </button>
                  <Link to="/review/assignments" className="btn btn-secondary">
                    {t("reviewAssignment.myAssignments")}
                  </Link>
                  <Link to={`${base}/competitions/${competition.id}/panel`} className="btn btn-primary">
                    {t("reviewAssignment.openPanel")}
                  </Link>
                </>
              ) : undefined
            }
          />
          {ready.length > 1 && (
            <section id="panels" className="card" aria-labelledby="panels-h">
              <div className="card-h">
                <h2 id="panels-h">{t("funderPanel.panelAndDecisions")}</h2>
              </div>
              <ul className="card-b" style={{ margin: 0, display: "flex", flexDirection: "column", gap: "8px" }}>
                {ready.map((c) => (
                  <li key={c.id}>
                    <Link to={`${base}/competitions/${c.id}/panel`}>{c.title}</Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {note && (
            <div className="bnr bnr-ok" role="status">
              <div className="t">{note}</div>
            </div>
          )}
          {hint && <Notice tone="warn" title={t("reviewAssignment.checkThisAssignmentFor")}>{hint}</Notice>}
          {toggle.error !== null && <ErrorBanner error={toggle.error} title={t("reviewAssignment.thatAssignmentWasNot")} />}
          {competition && stage && <ReviewSettingsCard key={`${competition.id}:${stage.key}`} competitionId={competition.id} stageKey={stage.key} />}
          {loading && <Loading label={t("reviewAssignment.loadingAssignments")} />}
          {assignments.status === "error" && <ErrorBanner error={assignments.error} onRetry={assignments.reload} />}
          {!loading && !competition && (
            <EmptyState icon={ClipboardCheck} title={t("reviewAssignment.noCompetitionToReview")}>
              {t("reviewAssignment.openACompetitionAnd")}
            </EmptyState>
          )}
          {!loading && competition && rows.length === 0 && (
            <EmptyState icon={ClipboardCheck} title={t("reviewAssignment.noApplicationsAtThis")}>
              {t("reviewAssignment.advanceApplicationsToThis")}
            </EmptyState>
          )}
          {!loading && rows.length > 0 && (
            <div className="tbl-wrap" tabIndex={0} role="region" aria-label={t("reviewAssignment.reviewersByApplicationScrollable")}>
              <table className="tbl mx" aria-label={t("reviewAssignment.reviewersByApplication")}>
                <thead>
                  <tr>
                    <th>{t("reviewAssignment.reviewer")}</th>
                    {rows.map((a) => (
                      <th key={a.id}>
                        <div className="col" style={{ gap: "2px", alignItems: "center" }}>
                          <Link to={`${base}/applications/${a.id}`}>{a.applicant.name ?? a.title}</Link>
                          <VerificationBadge verification={a.applicant.verification} level={a.applicant.level} />
                          <span className="xs muted" style={{ textTransform: "none", letterSpacing: 0 }}>
                            {t("reviewAssignment.assigned", { active: active(a.id) })}
                          </span>
                        </div>
                      </th>
                    ))}
                    <th className="num">{t("reviewAssignment.load")}</th>
                  </tr>
                </thead>
                <tbody>
                  {reviewers.map((r) => (
                    <tr key={r.userId}>
                      <td style={{ padding: "6px 12px" }}>
                        <div className="ent">
                          <span className="nm">{r.name}</span>
                          <span className="small muted">{r.role.replace(/_/g, " ") || t("reviewAssignment.reviewer2")}</span>
                        </div>
                      </td>
                      {rows.map((a) => {
                        const x = cell(a.id, r.userId);
                        const coi = x?.status === "recused" && x.coi.declared === true;
                        const on = !!x && x.status !== "recused";
                        const locked = x?.status === "submitted" || x?.status === "in_progress";
                        const label = t("reviewAssignment.cellLabel", { reviewer: r.name, application: a.applicant.name ?? a.title, state: coi ? t("reviewAssignment.state.coi") : x ? STATUS_TEXT[x.status]() : t("reviewAssignment.state.notAssigned") });
                        return (
                          <td key={a.id}>
                            <button
                              type="button"
                              className={coi ? "cell coi" : on ? "cell on" : "cell"}
                              aria-pressed={on}
                              aria-label={label}
                              title={label}
                              disabled={coi || locked || toggle.state === "saving"}
                              onClick={async () => {
                                const out = await toggle.run(a.id, r, on ? x : undefined);
                                if (!out) return;
                                setHint(out.coiHint?.detail ?? null);
                                assignments.reload();
                              }}
                            >
                              {coi ? <Slash className="ic ic-sm" aria-hidden="true" /> : on ? <Check className="ic ic-sm" aria-hidden="true" /> : null}
                            </button>
                            {x && !coi && x.status !== "assigned" && x.status !== "recused" && <div className="xs muted">{STATUS_TEXT[x.status]()}</div>}
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
          <p className="notice">{t("reviewAssignment.aHatchedCellIs")}</p>
        </main>
      </FunderShell>
      {dialog === "auto" && competition && stage && (
        <AutoAssignDialog
          competitionId={competition.id}
          stage={stage.key}
          onClose={() => setDialog(null)}
          onDone={(r) => {
            setDialog(null);
            setNote(r.unfilled.length ? t("reviewAssignment.done.madeShort", { count: r.created, short: r.unfilled.length }) : t("reviewAssignment.done.made", { count: r.created }));
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
            setNote(i.emailed ? t("reviewAssignment.done.invited", { email: i.email }) : t("reviewAssignment.done.inviteNotSent", { email: i.email }));
          }}
        />
      )}
    </>
  );
}
