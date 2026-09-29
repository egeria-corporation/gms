// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';
// C-05 actions: publish (shows the server's readiness problems inline), lifecycle changes allowed by the
// opportunity state machine (each confirmed, with an optional reason), and inviting applicants to an
// invite-only stage.
import type { OpportunityStatus } from '@gms/domain';
import {
  Alert,
  Button,
  Checkbox,
  Field,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  StatusChip,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
} from '@gms/ui';
import { Archive, CircleDot, CircleSlash, MailPlus, PencilLine, Rocket, RotateCcw } from 'lucide-react';
import Link from 'next/link';
import { useId, useState, type ReactNode } from 'react';
import { inviteApplicantsAction, publishOpportunityAction, setOpportunityStatusAction } from '@/app/console/(app)/opportunities/actions';
import { ConfirmActionButton, problemMessage, useRunAction } from '../run-action';

export function PublishButton({ opportunityId, disabled }: { opportunityId: string; disabled?: boolean }) {
  const { run, pending } = useRunAction();
  const [problems, setProblems] = useState<{ detail: string; items: string[] } | null>(null);
  return (
    <div className="grid gap-3">
      <div>
        <Button
          type="button"
          disabled={disabled}
          pending={pending}
          pendingLabel="Publishing…"
          onClick={() => {
            setProblems(null);
            void run(() => publishOpportunityAction(opportunityId), {
              success: (d) => (d.status === 'open' ? 'Published. Applications are open now.' : 'Published. It is forecasted and opens on schedule.'),
            }).then((r) => {
              if (!r.ok) setProblems({ detail: problemMessage(r.problem), items: (r.problem.errors ?? []).map((e) => e.message) });
            });
          }}
        >
          <Rocket aria-hidden="true" /> Publish
        </Button>
      </div>
      <div aria-live="polite">
        {problems ? (
          <Alert variant="danger" title="Not published">
            <p>{problems.detail}</p>
            {problems.items.length ? (
              <ul className="mt-1 list-disc pl-5">
                {problems.items.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            ) : null}
          </Alert>
        ) : null}
      </div>
    </div>
  );
}

const TRANSITIONS: Partial<Record<OpportunityStatus, { label: string; title: string; description: string; icon: ReactNode; destructive?: boolean }>> = {
  closed: { label: 'Close applications', title: 'Close applications now?', description: 'Applicants can no longer submit. Drafts in progress stay saved. You can reopen later.', icon: <CircleSlash aria-hidden="true" />, destructive: true },
  open: { label: 'Open applications', title: 'Open applications now?', description: 'Applicants can start and submit applications right away.', icon: <CircleDot aria-hidden="true" /> },
  archived: { label: 'Archive', title: 'Archive this opportunity?', description: 'It becomes read-only and disappears from your site and feeds. Applications and awards are kept.', icon: <Archive aria-hidden="true" />, destructive: true },
  draft: { label: 'Back to draft', title: 'Return this opportunity to draft?', description: 'It is unpublished and hidden from applicants until you publish again.', icon: <PencilLine aria-hidden="true" /> },
};

function StatusChangeButton({ opportunityId, from, to }: { opportunityId: string; from: OpportunityStatus; to: OpportunityStatus }) {
  const [reason, setReason] = useState('');
  const id = useId();
  const t = TRANSITIONS[to];
  if (!t) return null;
  const label = from === 'closed' && to === 'open' ? 'Reopen applications' : t.label;
  return (
    <ConfirmActionButton
      label={label}
      icon={from === 'closed' && to === 'open' ? <RotateCcw aria-hidden="true" /> : t.icon}
      title={from === 'closed' && to === 'open' ? 'Reopen applications?' : t.title}
      description={t.description}
      confirmLabel={label}
      destructive={t.destructive}
      action={() => setOpportunityStatusAction(opportunityId, to, reason)}
      success={`Status changed to ${to === 'open' ? 'Open' : to.charAt(0).toUpperCase() + to.slice(1)}.`}
      onDone={() => setReason('')}
    >
      <Field label="Reason" htmlFor={id} optional description="Recorded in the audit log.">
        <Textarea id={id} rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
    </ConfirmActionButton>
  );
}

export function StatusActions({ opportunityId, status, targets }: { opportunityId: string; status: OpportunityStatus; targets: OpportunityStatus[] }) {
  if (!targets.length) return <p className="text-sm text-muted-foreground">No further changes are possible from this status.</p>;
  return (
    <div className="flex flex-wrap gap-2">
      {targets.map((t) => (
        <StatusChangeButton key={t} opportunityId={opportunityId} from={status} to={t} />
      ))}
    </div>
  );
}

export interface InviteStage {
  id: string;
  name: string;
  order: number;
  status: string;
  invited: number;
}

export interface InviteCandidate {
  id: string;
  reference: string;
  title: string | null;
  orgName: string | null;
  status: string;
  stageOrder: number;
  stageName: string;
}

export function InvitePanel({ opportunityId, stages, candidates }: { opportunityId: string; stages: InviteStage[]; candidates: InviteCandidate[] }) {
  const { run, pending } = useRunAction();
  const [stageId, setStageId] = useState(stages[0]?.id ?? '');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState('');
  const stage = stages.find((s) => s.id === stageId);
  const eligible = stage ? candidates.filter((c) => c.stageOrder < stage.order) : [];
  const allOn = eligible.length > 0 && eligible.every((c) => selected.has(c.id));
  const toggle = (id: string, on: boolean) =>
    setSelected((s) => {
      const n = new Set(s);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });
  const chosen = eligible.filter((c) => selected.has(c.id)).map((c) => c.id);

  if (!stages.length) {
    return <p className="text-sm text-muted-foreground">This opportunity has no invite-only stage. Add one on the Stages & forms tab to invite applicants from an earlier stage.</p>;
  }
  return (
    <div className="grid gap-4">
      <Field label="Invite to stage" htmlFor="invite-stage" className="max-w-sm">
        <Select
          value={stageId}
          onValueChange={(v) => {
            setStageId(v);
            setSelected(new Set());
          }}
        >
          <SelectTrigger id="invite-stage">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {stages.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                Stage {s.order}: {s.name} ({s.invited} invited)
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      {eligible.length ? (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableCaption className="sr-only">Applications from earlier stages that can be invited to {stage?.name}</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox aria-label="Select all" checked={allOn} onCheckedChange={(v) => setSelected(v === true ? new Set(eligible.map((c) => c.id)) : new Set())} />
                </TableHead>
                <TableHead>Application</TableHead>
                <TableHead>Organization</TableHead>
                <TableHead>From stage</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {eligible.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>
                    <Checkbox aria-label={`Select ${c.reference}`} checked={selected.has(c.id)} onCheckedChange={(v) => toggle(c.id, v === true)} />
                  </TableCell>
                  <TableCell>
                    <Link href={`/console/applications/${c.id}`} className="font-medium hover:underline">
                      {c.title ?? c.reference}
                    </Link>
                    <span className="block text-xs text-muted-foreground">{c.reference}</span>
                  </TableCell>
                  <TableCell>{c.orgName ?? '—'}</TableCell>
                  <TableCell>{c.stageName}</TableCell>
                  <TableCell>
                    <StatusChip kind="application" value={c.status} size="sm" />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No submitted or under-review applications in earlier stages to invite.</p>
      )}
      <Field label="Message to applicants" htmlFor="invite-message" optional description="Added to the invitation email and the application’s history.">
        <Textarea id="invite-message" rows={3} maxLength={5000} value={message} onChange={(e) => setMessage(e.target.value)} />
      </Field>
      <div>
        <Button
          type="button"
          disabled={!chosen.length || !stage}
          pending={pending}
          pendingLabel="Inviting…"
          onClick={() =>
            void run(() => inviteApplicantsAction(opportunityId, stageId, chosen, message), {
              success: (d) => `Invited ${d.invited} applicant${d.invited === 1 ? '' : 's'} to ${stage?.name ?? 'the stage'}.`,
              onDone: () => {
                setSelected(new Set());
                setMessage('');
              },
            })
          }
        >
          <MailPlus aria-hidden="true" /> Invite {chosen.length || ''} to {stage?.name ?? 'stage'}
        </Button>
      </div>
    </div>
  );
}
