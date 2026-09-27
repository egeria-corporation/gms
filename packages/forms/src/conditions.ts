// SPDX-License-Identifier: AGPL-3.0-only
// Condition evaluation, flag folding and translation to JSON Schema.
// evaluateCondition() and conditionToSchema() must agree on every input: the JSON Schema `if`
// clauses and the JSON Forms rules are generated from the same conditions the server evaluates.
import type { JsonSchema } from './compile';
import { type Condition, type ConditionOp, type ConditionValue, isAllCondition, isFieldCondition, isFlagCondition } from './model';
import { deepEqual, isEmptyValue, isPlainObject, type ResponseData } from './util';

export type Flags = Readonly<Record<string, boolean>>;

function truthy(v: unknown): boolean {
  if (v === false || v === 0) return false;
  return !isEmptyValue(v);
}

/** Tests one answer against an operator. Shared by rules and eligibility knock-outs. */
export function testValue(actual: unknown, op: ConditionOp, expected: ConditionValue | undefined): boolean {
  switch (op) {
    case 'eq':
      return !isEmptyValue(actual) && deepEqual(actual, expected);
    case 'neq':
      return !(!isEmptyValue(actual) && deepEqual(actual, expected));
    case 'in': {
      const list = Array.isArray(expected) ? expected : expected === undefined ? [] : [expected];
      if (isEmptyValue(actual)) return false;
      if (Array.isArray(actual)) return actual.some((a) => list.some((e) => deepEqual(a, e)));
      return list.some((e) => deepEqual(actual, e));
    }
    case 'gt':
      return typeof actual === 'number' && typeof expected === 'number' && actual > expected;
    case 'lt':
      return typeof actual === 'number' && typeof expected === 'number' && actual < expected;
    case 'truthy':
      return truthy(actual);
    case 'falsy':
      return !truthy(actual);
  }
}

/**
 * Evaluates a condition against response data. Blank answers count as "not answered".
 * Flag conditions read `flags` (missing flags are off).
 */
export function evaluateCondition(cond: Condition, data: ResponseData, flags: Flags = {}): boolean {
  if (isFlagCondition(cond)) return flags[cond.flag] === true;
  if (isFieldCondition(cond)) return testValue(data[cond.field], cond.op, cond.value);
  if (isAllCondition(cond)) return cond.all.every((c) => evaluateCondition(c, data, flags));
  return cond.any.some((c) => evaluateCondition(c, data, flags));
}

/** Resolves flag conditions to constants and simplifies. `true`/`false` mean "always"/"never". */
export function foldCondition(cond: Condition | undefined, flags: Flags): Condition | boolean {
  if (!cond) return true;
  if (isFlagCondition(cond)) return flags[cond.flag] === true;
  if (isFieldCondition(cond)) return cond;
  if (isAllCondition(cond)) return andConditions(cond.all.map((c) => foldCondition(c, flags)));
  return orConditions(cond.any.map((c) => foldCondition(c, flags)));
}

export function andConditions(parts: readonly (Condition | boolean)[]): Condition | boolean {
  const kept: Condition[] = [];
  for (const p of parts) {
    if (p === false) return false;
    if (p !== true && !kept.some((k) => deepEqual(k, p))) kept.push(p);
  }
  if (kept.length === 0) return true;
  if (kept.length === 1) return kept[0]!;
  return { all: kept };
}

export function orConditions(parts: readonly (Condition | boolean)[]): Condition | boolean {
  const kept: Condition[] = [];
  for (const p of parts) {
    if (p === true) return true;
    if (p !== false && !kept.some((k) => deepEqual(k, p))) kept.push(p);
  }
  if (kept.length === 0) return false;
  if (kept.length === 1) return kept[0]!;
  return { any: kept };
}

const TRUTHY_VALUE_SCHEMA: JsonSchema = { not: { anyOf: [{ enum: [false, 0, null, ''] }, { type: 'array', maxItems: 0 }] } };

/** Schema that holds for the *value* when `testValue(value, op, expected)` is true (value present). */
function valueSchema(op: ConditionOp, expected: ConditionValue | undefined): JsonSchema {
  switch (op) {
    case 'eq':
    case 'neq':
      return { const: expected ?? null };
    case 'in': {
      const list = Array.isArray(expected) ? expected : expected === undefined ? [] : [expected];
      if (list.length === 0) return { not: {} };
      return { anyOf: [{ enum: list }, { type: 'array', contains: { enum: list } }] };
    }
    case 'gt':
      return typeof expected === 'number' ? { type: 'number', exclusiveMinimum: expected } : { not: {} };
    case 'lt':
      return typeof expected === 'number' ? { type: 'number', exclusiveMaximum: expected } : { not: {} };
    case 'truthy':
    case 'falsy':
      return TRUTHY_VALUE_SCHEMA;
  }
}

/**
 * A JSON Schema that validates the whole (pruned) response object exactly when the condition is
 * true. Flag conditions must be folded first (see foldCondition); a stray flag is treated as off.
 */
export function conditionToSchema(cond: Condition): JsonSchema {
  if (isFlagCondition(cond)) return { not: {} };
  if (isFieldCondition(cond)) {
    const positive: JsonSchema = { required: [cond.field], properties: { [cond.field]: valueSchema(cond.op, cond.value) } };
    if (cond.op === 'neq' || cond.op === 'falsy') return { not: positive };
    return positive;
  }
  if (isAllCondition(cond)) return { allOf: cond.all.map(conditionToSchema) };
  return { anyOf: cond.any.map(conditionToSchema) };
}

/** Same as conditionToSchema but accepts a folded constant. */
export function foldedToSchema(cond: Condition | boolean): JsonSchema {
  if (cond === true) return {};
  if (cond === false) return { not: {} };
  return conditionToSchema(cond);
}

export function isConditionLike(v: unknown): v is Condition {
  return isPlainObject(v) && ('field' in v || 'flag' in v || 'all' in v || 'any' in v);
}
