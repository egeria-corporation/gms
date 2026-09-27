// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { Alert, Button, cn } from '@gms/ui';
import * as React from 'react';
import type { CompiledForm } from '../compile';
import type { AutosaveConflict } from './autosave-queue';
import { answerText } from './form-state';
import type { FormDensity } from './renderers/types';

export interface ConflictNoticeProps {
  conflicts: readonly AutosaveConflict[];
  /** Used for question labels and to show both values in plain words. */
  compiled?: CompiledForm;
  onKeepMine: (conflict: AutosaveConflict) => void;
  onUseTheirs: (conflict: AutosaveConflict) => void;
  density?: FormDensity;
  className?: string;
}

function short(text: string | undefined): string {
  if (!text) return 'blank';
  return text.length > 80 ? `${text.slice(0, 77)}…` : text;
}

/**
 * "Maya changed ‘Project title’ while you were editing — keep yours / use theirs."
 * One notice per conflicting question; nothing is lost until the person chooses.
 */
export function ConflictNotice({ conflicts, compiled, onKeepMine, onUseTheirs, density = 'applicant', className }: ConflictNoticeProps) {
  if (!conflicts.length) return null;
  const size = density === 'applicant' ? 'lg' : 'sm';
  return (
    <div role="status" aria-live="polite" className={cn('grid gap-3', className)}>
      {conflicts.map((c) => {
        const meta = compiled?.fieldMeta[c.fieldId];
        const label = meta?.label ?? c.fieldId;
        const who = c.by?.trim() || 'Someone else';
        const theirs = meta ? answerText(meta, c.theirValue) : typeof c.theirValue === 'string' ? c.theirValue : undefined;
        const mine = meta ? answerText(meta, c.yourValue) : typeof c.yourValue === 'string' ? c.yourValue : undefined;
        return (
          <Alert
            key={c.fieldId}
            variant="warning"
            title={`${who} changed ‘${label}’ while you were editing`}
            actions={
              <>
                <Button type="button" size={size} onClick={() => onKeepMine(c)}>
                  Keep yours
                </Button>
                <Button type="button" size={size} variant="outline" onClick={() => onUseTheirs(c)}>
                  Use theirs
                </Button>
              </>
            }
          >
            <dl className="grid gap-0.5 sm:grid-cols-[auto_1fr] sm:gap-x-3">
              <dt className="font-medium">Yours:</dt>
              <dd className="min-w-0 break-words">{short(mine)}</dd>
              <dt className="font-medium">Theirs:</dt>
              <dd className="min-w-0 break-words">{short(theirs)}</dd>
            </dl>
          </Alert>
        );
      })}
    </div>
  );
}
