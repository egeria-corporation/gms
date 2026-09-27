// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { compileForm, FormModelSchema } from '@gms/forms';
import { GmsForm, GmsFormPager, pickChanged, useAutosave } from '@gms/forms/react';
import { Alert, AutosaveIndicator, Button, CheckboxField, Field, Input } from '@gms/ui';
import { CheckCircle2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import { saveReportAction, submitReportAction } from './actions';

export function ReportForm({ requirementId, awardId, model, initialData, readOnly, signerName }: { requirementId: string; awardId: string; model: unknown; initialData: Record<string, unknown>; readOnly: boolean; signerName: string }) {
  const router = useRouter();
  const compiled = useMemo(() => compileForm(FormModelSchema.parse(model)), [model]);
  const [data, setData] = useState(initialData);
  const [pageId, setPageId] = useState(compiled.pages[0]?.id ?? '');
  const [name, setName] = useState(signerName);
  const [agreed, setAgreed] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();
  const autosave = useAutosave({
    save: async (changed) => {
      const r = await saveReportAction(requirementId, changed);
      if (!r.ok) throw new Error(r.message ?? 'Save failed');
      return { etag: String(Date.now()), errors: r.errors };
    },
  });
  if (done) {
    return (
      <Alert variant="success" title="Report submitted" icon={<CheckCircle2 aria-hidden="true" />}>
        Thank you. The program team will review it and let you know if they have questions.
        <Button className="mt-3" onClick={() => router.push(`/portal/grants/${awardId}`)}>
          Back to your grant
        </Button>
      </Alert>
    );
  }
  if (readOnly) return <GmsForm compiled={compiled} data={data} mode="review" density="applicant" />;
  const isLast = compiled.pages.findIndex((p) => p.id === pageId) === compiled.pages.length - 1;
  return (
    <div className="grid gap-5">
      <AutosaveIndicator {...autosave.indicator} />
      <GmsForm
        compiled={compiled}
        data={data}
        onChange={(next, ids) => {
          setData(next);
          autosave.queue(pickChanged(next, ids));
        }}
        errors={autosave.errors}
        currentPageId={pageId}
        onPageChange={setPageId}
        density="applicant"
      />
      <GmsFormPager pages={compiled.pages.map((p) => ({ id: p.id, title: p.title }))} currentPageId={pageId} onPageChange={setPageId} density="applicant" />
      {isLast ? (
        <section className="grid gap-4 rounded-xl border bg-card p-5" aria-labelledby="rep-submit">
          <h2 id="rep-submit" className="font-heading text-lg font-semibold">
            Submit your report
          </h2>
          {problem ? <Alert variant="danger" title="Not submitted yet">{problem}</Alert> : null}
          <Field label="Type your full name to sign" htmlFor="rep-name">
            <Input id="rep-name" inputSize="lg" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <CheckboxField id="rep-agree" size="lg" label="This report is accurate to the best of my knowledge." checked={agreed} onCheckedChange={(c) => setAgreed(c === true)} />
          <div>
            <Button
              size="lg"
              pending={pending}
              pendingLabel="Submitting…"
              disabled={!agreed || name.trim().length < 2}
              onClick={() =>
                start(async () => {
                  await autosave.flush();
                  const r = await submitReportAction(requirementId, awardId, name.trim());
                  if (r.ok) setDone(true);
                  else setProblem(r.problem.errors?.length ? `${r.problem.detail} ${r.problem.errors.map((e) => e.message).slice(0, 3).join(' ')}` : r.problem.detail);
                })
              }
            >
              Submit report
            </Button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
