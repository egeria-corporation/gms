// SPDX-License-Identifier: AGPL-3.0-only
'use client';
// Wraps a people-only action: when the server answers `step_up_required`, ask for a fresh authenticator
// code, then retry the action once.
import type { ProblemDetails } from '@gms/domain';
import { StepUpDialog } from '@gms/ui';
import { useCallback, useRef, useState } from 'react';
import { verifyTotpAction } from '@/app/console/(auth)/mfa/actions';

type Result<T> = { ok: true; data: T } | { ok: false; problem: ProblemDetails };

export function useStepUp(opts: { reason?: string; actionLabel?: string } = {}) {
  const [open, setOpen] = useState(false);
  const pending = useRef<null | { run: () => Promise<unknown>; resolve: (v: unknown) => void }>(null);

  const withStepUp = useCallback(<T,>(run: () => Promise<Result<T>>): Promise<Result<T>> => {
    return run().then((r) => {
      if (r.ok || r.problem.code !== 'step_up_required') return r;
      return new Promise<Result<T>>((resolve) => {
        pending.current = { run, resolve: resolve as (v: unknown) => void };
        setOpen(true);
      });
    });
  }, []);

  const dialog = (
    <StepUpDialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o && pending.current) {
          pending.current.resolve({ ok: false, problem: { type: 'about:blank', title: 'Cancelled', status: 400, detail: 'You cancelled the authenticator check.', code: 'step_up_required' } });
          pending.current = null;
        }
      }}
      reason={opts.reason ?? 'This is a people-only action, so we check your authenticator app first.'}
      actionLabel={opts.actionLabel}
      onVerify={async (code) => (await verifyTotpAction(null, code)).ok}
      onVerified={async () => {
        const p = pending.current;
        pending.current = null;
        if (p) p.resolve(await p.run());
      }}
    />
  );
  return { withStepUp, dialog };
}
