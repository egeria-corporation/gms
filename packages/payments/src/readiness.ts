// SPDX-License-Identifier: AGPL-3.0-only
// Readiness for a facilitated tranche (build prompt §10.7). Seven checks, evaluated live. Each line
// carries a state, a label, a reason a person can read, and a link to the screen that fixes it.
// "unknown" is a real state (Passport unreachable or not yet read) and never collapses into pass or fail.
import type { CgAward, FunderSource, PayeeCredential } from "@gms/passport-client";
import { moneyToMinor } from "@gms/passport-client";
import { VERIFICATION_LEVELS, type VerificationLevel } from "@gms/workflow";
import type { AwardForPayments, Tranche } from "./types.ts";

export type CheckState = "pass" | "fail" | "unknown";

export const READINESS_KEYS = ["agreement", "condition", "funder_link", "payee_credential", "award_headroom", "no_duplicate", "recipient_standing"] as const;
export type ReadinessKey = (typeof READINESS_KEYS)[number];

export interface ReadinessCheck {
  key: ReadinessKey;
  state: CheckState;
  label: string;
  reason: string;
  fixHref: string | null;
  /** A pass that still deserves attention (for example a level downgrade that stays at L3 or above). */
  warning?: boolean;
}

/** A value read from Passport: read, absent, or not readable right now. */
export type Lookup<T> = { state: "ok"; value: T } | { state: "missing" } | { state: "unavailable" };

export const ok = <T>(value: T): Lookup<T> => ({ state: "ok", value });
export const missing: Lookup<never> = { state: "missing" };
export const unavailable: Lookup<never> = { state: "unavailable" };

export interface ReadinessInput {
  tranche: Tranche;
  award: AwardForPayments;
  agreementExecuted: boolean;
  conditionSatisfied: boolean;
  /** The funder workspace has a working Passport client (`passport_links.last_ok_at`, not revoked). */
  passportLinked: boolean;
  funderSources: Lookup<FunderSource[]>;
  credential: Lookup<PayeeCredential>;
  passportAward: Lookup<CgAward>;
  /** Recipient organization standing from the cached OrganizationBase and Passport events; null when not known. */
  recipientActive: boolean | null;
  /** Other tranches on the same award. */
  siblings: readonly Tranche[];
  /** A person confirmed that a same-amount payment within 24 hours is intended. */
  duplicateConfirmed?: boolean;
  now: Date;
  links?: Partial<ReadinessLinks>;
}

export interface ReadinessLinks {
  agreement: (awardId: string) => string;
  award: (awardId: string) => string;
  passportSettings: string;
  grantee: (recipientOrgId: string) => string;
}

const DEFAULT_LINKS: ReadinessLinks = {
  agreement: (id) => `/awards/${id}/agreement`,
  award: (id) => `/awards/${id}/payments`,
  passportSettings: "/settings/payments",
  grantee: (id) => `/grantees/${id}`,
};

export interface ReadinessSummary {
  checks: ReadinessCheck[];
  passed: number;
  failed: number;
  unknown: number;
  total: number;
  /** The Release button reads this: true only when every line passes. */
  releasable: boolean;
  /** "5 of 7 checks pass · 1 fails · 1 unknown". */
  text: string;
}

const levelRank = (l: VerificationLevel) => VERIFICATION_LEVELS.indexOf(l);
const DUPLICATE_WINDOW_MS = 24 * 3600_000;
const day = (iso: string) => new Date(iso).toISOString().slice(0, 10);

function payeeCheck(i: ReadinessInput, links: ReadinessLinks): ReadinessCheck {
  const base = { key: "payee_credential" as const, label: "Payee verified at Passport", fixHref: links.grantee(i.award.recipientOrgId) };
  if (i.credential.state === "unavailable") return { ...base, state: "unknown", reason: "Passport could not be reached, so the payee credential was not checked." };
  if (i.credential.state === "missing") return { ...base, state: "fail", reason: "This organization has no payee credential at Passport." };
  const c = i.credential.value;
  if (c.level !== "L3") return { ...base, state: "fail", reason: `Verification level is ${c.level}; payments need L3.` };
  if (!c.payoutDestination || c.payoutDestination.status !== "active") return { ...base, state: "fail", reason: "No active payout destination." };
  const p = c.changeControl.pendingChange;
  if (p) {
    const until = p.coolingOffUntil ? ` It can take effect on ${day(p.coolingOffUntil)}.` : "";
    return { ...base, state: "fail", reason: `A destination change to ${p.bankName} •••• ${p.last4} is pending at Passport.${until}` };
  }
  if (c.changeControl.freezeUntil && Date.parse(c.changeControl.freezeUntil) > i.now.getTime()) {
    return { ...base, state: "fail", reason: `Payments to this payee are frozen until ${day(c.changeControl.freezeUntil)}.` };
  }
  return { ...base, state: "pass", reason: `L3 · ${c.payoutDestination.bankName} •••• ${c.payoutDestination.last4} · credential version ${c.version}`, fixHref: null };
}

function funderCheck(i: ReadinessInput, links: ReadinessLinks): ReadinessCheck {
  const base = { key: "funder_link" as const, label: "Funder connected to Passport", fixHref: links.passportSettings };
  if (!i.passportLinked) return { ...base, state: "fail", reason: "Connect Passport to pay. Awards still work without it." };
  if (i.funderSources.state === "unavailable") return { ...base, state: "unknown", reason: "Passport could not be reached, so the funding bank was not checked." };
  const usable = i.funderSources.state === "ok" ? i.funderSources.value.find((s) => s.canDebit) : undefined;
  if (!usable) return { ...base, state: "fail", reason: "No verified funding bank is linked at Passport." };
  return { ...base, state: "pass", reason: `Funding bank ${usable.bankName}${usable.last4 ? ` •••• ${usable.last4}` : ""}`, fixHref: null };
}

function headroomCheck(i: ReadinessInput, links: ReadinessLinks): ReadinessCheck {
  const base = { key: "award_headroom" as const, label: "Award has room for this payment", fixHref: links.award(i.award.id) };
  if (!i.award.passportAwardId) return { ...base, state: "fail", reason: "This award is not mirrored to Passport yet.", fixHref: links.passportSettings };
  if (i.passportAward.state === "unavailable") return { ...base, state: "unknown", reason: "Passport could not be reached, so the amount already paid was not checked." };
  if (i.passportAward.state === "missing") return { ...base, state: "fail", reason: "Passport has no record of this award." };
  const awarded = moneyToMinor(i.passportAward.value.funding?.awardedAmount);
  const disbursed = moneyToMinor(i.passportAward.value.funding?.disbursedAmount) ?? 0;
  if (awarded === null) return { ...base, state: "unknown", reason: "Passport's award record has no awarded amount." };
  const room = awarded - disbursed;
  if (room < i.tranche.amountMinor) return { ...base, state: "fail", reason: `Only ${fmt(room, i.tranche.currency)} of the award remains at Passport; this tranche is ${fmt(i.tranche.amountMinor, i.tranche.currency)}.` };
  return { ...base, state: "pass", reason: `${fmt(room, i.tranche.currency)} remains of ${fmt(awarded, i.tranche.currency)} awarded`, fixHref: null };
}

function duplicateCheck(i: ReadinessInput, links: ReadinessLinks): ReadinessCheck {
  const base = { key: "no_duplicate" as const, label: "No duplicate payment" };
  const twin = i.siblings.find(
    (t) =>
      t.id !== i.tranche.id &&
      t.awardId === i.tranche.awardId &&
      (t.status === "releasing" || t.status === "initiated") &&
      t.amountMinor === i.tranche.amountMinor &&
      // A sibling in flight with no release time is treated as recent.
      (!t.releasedAt || i.now.getTime() - Date.parse(t.releasedAt) < DUPLICATE_WINDOW_MS),
  );
  if (!twin) return { ...base, state: "pass", reason: "No other payment of this amount is in flight on this award.", fixHref: null };
  if (i.duplicateConfirmed) return { ...base, state: "pass", reason: `Tranche ${twin.seq} for the same amount is in flight; confirmed as intended.`, fixHref: null, warning: true };
  return { ...base, state: "fail", reason: `Tranche ${twin.seq} for the same amount was released in the last 24 hours. Confirm that a second payment is intended.`, fixHref: links.award(i.award.id) };
}

function standingCheck(i: ReadinessInput, links: ReadinessLinks): ReadinessCheck {
  const base = { key: "recipient_standing" as const, label: "Recipient in good standing", fixHref: links.grantee(i.award.recipientOrgId) };
  if (i.recipientActive === false) return { ...base, state: "fail", reason: "Passport reports this organization as inactive." };
  if (i.credential.state === "unavailable" || i.recipientActive === null) return { ...base, state: "unknown", reason: "The organization's current standing could not be confirmed." };
  const now = i.credential.state === "ok" ? i.credential.value.level : null;
  const then = i.award.verificationLevelAtSubmit;
  if (now && then && levelRank(now) < levelRank(then)) {
    // A downgrade warns. It blocks only below L3, and check 4 already fails in that case.
    if (now !== "L3") return { ...base, state: "fail", reason: `Verification level dropped from ${then} to ${now} since the application was submitted.` };
    return { ...base, state: "pass", reason: `Active. Verification level dropped from ${then} to ${now} since submission.`, fixHref: null, warning: true };
  }
  return { ...base, state: "pass", reason: "Active, and the verification level has not dropped since the application was submitted.", fixHref: null };
}

function fmt(minor: number, currency: string): string {
  const v = (minor / 100).toLocaleString("en-US", { minimumFractionDigits: minor % 100 ? 2 : 0, maximumFractionDigits: 2 });
  return currency === "USD" ? `$${v}` : `${v} ${currency}`;
}

export function evaluateReadiness(i: ReadinessInput): ReadinessSummary {
  const links = { ...DEFAULT_LINKS, ...i.links };
  const noAgreement = i.award.conditions.includes("noAgreementRequired");
  const checks: ReadinessCheck[] = [
    i.agreementExecuted || noAgreement
      ? { key: "agreement", state: "pass", label: "Agreement executed", reason: noAgreement && !i.agreementExecuted ? "This award does not require an agreement." : "Signed by the grantee and countersigned.", fixHref: null }
      : { key: "agreement", state: "fail", label: "Agreement executed", reason: "The grant agreement is not executed yet.", fixHref: links.agreement(i.award.id) },
    i.conditionSatisfied
      ? { key: "condition", state: "pass", label: "Tranche condition met", reason: conditionText(i.tranche, true), fixHref: null }
      : { key: "condition", state: "fail", label: "Tranche condition met", reason: conditionText(i.tranche, false), fixHref: links.award(i.award.id) },
    funderCheck(i, links),
    payeeCheck(i, links),
    headroomCheck(i, links),
    duplicateCheck(i, links),
    standingCheck(i, links),
  ];
  return summarize(checks);
}

function conditionText(t: Tranche, met: boolean): string {
  switch (t.condition.type) {
    case "onExecution":
      return met ? "Due on execution of the agreement." : "Waiting for the agreement to be executed.";
    case "onReportAccepted":
      return met ? "The linked report was accepted." : "Waiting for the linked report to be accepted.";
    case "onDate":
      return met ? `Scheduled date ${day(t.condition.date)} has passed.` : `Scheduled for ${day(t.condition.date)}.`;
    case "manual":
      return met ? "Marked due by a person." : "Waiting for a person to mark this tranche due.";
  }
}

export function summarize(checks: ReadinessCheck[]): ReadinessSummary {
  const passed = checks.filter((c) => c.state === "pass").length;
  const failed = checks.filter((c) => c.state === "fail").length;
  const unknown = checks.filter((c) => c.state === "unknown").length;
  const parts = [`${passed} of ${checks.length} checks pass`];
  if (failed) parts.push(`${failed} ${failed === 1 ? "fails" : "fail"}`);
  if (unknown) parts.push(`${unknown} unknown`);
  return { checks, passed, failed, unknown, total: checks.length, releasable: failed === 0 && unknown === 0, text: parts.join(" · ") };
}
