// SPDX-License-Identifier: AGPL-3.0-only
// Plain-language rule descriptions and rule-graph checks (cycles, unknown fields).
import type { CompiledForm } from './compile';
import {
  type Condition,
  conditionFieldRefs,
  type ConditionScalar,
  type ConditionValue,
  type FieldType,
  type FormModel,
  isAllCondition,
  isAnyCondition,
  isFieldCondition,
  isFlagCondition,
  listFields,
  listInfoBlocks,
  type Option,
} from './model';
import { listJoin, money } from './util';

interface LabelInfo {
  label: string;
  type: FieldType;
  options?: Option[];
  currency?: string;
}

type LabelSource = FormModel | CompiledForm;

function isCompiled(source: LabelSource): source is CompiledForm {
  return 'fieldMeta' in source;
}

function labelIndex(source: LabelSource): Map<string, LabelInfo> {
  const map = new Map<string, LabelInfo>();
  if (isCompiled(source)) {
    for (const [id, m] of Object.entries(source.fieldMeta)) map.set(id, { label: m.label, type: m.type, options: m.options, currency: m.currency });
    return map;
  }
  for (const { field } of listFields(source)) {
    map.set(field.id, {
      label: field.label,
      type: field.type,
      ...('options' in field ? { options: field.options } : {}),
      ...(field.type === 'currency' ? { currency: field.currency } : {}),
    });
  }
  return map;
}

/** "aiDisclosure" → "AI disclosure". */
export function humanizeFlag(flag: string): string {
  const words = flag
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .toLowerCase()
    .split(' ')
    .filter(Boolean)
    .map((w) => (w === 'ai' || w === 'ein' || w === 'uei' ? w.toUpperCase() : w));
  const s = words.join(' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function formatScalar(v: ConditionScalar, info: LabelInfo | undefined): string {
  if (v === null) return 'blank';
  if (info?.type === 'yes_no' && typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (info?.type === 'currency' && typeof v === 'number') return money(v, info.currency ?? 'USD');
  if (typeof v === 'number') return v.toLocaleString('en-US');
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  const opt = info?.options?.find((o) => o.value === v);
  return `'${opt?.label ?? v}'`;
}

function formatValue(v: ConditionValue | undefined, info: LabelInfo | undefined, word: 'and' | 'or' = 'or'): string {
  if (v === undefined) return 'blank';
  if (Array.isArray(v)) return listJoin(v.map((x) => formatScalar(x, info)), word);
  return formatScalar(v, info);
}

function describe(cond: Condition, labels: Map<string, LabelInfo>, flagLabels: Readonly<Record<string, string>>, nested: boolean): string {
  if (isFlagCondition(cond)) return `the '${flagLabels[cond.flag] ?? humanizeFlag(cond.flag)}' setting is on`;
  if (isAllCondition(cond) || isAnyCondition(cond)) {
    const parts = (isAllCondition(cond) ? cond.all : cond.any).map((c) => describe(c, labels, flagLabels, true));
    const text = listJoin(parts, isAllCondition(cond) ? 'and' : 'or');
    return nested && parts.length > 1 ? `(${text})` : text;
  }
  if (!isFieldCondition(cond)) return '';
  const info = labels.get(cond.field);
  const subject = info ? `'${info.label}'` : `'${cond.field}' (a question that no longer exists)`;
  const multi = info?.type === 'multi_select' || info?.type === 'checkbox_group';
  switch (cond.op) {
    case 'eq':
      return `${subject} is ${formatValue(cond.value, info, 'and')}`;
    case 'neq':
      return `${subject} is not ${formatValue(cond.value, info, 'and')}`;
    case 'in':
      if (multi) return `${subject} includes ${Array.isArray(cond.value) && cond.value.length > 1 ? 'any of ' : ''}${formatValue(cond.value, info)}`;
      return `${subject} is ${formatValue(cond.value, info)}`;
    case 'gt':
      return `${subject} is more than ${formatValue(cond.value, info)}`;
    case 'lt':
      return `${subject} is less than ${formatValue(cond.value, info)}`;
    case 'truthy':
      if (info?.type === 'yes_no') return `${subject} is Yes`;
      return `${subject} is answered`;
    case 'falsy':
      if (info?.type === 'yes_no') return `${subject} is No or not answered`;
      return `${subject} is blank`;
  }
}

/** "'Is your organization fiscally sponsored?' is Yes" */
export function describeCondition(cond: Condition, source: LabelSource, opts: { flagLabels?: Readonly<Record<string, string>> } = {}): string {
  return describe(cond, labelIndex(source), opts.flagLabels ?? {}, false);
}

export type RuleKind = 'visibleWhen' | 'enabledWhen' | 'requiredWhen';

const RULE_PREFIX: Record<RuleKind, string> = { visibleWhen: 'Show when', enabledWhen: 'Can be edited when', requiredWhen: 'Required when' };

/** "Show when 'Is your organization fiscally sponsored?' is Yes" */
export function describeRule(kind: RuleKind, cond: Condition, source: LabelSource, opts: { flagLabels?: Readonly<Record<string, string>> } = {}): string {
  return `${RULE_PREFIX[kind]} ${describeCondition(cond, source, opts)}`;
}

/** Plain-language summaries of every rule on one field (for the builder's properties panel). */
export function describeFieldRules(model: FormModel, fieldId: string): string[] {
  const loc = listFields(model).find((l) => l.field.id === fieldId);
  if (!loc) return [];
  const out: string[] = [];
  if (loc.section?.visibleWhen) out.push(`${describeRule('visibleWhen', loc.section.visibleWhen, model)} (from the section “${loc.section.title}”)`);
  if (loc.field.visibleWhen) out.push(describeRule('visibleWhen', loc.field.visibleWhen, model));
  if (loc.field.enabledWhen) out.push(describeRule('enabledWhen', loc.field.enabledWhen, model));
  if (loc.field.required) out.push('Always required');
  else if (loc.field.requiredWhen) out.push(describeRule('requiredWhen', loc.field.requiredWhen, model));
  return out;
}

// ---------------------------------------------------------------------------
// Rule graph
// ---------------------------------------------------------------------------

export interface RuleReference {
  /** The field (or info block / section) that has the rule. */
  fieldId: string;
  rule: RuleKind;
  /** The id the rule reads. */
  ref: string;
}

export interface RuleCycleReport {
  /**
   * Each cycle as a path of field ids that returns to its start, e.g. `['a', 'b', 'a']`.
   * A field whose visibility or editability depends on itself is `['a', 'a']`.
   */
  cycles: string[][];
  /** Rules that read an id that is not a question in this form (an error). */
  unknownReferences: RuleReference[];
  /** Rules that read an info block or section, which hold no answer (an error). */
  nonQuestionReferences: RuleReference[];
  /** Rules that read a question on a later page (allowed; the builder may point it out). */
  laterPageReferences: RuleReference[];
}

/**
 * Finds circular rules. Only `visibleWhen` and `enabledWhen` gate whether an applicant can answer,
 * so only they form cycles: if A shows only when B is answered and B shows only when A is answered,
 * neither can ever appear. `requiredWhen` edges are checked for unknown references but cannot
 * deadlock, so they don't count toward cycles.
 */
export function detectRuleCycles(model: FormModel): RuleCycleReport {
  const fields = listFields(model);
  const fieldPage = new Map(fields.map((l) => [l.field.id, l.pageIndex]));
  const nonQuestions = new Set<string>();
  for (const { block } of listInfoBlocks(model)) nonQuestions.add(block.id);
  for (const page of model.pages) for (const el of page.elements) if (el.type === 'section') nonQuestions.add(el.id);

  const unknownReferences: RuleReference[] = [];
  const nonQuestionReferences: RuleReference[] = [];
  const laterPageReferences: RuleReference[] = [];
  const edges = new Map<string, string[]>();
  for (const { field } of fields) edges.set(field.id, []);

  const check = (owner: string, rule: RuleKind, cond: Condition | undefined, ownerPage: number, gating: boolean) => {
    for (const ref of conditionFieldRefs(cond)) {
      const r = { fieldId: owner, rule, ref };
      if (!fieldPage.has(ref)) {
        if (nonQuestions.has(ref)) nonQuestionReferences.push(r);
        else unknownReferences.push(r);
        continue;
      }
      if ((fieldPage.get(ref) ?? 0) > ownerPage) laterPageReferences.push(r);
      if (gating && edges.has(owner)) {
        const list = edges.get(owner)!;
        if (!list.includes(ref)) list.push(ref);
      }
    }
  };

  model.pages.forEach((page, pageIndex) => {
    for (const el of page.elements) {
      if (el.type === 'section') {
        const children = el.elements.filter((c) => c.type !== 'info_block');
        // A section rule gates every question in the section.
        for (const ref of conditionFieldRefs(el.visibleWhen)) {
          if (!fieldPage.has(ref)) {
            (nonQuestions.has(ref) ? nonQuestionReferences : unknownReferences).push({ fieldId: el.id, rule: 'visibleWhen', ref });
            continue;
          }
          if ((fieldPage.get(ref) ?? 0) > pageIndex) laterPageReferences.push({ fieldId: el.id, rule: 'visibleWhen', ref });
          for (const c of children) {
            const list = edges.get(c.id);
            if (list && !list.includes(ref)) list.push(ref);
          }
        }
        for (const c of el.elements) {
          if (c.type === 'info_block') check(c.id, 'visibleWhen', c.visibleWhen, pageIndex, false);
        }
      } else if (el.type === 'info_block') {
        check(el.id, 'visibleWhen', el.visibleWhen, pageIndex, false);
      }
    }
  });
  for (const { field, pageIndex } of fields) {
    check(field.id, 'visibleWhen', field.visibleWhen, pageIndex, true);
    check(field.id, 'enabledWhen', field.enabledWhen, pageIndex, true);
    check(field.id, 'requiredWhen', field.requiredWhen, pageIndex, false);
  }

  return { cycles: findCycles(fields.map((l) => l.field.id), edges), unknownReferences, nonQuestionReferences, laterPageReferences };
}

/** Tarjan's strongly connected components; each SCC with a loop becomes one reported cycle path. */
function findCycles(nodes: readonly string[], edges: ReadonlyMap<string, readonly string[]>): string[][] {
  let index = 0;
  const idx = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const sccs: string[][] = [];

  const strong = (v: string) => {
    idx.set(v, index);
    low.set(v, index);
    index++;
    stack.push(v);
    onStack.add(v);
    for (const w of edges.get(v) ?? []) {
      if (!idx.has(w)) {
        strong(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      } else if (onStack.has(w)) {
        low.set(v, Math.min(low.get(v)!, idx.get(w)!));
      }
    }
    if (low.get(v) === idx.get(v)) {
      const comp: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        comp.push(w);
      } while (w !== v);
      sccs.push(comp);
    }
  };
  for (const n of nodes) if (!idx.has(n)) strong(n);

  const order = new Map(nodes.map((n, i) => [n, i]));
  const cycles: string[][] = [];
  for (const comp of sccs) {
    const members = new Set(comp);
    const start = [...comp].sort((a, b) => order.get(a)! - order.get(b)!)[0]!;
    if (comp.length === 1) {
      if ((edges.get(start) ?? []).includes(start)) cycles.push([start, start]);
      continue;
    }
    cycles.push(cyclePath(start, members, edges));
  }
  return cycles.sort((a, b) => order.get(a[0]!)! - order.get(b[0]!)!);
}

/** A concrete path start → … → start inside one strongly connected component (BFS, shortest). */
function cyclePath(start: string, members: ReadonlySet<string>, edges: ReadonlyMap<string, readonly string[]>): string[] {
  const prev = new Map<string, string>();
  const queue = [start];
  const seen = new Set<string>();
  while (queue.length) {
    const v = queue.shift()!;
    for (const w of edges.get(v) ?? []) {
      if (!members.has(w)) continue;
      if (w === start) {
        const path = [start];
        let cur: string | undefined = v;
        const back: string[] = [];
        while (cur && cur !== start) {
          back.push(cur);
          cur = prev.get(cur);
        }
        return [...path, ...back.reverse(), start];
      }
      if (!seen.has(w)) {
        seen.add(w);
        prev.set(w, v);
        queue.push(w);
      }
    }
  }
  return [start, start];
}
