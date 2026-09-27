// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { Button } from '@gms/ui';
import { RefreshCw } from 'lucide-react';
import { syncBankAction } from '@/app/console/(app)/payments/actions';
import { FeedbackRegion, useRunner } from './client-utils';

export function SyncBalancesButton() {
  const { run, pending, feedback } = useRunner();
  return (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        pending={pending}
        pendingLabel="Refreshing…"
        onClick={() => run(() => syncBankAction(), (d) => ({ variant: 'success', title: `Balances refreshed for ${d.accounts} account${d.accounts === 1 ? '' : 's'}.` }))}
      >
        <RefreshCw aria-hidden="true" /> Refresh balances
      </Button>
      <FeedbackRegion feedback={feedback && feedback.variant !== 'success' ? feedback : null} className="max-w-sm" />
      <span className="sr-only" aria-live="polite">
        {feedback?.variant === 'success' ? feedback.title : ''}
      </span>
    </div>
  );
}
