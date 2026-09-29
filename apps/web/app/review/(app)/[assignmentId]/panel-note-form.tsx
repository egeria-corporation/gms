// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';
// D-03 panel note: a note the review panel (staff + cleared reviewers) sees for this application.
import { Button, Field, Textarea, toast } from '@gms/ui';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { reviewerPanelNoteAction } from '../actions';

export function ReviewerPanelNoteForm({ assignmentId, applicationId, panelId }: { assignmentId: string; applicationId: string; panelId: string | null }) {
  const router = useRouter();
  const [body, setBody] = useState('');
  const [pending, start] = useTransition();
  return (
    <form
      className="grid gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!body.trim()) return;
        start(async () => {
          const r = await reviewerPanelNoteAction(assignmentId, applicationId, panelId, body.trim());
          if (r.ok) {
            setBody('');
            toast.success('Panel note added.');
            router.refresh();
          } else toast.error(r.problem.detail);
        });
      }}
    >
      <Field label="Add a panel note" htmlFor="panel-note" optional description="Shared with staff and the other reviewers of this application.">
        <Textarea id="panel-note" rows={3} maxLength={10000} value={body} onChange={(e) => setBody(e.target.value)} />
      </Field>
      <Button type="submit" variant="outline" className="justify-self-start" disabled={!body.trim()} pending={pending} pendingLabel="Adding…">
        Add panel note
      </Button>
    </form>
  );
}
