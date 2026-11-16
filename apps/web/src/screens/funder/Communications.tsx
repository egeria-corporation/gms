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
import { LetterAssistant } from "./LetterAssist.tsx";
import { BulkSend } from "./BulkSend.tsx";
import { actorLabel, dateTime, usePeople, timeAgo } from "./shared.tsx";
import { ShareToGalleryButton } from "./ShareToGallery.tsx";
import { t } from "./i18n.ts";

/** Fields every install can fill. The built-in templates name the rest (award dates, requirement and payment details), so the list shown is theirs plus these. */
const BASE_MERGE_FIELDS = ["recipient.name", "application.title", "opportunity.title", "funder.name", "links.application", "decision.message", "award.title", "award.amount"];
const mergeField = (name: string) => `{{${name}}}`;
const KIND_LABEL: Record<Template["kind"], () => string> = { email: () => t("funderCommunications.kind.email"), letter: () => t("funderCommunications.kind.letter"), agreement: () => t("funderCommunications.kind.agreement") };

interface Draft {
  kind: Template["kind"];
  name: string;
  subject: string;
  body: string;
}
const draftOf = (tpl?: Template): Draft => ({ kind: tpl?.kind ?? "email", name: tpl?.name ?? "", subject: tpl?.subject ?? "", body: tpl?.body ?? "" });

export default function Communications() {
  const ws = useWorkspace("funder");
  const { person } = usePeople();
  const templates = useApiQuery((api) => api.listTemplates(), []);
  const log = useApiQuery((api) => api.listCommunications(), []);
  // The log stores the subject's id; the applications list supplies the name people recognize.
  const subjects = useApiQuery(async (api) => new Map((await api.listApplications({ pageSize: 100 })).items.map((a) => [a.id.replace(/^app_/, ""), t("funderCommunications.subjectName", { name: a.applicant.name, title: a.title })])), []);
  const sample = useApiQuery(async (api) => (await api.listApplications({ pageSize: 1 })).items[0] ?? null, []);
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(draftOf());
  const [preview, setPreview] = useState<Rendered | null>(null);
  const body = useRef<HTMLTextAreaElement>(null);
  const all = [...(templates.data?.items ?? []), ...(templates.data?.builtIn ?? [])];
  // What a template may use is what the server can fill: every field one of its own built-in
  // templates uses. A fixed list here went stale and flagged the built-in templates themselves.
  const mergeFields = [...new Set([...BASE_MERGE_FIELDS, ...(templates.data?.builtIn ?? []).flatMap((item) => item.fields ?? [])])];
  /** When a template last went out, from the send log (by id, or by name for older entries). */
  const lastUsed = (tpl: Template) =>
    (log.data ?? [])
      .filter((c) => c.status === "sent" && c.at && (c.template === tpl.id || c.templateName === tpl.name || c.templateName?.startsWith(`${tpl.name} v`)))
      .map((c) => c.at!)
      .sort()
      .at(-1) ?? null;
  const channelOf = (c: { template: string | null; templateName: string | null }) => {
    const tpl = all.find((x) => x.id === c.template || x.name === c.templateName);
    return tpl?.kind === "letter" ? t("funderCommunications.channel.letter") : tpl?.kind === "agreement" ? t("funderCommunications.channel.agreement") : t("funderCommunications.channel.email");
  };
  const current = all.find((item) => item.id === selected) ?? null;

  useEffect(() => {
    if (selected === null && all[0]) setSelected(all[0].id);
  }, [all, selected]);
  useEffect(() => {
    setDraft(draftOf(current ?? undefined));
    setPreview(null);
  }, [current?.id]);

  const save = useApiMutation((api, input: TemplateInput) => api.createTemplate(input));
  const render = useApiMutation((api, id: string) => api.renderTemplate(id, { ...(sample.data ? { applicationId: sample.data.id } : {}), fields: { decision: { message: t("funderCommunications.afterReviewThisApplication") } } }));
  const dirty = !current || draft.name !== current.name || draft.body !== current.body || draft.subject !== (current.subject ?? "") || draft.kind !== current.kind;
  const unknown = [...new Set([...`${draft.subject}\n${draft.body}`.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map((m) => m[1]!))].filter((f) => !mergeFields.includes(f));
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
    const item = await save.run({ kind: draft.kind, name: draft.name.trim(), body: draft.body, ...(draft.kind === "email" && draft.subject.trim() ? { subject: draft.subject.trim() } : {}) });
    if (item) {
      templates.reload();
      setSelected(item.id);
    }
  }

  return (
    <>
      <title>{t("funderCommunications.communications", { name: ws.name })}</title>
      <FunderShell active="Communications">
        <main className="main">
          <PageHeader
            crumbs={[{ label: ws.name, to: `/w/${ws.handle}` }, { label: t("funderCommunications.communications2") }]}
            title={t("funderCommunications.communications2")}
            meta={<span>{t("funderCommunications.templatesForLettersAgreements")}</span>}
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
                {t("funderCommunications.newTemplate")}
              </button>
            }
          />
          {templates.status === "loading" && <Loading label={t("funderCommunications.loadingTemplates")} />}
          {templates.status === "error" && <ErrorBanner error={templates.error} onRetry={templates.reload} />}
          {templates.status === "ready" && (
            <div style={{ display: "grid", gridTemplateColumns: "420px minmax(0, 1fr)", gap: "20px", alignItems: "start" }}>
              <div className="card">
                <div className="card-h">
                  <h3>{t("funderCommunications.templates")}</h3>
                  <span className="small muted">{t("funderCommunications.selectToEdit")}</span>
                </div>
                <div className="tbl-wrap" style={{ border: 0, borderRadius: 0 }} tabIndex={0} role="region" aria-label={t("funderCommunications.templatesScrollable")}>
                  <table className="tbl tbl-compact" aria-label={t("funderCommunications.templates")}>
                    <thead>
                      <tr>
                        <th>{t("funderCommunications.kind")}</th>
                        <th>{t("funderCommunications.name")}</th>
                        <th>{t("funderCommunications.ver")}</th>
                        <th>{t("funderCommunications.lastUsed")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {all.map((tpl) => (
                        <tr key={tpl.id} className={tpl.id === selected ? "sel" : undefined}>
                          <td>{KIND_LABEL[tpl.kind]()}</td>
                          <td>
                            <button type="button" className="b" style={{ border: 0, background: "transparent", font: "inherit", fontWeight: 700, color: "#0D2A43", cursor: "pointer", padding: 0 }} aria-pressed={tpl.id === selected} onClick={() => setSelected(tpl.id)}>
                              {tpl.name}
                            </button>
                          </td>
                          <td>{tpl.builtIn ? t("funderCommunications.builtIn") : t("funderCommunications.v", { version: tpl.version })}</td>
                          <td>{lastUsed(tpl) ? timeAgo(lastUsed(tpl)) : <span className="muted">{t("funderCommunications.never")}</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="card-f small muted">{t("funderCommunications.versionsArePinnedWhen")}</div>
              </div>

              <section className="card" aria-labelledby="editor-h">
                <div className="card-h">
                  <div className="row" style={{ gap: "10px" }}>
                    <h3 id="editor-h">{current ? current.name : t("funderCommunications.newTemplate")}</h3>
                    {current && <span className="tag">{current.builtIn ? t("funderCommunications.kindBuiltIn", { kind: KIND_LABEL[current.kind]() }) : t("funderCommunications.kindVersion", { kind: KIND_LABEL[current.kind](), version: current.version })}</span>}
                  </div>
                  <div className="row" style={{ gap: "8px" }}>
                    <SaveNote state={save.state} savedText={t("funderCommunications.versionSaved")} />
                    {current && !current.builtIn && !current.shared && current.kind === "email" && <ShareToGalleryButton small source={{ type: "template", id: current.id }} name={current.name} disabledReason={dirty ? t("funderCommunications.saveBeforeSharing") : undefined} />}
                    {current && (
                      <button type="button" className="btn btn-sm btn-secondary" disabled={render.state === "saving" || dirty} title={dirty ? t("funderCommunications.saveTheTemplateTo") : undefined} onClick={async () => setPreview((await render.run(current.id)) ?? null)}>
                        <Eye className="ic" aria-hidden="true" />
                        {t("funderCommunications.preview")}
                      </button>
                    )}
                    <button type="button" className="btn btn-sm btn-primary" disabled={save.state === "saving" || !dirty || !draft.name.trim() || !draft.body.trim() || (draft.kind === "email" && !draft.subject.trim())} onClick={saveVersion}>
                      {current && !current.builtIn ? t("funderCommunications.saveAsV", { version: current.version + 1 }) : t("funderCommunications.saveTemplate")}
                    </button>
                  </div>
                </div>
                <div className="card-b" style={{ display: "grid", gridTemplateColumns: "180px minmax(0, 1fr)", gap: "16px", alignItems: "start" }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    <span className="eyebrow">{t("funderCommunications.mergeFields")}</span>
                    <p className="small muted">{t("funderCommunications.clickToInsertAt")}</p>
                    {mergeFields.map((f) => (
                      <button key={f} type="button" className="chip" style={{ justifyContent: "flex-start" }} onClick={() => insert(f)} aria-label={t("funderCommunications.insert", { f })}>
                        <span className="mono" style={{ fontSize: "11px" }}>
                          {mergeField(f)}
                        </span>
                      </button>
                    ))}
                  </div>
                  <div className="col" style={{ gap: "12px" }}>
                    {save.error !== null && <ErrorBanner error={save.error} />}
                    <div className="fld-row">
                      <Field id="tpl-name" label={t("funderCommunications.name")} required>
                        <input className="inp" id="tpl-name" value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
                      </Field>
                      <Field id="tpl-kind" label={t("funderCommunications.kind")}>
                        <select className="sel" id="tpl-kind" value={draft.kind} onChange={(e) => setDraft((d) => ({ ...d, kind: e.target.value as Template["kind"] }))}>
                          <option value="email">{t("funderCommunications.email")}</option>
                          <option value="letter">{t("funderCommunications.letter")}</option>
                          <option value="agreement">{t("funderCommunications.agreement")}</option>
                        </select>
                      </Field>
                    </div>
                    {draft.kind === "email" && (
                      <Field id="tpl-subject" label={t("funderCommunications.subject")} required>
                        <input className="inp" id="tpl-subject" value={draft.subject} onChange={(e) => setDraft((d) => ({ ...d, subject: e.target.value }))} />
                      </Field>
                    )}
                    <Field id="tpl-body" label={t("funderCommunications.body")}>
                      <textarea className="ta" id="tpl-body" ref={body} style={{ minHeight: "300px", fontSize: "13px", lineHeight: 1.6 }} value={draft.body} onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))} />
                    </Field>
                    {unknown.map((f) => (
                      <div key={f} className="bnr bnr-warn">
                        <div>
                          <div className="t">
                            {t.rich("funderCommunications.unknownMergeField", { mergeField: mergeField(f), span: (chunks) => <span className="mono">{chunks}</span> })}
                          </div>
                          <div className="d">{t("funderCommunications.lettersCanUseThe")}</div>
                        </div>
                      </div>
                    ))}
                    {render.error !== null && (
                      <div className="bnr bnr-warn" role="alert">
                        <div>
                          <div className="t">{missing.length ? t("funderCommunications.someMergeFieldsHave") : t("funderCommunications.thePreviewCouldNot")}</div>
                          <div className="d">{missing.length ? missing.map(mergeField).join(", ") : (render.error as Error).message}</div>
                        </div>
                      </div>
                    )}
                    {preview && (
                      <section className="letter" aria-label={t("funderCommunications.renderedPreview")}>
                        <div className="small muted">{t("funderCommunications.renderedFor", { name: sample.data?.applicant.name ?? t("funderCommunications.aSampleRecipient") })}</div>
                        {preview.subject && <div className="b">{preview.subject}</div>}
                        <div style={{ whiteSpace: "pre-wrap" }}>{preview.text}</div>
                      </section>
                    )}
                    {current && <LetterAssistant templateId={current.id} templateName={current.name} />}
                  </div>
                </div>
              </section>
            </div>
          )}

          {templates.status === "ready" && <BulkSend templates={all} onSent={log.reload} />}

          <section className="card" aria-labelledby="log-h">
            <div className="card-h">
              <h3 id="log-h">{t("funderCommunications.sendLog")}</h3>
              <span className="small muted">{t("funderCommunications.sends", { count: log.data?.length ?? 0 })}</span>
            </div>
            {log.status === "loading" && <Loading label={t("funderCommunications.loadingTheSendLog")} />}
            {log.status === "error" && <ErrorBanner error={log.error} onRetry={log.reload} />}
            {log.status === "ready" && log.data.length === 0 && (
              <EmptyState icon={Mail} title={t("funderCommunications.nothingSentYet")}>
                {t("funderCommunications.lettersAndMessagesSent")}
              </EmptyState>
            )}
            {log.status === "ready" && log.data.length > 0 && (
              <div className="tbl-wrap" style={{ border: 0, borderRadius: 0 }} tabIndex={0} role="region" aria-label={t("funderCommunications.sendLogScrollable")}>
                <table className="tbl" aria-label={t("funderCommunications.sendLog")}>
                  <thead>
                    <tr>
                      <th>{t("funderCommunications.time")}</th>
                      <th>{t("funderCommunications.template")}</th>
                      <th>{t("funderCommunications.about")}</th>
                      <th>{t("funderCommunications.channel")}</th>
                      <th>{t("funderCommunications.sentBy")}</th>
                      <th>{t("funderCommunications.status")}</th>
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
                                {t("funderCommunications.sent")}
                              </span>
                            ) : (
                              <span className="bdg bdg-dng">
                                <CircleX className="ic" aria-hidden="true" />
                                {t("funderCommunications.failed")}
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
