// SPDX-License-Identifier: AGPL-3.0-only
// What an outside award asks of the organization (v1.7): reports, conditions, payments expected and
// received. Obligations can repeat ("every N months from the start until the end", at most 60);
// editing a series changes only future, untouched ones. A report holds questions written in the
// same editor as an application, is marked submitted with its date and confirmation, and keeps an
// "as submitted" PDF with its fingerprint. Payments are amounts and dates only: never a bank detail.
import { useState, type ReactNode } from "react";
import { Banknote, Check, ClipboardList, FileText, Hash, Pencil, Plus, Repeat, Send, Trash, X } from "lucide-react";
import type { ApplicantMember, MyOrganization } from "../../../api/applicant.ts";
import type { AssistStatus } from "../../../api/applicantFull.ts";
import type { OutsideDetail } from "../../../api/outside.ts";
import type { LibraryAnswer, Obligation, ObligationInput, ObligationKind, ObligationPatch, ObligationStatus, SeriesInput, SeriesPatch, StatusInput } from "../../../api/writeKeep.ts";
import { useWKMutation, useWKQuery } from "../../../api/writeKeepHooks.ts";
import { Loaded } from "../../../components/applicant.tsx";
import { Dialog } from "../../../components/Dialog.tsx";
import { StatusBadge } from "../../../components/status.tsx";
import { ErrorBanner, Field, problemFor } from "../../../components/ui.tsx";
import { formatDate } from "../../../lib/format.ts";
import { addMonths, movesFrom, SERIES_MAX, seriesDates } from "../../../lib/writeKeep.ts";
import { DocumentRow } from "./ChecklistTab.tsx";
import { PasteQuestionsDialog, QuestionCard } from "./QuestionsTab.tsx";
import { DeadlineText, dollarsOf, moneyFrom, moneyText } from "./shared.tsx";

export const KIND_LABELS: Record<ObligationKind, string> = { report: "Report", condition: "Condition", payment_expected: "Payment expected", payment_received: "Payment received" };
const today = () => new Date().toISOString().slice(0, 10);

function Head({ id, title, sub, onClose }: { id: string; title: string; sub?: string; onClose: () => void }) {
  return (
    <div className="hd">
      <div>
        <h3 id={id} style={{ fontSize: "16px" }}>
          {title}
        </h3>
        {sub && <p className="small muted">{sub}</p>}
      </div>
      <button className="iconbtn" type="button" aria-label="Close" onClick={onClose}>
        <X className="ic ic-md" aria-hidden="true" />
      </button>
    </div>
  );
}

// ------------------------------------------------------------------------------------ series

/** "Just once" or "every N months from the first one until the end", with the dates it would make. */
function SeriesFields({ repeat, setRepeat, series, setSeries, idPrefix, offerOnce = true }: { repeat: boolean; setRepeat: (v: boolean) => void; series: SeriesInput; setSeries: (s: SeriesInput) => void; idPrefix: string; offerOnce?: boolean }) {
  const dates = repeat ? seriesDates(series.startOn, series.endOn, series.everyMonths, SERIES_MAX + 1) : [];
  return (
    <fieldset style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "8px" }}>
      <legend className="lbl">How often</legend>
      {offerOnce && (
        <div className="row" style={{ gap: "16px", flexWrap: "wrap", fontSize: "14px" }}>
          <label className="row" style={{ gap: "6px" }}>
            <input type="radio" name={`${idPrefix}-rep`} checked={!repeat} onChange={() => setRepeat(false)} />
            Just once
          </label>
          <label className="row" style={{ gap: "6px" }}>
            <input type="radio" name={`${idPrefix}-rep`} checked={repeat} onChange={() => setRepeat(true)} />
            Repeats
          </label>
        </div>
      )}
      {repeat && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "10px" }}>
            <Field id={`${idPrefix}-every`} label="Every (months)">
              <input id={`${idPrefix}-every`} className="inp" inputMode="numeric" value={series.everyMonths || ""} onChange={(e) => setSeries({ ...series, everyMonths: Number.parseInt(e.target.value, 10) || 0 })} />
            </Field>
            <Field id={`${idPrefix}-start`} label="First one due">
              <input id={`${idPrefix}-start`} type="date" className="inp" value={series.startOn} onChange={(e) => setSeries({ ...series, startOn: e.target.value })} />
            </Field>
            <Field id={`${idPrefix}-end`} label="Until">
              <input id={`${idPrefix}-end`} type="date" className="inp" value={series.endOn} onChange={(e) => setSeries({ ...series, endOn: e.target.value })} />
            </Field>
          </div>
          <span className={dates.length > SERIES_MAX ? "err-msg" : "help"} role={dates.length > SERIES_MAX ? "alert" : undefined}>
            {dates.length > SERIES_MAX
              ? `That makes more than ${SERIES_MAX}. Choose a longer gap or an earlier end.`
              : dates.length === 0
                ? "Choose the first date and an end on or after it."
                : `Makes ${dates.length}: ${dates.slice(0, 4).map(formatDate).join(", ")}${dates.length > 4 ? ", …" : ""}.`}
          </span>
        </>
      )}
    </fieldset>
  );
}
const seriesOk = (repeat: boolean, s: SeriesInput) => {
  if (!repeat) return true;
  const n = seriesDates(s.startOn, s.endOn, s.everyMonths, SERIES_MAX + 1).length;
  return s.everyMonths >= 1 && s.everyMonths <= 24 && n >= 1 && n <= SERIES_MAX;
};

// ------------------------------------------------------------------------------------ add / edit

export function ObligationDialog({ app, obligation, onClose, onDone }: { app: OutsideDetail; obligation?: Obligation; onClose: () => void; onDone: (message: string) => void }) {
  const editing = !!obligation;
  const [kind, setKind] = useState<ObligationKind>(obligation?.kind ?? "report");
  const [title, setTitle] = useState(obligation ? obligation.title.replace(/ \(\d+ of \d+\)$/, "") : "");
  const [dueOn, setDueOn] = useState(obligation?.dueOn ?? "");
  const [amount, setAmount] = useState(dollarsOf(obligation?.amount));
  const [notes, setNotes] = useState(obligation?.notes ?? "");
  const [repeat, setRepeat] = useState(false);
  const [scope, setScope] = useState<"one" | "series">("one");
  // A first report six months into the grant, every six months until the grant ends.
  const [series, setSeries] = useState<SeriesInput>(() => ({ everyMonths: 6, startOn: obligation?.dueOn ?? addMonths(app.grantStart ?? today(), 6), endOn: app.grantEnd ?? "" }));
  const money = moneyFrom(amount, app.currency);
  const payment = kind === "payment_expected" || kind === "payment_received";
  const create = useWKMutation((api, input: ObligationInput) => api.createObligation(app.id, input));
  const update = useWKMutation((api, patch: ObligationPatch) => api.updateObligation(obligation!.id, patch));
  const updateSeries = useWKMutation((api, patch: SeriesPatch) => api.updateSeries(obligation!.seriesId!, patch));
  const busy = create.state === "saving" || update.state === "saving" || updateSeries.state === "saving";
  const error = create.error ?? update.error ?? updateSeries.error;
  const amountBad = payment && (!amount.trim() || !money);
  const changeSeries = editing && !!obligation!.seriesId && scope === "series";
  const ready = !!title.trim() && !amountBad && (editing ? (changeSeries ? seriesOk(repeat, series) : true) : seriesOk(repeat, series) && (repeat || !!dueOn || kind === "condition"));
  const submit = async () => {
    if (changeSeries) {
      const patch: SeriesPatch = { title: title.trim(), notes: notes.trim() || null, ...(payment ? { amount: money } : {}), ...(repeat ? series : {}) };
      const r = await updateSeries.run(patch);
      if (r) onDone(`Series changed: ${r.replaced} later ${r.replaced === 1 ? "one" : "ones"} replaced by ${r.added}, ${r.kept} kept as ${r.kept === 1 ? "it was" : "they were"}`);
      return;
    }
    if (editing) {
      const r = await update.run({ title: title.trim(), notes: notes.trim() || null, dueOn: dueOn || null, ...(payment ? { amount: money } : {}) });
      if (r) onDone("Saved");
      return;
    }
    const input: ObligationInput = { kind, title: title.trim(), ...(notes.trim() ? { notes: notes.trim() } : {}), ...(payment && money ? { amount: money } : {}), ...(repeat ? { series } : { dueOn: dueOn || null }) };
    const r = await create.run(input);
    if (r) onDone(r.length === 1 ? "Added" : `${r.length} added`);
  };
  return (
    <Dialog open onClose={onClose} labelledBy="obl-title">
      <Head id="obl-title" title={editing ? `Edit ${obligation!.title}` : "Add an obligation"} sub={`${app.title} · ${app.funderName}`} onClose={onClose} />
      <div className="bd">
        {!editing && (
          <Field id="obl-kind" label="What the grant asks for">
            <select id="obl-kind" className="sel" value={kind} onChange={(e) => setKind(e.target.value as ObligationKind)}>
              <option value="report">A report</option>
              <option value="condition">A condition (an acknowledgement, a site visit, a sign-off)</option>
              <option value="payment_expected">A payment the funder will send</option>
            </select>
          </Field>
        )}
        <Field id="obl-name" label="Title" required error={problemFor(error, "title")}>
          <input id="obl-name" className="inp" value={title} placeholder={kind === "report" ? "Progress report" : kind === "condition" ? "Thank the funder in the annual report" : "Second payment"} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        {payment && (
          <Field id="obl-amount" label={`Amount (${app.currency})`} required error={amount && !money ? "Enter the amount in dollars, such as 25000" : problemFor(error, "amount")}>
            <input id="obl-amount" className="inp" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
        )}
        {editing && obligation!.seriesId && (
          <fieldset style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "6px" }}>
            <legend className="lbl">Change</legend>
            <label className="row small" style={{ gap: "6px" }}>
              <input type="radio" name="obl-scope" checked={scope === "one"} onChange={() => setScope("one")} />
              Only this one
            </label>
            <label className="row small" style={{ gap: "6px" }}>
              <input type="radio" name="obl-scope" checked={scope === "series"} onChange={() => setScope("series")} />
              The whole series: later ones not yet edited or acted on are replaced
            </label>
          </fieldset>
        )}
        {(!editing || !changeSeries) && (!repeat || editing) && (
          <Field id="obl-due" label={kind === "report" ? "Due" : kind === "condition" ? "Due (if it has a date)" : "Expected on"}>
            <input id="obl-due" type="date" className="inp" value={dueOn} onChange={(e) => setDueOn(e.target.value)} />
          </Field>
        )}
        {!editing && <SeriesFields repeat={repeat} setRepeat={setRepeat} series={series} setSeries={setSeries} idPrefix="obl" />}
        {changeSeries && (
          <label className="row small" style={{ gap: "6px" }}>
            <input type="checkbox" checked={repeat} onChange={(e) => setRepeat(e.target.checked)} />
            Re-plan the dates too
          </label>
        )}
        {changeSeries && repeat && <SeriesFields repeat series={series} setSeries={setSeries} setRepeat={setRepeat} idPrefix="obl" offerOnce={false} />}
        {changeSeries && !repeat && <p className="small muted">The title, notes and amount change on every later one not yet edited or acted on.</p>}
        <Field id="obl-notes" label="Notes">
          <textarea id="obl-notes" className="ta" style={{ minHeight: "56px" }} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        {payment && <p className="small muted">Amounts and dates only. Bank details are never kept here.</p>}
        {error ? <ErrorBanner error={error} title={editing ? "The change was not saved" : "The obligation was not added"} /> : null}
      </div>
      <div className="ft">
        <button className="btn btn-secondary" type="button" onClick={onClose}>
          Cancel
        </button>
        <button className="btn btn-primary" type="button" disabled={!ready || busy} onClick={() => void submit()}>
          {busy ? "Saving…" : editing ? "Save" : repeat ? "Add the series" : "Add"}
        </button>
      </div>
    </Dialog>
  );
}

// ------------------------------------------------------------------------------------ report

export function SubmitReportDialog({ obligation, onClose, onDone }: { obligation: Obligation; onClose: () => void; onDone: () => void }) {
  const [date, setDate] = useState(today());
  const [confirmation, setConfirmation] = useState("");
  const submit = useWKMutation((api) => api.submitObligation(obligation.id, { submittedAt: date, ...(confirmation.trim() ? { confirmationRef: confirmation.trim() } : {}) }));
  const future = date > today();
  return (
    <Dialog open onClose={onClose} labelledBy="rsub-title">
      <Head id="rsub-title" title="Mark the report submitted" sub={`${obligation.title}${obligation.dueOn ? `, due ${formatDate(obligation.dueOn)}` : ""}. Record the report you sent the funder; the GMS sends nothing.`} onClose={onClose} />
      <div className="bd">
        <Field id="rsub-date" label="Date you submitted" required error={future ? "The date cannot be in the future" : problemFor(submit.error, "submittedAt")}>
          <input id="rsub-date" type="date" className="inp" max={today()} value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field id="rsub-conf" label="Confirmation number" help="If the funder gave you one.">
          <input id="rsub-conf" className="inp" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} />
        </Field>
        <p className="small muted">A PDF of the report’s questions and latest answers is kept “as submitted”, with a fingerprint.</p>
        {submit.error ? <ErrorBanner error={submit.error} title="The report was not recorded" /> : null}
      </div>
      <div className="ft">
        <button className="btn btn-secondary" type="button" onClick={onClose}>
          Cancel
        </button>
        <button className="btn btn-primary" type="button" disabled={!date || future || submit.state === "saving"} onClick={async () => (await submit.run()) && onDone()}>
          <Send className="ic" aria-hidden="true" />
          {submit.state === "saving" ? "Recording…" : "Mark submitted"}
        </button>
      </div>
    </Dialog>
  );
}

/** A report's questions, written in the same editor as an application's. */
export function ReportQuestions({
  app,
  obligation,
  members,
  library,
  org,
  assist,
  onAssistUsed,
  canApprove,
  onChanged,
}: {
  app: OutsideDetail;
  obligation: Obligation;
  members: ApplicantMember[];
  library: LibraryAnswer[];
  org: MyOrganization | null;
  assist: AssistStatus | null;
  onAssistUsed: () => void;
  canApprove: boolean;
  onChanged: () => void;
}) {
  const [prompt, setPrompt] = useState("");
  const [pasting, setPasting] = useState(false);
  // A report's questions are kept on the report (the application's own list leaves them out).
  const list = useWKQuery((api) => api.reportQuestions(obligation.id), [obligation.id]);
  const add = useWKMutation((api, p: string) => api.addReportQuestions(obligation.id, [{ prompt: p, phase: "report" }]));
  const changed = () => {
    list.reload();
    onChanged();
  };
  const readOnly = obligation.status === "submitted" || obligation.status === "done" || !!app.archivedAt;
  return (
    <section aria-label={`Questions for ${obligation.title}`} style={{ display: "flex", flexDirection: "column", gap: "12px", paddingTop: "4px" }}>
      <Loaded query={list} label="Loading the report’s questions">
        {(questions) => (
          <>
            {questions.length === 0 && <p className="small muted">No questions yet. Paste the funder’s report questions, or add them one at a time.</p>}
            {questions.map((q, i) => (
              <QuestionCard key={q.id} q={q} n={i + 1} applicationId={app.id} reportOf={obligation.id} members={members} answers={library} org={org} readOnly={readOnly} assist={assist} onAssistUsed={onAssistUsed} canApprove={canApprove} onChanged={changed} />
            ))}
          </>
        )}
      </Loaded>
      {!readOnly && (
        <form
          className="row"
          style={{ gap: "8px", flexWrap: "wrap", alignItems: "flex-end" }}
          onSubmit={async (e) => {
            e.preventDefault();
            if (!prompt.trim()) return;
            if (await add.run(prompt.trim())) {
              setPrompt("");
              changed();
            }
          }}
        >
          <div className="fld" style={{ flex: "1 1 260px" }}>
            <label className="lbl" htmlFor={`rq-new-${obligation.id}`}>
              Add a report question
            </label>
            <input id={`rq-new-${obligation.id}`} className="inp" value={prompt} onChange={(e) => setPrompt(e.target.value)} />
          </div>
          <button type="submit" className="btn btn-secondary" disabled={!prompt.trim() || add.state === "saving"}>
            <Plus className="ic" aria-hidden="true" />
            Add
          </button>
          <button type="button" className="btn btn-secondary" aria-haspopup="dialog" onClick={() => setPasting(true)}>
            <ClipboardList className="ic" aria-hidden="true" />
            Paste questions
          </button>
        </form>
      )}
      {add.error ? <ErrorBanner error={add.error} title="The question was not added" /> : null}
      {pasting && (
        <PasteQuestionsDialog
          applicationId={app.id}
          obligationId={obligation.id}
          onClose={() => setPasting(false)}
          onSaved={() => {
            setPasting(false);
            changed();
          }}
        />
      )}
    </section>
  );
}

// ------------------------------------------------------------------------------------ one row

export function ObligationRow({
  o,
  app,
  readOnly,
  open,
  onToggle,
  onEdit,
  onSubmit,
  onChanged,
  children,
}: {
  o: Obligation;
  app: OutsideDetail;
  readOnly: boolean;
  open: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onSubmit: () => void;
  onChanged: () => void;
  children?: ReactNode;
}) {
  const [confirm, setConfirm] = useState(false);
  const [receiving, setReceiving] = useState(false);
  const [received, setReceived] = useState({ date: today(), amount: dollarsOf(o.amount) });
  const patch = useWKMutation((api, input: StatusInput) => api.setObligationStatus(o.id, input));
  const remove = useWKMutation(async (api) => {
    await api.deleteObligation(o.id);
    return true;
  });
  const run = async (input: StatusInput) => (await patch.run(input)) && onChanged();
  // The moves the server allows from here (or the workflow's own edges when it does not say).
  const allowed: ObligationStatus[] = o.allowedStatuses ?? movesFrom(o.kind, o.status);
  const can = (to: ObligationStatus) => allowed.includes(to);
  const doc = app.documents.find((d) => d.id === o.documentId);
  const settled = o.status === "done" || o.status === "received";
  const kept = o.kind === "report" && (o.status === "submitted" || o.status === "done");
  const money = moneyFrom(received.amount, app.currency);
  return (
    <li className="card" aria-label={`${o.title}${o.dueOn ? `, ${formatDate(o.dueOn)}` : ""}`} style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: "8px" }}>
      <div className="row" style={{ gap: "10px", flexWrap: "wrap" }}>
        {o.kind === "report" ? <FileText className="ic" aria-hidden="true" /> : o.kind === "condition" ? <Check className="ic" aria-hidden="true" /> : <Banknote className="ic" aria-hidden="true" />}
        <div style={{ display: "flex", flexDirection: "column", gap: "2px", minWidth: 0 }} className="grow">
          <span className="b" style={{ overflowWrap: "anywhere" }}>
            {o.title}
          </span>
          <span className="small muted row" style={{ gap: "6px", flexWrap: "wrap" }}>
            {KIND_LABELS[o.kind]}
            {o.amount ? ` · ${moneyText(o.amount)}` : ""}
            {o.seriesId && (
              <span className="row" style={{ gap: "3px" }}>
                · <Repeat className="ic ic-sm" aria-hidden="true" /> Repeats
              </span>
            )}
          </span>
        </div>
        <span className="small">{o.dueOn ? settled || o.status === "submitted" ? formatDate(o.dueOn) : <DeadlineText date={o.dueOn} /> : <span className="muted">No date</span>}</span>
        <StatusBadge kind="obligation" status={o.status} />
      </div>
      {o.notes && <p className="small muted" style={{ whiteSpace: "pre-wrap" }}>{o.notes}</p>}
      {o.status === "submitted" || (o.kind === "report" && o.submittedAt) ? (
        <div className="small" style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <span>
            Submitted {formatDate(o.submittedAt)}
            {o.confirmationRef ? (
              <>
                {" "}
                · confirmation <span className="mono">{o.confirmationRef}</span>
              </>
            ) : null}
          </span>
          {doc && <DocumentRow doc={doc} applicationId={app.id} note="as submitted" />}
          {o.snapshotSha256 && (
            <span className="small muted row" style={{ gap: "6px", alignItems: "flex-start" }}>
              <Hash className="ic ic-sm" aria-hidden="true" />
              <span>
                Fingerprint (SHA-256): <span className="mono" style={{ overflowWrap: "anywhere" }}>{o.snapshotSha256}</span>
              </span>
            </span>
          )}
        </div>
      ) : null}
      {!readOnly && (
        <div className="row" style={{ gap: "6px", flexWrap: "wrap" }}>
          {o.kind === "report" && (
            <button type="button" className="btn btn-sm btn-secondary" aria-expanded={open} onClick={onToggle}>
              <Pencil className="ic" aria-hidden="true" />
              {open ? "Close the report" : o.status === "submitted" || o.status === "done" ? "Read the report" : "Write the report"}
            </button>
          )}
          {o.kind === "report" && !["submitted", "done"].includes(o.status) && (
            <button type="button" className="btn btn-sm btn-secondary" aria-haspopup="dialog" onClick={onSubmit}>
              <Send className="ic" aria-hidden="true" />
              Mark submitted
            </button>
          )}
          {can("done") && (
            <button type="button" className="btn btn-sm btn-secondary" disabled={patch.state === "saving"} onClick={() => void run({ to: "done" })}>
              <Check className="ic" aria-hidden="true" />
              {o.kind === "report" ? "Mark done (the funder accepted it)" : "Mark done"}
            </button>
          )}
          {o.kind === "payment_expected" && can("received") && !receiving && (
            <button type="button" className="btn btn-sm btn-secondary" onClick={() => setReceiving(true)}>
              <Banknote className="ic" aria-hidden="true" />
              Record it received
            </button>
          )}
          {can("missed") && (
            <button type="button" className="btn btn-sm btn-ghost" disabled={patch.state === "saving"} onClick={() => void run({ to: "missed" })}>
              Missed
            </button>
          )}
          {(settled || o.status === "submitted") && can("due") && (
            <button type="button" className="btn btn-sm btn-ghost" disabled={patch.state === "saving"} onClick={() => void run({ to: "due" })}>
              {o.kind === "report" ? "Not accepted: still due" : "Reopen"}
            </button>
          )}
          {!kept && (
            <button type="button" className="btn btn-sm btn-ghost" aria-haspopup="dialog" aria-label={`Edit ${o.title}`} onClick={onEdit}>
              <Pencil className="ic" aria-hidden="true" />
              Edit
            </button>
          )}
          {!kept &&
            (confirm ? (
              <>
                <button type="button" className="btn btn-sm btn-danger" onClick={async () => (await remove.run()) && onChanged()}>
                  Remove {o.title}
                </button>
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => setConfirm(false)}>
                  Keep it
                </button>
              </>
            ) : (
              <button type="button" className="btn btn-sm btn-ghost" aria-label={`Remove ${o.title}`} onClick={() => setConfirm(true)}>
                <Trash className="ic" aria-hidden="true" />
                Remove
              </button>
            ))}
        </div>
      )}
      {receiving && (
        <form
          className="row"
          style={{ gap: "8px", flexWrap: "wrap", alignItems: "flex-end" }}
          onSubmit={async (e) => {
            e.preventDefault();
            if (money && (await patch.run({ to: "received", completedOn: received.date, amount: money }))) {
              setReceiving(false);
              onChanged();
            }
          }}
        >
          <div className="fld" style={{ flex: "1 1 140px" }}>
            <label className="lbl" htmlFor={`rcv-d-${o.id}`}>
              Date it arrived
            </label>
            <input id={`rcv-d-${o.id}`} type="date" className="inp" max={today()} value={received.date} onChange={(e) => setReceived({ ...received, date: e.target.value })} />
          </div>
          <div className="fld" style={{ flex: "1 1 140px" }}>
            <label className="lbl" htmlFor={`rcv-a-${o.id}`}>
              Amount ({app.currency})
            </label>
            <input id={`rcv-a-${o.id}`} className="inp" inputMode="decimal" value={received.amount} onChange={(e) => setReceived({ ...received, amount: e.target.value })} />
          </div>
          <button type="submit" className="btn btn-primary btn-sm" disabled={!money || !received.date || received.date > today() || patch.state === "saving"}>
            Save
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setReceiving(false)}>
            Cancel
          </button>
        </form>
      )}
      {patch.error ? <ErrorBanner error={patch.error} title="That change was not made" /> : null}
      {remove.error ? <ErrorBanner error={remove.error} title="It was not removed" /> : null}
      {open && children}
    </li>
  );
}
