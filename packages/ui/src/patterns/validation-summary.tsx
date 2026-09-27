// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { CircleAlert } from 'lucide-react';
import * as React from 'react';
import { cn } from '../lib/utils';

export interface ValidationError {
  /** id of the control (or fieldset) to jump to. */
  fieldId: string;
  message: React.ReactNode;
}

export interface ValidationSummaryProps extends Omit<React.ComponentProps<'div'>, 'title'> {
  errors: ValidationError[];
  title?: React.ReactNode;
  /** Move focus to the summary when errors appear (default true). */
  autoFocus?: boolean;
}

/** Moves focus to a field by id and scrolls it into view; used by summary links. */
export function focusField(fieldId: string): boolean {
  const el = document.getElementById(fieldId);
  if (!el) return false;
  const target: HTMLElement =
    el.matches('input, select, textarea, button, [tabindex]') ? el : (el.querySelector<HTMLElement>('input, select, textarea, button, [tabindex]') ?? el);
  target.scrollIntoView({ block: 'center', behavior: 'smooth' });
  target.focus({ preventScroll: true });
  return true;
}

/**
 * Error summary at the top of a form: role="alert", focusable heading, and a link to each field
 * (#field-id). Pair with inline errors on each Field.
 */
export function ValidationSummary({ errors, title, autoFocus = true, className, ...props }: ValidationSummaryProps) {
  const headingRef = React.useRef<HTMLHeadingElement>(null);
  const key = errors.map((e) => e.fieldId).join('|');
  React.useEffect(() => {
    if (autoFocus && key) headingRef.current?.focus();
  }, [autoFocus, key]);
  if (errors.length === 0) return null;
  const heading =
    title ?? (errors.length === 1 ? 'There is 1 problem to fix' : `There are ${errors.length} problems to fix`);
  return (
    <div
      data-slot="validation-summary"
      role="alert"
      className={cn('rounded-lg border-2 border-status-danger-border bg-status-danger-bg p-4 text-sm', className)}
      {...props}
    >
      <h2 ref={headingRef} tabIndex={-1} className="flex items-center gap-2 text-base font-semibold text-status-danger-fg outline-offset-4">
        <CircleAlert className="size-5 shrink-0" aria-hidden="true" />
        {heading}
      </h2>
      <ul className="mt-2 grid gap-1 pl-7">
        {errors.map((e) => (
          <li key={e.fieldId}>
            <a
              href={`#${e.fieldId}`}
              className="font-medium text-status-danger-fg underline underline-offset-2 hover:decoration-2"
              onClick={(ev) => {
                if (focusField(e.fieldId)) ev.preventDefault();
              }}
            >
              {e.message}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
