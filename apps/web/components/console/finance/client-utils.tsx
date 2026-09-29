// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';
// Client helpers shared by the finance screens: URL-driven filters and pagination (server-side paging, never
// infinite scroll), a polite live region for action results, and a runner for server actions that handles
// authenticator step-up for people-only actions.
import type { ProblemDetails } from '@gms/domain';
import { Alert, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, type PaginationState } from '@gms/ui';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import * as React from 'react';
import { useStepUp } from '@/components/console/step-up';

export type Result<T> = { ok: true; data: T } | { ok: false; problem: ProblemDetails };

export function useUrlParams() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, start] = React.useTransition();
  const set = React.useCallback(
    (patch: Record<string, string | null | undefined>) => {
      const next = new URLSearchParams(sp.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === undefined || v === '' || v === 'all') next.delete(k);
        else next.set(k, v);
      }
      // Changing a filter returns to the first page.
      if (!('page' in patch)) next.delete('page');
      const qs = next.toString();
      start(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
    },
    [router, pathname, sp],
  );
  return { sp, set, pending };
}

/** Controlled DataTable pagination backed by `?page=` and `?size=`. */
export function useUrlPagination(page: number, pageSize: number) {
  const { set, pending } = useUrlParams();
  const pagination: PaginationState = { pageIndex: page - 1, pageSize };
  const onPaginationChange = (next: PaginationState) =>
    set({ page: next.pageIndex > 0 ? String(next.pageIndex + 1) : null, size: next.pageSize !== 25 ? String(next.pageSize) : null });
  return { pagination, onPaginationChange, loading: pending };
}

export interface FilterOption {
  value: string;
  label: string;
}

/** A labelled filter select that writes `?{param}=`. "all" clears it. */
export function UrlFilterSelect({
  param,
  label,
  options,
  value,
  allLabel = 'All',
  includeAll = true,
}: {
  param: string;
  label: string;
  options: FilterOption[];
  value: string | undefined;
  allLabel?: string;
  /** Show an "All" choice that clears the filter. */
  includeAll?: boolean;
}) {
  const { set } = useUrlParams();
  const id = React.useId();
  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="text-sm whitespace-nowrap text-muted-foreground">
        {label}
      </label>
      <Select value={value ?? 'all'} onValueChange={(v) => set({ [param]: v })}>
        <SelectTrigger id={id} size="sm" className="w-auto min-w-36">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {includeAll ? <SelectItem value="all">{allLabel}</SelectItem> : null}
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export type Feedback = { variant: 'success' | 'danger' | 'info' | 'warning'; title: string; detail?: React.ReactNode } | null;

export function problemFeedback(p: ProblemDetails): Feedback {
  if (p.code === 'step_up_required') return { variant: 'info', title: 'Not done', detail: p.detail };
  const issues = p.errors?.map((e) => e.message).filter(Boolean) ?? [];
  return {
    variant: p.code === 'forbidden' || p.code === 'human_only' ? 'warning' : 'danger',
    title: p.code === 'validation_failed' ? 'Check the details' : 'That didn’t go through',
    detail: issues.length ? `${p.detail} ${issues.join(' ')}` : p.detail,
  };
}

/** Always-present live region so results are announced (WCAG 4.1.3). */
export function FeedbackRegion({ feedback, className }: { feedback: Feedback; className?: string }) {
  return (
    <div role="status" aria-live="polite" className={className}>
      {feedback ? (
        <Alert variant={feedback.variant} title={feedback.title}>
          {feedback.detail}
        </Alert>
      ) : null}
    </div>
  );
}

/**
 * Runs a server action in a transition, optionally behind authenticator step-up, and turns the result into
 * feedback. Render `dialog` once in the component.
 */
export function useRunner(stepUp?: { reason?: string; actionLabel?: string }) {
  const [pending, start] = React.useTransition();
  const [feedback, setFeedback] = React.useState<Feedback>(null);
  const { withStepUp, dialog } = useStepUp(stepUp ?? {});
  const run = React.useCallback(
    <T,>(fn: () => Promise<Result<T>>, onOk?: (data: T) => Feedback | void, opts: { stepUp?: boolean } = {}) =>
      new Promise<boolean>((resolve) => {
        start(async () => {
          const r = await (opts.stepUp ? withStepUp(fn) : fn());
          if (r.ok) {
            setFeedback(onOk?.(r.data) ?? null);
            resolve(true);
          } else {
            setFeedback(problemFeedback(r.problem));
            resolve(false);
          }
        });
      }),
    [withStepUp],
  );
  return { run, pending, feedback, setFeedback, dialog };
}
