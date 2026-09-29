// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';
// FB-01 create a form: blank, from a built-in template (FORM_TEMPLATES) or a workspace template; opens the
// builder on the new draft.
import { FORM_TEMPLATES } from '@gms/forms';
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
  RadioGroup,
  RadioOption,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@gms/ui';
import { Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { createFormAction } from '@/app/console/(app)/forms/actions';
import { problemMessage, useRunAction } from '../run-action';
import { FORM_KINDS, type FormKind } from './kinds';

export interface WorkspaceTemplate {
  id: string;
  name: string;
  description: string | null;
  kind: string;
}

export function CreateFormDialog({ templates, triggerLabel = 'New form' }: { templates: WorkspaceTemplate[]; triggerLabel?: string }) {
  const router = useRouter();
  const { run, pending } = useRunAction();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<FormKind>('application');
  const [source, setSource] = useState<string>('blank');
  const [error, setError] = useState<string | null>(null);

  const pick = (v: string) => {
    setSource(v);
    const builtin = v.startsWith('builtin:') ? FORM_TEMPLATES.find((t) => `builtin:${t.key}` === v) : undefined;
    const ws = v.startsWith('ws:') ? templates.find((t) => `ws:${t.id}` === v) : undefined;
    const k = builtin?.kind ?? ws?.kind;
    if (k && FORM_KINDS.some((x) => x.value === k)) setKind(k as FormKind);
    if (!name.trim()) setName(builtin?.name ?? ws?.name ?? '');
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus aria-hidden="true" /> {triggerLabel}
      </Button>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Create a form</DialogTitle>
          <DialogDescription>Start blank or from a template. You get a draft to edit in the builder; applicants see nothing until you publish it and attach it to a stage.</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) return setError('Name the form.');
            setError(null);
            void run(
              () =>
                createFormAction({
                  name: name.trim(),
                  kind,
                  ...(source.startsWith('builtin:') ? { builtinTemplate: source.slice('builtin:'.length) } : {}),
                  ...(source.startsWith('ws:') ? { templateId: source.slice('ws:'.length) } : {}),
                }),
              { success: `Created “${name.trim()}”.`, refresh: false, onDone: (d) => router.push(`/console/forms/${d.formId}`) },
            ).then((r) => {
              if (!r.ok) setError(problemMessage(r.problem));
            });
          }}
        >
          {error ? <Alert variant="danger">{error}</Alert> : null}
          <fieldset className="grid gap-2">
            <legend className="text-sm font-medium">Start from</legend>
            <RadioGroup value={source} onValueChange={pick} className="grid max-h-72 gap-2 overflow-y-auto sm:grid-cols-2">
              <RadioOption value="blank" label="Blank form" description="One empty page." />
              {templates.map((t) => (
                <RadioOption key={t.id} value={`ws:${t.id}`} label={t.name} description={`Workspace template · ${t.description ?? t.kind}`} />
              ))}
              {FORM_TEMPLATES.map((t) => (
                <RadioOption key={t.key} value={`builtin:${t.key}`} label={t.name} description={t.description} />
              ))}
            </RadioGroup>
          </fieldset>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" htmlFor="new-form-name" required>
              <Input id="new-form-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} />
            </Field>
            <Field label="Kind" htmlFor="new-form-kind">
              <Select value={kind} onValueChange={(v) => setKind(v as FormKind)}>
                <SelectTrigger id="new-form-kind">
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
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" pending={pending} pendingLabel="Creating…">
              Create and open builder
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
