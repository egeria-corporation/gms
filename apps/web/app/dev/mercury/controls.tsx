// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';
import { Alert, Button } from '@gms/ui';
import * as React from 'react';
import {
  approveRequestAction,
  completeInviteAction,
  emitWebhookAction,
  expireInviteAction,
  failTransactionAction,
  reconcileAction,
  rejectRequestAction,
  seedAccountsAction,
  settleTransactionAction,
  type DevResult,
} from './actions';

type Control =
  | { kind: 'seed' }
  | { kind: 'reconcile' }
  | { kind: 'completeInvite' | 'expireInvite' | 'approveRequest' | 'rejectRequest' | 'settleTransaction' | 'failTransaction'; id: string }
  | { kind: 'emitWebhook'; eventType: string; id: string };

function call(c: Control): Promise<DevResult> {
  switch (c.kind) {
    case 'seed':
      return seedAccountsAction();
    case 'reconcile':
      return reconcileAction();
    case 'completeInvite':
      return completeInviteAction(c.id);
    case 'expireInvite':
      return expireInviteAction(c.id);
    case 'approveRequest':
      return approveRequestAction(c.id);
    case 'rejectRequest':
      return rejectRequestAction(c.id);
    case 'settleTransaction':
      return settleTransactionAction(c.id);
    case 'failTransaction':
      return failTransactionAction(c.id);
    case 'emitWebhook':
      return emitWebhookAction(c.eventType, c.id);
  }
}

/** A button that runs one simulate control and announces the result. */
export function DevControl({ control, children, variant = 'outline' }: { control: Control; children: React.ReactNode; variant?: 'outline' | 'default' | 'destructive' }) {
  const [pending, start] = React.useTransition();
  const [result, setResult] = React.useState<DevResult | null>(null);
  return (
    <span className="inline-grid gap-1">
      <Button size="sm" variant={variant} pending={pending} onClick={() => start(async () => setResult(await call(control)))}>
        {children}
      </Button>
      <span role="status" aria-live="polite">
        {result ? (
          <Alert variant={result.ok ? 'success' : 'danger'} className="max-w-md p-2 text-xs">
            {result.message}
          </Alert>
        ) : null}
      </span>
    </span>
  );
}
