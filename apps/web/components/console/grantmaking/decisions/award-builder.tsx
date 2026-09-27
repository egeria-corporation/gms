// SPDX-License-Identifier: AGPL-3.0-only
'use client';
// R-06 award builder form: amount, period, purpose, conditions, flags and the payment schedule editor
// (add / remove / Move up / Move down, "Split evenly", live total that must equal the amount). Saves with
// awards.draft (shows its budget warnings) and activates with awards.activate (R3, people only, confirmed).
import { formatMoney, parseMoneyToCents, splitInstallments, sumCents } from '@gms/domain';
import { Alert, Button, Card, CardContent, CardHeader, CardTitle, CheckboxField, Field, Input, Textarea, cn } from '@gms/ui';
import { ArrowDown, ArrowUp, BadgeCheck, CircleCheck, Divide, Plus, Save, Trash2, TriangleAlert } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useId, useMemo, useState } from 'react';
import { activateAwardAction, draftAwardAction } from '@/app/console/(app)/decisions/actions';
import { ConfirmActionButton, useRunAction } from '../run-action';

export interface AwardDraft {
  amountCents: number;
  startDate: string;
  endDate: string;
  purpose: string;
  conditions: string[];
  installments: { dueDate: string; amountCents: number; condition: string | null }[];
  expenditureResponsibility: boolean;
  grantToIndividual: boolean;
}

interface Row {
  key: string;
  dueDate: string;
  amount: string;
  condition: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
let seq = 0;
const nextKey = () => `i${++seq}`;
const toInput = (cents: number) => (cents / 100).toFixed(2);

export function AwardBuilder({
  applicationId,
  award,
  initial,
  requestedCents,
  serverWarnings,
  scheduleMatches,
  canDraft,
  canActivate,
  activateBlockedReason,
}: {
  applicationId: string;
  award: { id: string; status: string; reference: string } | null;
  initial: AwardDraft;
  requestedCents: number | null;
  serverWarnings: string[];
  scheduleMatches: boolean;
  canDraft: boolean;
  canActivate: boolean;
  activateBlockedReason: string | null;
}) {
  const router = useRouter();
  const ids = useId();
  const { run, pending } = useRunAction();
  const [amount, setAmount] = useState(toInput(initial.amountCents));
  const [startDate, setStartDate] = useState(initial.startDate);
  const [endDate, setEndDate] = useState(initial.endDate);
  const [purpose, setPurpose] = useState(initial.purpose);
  const [conditions, setConditions] = useState<{ key: string; body: string }[]>(() => initial.conditions.map((body) => ({ key: nextKey(), body })));
  const [newCondition, setNewCondition] = useState('');
  const [er, setEr] = useState(initial.expenditureResponsibility);
  const [gti, setGti] = useState(initial.grantToIndividual);
  const [rows, setRows] = useState<Row[]>(() => initial.installments.map((i) => ({ key: nextKey(), dueDate: i.dueDate, amount: i.amountCents ? toInput(i.amountCents) : '', condition: i.condition ?? '' })));
  const [warnings, setWarnings] = useState<string[] | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [dirty, setDirty] = useState(false);

  const amountCents = parseMoneyToCents(amount);
  const rowCents = rows.map((r) => parseMoneyToCents(r.amount));
  const total = sumCents(rowCents.map((c) => c ?? 0));
  const diff = amountCents === null ? null : total - amountCents;
  const matches = diff === 0 && rowCents.every((c) => c !== null && c > 0);
  const editable = canDraft && (!award || award.status === 'draft');

  const touch = () => setDirty(true);
  const updateRow = (key: string, patch: Partial<Row>) => {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
    touch();
  };
  const move = (idx: number, by: -1 | 1) => {
    setRows((rs) => {
      const next = [...rs];
      const j = idx + by;
      if (j < 0 || j >= next.length) return rs;
      [next[idx], next[j]] = [next[j]!, next[idx]!];
      return next;
    });
    touch();
  };

  const validation = useMemo(() => {
    const out: string[] = [];
    if (amountCents === null || amountCents <= 0) out.push('Enter the award amount.');
    if (!DATE_RE.test(startDate) || !DATE_RE.test(endDate)) out.push('Enter the start and end dates.');
    else if (endDate < startDate) out.push('The end date must be on or after the start date.');
    if (!rows.length) out.push('Add at least one installment.');
    rows.forEach((r, i) => {
      if (!DATE_RE.test(r.dueDate)) out.push(`Installment ${i + 1}: enter a due date.`);
      const c = parseMoneyToCents(r.amount);
      if (c === null || c <= 0) out.push(`Installment ${i + 1}: enter an amount above zero.`);
    });
    if (amountCents !== null && amountCents > 0 && rows.length && !matches && rowCents.every((c) => c !== null && c > 0)) {
      out.push(`The payment schedule totals ${formatMoney(total)}, but the award is ${formatMoney(amountCents)}. Make them match.`);
    }
    return out;
  }, [amountCents, startDate, endDate, rows, matches, rowCents, total]);

  const save = () => {
    if (validation.length) {
      setErrors(validation);
      return;
    }
    setErrors([]);
    void run(
      () =>
        draftAwardAction({
          applicationId,
          amountCents: amountCents!,
          startDate,
          endDate,
          purpose: purpose || null,
          conditions: conditions.map((c) => c.body),
          installments: rows.map((r) => ({ dueDate: r.dueDate, amountCents: parseMoneyToCents(r.amount)!, condition: r.condition || null })),
          expenditureResponsibility: er,
          grantToIndividual: gti,
        }),
      {
        success: award ? 'Award draft saved.' : 'Draft award created.',
        onDone: (d) => {
          setWarnings(d.warnings);
          setDirty(false);
        },
      },
    );
  };

  const shownWarnings = warnings ?? serverWarnings;

  return (
    <form
      className="grid gap-6"
      aria-describedby={`${ids}-status`}
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <div id={`${ids}-status`} aria-live="polite" className="grid gap-2">
        {shownWarnings.map((w) => (
          <Alert key={w} variant="warning" title={/budget is set/i.test(w) ? 'No budget set' : 'Over budget'}>
            {w}
          </Alert>
        ))}
        {errors.length ? (
          <Alert variant="danger" title="Fix these before saving">
            <ul className="list-disc pl-5">
              {errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </Alert>
        ) : null}
      </div>

      {!editable ? (
        <Alert variant="info" title="View only">
          {canDraft ? 'This award is no longer a draft.' : 'Program staff and finance draft awards.'}
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle as="h2" className="text-base">
            Terms
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Award amount (USD)" htmlFor={`${ids}-amount`} required description={requestedCents !== null ? `Requested: ${formatMoney(requestedCents)}` : undefined}>
              <Input
                id={`${ids}-amount`}
                inputMode="decimal"
                className="tabular-nums"
                value={amount}
                disabled={!editable}
                onChange={(e) => {
                  setAmount(e.target.value);
                  touch();
                }}
              />
            </Field>
            <Field label="Start date" htmlFor={`${ids}-start`} required>
              <Input
                id={`${ids}-start`}
                type="date"
                value={startDate}
                disabled={!editable}
                onChange={(e) => {
                  setStartDate(e.target.value);
                  touch();
                }}
              />
            </Field>
            <Field label="End date" htmlFor={`${ids}-end`} required>
              <Input
                id={`${ids}-end`}
                type="date"
                value={endDate}
                disabled={!editable}
                onChange={(e) => {
                  setEndDate(e.target.value);
                  touch();
                }}
              />
            </Field>
          </div>
          <Field label="Purpose" htmlFor={`${ids}-purpose`} optional description="Appears in the award letter and grant agreement.">
            <Textarea
              id={`${ids}-purpose`}
              rows={3}
              maxLength={5000}
              value={purpose}
              disabled={!editable}
              onChange={(e) => {
                setPurpose(e.target.value);
                touch();
              }}
            />
          </Field>
          <div className="grid gap-2 sm:grid-cols-2">
            <CheckboxField
              label="Expenditure responsibility"
              description="Required for grants to organizations that are not public charities."
              checked={er}
              disabled={!editable}
              onCheckedChange={(v) => {
                setEr(v === true);
                touch();
              }}
            />
            <CheckboxField
              label="Grant to an individual"
              description="Needs an IRS-approved procedure for individual grants."
              checked={gti}
              disabled={!editable}
              onCheckedChange={(v) => {
                setGti(v === true);
                touch();
              }}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle as="h2" className="text-base">
            Conditions
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          {conditions.length ? (
            <ul className="grid gap-2" aria-label="Award conditions">
              {conditions.map((c, i) => (
                <li key={c.key} className="flex items-start gap-2 rounded-md border p-2 text-sm">
                  <span className="min-w-0 flex-1">{c.body}</span>
                  {editable ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Remove condition ${i + 1}`}
                      onClick={() => {
                        setConditions((cs) => cs.filter((x) => x.key !== c.key));
                        touch();
                      }}
                    >
                      <Trash2 aria-hidden="true" />
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No conditions. Add any the grantee must meet (for example “Provide proof of insurance before the first payment”).</p>
          )}
          {editable ? (
            <div className="flex flex-wrap items-end gap-2">
              <Field label="New condition" htmlFor={`${ids}-cond`} className="min-w-64 flex-1">
                <Input
                  id={`${ids}-cond`}
                  value={newCondition}
                  maxLength={1000}
                  onChange={(e) => setNewCondition(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      if (newCondition.trim() && conditions.length < 20) {
                        setConditions((cs) => [...cs, { key: nextKey(), body: newCondition.trim() }]);
                        setNewCondition('');
                        touch();
                      }
                    }
                  }}
                />
              </Field>
              <Button
                type="button"
                variant="outline"
                disabled={!newCondition.trim() || conditions.length >= 20}
                onClick={() => {
                  setConditions((cs) => [...cs, { key: nextKey(), body: newCondition.trim() }]);
                  setNewCondition('');
                  touch();
                }}
              >
                <Plus aria-hidden="true" /> Add condition
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle as="h2" className="text-base">
            Payment schedule
          </CardTitle>
          {editable ? (
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={amountCents === null || amountCents <= 0 || rows.length === 0}
                onClick={() => {
                  const parts = splitInstallments(amountCents!, rows.length);
                  setRows((rs) => rs.map((r, i) => ({ ...r, amount: toInput(parts[i]!) })));
                  touch();
                }}
              >
                <Divide aria-hidden="true" /> Split evenly
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={rows.length >= 24}
                onClick={() => {
                  const last = rows[rows.length - 1];
                  setRows((rs) => [...rs, { key: nextKey(), dueDate: last?.dueDate ?? startDate, amount: '', condition: '' }]);
                  touch();
                }}
              >
                <Plus aria-hidden="true" /> Add installment
              </Button>
            </div>
          ) : null}
        </CardHeader>
        <CardContent className="grid gap-3">
          <ol className="grid gap-3" aria-label="Installments">
            {rows.map((r, i) => (
              <li key={r.key} className="grid gap-2 rounded-md border p-3 sm:grid-cols-[2rem_10rem_10rem_minmax(0,1fr)_auto] sm:items-end">
                <span className="text-sm font-medium tabular-nums sm:pb-2" aria-hidden="true">
                  {i + 1}.
                </span>
                <Field label={`Installment ${i + 1} due date`} htmlFor={`${ids}-due-${r.key}`} labelClassName="text-xs">
                  <Input id={`${ids}-due-${r.key}`} type="date" inputSize="sm" value={r.dueDate} disabled={!editable} onChange={(e) => updateRow(r.key, { dueDate: e.target.value })} />
                </Field>
                <Field label={`Installment ${i + 1} amount`} htmlFor={`${ids}-amt-${r.key}`} labelClassName="text-xs">
                  <Input id={`${ids}-amt-${r.key}`} inputSize="sm" inputMode="decimal" className="tabular-nums" value={r.amount} disabled={!editable} onChange={(e) => updateRow(r.key, { amount: e.target.value })} />
                </Field>
                <Field label={`Installment ${i + 1} condition`} htmlFor={`${ids}-cnd-${r.key}`} labelClassName="text-xs" optional>
                  <Input id={`${ids}-cnd-${r.key}`} inputSize="sm" maxLength={500} value={r.condition} disabled={!editable} onChange={(e) => updateRow(r.key, { condition: e.target.value })} />
                </Field>
                {editable ? (
                  <div className="flex gap-1">
                    <Button type="button" variant="ghost" size="icon-sm" aria-label={`Move installment ${i + 1} up`} disabled={i === 0} onClick={() => move(i, -1)}>
                      <ArrowUp aria-hidden="true" />
                    </Button>
                    <Button type="button" variant="ghost" size="icon-sm" aria-label={`Move installment ${i + 1} down`} disabled={i === rows.length - 1} onClick={() => move(i, 1)}>
                      <ArrowDown aria-hidden="true" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Remove installment ${i + 1}`}
                      disabled={rows.length === 1}
                      onClick={() => {
                        setRows((rs) => rs.filter((x) => x.key !== r.key));
                        touch();
                      }}
                    >
                      <Trash2 aria-hidden="true" />
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ol>
          <p
            role="status"
            aria-live="polite"
            className={cn(
              'flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium tabular-nums',
              matches ? 'border-status-success-border bg-status-success-bg text-status-success-fg' : 'border-status-warning-border bg-status-warning-bg text-status-warning-fg',
            )}
          >
            {matches ? <CircleCheck aria-hidden="true" className="size-4" /> : <TriangleAlert aria-hidden="true" className="size-4" />}
            Schedule total {formatMoney(total)} of {amountCents !== null ? formatMoney(amountCents) : '—'}
            {diff === null ? '' : diff === 0 ? ' — matches the award amount' : diff < 0 ? ` — ${formatMoney(-diff)} still to schedule` : ` — ${formatMoney(diff)} over the award amount`}
          </p>
        </CardContent>
      </Card>

      {editable ? (
        <div className="flex flex-wrap items-center gap-3 border-t pt-4">
          <Button type="submit" pending={pending} pendingLabel="Saving…" disabled={!matches}>
            <Save aria-hidden="true" /> {award ? 'Save draft award' : 'Create draft award'}
          </Button>
          {!matches ? <span className="text-sm text-muted-foreground">Make the schedule match the amount to save.</span> : null}
          {award?.status === 'draft' ? (
            <div className="ml-auto flex flex-wrap items-center gap-2">
              {dirty ? <span className="text-sm text-muted-foreground">Save your changes before activating.</span> : null}
              {!scheduleMatches && !dirty ? <span className="text-sm text-muted-foreground">The saved schedule must add up to the amount.</span> : null}
              {activateBlockedReason ? <span className="text-sm text-muted-foreground">{activateBlockedReason}</span> : null}
              <ConfirmActionButton
                label="Activate award"
                icon={<BadgeCheck aria-hidden="true" />}
                variant="default"
                disabled={!canActivate || dirty || !scheduleMatches}
                title={`Activate award ${award.reference}?`}
                description={
                  <>
                    The award becomes active for {amountCents !== null ? formatMoney(amountCents) : 'the saved amount'}. GMS creates the interim and final report requirements, prepares the
                    agreement and runs a sanctions screening. Terms are then locked; later changes need an amendment. Payments still wait for the signed agreement.
                  </>
                }
                confirmLabel="Activate award"
                success="Award activated."
                action={() => activateAwardAction(applicationId, award.id)}
                onDone={() => router.push(`/console/decisions/${applicationId}/agreement`)}
              />
            </div>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}
