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
}

export interface Evaluation {
  eligible: true | false | "unknown";
  results: RuleResult[];
}

export const isAll = (r: Rule): r is AllRule => "all" in r;
export const isAny = (r: Rule): r is AnyRule => "any" in r;
