// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { KeyRound } from 'lucide-react';
import * as React from 'react';
import { Button } from '../components/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../components/dialog';
import { Field } from '../components/field';
import { Input } from '../components/input';

export interface StepUpDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Check the 6-digit code. Resolve true when valid. */
  onVerify: (code: string) => Promise<boolean>;
  /** Called after a successful verification (the dialog closes itself). */
  onVerified?: () => void;
  /** Why we're asking, e.g. "Approving a payment batch needs a fresh check." */
  reason?: React.ReactNode;
  /** The action being unlocked, e.g. "Approve batch". Used on the button. */
  actionLabel?: string;
  title?: string;
}

/**
 * Re-authentication before a sensitive action: a 6-digit code from the person's authenticator app.
 * Supports one-time-code autofill and paste; explains why it's needed; errors are announced.
 */
export function StepUpDialog({
  open,
  onOpenChange,
  onVerify,
  onVerified,
  reason = 'This action is sensitive, so we need to check it’s really you.',
  actionLabel = 'Verify',
  title = 'Confirm it’s you',
}: StepUpDialogProps) {
  const [code, setCode] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (!open) {
      setCode('');
      setError(null);
      setPending(false);
    }
  }, [open]);

  const submit = async (value: string) => {
    if (pending) return;
    if (!/^\d{6}$/.test(value)) {
      setError('Enter the 6-digit code from your authenticator app.');
      inputRef.current?.focus();
      return;
    }
    setPending(true);
    setError(null);
    try {
      const ok = await onVerify(value);
      if (ok) {
        // Hand over before closing: callers treat a close while an action is waiting as “cancelled”.
        onVerified?.();
        onOpenChange(false);
        return;
      }
      setError('That code didn’t work. Codes change every 30 seconds, so check your app and try the newest one.');
    } catch {
      setError('We couldn’t check the code just now. Try again.');
    } finally {
      setPending(false);
    }
    setCode('');
    inputRef.current?.focus();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !pending && onOpenChange(o)}>
      <DialogContent size="sm" onOpenAutoFocus={(e) => {
        e.preventDefault();
        inputRef.current?.focus();
      }}>
        <form
          className="grid gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            void submit(code);
          }}
          noValidate
        >
          <DialogHeader>
            <span aria-hidden="true" className="mb-1 grid size-10 place-items-center rounded-full bg-muted text-muted-foreground">
              <KeyRound className="size-5" />
            </span>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{reason}</DialogDescription>
          </DialogHeader>
          <Field label="6-digit code" description="Open your authenticator app and enter the current code." error={error ?? undefined}>
            <Input
              ref={inputRef}
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={6}
              inputSize="lg"
              className="max-w-44 text-center font-mono text-lg tracking-[0.4em]"
              value={code}
              disabled={pending}
              onChange={(e) => {
                const digits = e.currentTarget.value.replace(/\D/g, '').slice(0, 6);
                setCode(digits);
                if (error) setError(null);
                if (digits.length === 6) void submit(digits);
              }}
            />
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" pending={pending} pendingLabel="Checking…">
              {actionLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
