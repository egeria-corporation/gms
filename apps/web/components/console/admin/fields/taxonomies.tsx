// SPDX-License-Identifier: AGPL-3.0-only
'use client';
// S-08: cause / geography / population taxonomies. Add and rename inline; delete with confirmation.
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Alert,
  Button,
  EmptyState,
  Field,
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
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  toast,
} from '@gms/ui';
import { Check, Pencil, Plus, Tags, Trash2, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { deleteTermAction, saveTermAction } from '@/app/console/(app)/settings/fields/actions';

export type TermKind = 'cause' | 'geography' | 'population';

export interface TermRow {
  id: string;
  kind: TermKind;
  code: string;
  label: string;
  parentId: string | null;
}

const KINDS: Record<TermKind, { label: string; noun: string; example: string }> = {
  cause: { label: 'Cause areas', noun: 'cause area', example: 'e.g. youth-literacy · Youth literacy' },
  geography: { label: 'Geographies', noun: 'geography', example: 'e.g. ca-alameda · Alameda County' },
  population: { label: 'Populations', noun: 'population', example: 'e.g. older-adults · Older adults' },
};
const NONE = 'none';

type Draft = { code: string; label: string; parentId: string };

function TermTable({ kind, terms, canEdit }: { kind: TermKind; terms: TermRow[]; canEdit: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState<string | null>(null);
  const [edit, setEdit] = useState<Draft>({ code: '', label: '', parentId: NONE });
  const [add, setAdd] = useState<Draft>({ code: '', label: '', parentId: NONE });
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<TermRow | null>(null);
  const byId = new Map(terms.map((t) => [t.id, t]));
  const meta = KINDS[kind];

  const save = (d: Draft, id?: string) => {
    if (!d.code.trim() || !d.label.trim()) {
      setError('Enter both a code and a label.');
      return;
    }
    setError(null);
    start(async () => {
      const r = await saveTermAction({
        ...(id ? { id } : {}),
        kind,
        code: d.code.trim(),
        label: d.label.trim(),
        parentId: d.parentId === NONE ? null : d.parentId,
      });
      if (r.ok) {
        toast.success(id ? `Renamed to “${d.label.trim()}”.` : `Added “${d.label.trim()}”.`);
        if (id) setEditing(null);
        else setAdd({ code: '', label: '', parentId: NONE });
        router.refresh();
      } else setError(r.problem.detail);
    });
  };

  const parentSelect = (id: string, value: string, onChange: (v: string) => void, exclude?: string) => (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger id={id} size="sm">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>No parent</SelectItem>
        {terms
          .filter((t) => t.id !== exclude)
          .map((t) => (
            <SelectItem key={t.id} value={t.id}>
              {t.label}
            </SelectItem>
          ))}
      </SelectContent>
    </Select>
  );

  return (
    <div className="grid gap-3">
      {error ? (
        <Alert variant="danger" title="Not saved">
          {error}
        </Alert>
      ) : null}
      {terms.length ? (
        <Table containerLabel={meta.label}>
          <TableHeader>
            <TableRow>
              <TableHead>Code</TableHead>
              <TableHead>Label</TableHead>
              <TableHead>Parent</TableHead>
              {canEdit ? <TableHead className="sr-only">Actions</TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {terms.map((t) =>
              editing === t.id ? (
                <TableRow key={t.id}>
                  <TableCell>
                    <Input
                      aria-label="Code"
                      inputSize="sm"
                      className="font-mono"
                      value={edit.code}
                      maxLength={40}
                      onChange={(e) => setEdit({ ...edit, code: e.target.value })}
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      aria-label="Label"
                      inputSize="sm"
                      value={edit.label}
                      maxLength={120}
                      autoFocus
                      onChange={(e) => setEdit({ ...edit, label: e.target.value })}
                    />
                  </TableCell>
                  <TableCell>
                    <Field label="Parent" htmlFor={`term-parent-${t.id}`} hideLabel>
                      {parentSelect(
                        `term-parent-${t.id}`,
                        edit.parentId,
                        (v) => setEdit({ ...edit, parentId: v }),
                        t.id,
                      )}
                    </Field>
                  </TableCell>
                  <TableCell>
                    <span className="flex justify-end gap-1">
                      <Button
                        size="sm"
                        pending={pending}
                        pendingLabel="Saving…"
                        onClick={() => save(edit, t.id)}
                      >
                        <Check aria-hidden="true" /> Save
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                        <X aria-hidden="true" /> Cancel
                      </Button>
                    </span>
                  </TableCell>
                </TableRow>
              ) : (
                <TableRow key={t.id}>
                  <TableCell className="font-mono text-xs">{t.code}</TableCell>
                  <TableCell className="font-medium">{t.label}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {t.parentId ? (byId.get(t.parentId)?.label ?? '—') : '—'}
                  </TableCell>
                  {canEdit ? (
                    <TableCell>
                      <span className="flex justify-end gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={pending}
                          onClick={() => {
                            setEditing(t.id);
                            setEdit({ code: t.code, label: t.label, parentId: t.parentId ?? NONE });
                          }}
                        >
                          <Pencil aria-hidden="true" /> Rename<span className="sr-only"> {t.label}</span>
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive"
                          disabled={pending}
                          onClick={() => setDeleting(t)}
                        >
                          <Trash2 aria-hidden="true" /> Delete<span className="sr-only"> {t.label}</span>
                        </Button>
                      </span>
                    </TableCell>
                  ) : null}
                </TableRow>
              ),
            )}
          </TableBody>
        </Table>
      ) : (
        <EmptyState
          level={3}
          icon={Tags}
          title={`No ${meta.label.toLowerCase()} yet`}
          description={`Tag opportunities, applications and awards with a ${meta.noun} so you can filter and report on them.`}
        />
      )}

      {canEdit ? (
        <form
          className="grid items-end gap-2 rounded-lg border p-3 sm:grid-cols-[10rem_1fr_12rem_auto]"
          aria-label={`Add a ${meta.noun}`}
          onSubmit={(e) => {
            e.preventDefault();
            save(add);
          }}
        >
          <Field label="Code" htmlFor={`add-${kind}-code`}>
            <Input
              id={`add-${kind}-code`}
              inputSize="sm"
              className="font-mono"
              value={add.code}
              maxLength={40}
              onChange={(e) => setAdd({ ...add, code: e.target.value })}
            />
          </Field>
          <Field label="Label" htmlFor={`add-${kind}-label`}>
            <Input
              id={`add-${kind}-label`}
              inputSize="sm"
              value={add.label}
              maxLength={120}
              placeholder={meta.example.split(' · ')[1]}
              onChange={(e) => setAdd({ ...add, label: e.target.value })}
            />
          </Field>
          <Field label="Parent" htmlFor={`add-${kind}-parent`} optional>
            {parentSelect(`add-${kind}-parent`, add.parentId, (v) => setAdd({ ...add, parentId: v }))}
          </Field>
          <Button type="submit" size="sm" pending={pending && !editing} pendingLabel="Adding…">
            <Plus aria-hidden="true" /> Add {meta.noun}
          </Button>
        </form>
      ) : null}

      <AlertDialog open={Boolean(deleting)} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{deleting?.label}”?</AlertDialogTitle>
            <AlertDialogDescription>
              Records tagged with it lose the tag, and terms under it lose their parent. Past exports aren’t
              changed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={pending}
              onClick={(e) => {
                e.preventDefault();
                const t = deleting;
                if (!t) return;
                start(async () => {
                  const r = await deleteTermAction(t.id);
                  if (r.ok) {
                    toast.success(`Deleted “${t.label}”.`);
                    setDeleting(null);
                    router.refresh();
                  } else toast.error(r.problem.detail);
                });
              }}
            >
              Delete {meta.noun}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export function Taxonomies({ terms, canEdit }: { terms: TermRow[]; canEdit: boolean }) {
  return (
    <Tabs defaultValue="cause">
      <TabsList aria-label="Taxonomies">
        {(Object.keys(KINDS) as TermKind[]).map((k) => (
          <TabsTrigger key={k} value={k}>
            {KINDS[k].label} ({terms.filter((t) => t.kind === k).length})
          </TabsTrigger>
        ))}
      </TabsList>
      {(Object.keys(KINDS) as TermKind[]).map((k) => (
        <TabsContent key={k} value={k}>
          <TermTable kind={k} terms={terms.filter((t) => t.kind === k)} canEdit={canEdit} />
        </TabsContent>
      ))}
    </Tabs>
  );
}
