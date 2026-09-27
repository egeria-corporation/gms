// SPDX-License-Identifier: AGPL-3.0-only
'use client';
// Pipeline filter bar: every filter lives in the URL (status, opportunity, stage, program, tags, from/to,
// agent, dupes, q) so views can be saved and shared. The page reads the same params on the server.
import {
  Button,
  CheckboxField,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  Field,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@gms/ui';
import { ChevronDown, FilterX, Search } from 'lucide-react';
import { useState } from 'react';
import { useUrlParams } from '../url-data-table';
import type { Option } from './types';

export interface PipelineFilterValues {
  status: string[];
  opportunity: string;
  stage: string;
  program: string;
  tags: string[];
  from: string;
  to: string;
  agent: string;
  dupes: boolean;
  q: string;
}

const ALL = 'all';

function MultiPick({ label, options, value, onChange }: { label: string; options: Option[]; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" aria-label={`${label} filter${value.length ? `, ${value.length} selected` : ''}`}>
          {label}
          {value.length ? <span className="rounded bg-muted px-1 text-xs tabular-nums">{value.length}</span> : null}
          <ChevronDown aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel>{label}</DropdownMenuLabel>
        {options.length ? (
          options.map((o) => (
            <DropdownMenuCheckboxItem
              key={o.value}
              checked={value.includes(o.value)}
              onSelect={(e) => e.preventDefault()}
              onCheckedChange={(on) => onChange(on === true ? [...value, o.value] : value.filter((v) => v !== o.value))}
            >
              {o.label}
            </DropdownMenuCheckboxItem>
          ))
        ) : (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">None yet.</p>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function OnePick({ id, label, options, value, onChange, allLabel }: { id: string; label: string; options: Option[]; value: string; onChange: (v: string) => void; allLabel: string }) {
  return (
    <Field label={label} htmlFor={id} className="gap-1" labelClassName="text-xs text-muted-foreground">
      <Select value={value || ALL} onValueChange={(v) => onChange(v === ALL ? '' : v)}>
        <SelectTrigger id={id} size="sm" className="w-44">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{allLabel}</SelectItem>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

export function PipelineFilters({
  values,
  statuses,
  opportunities,
  stages,
  programs,
  tags,
  showSearch = false,
}: {
  values: PipelineFilterValues;
  statuses: Option[];
  opportunities: Option[];
  stages: Option[];
  programs: Option[];
  tags: Option[];
  showSearch?: boolean;
}) {
  const { set, pending } = useUrlParams();
  const [q, setQ] = useState(values.q);
  const update = (patch: Record<string, string | null>) => set(patch, { resetPage: true });
  const stageOptions = values.opportunity ? stages.filter((s) => s.parent === values.opportunity) : stages;
  const active =
    values.status.length + values.tags.length + Number(Boolean(values.opportunity)) + Number(Boolean(values.stage)) + Number(Boolean(values.program)) + Number(Boolean(values.from || values.to)) + Number(Boolean(values.agent)) + Number(values.dupes);
  return (
    <div className="flex flex-wrap items-end gap-3" aria-busy={pending || undefined} role="group" aria-label="Filters">
      {showSearch ? (
        <form
          role="search"
          className="grid gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            update({ q: q.trim() || null });
          }}
        >
          <label htmlFor="pipe-q" className="text-xs text-muted-foreground">
            Search
          </label>
          <div className="flex gap-1">
            <Input id="pipe-q" type="search" className="h-8 w-52" placeholder="Reference, title or organization" value={q} onChange={(e) => setQ(e.target.value)} />
            <Button type="submit" size="icon-sm" variant="outline" aria-label="Search">
              <Search aria-hidden="true" />
            </Button>
          </div>
        </form>
      ) : null}
      <div className="flex flex-wrap items-center gap-2 self-end">
        <MultiPick label="Status" options={statuses} value={values.status} onChange={(v) => update({ status: v.join(',') || null })} />
        <MultiPick label="Tags" options={tags} value={values.tags} onChange={(v) => update({ tags: v.join(',') || null })} />
      </div>
      <OnePick id="pipe-opp" label="Opportunity" allLabel="All opportunities" options={opportunities} value={values.opportunity} onChange={(v) => update({ opportunity: v || null, stage: null })} />
      <OnePick id="pipe-stage" label="Stage" allLabel="All stages" options={stageOptions} value={values.stage} onChange={(v) => update({ stage: v || null })} />
      <OnePick id="pipe-program" label="Program" allLabel="All programs" options={programs} value={values.program} onChange={(v) => update({ program: v || null })} />
      <Field label="Submitted from" htmlFor="pipe-from" className="gap-1" labelClassName="text-xs text-muted-foreground">
        <Input id="pipe-from" type="date" className="h-8 w-36" value={values.from} max={values.to || undefined} onChange={(e) => update({ from: e.target.value || null })} />
      </Field>
      <Field label="Submitted to" htmlFor="pipe-to" className="gap-1" labelClassName="text-xs text-muted-foreground">
        <Input id="pipe-to" type="date" className="h-8 w-36" value={values.to} min={values.from || undefined} onChange={(e) => update({ to: e.target.value || null })} />
      </Field>
      <OnePick
        id="pipe-agent"
        label="Submitted by an agent"
        allLabel="Either"
        options={[
          { value: 'yes', label: 'Yes (via agent)' },
          { value: 'no', label: 'No' },
        ]}
        value={values.agent}
        onChange={(v) => update({ agent: v || null })}
      />
      <CheckboxField className="self-end pb-1" label="Possible duplicates only" checked={values.dupes} onCheckedChange={(v) => update({ dupes: v === true ? '1' : null })} />
      {active ? (
        <Button
          variant="ghost"
          size="sm"
          className="self-end"
          onClick={() => update({ status: null, opportunity: null, stage: null, program: null, tags: null, from: null, to: null, agent: null, dupes: null })}
        >
          <FilterX aria-hidden="true" /> Clear {active} filter{active === 1 ? '' : 's'}
        </Button>
      ) : null}
    </div>
  );
}
