// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { Badge, Button, cn, Input } from '@gms/ui';
import { Plus } from 'lucide-react';
import * as React from 'react';
import { type QuestionBankItem, QUESTION_BANK } from '../../library';
import { FieldSchema, type Field, type FormModel } from '../../model';
import { FIELD_TYPE_LABELS, uniqueId } from '../builder-ops';
import { ElementIcon } from './shared';

/** A fresh field from a bank item, with an id that is free in `model`. */
export function fieldFromBankItem(model: FormModel, item: QuestionBankItem): Field {
  const base = structuredClone(item.field) as Record<string, unknown>;
  const id = uniqueId(model, typeof base.id === 'string' ? base.id : item.key);
  return FieldSchema.parse({ ...base, id });
}

/** Matches a bank item against a search (label, description, tags, type, CG path). */
export function bankItemMatches(item: QuestionBankItem, query: string, tag: string | null): boolean {
  if (tag && !item.tags.includes(tag)) return false;
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = [item.label, item.description, item.tags.join(' '), item.cgPath ?? '', FIELD_TYPE_LABELS[item.field.type as keyof typeof FIELD_TYPE_LABELS] ?? ''].join(' ').toLowerCase();
  return q.split(/\s+/).every((w) => hay.includes(w));
}

export interface QuestionBankPanelProps {
  /** Workspace items shown before the built-in bank. */
  workspaceItems?: readonly QuestionBankItem[];
  onInsert: (item: QuestionBankItem) => void;
  targetLabel: string;
  disabled?: boolean;
}

export function QuestionBankPanel({ workspaceItems = [], onInsert, targetLabel, disabled }: QuestionBankPanelProps) {
  const [query, setQuery] = React.useState('');
  const [tag, setTag] = React.useState<string | null>(null);
  const searchId = React.useId();
  const all = React.useMemo(
    () => [...workspaceItems.map((item) => ({ item, source: 'workspace' as const })), ...QUESTION_BANK.map((item) => ({ item, source: 'default' as const }))],
    [workspaceItems],
  );
  const tags = React.useMemo(() => [...new Set(all.flatMap((x) => x.item.tags))].sort(), [all]);
  const shown = all.filter((x) => bankItemMatches(x.item, query, tag));
  return (
    <div className="grid gap-3">
      <div className="grid gap-1.5">
        <label htmlFor={searchId} className="text-sm font-medium">
          Search saved questions
        </label>
        <Input id={searchId} type="search" inputSize="sm" value={query} onChange={(e) => setQuery(e.currentTarget.value)} />
      </div>
      <div role="group" aria-label="Filter by topic" className="flex flex-wrap gap-1">
        <Button type="button" size="sm" variant={tag === null ? 'secondary' : 'ghost'} aria-pressed={tag === null} onClick={() => setTag(null)} className="h-7 px-2 text-xs">
          All
        </Button>
        {tags.map((t) => (
          <Button key={t} type="button" size="sm" variant={tag === t ? 'secondary' : 'ghost'} aria-pressed={tag === t} onClick={() => setTag(tag === t ? null : t)} className="h-7 px-2 text-xs">
            {t}
          </Button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground" aria-live="polite">
        {shown.length} {shown.length === 1 ? 'question' : 'questions'}. Adds to {targetLabel}.
      </p>
      <ul className="grid gap-2">
        {shown.map(({ item, source }) => (
          <li key={`${source}:${item.key}`} className="grid gap-1.5 rounded-md border bg-card p-2.5">
            <div className="flex items-start gap-2">
              <ElementIcon type={item.field.type} className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <div className="grid min-w-0 flex-1 gap-0.5">
                <span className="text-sm font-medium">{item.label}</span>
                <span className="text-xs text-muted-foreground">{item.description}</span>
              </div>
              <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => onInsert(item)} aria-label={`Add “${item.label}”`}>
                <Plus aria-hidden="true" />
                Add
              </Button>
            </div>
            <div className={cn('flex flex-wrap gap-1 pl-6')}>
              {source === 'workspace' ? <Badge variant="info">Your workspace</Badge> : null}
              {item.cgPath ? <Badge variant="outline">{item.cgPath}</Badge> : null}
              {item.tags.map((t) => (
                <Badge key={t} variant="muted">
                  {t}
                </Badge>
              ))}
            </div>
          </li>
        ))}
      </ul>
      {shown.length === 0 ? <p className="text-sm text-muted-foreground">No saved questions match. Try another word, or add a new question from the field types.</p> : null}
    </div>
  );
}
