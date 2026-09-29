// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';
import { Alert, Badge, EmptyState } from '@gms/ui';
import { CircleCheck, TriangleAlert } from 'lucide-react';
import * as React from 'react';
import { diffVersions, type FormChange, migrationNotice } from '../../diff';
import type { FormModel } from '../../model';

export interface FormDiffViewProps {
  before: FormModel;
  after: FormModel;
  beforeLabel?: string;
  afterLabel?: string;
  /** Show the "what happens to applications in progress" notice (default true). */
  showMigration?: boolean;
}

function groupByPage(changes: readonly FormChange[], after: FormModel, before: FormModel): { title: string; changes: FormChange[] }[] {
  const titleOf = (id: string | undefined) => (id ? (after.pages.find((p) => p.id === id)?.title ?? before.pages.find((p) => p.id === id)?.title ?? id) : undefined);
  const groups = new Map<string, FormChange[]>();
  for (const c of changes) {
    const key = titleOf(c.pageId) ?? 'Whole form';
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  return [...groups].map(([title, list]) => ({ title, changes: list }));
}

/** FB-07: what changed between two versions (diffVersions) and what it means for applicants (migrationNotice). */
export function FormDiffView({ before, after, beforeLabel = 'Before', afterLabel = 'After', showMigration = true }: FormDiffViewProps) {
  const changes = React.useMemo(() => diffVersions(before, after), [before, after]);
  const notice = React.useMemo(() => migrationNotice(before, after), [before, after]);
  if (!changes.length) {
    return <EmptyState icon={CircleCheck} title="No differences" description={`${afterLabel} is the same as ${beforeLabel}.`} />;
  }
  const affecting = changes.filter((c) => c.affectsAnswers).length;
  return (
    <div className="grid gap-5">
      <p className="text-sm text-muted-foreground">
        Comparing <span className="font-medium text-foreground">{beforeLabel}</span> with <span className="font-medium text-foreground">{afterLabel}</span>: {changes.length}{' '}
        {changes.length === 1 ? 'change' : 'changes'}
        {affecting ? `, ${affecting} may affect answers already given` : ''}.
      </p>
      {showMigration ? (
        <Alert variant={notice.newRequired.length || notice.needsReview.length || notice.removed.length ? 'warning' : 'info'} title="Applications in progress">
          <p>{notice.summary}</p>
          {notice.details.length > 1 ? (
            <ul className="mt-2 list-disc pl-5">
              {notice.details.slice(1).map((d, i) => (
                <li key={i}>{d}</li>
              ))}
            </ul>
          ) : null}
        </Alert>
      ) : null}
      {groupByPage(changes, after, before).map((g) => (
        <section key={g.title} className="grid gap-2">
          <h3 className="text-sm font-semibold">{g.title}</h3>
          <ul className="grid gap-1.5">
            {g.changes.map((c, i) => (
              <li key={`${c.kind}-${c.fieldId ?? ''}-${c.property ?? ''}-${i}`} className="flex flex-wrap items-start gap-2 rounded-md border bg-card px-3 py-2 text-sm">
                <span className="min-w-0 flex-1">{c.summary}</span>
                {c.affectsAnswers ? (
                  <Badge variant="warning">
                    <TriangleAlert aria-hidden="true" />
                    May affect answers
                  </Badge>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
