// SPDX-License-Identifier: AGPL-3.0-only
'use client';
// Adds a staff-only internal note (notes.add) to an application or an organization.
import { Button, Field, Textarea, toast } from '@gms/ui';
import { StickyNote } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { problemMessage } from '../run-action';
import { addNoteAction } from './actions';

export function NoteComposer({ entityType, entityId }: { entityType: 'application' | 'org'; entityId: string }) {
  const router = useRouter();
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const id = `note-${entityType}`;
  return (
    <form
      className="grid gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!body.trim()) {
          setError('Write a note first.');
          return;
        }
        setError(null);
        start(async () => {
          const r = await addNoteAction(entityType, entityId, body.trim());
          if (r.ok) {
            setBody('');
            toast.success('Note added.');
            router.refresh();
          } else setError(problemMessage(r.problem));
        });
      }}
    >
      <Field label="Add an internal note" htmlFor={id} description="Only staff see notes. Applicants never do." error={error ?? undefined}>
        <Textarea id={id} rows={3} value={body} onChange={(e) => setBody(e.target.value)} maxLength={20000} />
      </Field>
      <div>
        <Button type="submit" size="sm" pending={pending} pendingLabel="Saving…">
          <StickyNote aria-hidden="true" /> Add note
        </Button>
      </div>
    </form>
  );
}
