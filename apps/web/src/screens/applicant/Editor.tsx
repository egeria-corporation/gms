// SPDX-License-Identifier: AGPL-3.0-only
// Application editor. The current stage's forms are edited with the form renderer and saved
// field by field (only changed paths are sent; the server merges), so teammates and a scoped
// consultant can work at once. Passport-owned fields are read-only here. The submit dialog runs
// the readiness checklist and submits; a 422 comes back as the list of fields to fix.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate, useParams } from "react-router";
import { BookOpen, Check, CircleCheck, CircleDashed, CircleX, Clock, FileText, Lock, MessageSquare, ShieldCheck, TriangleExclamationPoint, Upload, X } from "lucide-react";
import { passportFieldPaths, type FormDefinition, type JsonObject } from "@gms/forms";
import type { Answer, AppDocument, AppForm, ApplicantApi, ApplicantMember, ApplicantReadiness, Application, Comment, MyApplication, MyOrganization } from "../../api/applicant.ts";
import { useApplicantApi, useApplicantQuery, useRealtime } from "../../api/applicantHooks.ts";
import { useMoreApi } from "../../api/applicantMoreHooks.ts";
import type { Peer } from "../../api/applicantRealtime.ts";
import { ApiError } from "../../api/client.ts";
import type { Checklist } from "../../api/types.ts";
import { useServices } from "../../app/services.tsx";
import { useWorkspace } from "../../app/workspace.tsx";
import { accentOf, Avatar, closesPhrase, FunderChip, isNotFound, Loaded, timeAgo } from "../../components/applicant.tsx";
import { Dialog } from "../../components/Dialog.tsx";
import { NotFound } from "../../components/NotFound.tsx";
import { PhoneShell, usePhoneSheetSlot } from "../../components/PhoneShell.tsx";
import { ApplicantShell } from "../../components/shells.tsx";
import { LevelBadge, StatusBadge } from "../../components/status.tsx";
import { ErrorBanner, errorMessage, Notice, ReadinessChecklist, TabPanel, Tabs } from "../../components/ui.tsx";
import { FormView, type UploadedFile } from "../../forms/FormView.tsx";
import { fieldLabel, patchFor, rebase, sectionFor, sectionsOf, sectionState, type Section } from "./editorSync.ts";
import { EditorAssistant } from "./editorAssist.tsx";

interface EditorData {
  app: Application;
  summary: MyApplication | undefined;
  defs: Record<string, FormDefinition>;
  comments: Comment[];
  attachments: AppDocument[];
  members: ApplicantMember[];
  sections: Record<string, Record<string, string>>;
  answers: Answer[];
  readiness: ApplicantReadiness;
  org: MyOrganization;
}

async function loadEditor(api: ApplicantApi, id: string): Promise<EditorData> {
  const [app, list, comments, attachments, members, answers, readiness, org] = await Promise.all([
    api.application(id),
    api.applications(),
    api.comments(id),
    api.attachments(id),
    api.members(),
    api.answers(),
    api.readiness(),
    api.organization(),
  ]);
  const defs = Object.fromEntries(await Promise.all(app.forms.map(async (f) => [f.formId, await api.form(f.formId, f.version)] as const)));
  const sections = Object.fromEntries(await Promise.all(app.forms.filter((f) => !f.lockedAt).map(async (f) => [f.formId, (await api.sections(id, `frm_${f.formId}`)).sections] as const)));
  return { app, summary: list.find((a) => a.id === app.id), defs, comments, attachments, members, sections, answers, readiness, org };
}

const toBase64 = async (file: File): Promise<string> => {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
};

const SEC_ICON = { done: CircleCheck, prog: Clock, todo: CircleDashed } as const;
const slug = (label: string) => `sec-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
const fileKind = (name: string) => (/\.pdf$/i.test(name) ? "pdf" : /\.(xlsx?|csv)$/i.test(name) ? "xls" : /\.docx?$/i.test(name) ? "doc" : "");
const kb = (n: number) => (n >= 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

type SaveState = "idle" | "saving" | "saved" | "error";
type PanelTab = "validation" | "comments" | "assignments";

function EditorBody({ data, openSubmit, phone }: { data: EditorData; openSubmit: boolean; phone: boolean }) {
  const ws = useWorkspace("applicant");
  const base = `/w/${ws.handle}`;
  const api = useApplicantApi();
  const more = useMoreApi();
  const realtime = useRealtime();
  const { sessionState } = useServices();
  const navigate = useNavigate();
  const { app, summary, defs } = data;

  const editableForms = app.forms.filter((f) => !f.lockedAt);
  const lockedForms = app.forms.filter((f) => f.lockedAt);
  // One form is edited at a time; most stages have exactly one.
  const [activeFormId, setActiveFormId] = useState(editableForms[0]?.formId ?? "");
  const [forms, setForms] = useState<Record<string, AppForm>>(() => Object.fromEntries(app.forms.map((f) => [f.formId, f])));
  const [comments, setComments] = useState(data.comments);
  const [attachments, setAttachments] = useState(data.attachments);
  const [owners, setOwners] = useState(data.sections);
  const [save, setSave] = useState<{ state: SaveState; at?: string; error?: unknown }>({ state: "idle" });
  const [rejected, setRejected] = useState<string[]>([]);
  const [peers, setPeers] = useState<Peer[]>([]);
  const [tab, setTab] = useState<PanelTab>("validation");
  const [showAll, setShowAll] = useState(false);
  const [submitOpen, setSubmitOpen] = useState(openSubmit);
  const [submit, setSubmit] = useState<{ state: "idle" | "sending"; error?: unknown }>({ state: "idle" });
  const [libraryOpen, setLibraryOpen] = useState(false);
  // Phone: the validation, comments and assignments panel is a sheet above the bottom tabs.
  const [sheetOpen, setSheetOpen] = useState(false);
  const sheetSlot = usePhoneSheetSlot();
  const dock = (panel: ReactElement) => (phone && sheetSlot ? createPortal(panel, sheetSlot) : panel);

  // The last response the server gave for each form, and what is on screen now.
  const baseline = useRef<Record<string, JsonObject>>(Object.fromEntries(app.forms.map((f) => [f.formId, f.response])));
  const local = useRef<Record<string, JsonObject>>({ ...baseline.current });
  const room = useRef<ReturnType<typeof realtime.join> | null>(null);
  const saving = useRef<Promise<void>>(Promise.resolve());

  const me: Peer = useMemo(() => ({ userId: sessionState.status === "signedIn" ? sessionState.session.userId : "me", name: ws.member.name }), [sessionState, ws.member.name]);

  /** Takes a newer server state of a form and keeps whatever this person typed since `sent`. */
  const adopt = useCallback((next: AppForm, sent: JsonObject) => {
    const shown = rebase(next.response, sent, local.current[next.formId] ?? sent);
    baseline.current[next.formId] = next.response;
    local.current[next.formId] = shown;
    setForms((prev) => ({ ...prev, [next.formId]: { ...next, response: shown } }));
  }, []);

  const push = useCallback(
    (formId: string): Promise<void> => {
      // Saves run one after another so each patch is computed against the server's latest answer.
      saving.current = saving.current.then(async () => {
        const sent = local.current[formId];
        const patch = sent && patchFor(baseline.current[formId] ?? {}, sent);
        if (!sent || !patch) return;
        setSave({ state: "saving" });
        try {
          const saved = await api.saveForm(app.id, formId, patch);
          adopt(saved, sent);
          setRejected(saved.rejected);
          setSave({ state: "saved", at: saved.lastModifiedAt || new Date().toISOString() });
          room.current?.saved(formId);
        } catch (error) {
          setSave({ state: "error", error });
        }
      });
      return saving.current;
    },
    [api, app.id, adopt],
  );

  // Presence, and a re-read when a teammate saves.
  useEffect(() => {
    const r = realtime.join(app.uuid, me, {
      onPeers: setPeers,
      onSaved: (formId) => {
        const before = baseline.current[formId] ?? {};
        void api.application(app.id).then((fresh) => {
          const f = fresh.forms.find((x) => x.formId === formId);
          if (f) adopt(f, before);
        });
      },
    });
    room.current = r;
    return () => {
      r.leave();
      room.current = null;
    };
  }, [realtime, api, app.id, app.uuid, me, adopt]);

  const active = forms[activeFormId];
  const def = defs[activeFormId];
  const sections: Section[] = useMemo(() => (def ? sectionsOf(def) : []), [def]);
  const errors = active?.validationErrors ?? [];
  const formOwners = owners[activeFormId] ?? {};
  const memberName = (userId: string | undefined) => {
    const m = data.members.find((x) => x.userId === userId);
    return m ? (m.name ?? m.email ?? "Teammate") : null;
  };
  const openComments = comments.filter((c) => !c.resolvedAt);
  const goTo = (label: string) => document.getElementById(slug(label))?.scrollIntoView({ behavior: "smooth", block: "start" });

  // FormView draws one card per group; give each an anchor the rail and the Fix links can reach.
  const formRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    for (const s of sections) {
      const el = [...(formRef.current?.querySelectorAll<HTMLElement>("section[aria-label]") ?? [])].find((n) => n.getAttribute("aria-label") === s.label);
      if (el) el.id = slug(s.label);
    }
  });

  const uploadFile = async (file: File): Promise<UploadedFile> => {
    const doc = await api.attach(app.id, { name: file.name, mime: file.type || "application/octet-stream", contentBase64: await toBase64(file) });
    setAttachments((prev) => [...prev, doc]);
    return { documentId: doc.id, name: doc.name, size: doc.size };
  };

  // Inserting goes through the library route so the field is recorded as "From library" and the
  // answer knows where it was used.
  const insertAnswer = async (answer: Answer, field: string) => {
    if (!active) return;
    setLibraryOpen(false);
    await push(activeFormId);
    const sent = local.current[activeFormId] ?? active.response;
    setSave({ state: "saving" });
    try {
      const saved = await more.insertAnswer(app.id, activeFormId, { answerId: answer.id, path: `/${field}` });
      adopt(saved, sent);
      setSave({ state: "saved", at: saved.lastModifiedAt || new Date().toISOString() });
      room.current?.saved(activeFormId);
    } catch (error) {
      setSave({ state: "error", error });
    }
  };

  const stageErrors = editableForms.flatMap((f) => (forms[f.formId]?.validationErrors ?? []).map((e) => ({ formId: f.formId, ...e })));
  const eligibility = app.eligibility;
  const closes = closesPhrase(summary?.stage.closes);
  const checklist: Checklist = useMemo(() => {
    const unknown = eligibility?.results.filter((r) => r.outcome === "unknown").length ?? 0;
    const items: Checklist["items"] = [
      {
        key: "sections",
        state: stageErrors.length === 0 ? "pass" : "fail",
        label: "Required sections complete",
        reason: stageErrors.length === 0 ? `${sections.length} of ${sections.length} sections` : `${stageErrors.length} answer${stageErrors.length === 1 ? "" : "s"} to fix`,
        fixHref: null,
      },
      {
        key: "eligibility",
        state: !eligibility || eligibility.eligible === "unknown" ? "unknown" : eligibility.eligible ? "pass" : "fail",
        label: "Eligibility preview",
        reason: !eligibility
          ? "Not evaluated yet"
          : eligibility.eligible === true
            ? `${eligibility.results.length} of ${eligibility.results.length} rules pass against your Passport record`
            : eligibility.eligible === false
              ? (eligibility.results.find((r) => r.outcome === "fail")?.label ?? "A rule does not pass")
              : `${unknown} rule${unknown === 1 ? "" : "s"} could not be checked; a program officer reviews them`,
        fixHref: eligibility?.eligible === false ? `${base}/organization` : null,
      },
      {
        key: "passport",
        state: data.readiness.linked ? "pass" : "fail",
        label: "Passport connected",
        reason: data.readiness.linked ? `Level ${data.readiness.level ?? "unknown"} and your attestation are attached at submission` : "Connect Passport so your verification level travels with the submission",
        fixHref: data.readiness.linked ? null : "/onboarding/applicant",
      },
    ];
    const fail = items.filter((i) => i.state === "fail").length;
    const unk = items.filter((i) => i.state === "unknown").length;
    return { ready: fail === 0, summary: { pass: items.length - fail - unk, fail, unknown: unk }, items };
  }, [stageErrors.length, sections.length, eligibility, data.readiness, base]);

  const onSubmit = async () => {
    setSubmit({ state: "sending" });
    try {
      await push(activeFormId);
      await api.submit(app.id);
      navigate(`${base}/applications/${app.id}/submitted`);
    } catch (error) {
      setSubmit({ state: "idle", error });
      if (error instanceof ApiError && error.status === 422) {
        // The server found something this page had not: show every problem and take its state.
        setShowAll(true);
        const fresh = await api.application(app.id).catch(() => null);
        for (const f of fresh?.forms ?? []) adopt(f, baseline.current[f.formId] ?? {});
      }
    }
  };
  const submitProblems = submit.error instanceof ApiError ? (submit.error.errors as { field?: string; detail?: string }[]).filter((p) => p.field) : [];

  if (!active || !def) {
    return (
      <Notice tone="info" title="Nothing to edit at this stage">
        This application has no open form. <Link to={`${base}/applications/${app.id}`}>See its status</Link>
      </Notice>
    );
  }

  // Library answers go into free-text fields only: never into a value that comes from Passport.
  const fromPassport = passportFieldPaths(def);
  const textFields = Object.entries(def.jsonSchema.properties ?? {}).filter(([k, s]) => s.type === "string" && !s.enum && !s.format && !rejected.includes(`/${k}`) && !fromPassport.includes(`/${k}`));

  return (
    <>
      <div className="crumbs">
        <Link to={base}>Dashboard</Link>
        <span>›</span>
        <Link to={`${base}/applications`}>Applications</Link>
        <span>›</span>
        <span>{app.title}</span>
      </div>

      <div className="card" style={{ padding: "14px 20px", display: "flex", alignItems: "center", gap: "16px", flexWrap: "wrap" }}>
        <FunderChip name={summary?.funder.name} accent={accentOf(summary?.funder.brand)} />
        <div style={{ display: "flex", flexDirection: "column", gap: "2px", minWidth: "0" }}>
          {phone ? <h2 style={{ fontSize: "20px" }}>{app.title}</h2> : <h1 style={{ fontSize: "20px" }}>{app.title}</h1>}
          <div className="row small muted" style={{ gap: "10px", flexWrap: "wrap" }}>
            {summary?.opportunity.title && <span>{summary.opportunity.title}</span>}
            <span>·</span>
            <StatusBadge kind="application" status={app.status} label={`${summary?.stage.label ?? app.stage} · ${app.status === "draft" ? "Draft" : "Revision requested"}`} />
            {closes && (
              <>
                <span>·</span>
                <span className="b" style={closes.urgent ? { color: "var(--s-warn-fg)" } : undefined}>
                  {closes.text}
                </span>
              </>
            )}
          </div>
        </div>
        <div className="row" style={{ marginLeft: "auto", gap: "14px", flexWrap: "wrap" }}>
          <span className="notice" role="status">
            {save.state === "saving" && "Saving…"}
            {save.state === "saved" && (
              <>
                <Check className="ic" aria-hidden="true" />
                Saved {save.at ? timeAgo(save.at) : ""}
              </>
            )}
            {save.state === "idle" && (
              <>
                <Check className="ic" aria-hidden="true" />
                All changes saved
              </>
            )}
            {save.state === "error" && (
              <span className="err-msg">
                <TriangleExclamationPoint className="ic ic-sm" aria-hidden="true" />
                Not saved: {errorMessage(save.error)}
              </span>
            )}
          </span>
          <div className="pres" aria-label={`Editing now: ${[me, ...peers].map((p) => p.name).join(", ")}`}>
            <Avatar name={me.name} note="(you)" live />
            {peers.map((p, i) => (
              <Avatar key={p.userId} name={p.name} {...(p.section ? { note: `· ${p.section}` } : {})} index={i + 1} live />
            ))}
          </div>
          <Link to="/preview/pdf/application-snapshot" className="btn btn-secondary">
            Preview
          </Link>
          <button className="btn btn-primary" type="button" aria-haspopup="dialog" onClick={() => setSubmitOpen(true)}>
            Submit…
          </button>
        </div>
      </div>

      {app.status === "revision_requested" && (
        <Notice tone="warn" title="The funder asked for a revision">
          Make the changes and submit again. <Link to={`${base}/applications/${app.id}`}>Read the request</Link>
        </Notice>
      )}

      {phone && (
        <nav className="pillrow" aria-label="Sections" style={{ display: "flex", gap: "8px", overflowX: "auto", padding: "4px 0", scrollbarWidth: "none" }}>
          {sections.map((sec) => {
            const st = sectionState(sec, active.response, errors);
            const Icon = SEC_ICON[st.state];
            return (
              <a key={sec.label} href={`#${slug(sec.label)}`} className="fchip" style={{ height: "36px", flex: "none", textDecoration: "none", ...(st.state === "done" ? { color: "var(--s-ok-fg)" } : {}) }}>
                <Icon className="ic ic-sm" aria-hidden="true" />
                {sec.label}
              </a>
            );
          })}
        </nav>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "248px minmax(0, 1fr) 320px", gap: "20px", alignItems: "start" }}>
        <aside className="card" style={{ padding: "12px", ...(phone ? { display: "none" } : {}) }}>
          <div className="eyebrow" style={{ padding: "4px 10px 10px" }}>
            Sections · {sections.filter((s) => sectionState(s, active.response, errors).state === "done").length} of {sections.length} complete
          </div>
          {editableForms.length > 1 && (
            <div className="seg" role="group" aria-label="Form" style={{ margin: "0 6px 10px" }}>
              {editableForms.map((f) => (
                <button key={f.formId} type="button" className={f.formId === activeFormId ? "on" : ""} aria-pressed={f.formId === activeFormId} onClick={() => setActiveFormId(f.formId)}>
                  {defs[f.formId]?.title ?? "Form"}
                </button>
              ))}
            </div>
          )}
          <nav className="sec" aria-label="Application sections">
            {sections.map((s) => {
              const st = sectionState(s, active.response, errors);
              const Icon = SEC_ICON[st.state];
              const owner = memberName(formOwners[s.label]);
              const n = openComments.filter((c) => c.fieldPath && sectionFor(sections, c.fieldPath) === s).length;
              return (
                <a
                  key={s.label}
                  href={`#${slug(s.label)}`}
                  className={`s-${st.state}`}
                  onClick={(e) => {
                    e.preventDefault();
                    goTo(s.label);
                    room.current?.focus(s.label);
                  }}
                >
                  <Icon className="ic" aria-hidden="true" />
                  <div>
                    <div className="nm">{s.label}</div>
                    <div className="st">{st.state === "done" ? "Complete" : st.state === "prog" ? `In progress · ${st.problems.length} to fix` : "Not started"}</div>
                  </div>
                  <span className="meta">
                    {n > 0 && (
                      <>
                        <MessageSquare className="ic" aria-hidden="true" />
                        {n}
                      </>
                    )}
                    {owner ? <Avatar name={owner} size="sm" /> : null}
                  </span>
                </a>
              );
            })}
            {lockedForms.map((f) => (
              <a key={f.formId} href={`#locked-${f.formId}`} className="s-lock">
                <Lock className="ic" aria-hidden="true" />
                <div>
                  <div className="nm">{defs[f.formId]?.title ?? "Earlier stage"} responses</div>
                  <div className="st">Locked · prior stage, read-only</div>
                </div>
                <span className="meta"></span>
              </a>
            ))}
          </nav>
          <div className="small muted" style={{ padding: "10px 10px 4px" }}>
            Form v{active.version} · pinned by {summary?.funder.name ?? "the funder"}
          </div>
        </aside>

        <div style={{ display: "flex", flexDirection: "column", gap: "16px", minWidth: 0 }}>
          {rejected.length > 0 && (
            <Notice tone="info" title="Some fields follow your Passport record">
              {rejected.map((p) => fieldLabel(def, p)).join(", ")} can only be changed in Passport.{" "}
              {data.org.editUrl && <a href={data.org.editUrl}>Edit in Passport</a>}
            </Notice>
          )}
          <div className="row" style={{ gap: "10px", flexWrap: "wrap" }}>
            <button className="btn btn-sm btn-secondary" type="button" aria-haspopup="dialog" onClick={() => setLibraryOpen(true)} disabled={!data.answers.length || !textFields.length}>
              <BookOpen className="ic" aria-hidden="true" />
              Insert from answer library
            </button>
            {!showAll && errors.length > 0 && (
              <button className="btn btn-sm btn-ghost" type="button" onClick={() => setShowAll(true)}>
                Show everything left to fix
              </button>
            )}
          </div>
          <div ref={formRef}>
            <FormView
              form={def}
              response={active.response}
              mode="edit"
              provenance={active.provenance}
              showAllErrors={showAll}
              onChange={(r) => {
                local.current[activeFormId] = r;
              }}
              onAutosave={() => void push(activeFormId)}
              uploadFile={uploadFile}
              {...(data.org.editUrl ? { passportUrl: data.org.editUrl } : {})}
            />
          </div>

          <section className="card" aria-labelledby="att-h">
            <div className="card-h">
              <div>
                <h3 id="att-h">Attachments</h3>
                <p className="small muted">Files uploaded here stay with this application. Files in your Passport locker are referenced, not copied.</p>
              </div>
              <span className="bdg bdg-neutral">
                <FileText className="ic" aria-hidden="true" />
                {attachments.length} file{attachments.length === 1 ? "" : "s"}
              </span>
            </div>
            <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              {attachments.map((d) => (
                <div className="doc" key={d.id}>
                  <span className={`ft${fileKind(d.name) ? ` ft-${fileKind(d.name)}` : ""}`}>{(fileKind(d.name) || "file").toUpperCase()}</span>
                  <div className="grow">
                    <div className="nm">{d.name}</div>
                    <div className="mt">
                      <span>{kb(d.size)}</span>
                      <span>·</span>
                      {d.source === "passport_locker" ? <span className="prov prov-passport">Passport locker</span> : <span>Uploaded {timeAgo(d.uploadedAt)}</span>}
                      <span>·</span>
                      <span className="mono">
                        sha256 {d.sha256.slice(0, 4)}…{d.sha256.slice(-4)}
                      </span>
                      {d.scanStatus === "not_scanned" && <span>· not scanned</span>}
                    </div>
                  </div>
                </div>
              ))}
              <label className="btn btn-secondary" style={{ alignSelf: "flex-start" }}>
                <Upload className="ic" aria-hidden="true" />
                Upload a file
                <input
                  type="file"
                  className="sr"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (file) void uploadFile(file).catch((error: unknown) => setSave({ state: "error", error }));
                  }}
                />
              </label>
            </div>
          </section>

          {lockedForms.map((f) => {
            const d = defs[f.formId];
            return d ? (
              <section className="card" key={f.formId} id={`locked-${f.formId}`} aria-label={`${d.title} responses`}>
                <div className="card-h">
                  <div>
                    <h3>{d.title} responses</h3>
                    <p className="small muted">Prior-stage responses are read-only and visible to reviewers.</p>
                  </div>
                  <span className="bdg bdg-neutral">
                    <Lock className="ic" aria-hidden="true" />
                    Locked
                  </span>
                </div>
                <details className="card-b">
                  <summary className="b" style={{ cursor: "pointer" }}>
                    Show what was submitted
                  </summary>
                  <div style={{ marginTop: "12px" }}>
                    <FormView form={d} response={f.response} mode="funder" provenance={f.provenance} />
                  </div>
                </details>
              </section>
            ) : null;
          })}
        </div>

        {dock(
        <aside
          {...(phone ? { className: "sheet", "aria-label": "Validation and comments" } : {})}
          style={{ display: "flex", flexDirection: "column", gap: phone ? "0" : "16px", minWidth: 0, ...(phone ? { flex: "none", maxHeight: "60vh", overflowY: sheetOpen ? "auto" : "hidden" } : {}) }}
        >
          {phone && (
            <>
              <div className="grab" aria-hidden="true"></div>
              <button type="button" className="row" aria-expanded={sheetOpen} aria-controls="ed-sheet" style={{ width: "100%", minHeight: "44px", padding: "0 16px", border: 0, background: "transparent", font: "inherit", fontWeight: 700, color: "var(--og-navy-dark)", justifyContent: "space-between", cursor: "pointer" }} onClick={() => setSheetOpen(!sheetOpen)}>
                <span>
                  Validation{stageErrors.length ? ` · ${stageErrors.length} to fix` : " · nothing to fix"} · Comments {openComments.length}
                </span>
                <span className="small muted">{sheetOpen ? "Hide" : "Show"}</span>
              </button>
            </>
          )}
          <div id="ed-sheet" className="card" style={phone ? { border: 0, borderRadius: 0, display: sheetOpen ? undefined : "none" } : undefined}>
            <div style={{ padding: "0 12px" }}>
              <Tabs<PanelTab>
                label="Application panel"
                idPrefix="ed"
                active={tab}
                onChange={setTab}
                tabs={[
                  { key: "validation", label: "Validation", count: errors.length },
                  { key: "comments", label: "Comments", count: openComments.length },
                  { key: "assignments", label: "Assignments" },
                ]}
              />
            </div>
            <div className="card-b" style={{ padding: "16px" }}>
              <TabPanel idPrefix="ed" tab="validation" active={tab}>
                {errors.length === 0 ? (
                  <div className="row" style={{ gap: "8px", color: "var(--s-ok-fg)", fontWeight: 700 }}>
                    <CircleCheck className="ic" aria-hidden="true" />
                    Nothing left to fix in this form
                  </div>
                ) : (
                  <>
                    <div className="eyebrow" style={{ marginBottom: "6px" }}>
                      To fix · {errors.length}
                    </div>
                    <ul className="rc">
                      {errors.map((e, i) => {
                        const s = sectionFor(sections, e.field);
                        return (
                          <li key={`${e.field}-${i}`} className="rc-row rc-fail" style={i === 0 ? { borderTop: 0 } : undefined}>
                            <CircleX className="ic" role="img" aria-label="Needs attention" />
                            <div>
                              <div className="l">{fieldLabel(def, e.field)}</div>
                              <div className="r">{e.message}</div>
                            </div>
                            {s ? (
                              <a
                                href={`#${slug(s.label)}`}
                                className="fix"
                                onClick={(ev) => {
                                  ev.preventDefault();
                                  setShowAll(true);
                                  goTo(s.label);
                                }}
                              >
                                Fix →
                              </a>
                            ) : (
                              <span />
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </>
                )}
                <div className="divider" style={{ margin: "14px 0" }}></div>
                <div className="eyebrow" style={{ marginBottom: "8px" }}>
                  Eligibility preview
                </div>
                {eligibility ? (
                  <ul style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "14px" }}>
                    {eligibility.results.map((r, i) => {
                      const Icon = r.outcome === "pass" ? CircleCheck : r.outcome === "fail" ? CircleX : CircleDashed;
                      const color = r.outcome === "pass" ? "var(--s-ok-fg)" : r.outcome === "fail" ? "var(--s-dng-fg)" : "var(--og-gray-600)";
                      return (
                        <li key={i} className="row" style={{ gap: "6px", color, alignItems: "flex-start" }} title={r.explain}>
                          <Icon className="ic" role="img" aria-label={r.outcome === "pass" ? "Passes" : r.outcome === "fail" ? "Does not pass" : "Could not be checked"} style={{ marginTop: "3px" }} />
                          {r.label}
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="small muted">Eligibility is evaluated when you submit.</p>
                )}
                {data.readiness.linked && (
                  <div className="bnr bnr-info" style={{ marginTop: "12px" }}>
                    <ShieldCheck className="ic" aria-hidden="true" />
                    <div>
                      <div className="t" style={{ fontSize: "14px" }}>
                        Passport level {data.readiness.level ?? "—"} will be attached
                      </div>
                      <div className="d" style={{ fontSize: "13px" }}>
                        Your attestation and payee status travel with the submission.
                      </div>
                    </div>
                  </div>
                )}
              </TabPanel>

              <TabPanel idPrefix="ed" tab="comments" active={tab}>
                <CommentsPanel
                  comments={comments}
                  def={def}
                  onAdd={async (body, fieldPath) => {
                    const c = await api.addComment(app.id, { body, formId: `frm_${activeFormId}`, ...(fieldPath ? { fieldPath } : {}) });
                    setComments((prev) => [c, ...prev]);
                  }}
                  onResolve={async (id) => {
                    const c = await api.resolveComment(app.id, id);
                    setComments((prev) => prev.map((x) => (x.id === id ? c : x)));
                  }}
                />
              </TabPanel>

              <TabPanel idPrefix="ed" tab="assignments" active={tab}>
                <p className="small muted" style={{ marginBottom: "10px" }}>
                  Who owns each section. A consultant only sees the applications they are scoped to.
                </p>
                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  {sections.map((s) => (
                    <div className="fld" key={s.label}>
                      <label className="lbl" htmlFor={`own-${slug(s.label)}`} style={{ fontSize: "13px" }}>
                        {s.label}
                      </label>
                      <select
                        className="sel"
                        id={`own-${slug(s.label)}`}
                        style={{ height: "36px", fontSize: "14px" }}
                        value={formOwners[s.label] ?? ""}
                        onChange={async (e) => {
                          const r = await api.assignSections(app.id, `frm_${activeFormId}`, { [s.label]: e.target.value || null });
                          setOwners((prev) => ({ ...prev, [activeFormId]: r.sections }));
                        }}
                      >
                        <option value="">Unassigned</option>
                        {data.members.map((m) => (
                          <option key={m.userId} value={m.userId}>
                            {m.name ?? m.email ?? m.userId}
                            {m.role === "consultant" ? " (consultant)" : ""}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              </TabPanel>
            </div>
          </div>
          {!phone ? <EditorAssistant answers={data.answers} fields={textFields.map(([k, f]) => ({ key: k, label: typeof f.title === "string" ? f.title : k }))} /> : null}
        </aside>,
        )}
      </div>

      <Dialog open={submitOpen} onClose={() => setSubmitOpen(false)} labelledBy="submit-title" size="lg">
        <div className="hd">
          <div>
            <h2 id="submit-title" style={{ fontSize: "20px" }}>
              Ready to submit?
            </h2>
            <p className="small muted" style={{ marginTop: "4px" }}>
              {[summary?.funder.name, summary?.opportunity.title, summary?.stage.label].filter(Boolean).join(" · ")}
            </p>
          </div>
          <button className="iconbtn" type="button" aria-label="Close" onClick={() => setSubmitOpen(false)}>
            <X className="ic ic-md" aria-hidden="true" />
          </button>
        </div>
        <div className="bd" style={{ gap: "10px" }}>
          <ReadinessChecklist checklist={checklist} />
          {submit.error && submitProblems.length === 0 ? <ErrorBanner error={submit.error} title="The application was not submitted" /> : null}
          {submitProblems.length > 0 && (
            <div className="bnr bnr-dng" role="alert">
              <CircleX className="ic" aria-hidden="true" />
              <div>
                <div className="t">The server found {submitProblems.length} thing{submitProblems.length === 1 ? "" : "s"} to fix</div>
                <ul className="d">
                  {submitProblems.slice(0, 6).map((p, i) => (
                    <li key={i}>
                      {fieldLabel(def, (p.field ?? "").replace(/^[0-9a-f-]{36}/, ""))}: {p.detail}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
          <div className="bnr bnr-info">
            <ShieldCheck className="ic" aria-hidden="true" />
            <div>
              <div className="t">
                Your Passport level <LevelBadge level={data.readiness.level} /> and attestation will be attached to this submission
              </div>
              <div className="d">{summary?.funder.name ?? "The funder"} receives a snapshot of this application, your attestation and your payee status (bank name and last four digits only). Nothing else from Passport is shared.</div>
            </div>
          </div>
          <p className="small muted">
            {summary?.stage.closes ? `You can withdraw until the stage closes. ` : ""}Submitting gives this funder permission to read your Passport record for this application.
          </p>
        </div>
        <div className="ft">
          <button className="btn btn-secondary" type="button" onClick={() => setSubmitOpen(false)}>
            Cancel
          </button>
          <button className="btn btn-primary btn-lg" type="button" onClick={onSubmit} disabled={!checklist.ready || submit.state === "sending"} aria-describedby={checklist.ready ? undefined : "submit-why"}>
            {submit.state === "sending" ? "Submitting…" : "Submit application"}
          </button>
          {!checklist.ready && (
            <span id="submit-why" className="sr">
              Fix the failing checks before submitting
            </span>
          )}
        </div>
      </Dialog>

      <Dialog open={libraryOpen} onClose={() => setLibraryOpen(false)} labelledBy="lib-title">
        <InsertAnswer answers={data.answers} fields={textFields.map(([k, s]) => ({ key: k, label: typeof s.title === "string" ? s.title : k }))} onInsert={insertAnswer} onClose={() => setLibraryOpen(false)} />
      </Dialog>
    </>
  );
}

function CommentsPanel({ comments, def, onAdd, onResolve }: { comments: Comment[]; def: FormDefinition; onAdd: (body: string, fieldPath: string) => Promise<void>; onResolve: (id: string) => Promise<void> }) {
  const [body, setBody] = useState("");
  const [field, setField] = useState("");
  const [busy, setBusy] = useState(false);
  const fields = Object.entries(def.jsonSchema.properties ?? {});
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
      {comments.length === 0 && <p className="small muted">No comments yet. Comments are for your team; the funder never sees them.</p>}
      {comments.map((c) => (
        <div key={c.id} className={c.resolvedAt ? "cmt cmt-res" : "cmt"}>
          <div className="hd">
            <Avatar name={c.author} size="sm" />
            <span className="who">{c.author}</span>
            <span>· {timeAgo(c.createdAt)}</span>
            <span className="int-mark">Team</span>
          </div>
          {c.fieldPath && <div className="fld-ref">on “{fieldLabel(def, c.fieldPath)}”</div>}
          <div className="bd">{c.body}</div>
          {c.resolvedAt ? (
            <span className="small muted">Resolved {timeAgo(c.resolvedAt)}</span>
          ) : (
            <button className="btn btn-sm btn-ghost" type="button" style={{ alignSelf: "flex-start" }} onClick={() => void onResolve(c.id)}>
              Resolve
            </button>
          )}
        </div>
      ))}
      <form
        className="col"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!body.trim()) return;
          setBusy(true);
          try {
            await onAdd(body.trim(), field);
            setBody("");
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="sr" htmlFor="cmt-field">
          Field this comment is about
        </label>
        <select className="sel" id="cmt-field" style={{ height: "36px", fontSize: "14px" }} value={field} onChange={(e) => setField(e.target.value)}>
          <option value="">Whole application</option>
          {fields.map(([k, s]) => (
            <option key={k} value={`/${k}`}>
              {typeof s.title === "string" ? s.title : k}
            </option>
          ))}
        </select>
        <label className="sr" htmlFor="cmt-body">
          Write a comment for your team
        </label>
        <textarea className="ta" id="cmt-body" style={{ minHeight: "60px" }} placeholder="Write a comment for your team" value={body} onChange={(e) => setBody(e.target.value)} />
        <button className="btn btn-secondary" type="submit" disabled={busy || !body.trim()} style={{ alignSelf: "flex-start" }}>
          Comment
        </button>
      </form>
    </div>
  );
}

function InsertAnswer({ answers, fields, onInsert, onClose }: { answers: Answer[]; fields: { key: string; label: string }[]; onInsert: (a: Answer, field: string) => Promise<void>; onClose: () => void }) {
  const [answerId, setAnswerId] = useState(answers[0]?.id ?? "");
  const [field, setField] = useState(fields[0]?.key ?? "");
  const answer = answers.find((a) => a.id === answerId);
  return (
    <>
      <div className="hd">
        <div>
          <h3 id="lib-title" style={{ fontSize: "16px" }}>
            Insert from answer library
          </h3>
          <p className="small muted">The text replaces what is in the field. You can edit it afterwards; the library copy is not changed.</p>
        </div>
        <button className="iconbtn" type="button" aria-label="Close" onClick={onClose}>
          <X className="ic ic-md" aria-hidden="true" />
        </button>
      </div>
      <div className="bd">
        <div className="fld">
          <label className="lbl" htmlFor="lib-answer">
            Answer
          </label>
          <select className="sel" id="lib-answer" value={answerId} onChange={(e) => setAnswerId(e.target.value)}>
            {answers.map((a) => (
              <option key={a.id} value={a.id}>
                {a.title} · v{a.version} · {a.words} words
              </option>
            ))}
          </select>
        </div>
        <div className="fld">
          <label className="lbl" htmlFor="lib-field">
            Insert into
          </label>
          <select className="sel" id="lib-field" value={field} onChange={(e) => setField(e.target.value)}>
            {fields.map((f) => (
              <option key={f.key} value={f.key}>
                {f.label}
              </option>
            ))}
          </select>
        </div>
        {answer && (
          <p className="small" style={{ maxHeight: "140px", overflow: "auto" }}>
            {answer.body}
          </p>
        )}
      </div>
      <div className="ft">
        <button className="btn btn-secondary" type="button" onClick={onClose}>
          Cancel
        </button>
        <button className="btn btn-primary" type="button" disabled={!answer || !field} onClick={() => answer && void onInsert(answer, field)}>
          Insert
        </button>
      </div>
    </>
  );
}

const keys = new WeakMap<object, number>();
let nextKey = 0;
const keyOf = (data: object): number => {
  if (!keys.has(data)) keys.set(data, ++nextKey);
  return keys.get(data)!;
};

export default function Editor({ openSubmit = false, phone = false }: { openSubmit?: boolean; phone?: boolean }) {
  const ws = useWorkspace("applicant");
  const { appId = "" } = useParams();
  const query = useApplicantQuery((api) => loadEditor(api, appId), [appId, ws.id]);
  if (query.status === "error" && isNotFound(query.error)) return <NotFound />;
  const body = (
    <main className="main" style={phone ? { flex: 1 } : { gap: "16px" }}>
      <Loaded query={query} label="Opening the application">
        {(data) =>
          data.app.status === "draft" || data.app.status === "revision_requested" ? (
            // A fresh read from the server remounts the body, so its state starts from that read.
            <EditorBody key={keyOf(data)} data={data} openSubmit={openSubmit} phone={phone} />
          ) : (
            <Notice tone="info" title="This application has been submitted and can no longer be edited">
              <Link to={`/w/${ws.handle}/applications/${data.app.id}`}>See where it stands</Link>
            </Notice>
          )
        }
      </Loaded>
    </main>
  );
  return (
    <>
      <title>{query.status === "ready" ? `${query.data.app.title} — ${ws.name}` : `Application — ${ws.name}`}</title>
      {phone ? (
        <PhoneShell title="Application" active="Applications">
          {body}
        </PhoneShell>
      ) : (
        <ApplicantShell active="Applications">{body}</ApplicantShell>
      )}
    </>
  );
}
