// SPDX-License-Identifier: AGPL-3.0-only
// What has to be ready before the person submits on the funder's site: the deadlines, the
// attachments (uploaded here or pinned from the Passport locker) and the team's tasks.
import { useState, type FormEvent } from "react";
import { CalendarPlus, CircleCheck, CircleDashed, FileText, Plus, Upload, X } from "lucide-react";
import type { AppDocument, ApplicantMember } from "../../../api/applicant.ts";
import { useApplicantMutation } from "../../../api/applicantHooks.ts";
import { useFullQuery } from "../../../api/applicantFullHooks.ts";
import type { OutsideDetail } from "../../../api/outside.ts";
import { useOutsideMutation } from "../../../api/outsideHooks.ts";
import type { VaultDocument } from "../../../api/writeKeep.ts";
import { useWKQuery } from "../../../api/writeKeepHooks.ts";
import { StatusBadge } from "../../../components/status.tsx";
import { ErrorBanner, Field, SaveNote } from "../../../components/ui.tsx";
import { openBlob } from "../../../lib/browser.ts";
import { formatDate } from "../../../lib/format.ts";
import { DOC_TYPE_LABELS, docTypeForLabel, MILESTONES, milestonesFor, type RequiredDocument } from "../../../lib/writeKeep.ts";
import { ExpiryBadge } from "./keep.tsx";
import { DEADLINE_LABELS, DeadlineText, fileKind, MAX_UPLOAD_BYTES, sizeText, toBase64 } from "./shared.tsx";

function Deadlines({ detail, readOnly, onChanged }: { detail: OutsideDetail; readOnly: boolean; onChanged: () => void }) {
  const [form, setForm] = useState({ internalDue: detail.internalDue ?? "", loiDue: detail.loiDue ?? "", fullDue: detail.fullDue ?? "", rolling: detail.rolling });
  const save = useOutsideMutation((api) => api.update(detail.id, { internalDue: form.internalDue || null, loiDue: form.loiDue || null, fullDue: form.fullDue || null, rolling: form.rolling }));
  const dirty = form.internalDue !== (detail.internalDue ?? "") || form.loiDue !== (detail.loiDue ?? "") || form.fullDue !== (detail.fullDue ?? "") || form.rolling !== detail.rolling;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (await save.run()) onChanged();
  };
  return (
    <section className="card" aria-labelledby="ock-dates">
      <div className="card-h">
        <div>
          <h2 id="ock-dates" style={{ fontSize: "18px" }}>
            Deadlines
          </h2>
          <p className="small muted">Reminders go to the owner and to whoever is writing an open question, 14, 7 and 2 days before and on the day.</p>
        </div>
        <SaveNote state={save.state === "saved" && !dirty ? "saved" : "idle"} />
      </div>
      <form className="card-b" onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "12px" }}>
          {(Object.keys(DEADLINE_LABELS) as (keyof typeof DEADLINE_LABELS)[]).map((k) => (
            <Field key={k} id={`ock-${k}`} label={DEADLINE_LABELS[k]} help={detail[k] ? <DeadlineText date={detail[k]} /> : "Not set"}>
              <input id={`ock-${k}`} type="date" className="inp" readOnly={readOnly} value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
            </Field>
          ))}
        </div>
        <label className="row" style={{ gap: "8px", fontSize: "14px" }}>
          <input type="checkbox" disabled={readOnly} checked={form.rolling} onChange={(e) => setForm({ ...form, rolling: e.target.checked })} />
          The funder takes applications on a rolling basis
        </label>
        {!readOnly && (
          <button type="submit" className="btn btn-secondary" style={{ alignSelf: "flex-start" }} disabled={!dirty || save.state === "saving"}>
            {save.state === "saving" ? "Saving…" : "Save deadlines"}
          </button>
        )}
        {save.error ? <ErrorBanner error={save.error} title="The deadlines were not saved" /> : null}
      </form>
    </section>
  );
}

/** Internal milestones worked back from the full deadline, offered once it is set; created only on confirm. */
function MilestonesOffer({ detail, onChanged }: { detail: OutsideDetail; onChanged: () => void }) {
  const [rows, setRows] = useState(() => (detail.fullDue ? milestonesFor(detail.fullDue) : []));
  const [dismissed, setDismissed] = useState(false);
  const create = useOutsideMutation(async (api, list: { title: string; dueOn: string }[]) => {
    for (const r of list) await api.createTask(detail.id, { title: r.title, dueAt: `${r.dueOn}T00:00:00Z` });
    return list.length;
  });
  const titles = new Set(detail.tasks.map((t) => t.title.toLowerCase()));
  const planned = MILESTONES.some((m) => titles.has(m.title.toLowerCase()));
  if (!detail.fullDue || planned || dismissed) return null;
  return (
    <section className="card" aria-labelledby="ock-ms" style={{ borderStyle: "dashed" }}>
      <div className="card-h">
        <div>
          <h3 id="ock-ms" style={{ fontSize: "15px" }}>
            Plan the writing back from the full deadline?
          </h3>
          <p className="small muted">Three tasks, two weeks, one week and two days before {formatDate(detail.fullDue)}. Change the dates or titles first if you like.</p>
        </div>
      </div>
      <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        {rows.map((r, i) => (
          <div key={r.key} className="row" style={{ gap: "8px", flexWrap: "wrap" }}>
            <label className="sr" htmlFor={`ms-t-${r.key}`}>
              Milestone {i + 1}
            </label>
            <input id={`ms-t-${r.key}`} className="inp" style={{ flex: "2 1 200px" }} value={r.title} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} />
            <label className="sr" htmlFor={`ms-d-${r.key}`}>
              Due date for milestone {i + 1}
            </label>
            <input id={`ms-d-${r.key}`} type="date" className="inp" style={{ flex: "1 1 140px" }} value={r.dueOn} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, dueOn: e.target.value } : x)))} />
          </div>
        ))}
        {create.error ? <ErrorBanner error={create.error} title="The tasks were not all added" /> : null}
        <div className="row" style={{ gap: "8px" }}>
          <button
            type="button"
            className="btn btn-sm btn-primary"
            disabled={create.state === "saving" || rows.some((r) => !r.title.trim() || !r.dueOn)}
            onClick={async () => {
              if (await create.run(rows.map((r) => ({ title: r.title.trim(), dueOn: r.dueOn })))) onChanged();
            }}
          >
            <CalendarPlus className="ic" aria-hidden="true" />
            {create.state === "saving" ? "Adding…" : "Add these tasks"}
          </button>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setDismissed(true)}>
            Not now
          </button>
        </div>
      </div>
    </section>
  );
}

/**
 * The documents the funder asks for, each met by a vault document (matched by type) or an
 * attachment. Saved on the application as its required documents.
 */
function RequiredDocuments({ detail, readOnly, onChanged }: { detail: OutsideDetail; readOnly: boolean; onChanged: () => void }) {
  const vault = useWKQuery((api) => api.vault(), []);
  const [label, setLabel] = useState("");
  const save = useOutsideMutation((api, next: RequiredDocument[]) => api.update(detail.id, { requiredDocuments: next }));
  const list = detail.requiredDocuments;
  const docs: VaultDocument[] = vault.status === "ready" ? vault.data : [];
  const attachments = detail.documents.filter((d) => d.id !== detail.snapshotDocumentId);
  const nameOf = (id: string | null) => docs.find((d) => d.id === id)?.name ?? attachments.find((d) => d.id === id)?.name ?? "A document";
  const set = async (next: RequiredDocument[]) => (await save.run(next)) && onChanged();
  const patchAt = (i: number, p: Partial<RequiredDocument>) => void set(list.map((d, j) => (j === i ? { ...d, ...p } : d)));
  const met = list.filter((d) => d.status !== "needed").length;
  return (
    <section className="card" aria-labelledby="ock-req">
      <div className="card-h">
        <div>
          <h2 id="ock-req" style={{ fontSize: "18px" }}>
            Required documents
          </h2>
          <p className="small muted">{list.length ? `${met} of ${list.length} ready` : "What the funder asks you to attach. Use a document from your vault, or one attached here."}</p>
        </div>
      </div>
      <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        {list.length > 0 && (
          <ul aria-label="Required documents" style={{ display: "flex", flexDirection: "column", gap: "10px", listStyle: "none", padding: 0, margin: 0 }}>
            {list.map((d, i) => {
              const type = docTypeForLabel(d.label);
              const matches = docs.filter((v) => type && v.docType === type);
              const others = docs.filter((v) => !matches.includes(v));
              const vaultDoc = docs.find((v) => v.id === d.documentId);
              return (
                <li key={`${d.label}-${i}`} aria-label={d.label} style={{ display: "flex", flexDirection: "column", gap: "6px", paddingBottom: "10px", borderBottom: "1px solid var(--og-gray-100)" }}>
                  <div className="row" style={{ gap: "8px", flexWrap: "wrap" }}>
                    <span className="b">{d.label}</span>
                    <StatusBadge kind="requiredDocument" status={d.status} />
                    {!readOnly && (
                      <button type="button" className="iconbtn" style={{ marginLeft: "auto" }} aria-label={`Remove ${d.label}`} onClick={() => void set(list.filter((_, j) => j !== i))}>
                        <X className="ic" aria-hidden="true" />
                      </button>
                    )}
                  </div>
                  {d.status === "attached" && d.documentId && (
                    <span className="small row" style={{ gap: "6px", flexWrap: "wrap" }}>
                      {vaultDoc ? "From your vault:" : "Attached:"} <span className="b">{nameOf(d.documentId)}</span>
                      {vaultDoc && <ExpiryBadge expiresOn={vaultDoc.expiresOn} />}
                    </span>
                  )}
                  {!readOnly && d.status !== "attached" && (
                    <div className="row" style={{ gap: "8px", flexWrap: "wrap" }}>
                      {matches[0] && (
                        <button type="button" className="btn btn-sm btn-secondary" disabled={save.state === "saving"} onClick={() => patchAt(i, { documentId: matches[0]!.id, status: "attached" })}>
                          Use from vault: {matches[0].name}
                        </button>
                      )}
                      {(others.length > 0 || matches.length > 1 || attachments.length > 0) && (
                        <>
                          <label className="sr" htmlFor={`req-pick-${i}`}>
                            Another document for {d.label}
                          </label>
                          <select
                            id={`req-pick-${i}`}
                            className="sel"
                            style={{ maxWidth: "260px", height: "30px" }}
                            value=""
                            onChange={(e) => e.target.value && patchAt(i, { documentId: e.target.value, status: "attached" })}
                          >
                            <option value="">{matches[0] ? "Or choose another…" : "Choose a document…"}</option>
                            {docs.length > 0 && (
                              <optgroup label="Your vault">
                                {[...matches.slice(1), ...others].map((v) => (
                                  <option key={v.id} value={v.id}>
                                    {v.name} ({DOC_TYPE_LABELS[v.docType]})
                                  </option>
                                ))}
                              </optgroup>
                            )}
                            {attachments.length > 0 && (
                              <optgroup label="Attached to this application">
                                {attachments.map((a) => (
                                  <option key={a.id} value={a.id}>
                                    {a.name}
                                  </option>
                                ))}
                              </optgroup>
                            )}
                          </select>
                        </>
                      )}
                      {d.status === "needed" ? (
                        <button type="button" className="btn btn-sm btn-ghost" onClick={() => patchAt(i, { status: "not_needed", documentId: null })}>
                          Not needed
                        </button>
                      ) : (
                        <button type="button" className="btn btn-sm btn-ghost" onClick={() => patchAt(i, { status: "needed" })}>
                          Needed after all
                        </button>
                      )}
                      {!matches[0] && d.status === "needed" && docs.length === 0 && <span className="small muted">Nothing in your vault yet.</span>}
                    </div>
                  )}
                  {!readOnly && d.status === "attached" && (
                    <button type="button" className="btn btn-sm btn-ghost" style={{ alignSelf: "flex-start" }} onClick={() => patchAt(i, { status: "needed", documentId: null })}>
                      Change
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {!readOnly && (
          <form
            className="row"
            style={{ gap: "8px", flexWrap: "wrap", alignItems: "flex-end" }}
            onSubmit={async (e) => {
              e.preventDefault();
              if (!label.trim()) return;
              if (await save.run([...list, { label: label.trim(), documentId: null, status: "needed" }])) {
                setLabel("");
                onChanged();
              }
            }}
          >
            <div className="fld" style={{ flex: "1 1 220px" }}>
              <label className="lbl" htmlFor="ock-req-new">
                Add a required document
              </label>
              <input id="ock-req-new" className="inp" placeholder="IRS determination letter" value={label} onChange={(e) => setLabel(e.target.value)} />
            </div>
            <button type="submit" className="btn btn-secondary" disabled={!label.trim() || save.state === "saving"}>
              <Plus className="ic" aria-hidden="true" />
              Add
            </button>
          </form>
        )}
        {vault.status === "error" ? <ErrorBanner error={vault.error} title="Your vault could not be read" /> : null}
        {save.error ? <ErrorBanner error={save.error} title="The checklist was not saved" /> : null}
      </div>
    </section>
  );
}

export function DocumentRow({ doc, applicationId, note }: { doc: AppDocument; applicationId: string; note?: string }) {
  const open = useOutsideMutation(async (api) => {
    const f = await api.documentFile(applicationId, doc.id);
    openBlob(f.blob, f.filename);
    return true;
  });
  return (
    <div className="doc">
      <span className={`ft ${fileKind(doc.name) ? `ft-${fileKind(doc.name)}` : ""}`}>{(fileKind(doc.name) || "file").toUpperCase()}</span>
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="nm" style={{ overflowWrap: "anywhere" }}>
          {doc.name}
        </div>
        <div className="mt">
          {sizeText(doc.size)} · added {formatDate(doc.uploadedAt)}
          {doc.source === "passport_locker" ? " · from Passport" : ""}
          {note ? ` · ${note}` : ""}
        </div>
        {open.error ? <ErrorBanner error={open.error} title="The file could not be opened" /> : null}
      </div>
      {doc.source === "upload" && (
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => void open.run()} aria-label={`Open ${doc.name}`}>
          Open
        </button>
      )}
    </div>
  );
}

/** Uploads one file to the application; resolves the stored document. */
export function useUpload(applicationId: string) {
  const [tooBig, setTooBig] = useState<string | null>(null);
  const upload = useOutsideMutation(async (api, file: File) => api.uploadDocument(applicationId, { name: file.name, mime: file.type || "application/octet-stream", contentBase64: await toBase64(file) }));
  const run = async (file: File | undefined) => {
    setTooBig(null);
    if (!file) return undefined;
    if (file.size > MAX_UPLOAD_BYTES) {
      setTooBig(`${file.name} is larger than 10 MB. Upload a smaller file.`);
      return undefined;
    }
    return upload.run(file);
  };
  return { run, state: upload.state, error: upload.error, tooBig };
}

function Attachments({ detail, readOnly, onChanged }: { detail: OutsideDetail; readOnly: boolean; onChanged: () => void }) {
  const upload = useUpload(detail.id);
  const locker = useFullQuery((api) => api.locker(), []);
  const [pick, setPick] = useState("");
  const pin = useOutsideMutation((api, input: Parameters<typeof api.uploadDocument>[1]) => api.uploadDocument(detail.id, input));
  const lockerItems = locker.status === "ready" && locker.data.state === "ok" ? locker.data.items.filter((d) => d.attachable && d.sha256) : [];
  const docs = detail.documents.filter((d) => d.id !== detail.snapshotDocumentId);
  return (
    <section className="card" aria-labelledby="ock-docs">
      <div className="card-h">
        <div>
          <h2 id="ock-docs" style={{ fontSize: "18px" }}>
            Attachments
          </h2>
          <p className="small muted">Keep the files the funder asks for in one place. They stay in your workspace; nothing is sent to the funder from here.</p>
        </div>
      </div>
      <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
        {docs.length === 0 && <p className="muted">No attachments yet.</p>}
        {docs.map((d) => (
          <DocumentRow key={d.id} doc={d} applicationId={detail.id} note={d.id === detail.receiptDocumentId ? "submission receipt" : undefined} />
        ))}
        {!readOnly && (
          <div className="row" style={{ gap: "10px", flexWrap: "wrap" }}>
            <label className="btn btn-sm btn-secondary" style={{ cursor: "pointer" }}>
              <Upload className="ic" aria-hidden="true" />
              {upload.state === "saving" ? "Uploading…" : "Upload a file"}
              <input
                type="file"
                className="sr"
                aria-label="Upload a file"
                onChange={async (e) => {
                  const doc = await upload.run(e.target.files?.[0]);
                  e.target.value = "";
                  if (doc) onChanged();
                }}
              />
            </label>
            {lockerItems.length > 0 && (
              <>
                <label className="sr" htmlFor="ock-locker">
                  A document from your Passport locker
                </label>
                <select id="ock-locker" className="sel" style={{ maxWidth: "260px", height: "30px" }} value={pick} onChange={(e) => setPick(e.target.value)}>
                  <option value="">From your Passport documents…</option>
                  {lockerItems.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="btn btn-sm btn-secondary"
                  disabled={!pick || pin.state === "saving"}
                  onClick={async () => {
                    const d = lockerItems.find((x) => x.id === pick);
                    if (!d) return;
                    if (await pin.run({ name: d.name, mime: d.mimeType ?? "application/octet-stream", passportDocumentId: d.id, size: 0, sha256: d.sha256! })) {
                      setPick("");
                      onChanged();
                    }
                  }}
                >
                  Add
                </button>
              </>
            )}
          </div>
        )}
        {upload.tooBig && <p className="err-msg" role="alert">{upload.tooBig}</p>}
        {upload.error ? <ErrorBanner error={upload.error} title="The file was not uploaded" /> : null}
        {pin.error ? <ErrorBanner error={pin.error} title="The document was not added" /> : null}
      </div>
    </section>
  );
}

function Tasks({ detail, members, readOnly, onChanged }: { detail: OutsideDetail; members: ApplicantMember[]; readOnly: boolean; onChanged: () => void }) {
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [who, setWho] = useState("");
  const create = useOutsideMutation((api) => api.createTask(detail.id, { title: title.trim(), dueAt: due ? `${due}T00:00:00Z` : null, assigneeUserId: who || null }));
  const toggle = useApplicantMutation((api, id: string, done: boolean) => api.updateTask(id, { done }));
  const nameOf = (id: string | null) => members.find((m) => m.userId === id)?.name ?? null;
  const open = detail.tasks.filter((t) => !t.doneAt).length;
  return (
    <section className="card" aria-labelledby="ock-tasks">
      <div className="card-h">
        <div>
          <h2 id="ock-tasks" style={{ fontSize: "18px" }}>
            Tasks
          </h2>
          <p className="small muted">{detail.tasks.length === 0 ? "Letters of support, budget sign-off, board approval: whatever needs doing first." : `${open} open of ${detail.tasks.length}`}</p>
        </div>
      </div>
      <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
        <ul aria-label="Tasks" style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {detail.tasks.map((t) => (
            <li key={t.id} className="row" style={{ gap: "10px", flexWrap: "wrap" }}>
              <label className="row" style={{ gap: "8px" }}>
                <input type="checkbox" checked={!!t.doneAt} disabled={readOnly} onChange={async (e) => (await toggle.run(t.id, e.target.checked)) && onChanged()} />
                <span style={t.doneAt ? { textDecoration: "line-through", color: "var(--og-gray-600)" } : undefined}>{t.title}</span>
              </label>
              <span className="small muted row" style={{ gap: "4px" }}>
                {t.doneAt ? <CircleCheck className="ic ic-sm" aria-hidden="true" /> : <CircleDashed className="ic ic-sm" aria-hidden="true" />}
                {t.doneAt ? "Done" : "Open"}
                {nameOf(t.assigneeUserId) ? ` · ${nameOf(t.assigneeUserId)}` : ""}
                {t.dueAt ? ` · due ${formatDate(t.dueAt)}` : ""}
              </span>
            </li>
          ))}
        </ul>
        {!readOnly && (
          <form
            className="row"
            style={{ gap: "8px", flexWrap: "wrap", alignItems: "flex-end" }}
            onSubmit={async (e) => {
              e.preventDefault();
              if (!title.trim()) return;
              if (await create.run()) {
                setTitle("");
                setDue("");
                setWho("");
                onChanged();
              }
            }}
          >
            <div className="fld" style={{ flex: "2 1 220px" }}>
              <label className="lbl" htmlFor="ock-task">
                New task
              </label>
              <input id="ock-task" className="inp" value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="fld" style={{ flex: "1 1 140px" }}>
              <label className="lbl" htmlFor="ock-task-due">
                Due
              </label>
              <input id="ock-task-due" type="date" className="inp" value={due} onChange={(e) => setDue(e.target.value)} />
            </div>
            <div className="fld" style={{ flex: "1 1 160px" }}>
              <label className="lbl" htmlFor="ock-task-who">
                Who
              </label>
              <select id="ock-task-who" className="sel" value={who} onChange={(e) => setWho(e.target.value)}>
                <option value="">No one yet</option>
                {members.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.name ?? m.email}
                  </option>
                ))}
              </select>
            </div>
            <button type="submit" className="btn btn-secondary" disabled={!title.trim() || create.state === "saving"}>
              <Plus className="ic" aria-hidden="true" />
              Add task
            </button>
          </form>
        )}
        {create.error ? <ErrorBanner error={create.error} title="The task was not added" /> : null}
        {toggle.error ? <ErrorBanner error={toggle.error} title="The task was not updated" /> : null}
      </div>
    </section>
  );
}

export function ChecklistTab({ detail, members, readOnly, onChanged }: { detail: OutsideDetail; members: ApplicantMember[]; readOnly: boolean; onChanged: () => void }) {
  const unanswered = detail.questions.filter((q) => q.required && !q.answer?.body.trim()).length;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.3fr) minmax(0, 1fr)", gap: "20px", alignItems: "start" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
        <Deadlines detail={detail} readOnly={readOnly} onChanged={onChanged} />
        {!readOnly && <MilestonesOffer key={`ms-${detail.fullDue ?? ""}`} detail={detail} onChanged={onChanged} />}
        <RequiredDocuments detail={detail} readOnly={readOnly} onChanged={onChanged} />
        <Attachments detail={detail} readOnly={readOnly} onChanged={onChanged} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
        <section className="card" aria-labelledby="ock-answers">
          <div className="card-h">
            <h2 id="ock-answers" style={{ fontSize: "18px" }}>
              Answers
            </h2>
          </div>
          <div className="card-b row" style={{ gap: "8px" }}>
            {unanswered === 0 ? <CircleCheck className="ic" aria-hidden="true" style={{ color: "var(--s-ok-fg)" }} /> : <FileText className="ic" aria-hidden="true" />}
            <span>{detail.questions.length === 0 ? "No questions added yet." : unanswered === 0 ? "Every required question has an answer." : `${unanswered} required question${unanswered === 1 ? "" : "s"} still without an answer.`}</span>
          </div>
        </section>
        <Tasks detail={detail} members={members} readOnly={readOnly} onChanged={onChanged} />
      </div>
    </div>
  );
}
