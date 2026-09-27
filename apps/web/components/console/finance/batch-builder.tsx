// SPDX-License-Identifier: AGPL-3.0-only
'use client';
// P-03 Batch builder: pick the paying account, method and due-before date; preview (a draft batch) shows the
// exact payments, totals and fees, plus every installment that is blocked and why; then send for approval.
import { formatDateOnly, formatMoney, mercuryFeeCents, PAYMENT_METHOD_LABELS } from '@gms/domain';
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DescriptionList,
  Field,
  FieldSet,
  Input,
  MoneyDisplay,
  RadioGroup,
  RadioOption,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  StatusChip,
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@gms/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { cancelBatchAction, proposeBatchAction, submitBatchAction, type DraftPayment, type ProposeOutput } from '@/app/console/(app)/payments/actions';
import { BlockedReasons } from './blocked-reasons';
import { FeedbackRegion, useRunner } from './client-utils';

type Method = 'ach' | 'check' | 'domestic_wire' | 'international_wire';
const METHODS: Method[] = ['ach', 'domestic_wire', 'check', 'international_wire'];

export interface BuilderAccount {
  id: string;
  name: string;
  mask: string | null;
  availableCents: number | null;
  currency: string;
  programs: string[];
}

function feeText(m: Method): string {
  if (m === 'international_wire') return `No Mercury fee for USD when fees are shared; ${formatMoney(mercuryFeeCents(m, 100_000, { chargeBearer: 'OUR' }))} per payment if you cover the recipient’s fees; 1% for non-USD.`;
  const fee = mercuryFeeCents(m, 100_000);
  return fee ? `${formatMoney(fee)} per payment` : 'No Mercury fee';
}

const METHOD_HINT: Record<Method, string> = {
  ach: 'Arrives in 1–3 business days.',
  domestic_wire: 'Same day when sent before Mercury’s cutoff.',
  check: 'Mailed by Mercury; allow 5–10 business days.',
  international_wire: 'For grantees outside the US.',
};

export function BatchBuilder({
  accounts,
  manual,
  defaultDueBefore,
  secondApprovalThresholdCents,
}: {
  accounts: BuilderAccount[];
  manual: boolean;
  defaultDueBefore: string;
  secondApprovalThresholdCents: number;
}) {
  const router = useRouter();
  const [accountId, setAccountId] = React.useState(accounts[0]?.id ?? '');
  const [method, setMethod] = React.useState<Method>('ach');
  const [dueBefore, setDueBefore] = React.useState(defaultDueBefore);
  const [name, setName] = React.useState('');
  const [preview, setPreview] = React.useState<(ProposeOutput & { payments: DraftPayment[] }) | null>(null);
  const proposer = useRunner();
  const sender = useRunner();
  const account = accounts.find((a) => a.id === accountId);
  const ids = { account: React.useId(), due: React.useId(), name: React.useId() };

  const total = preview?.totalCents ?? 0;
  const fees = preview?.feeCents ?? 0;
  const short = !manual && account?.availableCents !== null && account?.availableCents !== undefined && total + fees > account.availableCents;

  const runPreview = () =>
    proposer.run(
      () => proposeBatchAction({ sourceAccountId: manual ? undefined : accountId || undefined, method, dueBefore, name, replaceBatchId: preview?.batchId ?? null }),
      (d) => {
        setPreview(d);
        return d.batchId
          ? { variant: 'info', title: `Draft ready: ${d.included} payment${d.included === 1 ? '' : 's'} totaling ${formatMoney(d.totalCents)}.`, detail: d.blocked.length ? `${d.blocked.length} installment${d.blocked.length === 1 ? ' is' : 's are'} blocked — see below.` : undefined }
          : { variant: 'warning', title: 'Nothing can be paid yet', detail: d.blocked.length ? 'Every due installment is blocked. The reasons are listed below.' : `No installments are due on or before ${formatDateOnly(dueBefore)}.` };
      },
    );

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle as="h2" className="text-base">
            1. Choose what to pay
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-5"
            onSubmit={(e) => {
              e.preventDefault();
              void runPreview();
            }}
          >
            <div className="grid gap-5 lg:grid-cols-2">
              {manual ? (
                <Alert variant="info" title="Paying outside GMS">
                  This workspace pays grants outside GMS. The batch still goes through approval here; after approval each payment is marked Sent, and you pay it from your own bank.
                </Alert>
              ) : (
                <Field label="Pay from" htmlFor={ids.account} description="Available balance as of the last refresh." required>
                  <Select value={accountId} onValueChange={setAccountId}>
                    <SelectTrigger id={ids.account}>
                      <SelectValue placeholder="Choose an account" />
                    </SelectTrigger>
                    <SelectContent>
                      {accounts.map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.name}
                          {a.mask ? ` ··${a.mask}` : ''} — {formatMoney(a.availableCents, a.currency)} available
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {account?.programs.length ? <p className="text-xs text-muted-foreground">Pays for: {account.programs.join(', ')}</p> : null}
                </Field>
              )}
              <div className="grid content-start gap-5 sm:grid-cols-2">
                <Field label="Include installments due on or before" htmlFor={ids.due} required>
                  <Input id={ids.due} type="date" value={dueBefore} onChange={(e) => setDueBefore(e.target.value)} required />
                </Field>
                <Field label="Batch name" htmlFor={ids.name} optional>
                  <Input id={ids.name} value={name} maxLength={200} onChange={(e) => setName(e.target.value)} placeholder={`Payments due by ${dueBefore}`} />
                </Field>
              </div>
            </div>
            {manual ? null : (
              <FieldSet legend="Payment method">
                <RadioGroup value={method} onValueChange={(v) => setMethod(v as Method)} className="grid gap-2 sm:grid-cols-2">
                  {METHODS.map((m) => (
                    <RadioOption key={m} value={m} label={PAYMENT_METHOD_LABELS[m]} description={`${METHOD_HINT[m]} ${feeText(m)}`} />
                  ))}
                </RadioGroup>
              </FieldSet>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" pending={proposer.pending} pendingLabel="Building preview…" disabled={!manual && !accountId}>
                {preview ? 'Rebuild preview' : 'Preview batch'}
              </Button>
              <span className="text-sm text-muted-foreground">Previewing creates a draft. Nothing is paid until two different people have acted.</span>
            </div>
            <FeedbackRegion feedback={proposer.feedback} />
          </form>
        </CardContent>
      </Card>

      {preview ? (
        <>
          {preview.batchId ? (
            <Card>
              <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
                <CardTitle as="h2" className="text-base">
                  2. Check the payments
                </CardTitle>
                <StatusChip kind="batch" value="draft" />
              </CardHeader>
              <CardContent className="grid gap-5">
                <DescriptionList
                  layout="grid"
                  columns={3}
                  items={[
                    { term: 'Source account', detail: manual ? 'Your own bank (outside GMS)' : account ? `${account.name}${account.mask ? ` ··${account.mask}` : ''}` : '—' },
                    { term: 'Available balance', detail: manual ? '—' : <MoneyDisplay cents={account?.availableCents ?? null} currency={account?.currency} />, numeric: true },
                    { term: 'Method', detail: manual ? PAYMENT_METHOD_LABELS.manual : PAYMENT_METHOD_LABELS[method] },
                    { term: 'Payments', detail: preview.included, numeric: true },
                    { term: 'Total to grantees', detail: <MoneyDisplay cents={total} className="font-semibold" />, numeric: true },
                    { term: 'Mercury fees', detail: <MoneyDisplay cents={fees} />, numeric: true },
                  ]}
                />
                {total >= secondApprovalThresholdCents ? (
                  <Alert variant="info" title="Two approvals needed">
                    This batch is at or above {formatMoney(secondApprovalThresholdCents)}, so two different people (neither of them you) must approve it.
                  </Alert>
                ) : null}
                {short ? (
                  <Alert variant="warning" title="The account may not cover this batch">
                    {formatMoney(total + fees)} including fees is more than the {formatMoney(account?.availableCents ?? 0)} available. Mercury will decline payments it can’t fund.
                  </Alert>
                ) : null}
                <Table containerLabel="Payments in this draft batch">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Grant</TableHead>
                      <TableHead>Grantee</TableHead>
                      <TableHead>Due</TableHead>
                      <TableHead>Payee</TableHead>
                      <TableHead className="text-right">Fee</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.payments.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell>
                          <Link className="font-medium hover:underline" href={`/console/awards/${p.awardId}`}>
                            {p.awardReference}
                          </Link>
                        </TableCell>
                        <TableCell>{p.grantee}</TableCell>
                        <TableCell className="whitespace-nowrap">{formatDateOnly(p.dueDate)}</TableCell>
                        <TableCell>{p.payeeStatus ? <StatusChip kind="payee" value={p.payeeStatus} size="sm" /> : '—'}</TableCell>
                        <TableCell className="text-right">
                          <MoneyDisplay cents={p.feeCents} />
                        </TableCell>
                        <TableCell className="text-right">
                          <MoneyDisplay cents={p.amountCents} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                  <TableFooter>
                    <TableRow>
                      <TableCell colSpan={4}>Total ({preview.included} payments)</TableCell>
                      <TableCell className="text-right">
                        <MoneyDisplay cents={fees} />
                      </TableCell>
                      <TableCell className="text-right">
                        <MoneyDisplay cents={total} />
                      </TableCell>
                    </TableRow>
                  </TableFooter>
                </Table>
                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    pending={sender.pending}
                    pendingLabel="Sending…"
                    onClick={() => {
                      const id = preview.batchId!;
                      void sender.run(() => submitBatchAction(id), () => ({ variant: 'success', title: 'Sent for approval. Opening the batch…' })).then((ok) => {
                        if (ok) router.push(`/console/payments/batches/${id}`);
                      });
                    }}
                  >
                    Send {preview.included} payment{preview.included === 1 ? '' : 's'} for approval
                  </Button>
                  <Button
                    variant="outline"
                    disabled={sender.pending}
                    onClick={() => {
                      const id = preview.batchId!;
                      void sender.run(() => cancelBatchAction(id), () => ({ variant: 'info', title: 'Draft discarded. Its installments can be batched again.' })).then((ok) => {
                        if (ok) setPreview(null);
                      });
                    }}
                  >
                    Discard draft
                  </Button>
                  <span className="text-sm text-muted-foreground">You created this batch, so someone else must approve it.</span>
                </div>
                <FeedbackRegion feedback={sender.feedback} />
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle as="h2" className="text-base">
                Blocked ({preview.blocked.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              {preview.blocked.length ? (
                <Table containerLabel="Blocked installments">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Grant</TableHead>
                      <TableHead>Grantee</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Why it can’t be paid yet</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.blocked.map((b) => (
                      <TableRow key={b.installmentId} className="align-top">
                        <TableCell className="font-medium">{b.awardReference}</TableCell>
                        <TableCell>{b.grantee}</TableCell>
                        <TableCell className="text-right">
                          <MoneyDisplay cents={b.amountCents} />
                        </TableCell>
                        <TableCell>
                          <BlockedReasons reasons={b.reasons} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <p className="text-sm text-muted-foreground">Nothing is blocked. Every due installment is in the draft.</p>
              )}
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}
