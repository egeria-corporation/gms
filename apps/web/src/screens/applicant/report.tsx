// SPDX-License-Identifier: AGPL-3.0-only
// Reporting from the grantee's side: the requirements across every grant, and one report at a
// time: prefilled from Passport and the last accepted report, saved as you type, submitted once,
// answered if the funder returns it, and shared with another funder by consent once accepted.
// The desktop screen (Reports.tsx) and the phone layout (phone/ReportsPhone.tsx) share this file.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { validateResponse, type FormDefinition, type JsonObject, type ValidationError } from "@gms/forms";
import { CircleCheck, CircleDashed, Clock, RotateCcw, Share2 } from "lucide-react";
import { changedPaths, type ApplicantApi, type MyFunder } from "../../api/applicant.ts";
import { useApplicantApi } from "../../api/applicantHooks.ts";
import type { ApplicantMoreApi, MyRequirement, ShareResult, Submission, SubmissionForm } from "../../api/applicantMore.ts";
import { useMoreApi, useMoreMutation, useMoreQuery } from "../../api/applicantMoreHooks.ts";
import { ApiError } from "../../api/client.ts";
import type { Query } from "../../api/hooks.ts";
import { Dialog } from "../../components/Dialog.tsx";
import { ErrorBanner, Loading, problemsOf } from "../../components/ui.tsx";
import { FormView } from "../../forms/FormView.tsx";
import { daysUntil, formatDate } from "../../lib/format.ts";

export interface ReportsData {
  requirements: MyRequirement[];
  funders: MyFunder[];
}

export function useReports(workspaceId: string): Query<ReportsData> {
  const api = useApplicantApi();
  return useMoreQuery(async (more) => ({ requirements: await more.requirements(), funders: await api.funders() }), [workspaceId, api]);
}

/** What needs the grantee's attention first: returned, overdue, due, then the rest by date. */
const ORDER: Record<string, number> = { returned: 0, overdue: 1, due: 2, scheduled: 3, submitted: 4, under_review: 4, accepted: 5, waived: 6 };
export const byUrgency = (a: MyRequirement, b: MyRequirement) => (ORDER[a.status] ?? 9) - (ORDER[b.status] ?? 9) || (a.dueAt ?? "").localeCompare(b.dueAt ?? "");

export function summaryLine(list: MyRequirement[], now: Date = new Date()): string[] {
  const funders = new Set(list.map((r) => r.funder?.workspaceId)).size;
  const parts = [`${list.length} requirement${list.length === 1 ? "" : "s"} across ${funders} funder${funders === 1 ? "" : "s"}`];
  const due = list.filter((r) => r.status === "due" || r.status === "overdue").sort((a, b) => (a.dueAt ?? "").localeCompare(b.dueAt ?? ""))[0];
  const days = due ? daysUntil(due.dueAt, now) : null;
  if (due && days !== null) parts.push(days < 0 ? `1 overdue by ${-days} day${days === -1 ? "" : "s"}` : `1 due in ${days} day${days === 1 ? "" : "s"}`);
  const returned = list.filter((r) => r.status === "returned").length;
  if (returned) parts.push(`${returned} returned with comments`);
  return parts;
}

/** The button a requirement row offers, by where the report stands. */
export function actionFor(r: MyRequirement): { label: string; primary: boolean } | null {
  if (r.status === "waived") return null;
  if (r.status === "returned") return { label: "Respond", primary: true };
  if (r.status === "accepted") return { label: "View and share", primary: false };
  if (r.status === "submitted" || r.status === "under_review") return { label: "View", primary: false };
  if (r.submissionId) return { label: "Open in editor", primary: r.status !== "scheduled" };
  return { label: r.status === "scheduled" ? "Start early" : "Start report", primary: r.status !== "scheduled" };
}

export function duePhrase(r: MyRequirement, now: Date = new Date()): { text: string; urgent: boolean } {
  const days = daysUntil(r.dueAt, now);
  if (!r.dueAt || days === null) return { text: "No due date", urgent: false };
  if (r.status === "accepted" || r.status === "submitted" || r.status === "under_review") return { text: `Due ${formatDate(r.dueAt)}`, urgent: false };
  if (days < 0) return { text: `Due ${formatDate(r.dueAt)} · ${-days} day${days === -1 ? "" : "s"} late`, urgent: true };
  return { text: `Due ${formatDate(r.dueAt)} · ${days} day${days === 1 ? "" : "s"}`, urgent: days <= 30 };
}

// ------------------------------------------------------------------------------------ one report

interface Loaded {
  submission: Submission;
  form: SubmissionForm;
  def: FormDefinition | null;
}

async function open(api: ApplicantApi, more: ApplicantMoreApi, r: MyRequirement, start: boolean): Promise<Loaded | null> {
  const submission = r.submissionId && !start ? await more.submission(r.submissionId) : start ? await more.startReport(r.id) : null;
  const form = submission?.formResponses[0];
  if (!submission || !form) return null;
  // A grantee can only read a form the API will show them; without it the answers are still listed.
  const def = await api.form(form.formId, form.formVersion).catch((e: unknown) => (e instanceof ApiError && e.status === 404 ? null : Promise.reject(e)));
  return { submission, form, def };
}

export interface ReportSection {
  label: string;
  state: "done" | "prog" | "todo";
  note: string;
}

function fieldsIn(el: unknown): string[] {
  if (!el || typeof el !== "object") return [];
  const e = el as { type?: string; scope?: string; elements?: unknown[] };
  if (e.type === "Control" && e.scope) return [e.scope.replace(/^#\/properties\//, "")];
  return (e.elements ?? []).flatMap(fieldsIn);
}

/** One entry per top-level group of the form, with how far along it is. */
export function sectionsOf(def: FormDefinition, form: SubmissionForm, errors: ValidationError[]): ReportSection[] {
  const groups = ((def.uiSchema as { elements?: { type?: string; label?: string }[] }).elements ?? []).filter((g) => g.type === "Group" && g.label);
  return groups.map((g) => {
    const keys = fieldsIn(g);
    const bad = errors.filter((e) => keys.some((k) => e.field === `/${k}` || e.field.startsWith(`/${k}/`))).length;
    const filled = keys.filter((k) => form.response[k] !== undefined && form.response[k] !== null && form.response[k] !== "").length;
    const prefilled = keys.some((k) => ["passport", "prior_submission"].includes(form.provenance[`/${k}`] ?? ""));
    const state = bad === 0 && filled > 0 ? "done" : filled > 0 ? "prog" : "todo";
    return { label: g.label!, state, note: bad ? `${bad} to fix` : state === "done" ? `Complete${prefilled ? " · prefilled" : ""}` : state === "prog" ? "In progress" : "Not started" };
  });
}

export const SECTION_ICON = { done: CircleCheck, prog: Clock, todo: CircleDashed } as const;
export const sectionId = (label: string) => `rsec-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

export interface ReportState {
  loaded: Loaded | null;
  status: "idle" | "loading" | "error";
  error: unknown;
  /** True while the report can be edited (a draft, or returned by the funder). */
  editable: boolean;
  response: JsonObject;
  errors: ValidationError[];
  serverErrors: ValidationError[];
  showAll: boolean;
  save: { state: "idle" | "saving" | "saved" | "error"; at?: string; error?: unknown };
  submit: { state: "idle" | "sending"; error?: unknown };
  sections: ReportSection[];
  start: () => void;
  change: (next: JsonObject) => void;
  autosave: () => void;
  send: () => Promise<void>;
}

/** Everything one report needs: loading, starting, merge-by-field saves and submitting. */
export function useReport(requirement: MyRequirement | null, onChanged: () => void): ReportState {
  const api = useApplicantApi();
  const more = useMoreApi();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState<unknown>(null);
  const [response, setResponse] = useState<JsonObject>({});
  const [save, setSave] = useState<ReportState["save"]>({ state: "idle" });
  const [submit, setSubmit] = useState<ReportState["submit"]>({ state: "idle" });
  const [serverErrors, setServerErrors] = useState<ValidationError[]>([]);
  const [showAll, setShowAll] = useState(false);
  const baseline = useRef<JsonObject>({});
  const local = useRef<JsonObject>({});
  const saving = useRef<Promise<void>>(Promise.resolve());
  const changed = useRef(onChanged);
  changed.current = onChanged;

  const adopt = useCallback((l: Loaded | null) => {
    setLoaded(l);
    baseline.current = l?.form.response ?? {};
    local.current = baseline.current;
    setResponse(baseline.current);
    setServerErrors([]);
    setShowAll(false);
    setSave({ state: "idle" });
    setSubmit({ state: "idle" });
  }, []);

  const load = useCallback(
    (start: boolean) => {
      if (!requirement) return adopt(null);
      let live = true;
      setStatus("loading");
      open(api, more, requirement, start).then(
        (l) => {
          if (!live) return;
          adopt(l);
          setStatus("idle");
          if (start) changed.current();
        },
        (e: unknown) => {
          if (!live) return;
          setError(e);
          setStatus("error");
        },
      );
      return () => {
        live = false;
      };
    },
    [api, more, requirement?.id, requirement?.submissionId, adopt],
  );
  useEffect(() => load(false), [load]);

  const submissionId = loaded?.submission.id;
  const formId = loaded?.form.formId;
  const push = useCallback((): Promise<void> => {
    saving.current = saving.current.then(async () => {
      if (!submissionId || !formId) return;
      const sent = local.current;
      const patch = changedPaths(baseline.current, sent);
      if (!patch) return;
      setSave({ state: "saving" });
      try {
        const saved = await more.saveReportForm(submissionId, formId, patch);
        baseline.current = saved.response;
        setLoaded((prev) => (prev ? { ...prev, form: saved, submission: { ...prev.submission, status: "draft" } } : prev));
        setSave({ state: "saved", at: new Date().toISOString() });
      } catch (e) {
        setSave({ state: "error", error: e });
      }
    });
    return saving.current;
  }, [more, submissionId, formId]);

  const errors = useMemo(() => (loaded?.def ? validateResponse(loaded.def, response).validationErrors : (loaded?.form.validationErrors ?? [])), [loaded, response]);
  const editable = !!loaded && (loaded.submission.status === "draft" || loaded.submission.status === "returned");
  const sections = useMemo(() => (loaded?.def ? sectionsOf(loaded.def, { ...loaded.form, response }, errors) : []), [loaded, response, errors]);

  return {
    loaded,
    status,
    error,
    editable,
    response,
    errors,
    serverErrors,
    showAll,
    save,
    submit,
    sections,
    start: () => void load(true),
    change: (next) => {
      local.current = next;
      setResponse(next);
    },
    autosave: () => void push(),
    send: async () => {
      if (!submissionId) return;
      setShowAll(true);
      setSubmit({ state: "sending" });
      await push();
      try {
        const sent = await more.submitReport(submissionId);
        setLoaded((prev) => (prev ? { ...prev, submission: sent, form: sent.formResponses[0] ?? prev.form } : prev));
        setSubmit({ state: "idle" });
        changed.current();
        // The submit button is gone once the report locks; keep keyboard focus on the report.
        setTimeout(() => document.getElementById("editor")?.focus(), 0);
      } catch (e) {
        setServerErrors(problemsOf(e).map((p) => ({ field: (p.field ?? p.path ?? "").replace(/^frm_[0-9a-f-]+/, ""), message: p.message, type: "invalid" })));
        setSubmit({ state: "idle", error: e });
      }
    },
  };
}

/** The form itself: editable while it is a draft or returned, read-only with sources once sent. */
export function ReportForm({ report, passportUrl }: { report: ReportState; passportUrl: string | null }) {
  const ref = useRef<HTMLDivElement>(null);
  // FormView draws one card per group; give each an anchor the section list can reach.
  useEffect(() => {
    for (const s of report.sections) {
      const el = [...(ref.current?.querySelectorAll<HTMLElement>("section[aria-label]") ?? [])].find((n) => n.getAttribute("aria-label") === s.label);
      if (el) el.id = sectionId(s.label);
    }
  });
  const l = report.loaded;
  if (!l) return null;
  if (!l.def) {
    return (
      <div className="card">
        <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          <ErrorBanner error={new Error("This report's form could not be loaded, so it cannot be edited here yet. Your saved answers are listed below.")} title="The form is not available" />
          <dl className="kv">
            {Object.entries(l.form.response).map(([k, v]) => (
              <div key={k} style={{ display: "contents" }}>
                <dt>{k}</dt>
                <dd>{typeof v === "object" ? JSON.stringify(v) : String(v)}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    );
  }
  return (
    <div ref={ref} style={{ display: "flex", flexDirection: "column", gap: "20px", minWidth: 0 }}>
      <FormView
        form={l.def}
        response={report.response}
        mode={report.editable ? "edit" : "funder"}
        provenance={l.form.provenance}
        onChange={report.change}
        onAutosave={report.autosave}
        showAllErrors={report.showAll}
        serverErrors={report.serverErrors}
        {...(passportUrl ? { passportUrl } : {})}
      />
    </div>
  );
}

/** The funder's note on a returned report, with what to do about it. */
export function ReturnedBanner({ submission, funder }: { submission: Submission; funder: string }) {
  if (submission.status !== "returned" || !submission.reviewNote) return null;
  return (
    <div className="bnr bnr-warn" role="status">
      <RotateCcw className="ic" aria-hidden="true" />
      <div>
        <div className="t">{funder} returned this report</div>
        <div className="d">{submission.reviewNote}</div>
        <div className="clears">Correct the report and submit it again; your other answers are kept.</div>
      </div>
    </div>
  );
}

/**
 * Share an accepted report with another funder. This is the organization's consent: it names the
 * funder, the fields, and says what the funder receives.
 */
export function ShareReport({ loaded, requirement, funders, onShared }: { loaded: Loaded; requirement: MyRequirement; funders: MyFunder[]; onShared: (r: ShareResult) => void }) {
  const others = funders.filter((f) => f.workspaceId !== requirement.funder?.workspaceId);
  const fields = useMemo(() => {
    const props = (loaded.def?.jsonSchema.properties ?? {}) as Record<string, { title?: string }>;
    return Object.keys(loaded.form.response).map((k) => ({ key: k, label: props[k]?.title ?? k }));
  }, [loaded]);
  const [openDialog, setOpenDialog] = useState(false);
  const [funder, setFunder] = useState(others[0]?.handle ?? "");
  const [picked, setPicked] = useState<string[]>(() => fields.map((f) => f.key));
  const [note, setNote] = useState("");
  const [done, setDone] = useState<ShareResult | null>(null);
  const share = useMoreMutation((api) => api.shareReport(loaded.submission.id, { funderHandle: funder, ...(picked.length < fields.length ? { fields: picked } : {}), ...(note.trim() ? { note: note.trim() } : {}) }));
  const target = others.find((f) => f.handle === funder);
  if (loaded.submission.status !== "accepted") return null;
  return (
    <div className="card" id="share">
      <div className="card-h">
        <div>
          <h3>Share with another funder</h3>
          <p className="small muted">Report once: give another funder a copy of this accepted report instead of writing it again.</p>
        </div>
      </div>
      <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
        {done && (
          <div className="bnr bnr-ok" role="status">
            <CircleCheck className="ic" aria-hidden="true" />
            <div>
              <div className="t">Shared with {done.funder.name}</div>
              <div className="d">They see it in their received reports, marked as shared by you. Manage who has access in Team &amp; access.</div>
            </div>
          </div>
        )}
        {others.length === 0 ? (
          <p className="small muted">There is no other funder to share with yet. Funders appear here once you have applied to them.</p>
        ) : (
          <button className="btn btn-secondary" type="button" style={{ alignSelf: "flex-start" }} onClick={() => setOpenDialog(true)}>
            <Share2 className="ic" aria-hidden="true" />
            Share this report
          </button>
        )}
      </div>
      <Dialog open={openDialog} onClose={() => setOpenDialog(false)} labelledBy="share-title">
        <div className="hd">
          <div>
            <h2 id="share-title" style={{ fontSize: "18px" }}>
              Share “{requirement.title}”
            </h2>
            <p className="small muted" style={{ marginTop: "4px" }}>
              Accepted by {requirement.funder?.name ?? "your funder"}
            </p>
          </div>
        </div>
        <div className="bd">
          <div className="fld">
            <label className="lbl" htmlFor="share-funder">
              Share with
            </label>
            <select className="sel" id="share-funder" value={funder} onChange={(e) => setFunder(e.target.value)}>
              {others.map((f) => (
                <option key={f.workspaceId} value={f.handle}>
                  {f.name}
                </option>
              ))}
            </select>
          </div>
          <fieldset style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "6px" }}>
            <legend className="lbl" style={{ marginBottom: "6px" }}>
              Fields to share
            </legend>
            {fields.map((f) => (
              <label key={f.key} className="cb" style={{ cursor: "pointer" }}>
                <input type="checkbox" checked={picked.includes(f.key)} onChange={(e) => setPicked(e.target.checked ? [...picked, f.key] : picked.filter((k) => k !== f.key))} style={{ width: "18px", height: "18px", marginTop: "2px" }} />
                <span>{f.label}</span>
              </label>
            ))}
          </fieldset>
          <div className="fld">
            <label className="lbl" htmlFor="share-note">
              Note to the funder (optional)
            </label>
            <textarea className="ta" id="share-note" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <p className="help">
            By sharing, {target?.name ?? "the funder"} receives a copy of the fields you ticked, as accepted on {formatDate(loaded.submission.submittedAt)}. This is recorded as your consent and you can withdraw it under Team &amp; access; a copy already received stays with them.
          </p>
          {share.error ? <ErrorBanner error={share.error} title="The report was not shared" /> : null}
        </div>
        <div className="ft">
          <button className="btn btn-secondary" type="button" onClick={() => setOpenDialog(false)}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            type="button"
            disabled={!funder || picked.length === 0 || share.state === "saving"}
            onClick={async () => {
              const result = await share.run();
              if (result) {
                setDone(result);
                setOpenDialog(false);
                onShared(result);
              }
            }}
          >
            Share with {target?.name ?? "funder"}
          </button>
        </div>
      </Dialog>
    </div>
  );
}

export function ReportLoading({ report }: { report: ReportState }) {
  if (report.status === "loading") return <Loading label="Opening the report" />;
  if (report.status === "error") return <ErrorBanner error={report.error} />;
  return null;
}
