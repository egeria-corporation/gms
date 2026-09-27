// SPDX-License-Identifier: AGPL-3.0-only
'use client';
// Set a program's budget for a fiscal year (programs.set_budget; owner, admin and finance).
import { formatMoney, parseMoneyToCents } from '@gms/domain';
import { Button, Field, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@gms/ui';
import { useState } from 'react';
import { setBudgetAction, updateProgramAction } from '@/app/console/(app)/programs/actions';
import { ConfirmActionButton, useRunAction } from '../run-action';

export function BudgetForm({ programId, years, budgets, defaultYear }: { programId: string; years: number[]; budgets: Record<number, number>; defaultYear: number }) {
  const [year, setYear] = useState(String(defaultYear));
  const initial = budgets[defaultYear];
  const [amount, setAmount] = useState(initial !== undefined ? (initial / 100).toFixed(2) : '');
  const [error, setError] = useState<string | null>(null);
  const { run, pending } = useRunAction();
  const current = budgets[Number(year)];
  return (
    <form
      className="grid gap-3 sm:grid-cols-[8rem_1fr_auto] sm:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        const cents = parseMoneyToCents(amount);
        if (cents === null || cents < 0) {
          setError('Enter an amount in dollars, like 250,000.');
          return;
        }
        setError(null);
        void run(() => setBudgetAction(programId, Number(year), cents), { success: `FY${year} budget set to ${formatMoney(cents)}.` });
      }}
    >
      <Field label="Fiscal year" htmlFor="budget-year">
        <Select
          value={year}
          onValueChange={(v) => {
            setYear(v);
            const b = budgets[Number(v)];
            setAmount(b !== undefined ? (b / 100).toFixed(2) : '');
          }}
        >
          <SelectTrigger id="budget-year">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {years.map((y) => (
              <SelectItem key={y} value={String(y)}>
                FY{y}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field
        label="Grantmaking budget (USD)"
        htmlFor="budget-amount"
        error={error ?? undefined}
        description={current !== undefined ? `Currently ${formatMoney(current)}.` : 'No budget set for this year yet.'}
      >
        <Input id="budget-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
      </Field>
      <Button type="submit" pending={pending} pendingLabel="Saving…">
        Save budget
      </Button>
    </form>
  );
}

export function ArchiveProgramButton({ programId, archived }: { programId: string; archived: boolean }) {
  return (
    <ConfirmActionButton
      label={archived ? 'Restore program' : 'Archive program'}
      title={archived ? 'Restore this program?' : 'Archive this program?'}
      description={
        archived
          ? 'It will show up again when creating opportunities and budgets.'
          : 'Archived programs keep their budgets, awards and history but are hidden when creating new opportunities. You can restore it later.'
      }
      confirmLabel={archived ? 'Restore program' : 'Archive program'}
      action={() => updateProgramAction(programId, { status: archived ? 'active' : 'archived' })}
      success={archived ? 'Program restored.' : 'Program archived.'}
    />
  );
}
