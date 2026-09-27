// SPDX-License-Identifier: AGPL-3.0-only
'use client';
// D-02 conflict-of-interest declaration: "no conflict" unlocks the application; "conflict" (with a required
// explanation) recuses the reviewer.
import { Alert, Button, Field, FieldSet, RadioGroup, RadioOption, Textarea } from '@gms/ui';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { declareCoiAction } from '../../actions';

export function CoiForm({ assignmentId, initialChoice }: { assignmentId: string; initialChoice?: 'none' | 'conflict' }) {
  const router = useRouter();
  const [choice, setChoice] = useState<'none' | 'conflict' | ''>(initialChoice ?? '');
  const [explanation, setExplanation] = useState('');
  const [errors, setErrors] = useState<{ choice?: string; explanation?: string; form?: string }>({});
  const [pending, start] = useTransition();

  const submit = () => {
    const e: typeof errors = {};
    if (!choice) e.choice = 'Choose one option.';
    if (choice === 'conflict' && !explanation.trim()) e.explanation = 'Briefly describe the conflict so staff can reassign fairly.';
    setErrors(e);
    if (Object.keys(e).length) return;
    start(async () => {
      const r = await declareCoiAction(assignmentId, choice === 'conflict', explanation);
      if (!r.ok) {
        setErrors({ form: r.problem.detail, explanation: r.problem.errors?.find((x) => x.pointer === '/explanation')?.message });
        return;
      }
      // Conflict: the page re-renders as the recusal confirmation. No conflict: open the review.
      if (choice === 'conflict') router.refresh();
      else router.push(`/review/${assignmentId}`);
    });
  };

  return (
    <form
      className="grid gap-6"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      {errors.form ? (
        <Alert variant="danger" role="alert" title="We couldn’t record your declaration">
          {errors.form}
        </Alert>
      ) : null}
      <FieldSet legend="Do you have a conflict of interest with this application?" required error={errors.choice}>
        <RadioGroup value={choice} onValueChange={(v) => setChoice(v as 'none' | 'conflict')} aria-label="Conflict of interest">
          <RadioOption size="lg" value="none" label="I have no conflict" description="You’ll go straight to the application and rubric." />
          <RadioOption size="lg" value="conflict" label="I have a conflict" description="You’ll be recused from this application and staff will reassign it." />
        </RadioGroup>
      </FieldSet>
      {choice === 'conflict' ? (
        <Field label="Describe the conflict" htmlFor="coi-explanation" required error={errors.explanation} description="Only staff see this. For example: “I’m on their board” or “My partner works there.”">
          <Textarea id="coi-explanation" rows={4} textareaSize="lg" maxLength={2000} value={explanation} onChange={(e) => setExplanation(e.target.value)} />
        </Field>
      ) : null}
      <div>
        <Button type="submit" size="lg" pending={pending} pendingLabel="Saving…" variant={choice === 'conflict' ? 'destructive' : 'default'}>
          {choice === 'conflict' ? 'Recuse myself' : 'Confirm and open the application'}
        </Button>
      </div>
    </form>
  );
}
