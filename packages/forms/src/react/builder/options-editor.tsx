// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { Button, Input } from '@gms/ui';
import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react';
import * as React from 'react';
import type { Option } from '../../model';
import { slugifyId } from '../builder-ops';

export interface OptionListEditorProps {
  /** Heading shown above the list, e.g. "Choices". */
  legend: string;
  items: readonly Option[];
  onChange: (items: Option[]) => void;
  /** Singular noun for buttons and labels, e.g. "choice", "row". */
  noun: string;
  /** Column heading for the stored value, e.g. "Stored value" or "Row id". */
  valueHeading?: string;
  disabled?: boolean;
  /** Minimum number of items (remove is disabled at this count). */
  min?: number;
}

function uniqueValue(base: string, taken: ReadonlySet<string>): string {
  const clean = slugifyId(base, 'option');
  if (!taken.has(clean)) return clean;
  for (let n = 2; ; n++) if (!taken.has(`${clean}_${n}`)) return `${clean}_${n}`;
}

/** Edits a list of {value, label} pairs with reorder, add and remove. Stored values follow labels until edited. */
export function OptionListEditor({ legend, items, onChange, noun, valueHeading = 'Stored value', disabled, min = 0 }: OptionListEditorProps) {
  const legendId = React.useId();
  const addRef = React.useRef<HTMLButtonElement>(null);
  const focusAfter = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!focusAfter.current) return;
    document.getElementById(focusAfter.current)?.focus();
    focusAfter.current = null;
  });
  const base = legendId.replace(/[^a-zA-Z0-9_-]/g, '');
  const labelId = (i: number) => `${base}-label-${i}`;

  const setLabel = (i: number, label: string) => {
    const old = items[i]!;
    const derived = old.value === slugifyId(old.label, 'option') || /^option_\d+$/.test(old.value);
    const taken = new Set(items.filter((_, j) => j !== i).map((o) => o.value));
    const value = derived && label.trim() ? uniqueValue(label, taken) : old.value;
    onChange(items.map((o, j) => (j === i ? { value, label } : o)));
  };
  const setValue = (i: number, value: string) => onChange(items.map((o, j) => (j === i ? { ...o, value: value.replace(/\s+/g, '_') } : o)));
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j]!, next[i]!];
    onChange(next);
  };
  const remove = (i: number) => {
    focusAfter.current = items.length > 1 ? labelId(Math.max(0, i - 1)) : null;
    onChange(items.filter((_, j) => j !== i));
    if (items.length <= 1) addRef.current?.focus();
  };
  const add = () => {
    const taken = new Set(items.map((o) => o.value));
    const n = items.length + 1;
    const label = `${noun.charAt(0).toUpperCase()}${noun.slice(1)} ${n}`;
    focusAfter.current = labelId(items.length);
    onChange([...items, { value: uniqueValue(`option_${n}`, taken), label }]);
  };
  const dupes = new Set(items.map((o) => o.value).filter((v, i, a) => a.indexOf(v) !== i));

  return (
    <fieldset className="grid gap-2" aria-labelledby={legendId} disabled={disabled}>
      <legend id={legendId} className="text-sm font-medium">
        {legend}
      </legend>
      {items.length ? (
        <div className="grid grid-cols-[1fr_7rem_auto] items-center gap-x-2 gap-y-1.5 text-xs text-muted-foreground" aria-hidden="true">
          <span>Label</span>
          <span>{valueHeading}</span>
          <span className="w-[6.5rem]" />
        </div>
      ) : null}
      <ol className="grid gap-1.5">
        {items.map((o, i) => (
          <li key={i} className="grid grid-cols-[1fr_7rem_auto] items-center gap-2">
            <Input id={labelId(i)} inputSize="sm" aria-label={`${noun} ${i + 1} label`} value={o.label} onChange={(e) => setLabel(i, e.currentTarget.value)} />
            <Input
              inputSize="sm"
              className="font-mono"
              aria-label={`${noun} ${i + 1} ${valueHeading.toLowerCase()}`}
              aria-invalid={dupes.has(o.value) || !o.value ? true : undefined}
              value={o.value}
              onChange={(e) => setValue(i, e.currentTarget.value)}
            />
            <span className="flex">
              <Button type="button" variant="ghost" size="icon-sm" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move ${noun} ${i + 1} up`}>
                <ArrowUp aria-hidden="true" />
              </Button>
              <Button type="button" variant="ghost" size="icon-sm" disabled={i === items.length - 1} onClick={() => move(i, 1)} aria-label={`Move ${noun} ${i + 1} down`}>
                <ArrowDown aria-hidden="true" />
              </Button>
              <Button type="button" variant="ghost" size="icon-sm" disabled={items.length <= min} onClick={() => remove(i)} aria-label={`Remove ${noun} ${i + 1}`}>
                <X aria-hidden="true" />
              </Button>
            </span>
          </li>
        ))}
      </ol>
      {dupes.size ? <p className="text-xs text-status-danger-fg">Two {noun}s share a stored value. Give each one its own.</p> : null}
      <Button ref={addRef} type="button" variant="outline" size="sm" className="justify-self-start" onClick={add}>
        <Plus aria-hidden="true" />
        Add {noun}
      </Button>
    </fieldset>
  );
}
