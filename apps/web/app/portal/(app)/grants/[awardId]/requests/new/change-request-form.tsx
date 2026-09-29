// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';
import { Alert, Button, Field, Input, RadioGroup, RadioOption, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Textarea } from '@gms/ui';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { requestChangeAction } from '../../../actions';

export function ChangeRequestForm({ awardId, reports }: { awardId: string; reports: { id: string; title: string; dueDate: string }[] }) {
  const router = useRouter();
  const [kind, setKind] = useState<'extension' | 'amendment' | 'budget_change'>('extension');
  const [requirementId, setRequirementId] = useState(reports[0]?.id ?? '');
  const [newDueDate, setNewDueDate] = useState('');
  const [newEndDate, setNewEndDate] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="grid gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await requestChangeAction({
            awardId,
            kind,
            reason,
            ...(kind === 'extension' ? { requirementId: requirementId || undefined } : {}),
            details: kind === 'extension' ? { newDueDate: newDueDate || undefined } : kind === 'amendment' ? { newEndDate: newEndDate || undefined } : {},
          });
          if (r.ok) router.push(`/portal/grants/${awardId}`);
          else setError(r.problem.errors?.[0]?.message ?? r.problem.detail);
        });
      }}
    >
      {error ? <Alert variant="danger" title="Request not sent">{error}</Alert> : null}
      <fieldset className="grid gap-2">
        <legend className="mb-1 font-medium">What do you need?</legend>
        <RadioGroup value={kind} onValueChange={(v) => setKind(v as typeof kind)} className="grid gap-2">
          <RadioOption value="extension" id="k-ext" label="More time for a report" />
          <RadioOption value="amendment" id="k-amd" label="A change to the grant (for example, a later end date)" />
          <RadioOption value="budget_change" id="k-bud" label="Move money between budget lines" />
        </RadioGroup>
      </fieldset>
      {kind === 'extension' ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Which report?" htmlFor="cr-report">
            <Select value={requirementId} onValueChange={setRequirementId}>
              <SelectTrigger id="cr-report" size="lg">
                <SelectValue placeholder="Choose a report" />
              </SelectTrigger>
              <SelectContent>
                {reports.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.title} (due {r.dueDate})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="New due date you’re asking for" htmlFor="cr-due">
            <Input id="cr-due" type="date" inputSize="lg" value={newDueDate} onChange={(e) => setNewDueDate(e.target.value)} />
          </Field>
        </div>
      ) : kind === 'amendment' ? (
        <Field label="New grant end date (if you need one)" htmlFor="cr-end" optional>
          <Input id="cr-end" type="date" inputSize="lg" value={newEndDate} onChange={(e) => setNewEndDate(e.target.value)} />
        </Field>
      ) : null}
      <Field label="Tell us why" htmlFor="cr-reason" description="A few sentences is plenty. The program team reads every request." required>
        <Textarea id="cr-reason" rows={5} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <div>
        <Button type="submit" size="lg" pending={pending} pendingLabel="Sending…">
          Send request
        </Button>
      </div>
    </form>
  );
}
