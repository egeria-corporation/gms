// SPDX-License-Identifier: AGPL-3.0-only
// Payment pieces shared by the award's Payments tab, the Payments center and the dashboard: the
// hold banner, per-tranche readiness, and the release and record-external dialogs.
//
// Nothing here shows bank data beyond a bank name and the last four digits. Release is a human
// gate: the button stays disabled while any readiness line fails or is unknown.
import { useState } from "react";
import { Ban, Banknote, CalendarClock, CircleDashed, Lock, PenLine, RefreshCw, Send, TriangleExclamationPoint } from "lucide-react";
import { useApiMutation } from "../api/hooks.ts";
import type { PaymentBanner, Tranche, TrancheCondition, TrancheReadiness } from "../api/funderMoney.ts";
import type { Checklist } from "../api/types.ts";
import { formatDate, formatMinor } from "../lib/format.ts";
import { Dialog } from "./Dialog.tsx";
import { ErrorBanner, Field, ReadinessChecklist } from "./ui.tsx";

import { translator } from "../i18n/index.tsx";

const tr = translator("shared");
const CAUSE_ICON: Record<string, typeof Lock> = {
  pending_destination_change: Lock,
  freeze_window: CalendarClock,
  level_below_l3: TriangleExclamationPoint,
  agreement_not_executed: PenLine,
  passport_unavailable: RefreshCw,
  passport_not_linked: CircleDashed,
};
const TONE_CLASS = { warn: "bnr-warn", danger: "bnr-dng", neutral: "bnr-neu" } as const;

/**
 * Why money is blocked. Always three parts: what is blocked, why, and what clears it (a date or
 * an action).
 */
export function HoldBanner({ banner, action }: { banner: PaymentBanner; action?: React.ReactNode }) {
  const Icon = CAUSE_ICON[banner.cause] ?? Lock;
  return (
    <div className={`bnr ${TONE_CLASS[banner.tone]}`} role="status" data-cause={banner.cause}>
      <Icon className="ic" aria-hidden="true" />
      <div>
        <div className="t">{banner.title}</div>
        <div className="d">{banner.detail}</div>
        <div className="clears">
          <CalendarClock className="ic" aria-hidden="true" />
          {banner.clears}
        </div>
      </div>
      {action && <div className="act">{action}</div>}
    </div>
  );
}

/** The Worker's readiness answer in the shape the shared checklist renders. */
export function checklistOf(r: Pick<TrancheReadiness, "checks" | "passed" | "failed" | "unknown" | "releasable">): Checklist {
  return { ready: r.releasable, summary: { pass: r.passed, fail: r.failed, unknown: r.unknown }, items: r.checks.map((c) => ({ key: c.key, state: c.state, label: c.label, reason: c.reason, fixHref: c.fixHref ?? null })) };
}

export function conditionLabel(condition: Tranche["condition"], requirementTitle?: (id: string) => string | undefined): string {
  const c = condition as TrancheCondition;
  switch (c.type) {
    case "onExecution":
      return tr("payments.onAgreementExecution");
    case "onReportAccepted":
      return requirementTitle?.(c.requirementId) ? tr("payments.whenIsAccepted", { report: requirementTitle(c.requirementId)! }) : tr("payments.whenTheReportIsAccepted");
    case "onDate":
      return tr("payments.on", { date: formatDate(c.date) });
    case "manual":
      return tr("payments.releasedManually");
    default:
      return "—";
  }
}

/** Bank name and last four digits only. */
export function destinationLabel(d: TrancheReadiness["destination"]): string {
  if (!d || (!d.bankName && !d.last4)) return tr("payments.notAvailable");
  return `${d.bankName ?? "Bank"} •••• ${d.last4 ?? "····"}`;
}

/** Why the release button is disabled, in words, or null when it can be pressed. */
export function releaseBlockedReason(r: Pick<TrancheReadiness, "releasable" | "failed" | "unknown">): string | null {
  if (r.releasable) return null;
  if (r.failed > 0) return tr("payments.checksNeedFixing", { count: r.failed });
  if (r.unknown > 0) return tr("payments.readinessIsUnknownUntilPassport");
  return tr("payments.thisTrancheIsNotDue");
}

export function ReleaseDialog({ readiness, awardTitle, recipientName, onClose, onDone }: { readiness: TrancheReadiness; awardTitle: string; recipientName: string; onClose: () => void; onDone: () => void }) {
  const t = readiness.tranche;
  const [rail, setRail] = useState<"auto" | "standard" | "instant">("auto");
  const [confirm, setConfirm] = useState(false);
  const release = useApiMutation((api) => api.releaseTranche(t.id, { rail }));
  const blocked = releaseBlockedReason(readiness);
  return (
    <Dialog open onClose={onClose} labelledBy="release-title" size="lg">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (await release.run()) onDone();
        }}
      >
        <div className="hd">
          <div>
            <h2 id="release-title">{tr("payments.releaseTranche", { seq: t.seq })}</h2>
            <p className="small muted">
              {recipientName} · {awardTitle}
            </p>
          </div>
        </div>
        <div className="bd">
          {release.error !== null && <ErrorBanner error={release.error} title={tr("payments.nothingWasReleased")} />}
          <dl className="kv">
            <dt>{tr("payments.amount")}</dt>
            <dd className="b">{formatMinor(t.amountMinor, t.currency)}</dd>
            <dt>{tr("payments.destination")}</dt>
            <dd className="userback-block">{destinationLabel(readiness.destination)}</dd>
            <dt>{tr("payments.paidThrough")}</dt>
            <dd>{tr("payments.opengrantsPassportFeesPaidBy")}</dd>
          </dl>
          <Field id="release-rail" label={tr("payments.rail")} help={tr("payments.autoLetsPassportChooseInstant")}>
            <select className="sel" id="release-rail" value={rail} onChange={(e) => setRail(e.target.value as typeof rail)} style={{ maxWidth: "240px" }}>
              <option value="auto">{tr("payments.auto")}</option>
              <option value="standard">{tr("payments.standard")}</option>
              <option value="instant">{tr("payments.instant")}</option>
            </select>
          </Field>
          {readiness.banner && <HoldBanner banner={readiness.banner} />}
          <ReadinessChecklist checklist={checklistOf(readiness)} title={tr("payments.readiness")} />
          <label className="cb">
            <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} disabled={blocked !== null} />
            <span>
              {tr("payments.iConfirmTheReleaseOf", { amountMinor: formatMinor(t.amountMinor, t.currency), recipientName })}
            </span>
          </label>
          <p className="help">{tr("payments.releasingIsAHumanGate")}</p>
        </div>
        <div className="ft">
          {blocked && (
            <span className="err-msg" style={{ marginRight: "auto" }}>
              <Ban className="ic" aria-hidden="true" />
              {blocked}
            </span>
          )}
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {tr("payments.cancel")}
          </button>
          <button type="submit" className="btn btn-primary" disabled={blocked !== null || !confirm || release.state === "saving"}>
            <Send className="ic" aria-hidden="true" />
            {tr("payments.release", { amountMinor: formatMinor(t.amountMinor, t.currency) })}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function RecordExternalDialog({ tranche, recipientName, onClose, onDone }: { tranche: Tranche; recipientName: string; onClose: () => void; onDone: (unverified: boolean) => void }) {
  const [reference, setReference] = useState("");
  const [paidAt, setPaidAt] = useState("");
  const [last4, setLast4] = useState("");
  const record = useApiMutation((api) => api.recordExternalPayment(tranche.id, { reference: reference.trim(), paidAt, destinationLast4: last4 }));
  const valid = reference.trim() !== "" && /^\d{4}-\d{2}-\d{2}$/.test(paidAt) && /^\d{4}$/.test(last4);
  return (
    <Dialog open onClose={onClose} labelledBy="external-title">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const out = await record.run();
          if (out) onDone(out.result === "unverified");
        }}
      >
        <div className="hd">
          <div>
            <h2 id="external-title">{tr("payments.recordAPaymentMadeOutside")}</h2>
            <p className="small muted">
              {tr("payments.tranche", { recipientName, seq: tranche.seq, amountMinor: formatMinor(tranche.amountMinor, tranche.currency) })}
            </p>
          </div>
        </div>
        <div className="bd">
          {record.error !== null && <ErrorBanner error={record.error} />}
          <Field id="external-ref" label={tr("payments.paymentReference")} required help={tr("payments.theWireCheckOrTransfer")}>
            <input className="inp" id="external-ref" value={reference} onChange={(e) => setReference(e.target.value)} required />
          </Field>
          <div className="fld-row">
            <Field id="external-date" label={tr("payments.datePaid")} required>
              <input className="inp" id="external-date" type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} required />
            </Field>
            <Field id="external-last4" label={tr("payments.destinationLastFourDigits")} required help={tr("payments.passportChecksTheseAgainstThe")}>
              <input className="inp userback-block" id="external-last4" inputMode="numeric" maxLength={4} pattern="[0-9]{4}" value={last4} onChange={(e) => setLast4(e.target.value.replace(/\D/g, "").slice(0, 4))} required />
            </Field>
          </div>
        </div>
        <div className="ft">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {tr("payments.cancel")}
          </button>
          <button type="submit" className="btn btn-primary" disabled={!valid || record.state === "saving"}>
            <Banknote className="ic" aria-hidden="true" />
            {tr("payments.recordPayment")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

/** A reason prompt used for hold, cancel, waive and return. */
export function ReasonDialog({ title, label, action, danger = false, onClose, onSubmit }: { title: string; label: string; action: string; danger?: boolean; onClose: () => void; onSubmit: (reason: string) => Promise<unknown> }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  return (
    <Dialog open onClose={onClose} labelledBy="reason-title">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await onSubmit(reason.trim());
          } catch (err) {
            setError(err);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="hd">
          <h2 id="reason-title">{title}</h2>
        </div>
        <div className="bd">
          {error !== null && <ErrorBanner error={error} />}
          <Field id="reason-text" label={label} required>
            <textarea className="ta" id="reason-text" value={reason} onChange={(e) => setReason(e.target.value)} required />
          </Field>
        </div>
        <div className="ft">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {tr("payments.cancel")}
          </button>
          <button type="submit" className={danger ? "btn btn-danger" : "btn btn-primary"} disabled={!reason.trim() || busy}>
            {action}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
