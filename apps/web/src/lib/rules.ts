// SPDX-License-Identifier: AGPL-3.0-only
// The "Who can apply" editor works on rows; this module turns rows into the eligibility rules DSL
// (build spec §10.3) and back, and writes each rule's plain-language label.
import type { LeafRule, Rule } from "@gms/rules";
import { APPLICANT_TYPE_LABELS, formatMoney } from "./format.ts";

export const LEVELS = ["L0", "L1", "L2", "L3"] as const;

export const US_STATES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware",
  DC: "District of Columbia", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa",
  KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota",
  MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey",
  NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon",
  PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah",
  VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
};

export type FactKey = "orgType" | "state" | "level" | "orgActive" | "revenueUnder" | "custom";

/** One editable line of the "Who can apply" list. */
export type RuleRow =
  | { id: string; fact: "orgType"; values: string[] }
  | { id: string; fact: "state"; values: string[] }
  | { id: string; fact: "level"; level: (typeof LEVELS)[number] }
  | { id: string; fact: "orgActive" }
  | { id: string; fact: "revenueUnder"; amount: number }
  /** A rule this editor does not model (nested groups, form answers); kept as written. */
  | { id: string; fact: "custom"; rule: Rule };

export const FACTS: { key: Exclude<FactKey, "custom">; label: string; source: string }[] = [
  { key: "orgType", label: "Organization type", source: "Passport record" },
  { key: "state", label: "Located in", source: "Passport record" },
  { key: "level", label: "Passport verification level", source: "Passport record" },
  { key: "orgActive", label: "Organization is active", source: "Passport record" },
  { key: "revenueUnder", label: "Annual revenue under", source: "Passport profile" },
];

const PATHS = {
  orgType: "org.orgType.code",
  state: "org.addresses.primary.stateCode",
  level: "org.customFields.verificationLevel.value",
  orgActive: "org.status.value",
  revenueUnder: "profile.financials.annualRevenue",
} as const;

const list = (items: string[]) => (items.length <= 1 ? (items[0] ?? "…") : `${items.slice(0, -1).join(", ")} or ${items[items.length - 1]}`);

/** The sentence applicants and staff read for a row. */
export function describeRow(row: RuleRow): string {
  switch (row.fact) {
    case "orgType":
      return `Organization type is ${list(row.values.map((v) => APPLICANT_TYPE_LABELS[v] ?? v))}`;
    case "state":
      return `Located in ${list(row.values.map((v) => US_STATES[v] ?? v))}`;
    case "level":
      return row.level === "L0" ? "Has a Passport record" : `Verified in Passport at ${row.level} or higher`;
    case "orgActive":
      return "Organization is active";
    case "revenueUnder":
      return `Annual revenue under ${formatMoney({ amount: String(row.amount), currency: "USD" })}`;
    case "custom":
      return ("label" in row.rule && row.rule.label) || "Custom rule";
  }
}

export function rowToRule(row: RuleRow): Rule {
  const label = describeRow(row);
  switch (row.fact) {
    case "orgType":
      return { path: PATHS.orgType, op: "in", value: row.values, label };
    case "state":
      return { path: PATHS.state, op: "in", value: row.values, label };
    case "level":
      return { path: PATHS.level, op: "gte", value: row.level, order: [...LEVELS], label };
    case "orgActive":
      return { path: PATHS.orgActive, op: "eq", value: "active", label };
    case "revenueUnder":
      // Revenue comes from the Passport profile; when the organization has not shared it the
      // result is "unknown", which flags the application for a person and never declines it.
      return { path: PATHS.revenueUnder, op: "lt", value: row.amount, missing: "unknown", label };
    case "custom":
      return row.rule;
  }
}

/** Rows → the DSL stored on the opportunity. No rows is an empty `all`: everyone of an accepted type may apply. */
export function rowsToRules(rows: RuleRow[]): Rule {
  return { all: rows.map(rowToRule) };
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

function leafToRow(rule: LeafRule, id: string): RuleRow {
  if (rule.path === PATHS.orgType && rule.op === "in") return { id, fact: "orgType", values: strings(rule.value) };
  if (rule.path === PATHS.state && rule.op === "in") return { id, fact: "state", values: strings(rule.value) };
  if (rule.path === PATHS.level && rule.op === "gte" && (LEVELS as readonly string[]).includes(String(rule.value))) {
    return { id, fact: "level", level: rule.value as (typeof LEVELS)[number] };
  }
  if (rule.path === PATHS.orgActive && rule.op === "eq" && rule.value === "active") return { id, fact: "orgActive" };
  if (rule.path === PATHS.revenueUnder && rule.op === "lt" && typeof rule.value === "number") return { id, fact: "revenueUnder", amount: rule.value };
  return { id, fact: "custom", rule };
}

/** The stored DSL → rows. A top-level `all` becomes one row per member; anything else is one custom row. */
export function rulesToRows(rules: Rule | null | undefined): RuleRow[] {
  if (!rules) return [];
  const members = "all" in rules ? rules.all : [rules];
  return members.map((r, i) => ("path" in r ? leafToRow(r, `r${i + 1}`) : { id: `r${i + 1}`, fact: "custom", rule: r }));
}

export function newRow(fact: Exclude<FactKey, "custom">, id: string): RuleRow {
  switch (fact) {
    case "orgType":
      return { id, fact, values: ["non_profit_with_501c3"] };
    case "state":
      return { id, fact, values: [] };
    case "level":
      return { id, fact, level: "L1" };
    case "orgActive":
      return { id, fact };
    case "revenueUnder":
      return { id, fact, amount: 5_000_000 };
  }
}
