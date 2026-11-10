// SPDX-License-Identifier: AGPL-3.0-only
import { OPERATORS, type Operator, type Rule } from "./types.ts";

export interface ParseError {
  /** JSON-pointer-like location, e.g. `/all/1/any/0`. */
  at: string;
  message: string;
}

export type ParseResult = { ok: true; rules: Rule } | { ok: false; errors: ParseError[] };

const SOURCES = ["org", "profile", "form", "applicant"];
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const MAX_DEPTH = 8;

/** Validate untrusted JSON into a `Rule`. Collects every error rather than stopping at the first. */
export function parseRules(input: unknown): ParseResult {
  const errors: ParseError[] = [];
  walk(input, "", 0, errors);
  return errors.length ? { ok: false, errors } : { ok: true, rules: input as Rule };
}

function walk(node: unknown, at: string, depth: number, errors: ParseError[]): void {
  const err = (message: string, where = at) => errors.push({ at: where || "/", message });
  if (!isObj(node)) return void err("A rule must be an object.");
  if (depth > MAX_DEPTH) return void err(`Rules may nest at most ${MAX_DEPTH} levels.`);
  const group = "all" in node ? "all" : "any" in node ? "any" : null;
  if (group) {
    if ("all" in node && "any" in node) err('A group has either "all" or "any", not both.');
    if ("path" in node || "op" in node) err('A group cannot also have "path" or "op".');
    const children = node[group];
    if (!Array.isArray(children)) return void err(`"${group}" must be an array of rules.`);
    children.forEach((c, i) => walk(c, `${at}/${group}/${i}`, depth + 1, errors));
    return;
  }
  const { path, op, value, order, missing, label, explain } = node;
  if (typeof path !== "string" || !path) err('"path" is required.');
  else {
    const parts = path.split(".");
    if (!SOURCES.includes(parts[0] ?? "")) err(`"path" must start with one of ${SOURCES.join(", ")}.`);
    else if (parts.length < 2 || parts.some((p) => !p)) err('"path" must name a field, e.g. "org.orgType.code".');
    else if (parts[0] === "form" && parts.length < 3) err('A form path is "form.<formId>.<field>".');
  }
  if (typeof op !== "string" || !OPERATORS.includes(op as Operator)) return void err(`"op" must be one of ${OPERATORS.join(", ")}.`);
  if (op !== "exists" && value === undefined) err(`"value" is required for "${op}".`);
  if (op === "exists" && value !== undefined && typeof value !== "boolean") err('"value" for "exists" must be true or false.');
  if ((op === "in" || op === "nin") && !Array.isArray(value)) err(`"value" for "${op}" must be an array.`);
  if (op === "matches") {
    if (typeof value !== "string") err('"value" for "matches" must be a regular expression string.');
    else {
      try {
        new RegExp(value);
      } catch {
        err('"value" for "matches" is not a valid regular expression.');
      }
    }
  }
  if (order !== undefined) {
    if (!Array.isArray(order) || order.some((o) => typeof o !== "string") || new Set(order).size !== order.length) err('"order" must be an array of distinct strings.');
    else if (!["gt", "gte", "lt", "lte"].includes(op)) err('"order" only applies to gt, gte, lt and lte.');
    else if (typeof value !== "string" || !order.includes(value)) err('"value" must be one of the entries in "order".');
  }
  if (missing !== undefined && !["unknown", "fail", "pass"].includes(missing as string)) err('"missing" must be "unknown", "fail" or "pass".');
  if (label !== undefined && typeof label !== "string") err('"label" must be a string.');
  if (explain !== undefined && typeof explain !== "string") err('"explain" must be a string.');
}
