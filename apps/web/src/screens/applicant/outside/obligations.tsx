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
import { t } from "../i18n.ts";

/** Each kind's name, read in the page's language every time. */
export const KIND_LABELS: Record<ObligationKind, string> = {
  get report() { return t("outsideObligations.kind.report"); },
  get condition() { return t("outsideObligations.kind.condition"); },
  get payment_expected() { return t("outsideObligations.kind.paymentExpected"); },
  get payment_received() { return t("outsideObligations.kind.paymentReceived"); },
};
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
      <button className="iconbtn" type="button" aria-label={t("outsideObligations.close")} onClick={onClose}>
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
      <legend className="lbl">{t("outsideObligations.howOften")}</legend>
      {offerOnce && (
        <div className="row" style={{ gap: "16px", flexWrap: "wrap", fontSize: "14px" }}>
          <label className="row" style={{ gap: "6px" }}>
            <input type="radio" name={`${idPrefix}-rep`} checked={!repeat} onChange={() => setRepeat(false)} />
            {t("outsideObligations.justOnce")}
          </label>
          <label className="row" style={{ gap: "6px" }}>
            <input type="radio" name={`${idPrefix}-rep`} checked={repeat} onChange={() => setRepeat(true)} />
            {t("outsideObligations.repeats")}
          </label>
        </div>
      )}
      {repeat && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "10px" }}>
            <Field id={`${idPrefix}-every`} label={t("outsideObligations.everyMonths")}>
              <input id={`${idPrefix}-every`} className="inp" inputMode="numeric" value={series.everyMonths || ""} onChange={(e) => setSeries({ ...series, everyMonths: Number.parseInt(e.target.value, 10) || 0 })} />
            </Field>
            <Field id={`${idPrefix}-start`} label={t("outsideObligations.firstOneDue")}>
              <input id={`${idPrefix}-start`} type="date" className="inp" value={series.startOn} onChange={(e) => setSeries({ ...series, startOn: e.target.value })} />
            </Field>
            <Field id={`${idPrefix}-end`} label={t("outsideObligations.until")}>
              <input id={`${idPrefix}-end`} type="date" className="inp" value={series.endOn} onChange={(e) => setSeries({ ...series, endOn: e.target.value })} />
            </Field>
          </div>
          <span className={dates.length > SERIES_MAX ? "err-msg" : "help"} role={dates.length > SERIES_MAX ? "alert" : undefined}>
            {dates.length > SERIES_MAX
              ? t("outsideObligations.tooMany", { max: SERIES_MAX })
              : dates.length === 0
                ? t("outsideObligations.chooseTheFirstDateAndAn")
                : t("outsideObligations.makes", { count: dates.length, dates: `${dates.slice(0, 4).map(formatDate).join(", ")}${dates.length > 4 ? ", …" : ""}` })}
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
      if (r) onDone(t("outsideObligations.seriesChanged", { replaced: r.replaced, added: r.added, kept: r.kept }));
      return;
    }
    if (editing) {
      const r = await update.run({ title: title.trim(), notes: notes.trim() || null, dueOn: dueOn || null, ...(payment ? { amount: money } : {}) });
      if (r) onDone(t("outsideObligations.saved"));
      return;
    }
    const input: ObligationInput = { kind, title: title.trim(), ...(notes.trim() ? { notes: notes.trim() } : {}), ...(payment && money ? { amount: money } : {}), ...(repeat ? { series } : { dueOn: dueOn || null }) };
    const r = await create.run(input);
    if (r) onDone(t("outsideObligations.added", { count: r.length }));
  };
  return (
    <Dialog open onClose={onClose} labelledBy="obl-title">
      <Head id="obl-title" title={editing ? t("outsideObligations.editTitle", { title: obligation!.title }) : t("outsideObligations.addAnObligation")} sub={`${app.title} · ${app.funderName}`} onClose={onClose} />
      <div className="bd">
        {!editing && (
          <Field id="obl-kind" label={t("outsideObligations.whatTheGrantAsksFor")}>
            <select id="obl-kind" className="sel" value={kind} onChange={(e) => setKind(e.target.value as ObligationKind)}>
              <option value="report">{t("outsideObligations.aReport")}</option>
              <option value="condition">{t("outsideObligations.aConditionAnAcknowledgementASite")}</option>
              <option value="payment_expected">{t("outsideObligations.aPaymentTheFunderWillSend")}</option>
            </select>
          </Field>
        )}
        <Field id="obl-name" label={t("outsideObligations.title")} required error={problemFor(error, "title")}>
          <input id="obl-name" className="inp" value={title} placeholder={kind === "report" ? t("outsideObligations.progressReport") : kind === "condition" ? t("outsideObligations.thankTheFunderInTheAnnual") : t("outsideObligations.secondPayment")} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        {payment && (
          <Field id="obl-amount" label={t("outsideObligations.amountIn", { currency: app.currency })} required error={amount && !money ? t("outsideObligations.badAmount") : problemFor(error, "amount")}>
            <input id="obl-amount" className="inp" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
        )}
        {editing && obligation!.seriesId && (
          <fieldset style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "6px" }}>
            <legend className="lbl">{t("outsideObligations.change")}</legend>
            <label className="row small" style={{ gap: "6px" }}>
              <input type="radio" name="obl-scope" checked={scope === "one"} onChange={() => setScope("one")} />
              {t("outsideObligations.onlyThisOne")}
            </label>
            <label className="row small" style={{ gap: "6px" }}>
              <input type="radio" name="obl-scope" checked={scope === "series"} onChange={() => setScope("series")} />
              {t("outsideObligations.theWholeSeriesLaterOnesNot")}
            </label>
          </fieldset>
        )}
        {(!editing || !changeSeries) && (!repeat || editing) && (
          <Field id="obl-due" label={kind === "report" ? t("outsideObligations.due") : kind === "condition" ? t("outsideObligations.dueIfItHasADate") : t("outsideObligations.expectedOn")}>
            <input id="obl-due" type="date" className="inp" value={dueOn} onChange={(e) => setDueOn(e.target.value)} />
          </Field>
        )}
        {!editing && <SeriesFields repeat={repeat} setRepeat={setRepeat} series={series} setSeries={setSeries} idPrefix="obl" />}
        {changeSeries && (
          <label className="row small" style={{ gap: "6px" }}>
            <input type="checkbox" checked={repeat} onChange={(e) => setRepeat(e.target.checked)} />
            {t("outsideObligations.rePlanTheDatesToo")}
          </label>
        )}
        {changeSeries && repeat && <SeriesFields repeat series={series} setSeries={setSeries} setRepeat={setRepeat} idPrefix="obl" offerOnce={false} />}
        {changeSeries && !repeat && <p className="small muted">{t("outsideObligations.theTitleNotesAndAmountChange")}</p>}
        <Field id="obl-notes" label={t("outsideObligations.notes")}>
          <textarea id="obl-notes" className="ta" style={{ minHeight: "56px" }} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        {payment && <p className="small muted">{t("outsideObligations.amountsAndDatesOnlyBankDetails")}</p>}
        {error ? <ErrorBanner error={error} title={editing ? t("outsideObligations.theChangeWasNotSaved") : t("outsideObligations.theObligationWasNotAdded")} /> : null}
      </div>
      <div className="ft">
        <button className="btn btn-secondary" type="button" onClick={onClose}>
          {t("outsideObligations.cancel")}
        </button>
        <button className="btn btn-primary" type="button" disabled={!ready || busy} onClick={() => void submit()}>
          {busy ? t("outsideObligations.saving") : editing ? t("outsideObligations.save") : repeat ? t("outsideObligations.addTheSeries") : t("outsideObligations.add")}
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
      <Head id="rsub-title" title={t("outsideObligations.markTheReportSubmitted")} sub={obligation.dueOn ? t("outsideObligations.reportSubDue", { title: obligation.title, date: formatDate(obligation.dueOn) }) : t("outsideObligations.reportSub", { title: obligation.title })} onClose={onClose} />
      <div className="bd">
        <Field id="rsub-date" label={t("outsideObligations.dateYouSubmitted")} required error={future ? t("outsideObligations.dateInFuture") : problemFor(submit.error, "submittedAt")}>
          <input id="rsub-date" type="date" className="inp" max={today()} value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field id="rsub-conf" label={t("outsideObligations.confirmationNumber")} help={t("outsideObligations.ifTheFunderGaveYouOne")}>
          <input id="rsub-conf" className="inp" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} />
        </Field>
        <p className="small muted">{t("outsideObligations.aPdfOfTheReportsQuestions")}</p>
        {submit.error ? <ErrorBanner error={submit.error} title={t("outsideObligations.theReportWasNotRecorded")} /> : null}
      </div>
      <div className="ft">
        <button className="btn btn-secondary" type="button" onClick={onClose}>
          {t("outsideObligations.cancel")}
        </button>
        <button className="btn btn-primary" type="button" disabled={!date || future || submit.state === "saving"} onClick={async () => (await submit.run()) && onDone()}>
          <Send className="ic" aria-hidden="true" />
          {submit.state === "saving" ? t("outsideObligations.recording") : t("outsideObligations.markSubmitted")}
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
    <section aria-label={t("outsideObligations.questionsFor", { title: obligation.title })} style={{ display: "flex", flexDirection: "column", gap: "12px", paddingTop: "4px" }}>
      <Loaded query={list} label={t("outsideObligations.loadingTheReportsQuestions")}>
        {(questions) => (
          <>
            {questions.length === 0 && <p className="small muted">{t("outsideObligations.noQuestionsYetPasteTheFunders")}</p>}
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
              {t("outsideObligations.addAReportQuestion")}
            </label>
            <input id={`rq-new-${obligation.id}`} className="inp" value={prompt} onChange={(e) => setPrompt(e.target.value)} />
          </div>
          <button type="submit" className="btn btn-secondary" disabled={!prompt.trim() || add.state === "saving"}>
            <Plus className="ic" aria-hidden="true" />
            {t("outsideObligations.add")}
          </button>
          <button type="button" className="btn btn-secondary" aria-haspopup="dialog" onClick={() => setPasting(true)}>
            <ClipboardList className="ic" aria-hidden="true" />
            {t("outsideObligations.pasteQuestions")}
          </button>
        </form>
      )}
      {add.error ? <ErrorBanner error={add.error} title={t("outsideObligations.theQuestionWasNotAdded")} /> : null}
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
                · <Repeat className="ic ic-sm" aria-hidden="true" /> {t("outsideObligations.repeats")}
              </span>
            )}
          </span>
        </div>
        <span className="small">{o.dueOn ? settled || o.status === "submitted" ? formatDate(o.dueOn) : <DeadlineText date={o.dueOn} /> : <span className="muted">{t("outsideObligations.noDate")}</span>}</span>
        <StatusBadge kind="obligation" status={o.status} />
      </div>
      {o.notes && <p className="small muted" style={{ whiteSpace: "pre-wrap" }}>{o.notes}</p>}
      {o.status === "submitted" || (o.kind === "report" && o.submittedAt) ? (
        <div className="small" style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <span>
            {t("outsideObligations.submittedOn", { date: formatDate(o.submittedAt) })}
            {o.confirmationRef ? (
              <>
                {" "}
                · {t("outsideObligations.confirmation")} <span className="mono">{o.confirmationRef}</span>
              </>
            ) : null}
          </span>
          {doc && <DocumentRow doc={doc} applicationId={app.id} note={t("outsideObligations.asSubmitted")} />}
          {o.snapshotSha256 && (
            <span className="small muted row" style={{ gap: "6px", alignItems: "flex-start" }}>
              <Hash className="ic ic-sm" aria-hidden="true" />
              <span>
                {t("outsideObligations.fingerprintSha256")} <span className="mono" style={{ overflowWrap: "anywhere" }}>{o.snapshotSha256}</span>
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
              {open ? t("outsideObligations.closeTheReport") : o.status === "submitted" || o.status === "done" ? t("outsideObligations.readTheReport") : t("outsideObligations.writeTheReport")}
            </button>
          )}
          {o.kind === "report" && !["submitted", "done"].includes(o.status) && (
            <button type="button" className="btn btn-sm btn-secondary" aria-haspopup="dialog" onClick={onSubmit}>
              <Send className="ic" aria-hidden="true" />
              {t("outsideObligations.markSubmitted")}
            </button>
          )}
          {can("done") && (
            <button type="button" className="btn btn-sm btn-secondary" disabled={patch.state === "saving"} onClick={() => void run({ to: "done" })}>
              <Check className="ic" aria-hidden="true" />
              {o.kind === "report" ? t("outsideObligations.markDoneTheFunderAcceptedIt") : t("outsideObligations.markDone")}
            </button>
          )}
          {o.kind === "payment_expected" && can("received") && !receiving && (
            <button type="button" className="btn btn-sm btn-secondary" onClick={() => setReceiving(true)}>
              <Banknote className="ic" aria-hidden="true" />
              {t("outsideObligations.recordItReceived")}
            </button>
          )}
          {can("missed") && (
            <button type="button" className="btn btn-sm btn-ghost" disabled={patch.state === "saving"} onClick={() => void run({ to: "missed" })}>
              {t("outsideObligations.missed")}
            </button>
          )}
          {(settled || o.status === "submitted") && can("due") && (
            <button type="button" className="btn btn-sm btn-ghost" disabled={patch.state === "saving"} onClick={() => void run({ to: "due" })}>
              {o.kind === "report" ? t("outsideObligations.theFunderSentItBack") : t("outsideObligations.reopen")}
            </button>
          )}
          {!kept && (
            <button type="button" className="btn btn-sm btn-ghost" aria-haspopup="dialog" aria-label={t("outsideObligations.editTitle", { title: o.title })} onClick={onEdit}>
              <Pencil className="ic" aria-hidden="true" />
              {t("outsideObligations.edit")}
            </button>
          )}
          {!kept &&
            (confirm ? (
              <>
                <button type="button" className="btn btn-sm btn-danger" onClick={async () => (await remove.run()) && onChanged()}>
                  {t("outsideObligations.removeTitle", { title: o.title })}
                </button>
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => setConfirm(false)}>
                  {t("outsideObligations.keepIt")}
                </button>
              </>
            ) : (
              <button type="button" className="btn btn-sm btn-ghost" aria-label={t("outsideObligations.removeTitle", { title: o.title })} onClick={() => setConfirm(true)}>
                <Trash className="ic" aria-hidden="true" />
                {t("outsideObligations.remove")}
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
              {t("outsideObligations.dateItArrived")}
            </label>
            <input id={`rcv-d-${o.id}`} type="date" className="inp" max={today()} value={received.date} onChange={(e) => setReceived({ ...received, date: e.target.value })} />
          </div>
          <div className="fld" style={{ flex: "1 1 140px" }}>
            <label className="lbl" htmlFor={`rcv-a-${o.id}`}>
              {t("outsideObligations.amountIn", { currency: app.currency })}
            </label>
            <input id={`rcv-a-${o.id}`} className="inp" inputMode="decimal" value={received.amount} onChange={(e) => setReceived({ ...received, amount: e.target.value })} />
          </div>
          <button type="submit" className="btn btn-primary btn-sm" disabled={!money || !received.date || received.date > today() || patch.state === "saving"}>
            {t("outsideObligations.save")}
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setReceiving(false)}>
            {t("outsideObligations.cancel")}
          </button>
        </form>
      )}
      {patch.error ? <ErrorBanner error={patch.error} title={t("outsideObligations.thatChangeWasNotMade")} /> : null}
      {remove.error ? <ErrorBanner error={remove.error} title={t("outsideObligations.itWasNotRemoved")} /> : null}
      {open && children}
    </li>
  );
}
