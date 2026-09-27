// SPDX-License-Identifier: AGPL-3.0-only
'use client';
// Manual rail: record one payment made outside GMS, or import many from a CSV (parsed in the browser, then
// sent as rows to payments.import_csv). Nothing here moves money.
import { parsePaymentsCsv, type ParsedPaymentsCsv } from '@gms/adapters/payments/manual';
import { formatDateOnly, formatMoney, parseMoneyToCents, PAYMENT_METHOD_LABELS, type PaymentMethod } from '@gms/domain';
import {
  Alert,
  Button,
  Field,
  FileDropzone,
  Input,
  MoneyDisplay,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
  type DropzoneFile,
} from '@gms/ui';
import * as React from 'react';
import { importCsvAction, recordManualAction } from '@/app/console/(app)/payments/actions';
import { FeedbackRegion, useRunner } from './client-utils';

export interface ManualAward {
  id: string;
  reference: string;
  grantee: string;
  amountCents: number;
  disbursedCents: number;
  installments: { id: string; position: number; dueDate: string; amountCents: number }[];
}

const METHODS: PaymentMethod[] = ['manual', 'ach', 'check', 'domestic_wire', 'international_wire'];

export function RecordPaymentForm({ awards, today }: { awards: ManualAward[]; today: string }) {
  const [awardId, setAwardId] = React.useState('');
  const [installmentId, setInstallmentId] = React.useState('none');
  const [amount, setAmount] = React.useState('');
  const [paidOn, setPaidOn] = React.useState(today);
  const [method, setMethod] = React.useState<PaymentMethod>('check');
  const [reference, setReference] = React.useState('');
  const [memo, setMemo] = React.useState('');
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const { run, pending, feedback } = useRunner();
  const ids = { award: React.useId(), inst: React.useId(), amount: React.useId(), paid: React.useId(), method: React.useId(), ref: React.useId(), memo: React.useId() };
  const award = awards.find((a) => a.id === awardId);
  const cents = parseMoneyToCents(amount);

  if (!awards.length) return <p className="text-sm text-muted-foreground">There are no active awards to record payments against.</p>;
  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        const errs: Record<string, string> = {};
        if (!awardId) errs.award = 'Choose the award this payment is for.';
        if (!cents || cents <= 0) errs.amount = 'Enter the amount paid, for example 12,500.00.';
        if (!/^\d{4}-\d{2}-\d{2}$/.test(paidOn)) errs.paid = 'Enter the date it was paid.';
        setErrors(errs);
        if (Object.keys(errs).length) return;
        void run(
          () =>
            recordManualAction({
              awardId,
              installmentId: installmentId !== 'none' ? installmentId : undefined,
              amountCents: cents!,
              paidOn,
              method,
              reference,
              memo,
            }),
          () => ({ variant: 'success', title: `Recorded ${formatMoney(cents!)} paid to ${award?.grantee ?? 'the grantee'} on ${formatDateOnly(paidOn)}.` }),
        ).then((ok) => {
          if (ok) {
            setAmount('');
            setReference('');
            setMemo('');
            setInstallmentId('none');
          }
        });
      }}
    >
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Award" htmlFor={ids.award} required error={errors.award}>
          <Select
            value={awardId}
            onValueChange={(v) => {
              setAwardId(v);
              setInstallmentId('none');
            }}
          >
            <SelectTrigger id={ids.award}>
              <SelectValue placeholder="Choose an award" />
            </SelectTrigger>
            <SelectContent>
              {awards.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.reference} · {a.grantee}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {award ? (
            <p className="text-xs text-muted-foreground">
              Awarded {formatMoney(award.amountCents)} · paid so far {formatMoney(award.disbursedCents)}
            </p>
          ) : null}
        </Field>
        <Field label="Installment" htmlFor={ids.inst} optional description="Marks that installment paid.">
          <Select
            value={installmentId}
            disabled={!award?.installments.length}
            onValueChange={(v) => {
              setInstallmentId(v);
              const inst = award?.installments.find((i) => i.id === v);
              if (inst) setAmount((inst.amountCents / 100).toFixed(2));
            }}
          >
            <SelectTrigger id={ids.inst}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Not tied to an installment</SelectItem>
              {award?.installments.map((i) => (
                <SelectItem key={i.id} value={i.id}>
                  #{i.position} · due {formatDateOnly(i.dueDate)} · {formatMoney(i.amountCents)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Amount paid (USD)" htmlFor={ids.amount} required error={errors.amount}>
          <Input id={ids.amount} inputMode="decimal" autoComplete="off" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="12,500.00" className="tabular-nums" />
        </Field>
        <Field label="Paid on" htmlFor={ids.paid} required error={errors.paid}>
          <Input id={ids.paid} type="date" value={paidOn} max={today} onChange={(e) => setPaidOn(e.target.value)} />
        </Field>
        <Field label="Method" htmlFor={ids.method}>
          <Select value={method} onValueChange={(v) => setMethod(v as PaymentMethod)}>
            <SelectTrigger id={ids.method}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {METHODS.map((m) => (
                <SelectItem key={m} value={m}>
                  {m === 'manual' ? 'Other' : PAYMENT_METHOD_LABELS[m]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Reference" htmlFor={ids.ref} optional description="Check number or your bank’s confirmation number.">
          <Input id={ids.ref} maxLength={200} value={reference} onChange={(e) => setReference(e.target.value)} />
        </Field>
      </div>
      <Field label="Memo" htmlFor={ids.memo} optional>
        <Textarea id={ids.memo} rows={2} maxLength={500} value={memo} onChange={(e) => setMemo(e.target.value)} />
      </Field>
      <div>
        <Button type="submit" pending={pending} pendingLabel="Recording…">
          {cents && cents > 0 ? `Record ${formatMoney(cents)} payment` : 'Record payment'}
        </Button>
      </div>
      <FeedbackRegion feedback={feedback} />
    </form>
  );
}

export function CsvImport() {
  const [files, setFiles] = React.useState<DropzoneFile[]>([]);
  const [parsed, setParsed] = React.useState<ParsedPaymentsCsv | null>(null);
  const [rejected, setRejected] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<{ imported: number; errors: { line: number; message: string }[] } | null>(null);
  const { run, pending, feedback } = useRunner();

  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted-foreground">
        Columns: <code>award_reference</code>, <code>payee_name</code>, <code>amount</code> (dollars), <code>paid_on</code> (YYYY-MM-DD or M/D/YYYY), and optionally <code>method</code>, <code>reference</code>, <code>memo</code>,{' '}
        <code>currency</code>. The export below uses the same columns.
      </p>
      <FileDropzone
        accept=".csv,text/csv"
        acceptLabel="CSV"
        maxSizeBytes={2 * 1024 * 1024}
        maxFiles={1}
        multiple={false}
        files={files}
        onRemove={() => {
          setFiles([]);
          setParsed(null);
          setResult(null);
        }}
        onFilesSelected={async (accepted, rej) => {
          setRejected(rej[0]?.message ?? null);
          const f = accepted[0];
          if (!f) return;
          setResult(null);
          const text = await f.text();
          const p = parsePaymentsCsv(text, { maxRows: 2000 });
          setParsed(p);
          setFiles([{ id: 'csv', name: f.name, size: f.size, status: p.rows.length ? 'clean' : 'error', message: p.rows.length ? undefined : 'No importable rows.' }]);
        }}
      />
      {rejected ? <Alert variant="danger" title="That file wasn’t added">{rejected}</Alert> : null}
      {parsed ? (
        <div className="grid gap-3">
          <p className="text-sm" role="status">
            {parsed.rows.length} row{parsed.rows.length === 1 ? '' : 's'} ready to import
            {parsed.rows.length ? (
              <>
                {' '}
                totaling <MoneyDisplay cents={parsed.rows.reduce((s, r) => s + r.amountCents, 0)} />
              </>
            ) : null}
            {parsed.errors.length ? `, ${parsed.errors.length} problem${parsed.errors.length === 1 ? '' : 's'} to fix` : ''}.
            {parsed.ignoredColumns.length ? ` Ignored columns: ${parsed.ignoredColumns.join(', ')}.` : ''}
          </p>
          {parsed.errors.length ? (
            <Alert variant="warning" title="Rows with problems are skipped">
              <ul className="list-disc pl-5">
                {parsed.errors.slice(0, 20).map((e, i) => (
                  <li key={i}>
                    Line {e.line}
                    {e.column ? ` (${e.column})` : ''}: {e.message}
                  </li>
                ))}
              </ul>
              {parsed.errors.length > 20 ? <p>…and {parsed.errors.length - 20} more.</p> : null}
            </Alert>
          ) : null}
          {parsed.rows.length ? (
            <>
              <Table containerLabel="Rows to import" containerClassName="max-h-80 rounded-md border">
                <TableHeader>
                  <TableRow>
                    <TableHead>Line</TableHead>
                    <TableHead>Award</TableHead>
                    <TableHead>Payee</TableHead>
                    <TableHead>Paid on</TableHead>
                    <TableHead>Method</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {parsed.rows.slice(0, 100).map((r) => (
                    <TableRow key={r.line}>
                      <TableCell>{r.line}</TableCell>
                      <TableCell>{r.awardReference}</TableCell>
                      <TableCell>{r.payeeName}</TableCell>
                      <TableCell>{formatDateOnly(r.paidOn)}</TableCell>
                      <TableCell>{PAYMENT_METHOD_LABELS[r.method]}</TableCell>
                      <TableCell className="text-right">
                        <MoneyDisplay cents={r.amountCents} currency={r.currency} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div>
                <Button
                  pending={pending}
                  pendingLabel="Importing…"
                  onClick={() => {
                    const rows = parsed.rows;
                    void run(
                      () => importCsvAction(rows.map((r) => ({ awardReference: r.awardReference, amountCents: r.amountCents, paidOn: r.paidOn, method: r.method, reference: r.reference ?? undefined }))),
                      (d) => {
                        setResult({ imported: d.imported, errors: d.errors.map((e) => ({ line: rows[e.row - 1]?.line ?? e.row, message: e.message })) });
                        return { variant: d.errors.length ? 'warning' : 'success', title: `Imported ${d.imported} of ${rows.length} payments.` };
                      },
                    );
                  }}
                >
                  Import {parsed.rows.length} payment{parsed.rows.length === 1 ? '' : 's'}
                </Button>
              </div>
            </>
          ) : null}
        </div>
      ) : null}
      <FeedbackRegion feedback={feedback} />
      {result?.errors.length ? (
        <Alert variant="warning" title="Some rows weren’t imported">
          <ul className="list-disc pl-5">
            {result.errors.map((e, i) => (
              <li key={i}>
                Line {e.line}: {e.message}
              </li>
            ))}
          </ul>
        </Alert>
      ) : null}
    </div>
  );
}
