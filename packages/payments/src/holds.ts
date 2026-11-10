// SPDX-License-Identifier: AGPL-3.0-only
// Hold / freeze banner model. It appears wherever money is blocked and always has three parts:
// what is blocked, why (one of five causes), and what clears it, with a date or an action.
// It never shows bank data beyond the bank name and last four digits.
import type { PayeeCredential } from "@gms/passport-client";
import type { ReadinessSummary } from "./readiness.ts";

export type HoldCause =
  | { cause: "pending_destination_change"; bankName: string | null; last4: string | null; coolingOffUntil: string | null }
  | { cause: "freeze_window"; freezeUntil: string }
  | { cause: "level_below_l3"; level: string }
  | { cause: "agreement_not_executed" }
  | { cause: "passport_unavailable" };

export interface HoldBanner {
  cause: HoldCause["cause"];
  tone: "warn" | "danger" | "neutral";
  /** What is blocked. */
  title: string;
  /** Why. */
  detail: string;
  /** What clears it. */
  clears: string;
}

const date = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

export function holdBanner(c: HoldCause, subject = "This payment"): HoldBanner {
  switch (c.cause) {
    case "pending_destination_change": {
      const bank = c.bankName && c.last4 ? ` to ${c.bankName} •••• ${c.last4}` : "";
      return {
        cause: c.cause,
        tone: "warn",
        title: `${subject} is on hold`,
        detail: `The grantee asked Passport to change its payout destination${bank}. Passport pays no one while a change is pending.`,
        clears: c.coolingOffUntil ? `Clears when the change takes effect, on or after ${date(c.coolingOffUntil)}.` : "Clears when the grantee's second officer confirms the change and the cooling-off period ends.",
      };
    }
    case "freeze_window":
      return { cause: c.cause, tone: "warn", title: `${subject} is on hold`, detail: "The payout destination is inside a freeze window at Passport.", clears: `Clears on ${date(c.freezeUntil)}.` };
    case "level_below_l3":
      return { cause: c.cause, tone: "danger", title: `${subject} is blocked`, detail: `The grantee's Passport verification level is ${c.level}. Payments need L3.`, clears: "Clears when the grantee completes payee verification in Passport." };
    case "agreement_not_executed":
      return { cause: c.cause, tone: "neutral", title: `${subject} is waiting`, detail: "The grant agreement is not executed.", clears: "Clears when the grantee signs and the funder countersigns." };
    case "passport_unavailable":
      return { cause: c.cause, tone: "neutral", title: `${subject} cannot be checked`, detail: "Passport could not be reached, so readiness is unknown.", clears: "Clears when Passport responds. Nothing is released while readiness is unknown." };
  }
}

/** The most pressing reason a tranche cannot be released, or null when it can. */
export function holdCauseFor(summary: ReadinessSummary, credential: PayeeCredential | null, now: Date): HoldCause | null {
  if (summary.releasable) return null;
  if (summary.checks.some((c) => c.key === "agreement" && c.state === "fail")) return { cause: "agreement_not_executed" };
  if (credential) {
    const p = credential.changeControl.pendingChange;
    if (p) return { cause: "pending_destination_change", bankName: p.bankName, last4: p.last4, coolingOffUntil: p.coolingOffUntil };
    const f = credential.changeControl.freezeUntil;
    if (f && Date.parse(f) > now.getTime()) return { cause: "freeze_window", freezeUntil: f };
    if (credential.level !== "L3") return { cause: "level_below_l3", level: credential.level };
  }
  if (summary.unknown > 0) return { cause: "passport_unavailable" };
  return null;
}
