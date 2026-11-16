// SPDX-License-Identifier: AGPL-3.0-only
// One grant as the grantee sees it: the award, its payment schedule, where payments go, the budget
// and amendments. The desktop screen (GrantPayments.tsx) and the phone layout
// (phone/GrantPhone.tsx) both read through `useGrant` and share the pieces below.
import { useState } from "react";
import { Link } from "react-router";
import { Check, Clock, ExternalLink, Landmark, Lock, Send } from "lucide-react";
import type { ApplicantApi, Award, AwardDetail } from "../../api/applicant.ts";
import { useApplicantApi } from "../../api/applicantHooks.ts";
import { holdExplanation, type AmendmentInput, type ApplicantMoreApi, type BudgetBook, type MyRequirement, type PayeeSummary, type ScheduleTranche } from "../../api/applicantMore.ts";
import { describeDestination, type ApplicantFullApi, type PayoutDestination } from "../../api/applicantFull.ts";
import { useFullApi } from "../../api/applicantFullHooks.ts";
import { useMoreMutation, useMoreQuery } from "../../api/applicantMoreHooks.ts";
import type { Query } from "../../api/hooks.ts";
import { LevelBadge } from "../../components/status.tsx";
import { ErrorBanner, Field, SaveNote } from "../../components/ui.tsx";
import { formatDate, formatMinor, parseDollars } from "../../lib/format.ts";
import { t } from "./i18n.ts";

export interface GrantData {
  awards: Award[];
  award: AwardDetail;
  schedule: ScheduleTranche[];
  payee: PayeeSummary;
  /** The destination as Passport reports it right now; null when it could not be asked. */
  destination: PayoutDestination | null;
  budget: BudgetBook;
  requirements: MyRequirement[];
}

/** Folds the live destination into the payee summary the screens already read. */
export function withDestination(payee: PayeeSummary, d: PayoutDestination | null): PayeeSummary {
  if (!d || d.state === "not_shared" || d.state === "not_linked") return d?.manageUrl ? { ...payee, manageUrl: payee.manageUrl ?? d.manageUrl } : payee;
  // A pending change either source knows about wins: it is the state that pauses payments.
  const status: PayeeSummary["status"] = d.state === "unknown" ? "unknown" : d.state === "none" ? "none" : d.pendingChange || payee.status === "pending_change" ? "pending_change" : "active";
  return { status, level: d.level ?? payee.level, bankName: d.bankName, last4: d.last4, manageUrl: d.manageUrl ?? payee.manageUrl };
}

async function loadGrant(api: ApplicantApi, more: ApplicantMoreApi, full: ApplicantFullApi, awardId: string | undefined): Promise<GrantData | null> {
  const awards = await api.awards();
  const id = awardId ?? awards.find((a) => a.status === "active")?.id ?? awards[0]?.id;
  if (!id) return null;
  // The destination is read live from Passport; a failure there must not hide the grant.
  const [award, schedule, payee, budget, requirements, destination] = await Promise.all([api.award(id), more.schedule(id), more.payee(), more.budget(id), more.requirements(), full.payoutDestination(id).catch(() => null)]);
  return { awards, award, schedule, payee: withDestination(payee, destination), destination, budget, requirements: requirements.filter((r) => r.awardId === award.id) };
}

export function useGrant(awardId: string | undefined, workspaceId: string): Query<GrantData | null> {
  const api = useApplicantApi();
  const full = useFullApi();
  return useMoreQuery((more) => loadGrant(api, more, full, awardId), [awardId, workspaceId, api, full]);
}

// ------------------------------------------------------------------------------------ derived

export const SETTLED: readonly string[] = ["settled"];
export const IN_FLIGHT: readonly string[] = ["releasing", "initiated"];

export function periodOf(keyDates: Record<string, unknown>): { start: string; end: string } | null {
  const p = keyDates.periodOfPerformance as { startDate?: string; endDate?: string } | undefined;
  return p?.startDate && p.endDate ? { start: p.startDate, end: p.endDate } : null;
}

/** Share of the grant period that has passed, 0–100. */
export function periodProgress(keyDates: Record<string, unknown>, now: Date = new Date()): number | null {
  const p = periodOf(keyDates);
  if (!p) return null;
  const start = Date.parse(`${p.start}T00:00:00Z`);
  const end = Date.parse(`${p.end}T00:00:00Z`);
  if (!(end > start)) return null;
  return Math.round(Math.min(1, Math.max(0, (now.getTime() - start) / (end - start))) * 100);
}

export function totals(d: GrantData) {
  const settled = d.schedule.filter((t) => SETTLED.includes(t.status));
  const received = d.award.disbursedAmountMinor ?? settled.reduce((s, t) => s + t.amountMinor, 0);
  const awarded = d.award.awardedAmountMinor ?? 0;
  const next = d.schedule.find((t) => !SETTLED.includes(t.status) && t.status !== "cancelled") ?? null;
  return { awarded, received, remaining: Math.max(0, awarded - received), settledCount: settled.length, next };
}

/** "On execution of the agreement", "When the interim report is accepted", … */
export function conditionText(tr: ScheduleTranche, requirements: MyRequirement[]): string {
  const req = requirements.find((r) => r.releasesTrancheId === tr.id);
  switch (tr.condition.type) {
    case "onExecution":
      return t("grant.condition.onExecution");
    case "onReportAccepted":
      return req ? t("grant.condition.whenAccepted", { report: req.title.toLowerCase() }) : t("grant.condition.whenAReport");
    case "onDate":
      return tr.condition.date ? t("grant.condition.onDate", { date: formatDate(tr.condition.date) }) : t("grant.condition.onASetDate");
    default:
      return t("grant.condition.manual");
  }
}

/** When the grantee can expect the money, in words; never a promise the funder did not make. */
export function expectedText(tr: ScheduleTranche, requirements: MyRequirement[]): string {
  if (tr.status === "settled") return t("grant.expected.settled", { date: formatDate(tr.releasedAt ?? tr.dueAt) });
  if (IN_FLIGHT.includes(tr.status)) return t("grant.expected.sent", { date: formatDate(tr.releasedAt) });
  if (tr.status === "held") return t("grant.expected.paused");
  if (tr.status === "cancelled") return "—";
  if (tr.status === "failed" || tr.status === "returned") return t("grant.expected.retry");
  const req = requirements.find((r) => r.releasesTrancheId === tr.id);
  if (tr.condition.type === "onReportAccepted" && req?.dueAt) return t("grant.expected.after", { date: formatDate(req.dueAt) });
  if (tr.dueAt) return formatDate(tr.dueAt);
  if (tr.condition.type === "onExecution") return t("grant.expected.afterExecuted");
  return t("grant.expected.notScheduled");
}

/** Why a payment is paused and what clears it, in the page's language (api/applicantMore.ts names the cause). */
export function holdText(reason: string | null | undefined): { cause: string; why: string; clears: string } {
  const { cause } = holdExplanation(reason);
  switch (cause) {
    case "destination_change":
      return { cause, why: t("grant.hold.destinationWhy"), clears: t("grant.hold.destinationClears") };
    case "freeze_window":
      return { cause, why: t("grant.hold.freezeWhy"), clears: t("grant.hold.freezeClears") };
    case "level_below_l3":
      return { cause, why: t("grant.hold.levelWhy"), clears: t("grant.hold.levelClears") };
    case "agreement_not_executed":
      return { cause, why: t("grant.hold.agreementWhy"), clears: t("grant.hold.agreementClears") };
    case "organization_inactive":
      return { cause, why: t("grant.hold.inactiveWhy"), clears: t("grant.hold.inactiveClears") };
    case "passport_unavailable":
      return { cause, why: t("grant.hold.passportWhy"), clears: t("grant.hold.passportClears") };
    default:
      return { cause, why: reason ? reason.replace(/_/g, " ") : t("grant.hold.heldWhy"), clears: t("grant.hold.heldClears") };
  }
}

/** Where payments go, said in the page's language (api/applicantFull.ts decides the state). */
function destinationText(d: PayoutDestination): { title: string; detail: string; tone: "ok" | "warn" | "neu" | "info" } {
  const { tone } = describeDestination(d);
  switch (d.state) {
    case "ok":
      return d.pendingChange
        ? { title: t("grant.dest.pendingTitle"), detail: d.freezeUntil ? t("grant.dest.pendingUntil", { date: formatDate(d.freezeUntil.slice(0, 10)) }) : t("grant.dest.pendingDetail"), tone }
        : { title: t("grant.dest.activeTitle"), detail: t("grant.dest.activeDetail"), tone };
    case "none":
      return { title: t("grant.dest.noneTitle"), detail: t("grant.dest.noneDetail"), tone };
    case "not_linked":
      return { title: t("grant.dest.notLinkedTitle"), detail: t("grant.dest.notLinkedDetail"), tone };
    case "not_shared":
      return { title: t("grant.dest.notSharedTitle"), detail: t("grant.dest.notSharedDetail"), tone };
    default:
      return { title: t("grant.dest.unreachableTitle"), detail: t("grant.dest.unreachableDetail"), tone };
  }
}

/** The first payment that is paused, with the three things the grantee needs to know about it. */
export function holdOf(d: GrantData): { tranche: ScheduleTranche | null; cause: string; why: string; clears: string } | null {
  const held = d.schedule.find((t) => t.status === "held");
  if (held) return { tranche: held, ...holdText(held.holdReason) };
  if (d.payee.status === "pending_change") return { tranche: null, ...holdText("destination_change_pending") };
  return null;
}

const mask = (payee: PayeeSummary) => (payee.bankName && payee.last4 ? `${payee.bankName} •••• ${payee.last4}` : payee.bankName ?? null);

// ------------------------------------------------------------------------------------ pieces

/** What is blocked, why, and what clears it. Shown wherever a payment is paused. */
export function HoldBanner({ data }: { data: GrantData }) {
  const hold = holdOf(data);
  if (!hold) return null;
  const what = hold.tranche ? t("grant.tranchePaused", { seq: hold.tranche.seq, amount: formatMinor(hold.tranche.amountMinor, hold.tranche.currency) }) : t("grant.paymentsPaused");
  return (
    <div className={`bnr bnr-warn${data.payee.status === "pending_change" ? " userback-block" : ""}`} role="status">
      <Lock className="ic" aria-hidden="true" />
      <div>
        <div className="t">{what}</div>
        <div className="d">{hold.why}</div>
        <div className="clears">
          <Clock className="ic" aria-hidden="true" />
          {hold.clears}
        </div>
      </div>
      {data.payee.manageUrl && (
        <a href={data.payee.manageUrl} className="btn btn-secondary btn-sm act">
          {t("grant.openPassport")}
        </a>
      )}
    </div>
  );
}

const PAYEE_CHIP = {
  active: { cls: "pay-active", get text() { return t("grant.payee.active"); } },
  pending_change: { cls: "pay-pending", get text() { return t("grant.payee.pending"); } },
  none: { cls: "pay-none", get text() { return t("grant.payee.none"); } },
  unknown: { cls: "pay-none", get text() { return t("grant.payee.unknown"); } },
};

export function PayeeChip({ payee }: { payee: PayeeSummary }) {
  const chip = PAYEE_CHIP[payee.status];
  return (
    <span className={`pay ${chip.cls} userback-block`}>
      {payee.status === "active" ? <Check className="ic" aria-hidden="true" /> : <Clock className="ic" aria-hidden="true" />}
      {chip.text}
    </span>
  );
}

/** Bank name and last four at most; the destination itself is managed in Passport. */
export function DestinationCard({ payee, destination = null, orgHref }: { payee: PayeeSummary; destination?: PayoutDestination | null; orgHref: string }) {
  const said = destination && destination.state !== "ok" ? destinationText(destination) : null;
  return (
    <div className="card userback-block">
      <div className="card-h">
        <h3>{t("grant.paymentDestination")}</h3>
        <PayeeChip payee={payee} />
      </div>
      <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <div className="row" style={{ gap: "12px" }}>
          <span style={{ width: "44px", height: "44px", borderRadius: "10px", background: "var(--og-teal-soft)", color: "var(--og-teal-dark)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
            <Landmark className="ic ic-md" aria-hidden="true" />
          </span>
          <div>
            <div className="b">{mask(payee) ?? (payee.status === "active" ? t("grant.verifiedDestinationOnFileInPassport") : t("grant.noVerifiedDestination"))}</div>
            <div className="small muted">
              {payee.status === "active" ? t("grant.verifiedInPassport") : payee.status === "unknown" ? t("grant.passportCouldNotBeReached") : t("grant.verifyAPayoutDestinationInPassport")} · <LevelBadge level={payee.level} />
            </div>
          </div>
        </div>
        {said ? (
          <div className={`bnr bnr-${said.tone}`} style={{ padding: "10px 12px" }} role="status">
            <Lock className="ic" aria-hidden="true" />
            <div>
              <div className="t" style={{ fontSize: "14px" }}>
                {said.title}
              </div>
              <div className="d" style={{ fontSize: "13px" }}>
                {said.detail}
              </div>
            </div>
          </div>
        ) : null}
        <div className="bnr bnr-neu" style={{ padding: "10px 12px" }}>
          <Clock className="ic" aria-hidden="true" />
          <div>
            <div className="t" style={{ fontSize: "14px" }}>
              {t("grant.expectingAPayment")}
            </div>
            <div className="d" style={{ fontSize: "13px" }}>
              {t("grant.changesToYourBankAccountTake")}
            </div>
          </div>
        </div>
        {payee.manageUrl ? (
          <a href={payee.manageUrl} className="btn btn-secondary" style={{ alignSelf: "flex-start" }}>
            <ExternalLink className="ic" aria-hidden="true" />
            {t("grant.manageInPassport")}
          </a>
        ) : (
          <Link to={orgHref} className="btn btn-secondary" style={{ alignSelf: "flex-start" }}>
            <ExternalLink className="ic" aria-hidden="true" />
            {t("grant.manageInPassport")}
          </Link>
        )}
      </div>
    </div>
  );
}

/** What is known about a sent payment, newest first. */
export function DisbursementTimeline({ tranche }: { tranche: ScheduleTranche }) {
  const destination = tranche.bankName && tranche.last4 ? ` · ${tranche.bankName} •••• ${tranche.last4}` : "";
  return (
    <div className="tl tl-sm">
      {tranche.status === "settled" && (
        <div className="tl-i tl-ok">
          <span className="dot">
            <Check className="ic" aria-hidden="true" />
          </span>
          <div>
            <div className="what">{t("grant.settled")}</div>
            <div className="who userback-block">Passport{destination}</div>
          </div>
        </div>
      )}
      {(tranche.status === "failed" || tranche.status === "returned") && (
        <div className="tl-i tl-warn">
          <span className="dot">
            <Clock className="ic" aria-hidden="true" />
          </span>
          <div>
            <div className="what">{tranche.status === "failed" ? t("grant.paymentFailed") : t("grant.paymentReturned")}</div>
            <div className="who">{t("grant.passportYourFunderIsToldAnd")}</div>
          </div>
        </div>
      )}
      <div className="tl-i tl-passport">
        <span className="dot">
          <Send className="ic" aria-hidden="true" />
        </span>
        <div>
          <div className="what">{tranche.mode === "resolve" ? t("grant.paidByYourFunderOutsidePassport") : t("grant.sentThroughPassport")}</div>
          <div className="who">{formatDate(tranche.releasedAt)}</div>
        </div>
      </div>
      <div className="tl-i tl-person">
        <span className="dot">
          <Check className="ic" aria-hidden="true" />
        </span>
        <div>
          <div className="what">{t("grant.releasedByYourFunder")}</div>
          <div className="who">{t("grant.afterTheReadinessCheckPassed")}</div>
        </div>
      </div>
    </div>
  );
}

/** Approved against reported actuals, by category. A positive variance is money not yet spent. */
export function budgetRows(book: BudgetBook): { category: string; approved: number; actual: number }[] {
  const sum = new Map<string, { approved: number; actual: number }>();
  const at = (c: string) => sum.get(c) ?? sum.set(c, { approved: 0, actual: 0 }).get(c)!;
  for (const l of book.approved?.lines ?? []) at(l.category).approved += l.amountMinor;
  for (const b of book.actuals) for (const l of b.lines) at(l.category).actual += l.amountMinor;
  return [...sum].map(([category, v]) => ({ category, ...v }));
}

export function varianceText(approved: number, actual: number, currency: string): { text: string; over: boolean } {
  const over = actual > approved;
  const diff = Math.abs(approved - actual);
  const pct = over && approved > 0 ? ` (${Math.round((diff / approved) * 100)}%)` : "";
  return { text: `${over ? "+" : "−"}${formatMinor(diff, currency)}${pct}`, over };
}

export function BudgetTable({ book, compact = false }: { book: BudgetBook; compact?: boolean }) {
  const rows = budgetRows(book);
  const total = rows.reduce((s, r) => ({ approved: s.approved + r.approved, actual: s.actual + r.actual }), { approved: 0, actual: 0 });
  if (!rows.length) return <p className="small muted" style={{ padding: "16px 20px" }}>{t("grant.yourFunderHasNotSetAn")}</p>;
  return (
    <div className="tbl-wrap" style={{ border: "0", borderRadius: "0" }} tabIndex={0} role="region" aria-label={t("grant.budgetScrollable")}>
      <table className="tbl bud" style={{ fontSize: "14px" }}>
        <caption className="sr">{t("grant.approvedBudgetAndActualsToDate")}</caption>
        <thead>
          <tr>
            <th scope="col">{t("grant.category")}</th>
            <th scope="col" className="num">{t("grant.approved")}</th>
            <th scope="col" className="num">{t("grant.actualToDate")}</th>
            {!compact && <th scope="col" className="num">{t("grant.variance")}</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const v = varianceText(r.approved, r.actual, book.currency);
            return (
              <tr key={r.category}>
                <th scope="row" style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0, fontSize: "inherit", background: "transparent", color: "inherit", height: "40px" }}>
                  {r.category}
                </th>
                <td className="num">{formatMinor(r.approved, book.currency)}</td>
                <td className={`num${v.over ? " over" : ""}`}>{formatMinor(r.actual, book.currency)}</td>
                {!compact && <td className={`num ${v.over ? "var-neg" : "var-pos"}`}>{v.over ? t("grant.overBy", { amount: v.text }) : v.text}</td>}
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <td>{t("grant.total")}</td>
            <td className="num">{formatMinor(total.approved, book.currency)}</td>
            <td className="num">{formatMinor(total.actual, book.currency)}</td>
            {!compact && <td className="num">{varianceText(total.approved, total.actual, book.currency).text}</td>}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

/** The grantee reports what was spent in a period, by the funder's approved categories. */
export function ActualsForm({ data, onSaved }: { data: GrantData; onSaved: () => void }) {
  const categories = [...new Set((data.budget.approved?.lines ?? []).map((l) => l.category))];
  const period = periodOf(data.award.keyDates);
  const [start, setStart] = useState(period?.start ?? "");
  const [end, setEnd] = useState("");
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const save = useMoreMutation((api, lines: { category: string; label: string; amountMinor: number }[]) => api.reportActuals(data.award.id, { periodStart: start, periodEnd: end, lines }));
  if (!categories.length) return null;
  return (
    <form
      className="card-b"
      style={{ borderTop: "1px solid var(--og-gray-200)", display: "flex", flexDirection: "column", gap: "12px" }}
      aria-label={t("grant.reportActuals")}
      onSubmit={async (e) => {
        e.preventDefault();
        const lines = categories.flatMap((c) => {
          const minor = parseDollars(amounts[c] ?? "");
          return minor === null ? [] : [{ category: c, label: c, amountMinor: minor }];
        });
        if (!start || !end || start > end) return setProblem(t("grant.badPeriod"));
        if (!lines.length) return setProblem(t("grant.noLines"));
        setProblem(null);
        if (await save.run(lines)) {
          setAmounts({});
          onSaved();
        }
      }}
    >
      <h3>{t("grant.reportActualsForAPeriod")}</h3>
      <div className="fld-row">
        <Field id="act-start" label={t("grant.periodStart")}>
          <input className="inp" id="act-start" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
        </Field>
        <Field id="act-end" label={t("grant.periodEnd")}>
          <input className="inp" id="act-end" type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
        </Field>
      </div>
      <div className="fld-row">
        {categories.map((c, i) => (
          <Field key={c} id={`act-${i}`} label={t("grant.spentIn", { category: c })}>
            <input className="inp" id={`act-${i}`} inputMode="decimal" placeholder="$0" value={amounts[c] ?? ""} onChange={(e) => setAmounts({ ...amounts, [c]: e.target.value })} />
          </Field>
        ))}
      </div>
      {problem && (
        <span className="err-msg" role="alert">
          {problem}
        </span>
      )}
      {save.error ? <ErrorBanner error={save.error} title={t("grant.theActualsWereNotSaved")} /> : null}
      <div className="row" style={{ gap: "10px", flexWrap: "wrap" }}>
        <button className="btn btn-primary" type="submit" disabled={save.state === "saving"}>
          {t("grant.saveActuals")}
        </button>
        <SaveNote state={save.state} savedText={t("grant.actualsSaved")} />
        <span className="help">{t("grant.reportingTheSamePeriodAgainReplaces")}</span>
      </div>
    </form>
  );
}

// A function, so its labels follow the page's language (docs/i18n.md).
const AMENDMENT_TYPES = (): { key: AmendmentInput["type"]; label: string; hint: string }[] => [
  { key: "extension", label: t("grant.amendment.extension"), hint: t("grant.amendment.extensionHint") },
  { key: "reallocation", label: t("grant.amendment.reallocation"), hint: t("grant.amendment.reallocationHint") },
  { key: "scope", label: t("grant.amendment.scope"), hint: t("grant.amendment.scopeHint") },
  { key: "supplemental", label: t("grant.amendment.supplemental"), hint: t("grant.amendment.supplementalHint") },
];
/** An amendment's type and status as words; the API's own codes when unknown. */
const amendmentType = (type: string) => AMENDMENT_TYPES().find((a) => a.key === type)?.label ?? type;
const amendmentStatus = (status: string) =>
  status === "requested" ? t("grant.amendment.requested") : status === "approved" ? t("grant.amendment.approved") : status === "declined" ? t("grant.amendment.declined") : status;
const AMENDMENT_STATUS = { requested: "bdg-info", approved: "bdg-ok", declined: "bdg-dng" } as const;

export function AmendmentsCard({ data, onSaved }: { data: GrantData; onSaved: () => void }) {
  const funder = data.award.funder.name ?? null;
  const amendments = data.award.amendments as { id: string; type: string; status: keyof typeof AMENDMENT_STATUS; createdAt: string; request?: { reason?: string; newEndDate?: string } }[];
  const [type, setType] = useState<AmendmentInput["type"]>("extension");
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("");
  const send = useMoreMutation((api) => api.requestAmendment(data.award.id, { type, reason: reason.trim(), ...(type === "extension" && endDate ? { request: { newEndDate: endDate } } : {}) }));
  const current = AMENDMENT_TYPES().find((a) => a.key === type)!;
  return (
    <div className="card" id="amendments">
      <div className="card-h">
        <div>
          <h2>{t("grant.amendments")}</h2>
          <p className="small muted">{amendments.length ? t("grant.requestedCount", { count: amendments.length }) : t("grant.noAmendmentsRequestedYet")}</p>
        </div>
      </div>
      {amendments.length > 0 && (
        <ul className="card-b" style={{ display: "flex", flexDirection: "column", gap: "8px", borderBottom: "1px solid var(--og-gray-200)" }}>
          {amendments.map((a) => (
            <li key={a.id} className="row" style={{ justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }}>
              <span>
                <span className="b" style={{ textTransform: "capitalize" }}>{amendmentType(a.type)}</span>
                <span className="muted"> · {t("grant.requestedOn", { date: formatDate(a.createdAt) })}{a.request?.reason ? ` · ${a.request.reason}` : ""}</span>
              </span>
              <span className={`bdg ${AMENDMENT_STATUS[a.status] ?? "bdg-neutral"}`} style={{ textTransform: "capitalize" }}>
                <Clock className="ic" aria-hidden="true" />
                {amendmentStatus(a.status)}
              </span>
            </li>
          ))}
        </ul>
      )}
      <form
        className="card-b"
        style={{ display: "flex", flexDirection: "column", gap: "12px" }}
        aria-label={t("grant.requestAnAmendment")}
        onSubmit={async (e) => {
          e.preventDefault();
          if (await send.run()) {
            setReason("");
            setEndDate("");
            onSaved();
          }
        }}
      >
        <span className="lbl" id="am-type">{t("grant.requestAnAmendment")}</span>
        <div className="seg" role="group" aria-labelledby="am-type">
          {AMENDMENT_TYPES().map((opt) => (
            <button key={opt.key} type="button" className={opt.key === type ? "on" : undefined} aria-pressed={opt.key === type} onClick={() => setType(opt.key)}>
              {opt.label}
            </button>
          ))}
        </div>
        {type === "extension" && (
          <Field id="am-end" label={t("grant.newEndDate")}>
            <input className="inp" id="am-end" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </Field>
        )}
        <Field id="am-why" label={t("grant.reason")} required>
          <textarea className="ta" id="am-why" required placeholder={current.hint} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        {send.error ? <ErrorBanner error={send.error} title={t("grant.theRequestWasNotSent")} /> : null}
        <div className="row" style={{ gap: "10px", flexWrap: "wrap" }}>
          <button className="btn btn-primary" type="submit" disabled={!reason.trim() || send.state === "saving"}>
            {funder ? t("grant.sendRequestTo", { funder }) : t("grant.sendRequestToYourFunder")}
          </button>
          <SaveNote state={send.state} savedText={t("grant.requestSent")} />
          <span className="help">{funder ? t("grant.approvesOrDeclines", { funder }) : t("grant.approvesOrDeclinesYourFunder")}</span>
        </div>
      </form>
    </div>
  );
}
