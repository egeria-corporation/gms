// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import {
  Alert,
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
} from '@gms/ui';
import * as React from 'react';
import { SAMPLE_CG_FORM_LIBRARY_JSON } from '../../fixtures';
import { type CgFormLibraryDocument, importCommonGrantsForm, type ImportResult } from '../../import';
import { FORM_TEMPLATES, type FormTemplate } from '../../library';
import { type FormModel, listFields } from '../../model';
import { isPlainObject } from '../../util';

export interface TemplatesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Extra (workspace) templates listed before the built-in ones. */
  templates?: readonly FormTemplate[];
  /** Replaces the current form. */
  onReplace: (model: FormModel, source: string) => void;
  /** True when the current form has questions (so replacing needs a confirmation). */
  hasContent: boolean;
  initialTab?: 'templates' | 'import';
}

/** Parses pasted JSON and runs the CommonGrants importer. */
export function runImport(text: string): { result?: ImportResult; error?: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return { error: `That isn't valid JSON. ${e instanceof Error ? e.message : ''}`.trim() };
  }
  if (!isPlainObject(parsed)) return { error: 'Paste a JSON object with a jsonSchema (and optionally a uiSchema).' };
  try {
    return { result: importCommonGrantsForm(parsed as CgFormLibraryDocument) };
  } catch (e) {
    return { error: `We couldn't import this document. ${e instanceof Error ? e.message : ''}`.trim() };
  }
}

export function TemplatesDialog({ open, onOpenChange, templates = [], onReplace, hasContent, initialTab = 'templates' }: TemplatesDialogProps) {
  const all = [...templates, ...FORM_TEMPLATES];
  const [tab, setTab] = React.useState(initialTab);
  const [pending, setPending] = React.useState<{ model: FormModel; name: string } | null>(null);
  const [json, setJson] = React.useState('');
  const [report, setReport] = React.useState<{ result?: ImportResult; error?: string } | null>(null);
  React.useEffect(() => {
    if (open) {
      setTab(initialTab);
      setPending(null);
    }
  }, [open, initialTab]);

  const choose = (model: FormModel, name: string) => {
    if (hasContent) setPending({ model, name });
    else {
      onReplace(structuredClone(model), name);
      onOpenChange(false);
    }
  };
  const confirm = () => {
    if (!pending) return;
    onReplace(structuredClone(pending.model), pending.name);
    setPending(null);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="xl">
        <DialogHeader>
          <DialogTitle>Start from a template or import</DialogTitle>
          <DialogDescription>Replace this form with a ready-made one, or bring in a CommonGrants form-library document.</DialogDescription>
        </DialogHeader>
        {pending ? (
          <div className="grid gap-4">
            <Alert variant="warning" title={`Replace this form with “${pending.name}”?`}>
              Every page and question in the current form will be replaced. You can undo this with Undo (Ctrl+Z) until you leave the builder.
            </Alert>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setPending(null)}>
                Cancel
              </Button>
              <Button type="button" onClick={confirm}>
                Replace form
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <Tabs value={tab} onValueChange={(v) => setTab(v as 'templates' | 'import')}>
            <TabsList>
              <TabsTrigger value="templates">Templates</TabsTrigger>
              <TabsTrigger value="import">Import CommonGrants JSON</TabsTrigger>
            </TabsList>
            <TabsContent value="templates">
              <ul className="grid gap-3 sm:grid-cols-2">
                {all.map((t) => {
                  const questions = listFields(t.model).length;
                  return (
                    <li key={t.key} className="flex flex-col gap-2 rounded-lg border bg-card p-4">
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="font-heading font-semibold">{t.name}</h3>
                        <Badge variant="muted">{t.kind === 'loi' ? 'Letter of inquiry' : t.kind === 'report' ? 'Report' : 'Application'}</Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">{t.description}</p>
                      <p className="text-xs text-muted-foreground">
                        {t.model.pages.length} {t.model.pages.length === 1 ? 'page' : 'pages'} · {questions} {questions === 1 ? 'question' : 'questions'}
                      </p>
                      <Button type="button" variant="outline" size="sm" className="mt-auto self-start" onClick={() => choose(t.model, t.name)}>
                        Use this template<span className="sr-only">: {t.name}</span>
                      </Button>
                    </li>
                  );
                })}
              </ul>
            </TabsContent>
            <TabsContent value="import" className="grid gap-4">
              <Field
                label="CommonGrants form JSON"
                htmlFor="builder-import-json"
                description="Paste a form-library document with a jsonSchema and, optionally, a uiSchema and CommonGrants mappings."
              >
                <Textarea rows={8} className="font-mono text-xs" value={json} onChange={(e) => setJson(e.currentTarget.value)} />
              </Field>
              <div className="flex flex-wrap gap-2">
                <Button type="button" onClick={() => setReport(runImport(json))} disabled={!json.trim()}>
                  Check import
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    const text = JSON.stringify(SAMPLE_CG_FORM_LIBRARY_JSON, null, 2);
                    setJson(text);
                    setReport(runImport(text));
                  }}
                >
                  Try the sample document
                </Button>
              </div>
              {report?.error ? (
                <Alert variant="danger" role="alert" title="Import didn’t work">
                  {report.error}
                </Alert>
              ) : null}
              {report?.result ? <ImportReport result={report.result} onUse={() => choose(report.result!.model, report.result!.model.title)} /> : null}
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ImportReport({ result, onUse }: { result: ImportResult; onUse: () => void }) {
  return (
    <section aria-label="Import report" className="grid gap-3 rounded-lg border p-4" role="status">
      <p className="font-medium">
        “{result.model.title}”: {result.mapped.length} {result.mapped.length === 1 ? 'question' : 'questions'} imported, {result.skipped.length} skipped.
      </p>
      {result.mapped.length ? (
        <details open={result.mapped.length <= 12}>
          <summary className="cursor-pointer text-sm font-medium">Imported</summary>
          <ul className="mt-2 grid gap-1 text-sm">
            {result.mapped.map((m) => (
              <li key={m.fieldId}>
                <span className="font-mono">{m.property}</span> → <span className="font-mono">{m.fieldId}</span> <span className="text-muted-foreground">({m.type.replace(/_/g, ' ')})</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {result.skipped.length ? (
        <div className="grid gap-1">
          <p className="text-sm font-medium text-status-warning-fg">Skipped — add these by hand</p>
          <ul className="grid gap-1 text-sm">
            {result.skipped.map((s, i) => (
              <li key={i}>
                <span className="font-mono">{s.path}</span>: {s.reason}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {result.warnings.length ? (
        <div className="grid gap-1">
          <p className="text-sm font-medium">Check these</p>
          <ul className="list-disc pl-5 text-sm">
            {result.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <Button type="button" className="justify-self-start" onClick={onUse}>
        Replace form with import
      </Button>
    </section>
  );
}
