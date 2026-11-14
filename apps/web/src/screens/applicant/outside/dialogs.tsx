// SPDX-License-Identifier: AGPL-3.0-only
// The three things only a person records for an outside application: that they submitted it on
// the funder's site, what the funder decided, and a request for consulting help from OpenGrants.
import { useState } from "react";
import { CircleCheck, Send, X } from "lucide-react";
import type { ConsultingPreview, DecisionInput, OutsideApplication, OutsideDetail, SubmissionMethod, YearAmount } from "../../../api/outside.ts";
import { minorOf } from "../../../api/outside.ts";
import { useOutsideMutation } from "../../../api/outsideHooks.ts";
import { Dialog } from "../../../components/Dialog.tsx";
import { ErrorBanner, Field, Notice, problemFor } from "../../../components/ui.tsx";
import { formatDate, parseDollars } from "../../../lib/format.ts";
import { decisionOutcomes, STAGE_LABELS, type DecisionOutcome } from "../../../lib/outside.ts";
import { useUpload } from "./ChecklistTab.tsx";
import { DEADLINE_LABELS, METHOD_LABELS, moneyFrom, moneyText } from "./shared.tsx";

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
      <Head id="osub-title" title="Mark as submitted" sub="Record the submission you made on the funder’s site. The GMS never submits anything for you." onClose={onClose} />
      <div className="bd">
        <Field id="osub-date" label="Date you submitted" required error={future ? "The date cannot be in the future" : problemFor(submit.error, "submittedAt")}>
          <input id="osub-date" type="date" className="inp" max={today()} value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field id="osub-method" label="How you submitted" required error={problemFor(submit.error, "method")}>
          <select id="osub-method" className="sel" value={method} onChange={(e) => setMethod(e.target.value as SubmissionMethod)}>
            <option value="" disabled>
              Choose one
            </option>
            {(Object.keys(METHOD_LABELS) as SubmissionMethod[]).map((m) => (
              <option key={m} value={m}>
                {METHOD_LABELS[m]}
              </option>
            ))}
          </select>
        </Field>
        <Field id="osub-conf" label="Confirmation number" help="If the funder gave you one.">
          <input id="osub-conf" className="inp" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} />
        </Field>
        <div className="fld">
          <span className="lbl">Receipt</span>
          {receipt ? (
            <span className="row" style={{ gap: "6px" }}>
              <CircleCheck className="ic" aria-hidden="true" style={{ color: "var(--s-ok-fg)" }} />
              {receipt.name}
            </span>
          ) : (
            <label className="btn btn-sm btn-secondary" style={{ alignSelf: "flex-start", cursor: "pointer" }}>
              {upload.state === "saving" ? "Uploading…" : "Upload the receipt or confirmation email"}
              <input
                type="file"
                className="sr"
                aria-label="Upload the receipt"
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
        <p className="small muted">A PDF of every question and its latest answer is kept “as submitted”, with a fingerprint so you can show later what was sent.</p>
        {upload.error ? <ErrorBanner error={upload.error} title="The receipt was not uploaded" /> : null}
        {submit.error ? <ErrorBanner error={submit.error} title="The submission was not recorded" /> : null}
      </div>
      <div className="ft">
        <button className="btn btn-secondary" type="button" onClick={onClose}>
          Cancel
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
          {submit.state === "saving" ? "Recording…" : "Mark as submitted"}
        </button>
      </div>
    </Dialog>
  );
}

// ------------------------------------------------------------------------------------ decision

const OUTCOME_HELP: Record<DecisionOutcome, string> = {
  awarded: "The funder is making a grant.",
  declined: "The funder said no this time.",
  withdrawn: "You took the application back.",
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
  const amountError = outcome === "awarded" && amount && !money ? "Enter the amount in dollars, such as 50000" : null;
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
      <Head id="odec-title" title="Record the decision" sub={`${app.title} · ${app.funderName}`} onClose={onClose} />
      <div className="bd">
        <fieldset style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "8px" }}>
          <legend className="lbl">Decision</legend>
          {outcomes.map((o) => (
            <label key={o} className="row" style={{ gap: "8px", alignItems: "flex-start", fontSize: "14px" }}>
              <input type="radio" name="odec-outcome" value={o} checked={outcome === o} onChange={() => setOutcome(o)} style={{ marginTop: "3px" }} />
              <span>
                <span className="b">{STAGE_LABELS[o]}</span>
                <span className="muted"> — {OUTCOME_HELP[o]}</span>
              </span>
            </label>
          ))}
        </fieldset>
        {outcome === "awarded" && (
          <>
            <Field id="odec-amount" label="Amount awarded (USD)" required error={amountError ?? problemFor(decide.error, "awardedAmount")} help={app.askAmount ? `You asked for ${moneyText(app.askAmount)}.` : undefined}>
              <input id="odec-amount" className="inp" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </Field>
            <div className="fld">
              <span className="lbl">By year (optional)</span>
              {years.map((y, i) => (
                <div key={i} className="row" style={{ gap: "8px" }}>
                  <label className="sr" htmlFor={`odec-y-${i}`}>
                    Year {i + 1}
                  </label>
                  <input id={`odec-y-${i}`} className="inp" inputMode="numeric" style={{ maxWidth: "100px" }} value={y.year} onChange={(e) => setYears(years.map((x, j) => (j === i ? { ...x, year: e.target.value } : x)))} />
                  <label className="sr" htmlFor={`odec-ya-${i}`}>
                    Amount for year {i + 1}
                  </label>
                  <input id={`odec-ya-${i}`} className="inp" inputMode="decimal" value={y.amount} onChange={(e) => setYears(years.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} />
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => setYears(years.filter((_, j) => j !== i))} aria-label={`Remove year ${i + 1}`}>
                    Remove
                  </button>
                </div>
              ))}
              <button type="button" className="btn btn-sm btn-secondary" style={{ alignSelf: "flex-start" }} onClick={() => setYears([...years, { year: String(new Date().getUTCFullYear() + years.length), amount: "" }])}>
                Add a year
              </button>
              {yearsMismatch && <span className="help">The years add up to {moneyText({ amount: (yearsTotal / 100).toFixed(2), currency: app.currency })}, not the amount awarded.</span>}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "12px" }}>
              <Field id="odec-start" label="Grant starts">
                <input id="odec-start" type="date" className="inp" value={start} onChange={(e) => setStart(e.target.value)} />
              </Field>
              <Field id="odec-end" label="Grant ends" error={periodBad ? "The end comes before the start" : null}>
                <input id="odec-end" type="date" className="inp" value={end} onChange={(e) => setEnd(e.target.value)} />
              </Field>
            </div>
          </>
        )}
        <Field id="odec-notes" label={outcome === "declined" ? "What the funder said" : "Notes"}>
          <textarea id="odec-notes" className="ta" style={{ minHeight: "64px" }} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        {outcome === "declined" && (
          <Field id="odec-next" label="When to try again" help="The date the next cycle opens, if you know it.">
            <input id="odec-next" type="date" className="inp" value={nextCycle} onChange={(e) => setNextCycle(e.target.value)} />
          </Field>
        )}
        <p className="small muted">These are your own records. Nothing here moves money or tells the funder anything.</p>
        {decide.error ? <ErrorBanner error={decide.error} title="The decision was not recorded" /> : null}
      </div>
      <div className="ft">
        <button className="btn btn-secondary" type="button" onClick={onClose}>
          Cancel
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
          {decide.state === "saving" ? "Recording…" : `Record ${STAGE_LABELS[outcome].toLowerCase()}`}
        </button>
      </div>
    </Dialog>
  );
}

// ------------------------------------------------------------------------------------ consulting

function PreviewView({ p }: { p: ConsultingPreview }) {
  const dates = (Object.keys(DEADLINE_LABELS) as (keyof typeof DEADLINE_LABELS)[]).filter((k) => p.deadlines[k]);
  return (
    <section aria-label="What will be sent" style={{ border: "1px solid var(--og-gray-200)", borderRadius: "8px", padding: "12px 14px", display: "flex", flexDirection: "column", gap: "8px", background: "var(--og-gray-50)" }}>
      <dl className="kv" style={{ fontSize: "14px", overflowWrap: "anywhere" }}>
        <dt>To</dt>
        <dd>{p.to}</dd>
        <dt>Replies go to</dt>
        <dd>{p.replyTo}</dd>
        <dt>Subject</dt>
        <dd>{p.subject}</dd>
        <dt>Organization</dt>
        <dd>{p.organization}</dd>
        <dt>From</dt>
        <dd>
          {p.contactName} ({p.contactEmail})
        </dd>
        <dt>Application</dt>
        <dd>{p.title}</dd>
        <dt>Funder</dt>
        <dd>{p.funder}</dd>
        <dt>Stage</dt>
        <dd>{STAGE_LABELS[p.stage]}</dd>
        <dt>Deadlines</dt>
        <dd>{dates.length ? dates.map((k) => `${DEADLINE_LABELS[k]} ${formatDate(p.deadlines[k])}`).join(" · ") : p.deadlines.rolling ? "Rolling" : "None set"}</dd>
        <dt>Ask</dt>
        <dd>{moneyText(p.ask)}</dd>
        {p.listingUrl && (
          <>
            <dt>Listing</dt>
            <dd style={{ overflowWrap: "anywhere" }}>{p.listingUrl}</dd>
          </>
        )}
        {p.portalUrl && (
          <>
            <dt>Portal</dt>
            <dd style={{ overflowWrap: "anywhere" }}>{p.portalUrl}</dd>
          </>
        )}
        <dt>Questions</dt>
        <dd>{p.questionCount}</dd>
        <dt>Message</dt>
        <dd style={{ whiteSpace: "pre-wrap" }}>{p.message ?? "—"}</dd>
      </dl>
      <p className="small">The email says your organization wants consulting support to start right away.</p>
      {p.answers ? (
        <details>
          <summary className="small b">Your current answers ({p.answers.length}){p.answersTruncated ? ", shortened to 20,000 characters" : ""}</summary>
          <ol style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "8px", fontSize: "13px", maxHeight: "200px", overflow: "auto" }}>
            {p.answers.map((a, i) => (
              <li key={i}>
                <div className="b">{a.prompt}</div>
                <div style={{ whiteSpace: "pre-wrap" }}>{a.body}</div>
              </li>
            ))}
          </ol>
        </details>
      ) : (
        <p className="small muted">No answer text is sent.</p>
      )}
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
      <Head id="ocon-title" title="Get help writing this" sub="Ask OpenGrants consulting to help with this application. You see exactly what is sent before it goes." onClose={onClose} />
      {sentTo ? (
        <>
          <div className="bd">
            <Notice tone="ok" title="Request sent">
              OpenGrants consulting can start right away. The team will reply to {sentTo}.
            </Notice>
          </div>
          <div className="ft">
            <button className="btn btn-primary" type="button" onClick={onClose}>
              Done
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="bd">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "12px" }}>
              <Field id="ocon-name" label="Your name" required error={problemFor(look.error ?? send.error, "contactName")}>
                <input id="ocon-name" className="inp" autoComplete="name" value={name} onChange={(e) => edit(() => setName(e.target.value))} />
              </Field>
              <Field id="ocon-email" label="Your email" required error={problemFor(look.error ?? send.error, "contactEmail")}>
                <input id="ocon-email" type="email" className="inp" autoComplete="email" value={email} onChange={(e) => edit(() => setEmail(e.target.value))} />
              </Field>
            </div>
            <Field id="ocon-msg" label="Message" help="What would help most: a review, a rewrite to fit the limits, a budget narrative…">
              <textarea id="ocon-msg" className="ta" style={{ minHeight: "72px" }} value={message} onChange={(e) => edit(() => setMessage(e.target.value))} />
            </Field>
            <label className="row" style={{ gap: "8px", fontSize: "14px", alignItems: "flex-start" }}>
              <input type="checkbox" checked={include} disabled={!hasAnswers} onChange={(e) => edit(() => setInclude(e.target.checked))} style={{ marginTop: "3px" }} />
              <span>
                Include my current answers
                <span className="muted"> — {hasAnswers ? "the latest version of each, up to 20,000 characters in all" : "there are no answers yet"}</span>
              </span>
            </label>
            {preview ? <PreviewView p={preview} /> : <p className="small muted">Preview the request to see exactly what will be sent.</p>}
            {look.error ? <ErrorBanner error={look.error} title="The preview could not be made" /> : null}
            {send.error ? <ErrorBanner error={send.error} title="The request was not sent" /> : null}
          </div>
          <div className="ft">
            <button className="btn btn-secondary" type="button" onClick={onClose}>
              Cancel
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
                {send.state === "saving" ? "Sending…" : "Send the request"}
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
                {look.state === "saving" ? "Preparing…" : "Preview what will be sent"}
              </button>
            )}
          </div>
        </>
      )}
    </Dialog>
  );
}
