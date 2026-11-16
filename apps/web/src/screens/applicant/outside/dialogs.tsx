// SPDX-License-Identifier: AGPL-3.0-only
// The three things only a person records for an outside application: that they submitted it on
// the funder's site, what the funder decided, and a request for consulting help from OpenGrants.
import { useState } from "react";
import { CircleCheck, Scissors, Send, X } from "lucide-react";
import type { ConsultingPreview, DecisionInput, OutsideApplication, OutsideDetail, SubmissionMethod, YearAmount } from "../../../api/outside.ts";
import { minorOf } from "../../../api/outside.ts";
import { useOutsideMutation } from "../../../api/outsideHooks.ts";
import { Dialog } from "../../../components/Dialog.tsx";
import { ErrorBanner, Field, Notice, problemFor } from "../../../components/ui.tsx";
import { formatDate, parseDollars } from "../../../lib/format.ts";
import { decisionOutcomes, type DecisionOutcome } from "../../../lib/outside.ts";
import { stageLabel } from "../labels.ts";
import { answersAsSent, CONSULTING_ANSWERS_MAX } from "../../../lib/writeKeep.ts";
import { useUpload } from "./ChecklistTab.tsx";
import { DEADLINE_LABELS, METHOD_LABELS, moneyFrom, moneyText } from "./shared.tsx";
import { t } from "../i18n.ts";

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
      <button className="iconbtn" type="button" aria-label={t("outsideDialogs.close")} onClick={onClose}>
        <X className="ic ic-md" aria-hidden="true" />
      </button>
    </div>
  );
}

// ------------------------------------------------------------------------------------ submitted

export function MarkSubmittedDialog({ app, onClose, onDone }: { app: OutsideApplication; onClose: () => void; onDone: (a: OutsideApplication) => void }) {
  const [date, setDate] = useState(today());
  const [method, setMethod] = useState<SubmissionMethod | "">(app.portalUrl ? "portal" : "");
  const [confirmation, setConfirmation] = useState("");
  const [receipt, setReceipt] = useState<{ id: string; name: string } | null>(null);
  const upload = useUpload(app.id);
  const submit = useOutsideMutation((api) => api.submit(app.id, { submittedAt: date, method: method as SubmissionMethod, ...(confirmation.trim() ? { confirmationRef: confirmation.trim() } : {}), ...(receipt ? { receiptDocumentId: receipt.id } : {}) }));
  const future = date > today();
  return (
    <Dialog open onClose={onClose} labelledBy="osub-title">
      <Head id="osub-title" title={t("outsideDialogs.markAsSubmitted")} sub={t("outsideDialogs.markSubmittedSub")} onClose={onClose} />
      <div className="bd">
        <Field id="osub-date" label={t("outsideDialogs.dateYouSubmitted")} required error={future ? t("outsideDialogs.dateInFuture") : problemFor(submit.error, "submittedAt")}>
          <input id="osub-date" type="date" className="inp" max={today()} value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field id="osub-method" label={t("outsideDialogs.howYouSubmitted")} required error={problemFor(submit.error, "method")}>
          <select id="osub-method" className="sel" value={method} onChange={(e) => setMethod(e.target.value as SubmissionMethod)}>
            <option value="" disabled>
              {t("outsideDialogs.chooseOne")}
            </option>
            {(Object.keys(METHOD_LABELS) as SubmissionMethod[]).map((m) => (
              <option key={m} value={m}>
                {METHOD_LABELS[m]}
              </option>
            ))}
          </select>
        </Field>
        <Field id="osub-conf" label={t("outsideDialogs.confirmationNumber")} help={t("outsideDialogs.ifTheFunderGaveYouOne")}>
          <input id="osub-conf" className="inp" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} />
        </Field>
        <div className="fld">
          <span className="lbl">{t("outsideDialogs.receipt")}</span>
          {receipt ? (
            <span className="row" style={{ gap: "6px" }}>
              <CircleCheck className="ic" aria-hidden="true" style={{ color: "var(--s-ok-fg)" }} />
              {receipt.name}
            </span>
          ) : (
            <label className="btn btn-sm btn-secondary" style={{ alignSelf: "flex-start", cursor: "pointer" }}>
              {upload.state === "saving" ? t("outsideDialogs.uploading") : t("outsideDialogs.uploadTheReceiptOrConfirmationEmail")}
              <input
                type="file"
                className="sr"
                aria-label={t("outsideDialogs.uploadTheReceipt")}
                onChange={async (e) => {
                  const doc = await upload.run(e.target.files?.[0]);
                  e.target.value = "";
                  if (doc) setReceipt({ id: doc.id, name: doc.name });
                }}
              />
            </label>
          )}
          {upload.tooBig && <span className="err-msg" role="alert">{upload.tooBig}</span>}
        </div>
        <p className="small muted">{t("outsideDialogs.aPdfOfEveryQuestionAnd")}</p>
        {upload.error ? <ErrorBanner error={upload.error} title={t("outsideDialogs.theReceiptWasNotUploaded")} /> : null}
        {submit.error ? <ErrorBanner error={submit.error} title={t("outsideDialogs.theSubmissionWasNotRecorded")} /> : null}
      </div>
      <div className="ft">
        <button className="btn btn-secondary" type="button" onClick={onClose}>
          {t("outsideDialogs.cancel")}
        </button>
        <button
          className="btn btn-primary"
          type="button"
          disabled={!date || !method || future || submit.state === "saving"}
          onClick={async () => {
            const a = await submit.run();
            if (a) onDone(a);
          }}
        >
          <Send className="ic" aria-hidden="true" />
          {submit.state === "saving" ? t("outsideDialogs.recording") : t("outsideDialogs.markAsSubmitted")}
        </button>
      </div>
    </Dialog>
  );
}

// ------------------------------------------------------------------------------------ decision

const OUTCOME_HELP: Record<DecisionOutcome, () => string> = {
  awarded: () => t("outsideDialogs.outcome.awarded"),
  declined: () => t("outsideDialogs.outcome.declined"),
  withdrawn: () => t("outsideDialogs.outcome.withdrawn"),
};

export function DecisionDialog({ app, onClose, onDone }: { app: OutsideApplication; onClose: () => void; onDone: (a: OutsideApplication) => void }) {
  const outcomes = decisionOutcomes(app.stage);
  const [outcome, setOutcome] = useState<DecisionOutcome>(outcomes[0] ?? "declined");
  const [amount, setAmount] = useState(app.askAmount ? String(Number(app.askAmount.amount)) : "");
  const [years, setYears] = useState<{ year: string; amount: string }[]>([]);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [notes, setNotes] = useState("");
  const [nextCycle, setNextCycle] = useState("");
  const decide = useOutsideMutation((api, input: DecisionInput) => api.decide(app.id, input));
  const money = moneyFrom(amount, app.currency);
  const byYear: YearAmount[] = years.flatMap((y) => {
    const minor = parseDollars(y.amount);
    const year = Number.parseInt(y.year, 10);
    return minor !== null && year > 1900 ? [{ year, amountMinor: minor }] : [];
  });
  const yearsTotal = byYear.reduce((s, y) => s + y.amountMinor, 0);
  const yearsMismatch = outcome === "awarded" && byYear.length > 0 && money && yearsTotal !== minorOf(money);
  const periodBad = !!start && !!end && end < start;
  const amountError = outcome === "awarded" && amount && !money ? t("outsideDialogs.badAmount") : null;
  const ready = outcome !== "awarded" || (!!money && !periodBad);
  const input = (): DecisionInput => ({
    outcome,
    ...(outcome === "awarded" && money ? { awardedAmount: money } : {}),
    ...(outcome === "awarded" && byYear.length ? { awardByYear: byYear } : {}),
    ...(outcome === "awarded" && start ? { grantStart: start } : {}),
    ...(outcome === "awarded" && end ? { grantEnd: end } : {}),
    ...(notes.trim() ? { notes: notes.trim() } : {}),
    ...(outcome === "declined" && nextCycle ? { nextCycleOn: nextCycle } : {}),
  });
  return (
    <Dialog open onClose={onClose} labelledBy="odec-title">
      <Head id="odec-title" title={t("outsideDialogs.recordTheDecision")} sub={`${app.title} · ${app.funderName}`} onClose={onClose} />
      <div className="bd">
        <fieldset style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "8px" }}>
          <legend className="lbl">{t("outsideDialogs.decision")}</legend>
          {outcomes.map((o) => (
            <label key={o} className="row" style={{ gap: "8px", alignItems: "flex-start", fontSize: "14px" }}>
              <input type="radio" name="odec-outcome" value={o} checked={outcome === o} onChange={() => setOutcome(o)} style={{ marginTop: "3px" }} />
              <span>
                <span className="b">{stageLabel(o)}</span>
                <span className="muted"> — {OUTCOME_HELP[o]()}</span>
              </span>
            </label>
          ))}
        </fieldset>
        {outcome === "awarded" && (
          <>
            <Field id="odec-amount" label={t("outsideDialogs.amountAwardedUsd")} required error={amountError ?? problemFor(decide.error, "awardedAmount")} help={app.askAmount ? t("outsideDialogs.youAskedFor", { amount: moneyText(app.askAmount) }) : undefined}>
              <input id="odec-amount" className="inp" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </Field>
            <div className="fld">
              <span className="lbl">{t("outsideDialogs.byYearOptional")}</span>
              {years.map((y, i) => (
                <div key={i} className="row" style={{ gap: "8px" }}>
                  <label className="sr" htmlFor={`odec-y-${i}`}>
                    {t("outsideDialogs.yearN", { n: i + 1 })}
                  </label>
                  <input id={`odec-y-${i}`} className="inp" inputMode="numeric" style={{ maxWidth: "100px" }} value={y.year} onChange={(e) => setYears(years.map((x, j) => (j === i ? { ...x, year: e.target.value } : x)))} />
                  <label className="sr" htmlFor={`odec-ya-${i}`}>
                    {t("outsideDialogs.amountForYear", { n: i + 1 })}
                  </label>
                  <input id={`odec-ya-${i}`} className="inp" inputMode="decimal" value={y.amount} onChange={(e) => setYears(years.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} />
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => setYears(years.filter((_, j) => j !== i))} aria-label={t("outsideDialogs.removeYear", { n: i + 1 })}>
                    {t("outsideDialogs.remove")}
                  </button>
                </div>
              ))}
              <button type="button" className="btn btn-sm btn-secondary" style={{ alignSelf: "flex-start" }} onClick={() => setYears([...years, { year: String(new Date().getUTCFullYear() + years.length), amount: "" }])}>
                {t("outsideDialogs.addAYear")}
              </button>
              {yearsMismatch && <span className="help">{t("outsideDialogs.yearsMismatch", { amount: moneyText({ amount: (yearsTotal / 100).toFixed(2), currency: app.currency }) })}</span>}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "12px" }}>
              <Field id="odec-start" label={t("outsideDialogs.grantStarts")}>
                <input id="odec-start" type="date" className="inp" value={start} onChange={(e) => setStart(e.target.value)} />
              </Field>
              <Field id="odec-end" label={t("outsideDialogs.grantEnds")} error={periodBad ? t("outsideDialogs.endBeforeStart") : null}>
                <input id="odec-end" type="date" className="inp" value={end} onChange={(e) => setEnd(e.target.value)} />
              </Field>
            </div>
          </>
        )}
        <Field id="odec-notes" label={outcome === "declined" ? t("outsideDialogs.whatTheFunderSaid") : t("outsideDialogs.notes")}>
          <textarea id="odec-notes" className="ta" style={{ minHeight: "64px" }} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        {outcome === "declined" && (
          <Field id="odec-next" label={t("outsideDialogs.whenToTryAgain")} help={t("outsideDialogs.theDateTheNextCycleOpens")}>
            <input id="odec-next" type="date" className="inp" value={nextCycle} onChange={(e) => setNextCycle(e.target.value)} />
          </Field>
        )}
        <p className="small muted">{t("outsideDialogs.theseAreYourOwnRecordsNothing")}</p>
        {decide.error ? <ErrorBanner error={decide.error} title={t("outsideDialogs.theDecisionWasNotRecorded")} /> : null}
      </div>
      <div className="ft">
        <button className="btn btn-secondary" type="button" onClick={onClose}>
          {t("outsideDialogs.cancel")}
        </button>
        <button
          className="btn btn-primary"
          type="button"
          disabled={!ready || decide.state === "saving"}
          onClick={async () => {
            const a = await decide.run(input());
            if (a) onDone(a);
          }}
        >
          {decide.state === "saving" ? t("outsideDialogs.recording") : t("outsideDialogs.recordOutcome", { outcome })}
        </button>
      </div>
    </Dialog>
  );
}

// ------------------------------------------------------------------------------------ consulting

/**
 * The answers exactly as the email carries them: numbered, "(no answer yet)" for an empty one, and
 * past 20,000 characters in all cut at the same character, with the cut marked and the questions
 * left out counted.
 */
export function SentAnswers({ answers }: { answers: { prompt: string; body: string }[] }) {
  const sent = answersAsSent(answers);
  return (
    <details>
      <summary className="small b">
        {sent.omitted ? t("outsideDialogs.sentSummaryOf", { count: sent.items.length, total: answers.length }) : t("outsideDialogs.sentSummary", { count: sent.items.length })}
        {sent.truncated ? `, ${t("outsideDialogs.cutAt", { max: CONSULTING_ANSWERS_MAX })}` : ""}
      </summary>
      <ol style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "8px", fontSize: "13px", maxHeight: "200px", overflow: "auto", listStyle: "none", padding: 0 }}>
        {sent.items.map((a) => (
          <li key={a.n}>
            <div className="b">
              {a.n}. {a.prompt}
            </div>
            {a.body && <div style={{ whiteSpace: "pre-wrap" }}>{a.body}</div>}
            {a.cut && (
              <div className="row small" role="note" style={{ gap: "6px", marginTop: "4px", color: "var(--s-warn-fg)", fontWeight: 700 }}>
                <Scissors className="ic ic-sm" aria-hidden="true" />
                {t("outsideDialogs.emailStops", { max: CONSULTING_ANSWERS_MAX })}
              </div>
            )}
          </li>
        ))}
      </ol>
      {sent.omitted > 0 && (
        <p className="small muted" style={{ marginTop: "6px" }}>
          {t("outsideDialogs.moreQuestions", { count: sent.omitted })}
        </p>
      )}
    </details>
  );
}

function PreviewView({ p }: { p: ConsultingPreview }) {
  const dates = (Object.keys(DEADLINE_LABELS) as (keyof typeof DEADLINE_LABELS)[]).filter((k) => p.deadlines[k]);
  return (
    <section aria-label={t("outsideDialogs.whatWillBeSent")} style={{ border: "1px solid var(--og-gray-200)", borderRadius: "8px", padding: "12px 14px", display: "flex", flexDirection: "column", gap: "8px", background: "var(--og-gray-50)" }}>
      <dl className="kv" style={{ fontSize: "14px", overflowWrap: "anywhere" }}>
        <dt>{t("outsideDialogs.to")}</dt>
        <dd>{p.to}</dd>
        <dt>{t("outsideDialogs.repliesGoTo")}</dt>
        <dd>{p.replyTo}</dd>
        <dt>{t("outsideDialogs.subject")}</dt>
        <dd>{p.subject}</dd>
        <dt>{t("outsideDialogs.organization")}</dt>
        <dd>{p.organization}</dd>
        <dt>{t("outsideDialogs.from")}</dt>
        <dd>
          {p.contactName} ({p.contactEmail})
        </dd>
        <dt>{t("outsideDialogs.application")}</dt>
        <dd>{p.title}</dd>
        <dt>{t("outsideDialogs.funder")}</dt>
        <dd>{p.funder}</dd>
        <dt>{t("outsideDialogs.stage")}</dt>
        <dd>{stageLabel(p.stage)}</dd>
        <dt>{t("outsideDialogs.deadlines")}</dt>
        <dd>{dates.length ? dates.map((k) => `${DEADLINE_LABELS[k]} ${formatDate(p.deadlines[k])}`).join(" · ") : p.deadlines.rolling ? t("outsideDialogs.rolling") : t("outsideDialogs.noneSet")}</dd>
        <dt>{t("outsideDialogs.ask")}</dt>
        <dd>{moneyText(p.ask)}</dd>
        {p.listingUrl && (
          <>
            <dt>{t("outsideDialogs.listing")}</dt>
            <dd style={{ overflowWrap: "anywhere" }}>{p.listingUrl}</dd>
          </>
        )}
        {p.portalUrl && (
          <>
            <dt>{t("outsideDialogs.portal")}</dt>
            <dd style={{ overflowWrap: "anywhere" }}>{p.portalUrl}</dd>
          </>
        )}
        <dt>{t("outsideDialogs.questions")}</dt>
        <dd>{p.questionCount}</dd>
        <dt>{t("outsideDialogs.message")}</dt>
        <dd style={{ whiteSpace: "pre-wrap" }}>{p.message ?? "—"}</dd>
      </dl>
      <p className="small">{t("outsideDialogs.theEmailSaysYourOrganizationWants")}</p>
      {p.answers ? <SentAnswers answers={p.answers} /> : <p className="small muted">{t("outsideDialogs.noAnswerTextIsSent")}</p>}
    </section>
  );
}

export function ConsultingDialog({ app, contact, onClose, onSent }: { app: OutsideDetail; contact: { name: string; email: string }; onClose: () => void; onSent: () => void }) {
  const [name, setName] = useState(contact.name);
  const [email, setEmail] = useState(contact.email);
  const [message, setMessage] = useState("");
  const [include, setInclude] = useState(false);
  const [preview, setPreview] = useState<ConsultingPreview | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const input = () => ({ contactName: name.trim(), contactEmail: email.trim(), ...(message.trim() ? { message: message.trim() } : {}), includeAnswers: include });
  const look = useOutsideMutation((api) => api.consultingPreview(app.id, input()));
  const send = useOutsideMutation((api) => api.sendConsulting(app.id, input()));
  const edit = (f: () => void) => {
    f();
    setPreview(null);
  };
  const hasAnswers = app.questions.some((q) => q.answer?.body.trim());
  return (
    <Dialog open onClose={onClose} labelledBy="ocon-title" size="lg">
      <Head id="ocon-title" title={t("outsideDialogs.getHelpWritingThis")} sub={t("outsideDialogs.consultingSub")} onClose={onClose} />
      {sentTo ? (
        <>
          <div className="bd">
            <Notice tone="ok" title={t("outsideDialogs.requestSent")}>
              {t("outsideDialogs.consultingSent", { email: sentTo })}
            </Notice>
          </div>
          <div className="ft">
            <button className="btn btn-primary" type="button" onClick={onClose}>
              {t("outsideDialogs.done")}
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="bd">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "12px" }}>
              <Field id="ocon-name" label={t("outsideDialogs.yourName")} required error={problemFor(look.error ?? send.error, "contactName")}>
                <input id="ocon-name" className="inp" autoComplete="name" value={name} onChange={(e) => edit(() => setName(e.target.value))} />
              </Field>
              <Field id="ocon-email" label={t("outsideDialogs.yourEmail")} required error={problemFor(look.error ?? send.error, "contactEmail")}>
                <input id="ocon-email" type="email" className="inp" autoComplete="email" value={email} onChange={(e) => edit(() => setEmail(e.target.value))} />
              </Field>
            </div>
            <Field id="ocon-msg" label={t("outsideDialogs.message")} help={t("outsideDialogs.whatWouldHelpMostAReview")}>
              <textarea id="ocon-msg" className="ta" style={{ minHeight: "72px" }} value={message} onChange={(e) => edit(() => setMessage(e.target.value))} />
            </Field>
            <label className="row" style={{ gap: "8px", fontSize: "14px", alignItems: "flex-start" }}>
              <input type="checkbox" checked={include} disabled={!hasAnswers} onChange={(e) => edit(() => setInclude(e.target.checked))} style={{ marginTop: "3px" }} />
              <span>
                {t("outsideDialogs.includeMyCurrentAnswers")}
                <span className="muted"> — {hasAnswers ? t("outsideDialogs.theLatestVersionOfEachUp") : t("outsideDialogs.thereAreNoAnswersYet")}</span>
              </span>
            </label>
            {preview ? <PreviewView p={preview} /> : <p className="small muted">{t("outsideDialogs.previewTheRequestToSeeExactly")}</p>}
            {look.error ? <ErrorBanner error={look.error} title={t("outsideDialogs.thePreviewCouldNotBeMade")} /> : null}
            {send.error ? <ErrorBanner error={send.error} title={t("outsideDialogs.theRequestWasNotSent")} /> : null}
          </div>
          <div className="ft">
            <button className="btn btn-secondary" type="button" onClick={onClose}>
              {t("outsideDialogs.cancel")}
            </button>
            {preview ? (
              <button
                className="btn btn-primary"
                type="button"
                disabled={send.state === "saving"}
                onClick={async () => {
                  const r = await send.run();
                  if (r) {
                    setSentTo(r.replyTo);
                    onSent();
                  }
                }}
              >
                <Send className="ic" aria-hidden="true" />
                {send.state === "saving" ? t("outsideDialogs.sending") : t("outsideDialogs.sendTheRequest")}
              </button>
            ) : (
              <button
                className="btn btn-primary"
                type="button"
                disabled={!name.trim() || !email.trim() || look.state === "saving"}
                onClick={async () => {
                  const p = await look.run();
                  if (p) setPreview(p);
                }}
              >
                {look.state === "saving" ? t("outsideDialogs.preparing") : t("outsideDialogs.previewWhatWillBeSent")}
              </button>
            )}
          </div>
        </>
      )}
    </Dialog>
  );
}
