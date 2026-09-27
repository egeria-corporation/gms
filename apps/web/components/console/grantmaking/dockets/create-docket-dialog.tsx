// SPDX-License-Identifier: AGPL-3.0-only
'use client';
// E-01: create a board docket (board.create_docket), optionally auto-assembled from pending approve
// recommendations (all opportunities, or one). Reports how many items were assembled, then opens the docket.
import { Button, CheckboxField, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger, Field, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@gms/ui';
import { Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import { createDocketAction } from '@/app/console/(app)/dockets/actions';
import { useRunAction } from '../run-action';

export function CreateDocketDialog({ opportunities, pendingRecommendations }: { opportunities: { id: string; title: string }[]; pendingRecommendations: number }) {
  const router = useRouter();
  const ids = useId();
  const { run, pending } = useRunAction();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [meeting, setMeeting] = useState('');
  const [quorum, setQuorum] = useState('3');
  const [auto, setAuto] = useState(true);
  const [opp, setOpp] = useState('all');
  const [error, setError] = useState<{ name?: string; quorum?: string }>({});

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus aria-hidden="true" /> New docket
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New board docket</DialogTitle>
          <DialogDescription>A docket is the list of recommendations a board meeting votes on. It stays a draft (hidden from the board) until you publish it.</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            const q = Number(quorum);
            const errs: { name?: string; quorum?: string } = {};
            if (!name.trim()) errs.name = 'Name the docket, for example “December board meeting”.';
            if (!Number.isInteger(q) || q < 1 || q > 50) errs.quorum = 'Enter a whole number from 1 to 50.';
            setError(errs);
            if (errs.name || errs.quorum) return;
            void run(() => createDocketAction({ name: name.trim(), meetingLocal: meeting, quorum: q, autoAssemble: auto, opportunityId: auto && opp !== 'all' ? opp : null }), {
              success: (d) => (auto ? `Docket created with ${d.items} item${d.items === 1 ? '' : 's'} auto-assembled from approve recommendations.` : 'Docket created.'),
              onDone: (d) => {
                setOpen(false);
                router.push(`/console/dockets/${d.id}`);
              },
              refresh: false,
            });
          }}
        >
          <Field label="Name" htmlFor={`${ids}-name`} required error={error.name}>
            <Input id={`${ids}-name`} value={name} maxLength={200} onChange={(e) => setName(e.target.value)} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Meeting date and time" htmlFor={`${ids}-when`} optional description="In the foundation’s time zone.">
              <Input id={`${ids}-when`} type="datetime-local" value={meeting} onChange={(e) => setMeeting(e.target.value)} />
            </Field>
            <Field label="Quorum" htmlFor={`${ids}-quorum`} required error={error.quorum} description="Votes needed (approve, decline or abstain) for an item to pass or fail.">
              <Input id={`${ids}-quorum`} type="number" min={1} max={50} value={quorum} onChange={(e) => setQuorum(e.target.value)} className="w-24" />
            </Field>
          </div>
          <CheckboxField
            label="Add pending approve recommendations automatically"
            description={`${pendingRecommendations} application${pendingRecommendations === 1 ? '' : 's'} with an approve recommendation ${pendingRecommendations === 1 ? 'is' : 'are'} not on a docket yet.`}
            checked={auto}
            onCheckedChange={(v) => setAuto(v === true)}
          />
          {auto ? (
            <Field label="From opportunity" htmlFor={`${ids}-opp`}>
              <Select value={opp} onValueChange={setOpp}>
                <SelectTrigger id={`${ids}-opp`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All opportunities</SelectItem>
                  {opportunities.map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      {o.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" pending={pending} pendingLabel="Creating…">
              Create docket
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
