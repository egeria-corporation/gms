// SPDX-License-Identifier: AGPL-3.0-or-later
// The logic editor's working copy of a rule: a flat list of clauses joined by "all" or "any",
// converted to and from the model's Condition shape, plus validation (incomplete clauses and
// circular rules). React-free.
import {
  type Condition,
  type ConditionOp,
  type ConditionValue,
  type FieldType,
  type FormModel,
  isAllCondition,
  isAnyCondition,
  isFieldCondition,
  isFlagCondition,
  listFields,
} from '../model';
import { detectRuleCycles, type RuleKind } from '../rules';
import { getElement, updateElement } from './builder-ops';

export type ClauseDraft = { kind: 'field'; field: string; op: ConditionOp; value?: ConditionValue } | { kind: 'flag'; flag: string };

export interface RuleDraft {
  match: 'all' | 'any';
  clauses: ClauseDraft[];
}

export function emptyDraft(): RuleDraft {
  return { match: 'all', clauses: [] };
}

function toClause(c: Condition): ClauseDraft | null {
  if (isFieldCondition(c)) return { kind: 'field', field: c.field, op: c.op, ...(c.value !== undefined ? { value: c.value } : {}) };
  if (isFlagCondition(c)) return { kind: 'flag', flag: c.flag };
  return null;
}

/**
 * Converts a stored condition into an editable draft. Returns null when the rule is more complex
 * than one all/any group of simple clauses (it can still be shown with describeCondition and
 * replaced).
 */
export function conditionToDraft(c: Condition | undefined): RuleDraft | null {
  if (!c) return emptyDraft();
  const single = toClause(c);
  if (single) return { match: 'all', clauses: [single] };
  const list = isAllCondition(c) ? c.all : isAnyCondition(c) ? c.any : [];
  const clauses = list.map(toClause);
  if (clauses.some((x) => x === null)) return null;
  return { match: isAnyCondition(c) ? 'any' : 'all', clauses: clauses as ClauseDraft[] };
}

function fromClause(c: ClauseDraft): Condition {
  if (c.kind === 'flag') return { flag: c.flag };
  return { field: c.field, op: c.op, ...(c.value !== undefined && opNeedsValue(c.op) ? { value: c.value } : {}) };
}

/** The stored condition for a draft (undefined when it has no clauses). */
export function draftToCondition(d: RuleDraft): Condition | undefined {
  if (!d.clauses.length) return undefined;
  if (d.clauses.length === 1) return fromClause(d.clauses[0]!);
  const list = d.clauses.map(fromClause);
  return d.match === 'any' ? { any: list } : { all: list };
}

export function opNeedsValue(op: ConditionOp): boolean {
  return op !== 'truthy' && op !== 'falsy';
}

export interface OpChoice {
  /** Unique key for the select (op, or op+preset value for yes/no). */
  key: string;
  op: ConditionOp;
  label: string;
  /** Fixed value for presets such as "is Yes". */
  value?: ConditionValue;
}

/** Operators that make sense for a field type, in plain words. */
export function opChoices(type: FieldType | undefined): OpChoice[] {
  const answered: OpChoice[] = [
    { key: 'truthy', op: 'truthy', label: 'is answered' },
    { key: 'falsy', op: 'falsy', label: 'is blank' },
  ];
  switch (type) {
    case 'yes_no':
      return [
        { key: 'eq:true', op: 'eq', value: true, label: 'is Yes' },
        { key: 'eq:false', op: 'eq', value: false, label: 'is No' },
        { key: 'falsy', op: 'falsy', label: 'is No or not answered' },
      ];
    case 'select':
      return [{ key: 'eq', op: 'eq', label: 'is' }, { key: 'neq', op: 'neq', label: 'is not' }, { key: 'in', op: 'in', label: 'is any of' }, ...answered];
    case 'multi_select':
    case 'checkbox_group':
      return [{ key: 'in', op: 'in', label: 'includes any of' }, { key: 'truthy', op: 'truthy', label: 'has any answer' }, { key: 'falsy', op: 'falsy', label: 'is blank' }];
    case 'number':
    case 'currency':
      return [{ key: 'eq', op: 'eq', label: 'is' }, { key: 'gt', op: 'gt', label: 'is more than' }, { key: 'lt', op: 'lt', label: 'is less than' }, ...answered];
    case 'text':
    case 'long_text':
    case 'rich_text':
    case 'email':
    case 'phone':
    case 'ein':
    case 'uei':
    case 'date':
      return [{ key: 'eq', op: 'eq', label: 'is' }, { key: 'neq', op: 'neq', label: 'is not' }, ...answered];
    default:
      return answered;
  }
}

/** The select key for a clause's current operator. */
export function opKey(type: FieldType | undefined, clause: Extract<ClauseDraft, { kind: 'field' }>): string {
  const choices = opChoices(type);
  const preset = choices.find((c) => c.op === clause.op && c.value !== undefined && c.value === clause.value);
  if (preset) return preset.key;
  return choices.find((c) => c.op === clause.op && c.value === undefined)?.key ?? choices[0]?.key ?? clause.op;
}

/** Why a clause can't be saved yet (plain words for staff), or undefined. */
export function clauseProblem(model: FormModel, clause: ClauseDraft): string | undefined {
  if (clause.kind === 'flag') return model.flags[clause.flag] === undefined ? 'Choose a form setting.' : undefined;
  if (!clause.field) return 'Choose a question.';
  const target = listFields(model).find((l) => l.field.id === clause.field);
  if (!target) return 'That question is no longer in the form. Choose another one.';
  if (!opNeedsValue(clause.op)) return undefined;
  const v = clause.value;
  if (v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)) return 'Enter the answer to compare with.';
  if ((clause.op === 'gt' || clause.op === 'lt') && typeof v !== 'number') return 'Enter a number to compare with.';
  return undefined;
}

export interface RuleCheck {
  /** Clause index → problem. */
  clauseProblems: Map<number, string>;
  /** Circular chains this rule would create, as field-id paths (e.g. `['a', 'b', 'a']`). */
  cycles: string[][];
  /** The model with the draft applied (only meaningful when `ok`). */
  next: FormModel;
  ok: boolean;
}

/** Applies a draft to an element's rule and checks it. Saving is blocked unless `ok`. */
export function checkRule(model: FormModel, elementId: string, kind: RuleKind, draft: RuleDraft): RuleCheck {
  const clauseProblems = new Map<number, string>();
  draft.clauses.forEach((c, i) => {
    const p = clauseProblem(model, c);
    if (p) clauseProblems.set(i, p);
  });
  const next = applyRule(model, elementId, kind, draftToCondition(draft));
  const before = new Set(detectRuleCycles(model).cycles.map((c) => c.join('>')));
  const cycles = detectRuleCycles(next).cycles.filter((c) => c.includes(elementId) || !before.has(c.join('>')));
  return { clauseProblems, cycles, next, ok: clauseProblems.size === 0 && cycles.length === 0 };
}

/** Sets or clears one rule on an element. `requiredWhen` also clears "always required". */
export function applyRule(model: FormModel, elementId: string, kind: RuleKind, cond: Condition | undefined): FormModel {
  const el = getElement(model, elementId);
  if (!el) return model;
  const patch: Record<string, unknown> = { [kind]: cond };
  if (kind === 'requiredWhen' && cond && 'required' in el) patch.required = false;
  return updateElement(model, elementId, patch);
}
