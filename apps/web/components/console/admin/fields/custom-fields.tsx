// SPDX-License-Identifier: AGPL-3.0-only
'use client';
// S-08: custom field definitions (exposed in CommonGrants customFields) with an add/edit dialog.
import {
  Alert,
  Badge,
  Button,
  CheckboxField,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Field,
  FieldSet,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from '@gms/ui';
import { ListPlus, Pencil, Plus, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { saveCustomFieldAction } from '@/app/console/(app)/settings/fields/actions';

const ENTITIES = {
  application: 'Application',
  org: 'Organization',
  award: 'Award',
  opportunity: 'Opportunity',
} as const;
const TYPES = {
  text: 'Text',
  number: 'Number',
  date: 'Date',
  select: 'Choice list',
  boolean: 'Yes / no',
  currency: 'Money',
} as const;
type Entity = keyof typeof ENTITIES;
type FieldType = keyof typeof TYPES;

export interface CustomFieldRow {
  id: string;
  entity: string;
  key: string;
  label: string;
  fieldType: string;
  options: string[];
  required: boolean;
}

type Draft = {
  id?: string;
  entity: Entity;
  key: string;
  label: string;
  fieldType: FieldType;
  options: string[];
  required: boolean;
};
const EMPTY: Draft = {
  entity: 'application',
  key: '',
  label: '',
  fieldType: 'text',
  options: [],
  required: false,
};

function toKey(label: string): string {
  const words = label
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const k = words.map((w, i) => (i ? w[0]!.toUpperCase() + w.slice(1) : w)).join('');
  return /^[a-z]/.test(k) ? k.slice(0, 60) : '';
}

export function CustomFields({ fields, canEdit }: { fields: CustomFieldRow[]; canEdit: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [keyTouched, setKeyTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fe, setFe] = useState<Record<string, string>>({});

  const openWith = (d: Draft) => {
    setDraft(d);
    setKeyTouched(Boolean(d.id));
    setError(null);
    setFe({});
    setOpen(true);
  };

  const save = () => {
    const errs: Record<string, string> = {};
    if (!draft.label.trim()) errs.label = 'Enter the label people will see.';
    if (!/^[a-z][a-zA-Z0-9_]*$/.test(draft.key))
      errs.key = 'Start with a lowercase letter; use only letters, numbers and underscores.';
    const options = draft.options.map((o) => o.trim()).filter(Boolean);
    if (draft.fieldType === 'select' && options.length < 2) errs.options = 'Add at least two choices.';
    if (new Set(options).size !== options.length) errs.options = 'Each choice must be different.';
    setFe(errs);
    if (Object.keys(errs).length) {
      setError('Check the highlighted fields.');
      return;
    }
    setError(null);
    start(async () => {
      const r = await saveCustomFieldAction({
        ...(draft.id ? { id: draft.id } : {}),
        entity: draft.entity,
        key: draft.key,
        label: draft.label.trim(),
        fieldType: draft.fieldType,
        options: draft.fieldType === 'select' ? options : [],
        required: draft.required,
      });
      if (r.ok) {
        toast.success(`“${draft.label.trim()}” saved.`);
        setOpen(false);
        router.refresh();
      } else {
        setError(r.problem.detail);
        const m: Record<string, string> = {};
        for (const i of r.problem.errors ?? []) {
          const f = i.pointer.split('/')[1];
          if (f) m[f === 'fieldType' ? 'fieldType' : f] = i.message;
        }
        setFe(m);
      }
    });
  };

  return (
    <div className="grid gap-3">
      {fields.length ? (
        <Table containerLabel="Custom fields">
          <TableHeader>
            <TableRow>
              <TableHead>Label</TableHead>
              <TableHead>Key</TableHead>
              <TableHead>On</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Choices</TableHead>
              <TableHead>Required</TableHead>
              {canEdit ? <TableHead className="sr-only">Actions</TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {fields.map((f) => (
              <TableRow key={f.id}>
                <TableCell className="font-medium">{f.label}</TableCell>
                <TableCell className="font-mono text-xs">{f.key}</TableCell>
                <TableCell>{ENTITIES[f.entity as Entity] ?? f.entity}</TableCell>
                <TableCell>{TYPES[f.fieldType as FieldType] ?? f.fieldType}</TableCell>
                <TableCell>
                  {f.options.length ? (
                    <ul className="flex max-w-xs flex-wrap gap-1" aria-label={`Choices for ${f.label}`}>
                      {f.options.map((o) => (
                        <li key={o}>
                          <Badge variant="neutral">{o}</Badge>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    '—'
                  )}
                </TableCell>
                <TableCell>{f.required ? 'Required' : 'Optional'}</TableCell>
                {canEdit ? (
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        openWith({
                          id: f.id,
                          entity: (f.entity in ENTITIES ? f.entity : 'application') as Entity,
                          key: f.key,
                          label: f.label,
                          fieldType: (f.fieldType in TYPES ? f.fieldType : 'text') as FieldType,
                          options: f.options,
                          required: f.required,
                        })
                      }
                    >
                      <Pencil aria-hidden="true" /> Edit<span className="sr-only"> {f.label}</span>
                    </Button>
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <EmptyState
          level={3}
          icon={ListPlus}
          title="No custom fields yet"
          description="Add fields your foundation tracks that GMS doesn’t have out of the box, such as “Board district” on organizations or “Matching funds” on awards."
        />
      )}
      {canEdit ? (
        <Button className="justify-self-start" onClick={() => openWith(EMPTY)}>
          <Plus aria-hidden="true" /> Add custom field
        </Button>
      ) : null}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{draft.id ? 'Edit custom field' : 'Add custom field'}</DialogTitle>
            <DialogDescription>
              Custom fields appear on the record and in exports and the CommonGrants API as customFields.
            </DialogDescription>
          </DialogHeader>
          <form
            id="custom-field-form"
            className="grid max-h-[65vh] gap-4 overflow-y-auto pr-1"
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            {error ? (
              <Alert variant="danger" title="The field wasn’t saved">
                {error}
              </Alert>
            ) : null}
            <Field label="Record type" htmlFor="cf-entity" error={fe.entity}>
              <Select value={draft.entity} onValueChange={(v) => setDraft({ ...draft, entity: v as Entity })}>
                <SelectTrigger id="cf-entity">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(ENTITIES).map(([v, l]) => (
                    <SelectItem key={v} value={v}>
                      {l}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Label" htmlFor="cf-label" required error={fe.label}>
              <Input
                id="cf-label"
                value={draft.label}
                maxLength={120}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    label: e.target.value,
                    key: keyTouched ? draft.key : toKey(e.target.value),
                  })
                }
              />
            </Field>
            <Field
              label="Key"
              htmlFor="cf-key"
              required
              error={fe.key}
              description={
                draft.id
                  ? 'Changing the key breaks integrations that read the old one.'
                  : 'Used in exports and the API, e.g. boardDistrict.'
              }
            >
              <Input
                id="cf-key"
                className="font-mono"
                value={draft.key}
                maxLength={60}
                spellCheck={false}
                onChange={(e) => {
                  setKeyTouched(true);
                  setDraft({ ...draft, key: e.target.value });
                }}
              />
            </Field>
            <Field label="Type" htmlFor="cf-type" error={fe.fieldType}>
              <Select
                value={draft.fieldType}
                onValueChange={(v) =>
                  setDraft({
                    ...draft,
                    fieldType: v as FieldType,
                    options: v === 'select' && !draft.options.length ? ['', ''] : draft.options,
                  })
                }
              >
                <SelectTrigger id="cf-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(TYPES).map(([v, l]) => (
                    <SelectItem key={v} value={v}>
                      {l}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            {draft.fieldType === 'select' ? (
              <FieldSet legend="Choices" required error={fe.options}>
                <ol className="grid gap-2">
                  {draft.options.map((o, i) => (
                    <li key={i} className="flex items-center gap-2">
                      <Input
                        aria-label={`Choice ${i + 1}`}
                        inputSize="sm"
                        value={o}
                        maxLength={80}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            options: draft.options.map((x, j) => (j === i ? e.target.value : x)),
                          })
                        }
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`Remove choice ${i + 1}`}
                        onClick={() =>
                          setDraft({ ...draft, options: draft.options.filter((_, j) => j !== i) })
                        }
                      >
                        <X aria-hidden="true" />
                      </Button>
                    </li>
                  ))}
                </ol>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="justify-self-start"
                  disabled={draft.options.length >= 50}
                  onClick={() => setDraft({ ...draft, options: [...draft.options, ''] })}
                >
                  <Plus aria-hidden="true" /> Add choice
                </Button>
              </FieldSet>
            ) : null}
            <CheckboxField
              id="cf-required"
              label="Required"
              description="People must fill it in before they can submit or save the record."
              checked={draft.required}
              onCheckedChange={(c) => setDraft({ ...draft, required: c === true })}
            />
          </form>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" form="custom-field-form" pending={pending} pendingLabel="Saving…">
              Save field
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
