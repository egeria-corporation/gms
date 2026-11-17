// SPDX-License-Identifier: AGPL-3.0-only
// A readiness check in the page's language. The API words each check in English from its `key` and
// `state` (apps/api/src/services/organization.ts); this gives the same check from the `shared`
// catalog when its words are the API's own (in English they read exactly the same). Anything else, a
// check this version does not know or demo data worded another way, is shown as it came.
import { translate } from "../i18n/current.ts";
import type { Key, Values } from "../i18n/index.tsx";
import { formatDate } from "./format.ts";

export interface CheckWords {
  key: string;
  state: "pass" | "fail" | "unknown";
  label: string;
  reason: string;
}

type Words = { label: Key<"shared">; pass?: Key<"shared">; fail?: Key<"shared">; unknown?: Key<"shared"> };
const CONNECT: Key<"shared"> = "readiness.connectToSee";
const CHECKS: Record<string, Words> = {
  passport_linked: { label: "readiness.passportLinked.label", fail: "readiness.passportLinked.fail" },
  organization_active: { label: "readiness.organizationActive.label", pass: "readiness.organizationActive.pass", fail: "readiness.organizationActive.fail", unknown: CONNECT },
  organization_verified: { label: "readiness.organizationVerified.label", pass: "readiness.organizationVerified.pass", fail: "readiness.organizationVerified.fail", unknown: CONNECT },
  identity_verified: { label: "readiness.identityVerified.label", pass: "readiness.identityVerified.pass", fail: "readiness.identityVerified.fail", unknown: CONNECT },
  payee_verified: { label: "readiness.payeeVerified.label", pass: "readiness.payeeVerified.pass", fail: "readiness.payeeVerified.fail", unknown: CONNECT },
  profile_complete: { label: "readiness.profileComplete.label", pass: "readiness.profileComplete.pass" },
  passport_optional: { label: "readiness.passportOptional.label", unknown: "readiness.passportOptional.unknown" },
};

/** The message, when `english` is exactly what the API writes for it. */
const ifSame = (key: Key<"shared">, english: string, values?: Values): string | null => (translate("shared", key, values, "en") === english ? translate("shared", key, values) : null);

const LAST_READ = /^Record last read (\d{4}-\d{2}-\d{2}|never)$/;
const MISSING = /^Add your organization's (legal name|contact email|legal name and contact email) in Settings$/;

function reasonOf(c: CheckWords): string {
  const last = c.key === "passport_linked" && c.state === "pass" ? LAST_READ.exec(c.reason) : null;
  if (last) return translate("shared", "readiness.passportLinked.pass", { date: last[1] === "never" ? "never" : formatDate(last[1]!) });
  const missing = c.key === "profile_complete" && c.state === "fail" ? MISSING.exec(c.reason) : null;
  if (missing) return translate("shared", "readiness.profileComplete.fail", { missing: missing[1] === "legal name" ? "legalName" : missing[1] === "contact email" ? "contactEmail" : "both" });
  const key = CHECKS[c.key]?.[c.state];
  return (key && ifSame(key, c.reason)) ?? c.reason;
}

/** A check's label and reason in the page's language. */
export function readinessWords(c: CheckWords): { label: string; reason: string } {
  const label = CHECKS[c.key]?.label;
  return { label: (label && ifSame(label, c.label)) ?? c.label, reason: reasonOf(c) };
}
