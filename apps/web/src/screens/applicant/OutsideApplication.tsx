// SPDX-License-Identifier: AGPL-3.0-only
// One outside application: an application to a funder that is not on this GMS. The header says
// where it stands and offers the next move; the tabs hold the questions and answers, what has to
// be ready, where and how it was submitted, notes, and who did what.
import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { Archive, ArchiveArrowUp, Award, HandHelping, Pencil, RotateCcw, Scale, Send } from "lucide-react";
import type { ApplicantApi } from "../../api/applicant.ts";
import { useApplicantApi } from "../../api/applicantHooks.ts";
import type { OutsideApi, OutsideApplication as OutsideRecord } from "../../api/outside.ts";
import { useOutsideMutation, useOutsideQuery } from "../../api/outsideHooks.ts";
import { libraryWithMeta, type WriteKeepApi } from "../../api/writeKeep.ts";
import { useWriteKeepApi } from "../../api/writeKeepHooks.ts";
import { useServices } from "../../app/services.tsx";
import { useWorkspace } from "../../app/workspace.tsx";
import { isNotFound, Loaded } from "../../components/applicant.tsx";
import { NotFound } from "../../components/NotFound.tsx";
import { ApplicantShell } from "../../components/shells.tsx";
import { ErrorBanner, Notice, PageHeader, TabPanel, Tabs } from "../../components/ui.tsx";
import { formatDate } from "../../lib/format.ts";
import { canMarkSubmitted, canReopen, decisionOutcomes, MOVE_LABELS, plainMoves, STAGE_LABELS, type OutsideStage } from "../../lib/outside.ts";
import { ChecklistTab } from "./outside/ChecklistTab.tsx";
import { GoNoGoCard, NextCycleCard } from "./outside/decide.tsx";
import { ConsultingDialog, DecisionDialog, MarkSubmittedDialog } from "./outside/dialogs.tsx";
import { QuestionsTab } from "./outside/QuestionsTab.tsx";
import { DEADLINE_LABELS, DeadlineText, moneyText, StageBadge } from "./outside/shared.tsx";
import { ActivityTab, EditDetailsDialog, NotesTab, SubmissionTab } from "./outside/tabs.tsx";

type Tab = "questions" | "checklist" | "submission" | "notes" | "activity";
const TABS: Tab[] = ["questions", "checklist", "submission", "notes", "activity"];

const load = async (api: OutsideApi, applicant: ApplicantApi, wk: WriteKeepApi, id: string) => {
  const detail = await api.get(id);
  const [record, records, members, answers, org, settings] = await Promise.all([
    detail.funderRecordId ? api.funderRecord(detail.funderRecordId).catch(() => null) : Promise.resolve(null),
    api.funderRecords().catch(() => []),
    applicant.members().catch(() => []),
    // The library with when each answer was last verified and its variants.
    libraryWithMeta(() => applicant.answers(), wk).catch(() => []),
    applicant.organization().catch(() => null),
    wk.settings().catch(() => null),
  ]);
  return { detail, record, records, members, answers, org, settings };
};

export default function OutsideApplication() {
  const ws = useWorkspace("applicant");
  const base = `/w/${ws.handle}`;
  const { outsideId = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const applicant = useApplicantApi();
  const wk = useWriteKeepApi();
  const { meState } = useServices();
  const query = useOutsideQuery((api) => load(api, applicant, wk, outsideId), [outsideId, applicant, wk]);
  const asked = params.get("tab") as Tab | null;
  const [tab, setTabState] = useState<Tab>(asked && TABS.includes(asked) ? asked : "questions");
  const setTab = (t: Tab) => {
    setTabState(t);
    const next = new URLSearchParams(params);
    next.set("tab", t);
    setParams(next, { replace: true });
  };
  const [dialog, setDialog] = useState<null | "submit" | "decide" | "help" | "edit">(null);
  const [done, setDone] = useState<string | null>(null);
  const move = useOutsideMutation((api, to: OutsideStage) => api.move(outsideId, to));
  const reopen = useOutsideMutation((api) => api.reopen(outsideId));
  const archive = useOutsideMutation((api, on: boolean) => (on ? api.archive(outsideId) : api.unarchive(outsideId)));
  const after = (a: OutsideRecord | undefined, message: string) => {
    if (!a) return;
    setDialog(null);
    setDone(message);
    query.reload();
  };

  if (query.status === "error" && isNotFound(query.error)) return <NotFound />;
  const me = meState.status === "ready" ? meState.me : null;
  const contact = { name: me?.displayName || ws.member.name, email: me?.email ?? "" };

  return (
    <>
      <title>{query.status === "ready" ? `${query.data.detail.title} — ${ws.name}` : `Application — ${ws.name}`}</title>
      <ApplicantShell active="Applications">
        <main className="main">
          <Loaded query={query} label="Opening the application">
            {({ detail, record, records, members, answers, org, settings }) => {
              const archived = !!detail.archivedAt;
              const moves = archived ? [] : plainMoves(detail.stage);
              const outcomes = archived ? [] : decisionOutcomes(detail.stage);
              const owner = detail.owner ? (members.find((m) => m.userId === detail.owner!.userId)?.name ?? detail.owner.name ?? "A teammate") : null;
              const busy = move.state === "saving" || reopen.state === "saving" || archive.state === "saving";
              return (
                <>
                  <PageHeader
                    crumbs={[{ label: "Applications", to: `${base}/applications` }, { label: detail.title }]}
                    title={detail.title}
                    badge={
                      <>
                        <StageBadge stage={detail.stage} large />
                        {archived && (
                          <span className="bdg bdg-neutral bdg-lg">
                            <Archive className="ic" aria-hidden="true" />
                            Archived
                          </span>
                        )}
                      </>
                    }
                    meta={
                      <>
                        <span>
                          {record ? (
                            <Link to={`${base}/funders/${record.id}`} className="b">
                              {detail.funderName}
                            </Link>
                          ) : (
                            <span className="b">{detail.funderName}</span>
                          )}
                          {detail.programName ? ` · ${detail.programName}` : ""}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>Ask {moneyText(detail.askAmount)}</span>
                        <span aria-hidden="true">·</span>
                        <span>{owner ? `Owner: ${owner}` : "No owner"}</span>
                        {detail.awardedAmount && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="b">Awarded {moneyText(detail.awardedAmount)}</span>
                          </>
                        )}
                      </>
                    }
                    actions={
                      <>
                        {!archived && canMarkSubmitted(detail.stage) && (
                          <button type="button" className="btn btn-primary" aria-haspopup="dialog" onClick={() => setDialog("submit")}>
                            <Send className="ic" aria-hidden="true" />
                            Mark as submitted
                          </button>
                        )}
                        {outcomes.length > 0 && (
                          <button type="button" className={detail.stage === "submitted" ? "btn btn-primary" : "btn btn-secondary"} aria-haspopup="dialog" onClick={() => setDialog("decide")}>
                            <Scale className="ic" aria-hidden="true" />
                            Record decision
                          </button>
                        )}
                        {!archived && canReopen(detail.stage) && detail.previousStage && (
                          <button type="button" className="btn btn-secondary" disabled={busy} onClick={async () => after(await reopen.run(), `Reopened at ${STAGE_LABELS[detail.previousStage!]}`)}>
                            <RotateCcw className="ic" aria-hidden="true" />
                            Reopen
                          </button>
                        )}
                        {moves.length > 0 && (
                          <>
                            <label className="sr" htmlFor="oa-move">
                              Move to another stage
                            </label>
                            <select
                              id="oa-move"
                              className="sel"
                              style={{ width: "auto", height: "36px" }}
                              value=""
                              disabled={busy}
                              onChange={async (e) => {
                                const to = e.target.value as OutsideStage;
                                if (to) after(await move.run(to), `Moved to ${STAGE_LABELS[to]}`);
                              }}
                            >
                              <option value="" disabled>
                                Move to…
                              </option>
                              {moves.map((s) => (
                                <option key={s} value={s}>
                                  {MOVE_LABELS[s]}
                                </option>
                              ))}
                            </select>
                          </>
                        )}
                        <button type="button" className="btn btn-secondary" aria-haspopup="dialog" onClick={() => setDialog("help")}>
                          <HandHelping className="ic" aria-hidden="true" />
                          Get help writing this
                        </button>
                        {!archived && (
                          <button type="button" className="btn btn-ghost" aria-haspopup="dialog" onClick={() => setDialog("edit")}>
                            <Pencil className="ic" aria-hidden="true" />
                            Edit details
                          </button>
                        )}
                        <button type="button" className="btn btn-ghost" disabled={busy} onClick={async () => after(await archive.run(!archived), archived ? "Brought back from the archive" : "Archived. It no longer shows in your pipeline or the calendar feed.")}>
                          {archived ? <ArchiveArrowUp className="ic" aria-hidden="true" /> : <Archive className="ic" aria-hidden="true" />}
                          {archived ? "Unarchive" : "Archive"}
                        </button>
                      </>
                    }
                  />
                  <div className="row" style={{ gap: "24px", flexWrap: "wrap", fontSize: "14px" }} aria-label="Deadlines" role="group">
                    {(Object.keys(DEADLINE_LABELS) as (keyof typeof DEADLINE_LABELS)[]).map((k) => (
                      <div key={k} style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                        <span className="small muted">{DEADLINE_LABELS[k]}</span>
                        <DeadlineText date={detail[k]} />
                      </div>
                    ))}
                    {detail.rolling && (
                      <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                        <span className="small muted">Timing</span>
                        <span>Rolling</span>
                      </div>
                    )}
                  </div>
                  {done && <Notice tone="ok" title={done} />}
                  {archived && (
                    <Notice tone="neu" title="This application is archived">
                      It is kept for your records. Unarchive it to make changes.
                    </Notice>
                  )}
                  {[move.error, reopen.error, archive.error].map((e, i) => (e ? <ErrorBanner key={i} error={e} title="That change was not made" /> : null))}
                  <NextCycleCard detail={detail} />
                  <GoNoGoCard detail={detail} settings={settings} members={members} readOnly={archived} onDone={(a, message) => after(a, message)} />
                  {detail.stage === "awarded" && (
                    <div className="bnr bnr-ok" role="region" aria-label="Awarded">
                      <Award className="ic" aria-hidden="true" />
                      <div className="grow">
                        <div className="t">{detail.closedOutAt ? `Closed out on ${formatDate(detail.closedOutAt)}` : "Awarded. Keep track of what the grant asks of you."}</div>
                        <div className="d">Reports, conditions and payments received are kept on the award, under Awarded funding.</div>
                      </div>
                      <Link to={`${base}/grants/outside/${detail.id}`} className="btn btn-sm btn-secondary act">
                        Open the award
                      </Link>
                    </div>
                  )}
                  <Tabs<Tab>
                    label="Application sections"
                    idPrefix="oa"
                    active={tab}
                    onChange={setTab}
                    tabs={[
                      { key: "questions", label: "Questions", count: detail.questions.filter((q) => !q.obligationId).length },
                      { key: "checklist", label: "Checklist", count: detail.tasks.filter((t) => !t.doneAt).length || undefined },
                      { key: "submission", label: "Submission" },
                      { key: "notes", label: "Notes" },
                      { key: "activity", label: "Activity" },
                    ].map((t) => (t.count === undefined ? { key: t.key as Tab, label: t.label } : { key: t.key as Tab, label: t.label, count: t.count }))}
                  />
                  <TabPanel idPrefix="oa" tab="questions" active={tab}>
                    <QuestionsTab detail={detail} members={members} answers={answers} org={org} readOnly={archived} onChanged={query.reload} />
                  </TabPanel>
                  <TabPanel idPrefix="oa" tab="checklist" active={tab}>
                    <ChecklistTab detail={detail} members={members} readOnly={archived} onChanged={query.reload} />
                  </TabPanel>
                  <TabPanel idPrefix="oa" tab="submission" active={tab}>
                    <SubmissionTab detail={detail} record={record} base={base} readOnly={archived} onMarkSubmitted={() => setDialog("submit")} />
                  </TabPanel>
                  <TabPanel idPrefix="oa" tab="notes" active={tab}>
                    <NotesTab detail={detail} record={record} base={base} readOnly={archived} onChanged={query.reload} />
                  </TabPanel>
                  <TabPanel idPrefix="oa" tab="activity" active={tab}>
                    <ActivityTab detail={detail} members={members} />
                  </TabPanel>

                  {dialog === "submit" && <MarkSubmittedDialog app={detail} onClose={() => setDialog(null)} onDone={(a) => after(a, "Marked as submitted. The “as submitted” copy is on the Submission tab.")} />}
                  {dialog === "decide" && <DecisionDialog app={detail} onClose={() => setDialog(null)} onDone={(a) => after(a, `Decision recorded: ${STAGE_LABELS[a.stage]}`)} />}
                  {dialog === "help" && <ConsultingDialog app={detail} contact={contact} onClose={() => setDialog(null)} onSent={() => query.reload()} />}
                  {dialog === "edit" && <EditDetailsDialog app={detail} members={members} records={records} onClose={() => setDialog(null)} onDone={(a) => after(a, "Details saved")} />}
                </>
              );
            }}
          </Loaded>
        </main>
      </ApplicantShell>
    </>
  );
}
