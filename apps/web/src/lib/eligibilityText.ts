// SPDX-License-Identifier: AGPL-3.0-only
// An eligibility rule's result in the page's language. The API (and @gms/rules) explain each result
// in an English sentence and say why it reads as it does (`because`); this words the same sentence
// from the `shared` catalog. A funder's own explanation (`custom`) is content and stays as written,
// and a result without `because` (stored before v1.11.0, or demo data) shows its sentence as it came.
import { show } from "@gms/rules";
import { translate } from "../i18n/current.ts";
import type { Key } from "../i18n/index.tsx";

export interface ExplainedResult {
  rule: object;
  label: string;
  outcome: "pass" | "fail" | "unknown";
  actual?: unknown;
  explain: string;
  because?: string;
}

const EXPECT: Record<string, Key<"shared">> = {
  eq: "eligibility.expect.eq",
  neq: "eligibility.expect.neq",
  in: "eligibility.expect.in",
  nin: "eligibility.expect.nin",
  gt: "eligibility.expect.gt",
  gte: "eligibility.expect.gte",
  lt: "eligibility.expect.lt",
  lte: "eligibility.expect.lte",
  matches: "eligibility.expect.matches",
};

/** A value as the sentence quotes it: "not available" in the page's language, lists joined. */
const quote = (v: unknown): string => (v === undefined ? translate("shared", "eligibility.notAvailable") : show(v));

function expectation(rule: { op?: unknown; value?: unknown }): string | null {
  const op = typeof rule.op === "string" ? rule.op : "";
  if (op === "exists") return translate("shared", rule.value === false ? "eligibility.expect.notExists" : "eligibility.expect.exists");
  const key = EXPECT[op];
  return key ? translate("shared", key, { value: show(rule.value) }) : null;
}

/** The result's sentence in the page's language. */
export function explainResult(r: ExplainedResult): string {
  const label = r.label;
  const rule = r.rule as { path?: unknown; op?: unknown; value?: unknown };
  switch (r.because) {
    case "passport_only":
      return translate("shared", "eligibility.because.passportOnly", { label });
    case "self_reported":
      return translate("shared", "eligibility.because.selfReported", { label, actual: quote(r.actual) });
    case "unavailable":
      return translate("shared", "eligibility.because.unavailable", { label, path: String(rule.path ?? "") });
    case "incomparable":
      return translate("shared", "eligibility.because.incomparable", { label, actual: quote(r.actual), value: show(rule.value) });
    case "outcome_only":
      return translate("shared", "eligibility.because.outcomeOnly", { label, outcome: r.outcome });
    case "met":
    case "not_met": {
      const expect = expectation(rule);
      if (!expect) return r.explain;
      return translate("shared", r.because === "met" ? "eligibility.because.met" : "eligibility.because.notMet", { label, expectation: expect, found: r.actual === undefined ? "none" : "some", actual: quote(r.actual) });
    }
    default:
      // `custom` (the funder's words) and anything this version does not know.
      return r.explain;
  }
}
