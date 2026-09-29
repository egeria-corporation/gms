// SPDX-License-Identifier: AGPL-3.0-or-later
import { Code } from 'lucide-react';
import * as React from 'react';
import { cn } from '../lib/utils';

export interface PoweredByFooterProps {
  /** URL of the exact source for the running version, e.g. https://github.com/org/gms/tree/<sha>. */
  sourceUrl: string;
  /** Running version or git SHA, e.g. "0.1.0 (a1b2c3d)". */
  version: string;
  className?: string;
}

/**
 * "Powered by GMS · Source code". Required by the AGPL on every branded surface; it cannot be
 * hidden: it takes no hide/visibility props and ignores className rules that would hide it.
 */
export function PoweredByFooter({ sourceUrl, version, className }: PoweredByFooterProps) {
  return (
    <p
      data-slot="powered-by"
      className={cn(
        'flex! flex-wrap items-center justify-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground opacity-100! visible!',
        className?.replace(/\b(hidden|invisible|sr-only|opacity-0)\b/g, ''),
      )}
    >
      <span>Powered by GMS</span>
      <span aria-hidden="true">·</span>
      <a
        href={sourceUrl}
        rel="noopener"
        className="inline-flex items-center gap-1 rounded-sm underline underline-offset-2 hover:text-foreground"
        title={`Source code for version ${version}`}
      >
        <Code className="size-3" aria-hidden="true" />
        Source code
        <span className="sr-only"> for version {version}</span>
      </a>
      <span className="tabular-nums">({version})</span>
    </p>
  );
}
