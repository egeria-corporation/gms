// SPDX-License-Identifier: AGPL-3.0-only
'use client';
// C-04 Eligibility: the pre-check questions (opportunities.set_eligibility). Config shapes match the evaluator
// in packages/domain/src/eligibility.ts: yes_no {required}, number_max {max, unit}, number_min {min},
// select_in / multi_any {options, allowed}.
import {
  Alert,
  Button,
  CheckboxField,
  Field,
  FieldSet,
  Input,
  RadioGroup,
  RadioOption,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from '@gms/ui';
import { ArrowDown, ArrowUp, Plus, Save, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { setEligibilityAction } from '@/app/console/(app)/opportunities/actions';
import { problemMessage, useRunAction } from '../run-action';
import type { EligibilityRuleView, RuleKind } from './types';

const KINDS: { value: RuleKind; label: string; hint: string }[] = [
  { value: 'yes_no', label: 'Yes / no', hint: 'Applicants answer yes or no; one answer passes.' },
  { value: 'number_max', label: 'Number, at most', hint: 'The answer must be at or below a maximum (e.g. annual budget).' },
  { value: 'number_min', label: 'Number, at least', hint: 'The answer must be at or above a minimum (e.g. years operating).' },
  { value: 'select_in', label: 'Pick one', hint: 'Applicants pick one option; some options pass.' },
  { value: 'multi_any', label: 'Pick any', hint: 'Applicants pick several; at least one must be an allowed option.' },
];

function defaultConfig(kind: RuleKind): Record<string, unknown> {
  switch (kind) {
    case 'yes_no':
      return { required: true };
    case 'number_max':
      return { max: 0, unit: 'usd' };
    case 'number_min':
      return { min: 0 };
    case 'select_in':
    case 'multi_any':
      return { options: [], allowed: [] };
  }
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);

/** The config exactly as the evaluator reads it (trimmed options, numbers as numbers). */
function cleanConfig(r: EligibilityRuleView): Record<string, unknown> {
  switch (r.kind) {
    case 'yes_no':
      return { required: r.config.required !== false };
    case 'number_max':
      return { max: Number(r.config.max), unit: r.config.unit === 'count' ? 'count' : 'usd' };
    case 'number_min':
      return { min: Number(r.config.min) };
    case 'select_in':
    case 'multi_any': {
      const options = [...new Set(strings(r.config.options).map((s) => s.trim()).filter(Boolean))];
      return { options, allowed: strings(r.config.allowed).filter((a) => options.includes(a)) };
    }
  }
}

export function EligibilityEditor({ opportunityId, initial, readOnly }: { opportunityId: string; initial: EligibilityRuleView[]; readOnly: boolean }) {
  const { run, pending } = useRunAction();
  const [rules, setRules] = useState<EligibilityRuleView[]>(initial);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const update = (i: number, patch: Partial<EligibilityRuleView>) => {
    setDirty(true);
    setRules((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  };
  const setConfig = (i: number, patch: Record<string, unknown>) => {
    setDirty(true);
    setRules((rs) => rs.map((r, j) => (j === i ? { ...r, config: { ...r.config, ...patch } } : r)));
  };
  const move = (i: number, delta: -1 | 1) => {
    setDirty(true);
    setRules((rs) => {
      const j = i + delta;
      if (j < 0 || j >= rs.length) return rs;
      const next = [...rs];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });
  };

  const save = () => {
    for (const [i, r] of rules.entries()) {
      if (!r.question.trim()) return setError(`Question ${i + 1} needs its question text.`);
      if (!r.knockoutMessage.trim()) return setError(`Question ${i + 1} needs a message for people who don’t qualify.`);
      if ((r.kind === 'select_in' || r.kind === 'multi_any') && strings(r.config.options).length < 2) return setError(`Question ${i + 1} needs at least two options.`);
      if ((r.kind === 'select_in' || r.kind === 'multi_any') && !strings(r.config.allowed).length) return setError(`Question ${i + 1} needs at least one option that qualifies.`);
      if (r.kind === 'number_max' && (r.config.max === '' || !Number.isFinite(Number(r.config.max)))) return setError(`Question ${i + 1} needs a maximum.`);
      if (r.kind === 'number_min' && (r.config.min === '' || !Number.isFinite(Number(r.config.min)))) return setError(`Question ${i + 1} needs a minimum.`);
    }
    setError(null);
    void run(
      () =>
        setEligibilityAction(
          opportunityId,
          rules.map((r) => ({ question: r.question.trim(), helpText: r.helpText.trim() || null, kind: r.kind, config: cleanConfig(r), knockoutMessage: r.knockoutMessage.trim() })),
        ),
      { success: `Saved ${rules.length} eligibility question${rules.length === 1 ? '' : 's'}.` },
    ).then((r) => {
      if (r.ok) setDirty(false);
      else setError(problemMessage(r.problem));
    });
  };

  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted-foreground">
        Applicants answer these before they start. A “no” shows your message and suggests other options, so write it kindly. Questions are asked in this order.
      </p>
      {error ? (
        <Alert variant="danger" title="Not saved" aria-live="polite">
          {error}
        </Alert>
      ) : null}
      {rules.length === 0 ? (
        <Alert variant="info" title="No eligibility questions">
          Anyone can start an application. Publishing works without questions, but a short pre-check saves applicants time.
        </Alert>
      ) : null}
      <ol className="grid gap-3">
        {rules.map((r, i) => {
          const options = strings(r.config.options);
          const allowed = strings(r.config.allowed);
          const idp = `rule-${i}`;
          return (
            <li key={i} className="grid gap-3 rounded-lg border p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">Question {i + 1}</h3>
                {!readOnly ? (
                  <div className="flex gap-1">
                    <Button type="button" variant="ghost" size="sm" onClick={() => move(i, -1)} disabled={i === 0}>
                      <ArrowUp aria-hidden="true" /> Move up
                    </Button>
                    <Button type="button" variant="ghost" size="sm" onClick={() => move(i, 1)} disabled={i === rules.length - 1}>
                      <ArrowDown aria-hidden="true" /> Move down
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setDirty(true);
                        setRules((rs) => rs.filter((_, j) => j !== i));
                      }}
                    >
                      <Trash2 aria-hidden="true" /> Remove
                    </Button>
                  </div>
                ) : null}
              </div>
              <fieldset disabled={readOnly} className="grid gap-3 lg:grid-cols-2">
                <Field label="Question" htmlFor={`${idp}-q`} required className="lg:col-span-2">
                  <Input id={`${idp}-q`} value={r.question} maxLength={500} onChange={(e) => update(i, { question: e.target.value })} />
                </Field>
                <Field label="Kind of answer" htmlFor={`${idp}-kind`} description={KINDS.find((k) => k.value === r.kind)?.hint}>
                  <Select value={r.kind} onValueChange={(v) => update(i, { kind: v as RuleKind, config: defaultConfig(v as RuleKind) })} disabled={readOnly}>
                    <SelectTrigger id={`${idp}-kind`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {KINDS.map((k) => (
                        <SelectItem key={k.value} value={k.value}>
                          {k.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Help text" htmlFor={`${idp}-help`} optional>
                  <Input id={`${idp}-help`} value={r.helpText} maxLength={1000} onChange={(e) => update(i, { helpText: e.target.value })} />
                </Field>

                <div className="lg:col-span-2">
                  {r.kind === 'yes_no' ? (
                    <FieldSet legend="Which answer qualifies?">
                      <RadioGroup value={r.config.required === false ? 'no' : 'yes'} onValueChange={(v) => setConfig(i, { required: v === 'yes' })} className="flex gap-6" disabled={readOnly}>
                        <RadioOption value="yes" label="Yes" />
                        <RadioOption value="no" label="No" />
                      </RadioGroup>
                    </FieldSet>
                  ) : null}
                  {r.kind === 'number_max' ? (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field label="Maximum that qualifies" htmlFor={`${idp}-max`}>
                        <Input id={`${idp}-max`} inputMode="decimal" value={String(r.config.max ?? '')} onChange={(e) => setConfig(i, { max: e.target.value === '' ? '' : Number(e.target.value.replace(/[,$\s]/g, '')) })} />
                      </Field>
                      <Field label="Unit" htmlFor={`${idp}-unit`}>
                        <Select value={r.config.unit === 'count' ? 'count' : 'usd'} onValueChange={(v) => setConfig(i, { unit: v })} disabled={readOnly}>
                          <SelectTrigger id={`${idp}-unit`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="usd">U.S. dollars</SelectItem>
                            <SelectItem value="count">A count</SelectItem>
                          </SelectContent>
                        </Select>
                      </Field>
                    </div>
                  ) : null}
                  {r.kind === 'number_min' ? (
                    <Field label="Minimum that qualifies" htmlFor={`${idp}-min`} className="sm:max-w-xs">
                      <Input id={`${idp}-min`} inputMode="decimal" value={String(r.config.min ?? '')} onChange={(e) => setConfig(i, { min: e.target.value === '' ? '' : Number(e.target.value.replace(/[,$\s]/g, '')) })} />
                    </Field>
                  ) : null}
                  {r.kind === 'select_in' || r.kind === 'multi_any' ? (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field label="Options" htmlFor={`${idp}-opts`} description="One per line.">
                        <Textarea
                          id={`${idp}-opts`}
                          rows={4}
                          value={options.join('\n')}
                          onChange={(e) => {
                            const next = e.target.value.split('\n').map((s) => s.replace(/\s+$/, ''));
                            const clean = next.filter((s) => s.trim());
                            setConfig(i, { options: next, allowed: allowed.filter((a) => clean.includes(a)) });
                          }}
                          onBlur={() => setConfig(i, { options: options.map((s) => s.trim()).filter(Boolean) })}
                        />
                      </Field>
                      <FieldSet legend={r.kind === 'select_in' ? 'Options that qualify' : 'Qualifies if any of these is picked'}>
                        <div className="grid gap-2">
                          {[...new Set(options.filter((o) => o.trim()))].map((o) => (
                            <CheckboxField
                              key={o}
                              label={o}
                              checked={allowed.includes(o)}
                              disabled={readOnly}
                              onCheckedChange={(v) => setConfig(i, { allowed: v === true ? [...new Set([...allowed, o])] : allowed.filter((a) => a !== o) })}
                            />
                          ))}
                          {!options.some((o) => o.trim()) ? <p className="text-sm text-muted-foreground">Add options first.</p> : null}
                        </div>
                      </FieldSet>
                    </div>
                  ) : null}
                </div>

                <Field label="Message when someone doesn’t qualify" htmlFor={`${idp}-ko`} required description="Be kind and point to other options, e.g. a fiscal sponsor or another fund." className="lg:col-span-2">
                  <Textarea id={`${idp}-ko`} rows={2} value={r.knockoutMessage} maxLength={1000} onChange={(e) => update(i, { knockoutMessage: e.target.value })} />
                </Field>
              </fieldset>
            </li>
          );
        })}
      </ol>
      {!readOnly ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={rules.length >= 20}
            onClick={() => {
              setDirty(true);
              setRules((rs) => [...rs, { question: '', helpText: '', kind: 'yes_no', config: defaultConfig('yes_no'), knockoutMessage: '' }]);
            }}
          >
            <Plus aria-hidden="true" /> Add a question
          </Button>
          <div className="flex items-center gap-3">
            {dirty ? <span className="text-xs text-muted-foreground">Unsaved changes</span> : null}
            <Button type="button" size="sm" onClick={save} pending={pending} pendingLabel="Saving…">
              <Save aria-hidden="true" /> Save eligibility questions
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
