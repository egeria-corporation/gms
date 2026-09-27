// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { Button, CheckboxField, Field, Input, Sheet, SheetBody, SheetContent, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from '@gms/ui';
import { SlidersHorizontal } from 'lucide-react';
import { useState } from 'react';

export interface FilterState {
  q: string;
  status: string[];
  cause: string[];
  geography: string[];
}

const STATUSES = [
  { value: 'open', label: 'Open' },
  { value: 'forecasted', label: 'Forecasted (opening soon)' },
  { value: 'closed', label: 'Closed' },
];

function FilterFields({ facets, value, idPrefix }: { facets: { cause: string[]; geography: string[] }; value: FilterState; idPrefix: string }) {
  return (
    <div className="grid gap-6">
      <Field label="Search" htmlFor={`${idPrefix}-q`}>
        <Input id={`${idPrefix}-q`} name="q" type="search" defaultValue={value.q} autoComplete="off" />
      </Field>
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium">Status</legend>
        {STATUSES.map((s) => (
          <CheckboxField key={s.value} id={`${idPrefix}-status-${s.value}`} name="status" value={s.value} label={s.label} defaultChecked={value.status.includes(s.value)} />
        ))}
      </fieldset>
      {facets.cause.length ? (
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-sm font-medium">Cause area</legend>
          {facets.cause.map((c) => (
            <CheckboxField key={c} id={`${idPrefix}-cause-${c}`} name="cause" value={c} label={c} defaultChecked={value.cause.includes(c)} />
          ))}
        </fieldset>
      ) : null}
      {facets.geography.length ? (
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-sm font-medium">Where the work happens</legend>
          {facets.geography.map((g) => (
            <CheckboxField key={g} id={`${idPrefix}-geo-${g}`} name="geography" value={g} label={g} defaultChecked={value.geography.includes(g)} />
          ))}
        </fieldset>
      ) : null}
    </div>
  );
}

/** Filters submit as a plain GET form, so they work without JavaScript. On small screens they live in a sheet. */
export function OpportunityFilters({ facets, value, activeCount }: { facets: { cause: string[]; geography: string[] }; value: FilterState; activeCount: number }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <form method="get" action="/opportunities" className="hidden lg:grid lg:gap-6" aria-label="Filter opportunities">
        <FilterFields facets={facets} value={value} idPrefix="desk" />
        <div className="flex gap-2">
          <Button type="submit">Apply filters</Button>
          <Button asChild variant="ghost">
            <a href="/opportunities">Clear</a>
          </Button>
        </div>
      </form>
      <div className="lg:hidden">
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button variant="secondary" size="lg" className="w-full">
              <SlidersHorizontal aria-hidden="true" /> Filters{activeCount ? ` (${activeCount})` : ''}
            </Button>
          </SheetTrigger>
          <SheetContent side="bottom" aria-describedby={undefined}>
            <form method="get" action="/opportunities" className="flex h-full flex-col" onSubmit={() => setOpen(false)}>
              <SheetHeader>
                <SheetTitle>Filter opportunities</SheetTitle>
              </SheetHeader>
              <SheetBody>
                <FilterFields facets={facets} value={value} idPrefix="mob" />
              </SheetBody>
              <SheetFooter className="flex-row gap-2">
                <Button type="submit" size="lg" className="flex-1">
                  Show results
                </Button>
                <Button asChild variant="ghost" size="lg">
                  <a href="/opportunities">Clear</a>
                </Button>
              </SheetFooter>
            </form>
          </SheetContent>
        </Sheet>
      </div>
    </>
  );
}
