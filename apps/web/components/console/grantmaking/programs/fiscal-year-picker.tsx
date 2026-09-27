// SPDX-License-Identifier: AGPL-3.0-only
'use client';
// Fiscal-year switcher (URL param `fy`).
import { Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@gms/ui';
import { useId } from 'react';
import { useUrlParams } from '../url-data-table';

export function FiscalYearPicker({ value, years }: { value: number; years: number[] }) {
  const { set } = useUrlParams();
  const id = useId();
  return (
    <div className="flex items-center gap-2">
      <Label htmlFor={id} className="text-sm text-muted-foreground">
        Fiscal year
      </Label>
      <Select value={String(value)} onValueChange={(v) => set({ fy: v })}>
        <SelectTrigger id={id} size="sm" className="w-28">
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
    </div>
  );
}
