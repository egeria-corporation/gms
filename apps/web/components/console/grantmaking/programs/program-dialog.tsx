// SPDX-License-Identifier: AGPL-3.0-only
'use client';
// Create or edit a program (programs.create / programs.update).
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Field,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from '@gms/ui';
import { PencilLine, Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { createProgramAction, updateProgramAction } from '@/app/console/(app)/programs/actions';
import { useRunAction } from '../run-action';

export interface ProgramDraft {
  id?: string;
  name: string;
  description: string | null;
  causeArea: string | null;
  leadUserId: string | null;
}

const NO_LEAD = '__none';

export function ProgramDialog({ program, leads, causeAreas = [] }: { program?: ProgramDraft; leads: { userId: string; name: string }[]; causeAreas?: string[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(program?.name ?? '');
  const [description, setDescription] = useState(program?.description ?? '');
  const [causeArea, setCauseArea] = useState(program?.causeArea ?? '');
  const [lead, setLead] = useState(program?.leadUserId ?? NO_LEAD);
  const [error, setError] = useState<string | null>(null);
  const { run, pending } = useRunAction();
  const editing = Boolean(program?.id);
  const listId = `cause-areas-${program?.id ?? 'new'}`;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {editing ? (
          <Button variant="outline" size="sm">
            <PencilLine aria-hidden="true" /> Edit program
          </Button>
        ) : (
          <Button size="sm">
            <Plus aria-hidden="true" /> New program
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit program' : 'New program'}</DialogTitle>
          <DialogDescription>A program is a funding area with its own budget, opportunities and awards.</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) {
              setError('Name the program.');
              return;
            }
            setError(null);
            const input = { name: name.trim(), description: description.trim() || null, causeArea: causeArea.trim() || null, leadUserId: lead === NO_LEAD ? null : lead };
            void run(() => (editing ? updateProgramAction(program!.id!, input) : createProgramAction(input)), {
              success: editing ? 'Program saved.' : `Created “${input.name}”.`,
              onDone: (data) => {
                setOpen(false);
                const id = (data as { id?: string } | undefined)?.id;
                if (!editing && id) router.push(`/console/programs/${id}`);
              },
            });
          }}
        >
          <Field label="Name" htmlFor="program-name" required error={error ?? undefined}>
            <Input id="program-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} />
          </Field>
          <Field label="Description" htmlFor="program-description" optional>
            <Textarea id="program-description" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={5000} />
          </Field>
          <Field label="Cause area" htmlFor="program-cause" optional description="Used on the public site and in reports, e.g. “Arts & culture”.">
            <Input id="program-cause" list={listId} value={causeArea} onChange={(e) => setCauseArea(e.target.value)} maxLength={120} />
          </Field>
          <datalist id={listId}>
            {causeAreas.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
          <Field label="Program lead" htmlFor="program-lead" optional>
            <Select value={lead} onValueChange={setLead}>
              <SelectTrigger id="program-lead">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_LEAD}>No lead yet</SelectItem>
                {leads.map((l) => (
                  <SelectItem key={l.userId} value={l.userId}>
                    {l.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" pending={pending} pendingLabel="Saving…">
              {editing ? 'Save program' : 'Create program'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
