// SPDX-License-Identifier: AGPL-3.0-only
// One application, as the funder works it: the submitted responses with where each value came
// from, and a right rail with the applicant's Passport record, eligibility, reviews, the shared
// and internal threads, and the activity timeline. Stage and status change only through the
// actions here (advance, request a revision, decline).
import { InterviewCard } from "./InterviewPanel.tsx";
import { useEffect, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router";
import { Bot, CircleCheck, CircleDashed, CircleX, Lock, RefreshCw, Send, User } from "lucide-react";
import type { FormDefinition, JsonObject } from "@gms/forms";
import { useApiMutation, useApiQuery } from "../../api/hooks.ts";
import type { InboxApplication, InboxFormResponse, Thread } from "../../api/funder.ts";
import { useWorkspace } from "../../app/workspace.tsx";
import { Dialog } from "../../components/Dialog.tsx";
import { RevisionDiff } from "../../components/RevisionDiff.tsx";
import { FunderShell } from "../../components/shells.tsx";
import { LevelBadge, StatusBadge } from "../../components/status.tsx";
import { ErrorBanner, Field, Loading, Notice, Tabs, TabPanel } from "../../components/ui.tsx";
import { AssistantPanel, BudgetPanel, DocumentsPanel } from "./ApplicationPanels.tsx";
import { FormView } from "../../forms/FormView.tsx";
import { formatDate, formatMinor } from "../../lib/format.ts";
import { actorLabel, dateTime, EligibilityMark, timeAgo, usePeople } from "./shared.tsx";

/** Who on the applicant's team holds each section. Hidden when nothing is assigned or the caller may not see it. */
function SectionAssignments({ applicationId }: { applicationId: string }) {
  const sections = useApiQuery((api) => api.applicationSections(applicationId), [applicationId]);
  const rows = (sections.data ?? []).flatMap((f) => Object.entries(f.sections).map(([section, userId]) => ({ key: `${f.formId}-${section}`, stage: f.stage, section, userId })));
  if (!rows.length) return null;
  return (
    <div className="card">
      <div className="card-h">
        <h3>Section assignments</h3>
        <span className="small muted">Set by the applicant’s team</span>
      </div>
      <div className="card-b">
        <dl className="kv">
          {rows.map((r) => (
            <div key={r.key} style={{ display: "contents" }}>
              <dt>
                {r.section.replace(/[-_]/g, " ")} <span className="xs muted">· {r.stage}</span>
              </dt>
              <dd>Assigned to a team member</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}

type RailTab = "applicant" | "reviews" | "eligibility" | "budget" | "documents" | "messages" | "activity";

/** A plain key/value view for when the form definition cannot be read (for example, an external reviewer's token). */
function RawResponse({ response }: { response: Record<string, unknown> }) {
  return (
    <dl className="kv">
      {Object.entries(response).map(([k, v]) => (
        <div key={k} style={{ display: "contents" }}>
          <dt>{k}</dt>
          <dd>{typeof v === "string" || typeof v === "number" ? String(v) : JSON.stringify(v)}</dd>
        </div>
      ))}
    </dl>
  );
}

export function ResponseCard({ r, mode = "funder", external = false }: { r: InboxFormResponse; mode?: "funder" | "reviewer"; external?: boolean }) {
  const form = useApiQuery((api) => api.getForm(r.formId, r.formVersion), [r.formId, r.formVersion]);
  const anchor = `form-${r.formId}`;
  return (
    <section className="card" id={anchor} aria-labelledby={`${anchor}-title`}>
      <div className="card-h">
        <div>
          <h2 id={`${anchor}-title`} style={{ fontSize: "16px" }}>
            {r.formTitle ?? "Form"}
          </h2>
          <p className="small muted">
            Version {r.formVersion}
            {r.lockedAt ? ` · locked ${formatDate(r.lockedAt)}` : ""}
          </p>
        </div>
        <span className={r.status === "complete" ? "bdg bdg-ok" : "bdg bdg-neutral"}>
          {r.status === "complete" ? <CircleCheck className="ic" aria-hidden="true" /> : <Lock className="ic" aria-hidden="true" />}
          {r.status === "complete" ? "Complete" : r.status === "inProgress" ? "In progress" : "Not started"}
        </span>
      </div>
      <div className="card-b">
        {form.status === "loading" && <Loading label="Loading form" />}
        {form.status === "error" && <RawResponse response={r.response} />}
        {form.status === "ready" && (
          <FormView
            form={{ id: form.data.id, version: form.data.version, title: form.data.title, jsonSchema: form.data.jsonSchema, uiSchema: form.data.uiSchema, mappingFromCommonGrants: form.data.mappingFromCommonGrants, mappingToCommonGrants: form.data.mappingToCommonGrants, fieldMeta: form.data.fieldMeta } as FormDefinition}
            response={r.response as JsonObject}
            provenance={r.provenance}
            mode={mode}
            externalReviewer={external}
          />
        )}
        {r.masked.length > 0 && <p className="notice">{r.masked.length} field(s) are masked for this reviewer.</p>}
      </div>
    </section>
  );
}

function Messages({ applicationId }: { applicationId: string }) {
  const threads = useApiQuery((api) => api.listThreads(applicationId), [applicationId]);
  const [internal, setInternal] = useState(false);
  const [body, setBody] = useState("");
  const post = useApiMutation(async (api, text: string) => {
    const visibility = internal ? "funder_internal" : "shared";
    const thread = threads.data?.find((t) => t.visibility === visibility) ?? (await api.openThread(applicationId, internal ? "internal" : "shared"));
    return api.postMessage(thread.id, text);
  });
  const thread: Thread | undefined = threads.data?.find((t) => t.visibility === (internal ? "funder_internal" : "shared"));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    if (await post.run(body)) {
      setBody("");
      threads.reload();
    }
  }
  return (
    <div className="card">
      <div className="card-h">
        <h3>Messages</h3>
        <div className="seg" role="group" aria-label="Thread filter">
          <button type="button" className={internal ? "" : "on"} aria-pressed={!internal} onClick={() => setInternal(false)}>
            Shared
          </button>
          <button type="button" className={internal ? "on" : ""} aria-pressed={internal} onClick={() => setInternal(true)}>
            <Lock className="ic ic-sm" aria-hidden="true" />
            Internal
          </button>
        </div>
      </div>
      <div className="card-b th">
        {threads.status === "loading" && <Loading label="Loading messages" />}
        {threads.status === "error" && <ErrorBanner error={threads.error} onRetry={threads.reload} />}
        {threads.status === "ready" && !thread?.messages.length && <p className="muted small">{internal ? "No internal notes yet. The applicant never sees these." : "No messages with the applicant yet."}</p>}
        {thread?.messages.map((m) => (
          <div key={m.id} className={internal ? "msg msg-int" : "msg"}>
            <span className={m.authorUserId ? "av" : "av av-t"} aria-hidden="true">
              {m.author
                .split(/\s+/)
                .map((p) => p[0])
                .slice(0, 2)
                .join("")
                .toUpperCase()}
            </span>
            <div className="bub">
              <div className="hd">
                <span className="who">{m.author}</span>
                <span>· {timeAgo(m.createdAt)}</span>
                {internal ? (
                  <span className="int-mark">
                    <Lock className="ic" aria-hidden="true" />
                    Internal
                  </span>
                ) : (
                  <span className="shared-mark">Shared</span>
                )}
              </div>
              <div className="bd">{m.body}</div>
            </div>
          </div>
        ))}
        {post.error !== null && <ErrorBanner error={post.error} />}
        <form className="composer" onSubmit={submit}>
          <textarea className="ta" style={{ minHeight: "44px" }} aria-label={internal ? "Write an internal note" : "Write a message to the applicant"} placeholder={internal ? "Internal note: the applicant never sees this" : "Message the applicant"} value={body} onChange={(e) => setBody(e.target.value)} />
          <button type="submit" className="btn btn-primary" disabled={post.state === "saving" || !body.trim()}>
            <Send className="ic" aria-hidden="true" />
            {internal ? "Add note" : "Send"}
          </button>
        </form>
      </div>
    </div>
  );
}

function Reviews({ app, base }: { app: InboxApplication; base: string }) {
  const { person } = usePeople();
  const reviews = useApiQuery((api) => api.listReviews(app.id, app.stage), [app.id, app.stage]);
  const assignments = useApiQuery((api) => api.listAssignments({ applicationId: app.id, stage: app.stage }), [app.id, app.stage]);
  if (reviews.status === "loading") return <Loading label="Loading reviews" />;
  if (reviews.status === "error") return <ErrorBanner error={reviews.error} onRetry={reviews.reload} />;
  const assigned = assignments.data?.filter((a) => a.status !== "recused") ?? [];
  return (
    <div className="card">
      <div className="card-h">
        <h3>
          Reviews · {reviews.data.length} of {assigned.length} submitted
        </h3>
        <Link to={`${base}/reviews/assign`} className="small b">
          Assign reviewers
        </Link>
      </div>
      {reviews.data.length === 0 ? (
        <div className="card-b muted small">No reviews submitted at this stage yet.</div>
      ) : (
        <div className="card-b" style={{ padding: 0 }}>
          <table className="tbl tbl-compact" aria-label="Submitted reviews">
            <thead>
              <tr>
                <th>Reviewer</th>
                <th className="num">Overall</th>
                <th>Recommendation</th>
              </tr>
            </thead>
            <tbody>
              {reviews.data.map((r) => (
                <tr key={r.id}>
                  <td>{person(r.reviewerUserId)?.name}</td>
                  <td className="num b">{r.overall === null ? "—" : r.overall.toFixed(1)}</td>
                  <td style={{ whiteSpace: "normal" }}>
                    {r.recommendation ?? "—"}
                    {r.narrative && <div className="small muted">{r.narrative}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

type Action = { kind: "advance"; toStage: string; label: string } | { kind: "revision" } | { kind: "decline" };

function ActionDialog({ app, action, onClose, onDone }: { app: InboxApplication; action: Action; onClose: () => void; onDone: () => void }) {
  const [text, setText] = useState("");
  const [fields, setFields] = useState<Record<string, string[]>>({});
  const [sendLetter, setSendLetter] = useState(true);
  const run = useApiMutation((api) => {
    if (action.kind === "advance") return api.advanceApplication(app.id, { toStage: action.toStage, ...(text.trim() ? { note: text.trim() } : {}) });
    if (action.kind === "revision") return api.requestRevision(app.id, { message: text.trim(), ...(Object.keys(fields).length ? { fields } : {}) });
    return api.declineApplication(app.id, { sendLetter, ...(text.trim() ? { rationale: text.trim() } : {}) });
  });
  const title = action.kind === "advance" ? `Advance to ${action.label}` : action.kind === "revision" ? "Request a revision" : "Decline this application";
  const needText = action.kind === "revision";
  const toggleField = (formId: string, path: string) =>
    setFields((f) => {
      const cur = f[formId] ?? [];
      const next = cur.includes(path) ? cur.filter((p) => p !== path) : [...cur, path];
      const { [formId]: _drop, ...rest } = f;
      return next.length ? { ...rest, [formId]: next } : rest;
    });

  return (
    <Dialog open onClose={onClose} labelledBy="action-title">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (await run.run()) onDone();
        }}
      >
        <div className="hd">
          <h2 id="action-title">{title}</h2>
        </div>
        <div className="bd">
          {run.error !== null && <ErrorBanner error={run.error} />}
          {action.kind === "advance" && <p>The applicant is invited to the {action.label} stage. Their earlier responses are locked and stay visible to reviewers.</p>}
          {action.kind === "revision" && (
            <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className="lbl">Fields to revise (optional)</legend>
              <div className="col" style={{ marginTop: "6px" }}>
                {(app.formResponses ?? []).flatMap((r) =>
                  Object.keys(r.response).map((k) => (
                    <label key={`${r.formId}/${k}`} className="row small">
                      <input type="checkbox" checked={(fields[r.formId] ?? []).includes(`/${k}`)} onChange={() => toggleField(r.formId, `/${k}`)} />
                      {r.formTitle ?? "Form"} · {k}
                    </label>
                  )),
                )}
              </div>
            </fieldset>
          )}
          <Field id="action-text" label={action.kind === "revision" ? "What should change" : action.kind === "decline" ? "Reason (recorded with the decision)" : "Note (optional)"} required={needText} help={action.kind === "revision" ? "The applicant sees this message with the request." : undefined}>
            <textarea className="ta" id="action-text" value={text} onChange={(e) => setText(e.target.value)} required={needText} />
          </Field>
          {action.kind === "decline" && (
            <label className="row">
              <input type="checkbox" checked={sendLetter} onChange={(e) => setSendLetter(e.target.checked)} />
              Send the standard decline letter
            </label>
          )}
        </div>
        <div className="ft">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={action.kind === "decline" ? "btn btn-danger-solid" : "btn btn-primary"} disabled={run.state === "saving" || (needText && !text.trim())}>
            {action.kind === "advance" ? "Advance" : action.kind === "revision" ? "Send request" : "Decline"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export default function ApplicationDetail() {
  const ws = useWorkspace("funder");
  const base = `/w/${ws.handle}`;
  const { appId = "" } = useParams();
  const { person, people } = usePeople();
  const app = useApiQuery((api) => api.getApplication(appId), [appId]);
  const competitions = useApiQuery((api) => api.listCompetitions(), []);
  const rubrics = useApiQuery((api) => api.listRubrics(), []);
  const [tab, setTab] = useState<RailTab>("applicant");
  const [action, setAction] = useState<Action | null>(null);
  const [tag, setTag] = useState("");
  const tagIt = useApiMutation((api, input: { add?: string[]; remove?: string[] }) => api.tagApplication(appId, input));
  const assign = useApiMutation((api, userId: string | null) => api.assignApplication(appId, userId));
  const rerun = useApiMutation((api) => api.rerunEligibility(appId));

  useEffect(() => {
    const t = window.location.hash.replace("#", "");
    if (["applicant", "eligibility", "reviews", "budget", "documents", "messages", "activity"].includes(t)) setTab(t as RailTab);
  }, []);

  if (app.status === "loading") {
    return (
      <FunderShell active="Applications">
        <main className="main">
          <Loading label="Loading application" />
        </main>
      </FunderShell>
    );
  }
  if (app.status === "error") {
    return (
      <FunderShell active="Applications">
        <main className="main">
          <ErrorBanner error={app.error} onRetry={app.reload} title="This application could not be loaded" />
        </main>
      </FunderShell>
    );
  }
  const a = app.data;
  const competition = competitions.data?.find((c) => c.id === a.competitionId);
  const stage = competition?.stages.find((s) => s.key === a.stage);
  const next = competition?.stages.filter((s) => s.entryFrom.includes(a.stage)) ?? [];
  const stageRubric = rubrics.data?.find((r) => r.id === stage?.rubricId) ?? null;
  const open = !["declined", "accepted", "withdrawn", "draft"].includes(a.status);
  const org = a.organization;
  const projection = (org?.projection ?? {}) as { name?: string; mission?: string; addresses?: { primary?: { street1?: string; city?: string; stateOrProvince?: string; postalCode?: string } }; identifiers?: Record<string, { id?: string }> };
  const address = projection.addresses?.primary;
  const done = () => {
    setAction(null);
    app.reload();
  };

  return (
    <>
      <title>{`${a.title} — ${ws.name}`}</title>
      <FunderShell active="Applications">
        <main className="main">
          <div className="crumbs">
            <Link to={base}>{ws.name}</Link>
            <span>›</span>
            <Link to={`${base}/applications`}>Applications</Link>
            <span>›</span>
            <span>{a.applicant.name}</span>
          </div>
          <div className="card" style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: "12px" }}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "16px", flexWrap: "wrap" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px", minWidth: 0 }}>
                <div className="row wrap" style={{ gap: "8px" }}>
                  <span className="b" style={{ fontSize: "15px", color: "#0D2A43" }}>
                    {a.applicant.name}
                  </span>
                  <LevelBadge level={a.applicant.level ?? a.verificationLevelAtSubmit} />
                  {org?.levelChangedSinceSubmit && (
                    <span className="pill-warn">
                      <RefreshCw className="ic ic-sm" aria-hidden="true" />
                      Level changed since submit (was {a.verificationLevelAtSubmit})
                    </span>
                  )}
                  {a.tags.map((t) => (
                    <button key={t} type="button" className="tag" style={{ border: 0, cursor: "pointer" }} aria-label={`Remove tag ${t}`} onClick={async () => (await tagIt.run({ remove: [t] })) && app.reload()}>
                      {t} ×
                    </button>
                  ))}
                </div>
                <h1>{a.title}</h1>
                <div className="row wrap" style={{ gap: "6px 14px", fontSize: "13px", color: "#4A5C5A" }}>
                  <span>{competition?.title ?? "Competition"}</span>
                  <span>·</span>
                  <span className="row" style={{ gap: "6px" }}>
                    {stage?.label ?? a.stage}
                    <StatusBadge kind="application" status={a.status} />
                  </span>
                  <span>·</span>
                  <span>
                    Requested <b style={{ color: "#0D2A43" }}>{formatMinor(a.requestedAmountMinor, a.currency)}</b>
                  </span>
                  <span>·</span>
                  <span className="row" style={{ gap: "6px" }}>
                    Eligibility <EligibilityMark value={a.eligibility} />
                  </span>
                  {a.submittedAt && (
                    <>
                      <span>·</span>
                      <span>Submitted {formatDate(a.submittedAt)}</span>
                    </>
                  )}
                </div>
              </div>
              <div className="actions">
                {open &&
                  next.map((s) => (
                    <button key={s.key} type="button" className="btn btn-primary" onClick={() => setAction({ kind: "advance", toStage: s.key, label: s.label })}>
                      Advance to {s.label}
                    </button>
                  ))}
                {open && (
                  <>
                    <button type="button" className="btn btn-secondary" onClick={() => setAction({ kind: "revision" })}>
                      Request revision
                    </button>
                    <button type="button" className="btn btn-danger" onClick={() => setAction({ kind: "decline" })}>
                      Decline
                    </button>
                  </>
                )}
                {competition && (
                  <Link to={`${base}/competitions/${competition.id}/panel`} className="btn btn-secondary">
                    Panel
                  </Link>
                )}
              </div>
            </div>
            <div className="row wrap" style={{ gap: "12px" }}>
              <label className="row small">
                Assignee
                <select className="sel" style={{ width: "auto", height: "30px" }} value={a.assignedToUserId ?? ""} onChange={async (e) => (await assign.run(e.target.value || null)) && app.reload()}>
                  <option value="">Unassigned</option>
                  {people.map((p) => (
                    <option key={p.userId} value={p.userId}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <form
                className="row"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (tag.trim() && (await tagIt.run({ add: [tag.trim()] }))) {
                    setTag("");
                    app.reload();
                  }
                }}
              >
                <input className="inp" style={{ width: "160px", height: "30px" }} aria-label="Add a tag" placeholder="Add a tag" value={tag} onChange={(e) => setTag(e.target.value)} />
                <button type="submit" className="btn btn-sm btn-secondary" disabled={!tag.trim()}>
                  Add tag
                </button>
              </form>
              {(tagIt.error !== null || assign.error !== null) && <span className="err-msg">That change did not save. Try again.</span>}
            </div>
          </div>

          {a.status === "revision_requested" && <Notice tone="warn" title="A revision is with the applicant">Their responses unlock until they resubmit. The earlier version stays in the timeline.</Notice>}

          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 380px", gap: "20px", alignItems: "start" }}>
            <div className="col" style={{ gap: "20px" }}>
              {(a.formResponses ?? []).length === 0 && <div className="card card-b muted">No responses at this stage yet.</div>}
              {(a.formResponses ?? []).map((r) => (
                <ResponseCard key={`${r.formId}:${r.formVersion}`} r={r} />
              ))}
            </div>

            <aside className="col" style={{ gap: "16px" }}>
              <InterviewCard applicationId={a.id} canOffer={open} />
              <Tabs
                label="Application panels"
                idPrefix="rail"
                active={tab}
                onChange={setTab}
                tabs={[
                  { key: "applicant", label: "Applicant" },
                  { key: "eligibility", label: "Eligibility" },
                  { key: "reviews", label: "Reviews" },
                  { key: "budget", label: "Budget" },
                  { key: "documents", label: "Documents" },
                  { key: "messages", label: "Messages" },
                  { key: "activity", label: "Activity" },
                ]}
              />
              <TabPanel idPrefix="rail" tab="applicant" active={tab}>
                <div className="card">
                  <div className="card-h">
                    <h3>Applicant</h3>
                    <LevelBadge level={org?.level ?? a.applicant.level} />
                  </div>
                  <div className="card-b">
                    {org ? (
                      <dl className="kv">
                        <dt>Legal name</dt>
                        <dd>{projection.name ?? a.applicant.name}</dd>
                        <dt>EIN</dt>
                        <dd className="mono">{projection.identifiers?.["org:us:ein"]?.id ?? "—"}</dd>
                        <dt>Address</dt>
                        <dd>{address ? [address.street1, address.city, address.stateOrProvince, address.postalCode].filter(Boolean).join(", ") : "—"}</dd>
                        <dt>Mission</dt>
                        <dd>{projection.mission ?? "—"}</dd>
                        <dt>Verified</dt>
                        <dd>{formatDate(org.verifiedAt)}</dd>
                        <dt>Passport sync</dt>
                        <dd>{timeAgo(org.syncedAt)}</dd>
                        <dt>Attestation</dt>
                        <dd>{a.attestationUrl ? <a href={a.attestationUrl}>Attached at submit ({a.verificationLevelAtSubmit})</a> : "None"}</dd>
                      </dl>
                    ) : (
                      <p className="muted small">The applicant’s Passport record is visible while their consent stands. Level at submit: {a.verificationLevelAtSubmit ?? "unknown"}.</p>
                    )}
                  </div>
                </div>
              </TabPanel>
              <TabPanel idPrefix="rail" tab="eligibility" active={tab}>
                <div className="card">
                  <div className="card-h">
                    <h3>Eligibility</h3>
                    <EligibilityMark value={a.eligibilityResults?.eligible ?? a.eligibility} />
                  </div>
                  <div className="card-b">
                    <ul className="rc">
                      {(a.eligibilityResults?.results ?? []).map((r, i) => (
                        <li key={i} className={`rc-row ${r.outcome === "pass" ? "rc-pass" : r.outcome === "fail" ? "rc-fail" : "rc-unk"}`}>
                          <EligibilityIcon outcome={r.outcome} />
                          <div>
                            <div className="l">{r.label}</div>
                            <div className="r">{r.explain}</div>
                          </div>
                          <span className="small b">{r.outcome === "pass" ? "Pass" : r.outcome === "fail" ? "Fail" : "Unknown"}</span>
                        </li>
                      ))}
                    </ul>
                    {!a.eligibilityResults?.results.length && <p className="muted small">This opportunity has no eligibility rules.</p>}
                    <p className="help">An unknown result never declines an application; it flags it for a person.</p>
                    <button type="button" className="btn btn-sm btn-secondary" disabled={rerun.state === "saving"} onClick={async () => (await rerun.run()) && app.reload()}>
                      <RefreshCw className="ic" aria-hidden="true" />
                      Run again
                    </button>
                    {rerun.error !== null && <ErrorBanner error={rerun.error} />}
                  </div>
                </div>
              </TabPanel>
              <TabPanel idPrefix="rail" tab="reviews" active={tab}>
                <Reviews app={a} base={base} />
              </TabPanel>
              <TabPanel idPrefix="rail" tab="budget" active={tab}>
                <BudgetPanel app={a} />
              </TabPanel>
              <TabPanel idPrefix="rail" tab="documents" active={tab}>
                <DocumentsPanel app={a} />
              </TabPanel>
              <TabPanel idPrefix="rail" tab="messages" active={tab}>
                <Messages applicationId={a.id} />
              </TabPanel>
              <TabPanel idPrefix="rail" tab="activity" active={tab}>
                <SectionAssignments applicationId={a.id} />
                <div className="card" style={{ marginTop: "12px" }}>
                  <div className="card-h">
                    <h3>Activity</h3>
                  </div>
                  <div className="card-b">
                    <div className="tl tl-sm">
                      {[...(a.timeline ?? [])].reverse().map((e) => {
                        const who = actorLabel(e.actor, person);
                        return (
                          <div key={e.id} className={who.agent ? "tl-i tl-agent" : "tl-i tl-person"}>
                            <span className="dot">{who.agent ? <Bot className="ic" aria-hidden="true" /> : <User className="ic" aria-hidden="true" />}</span>
                            <div>
                              <div className="what">{e.message ?? e.type.replace(/^application\./, "").replace(/[._]/g, " ")}</div>
                              <div className="who">
                                {who.name} · {dateTime(e.at)}
                                {e.toStage ? ` · to ${e.toStage}` : ""}
                              </div>
                              {e.revision && e.revision.changes.length > 0 && (
                                <div style={{ marginTop: "8px" }}>
                                  <RevisionDiff revision={e.revision} />
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                      {!a.timeline?.length && <p className="muted small">Nothing recorded yet.</p>}
                    </div>
                  </div>
                </div>
              </TabPanel>
              <AssistantPanel app={a} rubricId={stageRubric?.id ?? null} criterionLabel={(key) => stageRubric?.criteria.find((c) => c.key === key)?.label ?? key} />
            </aside>
          </div>
        </main>
      </FunderShell>
      {action && <ActionDialog app={a} action={action} onClose={() => setAction(null)} onDone={done} />}
    </>
  );
}

function EligibilityIcon({ outcome }: { outcome: string }) {
  const Icon = outcome === "pass" ? CircleCheck : outcome === "fail" ? CircleX : CircleDashed;
  return <Icon className="ic" aria-hidden="true" />;
}
