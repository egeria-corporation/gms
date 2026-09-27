// SPDX-License-Identifier: AGPL-3.0-only
'use client';
// R-02 assignment board: applications × assigned reviewers (status chips), manual assign / unassign, the
// round-robin auto-assign plan (dry run → review → apply), reviewer load vs capacity (inline edit) and
// declared conflicts of interest.
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Field,
  Input,
  Progress,
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
} from '@gms/ui';
import { Shuffle, UserPlus, X } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { assignAction, autoAssignAction, setCapacityAction, unassignAction, type AutoAssignResult } from '@/app/console/(app)/review/actions';
import { useRunAction } from '../run-action';
import { CONFLICT_META, OVER_CAPACITY_META } from './meta';

export interface BoardApplication {
  id: string;
  label: string;
  orgId: string | null;
  orgName: string | null;
  status: string;
}

export interface BoardAssignment {
  id: string;
  applicationId: string;
  reviewerId: string;
  reviewerName: string;
  status: string;
  conflict: { explanation: string | null } | null;
}

export interface BoardReviewer {
  userId: string;
  memberId: string;
  name: string;
  role: string;
  capacity: number | null;
  load: number;
}

export interface BoardConflict {
  reviewerId: string;
  orgId: string | null;
  applicationId: string;
  explanation: string | null;
}

export interface AssignBoardProps {
  stage: { id: string; name: string; reviewersPerApplication: number };
  apps: BoardApplication[];
  assignments: BoardAssignment[];
  reviewers: BoardReviewer[];
  conflicts: BoardConflict[];
  canEdit: boolean;
}

export function AssignBoard({ stage, apps, assignments, reviewers, conflicts, canEdit }: AssignBoardProps) {
  const { run, pending } = useRunAction();
  const [plan, setPlan] = useState<AutoAssignResult | null>(null);
  const appById = useMemo(() => new Map(apps.map((a) => [a.id, a])), [apps]);
  const reviewerById = useMemo(() => new Map(reviewers.map((r) => [r.userId, r])), [reviewers]);
  const over = reviewers.filter((r) => r.capacity !== null && r.load > r.capacity);
  const conflictAssignments = assignments.filter((a) => a.conflict);

  /** A reviewer has a declared conflict with this application's organization (or the application itself). */
  const conflictFor = (reviewerId: string, app: BoardApplication) =>
    conflicts.find((c) => c.reviewerId === reviewerId && (app.orgId ? c.orgId === app.orgId : c.applicationId === app.id)) ?? null;

  const makePlan = () =>
    void run(() => autoAssignAction(stage.id, true), {
      refresh: false,
      onDone: (d) => setPlan(d),
    });
  const applyPlan = () =>
    void run(() => autoAssignAction(stage.id, false), {
      success: (d) => `Created ${d.created} assignment${d.created === 1 ? '' : 's'}.`,
      onDone: () => setPlan(null),
    });

  return (
    <div className="grid gap-6">
      {conflictAssignments.length ? (
        <Alert variant="danger" title={`${conflictAssignments.length} conflict${conflictAssignments.length === 1 ? '' : 's'} of interest declared`}>
          Reviewers who declared a conflict are recused from that application and never auto-assigned to the same organization again. Assign someone else so each application still gets {stage.reviewersPerApplication}{' '}
          reviewer{stage.reviewersPerApplication === 1 ? '' : 's'}.
        </Alert>
      ) : null}
      {over.length ? (
        <Alert variant="warning" title={`${over.length} reviewer${over.length === 1 ? ' is' : 's are'} over capacity`}>
          {over.map((r) => `${r.name} (${r.load} of ${r.capacity})`).join(', ')}. Unassign some applications or raise their capacity.
        </Alert>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="grid min-w-0 content-start gap-6">
          {canEdit ? (
            <Card>
              <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
                <div className="grid gap-1">
                  <CardTitle as="h2" className="text-base">
                    Automatic assignment
                  </CardTitle>
                  <CardDescription>
                    Round-robin with load balancing: {stage.reviewersPerApplication} reviewer{stage.reviewersPerApplication === 1 ? '' : 's'} per application, skipping declared conflicts and full reviewers. You see the plan before
                    anything changes.
                  </CardDescription>
                </div>
                <Button size="sm" variant={plan ? 'outline' : 'default'} onClick={makePlan} pending={pending && !plan} pendingLabel="Planning…">
                  <Shuffle aria-hidden="true" />
                  {plan ? 'Plan again' : 'Plan assignments'}
                </Button>
              </CardHeader>
              {plan ? (
                <CardContent className="grid gap-4" aria-live="polite">
                  {plan.plan.length ? (
                    <Table>
                      <TableCaption className="sr-only">Proposed assignments</TableCaption>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Application</TableHead>
                          <TableHead>Reviewer</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {plan.plan.map((p) => (
                          <TableRow key={`${p.applicationId}:${p.reviewerId}`}>
                            <TableCell>{appById.get(p.applicationId)?.label ?? p.applicationId}</TableCell>
                            <TableCell>{p.reviewerName ?? reviewerById.get(p.reviewerId)?.name ?? 'Reviewer'}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  ) : (
                    <p className="text-sm text-muted-foreground">Nothing to assign: every application already has enough reviewers, or nobody is available.</p>
                  )}
                  {plan.unassigned.length ? (
                    <Alert variant="warning" title={`${plan.unassigned.length} application${plan.unassigned.length === 1 ? '' : 's'} can’t be fully covered`}>
                      <ul className="list-disc pl-5">
                        {plan.unassigned.map((u) => (
                          <li key={u.applicationId}>
                            {appById.get(u.applicationId)?.label ?? u.applicationId}: {u.reason}
                          </li>
                        ))}
                      </ul>
                    </Alert>
                  ) : null}
                  {plan.overCapacity.length ? (
                    <Alert variant="warning" title="Reviewers at capacity were skipped">
                      {plan.overCapacity.map((id) => reviewerById.get(id)?.name ?? 'A reviewer').join(', ')}
                    </Alert>
                  ) : null}
                  <div className="flex flex-wrap justify-end gap-2">
                    <Button variant="ghost" size="sm" onClick={() => setPlan(null)}>
                      Discard plan
                    </Button>
                    <Button size="sm" onClick={applyPlan} disabled={!plan.plan.length} pending={pending} pendingLabel="Assigning…">
                      Apply plan ({plan.plan.length})
                    </Button>
                  </div>
                </CardContent>
              ) : null}
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle as="h2" className="text-base">
                Applications
              </CardTitle>
              <CardDescription>Submitted and under-review applications in this competition, with their reviewers.</CardDescription>
            </CardHeader>
            <CardContent>
              <Table containerLabel="Assignment board">
                <TableCaption className="sr-only">Applications and their assigned reviewers</TableCaption>
                <TableHeader>
                  <TableRow>
                    <TableHead>Application</TableHead>
                    <TableHead>Reviewers</TableHead>
                    {canEdit ? <TableHead className="min-w-56">Add a reviewer</TableHead> : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {apps.map((app) => {
                    const rows = assignments.filter((a) => a.applicationId === app.id);
                    const activeCount = rows.filter((a) => a.status !== 'recused').length;
                    const need = stage.reviewersPerApplication - activeCount;
                    return (
                      <TableRow key={app.id} className={rows.some((r) => r.conflict) ? 'bg-status-danger-bg/40' : undefined}>
                        <TableCell className="align-top">
                          <Link href={`/console/applications/${app.id}`} className="font-medium hover:underline">
                            {app.label}
                          </Link>
                          {app.orgName ? <span className="block text-xs text-muted-foreground">{app.orgName}</span> : null}
                          {need > 0 ? <span className="mt-1 block text-xs text-status-warning-fg">Needs {need} more</span> : null}
                        </TableCell>
                        <TableCell className="align-top">
                          {rows.length ? (
                            <ul className="grid gap-1.5">
                              {rows.map((a) => (
                                <li key={a.id} className="grid gap-1">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span>{a.reviewerName}</span>
                                    <StatusChip kind="review" value={a.status} size="sm" />
                                    {a.conflict ? <StatusChip meta={CONFLICT_META} size="sm" /> : null}
                                    {canEdit && a.status !== 'submitted' ? (
                                      <Button
                                        variant="ghost"
                                        size="icon-sm"
                                        aria-label={`Remove ${a.reviewerName} from ${app.label}`}
                                        disabled={pending}
                                        onClick={() => void run(() => unassignAction(stage.id, a.id), { success: `${a.reviewerName} removed.` })}
                                      >
                                        <X aria-hidden="true" />
                                      </Button>
                                    ) : null}
                                  </div>
                                  {a.conflict ? (
                                    <p className="text-xs text-status-danger-fg">
                                      Recused. {a.conflict.explanation ? <>Reason: “{a.conflict.explanation}”</> : 'No reason given.'} Assign another reviewer.
                                    </p>
                                  ) : null}
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <span className="text-muted-foreground">No reviewers yet</span>
                          )}
                        </TableCell>
                        {canEdit ? (
                          <TableCell className="align-top">
                            <ManualAssign
                              stageId={stage.id}
                              app={app}
                              reviewers={reviewers.filter((r) => !rows.some((a) => a.reviewerId === r.userId))}
                              conflictFor={(rid) => conflictFor(rid, app)}
                            />
                          </TableCell>
                        ) : null}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>

        <Card className="content-start self-start">
          <CardHeader>
            <CardTitle as="h2" className="text-base">
              Reviewers
            </CardTitle>
            <CardDescription>Assigned in this stage vs capacity (blank = no limit).</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-4">
              {reviewers.map((r) => (
                <ReviewerLoad key={r.userId} stageId={stage.id} reviewer={r} canEdit={canEdit} />
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function ManualAssign({
  stageId,
  app,
  reviewers,
  conflictFor,
}: {
  stageId: string;
  app: BoardApplication;
  reviewers: BoardReviewer[];
  conflictFor: (reviewerId: string) => BoardConflict | null;
}) {
  const { run, pending } = useRunAction();
  const [reviewerId, setReviewerId] = useState('');
  const id = `assign-${app.id}`;
  if (!reviewers.length) return <span className="text-xs text-muted-foreground">Everyone is assigned</span>;
  const chosen = reviewers.find((r) => r.userId === reviewerId);
  const full = chosen && chosen.capacity !== null && chosen.load >= chosen.capacity;
  return (
    <form
      className="grid gap-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        if (!reviewerId) return;
        void run(() => assignAction(stageId, app.id, reviewerId), { success: `${chosen?.name ?? 'Reviewer'} assigned.`, onDone: () => setReviewerId('') });
      }}
    >
      <div className="flex gap-1.5">
        <Field label={`Reviewer for ${app.label}`} htmlFor={id} hideLabel className="min-w-0 flex-1">
          <Select value={reviewerId} onValueChange={setReviewerId}>
            <SelectTrigger id={id} size="sm">
              <SelectValue placeholder="Choose reviewer" />
            </SelectTrigger>
            <SelectContent>
              {reviewers.map((r) => {
                const c = conflictFor(r.userId);
                const atCap = r.capacity !== null && r.load >= r.capacity;
                return (
                  <SelectItem key={r.userId} value={r.userId} disabled={Boolean(c)}>
                    {r.name}
                    {c ? ' — conflict declared' : atCap ? ' — at capacity' : ` (${r.load}${r.capacity !== null ? `/${r.capacity}` : ''})`}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </Field>
        <Button type="submit" size="sm" variant="outline" disabled={!reviewerId} pending={pending} pendingLabel="Assigning…">
          <UserPlus aria-hidden="true" />
          Assign
        </Button>
      </div>
      {full ? <p className="text-xs text-status-warning-fg">{chosen.name} is at capacity; assigning puts them over.</p> : null}
    </form>
  );
}

function ReviewerLoad({ stageId, reviewer: r, canEdit }: { stageId: string; reviewer: BoardReviewer; canEdit: boolean }) {
  const { run, pending } = useRunAction();
  const [cap, setCap] = useState(r.capacity === null ? '' : String(r.capacity));
  const isOver = r.capacity !== null && r.load > r.capacity;
  const id = `cap-${r.memberId}`;
  const parsed = cap.trim() === '' ? null : Number(cap);
  const invalid = parsed !== null && (!Number.isInteger(parsed) || parsed < 0 || parsed > 500);
  const changed = parsed !== r.capacity;
  return (
    <li className="grid gap-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">{r.name}</span>
        <span className="text-xs tabular-nums text-muted-foreground">
          {r.load} {r.capacity !== null ? `of ${r.capacity}` : 'assigned'}
        </span>
      </div>
      {r.role !== 'reviewer' ? <span className="text-xs text-muted-foreground">{statusLabelForRole(r.role)}</span> : null}
      {r.capacity !== null ? (
        <Progress value={Math.min(r.load, r.capacity)} max={Math.max(r.capacity, 1)} label={`${r.name}: ${r.load} of ${r.capacity}`} indicatorClassName={isOver ? 'bg-status-warning-fg' : undefined} />
      ) : null}
      {isOver ? <StatusChip meta={{ ...OVER_CAPACITY_META, label: `Over capacity by ${r.load - r.capacity!}` }} size="sm" /> : null}
      {canEdit ? (
        <form
          className="flex items-end gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            if (invalid || !changed) return;
            void run(() => setCapacityAction(stageId, r.memberId, parsed), { success: `Capacity for ${r.name} saved.` });
          }}
        >
          <Field label="Capacity" htmlFor={id} error={invalid ? 'Use a whole number 0–500.' : undefined} className="flex-1">
            <Input id={id} type="number" inputSize="sm" min={0} max={500} step={1} value={cap} onChange={(e) => setCap(e.target.value)} />
          </Field>
          <Button type="submit" size="sm" variant="outline" disabled={invalid || !changed} pending={pending} pendingLabel="Saving…" aria-label={`Save capacity for ${r.name}`}>
            Save
          </Button>
        </form>
      ) : null}
    </li>
  );
}

function statusLabelForRole(role: string): string {
  const t = role.replace(/_/g, ' ');
  return t.charAt(0).toUpperCase() + t.slice(1);
}
