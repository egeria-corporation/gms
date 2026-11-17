// SPDX-License-Identifier: AGPL-3.0-only
// Application status: where the application is in the competition's stages, what has happened,
// the thread shared with the funder, and any revision request.
import { useState, type FormEvent } from "react";
import { Link, useParams } from "react-router";
import { ArrowRight, Calendar, Eye, LogOut, Pencil, RotateCcw, Send, type LucideIcon } from "lucide-react";
import type { ApplicantApi, ApplicationEvent, Thread } from "../../api/applicant.ts";
import { useApplicantMutation, useApplicantQuery } from "../../api/applicantHooks.ts";
import { useWorkspace } from "../../app/workspace.tsx";
import { accentOf, Avatar, FunderChip, isNotFound, Loaded, timeAgo } from "../../components/applicant.tsx";
import { Dialog } from "../../components/Dialog.tsx";
import { NotFound } from "../../components/NotFound.tsx";
import { RevisionDiff } from "../../components/RevisionDiff.tsx";
import { ApplicantShell } from "../../components/shells.tsx";
import { StatusBadge, statusLook } from "../../components/status.tsx";
import { ErrorBanner } from "../../components/ui.tsx";
import { formatDate } from "../../lib/format.ts";
import { DecisionSection, InterviewSection } from "./statusExtras.tsx";
import { t, useApplicantText } from "./i18n.ts";

export const loadStatus = async (api: ApplicantApi, id: string) => {
  const [status, list, threads] = await Promise.all([api.applicationStatus(id), api.applications(), api.threads(id)]);
  return { status, summary: list.find((a) => a.id === status.id), thread: threads[0] ?? null };
};

const EVENT: Record<string, { icon: LucideIcon; text: (e: ApplicationEvent) => string; cls: string }> = {
  started: { icon: Pencil, text: () => t("applicationStatus.event.started"), cls: "tl-person" },
  submit: { icon: Send, text: () => t("applicationStatus.event.submitted"), cls: "tl-person" },
  advance: { icon: ArrowRight, text: (e) => (e.toStage ? t("applicationStatus.event.advancedTo", { stage: e.toStage }) : t("applicationStatus.event.advanced")), cls: "tl-ok" },
  request_revision: { icon: RotateCcw, text: () => t("applicationStatus.event.revisionRequested"), cls: "tl-warn" },
  withdraw: { icon: LogOut, text: () => t("applicationStatus.event.withdrawn"), cls: "" },
};
export function describe(e: ApplicationEvent) {
  const known = EVENT[e.type];
  if (known) return { icon: known.icon, text: known.text(e), cls: known.cls };
  if (e.toStatus) return { icon: statusLook("application", e.toStatus).icon, text: statusLook("application", e.toStatus).label, cls: "" };
  return { icon: Eye, text: e.type.replace(/_/g, " "), cls: "" };
}

export const WITHDRAWABLE = ["draft", "submitted", "screening", "under_review", "revision_requested", "interview", "recommended", "waitlisted"];

export default function ApplicationStatus() {
  useApplicantText();
  const ws = useWorkspace("applicant");
  const base = `/w/${ws.handle}`;
  const { appId = "" } = useParams();
  const query = useApplicantQuery((a) => loadStatus(a, appId), [appId, ws.id]);
  const [reply, setReply] = useState("");
  const [confirm, setConfirm] = useState(false);
  const send = useApplicantMutation(async (a, thread: Thread | null, body: string) => {
    const open = thread ?? (await a.openThread(appId));
    const m = await a.postMessage(open.id, body);
    return { ...open, messages: [...open.messages, m] };
  });
  const withdraw = useApplicantMutation((a) => a.withdraw(appId));
  if (query.status === "error" && isNotFound(query.error)) return <NotFound />;

  return (
    <>
      <title>{query.status === "ready" ? `${query.data.status.title} — ${ws.name}` : t("applicationStatus.pageTitle", { workspace: ws.name })}</title>
      <ApplicantShell active="Applications">
        <main className="main">
          <Loaded query={query} label={t("applicationStatus.loadingTheApplication")}>
            {({ status, summary, thread }) => {
              const funder = summary?.funder.name ?? t("applicationStatus.theFunder");
              const editable = status.status === "draft" || status.status === "revision_requested";
              const revisions = status.timeline.filter((e) => e.type === "request_revision");
              const onSend = async (e: FormEvent) => {
                e.preventDefault();
                if (!reply.trim()) return;
                const next = await send.run(thread, reply.trim());
                if (next) {
                  query.set({ status, summary, thread: next });
                  setReply("");
                }
              };
              return (
                <>
                  <div className="crumbs">
                    <Link to={base}>{t("applicationStatus.dashboard")}</Link>
                    <span>›</span>
                    <Link to={`${base}/applications`}>{t("applicationStatus.applications")}</Link>
                    <span>›</span>
                    <span>{status.title}</span>
                  </div>
                  <div className="ph">
                    <div>
                      <div className="title">
                        <FunderChip name={summary?.funder.name} accent={accentOf(summary?.funder.brand)} />
                        <h1>{status.title}</h1>
                        <StatusBadge kind="application" status={status.status} large />
                      </div>
                      <div className="meta">
                        <span>{[summary?.opportunity.title, summary?.stage.label].filter(Boolean).join(" · ")}</span>
                        {status.submittedAt && (
                          <>
                            <span>·</span>
                            <span>{t("applicationStatus.submittedOn", { date: formatDate(status.submittedAt) })}</span>
                          </>
                        )}
                        <span>·</span>
                        <span className="mono">{status.id}</span>
                      </div>
                    </div>
                    <div className="actions">
                      {editable && (
                        <Link to={`${base}/applications/${status.id}/edit`} className="btn btn-primary">
                          <Pencil className="ic" aria-hidden="true" />
                          {status.status === "draft" ? t("applicationStatus.continueEditing") : t("applicationStatus.respondToRevision")}
                        </Link>
                      )}
                      {WITHDRAWABLE.includes(status.status) && (
                        <button className="btn btn-danger" type="button" aria-haspopup="dialog" onClick={() => setConfirm(true)}>
                          {t("applicationStatus.withdrawApplication")}
                        </button>
                      )}
                    </div>
                  </div>

                  {withdraw.error ? <ErrorBanner error={withdraw.error} title={t("applicationStatus.theApplicationWasNotWithdrawn")} /> : null}

                  <div className="card">
                    <div className="card-h">
                      <h2 style={{ fontSize: "18px" }}>{t("applicationStatus.stages")}</h2>
                    </div>
                    <div className="card-b">
                      <div className="stp" role="group" aria-label={t("applicationStatus.competitionStages")} style={{ flexWrap: "wrap", rowGap: "8px" }}>
                        {status.stages.map((s, i) => (
                          <span key={s.key} style={{ display: "contents" }}>
                            {i > 0 && <span className={s.state === "upcoming" ? "ln" : "ln done"}></span>}
                            <div className={s.state === "done" ? "s done" : s.state === "current" ? "s on" : "s"} aria-current={s.state === "current" ? "step" : undefined}>
                              <span className="n">{i + 1}</span>
                              {s.label}
                              {s.closes && s.state !== "done" ? <span className="small muted"> · {t("applicationStatus.closesOn", { date: formatDate(s.closes) })}</span> : null}
                            </div>
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.3fr) minmax(0, 1fr)", gap: "20px", alignItems: "start" }}>
                    <section className="card" aria-labelledby="msg-h">
                      <div className="card-h">
                        <div className="row" style={{ gap: "8px" }}>
                          <h2 id="msg-h" style={{ fontSize: "18px" }}>
                            {t("applicationStatus.messages")}
                          </h2>
                          <span className="shared-mark">{t("applicationStatus.sharedWith", { funder })}</span>
                        </div>
                        <span className="small muted">{t("applicationStatus.bothSidesSeeThisThread")}</span>
                      </div>
                      <div className="card-b th">
                        {(thread?.messages ?? []).length === 0 && <p className="muted">{t("applicationStatus.noMessagesYet", { funder })}</p>}
                        {(thread?.messages ?? []).map((m, i) => (
                          <div className="msg" key={m.id}>
                            <Avatar name={m.author} index={m.authorUserId ? 0 : 3 + (i % 1)} />
                            <div className="bub">
                              <div className="hd">
                                <span className="who">{m.author}</span>
                                <span>· {timeAgo(m.createdAt)}</span>
                              </div>
                              <div className="bd">{m.body}</div>
                            </div>
                          </div>
                        ))}
                        <form className="composer" onSubmit={onSend}>
                          <label className="sr" htmlFor="reply">
                            {t("applicationStatus.reply")}
                          </label>
                          <textarea className="ta" id="reply" style={{ minHeight: "56px", flex: 1 }} placeholder={t("applicationStatus.replyTo", { funder })} value={reply} onChange={(e) => setReply(e.target.value)} />
                          <button className="btn btn-primary" type="submit" style={{ height: "44px" }} disabled={send.state === "saving" || !reply.trim()}>
                            <Send className="ic" aria-hidden="true" />
                            {t("applicationStatus.send")}
                          </button>
                        </form>
                        {send.error ? <ErrorBanner error={send.error} title={t("applicationStatus.theMessageWasNotSent")} /> : null}
                        <p className="small muted">{t("applicationStatus.internalNotesTheFunderWritesAre")}</p>
                      </div>
                    </section>

                    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
                      {revisions.length > 0 && (
                        <section className="card" aria-labelledby="rev-h">
                          <div className="card-h">
                            <h2 id="rev-h" style={{ fontSize: "18px" }}>
                              {t("applicationStatus.revisionRequests")}
                            </h2>
                            {status.status === "revision_requested" ? <StatusBadge kind="application" status="revision_requested" /> : null}
                          </div>
                          <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                            {revisions.map((e) => (
                              <div key={e.id}>
                                <div className="b">{e.message ?? t("applicationStatus.theFunderAskedForChanges")}</div>
                                <div className="small muted">{t("applicationStatus.requestedOn", { date: formatDate(e.at) })}</div>
                              </div>
                            ))}
                            {status.status === "revision_requested" && (
                              <Link to={`${base}/applications/${status.id}/edit`} className="btn btn-secondary" style={{ alignSelf: "flex-start" }}>
                                {t("applicationStatus.respond")}
                              </Link>
                            )}
                            {status.timeline
                              .filter((e) => e.type === "submit" && e.revision)
                              .map((e) => (
                                <div key={e.id} style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                                  <div className="b">{t("applicationStatus.yourResponseOn", { date: formatDate(e.at) })}</div>
                                  <RevisionDiff revision={e.revision!} />
                                </div>
                              ))}
                          </div>
                        </section>
                      )}

                      <InterviewSection status={status} funder={funder} />
                      <DecisionSection status={status} funder={funder} base={base} />

                      <section className="card" aria-labelledby="tl-h">
                        <div className="card-h">
                          <h2 id="tl-h" style={{ fontSize: "18px" }}>
                            {t("applicationStatus.timeline")}
                          </h2>
                        </div>
                        <div className="card-b">
                          <div className="tl">
                            {[...status.timeline].reverse().map((e) => {
                              const d = describe(e);
                              return (
                                <div className={`tl-i ${d.cls}`} key={e.id}>
                                  <span className="dot">
                                    <d.icon className="ic" aria-hidden="true" />
                                  </span>
                                  <div>
                                    <div className="what">{d.text}</div>
                                    <div className="who">
                                      <Calendar className="ic ic-sm" aria-hidden="true" />
                                      {formatDate(e.at)}
                                    </div>
                                    {e.message && <div className="small">{e.message}</div>}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </section>
                    </div>
                  </div>

                  <Dialog open={confirm} onClose={() => setConfirm(false)} labelledBy="wd-title">
                    <div className="hd">
                      <h3 id="wd-title" style={{ fontSize: "16px" }}>
                        {t("applicationStatus.withdrawThisApplication")}
                      </h3>
                    </div>
                    <div className="bd">
                      <p>
                        {t("applicationStatus.withdrawBody", { funder, title: status.title })}
                      </p>
                    </div>
                    <div className="ft">
                      <button className="btn btn-secondary" type="button" onClick={() => setConfirm(false)}>
                        {t("applicationStatus.keepApplication")}
                      </button>
                      <button
                        className="btn btn-danger-solid"
                        type="button"
                        disabled={withdraw.state === "saving"}
                        onClick={async () => {
                          const r = await withdraw.run();
                          setConfirm(false);
                          if (r) query.reload();
                        }}
                      >
                        {t("applicationStatus.withdraw")}
                      </button>
                    </div>
                  </Dialog>
                </>
              );
            }}
          </Loaded>
        </main>
      </ApplicantShell>
    </>
  );
}
