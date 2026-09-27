// SPDX-License-Identifier: AGPL-3.0-only
'use client';
// PA-02 client parts: accept / request revisions (with indicator capture) and change-request decisions.
import { formatDateOnly, formatMoney } from '@gms/domain';
import {
  Badge,
  Button,
  Field,
  FieldSet,
  Input,
  RadioGroup,
  RadioOption,
  Textarea,
} from '@gms/ui';
import * as React from 'react';
import { decideChangeAction, reviewReportAction } from '@/app/console/(app)/reports/actions';
import { FeedbackRegion, useRunner } from './client-utils';

export interface IndicatorInput {
  id: string;
  name: string;
  unit: string;
  description: string | null;
  suggested: number | null;
}

export function ReportReviewForm({ requirementId, indicators, periodEnd, granteeName }: { requirementId: string; indicators: IndicatorInput[]; periodEnd: string; granteeName: string }) {
  const [decision, setDecision] = React.useState<'accept' | 'revise'>('accept');
  const [note, setNote] = React.useState('');
  const [values, setValues] = React.useState<Record<string, string>>(() => Object.fromEntries(indicators.map((i) => [i.id, i.suggested === null ? '' : String(i.suggested)])));
  const [period, setPeriod] = React.useState(periodEnd);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const { run, pending, feedback } = useRunner();
  const ids = { note: React.useId(), period: React.useId() };

  return (
    <form
      className="grid gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        const errs: Record<string, string> = {};
        if (decision === 'revise' && !note.trim()) errs.note = `Tell ${granteeName} what to change.`;
        const indicatorValues: { indicatorId: string; value: number; periodEnd?: string }[] = [];
        if (decision === 'accept') {
          for (const i of indicators) {
            const raw = (values[i.id] ?? '').replace(/,/g, '').trim();
            if (!raw) continue;
            const n = Number(raw);
            if (!Number.isFinite(n)) errs[i.id] = 'Enter a number.';
            else indicatorValues.push({ indicatorId: i.id, value: n, periodEnd: period || undefined });
          }
        }
        setErrors(errs);
        if (Object.keys(errs).length) return;
        void run(
          () => reviewReportAction({ requirementId, decision, note, indicators: indicatorValues }),
          () =>
            decision === 'accept'
              ? { variant: 'success', title: 'Report accepted', detail: indicatorValues.length ? `${indicatorValues.length} indicator value(s) recorded. ${granteeName} will be notified.` : `${granteeName} will be notified.` }
              : { variant: 'success', title: 'Revisions requested', detail: `${granteeName} can edit and resubmit the report.` },
        );
      }}
    >
      <FieldSet legend="Your decision">
        <RadioGroup value={decision} onValueChange={(v) => setDecision(v as 'accept' | 'revise')}>
          <RadioOption value="accept" label="Accept the report" description="Clears the overdue flag if no other report on this grant is overdue." />
          <RadioOption value="revise" label="Request revisions" description="The grantee sees your note and resubmits." />
        </RadioGroup>
      </FieldSet>
      {decision === 'accept' && indicators.length ? (
        <FieldSet legend="Indicators" description="Record results reported for this period. Values pre-filled from the report’s answers can be corrected.">
          <div className="grid gap-4 sm:grid-cols-2">
            {indicators.map((i) => (
              <Field key={i.id} label={`${i.name} (${i.unit})`} htmlFor={`ind-${i.id}`} optional error={errors[i.id]} description={i.description ?? undefined}>
                <Input id={`ind-${i.id}`} inputMode="decimal" className="tabular-nums" value={values[i.id] ?? ''} onChange={(e) => setValues((v) => ({ ...v, [i.id]: e.target.value }))} />
              </Field>
            ))}
            <Field label="Period ending" htmlFor={ids.period}>
              <Input id={ids.period} type="date" value={period} onChange={(e) => setPeriod(e.target.value)} />
            </Field>
          </div>
        </FieldSet>
      ) : null}
      <Field label={decision === 'revise' ? 'What should the grantee change?' : 'Note to the grantee'} htmlFor={ids.note} required={decision === 'revise'} optional={decision === 'accept'} error={errors.note}>
        <Textarea id={ids.note} rows={4} maxLength={5000} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <div>
        <Button type="submit" pending={pending} pendingLabel="Saving…" variant={decision === 'revise' ? 'outline' : 'default'}>
          {decision === 'accept' ? 'Accept report' : 'Request revisions'}
        </Button>
      </div>
      <FeedbackRegion feedback={feedback} />
    </form>
  );
}

export interface ChangeRequestView {
  id: string;
  kind: string;
  reason: string;
  status: string;
  createdAt: string;
  requestedBy: string | null;
  viaAgent: boolean;
  decisionNote: string | null;
  details: { newDueDate?: string; newEndDate?: string; amountCents?: number; budgetLines?: { line: string; fromCents: number; toCents: number }[] };
  requirementTitle: string | null;
}

const KIND: Record<string, string> = { extension: 'Report extension', amendment: 'Grant amendment', budget_change: 'Budget change' };

function ChangeDecision({ cr, requirementId }: { cr: ChangeRequestView; requirementId?: string }) {
  const [note, setNote] = React.useState('');
  const { run, pending, feedback } = useRunner();
  const id = React.useId();
  return (
    <div className="grid gap-2">
      <Field label="Note to the grantee" htmlFor={id} optional>
        <Textarea id={id} rows={2} maxLength={5000} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" pending={pending} onClick={() => run(() => decideChangeAction({ changeRequestId: cr.id, approve: true, note, requirementId }), () => ({ variant: 'success', title: 'Approved.' }))}>
          Approve {KIND[cr.kind]?.toLowerCase() ?? 'request'}
        </Button>
        <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => decideChangeAction({ changeRequestId: cr.id, approve: false, note, requirementId }), () => ({ variant: 'info', title: 'Declined.' }))}>
          Decline
        </Button>
      </div>
      <FeedbackRegion feedback={feedback} />
    </div>
  );
}

export function ChangeRequests({ items, canDecide, requirementId }: { items: ChangeRequestView[]; canDecide: boolean; requirementId?: string }) {
  if (!items.length) return <p className="text-sm text-muted-foreground">No change requests on this grant.</p>;
  return (
    <ul className="grid gap-3">
      {items.map((cr) => (
        <li key={cr.id} className="grid gap-2 rounded-md border p-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <strong>{KIND[cr.kind] ?? cr.kind}</strong>
            <Badge variant={cr.status === 'pending' ? 'warning' : cr.status === 'approved' ? 'success' : 'neutral'}>{cr.status === 'pending' ? 'Awaiting decision' : cr.status === 'approved' ? 'Approved' : 'Declined'}</Badge>
            {cr.viaAgent ? <Badge variant="agent">Via agent</Badge> : null}
            <span className="text-xs text-muted-foreground">
              {formatDateOnly(cr.createdAt)}
              {cr.requestedBy ? ` · ${cr.requestedBy}` : ''}
            </span>
          </div>
          <ul className="grid gap-0.5 text-xs text-muted-foreground">
            {cr.requirementTitle ? <li>For: {cr.requirementTitle}</li> : null}
            {cr.details.newDueDate ? <li>New due date asked: {formatDateOnly(cr.details.newDueDate)}</li> : null}
            {cr.details.newEndDate ? <li>New end date asked: {formatDateOnly(cr.details.newEndDate)}</li> : null}
            {typeof cr.details.amountCents === 'number' ? <li>Amount: {formatMoney(cr.details.amountCents)}</li> : null}
            {cr.details.budgetLines?.map((b) => (
              <li key={b.line}>
                {b.line}: {formatMoney(b.fromCents)} → {formatMoney(b.toCents)}
              </li>
            ))}
          </ul>
          <blockquote className="border-l-2 pl-3 whitespace-pre-wrap">
            <span className="sr-only">Grantee’s reason: </span>
            {cr.reason}
          </blockquote>
          {cr.decisionNote ? <p className="text-xs">Decision note: “{cr.decisionNote}”</p> : null}
          {cr.status === 'pending' && canDecide ? <ChangeDecision cr={cr} requirementId={requirementId} /> : null}
        </li>
      ))}
    </ul>
  );
}
