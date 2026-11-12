// SPDX-License-Identifier: AGPL-3.0-only
// Eligibility rule DSL (build spec §10.3). Stored as JSON on the opportunity.

export const OPERATORS = ["eq", "neq", "in", "nin", "gt", "gte", "lt", "lte", "exists", "matches"] as const;
export type Operator = (typeof OPERATORS)[number];

/** What a leaf yields when the value at `path` is missing. Default: `unknown` (flag for a human). */
export type MissingPolicy = "unknown" | "fail" | "pass";

export interface LeafRule {
  path: string;
  op: Operator;
  value?: unknown;
  /** Ordinal scale for gt/gte/lt/lte, lowest first, e.g. ["L0","L1","L2","L3"]. */
  order?: readonly string[];
  missing?: MissingPolicy;
  label?: string;
  /** Template with {{label}}, {{path}}, {{actual}}, {{value}}, {{outcome}}. */
  explain?: string;
}

export interface AllRule {
  all: Rule[];
  label?: string;
}
export interface AnyRule {
  any: Rule[];
  label?: string;
}
export type Rule = LeafRule | AllRule | AnyRule;

export type Outcome = "pass" | "fail" | "unknown";

/** Evaluation sources. `form` is keyed by form id; an absent source means "not available". */
export interface RuleContext {
  org?: unknown;
  profile?: unknown;
  form?: Record<string, unknown>;
  applicant?: { type?: string } & Record<string, unknown>;
}

export interface RuleResult {
  rule: LeafRule;
  label: string;
  outcome: Outcome;
  actual: unknown;
  explain: string;
  /** The rule read a fact the applicant reported about itself, not one Passport verified. */
  selfReported?: true;
}

/**
 * Where the facts came from. Without options every source is taken as it stands (the behaviour
 * before self-declared profiles). The API passes these for every applicant.
 */
export interface EvaluateOptions {
  /** Sources (`org`, `profile`) whose facts the applicant entered itself rather than Passport. */
  selfReported?: readonly string[];
  /**
   * Whether a rule met on a self-reported fact counts as met. When false (the default) it is
   * `unknown`, for a person to review; a rule not met stays not met.
   */
  acceptSelfReported?: boolean;
  /** False when the applicant has no Passport record: rules on Passport-only facts are `unknown`. */
  passportFacts?: boolean;
}

/**
 * Facts only Passport can supply: the verification level and attestation it stamps on the
 * organization, and the registry-backed Common App profile. Matched on whole path segments.
 */
export const PASSPORT_ONLY_PATHS: readonly string[] = ["org.customFields.verificationLevel", "org.customFields.verifiedAt", "org.customFields.attestation", "profile"];

export const isPassportOnlyPath = (path: string): boolean => PASSPORT_ONLY_PATHS.some((p) => path === p || path.startsWith(`${p}.`));

export interface Evaluation {
  eligible: true | false | "unknown";
  results: RuleResult[];
}

export const isAll = (r: Rule): r is AllRule => "all" in r;
export const isAny = (r: Rule): r is AnyRule => "any" in r;
