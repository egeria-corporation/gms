// SPDX-License-Identifier: AGPL-3.0-only
'use client';
// PA-03 client parts: run checks, review a potential OFAC match (people-only), and the expenditure-responsibility /
// grants-to-individuals flags per award.
import { formatInZone } from '@gms/domain';
import {
  Alert,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Field,
  FieldSet,
  RadioGroup,
  RadioOption,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
} from '@gms/ui';
import { RefreshCw, ShieldAlert } from 'lucide-react';
import * as React from 'react';
import { resolveScreeningAction, runDiligenceAction, setFlagsAction } from '@/app/console/(app)/diligence/actions';
import { FeedbackRegion, useRunner } from './client-utils';

export function RunChecksButton({ orgId, name }: { orgId: string; name: string }) {
  const { run, pending, feedback } = useRunner();
  return (
    <div className="grid justify-items-start gap-1">
      <Button
        size="sm"
        variant="outline"
        pending={pending}
        pendingLabel="Checking…"
        onClick={() =>
          run(
            () => runDiligenceAction({ applicantOrgId: orgId }),
            (d) => ({
              variant: d.ofac === 'potential_match' || d.irs !== 'pass' ? 'warning' : 'success',
              title: `IRS: ${d.irs === 'pass' ? 'in good standing' : d.irs === 'fail' ? 'not in good standing' : 'needs review'} · OFAC: ${d.ofac === 'clear' ? 'clear' : `possible match (${Math.round(d.bestScore * 100)}%)`}`,
            }),
          )
        }
      >
        <RefreshCw aria-hidden="true" /> Run checks<span className="sr-only"> for {name}</span>
      </Button>
      <FeedbackRegion feedback={feedback} className="max-w-sm" />
    </div>
  );
}

export interface MatchView {
  name: string;
  score: number;
  programs: string[];
  query: string;
}

export function ResolveScreeningDialog({ screeningId, orgName, matches, screenedAt, timeZone }: { screeningId: string | null; orgName: string; matches: MatchView[]; screenedAt: string | null; timeZone: string }) {
  const [open, setOpen] = React.useState(false);
  const [outcome, setOutcome] = React.useState<'false_positive' | 'confirmed_match' | ''>('');
  const [note, setNote] = React.useState('');
  const [errors, setErrors] = React.useState<{ outcome?: string; note?: string }>({});
  const { run, pending, feedback, setFeedback, dialog } = useRunner({ reason: 'Clearing or confirming a sanctions match is people-only, so we check your authenticator app first.', actionLabel: 'Record decision' });
  const id = React.useId();
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setFeedback(null);
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">
          <ShieldAlert aria-hidden="true" /> Review match<span className="sr-only"> for {orgName}</span>
        </Button>
      </DialogTrigger>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Review possible sanctions match: {orgName}</DialogTitle>
          <DialogDescription>
            Fuzzy name screening against the OFAC SDN list found similar names{screenedAt ? ` on ${formatInZone(screenedAt, timeZone)}` : ''}. Payments to this grantee stay blocked until a person decides. Compare
            addresses, dates and identifiers on the OFAC entry before clearing.
          </DialogDescription>
        </DialogHeader>
        <Table containerLabel="Potential matches" containerClassName="max-h-64 rounded-md border">
          <TableHeader>
            <TableRow>
              <TableHead>SDN name</TableHead>
              <TableHead className="text-right">Similarity</TableHead>
              <TableHead>Programs</TableHead>
              <TableHead>Matched on</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {matches.map((m, i) => (
              <TableRow key={`${m.name}-${i}`}>
                <TableCell className="font-medium">{m.name}</TableCell>
                <TableCell className="text-right tabular-nums">{Math.round(m.score * 100)}%</TableCell>
                <TableCell>{m.programs.join(', ') || '—'}</TableCell>
                <TableCell className="text-muted-foreground">{m.query}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            const errs: typeof errors = {};
            if (!outcome) errs.outcome = 'Choose an outcome.';
            if (note.trim().length < 5) errs.note = 'Explain how you decided (at least a few words).';
            setErrors(errs);
            if (Object.keys(errs).length || !screeningId || !outcome) return;
            void run(
              () => resolveScreeningAction({ screeningId, outcome, note: note.trim() }),
              () =>
                outcome === 'false_positive'
                  ? { variant: 'success', title: 'Cleared as a false positive', detail: 'Payments to this grantee are no longer blocked by this screening.' }
                  : { variant: 'warning', title: 'Recorded as a confirmed match', detail: 'Payments to this grantee stay blocked.' },
              { stepUp: true },
            ).then((ok) => {
              if (ok) setTimeout(() => setOpen(false), 1200);
            });
          }}
        >
          <FieldSet legend="Your decision" required error={errors.outcome}>
            <RadioGroup value={outcome} onValueChange={(v) => setOutcome(v as 'false_positive' | 'confirmed_match')}>
              <RadioOption value="false_positive" label="False positive — not the same party" description="Clears the payment block for this screening." />
              <RadioOption value="confirmed_match" label="Confirmed match" description="Keeps all payments to this grantee blocked. Talk to counsel about next steps." />
            </RadioGroup>
          </FieldSet>
          <Field label="How you decided" htmlFor={id} required error={errors.note} description="Recorded in the audit log with your name.">
            <Textarea id={id} rows={3} maxLength={5000} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          {!screeningId ? <Alert variant="info">This is a preview state; there is no screening to resolve.</Alert> : null}
          <FeedbackRegion feedback={feedback} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" pending={pending} pendingLabel="Recording…" disabled={!screeningId} variant={outcome === 'confirmed_match' ? 'destructive' : 'default'}>
              Record decision
            </Button>
          </DialogFooter>
        </form>
        {dialog}
      </DialogContent>
    </Dialog>
  );
}

export function AwardFlags({ awardId, reference, expenditureResponsibility, grantToIndividual, canWrite }: { awardId: string; reference: string; expenditureResponsibility: boolean; grantToIndividual: boolean; canWrite: boolean }) {
  const [er, setEr] = React.useState(expenditureResponsibility);
  const [gti, setGti] = React.useState(grantToIndividual);
  const { run, pending, feedback } = useRunner();
  const ids = { er: React.useId(), gti: React.useId() };
  React.useEffect(() => {
    setEr(expenditureResponsibility);
    setGti(grantToIndividual);
  }, [expenditureResponsibility, grantToIndividual]);
  const save = (next: { er: boolean; gti: boolean }) =>
    run(() => setFlagsAction({ awardId, expenditureResponsibility: next.er, grantToIndividual: next.gti }), () => ({ variant: 'success', title: `Saved flags for ${reference}.` })).then((ok) => {
      if (!ok) {
        setEr(expenditureResponsibility);
        setGti(grantToIndividual);
      }
    });
  return (
    <div className="grid gap-1.5">
      <div className="flex items-center gap-2">
        <Switch
          id={ids.er}
          checked={er}
          disabled={!canWrite || pending}
          onCheckedChange={(v) => {
            setEr(v);
            void save({ er: v, gti });
          }}
        />
        <label htmlFor={ids.er} className="text-xs">
          Expenditure responsibility<span className="sr-only"> for {reference}</span>
        </label>
      </div>
      <div className="flex items-center gap-2">
        <Switch
          id={ids.gti}
          checked={gti}
          disabled={!canWrite || pending}
          onCheckedChange={(v) => {
            setGti(v);
            void save({ er, gti: v });
          }}
        />
        <label htmlFor={ids.gti} className="text-xs">
          Grant to an individual<span className="sr-only"> ({reference})</span>
        </label>
      </div>
      <FeedbackRegion feedback={feedback?.variant === 'success' ? null : feedback} />
      <span className="sr-only" aria-live="polite">
        {feedback?.variant === 'success' ? feedback.title : ''}
      </span>
    </div>
  );
}
