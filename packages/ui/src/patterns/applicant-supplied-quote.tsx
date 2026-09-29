// SPDX-License-Identifier: AGPL-3.0-or-later
import { Quote } from 'lucide-react';
import * as React from 'react';
import { cn } from '../lib/utils';

export interface ApplicantSuppliedQuoteProps extends React.ComponentProps<'figure'> {
  /** Who supplied it, e.g. "Riverbend Food Pantry". */
  source?: React.ReactNode;
  /** Field the text came from, e.g. "Project summary". */
  fieldLabel?: React.ReactNode;
  /** Clamp long quotes to N lines (full text remains in the DOM). */
  maxLines?: number;
}

/**
 * Text written by an applicant, shown in AI or review contexts. Always quoted and labeled
 * "Applicant-supplied" so nobody mistakes it for instructions or for GMS's own words.
 * Render the text as plain text children; never as HTML.
 */
export function ApplicantSuppliedQuote({ source, fieldLabel, maxLines, className, children, ...props }: ApplicantSuppliedQuoteProps) {
  return (
    <figure data-slot="applicant-supplied" className={cn('rounded-md border border-dashed bg-muted/50 p-3', className)} {...props}>
      <figcaption className="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1 font-semibold tracking-wide uppercase">
          <Quote className="size-3" aria-hidden="true" />
          Applicant-supplied
        </span>
        {fieldLabel ? <span>· {fieldLabel}</span> : null}
        {source ? <span>· {source}</span> : null}
      </figcaption>
      <blockquote
        className={cn('border-l-2 border-border pl-3 text-sm whitespace-pre-wrap text-foreground', maxLines ? 'overflow-hidden' : undefined)}
        style={maxLines ? { display: '-webkit-box', WebkitLineClamp: maxLines, WebkitBoxOrient: 'vertical' } : undefined}
      >
        {children}
      </blockquote>
    </figure>
  );
}
