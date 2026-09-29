// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';
import { Badge, Button, cn, EmptyState, ToneChip } from '@gms/ui';
import { CircleAlert, CircleCheck, Info, TriangleAlert } from 'lucide-react';
import * as React from 'react';
import { type LintIssue, type LintLevel } from '../../lint';
import type { FormModel } from '../../model';
import { elementLabel, getElement } from '../builder-ops';

const LEVELS: { level: LintLevel; title: string; hint: string; icon: typeof CircleAlert; tone: 'danger' | 'warning' | 'info' }[] = [
  { level: 'error', title: 'Must fix before publishing', hint: 'Applicants could not finish the form, or answers would be lost.', icon: CircleAlert, tone: 'danger' },
  { level: 'warning', title: 'Likely mistakes', hint: 'The form works, but applicants may be confused.', icon: TriangleAlert, tone: 'warning' },
  { level: 'info', title: 'Suggestions', hint: 'Small improvements.', icon: Info, tone: 'info' },
];

export interface LintPanelProps {
  model: FormModel;
  issues: readonly LintIssue[];
  /** Select the field (or page) in the builder. */
  onJump: (target: { fieldId?: string; pageId?: string }) => void;
}

/** FB-07: lintForm results grouped by level, each with a jump-to-field action. */
export function LintPanel({ model, issues, onJump }: LintPanelProps) {
  if (!issues.length) {
    return <EmptyState icon={CircleCheck} title="No problems found" description="Every check passed. You can preview the form or publish it." />;
  }
  const where = (i: LintIssue) => {
    if (i.fieldId) {
      const el = getElement(model, i.fieldId);
      if (el) return `“${elementLabel(el)}”`;
    }
    if (i.pageId) {
      const p = model.pages.find((x) => x.id === i.pageId);
      if (p) return `page “${p.title || p.id}”`;
    }
    return undefined;
  };
  return (
    <div className="grid gap-6">
      {LEVELS.map((l) => {
        const list = issues.filter((i) => i.level === l.level);
        if (!list.length) return null;
        return (
          <section key={l.level} aria-labelledby={`lint-${l.level}`} className="grid gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <h3 id={`lint-${l.level}`} className="font-heading text-base font-semibold">
                {l.title}
              </h3>
              <ToneChip tone={l.tone} icon={l.icon} label={`${list.length}`} size="sm" />
            </div>
            <p className="text-sm text-muted-foreground">{l.hint}</p>
            <ul className="grid gap-2">
              {list.map((i, idx) => {
                const target = where(i);
                return (
                  <li key={`${i.code}-${idx}`} className={cn('flex flex-wrap items-start gap-3 rounded-md border bg-card p-3 text-sm')}>
                    <l.icon className={cn('mt-0.5 size-4 shrink-0', l.tone === 'danger' ? 'text-status-danger-fg' : l.tone === 'warning' ? 'text-status-warning-fg' : 'text-status-info-fg')} aria-hidden="true" />
                    <div className="grid min-w-0 flex-1 gap-1">
                      <p>{i.message}</p>
                      <Badge variant="muted" className="font-mono">
                        {i.code}
                      </Badge>
                    </div>
                    {target ? (
                      <Button type="button" size="sm" variant="outline" onClick={() => onJump({ fieldId: i.fieldId, pageId: i.pageId })}>
                        Go to {target}
                      </Button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
