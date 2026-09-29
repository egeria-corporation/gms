// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';
// C-04 Duplicate: copies details, eligibility, stages and forms into a new draft, then opens the copy.
import { Alert, Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger, Field, Input } from '@gms/ui';
import { Copy } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { duplicateOpportunityAction } from '@/app/console/(app)/opportunities/actions';
import { problemMessage, useRunAction } from '../run-action';

export function DuplicateDialog({ opportunityId, title }: { opportunityId: string; title: string }) {
  const router = useRouter();
  const { run, pending } = useRunAction();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(() => {
    const m = title.match(/(19|20)\d{2}/);
    return m ? title.replace(m[0], String(Number(m[0]) + 1)) : `${title} (copy)`;
  });
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Copy aria-hidden="true" /> Duplicate
        </Button>
      </DialogTrigger>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Duplicate this opportunity</DialogTitle>
          <DialogDescription>Copies the details, eligibility questions, stages and attached forms into a new draft. Dates carry over; review them before publishing.</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) return setError('Give the copy a title.');
            setError(null);
            void run(() => duplicateOpportunityAction(opportunityId, name.trim()), {
              success: `Created “${name.trim()}”.`,
              refresh: false,
              onDone: (d) => {
                setOpen(false);
                router.push(`/console/opportunities/${d.id}`);
              },
            }).then((r) => {
              if (!r.ok) setError(problemMessage(r.problem));
            });
          }}
        >
          {error ? <Alert variant="danger">{error}</Alert> : null}
          <Field label="Title of the copy" htmlFor="dup-title" required>
            <Input id="dup-title" value={name} onChange={(e) => setName(e.target.value)} maxLength={300} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" pending={pending} pendingLabel="Duplicating…">
              Duplicate
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
