// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import {
  Alert,
  Button,
  CheckboxField,
  Input,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@gms/ui';
import { Plus, X } from 'lucide-react';
import * as React from 'react';
import { type Condition, type ConditionValue, type FormModel, listFields } from '../../model';
import { describeRule, humanizeFlag, type RuleKind } from '../../rules';
import { deepEqual } from '../../util';
import { elementLabel, getElement } from '../builder-ops';
import { parseNumberInput } from '../money';
import { MoneyInput } from '../renderers/basic';
import { checkRule, type ClauseDraft, conditionToDraft, draftToCondition, opChoices, opKey, opNeedsValue, type RuleDraft } from '../rule-draft';

const PREFIX: Record<RuleKind, string> = {
  visibleWhen: 'Show this',
  enabledWhen: 'Let applicants edit this',
  requiredWhen: 'Require an answer to this',
};

const EMPTY_TEXT: Record<RuleKind, string> = {
  visibleWhen: 'Always shown.',
  enabledWhen: 'Always editable.',
  requiredWhen: 'Never conditionally required.',
};

export interface RuleEditorProps {
  model: FormModel;
  elementId: string;
  kind: RuleKind;
  /** Called with the whole next model when a valid rule is saved or removed. */
  onApply: (next: FormModel) => void;
  readOnly?: boolean;
  flagLabels?: Readonly<Record<string, string>>;
  /** Jump to another element (used by cycle messages). */
  onJump?: (id: string) => void;
}

/**
 * Plain-language rule builder: "Show this question when [question] [is] [value]", with all/any
 * groups. Edits happen on a draft; "Save rule" is blocked while a clause is incomplete or the rule
 * would create a circular dependency (detectRuleCycles).
 */
export function RuleEditor({ model, elementId, kind, onApply, readOnly, flagLabels, onJump }: RuleEditorProps) {
  const element = getElement(model, elementId);
  const current = element ? ((element as Partial<Record<RuleKind, Condition>>)[kind] ?? undefined) : undefined;
  const [draft, setDraft] = React.useState<RuleDraft | null>(null);
  const noun = element?.type === 'section' ? 'section' : element?.type === 'info_block' ? 'text block' : 'question';
  const baseId = React.useId();

  if (!element) return null;
  const parsed = conditionToDraft(current);
  const editing = draft !== null;
  const check = draft ? checkRule(model, elementId, kind, draft) : undefined;
  const changed = draft ? !deepEqual(draftToCondition(draft), current) : false;
  const fieldsById = new Map(listFields(model).map((l) => [l.field.id, l]));
  const ownPage = fieldsById.get(elementId)?.pageIndex ?? model.pages.findIndex((p) => p.elements.some((e) => e.id === elementId || (e.type === 'section' && e.elements.some((c) => c.id === elementId))));
  const flagNames = Object.keys(model.flags);

  const startEditing = () => setDraft(parsed ?? { match: 'all', clauses: [] });
  const addClause = (clause?: ClauseDraft) => setDraft((d) => ({ ...(d ?? { match: 'all', clauses: [] }), clauses: [...(d?.clauses ?? []), clause ?? { kind: 'field', field: '', op: 'eq' }] }));
  const setClause = (i: number, c: ClauseDraft) => setDraft((d) => (d ? { ...d, clauses: d.clauses.map((x, j) => (j === i ? c : x)) } : d));
  const removeClause = (i: number) => setDraft((d) => (d ? { ...d, clauses: d.clauses.filter((_, j) => j !== i) } : d));
  const save = () => {
    if (!check?.ok) return;
    onApply(check.next);
    setDraft(null);
  };
  const removeRule = () => {
    onApply(checkRule(model, elementId, kind, { match: 'all', clauses: [] }).next);
    setDraft(null);
  };

  const labelFor = (id: string) => {
    const el = getElement(model, id);
    return el ? elementLabel(el) : id;
  };

  if (!editing) {
    return (
      <div className="grid gap-2">
        <p className="text-sm">{current ? describeRule(kind, current, model, { flagLabels }) : <span className="text-muted-foreground">{EMPTY_TEXT[kind]}</span>}</p>
        {!readOnly ? (
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={startEditing}>
              {current ? 'Edit rule' : 'Add a rule'}
            </Button>
            {current ? (
              <Button type="button" variant="ghost" size="sm" onClick={removeRule}>
                Remove rule
              </Button>
            ) : null}
          </div>
        ) : null}
        {current && !parsed ? <p className="text-xs text-muted-foreground">This rule has nested groups. Editing it replaces it with a single group of conditions.</p> : null}
      </div>
    );
  }

  const d = draft!;
  const candidates = listFields(model).filter((l) => l.field.id !== elementId);
  return (
    <div className="grid gap-3 rounded-md border bg-muted/30 p-3">
      <p className="text-sm font-medium">
        {PREFIX[kind]} {noun} when{' '}
        {d.clauses.length > 1 ? (
          <>
            <span className="inline-block align-middle">
              <Select value={d.match} onValueChange={(v) => setDraft({ ...d, match: v as 'all' | 'any' })}>
                <SelectTrigger size="sm" className="w-auto" aria-label="How conditions combine">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">all</SelectItem>
                  <SelectItem value="any">any</SelectItem>
                </SelectContent>
              </Select>
            </span>{' '}
            of these are true:
          </>
        ) : (
          'this is true:'
        )}
      </p>
      {d.clauses.length === 0 ? <p className="text-sm text-muted-foreground">Add a condition to start.</p> : null}
      <ol className="grid gap-3">
        {d.clauses.map((c, i) => {
          const problem = check?.clauseProblems.get(i);
          const problemId = `${baseId}-problem-${i}`;
          return (
            <li key={i} className="grid gap-1.5">
              <div className="flex flex-wrap items-start gap-2">
                {c.kind === 'flag' ? (
                  <>
                    <span className="self-center text-sm">Form setting</span>
                    <Select value={c.flag} onValueChange={(v) => setClause(i, { kind: 'flag', flag: v })}>
                      <SelectTrigger size="sm" className="w-auto min-w-40" aria-label={`Condition ${i + 1}: form setting`} aria-describedby={problem ? problemId : undefined}>
                        <SelectValue placeholder="Choose a setting" />
                      </SelectTrigger>
                      <SelectContent>
                        {flagNames.map((f) => (
                          <SelectItem key={f} value={f}>
                            {flagLabels?.[f] ?? humanizeFlag(f)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <span className="self-center text-sm">is on</span>
                  </>
                ) : (
                  <FieldClause
                    index={i}
                    clause={c}
                    model={model}
                    candidates={candidates.map((l) => ({ id: l.field.id, label: l.field.label || l.field.id, pageIndex: l.pageIndex }))}
                    ownPage={ownPage}
                    problemId={problem ? problemId : undefined}
                    onChange={(next) => setClause(i, next)}
                  />
                )}
                <Button type="button" variant="ghost" size="icon-sm" onClick={() => removeClause(i)} aria-label={`Remove condition ${i + 1}`}>
                  <X aria-hidden="true" />
                </Button>
              </div>
              {problem ? (
                <p id={problemId} className="text-xs font-medium text-status-danger-fg">
                  {problem}
                </p>
              ) : null}
            </li>
          );
        })}
      </ol>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => addClause()}>
          <Plus aria-hidden="true" />
          Add condition
        </Button>
        {flagNames.length ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => addClause({ kind: 'flag', flag: flagNames[0]! })}>
            <Plus aria-hidden="true" />
            Add form setting
          </Button>
        ) : null}
      </div>
      {check && check.cycles.length ? (
        <Alert variant="danger" role="alert" title="This rule would create a loop">
          {check.cycles.map((cycle, i) => (
            <p key={i}>
              {cycle.slice(0, -1).map((id, j, arr) => (
                <React.Fragment key={j}>
                  {onJump && id !== elementId ? (
                    <button type="button" className="font-medium underline" onClick={() => onJump(id)}>
                      “{labelFor(id)}”
                    </button>
                  ) : (
                    <span className="font-medium">“{labelFor(id)}”</span>
                  )}
                  {j < arr.length - 1 ? ' depends on ' : ` depends on “${labelFor(cycle[0]!)}”. `}
                </React.Fragment>
              ))}
              None of them could ever appear. Change one of the rules.
            </p>
          ))}
        </Alert>
      ) : null}
      {check?.ok && draftToCondition(d) ? <p className="text-sm text-muted-foreground">Reads as: {describeRule(kind, draftToCondition(d)!, model, { flagLabels })}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" onClick={save} disabled={!check?.ok || !changed}>
          Save rule
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setDraft(null)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function FieldClause({
  index,
  clause,
  model,
  candidates,
  ownPage,
  problemId,
  onChange,
}: {
  index: number;
  clause: Extract<ClauseDraft, { kind: 'field' }>;
  model: FormModel;
  candidates: { id: string; label: string; pageIndex: number }[];
  ownPage: number;
  problemId?: string;
  onChange: (c: ClauseDraft) => void;
}) {
  const target = listFields(model).find((l) => l.field.id === clause.field)?.field;
  const choices = opChoices(target?.type);
  const key = opKey(target?.type, clause);
  const byPage = model.pages.map((p, pi) => ({ page: p, pi, items: candidates.filter((c) => c.pageIndex === pi) })).filter((g) => g.items.length);
  const n = index + 1;
  return (
    <>
      <Select
        value={clause.field}
        onValueChange={(v) => {
          const t = listFields(model).find((l) => l.field.id === v)?.field;
          const first = opChoices(t?.type)[0]!;
          onChange({ kind: 'field', field: v, op: first.op, ...(first.value !== undefined ? { value: first.value } : {}) });
        }}
      >
        <SelectTrigger size="sm" className="w-auto max-w-64 min-w-40" aria-label={`Condition ${n}: question`} aria-describedby={problemId}>
          <SelectValue placeholder="Choose a question" />
        </SelectTrigger>
        <SelectContent>
          {byPage.map((g) => (
            <SelectGroup key={g.page.id}>
              <SelectLabel>
                {g.pi + 1}. {g.page.title || 'Untitled page'}
                {g.pi > ownPage ? ' (later page)' : ''}
              </SelectLabel>
              {g.items.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={key}
        disabled={!clause.field}
        onValueChange={(k) => {
          const choice = choices.find((c) => c.key === k);
          if (!choice) return;
          const keepValue = choice.value === undefined && opNeedsValue(choice.op) && clause.op !== 'in' && choice.op !== 'in' ? clause.value : undefined;
          onChange({ kind: 'field', field: clause.field, op: choice.op, ...(choice.value !== undefined ? { value: choice.value } : keepValue !== undefined ? { value: keepValue } : {}) });
        }}
      >
        <SelectTrigger size="sm" className="w-auto min-w-32" aria-label={`Condition ${n}: comparison`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {choices.map((c) => (
            <SelectItem key={c.key} value={c.key}>
              {c.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {clause.field && opNeedsValue(clause.op) && choices.find((c) => c.key === key)?.value === undefined ? (
        <ConditionValueEditor key={`${clause.field}:${clause.op}`} index={n} clause={clause} target={target} problemId={problemId} onChange={(value) => onChange({ ...clause, ...(value === undefined ? { value: undefined } : { value }) })} />
      ) : null}
    </>
  );
}

export function ConditionValueEditor({
  index,
  clause,
  target,
  problemId,
  onChange,
}: {
  index: number;
  clause: Extract<ClauseDraft, { kind: 'field' }>;
  target: ReturnType<typeof listFields>[number]['field'] | undefined;
  problemId?: string;
  onChange: (v: ConditionValue | undefined) => void;
}) {
  const aria = `Condition ${index}: answer`;
  const options = target && 'options' in target ? target.options : undefined;
  if (options && clause.op === 'in') {
    const selected = Array.isArray(clause.value) ? clause.value : clause.value !== undefined && clause.value !== null ? [clause.value] : [];
    return (
      <fieldset className="grid min-w-48 gap-0.5 rounded-md border bg-card px-2 py-1" aria-describedby={problemId}>
        <legend className="sr-only">{aria}</legend>
        {options.map((o) => (
          <CheckboxField
            key={o.value}
            label={o.label}
            checked={selected.includes(o.value)}
            onCheckedChange={(on) => {
              const set = new Set(selected);
              if (on === true) set.add(o.value);
              else set.delete(o.value);
              const next = options.map((x) => x.value).filter((v) => set.has(v));
              onChange(next.length ? next : undefined);
            }}
          />
        ))}
      </fieldset>
    );
  }
  if (options) {
    return (
      <Select value={typeof clause.value === 'string' ? clause.value : ''} onValueChange={(v) => onChange(v)}>
        <SelectTrigger size="sm" className="w-auto min-w-40" aria-label={aria} aria-describedby={problemId}>
          <SelectValue placeholder="Choose an answer" />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }
  if (target?.type === 'currency') {
    return (
      <MoneyInput size="sm" className="max-w-40" cents={clause.value} aria-label={aria} aria-describedby={problemId} onCents={(v) => onChange(typeof v === 'number' ? v : undefined)} />
    );
  }
  if (target?.type === 'number') {
    return (
      <Input
        inputSize="sm"
        inputMode="decimal"
        className="max-w-32"
        aria-label={aria}
        aria-describedby={problemId}
        defaultValue={typeof clause.value === 'number' ? String(clause.value) : ''}
        onChange={(e) => {
          const n = parseNumberInput(e.currentTarget.value);
          onChange(typeof n === 'number' ? n : undefined);
        }}
      />
    );
  }
  return (
    <Input
      inputSize="sm"
      type={target?.type === 'date' ? 'date' : 'text'}
      className="max-w-56"
      aria-label={aria}
      aria-describedby={problemId}
      value={typeof clause.value === 'string' ? clause.value : ''}
      onChange={(e) => onChange(e.currentTarget.value === '' ? undefined : e.currentTarget.value)}
    />
  );
}
