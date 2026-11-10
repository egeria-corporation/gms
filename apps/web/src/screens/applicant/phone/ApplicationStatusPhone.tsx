// SPDX-License-Identifier: AGPL-3.0-only
// Application status at phone width, as the 390px artboard draws it: a summary card, the timeline,
// the shared thread with a full-width reply, and revision requests with the diff inline. Same data
// as the desktop screen (../ApplicationStatus.tsx).
import { useState, type FormEvent } from "react";
import { Link, useParams } from "react-router";
import { Pencil } from "lucide-react";
import type { Thread } from "../../../api/applicant.ts";
import { useApplicantMutation, useApplicantQuery } from "../../../api/applicantHooks.ts";
import { useWorkspace } from "../../../app/workspace.tsx";
import { accentOf, Avatar, FunderChip, isNotFound, Loaded, timeAgo } from "../../../components/applicant.tsx";
import { Dialog } from "../../../components/Dialog.tsx";
import { NotFound } from "../../../components/NotFound.tsx";
import { PhoneShell } from "../../../components/PhoneShell.tsx";
import { RevisionDiff } from "../../../components/RevisionDiff.tsx";
import { StatusBadge } from "../../../components/status.tsx";
import { ErrorBanner } from "../../../components/ui.tsx";
import { formatDate } from "../../../lib/format.ts";
import { describe, loadStatus, WITHDRAWABLE } from "../ApplicationStatus.tsx";

export default function ApplicationStatusPhone() {
  const ws = useWorkspace("applicant");
  const base = `/w/${ws.handle}`;
  const { appId = "" } = useParams();
  const query = useApplicantQuery((a) => loadStatus(a, appId), [appId, ws.id]);
  const [reply, setReply] = useState("");
  const [confirm, setConfirm] = useState(false);
  const send = useApplicantMutation(async (a, thread: Thread | null, body: string) => {
    const t = thread ?? (await a.openThread(appId));
    const m = await a.postMessage(t.id, body);
    return { ...t, messages: [...t.messages, m] };
  });
  const withdraw = useApplicantMutation((a) => a.withdraw(appId));
  if (query.status === "error" && isNotFound(query.error)) return <NotFound />;
  return (
    <>
      <title>{query.status === "ready" ? `${query.data.status.title} — ${ws.name}` : `Application — ${ws.name}`}</title>
      <PhoneShell title="Application" active="Applications">
        <main className="main" style={{ flex: 1 }}>
          <Loaded query={query} label="Loading the application">
            {({ status, summary, thread }) => {
              const funder = summary?.funder.name ?? "the funder";
              const editable = status.status === "draft" || status.status === "revision_requested";
              const requests = status.timeline.filter((e) => e.type === "request_revision");
              const responses = status.timeline.filter((e) => e.type === "submit" && e.revision);
              const current = status.stages.find((s) => s.state === "current");
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
                  <div className="card" style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "10px" }}>
                    <FunderChip name={summary?.funder.name} accent={accentOf(summary?.funder.brand)} style={{ alignSelf: "flex-start" }} />
                    <h2 style={{ fontSize: "20px", lineHeight: 1.3 }}>{status.title}</h2>
                    <div className="row wrap" style={{ gap: "8px" }}>
                      <StatusBadge kind="application" status={status.status} large />
                      <span className="small muted">{[current?.label ?? summary?.stage.label, summary?.opportunity.title].filter(Boolean).join(" · ")}</span>
                    </div>
                    <div className="row wrap" style={{ gap: "8px" }}>
                      <span className="mono muted">{status.id.slice(0, 12)}…</span>
                      {status.submittedAt && <span className="small muted">Submitted {formatDate(status.submittedAt)}</span>}
                    </div>
                    {editable && (
                      <Link to={`${base}/applications/${status.id}/edit`} className="btn btn-primary btn-lg btn-block">
                        <Pencil className="ic" aria-hidden="true" />
                        {status.status === "draft" ? "Continue editing" : "Respond to revision"}
                      </Link>
                    )}
                  </div>

                  <section className="card" aria-labelledby="tl-h">
                    <div className="card-h" style={{ padding: "14px 16px" }}>
                      <h3 id="tl-h" style={{ fontSize: "16px" }}>
                        Timeline
                      </h3>
                      {current?.closes && <span className="small muted">Stage closes {formatDate(current.closes)}</span>}
                    </div>
                    <div className="card-b" style={{ padding: "16px 16px 4px" }}>
                      <ol className="tl tl-sm">
                        {[...status.timeline].reverse().map((e) => {
                          const d = describe(e);
                          return (
                            <li className={`tl-i ${d.cls}`} key={e.id}>
                              <span className="dot">
                                <d.icon className="ic" aria-hidden="true" />
                              </span>
                              <div>
                                <div className="what">{d.text}</div>
                                <div className="who">{formatDate(e.at)}</div>
                                {e.message && <div className="small">{e.message}</div>}
                              </div>
                            </li>
                          );
                        })}
                      </ol>
                    </div>
                  </section>

                  <section className="card" aria-labelledby="msg-h">
                    <div className="card-h" style={{ padding: "14px 16px", flexWrap: "wrap" }}>
                      <h3 id="msg-h" style={{ fontSize: "16px" }}>
                        Messages
                      </h3>
                      <span className="shared-mark">Shared with {funder}</span>
                    </div>
                    <div className="card-b" style={{ padding: "14px 16px 16px", display: "flex", flexDirection: "column", gap: "12px" }}>
                      <div className="th">
                        {(thread?.messages ?? []).length === 0 && <p className="muted">No messages yet. Write to {funder} here; replies arrive by email too.</p>}
                        {(thread?.messages ?? []).map((m) => (
                          <div className="msg" key={m.id}>
                            <Avatar name={m.author} index={m.authorUserId ? 0 : 3} />
                            <div className="bub">
                              <div className="hd" style={{ flexWrap: "wrap" }}>
                                <span className="who">{m.author}</span>
                                <span>· {timeAgo(m.createdAt)}</span>
                              </div>
                              <div className="bd">{m.body}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                      <form className="composer" style={{ flexDirection: "column", alignItems: "stretch" }} onSubmit={onSend}>
                        <label className="sr" htmlFor="reply">
                          Reply to {funder}
                        </label>
                        <textarea className="ta" id="reply" placeholder={`Reply to ${funder}…`} style={{ minHeight: "72px" }} value={reply} onChange={(e) => setReply(e.target.value)} />
                        <button className="btn btn-primary btn-lg" type="submit" disabled={send.state === "saving" || !reply.trim()}>
                          Send
                        </button>
                      </form>
                      {send.error ? <ErrorBanner error={send.error} title="The message was not sent" /> : null}
                    </div>
                  </section>

                  {requests.length > 0 && (
                    <section className="card" aria-labelledby="rev-h">
                      <div className="card-h" style={{ padding: "14px 16px" }}>
                        <h3 id="rev-h" style={{ fontSize: "16px" }}>
                          Revision request
                        </h3>
                        {status.status === "revision_requested" ? <StatusBadge kind="application" status="revision_requested" /> : <span className="bdg bdg-ok">Answered</span>}
                      </div>
                      <div className="card-b" style={{ padding: "14px 16px 16px", display: "flex", flexDirection: "column", gap: "10px" }}>
                        {requests.map((e) => (
                          <p key={e.id} style={{ fontSize: "14px" }}>
                            <span className="b">{funder} asked on {formatDate(e.at)}:</span> {e.message ? `“${e.message}”` : "for changes"}
                          </p>
                        ))}
                        {responses.map((e) => (
                          <RevisionDiff key={e.id} revision={e.revision!} />
                        ))}
                      </div>
                    </section>
                  )}

                  {WITHDRAWABLE.includes(status.status) && (
                    <button className="btn btn-danger btn-lg btn-block" type="button" aria-haspopup="dialog" onClick={() => setConfirm(true)}>
                      Withdraw application
                    </button>
                  )}
                  {withdraw.error ? <ErrorBanner error={withdraw.error} title="The application was not withdrawn" /> : null}

                  <Dialog open={confirm} onClose={() => setConfirm(false)} labelledBy="wd-title">
                    <div className="hd">
                      <h2 id="wd-title" style={{ fontSize: "16px" }}>
                        Withdraw this application?
                      </h2>
                    </div>
                    <div className="bd">
                      <p>
                        {funder} stops considering “{status.title}”. This cannot be undone; you would need to start a new application.
                      </p>
                    </div>
                    <div className="ft">
                      <button className="btn btn-secondary" type="button" onClick={() => setConfirm(false)}>
                        Keep application
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
                        Withdraw
                      </button>
                    </div>
                  </Dialog>
                </>
              );
            }}
          </Loaded>
        </main>
      </PhoneShell>
    </>
  );
}
