// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { Button, cn, ProgressRail, type RailPage, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@gms/ui';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import * as React from 'react';
import type { CompiledForm, CompiledPage } from '../compile';
import type { ResponseData } from '../util';
import type { ResponseError } from '../validate';
import { pageProgress } from './form-state';
import type { FormDensity } from './renderers/types';

export interface GmsFormPagerProps {
  pages: readonly Pick<CompiledPage, 'id' | 'title'>[];
  currentPageId: string;
  onPageChange: (pageId: string) => void;
  /** Shown instead of "Next" on the last page (e.g. "Review and submit"). */
  onFinish?: () => void;
  finishLabel?: string;
  /** Disables Back/Next while something is in progress. */
  pending?: boolean;
  density?: FormDensity;
  className?: string;
}

/** Back / Next buttons and a "Go to page" menu under a form page. */
export function GmsFormPager({ pages, currentPageId, onPageChange, onFinish, finishLabel = 'Review and submit', pending, density = 'applicant', className }: GmsFormPagerProps) {
  const index = Math.max(0, pages.findIndex((p) => p.id === currentPageId));
  const prev = pages[index - 1];
  const next = pages[index + 1];
  const size = density === 'applicant' ? 'lg' : 'default';
  const selectId = React.useId();
  return (
    <nav aria-label="Form pages" className={cn('flex flex-wrap items-center justify-between gap-3 border-t pt-4', className)}>
      <div className="flex min-w-0 items-center gap-2">
        {prev ? (
          <Button type="button" variant="outline" size={size} disabled={pending} onClick={() => onPageChange(prev.id)}>
            <ArrowLeft aria-hidden="true" />
            Back<span className="sr-only">: {prev.title}</span>
          </Button>
        ) : null}
      </div>
      {pages.length > 1 ? (
        <div className="flex items-center gap-2 text-sm">
          <label htmlFor={selectId} className="text-muted-foreground">
            Page {index + 1} of {pages.length}
            <span className="sr-only">. Go to page</span>
          </label>
          <Select value={pages[index]?.id} onValueChange={onPageChange} disabled={pending}>
            <SelectTrigger id={selectId} size={size} className="w-auto max-w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {pages.map((p, i) => (
                <SelectItem key={p.id} value={p.id} className={size === 'lg' ? 'min-h-11 text-base' : undefined}>
                  {i + 1}. {p.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}
      <div className="flex items-center gap-2">
        {next ? (
          <Button type="button" size={size} disabled={pending} onClick={() => onPageChange(next.id)}>
            Next<span className="sr-only">: {next.title}</span>
            <ArrowRight aria-hidden="true" />
          </Button>
        ) : onFinish ? (
          <Button type="button" size={size} disabled={pending} onClick={onFinish}>
            {finishLabel}
            <ArrowRight aria-hidden="true" />
          </Button>
        ) : null}
      </div>
    </nav>
  );
}

export interface FormProgressRailProps {
  compiled: CompiledForm;
  data: ResponseData;
  errors?: readonly ResponseError[];
  currentPageId: string;
  onSelect?: (pageId: string) => void;
  /** Build links instead of buttons (e.g. `?page=<id>`). */
  hrefFor?: (pageId: string) => string;
  label?: string;
  className?: string;
}

/** The form's sections with per-page completion from the answers and validation. */
export function FormProgressRail({ compiled, data, errors = [], currentPageId, onSelect, hrefFor, label = 'Form sections', className }: FormProgressRailProps) {
  const pages: RailPage[] = React.useMemo(
    () =>
      pageProgress(compiled, data, errors).map((p) => ({
        id: p.id,
        title: p.title,
        status: p.status,
        completion: p.completion,
        ...(hrefFor ? { href: hrefFor(p.id) } : {}),
      })),
    [compiled, data, errors, hrefFor],
  );
  return <ProgressRail pages={pages} currentId={currentPageId} onSelect={onSelect} label={label} className={className} />;
}
