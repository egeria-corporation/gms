// SPDX-License-Identifier: AGPL-3.0-only
import { isAll, isAny, isPassportOnlyPath, type EvaluateOptions, type Evaluation, type LeafRule, type Outcome, type Rule, type RuleContext, type RuleResult } from "./types.ts";

const MISSING = Symbol("missing");

/** Resolve a dotted path against the context. Returns MISSING when any segment is absent or null. */
export function resolvePath(ctx: RuleContext, path: string): unknown {
  let cur: unknown = ctx;
  for (const key of path.split(".")) {
    if (cur === null || typeof cur !== "object") return MISSING;
    cur = (cur as Record<string, unknown>)[key];
    if (cur === undefined || cur === null) return MISSING;
  }
  return cur;
}

const same = (a: unknown, b: unknown) => a === b || (typeof a === "object" && typeof b === "object" && JSON.stringify(a) === JSON.stringify(b));

/** Compare for gt/gte/lt/lte. Returns null when the two values are not comparable. */
function compare(actual: unknown, value: unknown, order?: readonly string[]): number | null {
  if (order) {
    const a = typeof actual === "string" ? order.indexOf(actual) : -1;
    const b = typeof value === "string" ? order.indexOf(value) : -1;
    return a < 0 || b < 0 ? null : a - b;
  }
  if (typeof actual === "number" && typeof value === "number") return Number.isNaN(actual) || Number.isNaN(value) ? null : actual - value;
  // ISO dates and other strings compare lexicographically.
  if (typeof actual === "string" && typeof value === "string") return actual < value ? -1 : actual > value ? 1 : 0;
  return null;
}

function leafOutcome(rule: LeafRule, actual: unknown): Outcome {
  if (rule.op === "exists") {
    const want = rule.value === undefined ? true : rule.value === true;
    return (actual !== MISSING) === want ? "pass" : "fail";
  }
  if (actual === MISSING) return rule.missing === "fail" ? "fail" : rule.missing === "pass" ? "pass" : "unknown";
  const bool = (b: boolean): Outcome => (b ? "pass" : "fail");
  switch (rule.op) {
    case "eq":
      return bool(same(actual, rule.value));
    case "neq":
      return bool(!same(actual, rule.value));
    case "in":
    case "nin": {
      if (!Array.isArray(rule.value)) return "unknown";
      const list = rule.value;
      // An array-valued field matches when any of its members is listed.
      const hit = Array.isArray(actual) ? actual.some((a) => list.some((v) => same(a, v))) : list.some((v) => same(actual, v));
      return bool(rule.op === "in" ? hit : !hit);
    }
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      const c = compare(actual, rule.value, rule.order);
      if (c === null) return "unknown";
      return bool(rule.op === "gt" ? c > 0 : rule.op === "gte" ? c >= 0 : rule.op === "lt" ? c < 0 : c <= 0);
    }
    case "matches": {
      if (typeof actual !== "string" || typeof rule.value !== "string") return "unknown";
      try {
        return bool(new RegExp(rule.value).test(actual));
      } catch {
        return "unknown";
      }
    }
  }
}

const OP_TEXT: Record<LeafRule["op"], string> = {
  eq: "is",
  neq: "is not",
  in: "is one of",
  nin: "is not one of",
  gt: "is greater than",
  gte: "is at least",
  lt: "is less than",
  lte: "is at most",
  exists: "is provided",
  matches: "matches",
};

const show = (v: unknown): string => (v === undefined ? "not available" : Array.isArray(v) ? v.map(show).join(", ") : typeof v === "object" && v !== null ? JSON.stringify(v) : String(v));

function explain(rule: LeafRule, label: string, outcome: Outcome, actual: unknown): string {
  if (rule.explain) {
    const vars: Record<string, string> = { label, path: rule.path, actual: show(actual), value: show(rule.value), outcome };
    return rule.explain.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k: string) => vars[k] ?? m);
  }
  const expectation = rule.op === "exists" ? (rule.value === false ? "is not provided" : OP_TEXT.exists) : `${OP_TEXT[rule.op]} ${show(rule.value)}`;
  if (outcome === "unknown") {
    return actual === undefined ? `${label}: could not be checked because ${rule.path} is not available.` : `${label}: could not be checked; ${show(actual)} cannot be compared with ${show(rule.value)}.`;
  }
  const verdict = outcome === "pass" ? "Met" : "Not met";
  return `${label}: ${verdict}. Requires that it ${expectation}; found ${show(actual)}.`;
}

/** Kleene three-valued AND: any fail → fail; else any unknown → unknown; else pass. Empty → pass. */
export function allOf(outcomes: readonly Outcome[]): Outcome {
  if (outcomes.includes("fail")) return "fail";
  return outcomes.includes("unknown") ? "unknown" : "pass";
}

/** Kleene three-valued OR: any pass → pass; else any unknown → unknown; else fail. Empty → fail. */
export function anyOf(outcomes: readonly Outcome[]): Outcome {
  if (outcomes.includes("pass")) return "pass";
  return outcomes.includes("unknown") ? "unknown" : "fail";
}

function walk(rule: Rule, ctx: RuleContext, results: RuleResult[], opts: EvaluateOptions): Outcome {
  if (isAll(rule)) return allOf(rule.all.map((r) => walk(r, ctx, results, opts)));
  if (isAny(rule)) return anyOf(rule.any.map((r) => walk(r, ctx, results, opts)));
  const label = rule.label ?? rule.path;
  // A fact only Passport supplies cannot be checked for an applicant without Passport: a person decides.
  if (opts.passportFacts === false && isPassportOnlyPath(rule.path)) {
    results.push({ rule, label, outcome: "unknown", actual: undefined, explain: `${label}: needs review. This is checked against the organization's OpenGrants Passport record, and the organization has not connected Passport.` });
    return "unknown";
  }
  const resolved = resolvePath(ctx, rule.path);
  const actual = resolved === MISSING ? undefined : resolved;
  let outcome = leafOutcome(rule, resolved);
  const selfReported = (opts.selfReported ?? []).includes(rule.path.split(".")[0] ?? "");
  let text = explain(rule, label, outcome, actual);
  // Met on what the organization said about itself: counts only when the funder accepts that.
  if (selfReported && outcome === "pass" && opts.acceptSelfReported !== true) {
    outcome = "unknown";
    text = `${label}: needs review. Met on information the organization entered itself, which is not verified; found ${show(actual)}.`;
  }
  results.push({ rule, label, outcome, actual, explain: text, ...(selfReported ? { selfReported: true as const } : {}) });
  return outcome;
}

/** Evaluate rules. `unknown` is a real result: it never auto-declines, it flags for a human. */
export function evaluate(rules: Rule | null | undefined, ctx: RuleContext, opts: EvaluateOptions = {}): Evaluation {
  if (!rules) return { eligible: true, results: [] };
  const results: RuleResult[] = [];
  const outcome = walk(rules, ctx, results, opts);
  return { eligible: outcome === "pass" ? true : outcome === "fail" ? false : "unknown", results };
}

/** Only a definite `false` may drive an automatic decline. */
export const mayAutoDecline = (e: Evaluation): boolean => e.eligible === false;
/** `unknown` goes to a person. */
export const needsHumanReview = (e: Evaluation): boolean => e.eligible === "unknown";
