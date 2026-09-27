// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { useDraggable } from '@dnd-kit/core';
import { cn } from '@gms/ui';
import { Plus } from 'lucide-react';
import * as React from 'react';
import type { FieldType } from '../../model';
import { FIELD_TYPE_DESCRIPTIONS, FIELD_TYPE_LABELS } from '../builder-ops';
import { ElementIcon } from './shared';

export type PaletteKind = FieldType | 'section' | 'info_block';

export const PALETTE_PREFIX = 'palette:';

const GROUPS: { title: string; kinds: PaletteKind[] }[] = [
  { title: 'Text and numbers', kinds: ['text', 'long_text', 'rich_text', 'number', 'currency', 'date'] },
  { title: 'Choices', kinds: ['select', 'multi_select', 'checkbox_group', 'yes_no', 'likert_matrix'] },
  { title: 'People and organizations', kinds: ['name', 'address', 'email', 'phone', 'ein', 'uei'] },
  { title: 'Documents, tables and signatures', kinds: ['file_upload', 'repeater_table', 'attestation'] },
  { title: 'Layout', kinds: ['section', 'info_block'] },
];

export function paletteLabel(kind: PaletteKind): string {
  if (kind === 'section') return 'Section';
  if (kind === 'info_block') return 'Text block';
  return FIELD_TYPE_LABELS[kind];
}

function paletteDescription(kind: PaletteKind): string {
  if (kind === 'section') return 'Group related questions under a heading.';
  if (kind === 'info_block') return 'Instructions or context. Collects no answer.';
  return FIELD_TYPE_DESCRIPTIONS[kind];
}

function PaletteItem({ kind, onAdd, disabled, targetLabel }: { kind: PaletteKind; onAdd: (k: PaletteKind) => void; disabled?: boolean; targetLabel: string }) {
  const { setNodeRef, listeners, isDragging } = useDraggable({ id: `${PALETTE_PREFIX}${kind}`, disabled });
  const descId = React.useId();
  return (
    <li>
      <button
        ref={setNodeRef}
        type="button"
        disabled={disabled}
        // Pointer only: keyboard users press Enter to add (a keyboard drag would be a detour here).
        onPointerDown={listeners?.onPointerDown as React.PointerEventHandler<HTMLButtonElement> | undefined}
        onClick={() => onAdd(kind)}
        aria-describedby={descId}
        className={cn(
          'group flex min-h-11 w-full items-start gap-2.5 rounded-md border border-transparent px-2.5 py-2 text-left text-sm',
          'hover:border-border hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring',
          'disabled:pointer-events-none disabled:opacity-50',
          isDragging && 'opacity-50',
        )}
      >
        <ElementIcon type={kind} className="mt-0.5 size-4 shrink-0 text-muted-foreground group-hover:text-foreground" />
        <span className="grid min-w-0 flex-1 gap-0.5">
          <span className="font-medium">{paletteLabel(kind)}</span>
          <span id={descId} className="text-xs text-muted-foreground">
            {paletteDescription(kind)}
            <span className="sr-only"> Adds to {targetLabel}.</span>
          </span>
        </span>
        <Plus className="mt-0.5 size-4 shrink-0 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100" aria-hidden="true" />
      </button>
    </li>
  );
}

export interface FieldPaletteProps {
  onAdd: (kind: PaletteKind) => void;
  /** Where new items go, e.g. "“Your project”, after “Project title”". */
  targetLabel: string;
  disabled?: boolean;
}

/** Field types to add: click (or Enter) adds at the insertion point; drag drops anywhere on the canvas. */
export function FieldPalette({ onAdd, targetLabel, disabled }: FieldPaletteProps) {
  return (
    <div className="grid gap-4">
      <p className="text-xs text-muted-foreground">
        Click to add to {targetLabel}, or drag onto the form.
      </p>
      {GROUPS.map((g) => (
        <section key={g.title} className="grid gap-1" aria-label={g.title}>
          <h3 className="px-2.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{g.title}</h3>
          <ul className="grid">
            {g.kinds.map((k) => (
              <PaletteItem key={k} kind={k} onAdd={onAdd} disabled={disabled} targetLabel={targetLabel} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
