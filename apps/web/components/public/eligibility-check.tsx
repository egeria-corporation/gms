// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { Alert, Button, CheckboxField, Field, Input, RadioGroup, RadioOption, ValidationSummary } from '@gms/ui';
import { CheckCircle2, Info } from 'lucide-react';
import Link from 'next/link';
import { useState, useTransition } from 'react';
import { checkEligibilityAction } from '@/app/(public)/opportunities/[slug]/actions';

export interface RuleView {
  id: string;
  question: string;
  helpText: string | null;
  kind: 'yes_no' | 'number_max' | 'number_min' | 'select_in' | 'multi_any';
  options: string[];
  unit: string | null;
}

type Answer = boolean | number | string | string[] | null;

export function EligibilityCheck({ opportunityId, slug, rules, open }: { opportunityId: string; slug: string; rules: RuleView[]; open: boolean }) {
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [result, setResult] = useState<null | { eligible: boolean | null; outcomes: { ruleId: string; passed: boolean | null; message?: string }[] }>(null);
  const [missing, setMissing] = useState<{ fieldId: string; message: string }[]>([]);
  const [pending, start] = useTransition();
  const set = (id: string, v: Answer) => setAnswers((a) => ({ ...a, [id]: v }));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const unanswered = rules.filter((r) => {
      const a = answers[r.id];
      return a === undefined || a === '' || (Array.isArray(a) && !a.length);
    });
    if (unanswered.length) {
      setMissing(unanswered.map((r) => ({ fieldId: `rule-${r.id}`, message: `Answer: ${r.question}` })));
      setResult(null);
      return;
    }
    setMissing([]);
    start(async () => {
      const r = await checkEligibilityAction(opportunityId, answers);
      if (r.ok) setResult(r.data);
    });
  }

  const failed = result?.outcomes.filter((o) => o.passed === false) ?? [];

  return (
    <div className="grid gap-6">
      {missing.length ? <ValidationSummary errors={missing} title="Please answer every question" /> : null}
      <form onSubmit={submit} className="grid gap-6" noValidate>
        {rules.map((r) => (
          <div key={r.id} id={`rule-${r.id}`} className="rounded-xl border bg-card p-5">
            {r.kind === 'yes_no' ? (
              <fieldset className="grid gap-3">
                <legend className="font-medium">{r.question}</legend>
                {r.helpText ? <p className="text-sm text-muted-foreground">{r.helpText}</p> : null}
                <RadioGroup
                  value={answers[r.id] === true ? 'yes' : answers[r.id] === false ? 'no' : ''}
                  onValueChange={(v) => set(r.id, v === 'yes')}
                  className="flex gap-6"
                >
                  <RadioOption value="yes" id={`${r.id}-yes`} label="Yes" />
                  <RadioOption value="no" id={`${r.id}-no`} label="No" />
                </RadioGroup>
              </fieldset>
            ) : r.kind === 'number_max' || r.kind === 'number_min' ? (
              <Field
                label={r.question}
                description={r.helpText ?? (r.unit === 'usd' ? 'In U.S. dollars, numbers only.' : undefined)}
                htmlFor={`${r.id}-n`}
              >
                <Input
                  id={`${r.id}-n`}
                  inputMode="decimal"
                  inputSize="lg"
                  value={(answers[r.id] as string | undefined) ?? ''}
                  onChange={(e) => set(r.id, e.target.value)}
                />
              </Field>
            ) : r.kind === 'select_in' ? (
              <fieldset className="grid gap-3">
                <legend className="font-medium">{r.question}</legend>
                <RadioGroup value={(answers[r.id] as string) ?? ''} onValueChange={(v) => set(r.id, v)} className="grid gap-2">
                  {r.options.map((o) => (
                    <RadioOption key={o} value={o} id={`${r.id}-${o}`} label={o} />
                  ))}
                </RadioGroup>
              </fieldset>
            ) : (
              <fieldset className="grid gap-3">
                <legend className="font-medium">{r.question}</legend>
                {r.helpText ? <p className="text-sm text-muted-foreground">{r.helpText}</p> : null}
                <div className="grid gap-2">
                  {r.options.map((o) => {
                    const cur = (answers[r.id] as string[] | undefined) ?? [];
                    return (
                      <CheckboxField
                        key={o}
                        id={`${r.id}-${o}`}
                        label={o}
                        size="lg"
                        checked={cur.includes(o)}
                        onCheckedChange={(c) => set(r.id, c ? [...cur, o] : cur.filter((x) => x !== o))}
                      />
                    );
                  })}
                </div>
              </fieldset>
            )}
          </div>
        ))}
        <div>
          <Button type="submit" size="lg" pending={pending} pendingLabel="Checking…">
            Check my eligibility
          </Button>
        </div>
      </form>
      <div aria-live="polite">
        {result?.eligible === true ? (
          <Alert variant="success" title="Good news — you look eligible" icon={<CheckCircle2 aria-hidden="true" />}>
            <p>Based on your answers, your organization can apply. The foundation makes the final call when it reviews applications.</p>
            {open ? (
              <Button asChild size="lg" className="mt-3">
                <Link href={`/portal/apply/${slug}`}>Start an application</Link>
              </Button>
            ) : null}
          </Alert>
        ) : result?.eligible === false ? (
          <Alert variant="warning" title="This opportunity may not be the right fit" icon={<Info aria-hidden="true" />}>
            <ul className="list-disc pl-5">
              {failed.map((f) => (
                <li key={f.ruleId}>{f.message}</li>
              ))}
            </ul>
            <p className="mt-2">
              That’s okay — many organizations find a better match. See{' '}
              <Link className="underline" href="/opportunities">
                our other opportunities
              </Link>
              , or email us if you think we got this wrong.
            </p>
          </Alert>
        ) : null}
      </div>
    </div>
  );
}
