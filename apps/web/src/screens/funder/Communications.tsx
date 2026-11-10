// SPDX-License-Identifier: AGPL-3.0-only
// Communications: letter, agreement and email templates with merge fields, a preview rendered by
// the server against a real application, and the log of what was sent. A saved template is a new
// immutable version; a letter already delivered keeps the version it was rendered with.
import { useEffect, useRef, useState } from "react";
import { CircleCheck, CircleX, Eye, Mail, Plus } from "lucide-react";
import { useApiMutation, useApiQuery } from "../../api/hooks.ts";
import type { Rendered, Template, TemplateInput } from "../../api/funder.ts";
import { useWorkspace } from "../../app/workspace.tsx";
import { FunderShell } from "../../components/shells.tsx";
import { EmptyState, ErrorBanner, Field, Loading, PageHeader, problemsOf, SaveNote } from "../../components/ui.tsx";
import { BulkSend } from "./BulkSend.tsx";
import { actorLabel, dateTime, usePeople, timeAgo } from "./shared.tsx";

const MERGE_FIELDS = ["recipient.name", "application.title", "opportunity.title", "funder.name", "links.application", "decision.message", "award.title", "award.amount"];
const mergeField = (name: string) => `{{${name}}}`;
const KIND_LABEL: Record<Template["kind"], string> = { email: "Email", letter: "Letter", agreement: "Agreement" };

interface Draft {
  kind: Template["kind"];
  name: string;
  subject: string;
  body: string;
}
const draftOf = (t?: Template): Draft => ({ kind: t?.kind ?? "email", name: t?.name ?? "", subject: t?.subject ?? "", body: t?.body ?? "" });

export default function Communications() {
  const ws = useWorkspace("funder");
  const { person } = usePeople();
  const templates = useApiQuery((api) => api.listTemplates(), []);
  const log = useApiQuery((api) => api.listCommunications(), []);
  // The log stores the subject's id; the applications list supplies the name people recognize.
  const subjects = useApiQuery(async (api) => new Map((await api.listApplications({ pageSize: 100 })).items.map((a) => [a.id.replace(/^app_/, ""), `${a.applicant.name} · ${a.title}`])), []);
  const sample = useApiQuery(async (api) => (await api.listApplications({ pageSize: 1 })).items[0] ?? null, []);
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(draftOf());
  const [preview, setPreview] = useState<Rendered | null>(null);
  const body = useRef<HTMLTextAreaElement>(null);
  const all = [...(templates.data?.items ?? []), ...(templates.data?.builtIn ?? [])];
  /** When a template last went out, from the send log (by id, or by name for older entries). */
  const lastUsed = (t: Template) =>
    (log.data ?? [])
      .filter((c) => c.status === "sent" && c.at && (c.template === t.id || c.templateName === t.name || c.templateName?.startsWith(`${t.name} v`)))
      .map((c) => c.at!)
      .sort()
      .at(-1) ?? null;
  const channelOf = (c: { template: string | null; templateName: string | null }) => {
    const t = all.find((x) => x.id === c.template || x.name === c.templateName);
    return t?.kind === "letter" ? "Email with letter (PDF)" : t?.kind === "agreement" ? "Email with agreement" : "Email";
  };
  const current = all.find((t) => t.id === selected) ?? null;

  useEffect(() => {
    if (selected === null && all[0]) setSelected(all[0].id);
  }, [all, selected]);
  useEffect(() => {
    setDraft(draftOf(current ?? undefined));
    setPreview(null);
  }, [current?.id]);

  const save = useApiMutation((api, input: TemplateInput) => api.createTemplate(input));
  const render = useApiMutation((api, id: string) => api.renderTemplate(id, { ...(sample.data ? { applicationId: sample.data.id } : {}), fields: { decision: { message: "After review, this application will not move forward." } } }));
  const dirty = !current || draft.name !== current.name || draft.body !== current.body || draft.subject !== (current.subject ?? "") || draft.kind !== current.kind;
  const unknown = [...new Set([...`${draft.subject}\n${draft.body}`.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map((m) => m[1]!))].filter((f) => !MERGE_FIELDS.includes(f));
  const missing = problemsOf(render.error)
    .map((p) => (p as { field?: string }).field ?? p.path ?? "")
    .filter(Boolean);

  function insert(field: string) {
    const el = body.current;
    const at = el?.selectionStart ?? draft.body.length;
    setDraft((d) => ({ ...d, body: d.body.slice(0, at) + mergeField(field) + d.body.slice(el?.selectionEnd ?? at) }));
    el?.focus();
  }
  async function saveVersion() {
    const t = await save.run({ kind: draft.kind, name: draft.name.trim(), body: draft.body, ...(draft.kind === "email" && draft.subject.trim() ? { subject: draft.subject.trim() } : {}) });
    if (t) {
      templates.reload();
      setSelected(t.id);
    }
  }

  return (
    <>
      <title>{`Communications — ${ws.name}`}</title>
      <FunderShell active="Communications">
        <main className="main">
          <PageHeader
            crumbs={[{ label: ws.name, to: `/w/${ws.handle}` }, { label: "Communications" }]}
            title="Communications"
            meta={<span>Templates for letters, agreements and email · every send is logged</span>}
            actions={
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  setSelected("new");
                  setDraft(draftOf());
                }}
              >
                <Plus className="ic" aria-hidden="true" />
                New template
              </button>
            }
          />
          {templates.status === "loading" && <Loading label="Loading templates" />}
          {templates.status === "error" && <ErrorBanner error={templates.error} onRetry={templates.reload} />}
          {templates.status === "ready" && (
            <div style={{ display: "grid", gridTemplateColumns: "420px minmax(0, 1fr)", gap: "20px", alignItems: "start" }}>
              <div className="card">
                <div className="card-h">
                  <h3>Templates</h3>
                  <span className="small muted">Select to edit</span>
                </div>
                <div className="tbl-wrap" style={{ border: 0, borderRadius: 0 }} tabIndex={0} role="region" aria-label="Templates, scrollable">
                  <table className="tbl tbl-compact" aria-label="Templates">
                    <thead>
                      <tr>
                        <th>Kind</th>
                        <th>Name</th>
                        <th>Ver.</th>
                        <th>Last used</th>
                      </tr>
                    </thead>
                    <tbody>
                      {all.map((t) => (
                        <tr key={t.id} className={t.id === selected ? "sel" : undefined}>
                          <td>{KIND_LABEL[t.kind]}</td>
                          <td>
                            <button type="button" className="b" style={{ border: 0, background: "transparent", font: "inherit", fontWeight: 700, color: "#0D2A43", cursor: "pointer", padding: 0 }} aria-pressed={t.id === selected} onClick={() => setSelected(t.id)}>
                              {t.name}
                            </button>
                          </td>
                          <td>{t.builtIn ? "Built in" : `v${t.version}`}</td>
                          <td>{lastUsed(t) ? timeAgo(lastUsed(t)) : <span className="muted">Never</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="card-f small muted">Versions are pinned when sent: a letter already delivered keeps the version it was rendered with.</div>
              </div>

              <section className="card" aria-labelledby="editor-h">
                <div className="card-h">
                  <div className="row" style={{ gap: "10px" }}>
                    <h3 id="editor-h">{current ? current.name : "New template"}</h3>
                    {current && <span className="tag">{`${KIND_LABEL[current.kind]} · ${current.builtIn ? "built in" : `v${current.version}`}`}</span>}
                  </div>
                  <div className="row" style={{ gap: "8px" }}>
                    <SaveNote state={save.state} savedText="Version saved" />
                    {current && (
                      <button type="button" className="btn btn-sm btn-secondary" disabled={render.state === "saving" || dirty} title={dirty ? "Save the template to preview this text" : undefined} onClick={async () => setPreview((await render.run(current.id)) ?? null)}>
                        <Eye className="ic" aria-hidden="true" />
                        Preview
                      </button>
                    )}
                    <button type="button" className="btn btn-sm btn-primary" disabled={save.state === "saving" || !dirty || !draft.name.trim() || !draft.body.trim() || (draft.kind === "email" && !draft.subject.trim())} onClick={saveVersion}>
                      {current && !current.builtIn ? `Save as v${current.version + 1}` : "Save template"}
                    </button>
                  </div>
                </div>
                <div className="card-b" style={{ display: "grid", gridTemplateColumns: "180px minmax(0, 1fr)", gap: "16px", alignItems: "start" }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    <span className="eyebrow">Merge fields</span>
                    <p className="small muted">Click to insert at the cursor.</p>
                    {MERGE_FIELDS.map((f) => (
                      <button key={f} type="button" className="chip" style={{ justifyContent: "flex-start" }} onClick={() => insert(f)} aria-label={`Insert ${f}`}>
                        <span className="mono" style={{ fontSize: "11px" }}>
                          {mergeField(f)}
                        </span>
                      </button>
                    ))}
                  </div>
                  <div className="col" style={{ gap: "12px" }}>
                    {save.error !== null && <ErrorBanner error={save.error} />}
                    <div className="fld-row">
                      <Field id="tpl-name" label="Name" required>
                        <input className="inp" id="tpl-name" value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
                      </Field>
                      <Field id="tpl-kind" label="Kind">
                        <select className="sel" id="tpl-kind" value={draft.kind} onChange={(e) => setDraft((d) => ({ ...d, kind: e.target.value as Template["kind"] }))}>
                          <option value="email">Email</option>
                          <option value="letter">Letter</option>
                          <option value="agreement">Agreement</option>
                        </select>
                      </Field>
                    </div>
                    {draft.kind === "email" && (
                      <Field id="tpl-subject" label="Subject" required>
                        <input className="inp" id="tpl-subject" value={draft.subject} onChange={(e) => setDraft((d) => ({ ...d, subject: e.target.value }))} />
                      </Field>
                    )}
                    <Field id="tpl-body" label="Body">
                      <textarea className="ta" id="tpl-body" ref={body} style={{ minHeight: "300px", fontSize: "13px", lineHeight: 1.6 }} value={draft.body} onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))} />
                    </Field>
                    {unknown.map((f) => (
                      <div key={f} className="bnr bnr-warn">
                        <div>
                          <div className="t">
                            Unknown merge field <span className="mono">{mergeField(f)}</span>
                          </div>
                          <div className="d">Letters can use the fields listed on the left. Identifiers such as an EIN are never merged into outgoing mail.</div>
                        </div>
                      </div>
                    ))}
                    {render.error !== null && (
                      <div className="bnr bnr-warn" role="alert">
                        <div>
                          <div className="t">{missing.length ? "Some merge fields have no value for this recipient" : "The preview could not be rendered"}</div>
                          <div className="d">{missing.length ? missing.map(mergeField).join(", ") : (render.error as Error).message}</div>
                        </div>
                      </div>
                    )}
                    {preview && (
                      <section className="letter" aria-label="Rendered preview">
                        <div className="small muted">Rendered for {sample.data?.applicant.name ?? "a sample recipient"}</div>
                        {preview.subject && <div className="b">{preview.subject}</div>}
                        <div style={{ whiteSpace: "pre-wrap" }}>{preview.text}</div>
                      </section>
                    )}
                  </div>
                </div>
              </section>
            </div>
          )}

          {templates.status === "ready" && <BulkSend templates={all} onSent={log.reload} />}

          <section className="card" aria-labelledby="log-h">
            <div className="card-h">
              <h3 id="log-h">Send log</h3>
              <span className="small muted">{log.data?.length ?? 0} sends</span>
            </div>
            {log.status === "loading" && <Loading label="Loading the send log" />}
            {log.status === "error" && <ErrorBanner error={log.error} onRetry={log.reload} />}
            {log.status === "ready" && log.data.length === 0 && (
              <EmptyState icon={Mail} title="Nothing sent yet">
                Letters and messages sent from this workspace are listed here.
              </EmptyState>
            )}
            {log.status === "ready" && log.data.length > 0 && (
              <div className="tbl-wrap" style={{ border: 0, borderRadius: 0 }} tabIndex={0} role="region" aria-label="Send log, scrollable">
                <table className="tbl" aria-label="Send log">
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Template</th>
                      <th>About</th>
                      <th>Channel</th>
                      <th>Sent by</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {log.data.map((c, i) => {
                      const who = actorLabel(c.actor, person);
                      return (
                        <tr key={`${c.subjectId}-${c.at}-${i}`}>
                          <td>{dateTime(c.at)}</td>
                          <td className="b">{c.templateName ?? c.template ?? "—"}</td>
                          <td>
                            {subjects.data?.get(c.subjectId.replace(/^app_/, "")) ?? (
                              <>
                                {c.subjectType} <span className="mono">{c.subjectId.slice(0, 12)}…</span>
                              </>
                            )}
                          </td>
                          <td>{channelOf(c)}</td>
                          <td>{who.agent ? <span className="attrib"><span className="ag">{who.name}</span></span> : who.name}</td>
                          <td>
                            {c.status === "sent" ? (
                              <span className="bdg bdg-ok">
                                <CircleCheck className="ic" aria-hidden="true" />
                                Sent
                              </span>
                            ) : (
                              <span className="bdg bdg-dng">
                                <CircleX className="ic" aria-hidden="true" />
                                Failed
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </main>
      </FunderShell>
    </>
  );
}
