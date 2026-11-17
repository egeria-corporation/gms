// SPDX-License-Identifier: AGPL-3.0-only
// Application editor. The current stage's forms are edited with the form renderer and saved
// field by field (only changed paths are sent; the server merges), so teammates and a scoped
// consultant can work at once. Passport-owned fields are read-only here. The submit dialog runs
// the readiness checklist and submits; a 422 comes back as the list of fields to fix.
// Live co-editing (lib/presence.ts, docs/co-editing.md): who else is in the draft and where, a soft
// lock on the question someone is typing in, and their saves read again within seconds without
// touching what this person is typing.
import { DriveAttachButton } from "../../components/DriveAttach.tsx";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { BookOpen, Check, CircleCheck, CircleDashed, CircleX, Clock, FileText, Lock, MessageSquare, ShieldCheck, ShieldOff, TriangleExclamationPoint, Upload, X } from "lucide-react";
import { collectControls, passportFieldPaths, type FormDefinition, type Json, type JsonObject } from "@gms/forms";
import type { Answer, AppDocument, AppForm, ApplicantApi, ApplicantMember, ApplicantReadiness, Application, Comment, MyApplication, MyOrganization } from "../../api/applicant.ts";
import { changedPaths } from "../../api/applicant.ts";
import { useApplicantApi, useApplicantQuery } from "../../api/applicantHooks.ts";
import { useMoreApi } from "../../api/applicantMoreHooks.ts";
import { ApiError } from "../../api/client.ts";
import type { Checklist } from "../../api/types.ts";
import { useServices } from "../../app/services.tsx";
import { useWorkspace } from "../../app/workspace.tsx";
import { accentOf, Avatar, closesPhrase, FunderChip, isNotFound, Loaded, timeAgo } from "../../components/applicant.tsx";
import { useDraftPresence, type Peer, type SavedMessage } from "../../lib/presence.ts";
import { Dialog } from "../../components/Dialog.tsx";
import { NotFound } from "../../components/NotFound.tsx";
import { PhoneShell, usePhoneSheetSlot } from "../../components/PhoneShell.tsx";
import { ApplicantShell } from "../../components/shells.tsx";
import { LevelBadge, SelfReportedTag, StatusBadge } from "../../components/status.tsx";
import { ErrorBanner, errorMessage, Notice, ReadinessChecklist, TabPanel, Tabs } from "../../components/ui.tsx";
import { FormView, type UploadedFile } from "../../forms/FormView.tsx";
import { conflictsOf, fieldLabel, fieldLabelShown, formTitleShown, keepOthersChanges, patchFor, questionOf, rebase, sectionFor, sectionsOf, sectionState, withLocks, type RecentChange, type Section } from "./editorSync.ts";
import { ChangedNote, EditingChips, fieldsOf, LockNote, PausedNote, PresenceAvatars, questionAt, useFieldSlots, versionText } from "./editorPresence.tsx";
import type { ShownText } from "@gms/forms";
import { getLocale } from "../../i18n/index.tsx";
import { EditorAssistant } from "./editorAssist.tsx";
import type { DraftInvitation } from "../../api/invites.ts";
import { InviteDialog, InviteOptions, InvitePicker, InviteSentNote, TeamNote, useDraftInvites } from "./inviteDraft.tsx";
import { validationMessage } from "../../forms/FormView.tsx";
import { t, useApplicantText } from "./i18n.ts";
import { YourProfilePanel } from "./YourProfilePanel.tsx";
import { explainResult } from "../../lib/eligibilityText.ts";

interface EditorData {
  app: Application;
  summary: MyApplication | undefined;
  defs: Record<string, FormDefinition>;
  comments: Comment[];
  attachments: AppDocument[];
  members: ApplicantMember[];
  sections: Record<string, Record<string, string>>;
  answers: Answer[];
  /** Null for a consultant, who does not read the organization's record. */
  readiness: ApplicantReadiness | null;
  org: MyOrganization | null;
}

async function loadEditor(api: ApplicantApi, id: string): Promise<EditorData> {
  const [app, list, comments, attachments, members, answers, readiness, org] = await Promise.all([
    api.application(id),
    api.applications(),
    api.comments(id),
    api.attachments(id),
    // A consultant invited into this draft reads neither the team list nor the organization's
    // record; the editor still opens for them.
    api.members().catch(() => [] as ApplicantMember[]),
    api.answers().catch(() => [] as Answer[]),
    api.readiness().catch(() => null),
    api.organization().catch(() => null),
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

/** A funder's text, marked with its language when the page reads in another one (WCAG 3.1.2), as FormView marks it. */
function InLang({ s }: { s: ShownText }) {
  return s.lang === getLocale() ? <>{s.text}</> : <span lang={s.lang}>{s.text}</span>;
}

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
  const { sessionState, mock } = useServices();
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
  const saving = useRef<Promise<void>>(Promise.resolve());

  const myUserId = sessionState.status === "signedIn" ? sessionState.session.userId : "me";
  const me = useMemo(() => ({ userId: myUserId, name: data.members.find((m) => m.userId === myUserId)?.name ?? ws.member.name }), [myUserId, data.members, ws.member.name]);
  // Live co-editing: the question this person is in, what someone else's save just changed (per
  // form), and the questions where both had changes ("{name} changed this").
  const typingIn = useRef<string | null>(null);
  const recent = useRef<Record<string, RecentChange>>({});
  const [conflicts, setConflicts] = useState<Record<string, Record<string, { by: string; theirs: Json | undefined }>>>({});

  /**
   * Takes a newer server state of a form and keeps whatever this person typed since `sent`. `by`
   * names someone else whose save it is: what they changed is remembered for a moment, and a
   * question this person had changed too gets a "{name} changed this" note.
   */
  const adopt = useCallback((next: AppForm, sent: JsonObject, by?: string) => {
    const before = local.current[next.formId] ?? sent;
    const shown = rebase(next.response, sent, before);
    if (by !== undefined) {
      const theirs = Object.keys(changedPaths(baseline.current[next.formId] ?? {}, next.response) ?? {});
      recent.current[next.formId] = { at: Date.now(), before: new Map(theirs.map((k) => [`/${k}`, before[k]] as const)) };
      const clash = conflictsOf(baseline.current[next.formId] ?? {}, next.response, before);
      if (clash.length) setConflicts((prev) => ({ ...prev, [next.formId]: { ...prev[next.formId], ...Object.fromEntries(clash.map((q) => [q, { by, theirs: next.response[q.slice(1)] }])) } }));
    }
    baseline.current[next.formId] = next.response;
    local.current[next.formId] = shown;
    setForms((prev) => ({ ...prev, [next.formId]: { ...next, response: shown } }));
  }, []);

  // An API call for this draft refused (403/404): the editor leaves the live channel at once.
  const leftOnRefusal = useRef<(error: unknown) => void>(() => undefined);
  // Someone else saved: read the form again through the API, after any save of this person's in flight.
  const onPeerSaved = useCallback(
    (m: SavedMessage, by: Peer | undefined) => {
      if (!app.forms.some((f) => f.formId === m.target)) return;
      const name = by?.name ?? data.members.find((x) => x.userId === m.by)?.name ?? t("presence.aTeammate");
      saving.current = saving.current.then(async () => {
        const sent = baseline.current[m.target] ?? {};
        const fresh = await api.application(app.id).catch((error: unknown) => (leftOnRefusal.current(error), null));
        const f = fresh?.forms.find((x) => x.formId === m.target);
        if (f) adopt(f, sent, name);
      });
    },
    [api, app.id, app.forms, adopt, data.members],
  );
  const live = useDraftPresence({ workspaceId: ws.id, draft: { kind: "application", id: app.id }, me, onSaved: onPeerSaved });
  leftOnRefusal.current = live.apiFailed;

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
          live.saved(formId, Object.keys(patch).map((k) => `/${k}`));
        } catch (error) {
          live.apiFailed(error);
          setSave({ state: "error", error });
        }
      });
      return saving.current;
    },
    [api, app.id, adopt, live.saved, live.apiFailed],
  );

  const active = forms[activeFormId];
  const def = defs[activeFormId];
  const sections: Section[] = useMemo(() => (def ? sectionsOf(def) : []), [def]);
  // The form's questions, and what live co-editing shows on them: someone else's soft lock (never
  // on the question this person is in), who is in which question, and "{name} changed this".
  const questions = useMemo(() => (def ? [...new Set(collectControls(def.uiSchema).map((c) => questionOf(c.path)))] : []), [def]);
  const lockedHere = [...new Set(live.peers.flatMap((p) => (p.lock && p.lock !== typingIn.current && questions.includes(p.lock) ? [p.lock] : [])))];
  const lockKey = lockedHere.sort().join("\n");
  const shownDef = useMemo(() => (def ? withLocks(def, lockKey ? lockKey.split("\n") : []) : def), [def, lockKey]);
  const formConflicts = conflicts[activeFormId] ?? {};
  const noted = [...new Set([...live.peers.flatMap((p) => [p.field, p.lock].filter((q): q is string => !!q)), ...Object.keys(formConflicts)])].filter((q) => questions.includes(q));
  const errors = active?.validationErrors ?? [];
  const formOwners = owners[activeFormId] ?? {};
  const memberName = (userId: string | undefined) => {
    const m = data.members.find((x) => x.userId === userId);
    return m ? (m.name ?? m.email ?? t("editor.teammate")) : null;
  };
  const openComments = comments.filter((c) => !c.resolvedAt);
  const goTo = (label: string) => document.getElementById(slug(label))?.scrollIntoView({ behavior: "smooth", block: "start" });

  // Inviting someone into this draft (admins), and the one-time note after the first application.
  const consultant = ws.member.role === "consultant";
  const invites = useDraftInvites("application", app.id, !consultant);
  const inviteList = invites.status === "ready" ? invites.data : null;
  const [inviting, setInviting] = useState<{ section: string | null } | null>(null);
  const [invited, setInvited] = useState<DraftInvitation | null>(null);
  // Arriving from an accepted invitation (`?section=`): go to that section.
  const [params] = useSearchParams();
  const landSection = params.get("section");
  useEffect(() => {
    if (landSection) requestAnimationFrame(() => document.getElementById(slug(landSection))?.scrollIntoView?.({ block: "start" }));
  }, [landSection]);

  // FormView draws one card per group; give each an anchor the rail and the Fix links can reach.
  const formRef = useRef<HTMLDivElement>(null);
  const slots = useFieldSlots(formRef, noted, questions);
  // The question an event came from; the presence notes drawn inside a field are not the question.
  const questionFrom = (el: EventTarget | null): string | null => (formRef.current && el instanceof Element && !el.closest("[data-co-slot]") ? questionAt(el, fieldsOf(formRef.current, questions)) : null);
  useEffect(() => {
    for (const s of sections) {
      // FormView names each card with the title the reader sees (their language where translated).
      const el = [...(formRef.current?.querySelectorAll<HTMLElement>("section[aria-label]") ?? [])].find((n) => n.getAttribute("aria-label") === s.shown.text);
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
      live.saved(activeFormId, [`/${field}`]);
    } catch (error) {
      live.apiFailed(error);
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
        label: t("editor.check.sections"),
        reason: stageErrors.length === 0 ? t("editor.check.sectionsDone", { done: sections.length, total: sections.length }) : t("editor.check.answersToFix", { count: stageErrors.length }),
        fixHref: null,
      },
      {
        key: "eligibility",
        state: !eligibility || eligibility.eligible === "unknown" ? "unknown" : eligibility.eligible ? "pass" : "fail",
        label: t("editor.eligibilityPreview"),
        reason: !eligibility
          ? t("editor.check.notEvaluated")
          : eligibility.eligible === true
            ? t("editor.check.rulesPass", { passed: eligibility.results.length, total: eligibility.results.length })
            : eligibility.eligible === false
              ? (eligibility.results.find((r) => r.outcome === "fail")?.label ?? t("editor.check.ruleFails"))
              : t("editor.check.rulesUnknown", { count: unknown }),
        fixHref: eligibility?.eligible === false ? `${base}/organization` : null,
      },
      {
        key: "passport",
        // Passport is optional: without it the organization goes in as not verified, which is no obstacle.
        state: data.readiness?.linked ? "pass" : "unknown",
        label: data.readiness?.linked ? t("editor.check.passportConnected") : t("editor.check.passportNotConnected"),
        reason: data.readiness?.linked
          ? data.readiness?.level
            ? t("editor.check.levelAttached", { level: data.readiness.level })
            : t("editor.check.levelUnknownAttached")
          : t("editor.check.notVerified"),
        fixHref: data.readiness?.linked ? null : "/onboarding/applicant",
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
      live.apiFailed(error);
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
      <Notice tone="info" title={t("editor.nothingToEditAtThisStage")}>
        {t("editor.noOpenForm")} <Link to={`${base}/applications/${app.id}`}>{t("editor.seeItsStatus")}</Link>
      </Notice>
    );
  }

  // Library answers go into free-text fields only: never into a value that comes from Passport.
  const fromPassport = passportFieldPaths(def);
  const textFields = Object.entries(def.jsonSchema.properties ?? {}).filter(([k, s]) => s.type === "string" && !s.enum && !s.format && !rejected.includes(`/${k}`) && !fromPassport.includes(`/${k}`));

  return (
    <>
      <div className="crumbs">
        <Link to={base}>{t("editor.dashboard")}</Link>
        <span>›</span>
        <Link to={`${base}/applications`}>{t("editor.applications")}</Link>
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
            <StatusBadge kind="application" status={app.status} label={`${summary?.stage.label ?? app.stage} · ${app.status === "draft" ? t("editor.draft") : t("editor.revisionRequested")}`} />
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
            {save.state === "saving" && t("editor.saving")}
            {save.state === "saved" && (
              <>
                <Check className="ic" aria-hidden="true" />
                {save.at ? t("editor.savedAgo", { ago: timeAgo(save.at) }) : t("editor.saved")}
              </>
            )}
            {save.state === "idle" && (
              <>
                <Check className="ic" aria-hidden="true" />
                {t("editor.allChangesSaved")}
              </>
            )}
            {save.state === "error" && (
              <span className="err-msg">
                <TriangleExclamationPoint className="ic ic-sm" aria-hidden="true" />
                {t("editor.notSaved", { error: errorMessage(save.error) })}
              </span>
            )}
          </span>
          <PresenceAvatars me={me.name} peers={live.peers} />
          <PausedNote status={live.status} />
          {/* The template preview is a design reference with sample content: demo mode only. */}
          {mock && (
            <Link to="/preview/pdf/application-snapshot" className="btn btn-secondary">
              {t("editor.preview")}
            </Link>
          )}
          <button className="btn btn-primary" type="button" aria-haspopup="dialog" onClick={() => setSubmitOpen(true)}>
            {t("editor.submit")}
          </button>
        </div>
      </div>

      {app.status === "revision_requested" && (
        <Notice tone="warn" title={t("editor.theFunderAskedForARevision")}>
          {t("editor.makeTheChanges")} <Link to={`${base}/applications/${app.id}`}>{t("editor.readTheRequest")}</Link>
        </Notice>
      )}

      {phone && (
        <nav className="pillrow" aria-label={t("editor.sections")} style={{ display: "flex", gap: "8px", overflowX: "auto", padding: "4px 0", scrollbarWidth: "none" }}>
          {sections.map((sec) => {
            const st = sectionState(sec, active.response, errors);
            const Icon = SEC_ICON[st.state];
            return (
              <a key={sec.label} href={`#${slug(sec.label)}`} className="fchip" style={{ height: "36px", flex: "none", textDecoration: "none", ...(st.state === "done" ? { color: "var(--s-ok-fg)" } : {}) }}>
                <Icon className="ic ic-sm" aria-hidden="true" />
                <InLang s={sec.shown} />
              </a>
            );
          })}
        </nav>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "248px minmax(0, 1fr) 320px", gap: "20px", alignItems: "start" }}>
        <aside className="card" style={{ padding: "12px", ...(phone ? { display: "none" } : {}) }}>
          <div className="eyebrow" style={{ padding: "4px 10px 10px" }}>
            {t("editor.sectionsComplete", { done: sections.filter((s) => sectionState(s, active.response, errors).state === "done").length, total: sections.length })}
          </div>
          {editableForms.length > 1 && (
            <div className="seg" role="group" aria-label={t("editor.form")} style={{ margin: "0 6px 10px" }}>
              {editableForms.map((f) => (
                <button key={f.formId} type="button" className={f.formId === activeFormId ? "on" : ""} aria-pressed={f.formId === activeFormId} onClick={() => setActiveFormId(f.formId)}>
                  {defs[f.formId] ? <InLang s={formTitleShown(defs[f.formId]!)} /> : t("editor.form")}
                </button>
              ))}
            </div>
          )}
          <nav className="sec" aria-label={t("editor.applicationSections")}>
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
                    live.focus({ section: s.label });
                  }}
                >
                  <Icon className="ic" aria-hidden="true" />
                  <div>
                    <div className="nm">
                      <InLang s={s.shown} />
                    </div>
                    <div className="st">{st.state === "done" ? t("editor.complete") : st.state === "prog" ? t("editor.inProgressToFix", { count: st.problems.length }) : t("editor.notStarted")}</div>
                    {live.inSection(s.label).length > 0 && (
                      <div style={{ marginTop: "4px" }}>
                        <EditingChips peers={live.inSection(s.label)} />
                      </div>
                    )}
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
                  <div className="nm">{t("editor.formResponses", { form: defs[f.formId] ? formTitleShown(defs[f.formId]!).text : t("editor.earlierStage") })}</div>
                  <div className="st">{t("editor.lockedPriorStageReadOnly")}</div>
                </div>
                <span className="meta"></span>
              </a>
            ))}
          </nav>
          <div className="small muted" style={{ padding: "10px 10px 4px" }}>
            {summary?.funder.name ? t("editor.formPinnedBy", { version: String(active.version), funder: summary.funder.name }) : t("editor.formPinned", { version: String(active.version) })}
          </div>
        </aside>

        <div style={{ display: "flex", flexDirection: "column", gap: "16px", minWidth: 0 }}>
          {!consultant && <TeamNote canInvite={!!inviteList?.canInvite} onInvite={() => setInviting({ section: null })} />}
          {invited && <InviteSentNote sent={invited} onDone={() => setInvited(null)} />}
          {rejected.length > 0 && (
            <Notice tone="info" title={data.readiness?.linked ? t("editor.someFieldsFollowYourPassportRecord") : t("editor.someFieldsFollowYourOrganizationDetails")}>
              {data.readiness?.linked ? t("editor.onlyInPassport", { fields: rejected.map((p) => fieldLabel(def, p)).join(", ") }) : t("editor.onlyInSettings", { fields: rejected.map((p) => fieldLabel(def, p)).join(", ") })}{" "}
              {data.readiness?.linked ? data.org?.editUrl && <a href={data.org?.editUrl}>{t("editor.editInPassport")}</a> : <Link to={`${base}/settings#organization-details`}>{t("editor.openSettings")}</Link>}
            </Notice>
          )}
          <div className="row" style={{ gap: "10px", flexWrap: "wrap" }}>
            <button className="btn btn-sm btn-secondary" type="button" aria-haspopup="dialog" onClick={() => setLibraryOpen(true)} disabled={!data.answers.length || !textFields.length}>
              <BookOpen className="ic" aria-hidden="true" />
              {t("editor.insertFromAnswerLibrary")}
            </button>
            {!showAll && errors.length > 0 && (
              <button className="btn btn-sm btn-ghost" type="button" onClick={() => setShowAll(true)}>
                {t("editor.showEverythingLeftToFix")}
              </button>
            )}
          </div>
          <div
            ref={formRef}
            onFocus={(e) => {
              const q = questionFrom(e.target);
              if (!q) return;
              typingIn.current = q;
              live.focus({ section: sectionFor(sections, q)?.label, field: q });
            }}
            onBlur={(e) => {
              const q = questionFrom(e.target);
              if (!q || questionFrom(e.relatedTarget) === q) return;
              live.blur(q);
              if (typingIn.current === q) typingIn.current = null;
              if (!questionFrom(e.relatedTarget)) live.focus({ section: sectionFor(sections, q)?.label });
            }}
            onInput={(e) => {
              const q = questionFrom(e.target);
              if (q) live.input(q);
            }}
          >
            <FormView
              form={shownDef ?? def}
              response={active.response}
              mode="edit"
              provenance={active.provenance}
              showAllErrors={showAll}
              onChange={(r) => {
                // A copy of the form from before someone else's save never takes their answer back.
                const kept = keepOthersChanges(local.current[activeFormId] ?? r, r, recent.current[activeFormId], typingIn.current, Date.now());
                local.current[activeFormId] = kept;
                if (kept !== r) setForms((prev) => ({ ...prev, [activeFormId]: { ...prev[activeFormId]!, response: kept } }));
              }}
              onAutosave={() => void push(activeFormId)}
              uploadFile={uploadFile}
              {...(data.org?.editUrl ? { passportUrl: data.org?.editUrl } : {})}
              profileUrl={`${base}/settings#organization-details`}
              passportLinked={data.readiness?.linked}
            />
            {[...slots].map(([q, slot]) => {
              const holder = live.lockOf(q);
              const clash = formConflicts[q];
              const here = live.inField(q).filter((p) => p !== holder);
              return createPortal(
                <>
                  {holder && q !== typingIn.current ? <LockNote peer={holder} /> : null}
                  <EditingChips peers={here} />
                  {clash ? (
                    <ChangedNote
                      name={clash.by}
                      theirs={versionText(clash.theirs)}
                      onKeep={() => setConflicts((prev) => ({ ...prev, [activeFormId]: Object.fromEntries(Object.entries(prev[activeFormId] ?? {}).filter(([k]) => k !== q)) }))}
                      onUseTheirs={() => {
                        const next = { ...(local.current[activeFormId] ?? active.response) };
                        if (clash.theirs === undefined) delete next[q.slice(1)];
                        else next[q.slice(1)] = clash.theirs;
                        local.current[activeFormId] = next;
                        setForms((prev) => ({ ...prev, [activeFormId]: { ...prev[activeFormId]!, response: next } }));
                        setConflicts((prev) => ({ ...prev, [activeFormId]: Object.fromEntries(Object.entries(prev[activeFormId] ?? {}).filter(([k]) => k !== q)) }));
                      }}
                    />
                  ) : null}
                </>,
                slot,
                `co-${q}`,
              );
            })}
          </div>

          <section className="card" aria-labelledby="att-h">
            <div className="card-h">
              <div>
                <h3 id="att-h">{t("editor.attachments")}</h3>
                <p className="small muted">{t("editor.filesUploadedHereStayWithThis")}</p>
              </div>
              <span className="bdg bdg-neutral">
                <FileText className="ic" aria-hidden="true" />
                {t("editor.fileCount", { count: attachments.length })}
              </span>
            </div>
            <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              {attachments.map((d) => (
                <div className="doc" key={d.id}>
                  <span className={`ft${fileKind(d.name) ? ` ft-${fileKind(d.name)}` : ""}`}>{fileKind(d.name) ? fileKind(d.name).toUpperCase() : t("form.file")}</span>
                  <div className="grow">
                    <div className="nm">{d.name}</div>
                    <div className="mt">
                      <span>{kb(d.size)}</span>
                      <span>·</span>
                      {d.source === "passport_locker" ? <span className="prov prov-passport">{t("editor.passportLocker")}</span> : <span>{t("editor.uploadedAgo", { ago: timeAgo(d.uploadedAt) })}</span>}
                      <span>·</span>
                      <samp className="mono">
                        sha256 {d.sha256.slice(0, 4)}…{d.sha256.slice(-4)}
                      </samp>
                      {d.scanStatus === "not_scanned" && <span>· {t("editor.notScanned")}</span>}
                    </div>
                  </div>
                </div>
              ))}
              <label className="btn btn-secondary" style={{ alignSelf: "flex-start" }}>
                <Upload className="ic" aria-hidden="true" />
                {t("editor.uploadAFile")}
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
              <DriveAttachButton onFile={(file) => uploadFile(file)} />
            </div>
          </section>

          {lockedForms.map((f) => {
            const d = defs[f.formId];
            return d ? (
              <section className="card" key={f.formId} id={`locked-${f.formId}`} aria-label={t("editor.formResponses", { form: formTitleShown(d).text })}>
                <div className="card-h">
                  <div>
                    <h3>{t("editor.formResponses", { form: formTitleShown(d).text })}</h3>
                    <p className="small muted">{t("editor.priorStageResponsesAreReadOnly")}</p>
                  </div>
                  <span className="bdg bdg-neutral">
                    <Lock className="ic" aria-hidden="true" />
                    {t("editor.locked")}
                  </span>
                </div>
                <details className="card-b">
                  <summary className="b" style={{ cursor: "pointer" }}>
                    {t("editor.showWhatWasSubmitted")}
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
          {...(phone ? { className: "sheet", "aria-label": t("editor.validationAndComments") } : {})}
          style={{ display: "flex", flexDirection: "column", gap: phone ? "0" : "16px", minWidth: 0, ...(phone ? { flex: "none", maxHeight: "60vh", overflowY: sheetOpen ? "auto" : "hidden" } : {}) }}
        >
          {phone && (
            <>
              <div className="grab" aria-hidden="true"></div>
              <button type="button" className="row" aria-expanded={sheetOpen} aria-controls="ed-sheet" style={{ width: "100%", minHeight: "44px", padding: "0 16px", border: 0, background: "transparent", font: "inherit", fontWeight: 700, color: "var(--og-navy-dark)", justifyContent: "space-between", cursor: "pointer" }} onClick={() => setSheetOpen(!sheetOpen)}>
                <span>
                  {stageErrors.length ? t("editor.sheetToFix", { count: stageErrors.length, comments: openComments.length }) : t("editor.sheetNothingToFix", { comments: openComments.length })}
                </span>
                <span className="small muted">{sheetOpen ? t("editor.hide") : t("editor.show")}</span>
              </button>
            </>
          )}
          <div id="ed-sheet" className="card" style={phone ? { border: 0, borderRadius: 0, display: sheetOpen ? undefined : "none" } : undefined}>
            <div style={{ padding: "0 12px" }}>
              <Tabs<PanelTab>
                label={t("editor.applicationPanel")}
                idPrefix="ed"
                active={tab}
                onChange={setTab}
                tabs={[
                  { key: "validation", label: t("editor.tab.validation"), count: errors.length },
                  { key: "comments", label: t("editor.tab.comments"), count: openComments.length },
                  { key: "assignments", label: t("editor.tab.assignments") },
                ]}
              />
            </div>
            <div className="card-b" style={{ padding: "16px" }}>
              <TabPanel idPrefix="ed" tab="validation" active={tab}>
                {errors.length === 0 ? (
                  <div className="row" style={{ gap: "8px", color: "var(--s-ok-fg)", fontWeight: 700 }}>
                    <CircleCheck className="ic" aria-hidden="true" />
                    {t("editor.nothingLeftToFixInThis")}
                  </div>
                ) : (
                  <>
                    <div className="eyebrow" style={{ marginBottom: "6px" }}>
                      {t("editor.toFixCount", { count: errors.length })}
                    </div>
                    <ul className="rc">
                      {errors.map((e, i) => {
                        const s = sectionFor(sections, e.field);
                        return (
                          <li key={`${e.field}-${i}`} className="rc-row rc-fail" style={i === 0 ? { borderTop: 0 } : undefined}>
                            <CircleX className="ic" role="img" aria-label={t("editor.needsAttention")} />
                            <div>
                              <div className="l">
                                <InLang s={fieldLabelShown(def, e.field)} />
                              </div>
                              <div className="r">{validationMessage(e)}</div>
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
                                {t("editor.fix")}
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
                  {t("editor.eligibilityPreview")}
                </div>
                {eligibility ? (
                  <ul style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "14px" }}>
                    {eligibility.results.map((r, i) => {
                      const Icon = r.outcome === "pass" ? CircleCheck : r.outcome === "fail" ? CircleX : CircleDashed;
                      const color = r.outcome === "pass" ? "var(--s-ok-fg)" : r.outcome === "fail" ? "var(--s-dng-fg)" : "var(--og-gray-600)";
                      return (
                        <li key={i} className="row" style={{ gap: "6px", color, alignItems: "flex-start" }} title={explainResult(r)}>
                          <Icon className="ic" role="img" aria-label={r.outcome === "pass" ? t("editor.passes") : r.outcome === "fail" ? t("editor.doesNotPass") : t("editor.couldNotBeChecked")} style={{ marginTop: "3px" }} />
                          {r.label} <SelfReportedTag result={r} />
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="small muted">{t("editor.eligibilityIsEvaluatedWhenYouSubmit")}</p>
                )}
                {data.readiness?.linked && (
                  <div className="bnr bnr-info" style={{ marginTop: "12px" }}>
                    <ShieldCheck className="ic" aria-hidden="true" />
                    <div>
                      <div className="t" style={{ fontSize: "14px" }}>
                        {t("editor.levelWillBeAttached", { level: data.readiness?.level ?? "—" })}
                      </div>
                      <div className="d" style={{ fontSize: "13px" }}>
                        {t("editor.yourAttestationAndPayeeStatusTravel")}
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
                  {t("editor.whoOwnsEachSectionAConsultant")}
                </p>
                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  {sections.map((s) => (
                    <div className="fld" key={s.label}>
                      <label className="lbl" htmlFor={`own-${slug(s.label)}`} style={{ fontSize: "13px" }}>
                        {s.label}
                      </label>
                      <InvitePicker
                        className="sel"
                        id={`own-${slug(s.label)}`}
                        style={{ height: "36px", fontSize: "14px" }}
                        value={formOwners[s.label] ?? ""}
                        disabled={consultant}
                        onInvite={() => setInviting({ section: s.label })}
                        onChoose={async (value) => {
                          const r = await api.assignSections(app.id, `frm_${activeFormId}`, { [s.label]: value || null });
                          setOwners((prev) => ({ ...prev, [activeFormId]: r.sections }));
                        }}
                      >
                        <option value="">{t("editor.unassigned")}</option>
                        {data.members.map((m) => (
                          <option key={m.userId} value={m.userId}>
                            {m.name ?? m.email ?? m.userId}
                            {m.role === "consultant" ? ` ${t("editor.consultantNote")}` : ""}
                          </option>
                        ))}
                        <InviteOptions list={inviteList} match={(d) => d.section === s.label && (d.formId ?? "").replace(/^frm_/, "") === activeFormId} />
                      </InvitePicker>
                    </div>
                  ))}
                </div>
              </TabPanel>
            </div>
          </div>
          {!phone ? <EditorAssistant answers={data.answers} fields={textFields.map(([k]) => ({ key: k, label: fieldLabel(def, `/${k}`) }))} /> : null}
        </aside>,
        )}
      </div>

      {inviting && (
        <InviteDialog
          draft={{ kind: "application", id: app.id, ...(inviting.section ? { formId: `frm_${activeFormId}`, section: inviting.section } : {}) }}
          title={app.title}
          part={inviting.section}
          remainingToday={inviteList?.remainingToday ?? null}
          onClose={() => setInviting(null)}
          onSent={(r) => {
            setInviting(null);
            setInvited(r);
            invites.reload();
          }}
        />
      )}

      <Dialog open={submitOpen} onClose={() => setSubmitOpen(false)} labelledBy="submit-title" size="lg">
        <div className="hd">
          <div>
            <h2 id="submit-title" style={{ fontSize: "20px" }}>
              {t("editor.readyToSubmit")}
            </h2>
            <p className="small muted" style={{ marginTop: "4px" }}>
              {[summary?.funder.name, summary?.opportunity.title, summary?.stage.label].filter(Boolean).join(" · ")}
            </p>
          </div>
          <button className="iconbtn" type="button" aria-label={t("editor.close")} onClick={() => setSubmitOpen(false)}>
            <X className="ic ic-md" aria-hidden="true" />
          </button>
        </div>
        <div className="bd" style={{ gap: "10px" }}>
          <ReadinessChecklist checklist={checklist} />
          {submit.error && submitProblems.length === 0 ? <ErrorBanner error={submit.error} title={t("editor.theApplicationWasNotSubmitted")} /> : null}
          {submitProblems.length > 0 && (
            <div className="bnr bnr-dng" role="alert">
              <CircleX className="ic" aria-hidden="true" />
              <div>
                <div className="t">{t("editor.serverFound", { count: submitProblems.length })}</div>
                <ul className="d">
                  {submitProblems.slice(0, 6).map((p, i) => (
                    <li key={i}>
                      <InLang s={fieldLabelShown(def, (p.field ?? "").replace(/^[0-9a-f-]{36}/, ""))} />: {p.detail}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
          {data.readiness?.linked ? (
            <div className="bnr bnr-info">
              <ShieldCheck className="ic" aria-hidden="true" />
              <div>
                <div className="t">
                  {t.rich("editor.levelBadgeAttached", { badge: <LevelBadge level={data.readiness?.level} /> })}
                </div>
                <div className="d">{summary?.funder.name ? t("editor.receivesSnapshotPassport", { funder: summary.funder.name }) : t("editor.receivesSnapshotPassportTheFunder")}</div>
              </div>
            </div>
          ) : (
            <div className="bnr bnr-neu">
              <ShieldOff className="ic" aria-hidden="true" />
              <div>
                <div className="t">{t("editor.yourOrganizationIsNotVerifiedWith")}</div>
                <div className="d">{summary?.funder.name ? t("editor.receivesSnapshotSelf", { funder: summary.funder.name }) : t("editor.receivesSnapshotSelfTheFunder")}</div>
              </div>
            </div>
          )}
          <p className="small muted">
            {summary?.stage.closes ? `${t("editor.canWithdraw")} ` : ""}
            {data.readiness?.linked ? t("editor.submittingGivesThisFunderPermissionTo") : t("editor.submittingGivesThisFunderPermissionTo2")}
          </p>
        </div>
        <div className="ft">
          <button className="btn btn-secondary" type="button" onClick={() => setSubmitOpen(false)}>
            {t("editor.cancel")}
          </button>
          <button className="btn btn-primary btn-lg" type="button" onClick={onSubmit} disabled={!checklist.ready || submit.state === "sending"} aria-describedby={checklist.ready ? undefined : "submit-why"}>
            {submit.state === "sending" ? t("editor.submitting") : t("editor.submitApplication")}
          </button>
          {!checklist.ready && (
            <span id="submit-why" className="sr">
              {t("editor.fixTheFailingChecksBeforeSubmitting")}
            </span>
          )}
        </div>
      </Dialog>

      <Dialog open={libraryOpen} onClose={() => setLibraryOpen(false)} labelledBy="lib-title">
        <InsertAnswer answers={data.answers} fields={textFields.map(([k]) => ({ key: k, label: fieldLabel(def, `/${k}`) }))} onInsert={insertAnswer} onClose={() => setLibraryOpen(false)} />
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
      {comments.length === 0 && <p className="small muted">{t("editor.noCommentsYetCommentsAreFor")}</p>}
      {comments.map((c) => (
        <div key={c.id} className={c.resolvedAt ? "cmt cmt-res" : "cmt"}>
          <div className="hd">
            <Avatar name={c.author} size="sm" />
            <span className="who">{c.author}</span>
            <span>· {timeAgo(c.createdAt)}</span>
            <span className="int-mark">{t("editor.team")}</span>
          </div>
          {c.fieldPath && <div className="fld-ref">{t("editor.onField", { field: fieldLabel(def, c.fieldPath) })}</div>}
          <div className="bd">{c.body}</div>
          {c.resolvedAt ? (
            <span className="small muted">{t("editor.resolvedAgo", { ago: timeAgo(c.resolvedAt) })}</span>
          ) : (
            <button className="btn btn-sm btn-ghost" type="button" style={{ alignSelf: "flex-start" }} onClick={() => void onResolve(c.id)}>
              {t("editor.resolve")}
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
          {t("editor.fieldThisCommentIsAbout")}
        </label>
        <select className="sel" id="cmt-field" style={{ height: "36px", fontSize: "14px" }} value={field} onChange={(e) => setField(e.target.value)}>
          <option value="">{t("editor.wholeApplication")}</option>
          {fields.map(([k]) => {
            const label = fieldLabelShown(def, `/${k}`);
            return (
              <option key={k} value={`/${k}`} lang={label.lang !== getLocale() ? label.lang : undefined}>
                {label.text}
              </option>
            );
          })}
        </select>
        <label className="sr" htmlFor="cmt-body">
          {t("editor.writeACommentForYourTeam")}
        </label>
        <textarea className="ta" id="cmt-body" style={{ minHeight: "60px" }} placeholder={t("editor.writeACommentForYourTeam")} value={body} onChange={(e) => setBody(e.target.value)} />
        <button className="btn btn-secondary" type="submit" disabled={busy || !body.trim()} style={{ alignSelf: "flex-start" }}>
          {t("editor.comment")}
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
            {t("editor.insertFromAnswerLibrary")}
          </h3>
          <p className="small muted">{t("editor.theTextReplacesWhatIsIn")}</p>
        </div>
        <button className="iconbtn" type="button" aria-label={t("editor.close")} onClick={onClose}>
          <X className="ic ic-md" aria-hidden="true" />
        </button>
      </div>
      <div className="bd">
        <div className="fld">
          <label className="lbl" htmlFor="lib-answer">
            {t("editor.answer")}
          </label>
          <select className="sel" id="lib-answer" value={answerId} onChange={(e) => setAnswerId(e.target.value)}>
            {answers.map((a) => (
              <option key={a.id} value={a.id}>
                {a.title} · {t("editor.version", { version: String(a.version) })} · {t("editor.wordsCount", { count: a.words })}
              </option>
            ))}
          </select>
        </div>
        <div className="fld">
          <label className="lbl" htmlFor="lib-field">
            {t("editor.insertInto")}
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
          {t("editor.cancel")}
        </button>
        <button className="btn btn-primary" type="button" disabled={!answer || !field} onClick={() => answer && void onInsert(answer, field)}>
          {t("editor.insert")}
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
  useApplicantText();
  const ws = useWorkspace("applicant");
  const { appId = "" } = useParams();
  const query = useApplicantQuery((api) => loadEditor(api, appId), [appId, ws.id]);
  if (query.status === "error" && isNotFound(query.error)) return <NotFound />;
  const body = (
    <main className="main" style={phone ? { flex: 1 } : { gap: "16px" }}>
      <YourProfilePanel compact />
      <Loaded query={query} label={t("editor.openingTheApplication")}>
        {(data) =>
          data.app.status === "draft" || data.app.status === "revision_requested" ? (
            // A fresh read from the server remounts the body, so its state starts from that read.
            <EditorBody key={keyOf(data)} data={data} openSubmit={openSubmit} phone={phone} />
          ) : (
            <Notice tone="info" title={t("editor.thisApplicationHasBeenSubmittedAnd")}>
              <Link to={`/w/${ws.handle}/applications/${data.app.id}`}>{t("editor.seeWhereItStands")}</Link>
            </Notice>
          )
        }
      </Loaded>
    </main>
  );
  return (
    <>
      <title>{query.status === "ready" ? `${query.data.app.title} — ${ws.name}` : t("editor.pageTitle", { workspace: ws.name })}</title>
      {phone ? (
        <PhoneShell title={t("editor.application")} active="Applications">
          {body}
        </PhoneShell>
      ) : (
        <ApplicantShell active="Applications">{body}</ApplicantShell>
      )}
    </>
  );
}
