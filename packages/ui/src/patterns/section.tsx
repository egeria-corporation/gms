// SPDX-License-Identifier: AGPL-3.0-only
import * as React from 'react';
import { cn } from '../lib/utils';

export interface SectionProps extends Omit<React.ComponentProps<'section'>, 'title'> {
  title?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  /** Heading level for the title. Default 2. */
  level?: 2 | 3 | 4;
  /** Wrap the content in a card surface. */
  card?: boolean;
}

/** A titled region of a page. The section is labelled by its heading. */
export function Section({ title, description, actions, level = 2, card = false, className, children, id, ...props }: SectionProps) {
  const auto = React.useId();
  const headingId = `${id ?? auto}-heading`;
  const Heading = `h${level}` as const;
  return (
    <section
      data-slot="section"
      id={id}
      aria-labelledby={title ? headingId : undefined}
      className={cn('grid gap-3', className)}
      {...props}
    >
      {title || actions ? (
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div className="grid gap-0.5">
            {title ? (
              <Heading id={headingId} className={cn('font-heading font-semibold', level === 2 ? 'text-lg' : 'text-base')}>
                {title}
              </Heading>
            ) : null}
            {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
          </div>
          {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      {card ? <div className="rounded-lg border bg-card p-5 text-card-foreground shadow-soft">{children}</div> : children}
    </section>
  );
}
