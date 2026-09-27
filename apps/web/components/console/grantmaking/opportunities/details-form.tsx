// SPDX-License-Identifier: AGPL-3.0-only
'use client';
// C-04 Details: the CommonGrants opportunity fields. Money is typed in dollars and saved as integer cents;
// dates are wall-clock times in the workspace timezone (the action converts them).
import { parseMoneyToCents } from '@gms/domain';
import { MarkdownEditor } from '@gms/forms/react';
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
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { createOpportunityAction, updateOpportunityAction, type OpportunityInput } from '@/app/console/(app)/opportunities/actions';
import { problemMessage, useRunAction } from '../run-action';
import { APPLICANT_TYPES, type OpportunityDetails, type TaxonomyTerm, type TermKind } from './types';

const NO_PROGRAM = '__none__';

const TERM_FIELDS: { kind: TermKind; key: 'causeTerms' | 'geographyTerms' | 'populationTerms'; legend: string }[] = [
  { kind: 'cause', key: 'causeTerms', legend: 'Cause areas' },
  { kind: 'geography', key: 'geographyTerms', legend: 'Geography' },
  { kind: 'population', key: 'populationTerms', legend: 'Populations served' },
];

function moneyError(v: string): string | undefined {
  if (!v.trim()) return undefined;
  const c = parseMoneyToCents(v);
  return c === null || c < 0 ? 'Enter an amount in dollars, like 25,000.' : undefined;
}

function cents(v: string): number | null {
  return v.trim() ? parseMoneyToCents(v) : null;
}

export function DetailsForm({
  opportunityId,
  initial,
  programs,
  terms,
  timeZone,
  readOnly,
  forcedSaveError,
}: {
  opportunityId: string | null;
  initial: OpportunityDetails;
  programs: { id: string; name: string }[];
  terms: TaxonomyTerm[];
  timeZone: string;
  readOnly: boolean;
  forcedSaveError?: boolean;
}) {
  const router = useRouter();
  const { run, pending } = useRunAction();
  const [d, setD] = useState<OpportunityDetails>(initial);
  const [error, setError] = useState<string | null>(forcedSaveError ? 'We couldn’t save your changes: the server did not respond. Your edits are still here — try again.' : null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const set = <K extends keyof OpportunityDetails>(k: K, v: OpportunityDetails[K]) => setD((p) => ({ ...p, [k]: v }));
  const toggle = (k: 'applicantTypes' | 'causeTerms' | 'geographyTerms' | 'populationTerms', v: string, on: boolean) =>
    setD((p) => ({ ...p, [k]: on ? [...new Set([...p[k], v])] : p[k].filter((x) => x !== v) }));

  const validate = (): Record<string, string> => {
    const e: Record<string, string> = {};
    if (!d.title.trim()) e.title = 'Give the opportunity a title.';
    for (const k of ['fundingTotal', 'awardMin', 'awardMax'] as const) {
      const m = moneyError(d[k]);
      if (m) e[k] = m;
    }
    const min = cents(d.awardMin);
    const max = cents(d.awardMax);
    if (min !== null && max !== null && min > max) e.awardMax = 'The largest award must be at least the smallest award.';
    if (d.expectedAwardCount.trim() && !/^\d+$/.test(d.expectedAwardCount.trim())) e.expectedAwardCount = 'Enter a whole number.';
    if (d.contactEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.contactEmail.trim())) e.contactEmail = 'Enter an email address like grants@example.org.';
    if (d.opensAt && d.closesAt && d.opensAt >= d.closesAt) e.closesAt = 'The deadline must be after the open date.';
    if (d.summary.length > 1000) e.summary = 'Keep the summary under 1,000 characters.';
    return e;
  };

  const submit = () => {
    const e = validate();
    setFieldErrors(e);
    if (Object.keys(e).length) {
      setError('Fix the highlighted fields.');
      return;
    }
    setError(null);
    const input: OpportunityInput & { title: string } = {
      title: d.title.trim(),
      summary: d.summary.trim() || null,
      descriptionMd: d.descriptionMd || null,
      eligibilityMd: d.eligibilityMd || null,
      guidelinesMd: d.guidelinesMd || null,
      faq: d.faq.filter((f) => f.q.trim() && f.a.trim()).map((f) => ({ q: f.q.trim(), a: f.a.trim() })),
      fundingTotalCents: cents(d.fundingTotal),
      awardMinCents: cents(d.awardMin),
      awardMaxCents: cents(d.awardMax),
      expectedAwardCount: d.expectedAwardCount.trim() ? Number(d.expectedAwardCount.trim()) : null,
      applicantTypes: d.applicantTypes,
      causeTerms: d.causeTerms,
      geographyTerms: d.geographyTerms,
      populationTerms: d.populationTerms,
      programId: d.programId,
      contactEmail: d.contactEmail.trim() || null,
      visibility: d.visibility,
      decisionExpectedOn: d.decisionExpectedOn || null,
      forecastAt: d.forecastAt || null,
      opensAt: d.opensAt || null,
      closesAt: d.closesAt || null,
    };
    if (opportunityId) {
      void run(() => updateOpportunityAction(opportunityId, input), { success: 'Saved the opportunity.' }).then((r) => {
        if (!r.ok) setError(problemMessage(r.problem));
      });
    } else {
      void run(() => createOpportunityAction(input), {
        success: 'Created a draft opportunity.',
        refresh: false,
        onDone: (data) => router.push(`/console/opportunities/${data.id}?tab=stages`),
      }).then((r) => {
        if (!r.ok) setError(problemMessage(r.problem));
      });
    }
  };

  const faqMove = (i: number, delta: -1 | 1) =>
    setD((p) => {
      const faq = [...p.faq];
      const j = i + delta;
      if (j < 0 || j >= faq.length) return p;
      [faq[i], faq[j]] = [faq[j]!, faq[i]!];
      return { ...p, faq };
    });

  const knownApplicantTypes = new Set<string>(APPLICANT_TYPES.map((t) => t.value));
  const extraApplicantTypes = d.applicantTypes.filter((t) => !knownApplicantTypes.has(t));

  return (
    <form
      className="grid gap-6"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (!readOnly) submit();
      }}
    >
      {error ? (
        <Alert variant="danger" title="Not saved" aria-live="polite">
          {error}
        </Alert>
      ) : null}
      <fieldset disabled={readOnly} className="grid gap-6">
        <div className="grid gap-4 lg:grid-cols-2">
          <Field label="Title" htmlFor="opp-title" required error={fieldErrors.title} className="lg:col-span-2">
            <Input id="opp-title" value={d.title} onChange={(e) => set('title', e.target.value)} maxLength={300} />
          </Field>
          <Field label="Summary" htmlFor="opp-summary" description="One or two sentences for listings and the CommonGrants feed. Required to publish." error={fieldErrors.summary} className="lg:col-span-2">
            <Textarea id="opp-summary" rows={2} value={d.summary} onChange={(e) => set('summary', e.target.value)} maxLength={1000} />
          </Field>
          <Field label="Program" htmlFor="opp-program" description="Links awards to the program’s budget.">
            <Select value={d.programId ?? NO_PROGRAM} onValueChange={(v) => set('programId', v === NO_PROGRAM ? null : v)} disabled={readOnly}>
              <SelectTrigger id="opp-program">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_PROGRAM}>No program</SelectItem>
                {programs.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Contact email" htmlFor="opp-contact" description="Shown to applicants with questions." error={fieldErrors.contactEmail}>
            <Input id="opp-contact" type="email" value={d.contactEmail} onChange={(e) => set('contactEmail', e.target.value)} autoComplete="off" />
          </Field>
        </div>

        <FieldSet legend="Dates" description={`Wall-clock times in the workspace timezone (${timeZone}). Opening and the deadline also set the first stage’s window.`}>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Announce (forecast) on" htmlFor="opp-forecast" optional>
              <Input id="opp-forecast" type="datetime-local" value={d.forecastAt} onChange={(e) => set('forecastAt', e.target.value)} />
            </Field>
            <Field label="Opens" htmlFor="opp-opens" description="Required to publish.">
              <Input id="opp-opens" type="datetime-local" value={d.opensAt} onChange={(e) => set('opensAt', e.target.value)} />
            </Field>
            <Field label="Deadline" htmlFor="opp-closes" description="Required to publish." error={fieldErrors.closesAt}>
              <Input id="opp-closes" type="datetime-local" value={d.closesAt} onChange={(e) => set('closesAt', e.target.value)} />
            </Field>
            <Field label="Decision expected" htmlFor="opp-decision" optional>
              <Input id="opp-decision" type="date" value={d.decisionExpectedOn} onChange={(e) => set('decisionExpectedOn', e.target.value)} />
            </Field>
          </div>
        </FieldSet>

        <FieldSet legend="Funding" description="Amounts in U.S. dollars.">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Total available" htmlFor="opp-total" error={fieldErrors.fundingTotal} optional>
              <Input id="opp-total" inputMode="decimal" value={d.fundingTotal} onChange={(e) => set('fundingTotal', e.target.value)} placeholder="250,000" />
            </Field>
            <Field label="Smallest award" htmlFor="opp-min" error={fieldErrors.awardMin} optional>
              <Input id="opp-min" inputMode="decimal" value={d.awardMin} onChange={(e) => set('awardMin', e.target.value)} placeholder="5,000" />
            </Field>
            <Field label="Largest award" htmlFor="opp-max" error={fieldErrors.awardMax} optional>
              <Input id="opp-max" inputMode="decimal" value={d.awardMax} onChange={(e) => set('awardMax', e.target.value)} placeholder="25,000" />
            </Field>
            <Field label="Expected number of awards" htmlFor="opp-count" error={fieldErrors.expectedAwardCount} optional>
              <Input id="opp-count" inputMode="numeric" value={d.expectedAwardCount} onChange={(e) => set('expectedAwardCount', e.target.value)} />
            </Field>
          </div>
        </FieldSet>

        <FieldSet legend="Who can apply">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {APPLICANT_TYPES.map((t) => (
              <CheckboxField key={t.value} label={t.label} checked={d.applicantTypes.includes(t.value)} onCheckedChange={(v) => toggle('applicantTypes', t.value, v === true)} disabled={readOnly} />
            ))}
            {extraApplicantTypes.map((t) => (
              <CheckboxField key={t} label={`${t} (older value)`} checked onCheckedChange={(v) => toggle('applicantTypes', t, v === true)} disabled={readOnly} />
            ))}
          </div>
        </FieldSet>

        <div className="grid gap-4 lg:grid-cols-3">
          {TERM_FIELDS.map((tf) => {
            const options = terms.filter((t) => t.kind === tf.kind);
            const unknown = d[tf.key].filter((c) => !options.some((o) => o.code === c));
            return (
              <FieldSet key={tf.kind} legend={tf.legend} description={options.length ? undefined : 'No terms yet. Add them under Settings → Taxonomy.'}>
                <div className="grid gap-2">
                  {options.map((o) => (
                    <CheckboxField key={o.code} label={o.label} checked={d[tf.key].includes(o.code)} onCheckedChange={(v) => toggle(tf.key, o.code, v === true)} disabled={readOnly} />
                  ))}
                  {unknown.map((c) => (
                    <CheckboxField key={c} label={`${c} (not in the taxonomy)`} checked onCheckedChange={(v) => toggle(tf.key, c, v === true)} disabled={readOnly} />
                  ))}
                </div>
              </FieldSet>
            );
          })}
        </div>

        <FieldSet legend="Visibility">
          <RadioGroup value={d.visibility} onValueChange={(v) => set('visibility', v as 'public' | 'unlisted')} disabled={readOnly} className="grid gap-2 sm:grid-cols-2">
            <RadioOption value="public" label="Public" description="Listed on your site once published." />
            <RadioOption value="unlisted" label="Unlisted" description="Only people with the link can find it." />
          </RadioGroup>
        </FieldSet>

        <Field label="Description" htmlFor="opp-description" description="What you fund and why. Markdown; use Preview to check it.">
          <MarkdownEditor id="opp-description" value={d.descriptionMd} onChange={(v) => set('descriptionMd', v)} toolbarLabel="Formatting for Description" rows={8} readOnly={readOnly} />
        </Field>
        <Field label="Eligibility" htmlFor="opp-eligibility" description="Who can apply, in plain language. The eligibility questions (next tab) are the automatic pre-check.">
          <MarkdownEditor id="opp-eligibility" value={d.eligibilityMd} onChange={(v) => set('eligibilityMd', v)} toolbarLabel="Formatting for Eligibility" rows={6} readOnly={readOnly} />
        </Field>
        <Field label="Guidelines" htmlFor="opp-guidelines" description="How to apply, what reviewers look for, and key dates.">
          <MarkdownEditor id="opp-guidelines" value={d.guidelinesMd} onChange={(v) => set('guidelinesMd', v)} toolbarLabel="Formatting for Guidelines" rows={8} readOnly={readOnly} />
        </Field>

        <FieldSet legend="Frequently asked questions" description="Shown on the opportunity page and in the CommonGrants feed.">
          <ol className="grid gap-3">
            {d.faq.map((f, i) => (
              <li key={i} className="grid gap-3 rounded-lg border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-medium">Question {i + 1}</span>
                  <div className="flex gap-1">
                    <Button type="button" variant="ghost" size="icon-sm" onClick={() => faqMove(i, -1)} disabled={readOnly || i === 0} aria-label={`Move question ${i + 1} up`}>
                      <ArrowUp aria-hidden="true" />
                    </Button>
                    <Button type="button" variant="ghost" size="icon-sm" onClick={() => faqMove(i, 1)} disabled={readOnly || i === d.faq.length - 1} aria-label={`Move question ${i + 1} down`}>
                      <ArrowDown aria-hidden="true" />
                    </Button>
                    <Button type="button" variant="ghost" size="icon-sm" onClick={() => set('faq', d.faq.filter((_, j) => j !== i))} disabled={readOnly} aria-label={`Remove question ${i + 1}`}>
                      <Trash2 aria-hidden="true" />
                    </Button>
                  </div>
                </div>
                <Field label="Question" htmlFor={`faq-q-${i}`}>
                  <Input id={`faq-q-${i}`} value={f.q} maxLength={500} onChange={(e) => set('faq', d.faq.map((x, j) => (j === i ? { ...x, q: e.target.value } : x)))} />
                </Field>
                <Field label="Answer" htmlFor={`faq-a-${i}`}>
                  <Textarea id={`faq-a-${i}`} rows={2} value={f.a} maxLength={5000} onChange={(e) => set('faq', d.faq.map((x, j) => (j === i ? { ...x, a: e.target.value } : x)))} />
                </Field>
              </li>
            ))}
          </ol>
          {d.faq.length === 0 ? <p className="text-sm text-muted-foreground">No questions yet.</p> : null}
          <div>
            <Button type="button" variant="outline" size="sm" onClick={() => set('faq', [...d.faq, { q: '', a: '' }])} disabled={readOnly || d.faq.length >= 50}>
              <Plus aria-hidden="true" /> Add a question
            </Button>
          </div>
        </FieldSet>
      </fieldset>

      {!readOnly ? (
        <div className="sticky bottom-0 flex justify-end gap-2 border-t bg-background py-3">
          <Button type="submit" pending={pending} pendingLabel="Saving…">
            <Save aria-hidden="true" /> {opportunityId ? 'Save details' : 'Create draft'}
          </Button>
        </div>
      ) : null}
    </form>
  );
}
