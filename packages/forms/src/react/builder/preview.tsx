// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';
import { Alert, Button, cn } from '@gms/ui';
import { Eraser, Monitor, Play, Smartphone, Sparkles } from 'lucide-react';
import * as React from 'react';
import { type CompiledForm, compileForm, FormCompileError } from '../../compile';
import { LOI_VALID_RESPONSE } from '../../fixtures';
import { LOI_FIELD_IDS } from '../../library';
import { type FormModel, listFields } from '../../model';
import type { ResponseData } from '../../util';
import { type ValidationResult, validateResponses } from '../../validate';
import { domIdForPointer, type FileRef } from '../form-state';
import { GmsForm } from '../gms-form';
import { FormProgressRail, GmsFormPager } from '../navigation';

/** Compiles a model for preview, returning a readable error instead of throwing. */
export function tryCompile(model: FormModel): { compiled?: CompiledForm; error?: string } {
  try {
    return { compiled: compileForm(model) };
  } catch (e) {
    if (e instanceof FormCompileError) return { error: e.message };
    return { error: e instanceof Error ? e.message : 'This form cannot be previewed yet.' };
  }
}

/** True when the model contains every Youth Arts LOI question (so the sample answers fit). */
export function isLoiModel(model: FormModel): boolean {
  const ids = new Set(listFields(model).map((l) => l.field.id));
  return Object.values(LOI_FIELD_IDS).every((id) => ids.has(id));
}

const PREFIX = 'preview-';

export interface FormPreviewProps {
  model: FormModel;
}

/** FB-06: fill in the form as an applicant would, on a desktop or phone-sized frame, and run a test submission. */
export function FormPreview({ model }: FormPreviewProps) {
  const { compiled, error } = React.useMemo(() => tryCompile(model), [model]);
  const [device, setDevice] = React.useState<'desktop' | 'mobile'>('desktop');
  const [data, setData] = React.useState<ResponseData>({});
  const [pageId, setPageId] = React.useState<string>('');
  const [result, setResult] = React.useState<ValidationResult | null>(null);
  const [attempt, setAttempt] = React.useState(0);
  const pendingFocus = React.useRef<string | null>(null);
  const uploads = React.useRef(0);

  const currentPage = compiled?.pages.find((p) => p.id === pageId) ? pageId : (compiled?.pages[0]?.id ?? '');
  const loi = isLoiModel(model);

  React.useEffect(() => {
    const id = pendingFocus.current;
    if (!id) return;
    pendingFocus.current = null;
    const el = document.getElementById(id);
    const target = el?.matches('input, select, textarea, button') ? el : el?.querySelector<HTMLElement>('input, select, textarea, button');
    (target ?? el)?.focus();
  });

  if (!compiled) {
    return (
      <Alert variant="danger" title="This form can’t be previewed yet">
        {error}
      </Alert>
    );
  }

  const runTest = () => {
    setResult(validateResponses(compiled, data, { mode: 'submit' }));
    setAttempt((a) => a + 1);
  };
  const onChange = (next: ResponseData) => {
    setData(next);
    // After a test run, keep the results current as problems get fixed.
    if (result) setResult(validateResponses(compiled, next, { mode: 'submit' }));
  };
  const jump = (fieldPageId: string, pointer: string) => {
    setPageId(fieldPageId);
    pendingFocus.current = domIdForPointer(pointer, PREFIX);
  };
  const onUpload = async (_fieldId: string, file: File): Promise<FileRef> => {
    await new Promise((r) => setTimeout(r, 300));
    uploads.current += 1;
    return { fileId: `preview_file_${uploads.current}`, name: file.name, size: file.size, mimeType: file.type || 'application/octet-stream' };
  };
  const labelOf = (id: string) => compiled.fieldMeta[id]?.label ?? id;

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="group" aria-label="Preview size" className="inline-flex rounded-md border bg-muted p-0.5">
          <Button type="button" size="sm" variant={device === 'desktop' ? 'secondary' : 'ghost'} aria-pressed={device === 'desktop'} onClick={() => setDevice('desktop')}>
            <Monitor aria-hidden="true" />
            Desktop
          </Button>
          <Button type="button" size="sm" variant={device === 'mobile' ? 'secondary' : 'ghost'} aria-pressed={device === 'mobile'} onClick={() => setDevice('mobile')}>
            <Smartphone aria-hidden="true" />
            Phone (390 px)
          </Button>
        </div>
        <div className="flex flex-wrap gap-2">
          {loi ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                const next = structuredClone(LOI_VALID_RESPONSE);
                setData(next);
                if (result) setResult(validateResponses(compiled, next, { mode: 'submit' }));
              }}
            >
              <Sparkles aria-hidden="true" />
              Fill with sample answers
            </Button>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setData({});
              setResult(null);
            }}
          >
            <Eraser aria-hidden="true" />
            Clear answers
          </Button>
          <Button type="button" size="sm" onClick={runTest}>
            <Play aria-hidden="true" />
            Run test submission
          </Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">This is a preview. Nothing you type here is saved, and uploads stay in this browser tab.</p>

      {result ? <TestResults result={result} labelOf={labelOf} onJump={jump} pages={compiled.pages} attempt={attempt} /> : null}

      <div className={cn('mx-auto w-full rounded-xl border bg-background shadow-soft', device === 'mobile' ? 'max-w-[390px]' : 'max-w-5xl')}>
        <div className={cn('grid gap-6 p-4', device === 'desktop' && 'md:grid-cols-[14rem_1fr] md:p-6')}>
          {device === 'desktop' ? (
            <aside className="hidden md:block">
              <FormProgressRail compiled={compiled} data={data} errors={result?.errors} currentPageId={currentPage} onSelect={setPageId} />
            </aside>
          ) : null}
          <div className="grid min-w-0 gap-6">
            <div className="grid gap-1">
              <p className="text-sm font-medium text-muted-foreground">{compiled.title}</p>
            </div>
            <GmsForm
              compiled={compiled}
              data={data}
              onChange={onChange}
              errors={result?.errors}
              currentPageId={currentPage}
              onPageChange={setPageId}
              onUpload={onUpload}
              idPrefix={PREFIX}
              density="applicant"
              headingLevel={3}
            />
            <GmsFormPager pages={compiled.pages} currentPageId={currentPage} onPageChange={setPageId} onFinish={runTest} finishLabel="Run test submission" />
          </div>
        </div>
      </div>
    </div>
  );
}

function TestResults({
  result,
  labelOf,
  onJump,
  pages,
  attempt,
}: {
  result: ValidationResult;
  labelOf: (id: string) => string;
  onJump: (pageId: string, pointer: string) => void;
  pages: CompiledForm['pages'];
  attempt: number;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (attempt > 0) ref.current?.focus();
  }, [attempt]);
  const pageTitle = (id: string) => pages.find((p) => p.id === id)?.title ?? id;
  return (
    <div ref={ref} tabIndex={-1} className="grid gap-3 outline-offset-4" aria-label="Test submission results">
      {result.valid ? (
        <Alert variant="success" role="status" title="This test submission would go through">
          Every required question is answered and every answer passes its checks.
        </Alert>
      ) : (
        <Alert variant="danger" role="status" title={`${result.errors.length} ${result.errors.length === 1 ? 'problem' : 'problems'} would stop this submission`}>
          <ul className="grid gap-1">
            {result.errors.map((e) => (
              <li key={e.pointer}>
                <button type="button" className="text-left underline underline-offset-2" onClick={() => onJump(e.pageId, e.pointer)}>
                  {pageTitle(e.pageId)} → {labelOf(e.fieldId)} — {e.message}
                </button>
              </li>
            ))}
          </ul>
        </Alert>
      )}
      {result.knockouts.length ? (
        <Alert variant="warning" title="These answers would mark the applicant as not eligible">
          <ul className="grid gap-1">
            {result.knockouts.map((k) => (
              <li key={k.fieldId}>
                <span className="font-medium">{labelOf(k.fieldId)}:</span> “{k.message}”
              </li>
            ))}
          </ul>
        </Alert>
      ) : null}
    </div>
  );
}
