// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';
// FB-01 import a CommonGrants form (JSON Schema + UI Schema, form-library style) into a new draft form and list
// the fields that could not be mapped.
import {
  Alert,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from '@gms/ui';
import { FileJson } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { importCommonGrantsAction } from '@/app/console/(app)/forms/actions';
import { problemMessage, useRunAction } from '../run-action';
import { FORM_KINDS, type FormKind } from './kinds';

const DEMO_ERROR = 'The JSON could not be read: Unexpected token } in JSON at position 212. Check for a trailing comma or a missing quote.';

export function ImportFormDialog({ forcedError = false }: { forcedError?: boolean }) {
  const { run, pending } = useRunAction();
  const [open, setOpen] = useState(forcedError);
  const [name, setName] = useState(forcedError ? 'Imported application' : '');
  const [kind, setKind] = useState<FormKind>('application');
  const [json, setJson] = useState(forcedError ? '{\n  "jsonSchema": {\n    "type": "object",\n    "properties": { "title": { "type": "string" }, }\n  }\n}' : '');
  const [error, setError] = useState<string | null>(forcedError ? DEMO_ERROR : null);
  const [result, setResult] = useState<{ formId: string; unmapped: string[] } | null>(null);

  const reset = () => {
    setResult(null);
    setError(null);
    setJson('');
    setName('');
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <FileJson aria-hidden="true" /> Import CommonGrants JSON
      </Button>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Import a CommonGrants form</DialogTitle>
          <DialogDescription>Paste a CommonGrants form-library JSON (JSON Schema with a UI Schema). It becomes a new draft form; fields we can’t map are listed so you can add them by hand.</DialogDescription>
        </DialogHeader>
        {result ? (
          <div className="grid gap-4" aria-live="polite">
            <Alert variant={result.unmapped.length ? 'warning' : 'success'} title={result.unmapped.length ? `Imported with ${result.unmapped.length} field${result.unmapped.length === 1 ? '' : 's'} not mapped` : 'Imported every field'}>
              {result.unmapped.length ? (
                <ul className="mt-1 list-disc pl-5">
                  {result.unmapped.map((u) => (
                    <li key={u}>
                      <code>{u}</code>
                    </li>
                  ))}
                </ul>
              ) : (
                'Open the builder to review the questions and publish when ready.'
              )}
            </Alert>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={reset}>
                Import another
              </Button>
              <Button asChild>
                <Link href={`/console/forms/${result.formId}`}>Open in builder</Link>
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (!name.trim()) return setError('Name the form.');
              let source: unknown;
              try {
                source = JSON.parse(json);
              } catch (err) {
                return setError(`The JSON could not be read: ${err instanceof Error ? err.message : 'invalid JSON'}. Check for a trailing comma or a missing quote.`);
              }
              if (!source || typeof source !== 'object' || Array.isArray(source)) return setError('Paste a JSON object (starting with “{”).');
              setError(null);
              void run(() => importCommonGrantsAction({ name: name.trim(), kind, source: source as Record<string, unknown> }), { success: 'Imported the form.' }).then((r) => {
                if (r.ok) setResult({ formId: r.data.formId, unmapped: r.data.unmapped });
                else setError(problemMessage(r.problem));
              });
            }}
          >
            {error ? (
              <Alert variant="danger" title="Couldn’t import" aria-live="polite">
                {error}
              </Alert>
            ) : null}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Name" htmlFor="import-name" required>
                <Input id="import-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} />
              </Field>
              <Field label="Kind" htmlFor="import-kind">
                <Select value={kind} onValueChange={(v) => setKind(v as FormKind)}>
                  <SelectTrigger id="import-kind">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FORM_KINDS.map((k) => (
                      <SelectItem key={k.value} value={k.value}>
                        {k.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <Field label="CommonGrants JSON" htmlFor="import-json" required>
              <Textarea id="import-json" rows={12} className="font-mono text-xs" value={json} onChange={(e) => setJson(e.target.value)} spellCheck={false} />
            </Field>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" pending={pending} pendingLabel="Importing…">
                Import
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
