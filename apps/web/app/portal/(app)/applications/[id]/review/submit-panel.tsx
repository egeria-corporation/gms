// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { compileForm, FormModelSchema } from '@gms/forms';
import { GmsForm } from '@gms/forms/react';
import { Alert, Button, CheckboxField, Field, Input, Textarea, ValidationSummary } from '@gms/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import { submitApplicationAction } from './actions';

export interface SubmitPanelProps {
  applicationId: string;
  model: unknown;
  data: Record<string, unknown>;
  serverErrors: { pointer: string; message: string; fieldId?: string; pageId?: string }[];
  canSubmit: boolean;
  deadlineMessage: string | null;
  inGrace: boolean;
  aiPolicy: 'allowed' | 'disclosure' | 'prohibited';
  disclosurePrompt: string;
  formHasDisclosure: boolean;
  signerName: string;
}

export function SubmitPanel(p: SubmitPanelProps) {
  const router = useRouter();
  const compiled = useMemo(() => compileForm(FormModelSchema.parse(p.model)), [p.model]);
  const [name, setName] = useState(p.signerName);
  const [agreed, setAgreed] = useState(false);
  const [disclosure, setDisclosure] = useState(typeof p.data.ai_disclosure === 'string' ? (p.data.ai_disclosure as string) : '');
  const [errors, setErrors] = useState<{ fieldId: string; message: string }[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const idem = useMemo(() => crypto.randomUUID(), []);
  const pageOf = (fieldId?: string) => compiled.pages.find((pg) => pg.fieldIds.includes(fieldId ?? ''))?.id;

  return (
    <div className="grid gap-8">
      {p.serverErrors.length ? (
        <div className="grid gap-3">
          <ValidationSummary
            title={`${p.serverErrors.length} answer${p.serverErrors.length === 1 ? ' needs' : 's need'} attention before you can submit`}
            errors={p.serverErrors.map((e) => ({ fieldId: `fix-${e.fieldId ?? e.pointer}`, message: e.message }))}
          />
          <ul className="grid gap-1 text-sm">
            {p.serverErrors.map((e) => (
              <li key={e.pointer} id={`fix-${e.fieldId ?? e.pointer}`}>
                <Link className="text-link underline" href={`/portal/applications/${p.applicationId}/form?page=${pageOf(e.fieldId) ?? ''}#field-${e.fieldId ?? ''}`}>
                  Fix: {e.message}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <section aria-labelledby="answers-h" className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="answers-h" className="font-heading text-xl font-semibold">
            Your answers
          </h2>
          <Button asChild variant="secondary">
            <Link href={`/portal/applications/${p.applicationId}/form`}>Edit answers</Link>
          </Button>
        </div>
        <GmsForm compiled={compiled} data={p.data} mode="review" density="applicant" fileHref={(f) => `/portal/applications/${p.applicationId}/files/${f.fileId}`} />
      </section>

      <section aria-labelledby="submit-h" className="grid gap-5 rounded-xl border bg-card p-5">
        <h2 id="submit-h" className="font-heading text-xl font-semibold">
          Submit
        </h2>
        {p.deadlineMessage ? <Alert variant={p.inGrace ? 'warning' : 'danger'} title={p.inGrace ? 'Grace period' : 'The deadline has passed'}>{p.deadlineMessage}</Alert> : null}
        {problem ? <Alert variant="danger" title="Not submitted yet">{problem}</Alert> : null}
        {errors.length ? <ValidationSummary errors={errors} title="Please fix these first" /> : null}
        {p.aiPolicy === 'disclosure' && !p.formHasDisclosure ? (
          <Field label="AI-assistance disclosure" htmlFor="ai-disclosure" description={p.disclosurePrompt} required>
            <Textarea id="ai-disclosure" rows={3} value={disclosure} onChange={(e) => setDisclosure(e.target.value)} />
          </Field>
        ) : null}
        <Field label="Type your full name to sign" htmlFor="attest-name" description="By typing your name you confirm the information is true and complete to the best of your knowledge.">
          <Input id="attest-name" inputSize="lg" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <CheckboxField id="attest-agree" size="lg" label="I confirm this application is true and complete, and I’m allowed to submit it for my organization." checked={agreed} onCheckedChange={(c) => setAgreed(c === true)} />
        <p className="text-sm text-muted-foreground">After you submit, you can’t change your answers. You’ll get a receipt by email right away.</p>
        <div>
          <Button
            size="lg"
            disabled={!p.canSubmit}
            pending={pending}
            pendingLabel="Submitting…"
            onClick={() => {
              const errs: { fieldId: string; message: string }[] = [];
              if (name.trim().length < 2) errs.push({ fieldId: 'attest-name', message: 'Type your full name to sign.' });
              if (!agreed) errs.push({ fieldId: 'attest-agree', message: 'Check the box to confirm.' });
              if (p.aiPolicy === 'disclosure' && !p.formHasDisclosure && !disclosure.trim()) errs.push({ fieldId: 'ai-disclosure', message: 'Tell the foundation whether you used AI tools, and how.' });
              setErrors(errs);
              if (errs.length) return;
              start(async () => {
                const r = await submitApplicationAction({ applicationId: p.applicationId, typedName: name.trim(), aiDisclosure: p.formHasDisclosure ? ((p.data.ai_disclosure as string) ?? null) : disclosure.trim() || null, idempotencyKey: idem });
                if (r.ok) router.push(`/portal/applications/${p.applicationId}/submitted`);
                else setProblem(r.problem.errors?.length ? `${r.problem.detail} ${r.problem.errors.map((e) => e.message).slice(0, 3).join(' ')}` : r.problem.detail);
              });
            }}
          >
            Submit application
          </Button>
        </div>
      </section>
    </div>
  );
}
