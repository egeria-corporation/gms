// SPDX-License-Identifier: AGPL-3.0-or-later
import { formatMoney, formatMoneyShort } from '@gms/domain';
import * as React from 'react';
import { cn } from '../lib/utils';

export interface MoneyDisplayProps extends Omit<React.ComponentProps<'span'>, 'children'> {
  /** Integer cents. null/undefined renders an em dash. */
  cents: number | null | undefined;
  /** ISO 4217 code. Default USD. */
  currency?: string;
  /** Append the ISO code: "$12,500.00 USD". Use when more than one currency can appear. */
  showCurrencyCode?: boolean;
  /** Drop ".00" on whole amounts. */
  compact?: boolean;
  /** Dashboard style "$1.2M" (full amount in the title and for screen readers). */
  short?: boolean;
  /** Color negatives red and positives green. Off by default: money is not good or bad. */
  signColors?: boolean;
  /** Show "+" on positive amounts (useful for adjustments). */
  showPlus?: boolean;
}

/** Unambiguous money: tabular numerals, currency symbol, optional ISO code. */
export function MoneyDisplay({
  cents,
  currency = 'USD',
  showCurrencyCode = false,
  compact = false,
  short = false,
  signColors = false,
  showPlus = false,
  className,
  ...props
}: MoneyDisplayProps) {
  if (cents === null || cents === undefined) {
    return (
      <span className={cn('tabular-nums text-muted-foreground', className)} {...props}>
        <span aria-hidden="true">—</span>
        <span className="sr-only">No amount</span>
      </span>
    );
  }
  const code = currency.toUpperCase();
  const full = formatMoney(cents, code);
  const shown = short ? formatMoneyShort(cents, code) : formatMoney(cents, code, { compact });
  const plus = showPlus && cents > 0 ? '+' : '';
  return (
    <span
      data-slot="money"
      data-numeric=""
      title={short ? `${full} ${code}` : undefined}
      className={cn(
        'whitespace-nowrap tabular-nums',
        signColors && cents < 0 && 'text-status-danger-fg',
        signColors && cents > 0 && 'text-status-success-fg',
        className,
      )}
      {...props}
    >
      {short ? (
        <>
          <span aria-hidden="true">{plus + shown}</span>
          <span className="sr-only">{plus + full}</span>
        </>
      ) : (
        plus + shown
      )}
      {showCurrencyCode ? <span className="ml-1 text-[0.85em] font-normal text-muted-foreground">{code}</span> : null}
    </span>
  );
}
