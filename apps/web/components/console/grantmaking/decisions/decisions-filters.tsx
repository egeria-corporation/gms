// SPDX-License-Identifier: AGPL-3.0-only
'use client';
// R-05 filters (all in the URL): view (awaiting / decided / all), opportunity, latest recommendation.
import { Button, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, cn } from '@gms/ui';
import { useId } from 'react';
import { useUrlParams } from '../url-data-table';

const VIEWS = [
  { value: 'pending', label: 'Awaiting decision' },
  { value: 'decided', label: 'Decided' },
  { value: 'all', label: 'All' },
] as const;

export function DecisionsFilters({ view, opportunities, opp, rec }: { view: 'pending' | 'decided' | 'all'; opportunities: { id: string; title: string }[]; opp: string | null; rec: string | null }) {
  const { set } = useUrlParams();
  const oppId = useId();
  const recId = useId();
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <nav aria-label="Decision views" className="inline-flex rounded-lg border bg-muted p-0.5">
        {VIEWS.map((v) => (
          <button
            key={v.value}
            type="button"
            aria-current={view === v.value ? 'page' : undefined}
            onClick={() => set({ final: v.value === 'pending' ? null : v.value }, { resetPage: true })}
            className={cn(
              'min-h-8 rounded-md px-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
              view === v.value ? 'bg-card text-foreground shadow-soft' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {v.label}
          </button>
        ))}
      </nav>
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid gap-1">
          <Label htmlFor={oppId} className="text-xs text-muted-foreground">
            Opportunity
          </Label>
          <Select value={opp ?? 'all'} onValueChange={(v) => set({ opp: v === 'all' ? null : v }, { resetPage: true })}>
            <SelectTrigger id={oppId} size="sm" className="w-56">
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
        </div>
        <div className="grid gap-1">
          <Label htmlFor={recId} className="text-xs text-muted-foreground">
            Recommendation
          </Label>
          <Select value={rec ?? 'any'} onValueChange={(v) => set({ rec: v === 'any' ? null : v }, { resetPage: true })}>
            <SelectTrigger id={recId} size="sm" className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="any">Any</SelectItem>
              <SelectItem value="approve">Approve</SelectItem>
              <SelectItem value="decline">Decline</SelectItem>
              <SelectItem value="defer">Defer</SelectItem>
              <SelectItem value="none">No recommendation yet</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {opp || rec ? (
          <Button variant="ghost" size="sm" onClick={() => set({ opp: null, rec: null }, { resetPage: true })}>
            Clear filters
          </Button>
        ) : null}
      </div>
    </div>
  );
}
