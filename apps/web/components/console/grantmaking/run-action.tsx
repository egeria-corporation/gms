// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';
// Client helpers for calling 'use server' actions from the grantmaking screens: pending state,
// success/error toasts, and a refresh of the server-rendered page.
import type { ProblemDetails } from '@gms/domain';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
  Button,
  type ButtonProps,
  toast,
} from '@gms/ui';
import { useRouter } from 'next/navigation';
import { useCallback, useState, useTransition, type ReactNode } from 'react';

export type Result<T = unknown> = { ok: true; data: T } | { ok: false; problem: ProblemDetails };

/** A readable message for a failed action, including the first field problem when there is one. */
export function problemMessage(p: ProblemDetails): string {
  const extra = p.errors?.[0]?.message;
  return extra && extra !== p.detail ? `${p.detail} ${extra}` : p.detail;
}

export function useRunAction() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = useCallback(
    <T,>(fn: () => Promise<Result<T>>, opts: { success?: string | ((data: T) => string); onDone?: (data: T) => void; refresh?: boolean } = {}) =>
      new Promise<Result<T>>((resolve) => {
        start(async () => {
          const r = await fn();
          if (r.ok) {
            const msg = typeof opts.success === 'function' ? opts.success(r.data) : opts.success;
            if (msg) toast.success(msg);
            opts.onDone?.(r.data);
            if (opts.refresh !== false) router.refresh();
          } else {
            toast.error(problemMessage(r.problem));
          }
          resolve(r);
        });
      }),
    [router],
  );
  return { run, pending };
}

/** A button that asks for confirmation, then runs a server action. */
export function ConfirmActionButton<T>({
  label,
  title,
  description,
  confirmLabel,
  action,
  success,
  variant = 'outline',
  size = 'sm',
  destructive = false,
  disabled,
  icon,
  children,
  onDone,
}: {
  label: ReactNode;
  title: string;
  description?: ReactNode;
  confirmLabel: string;
  action: () => Promise<Result<T>>;
  success?: string;
  variant?: ButtonProps['variant'];
  size?: ButtonProps['size'];
  destructive?: boolean;
  disabled?: boolean;
  icon?: ReactNode;
  /** Extra content inside the dialog (e.g. a reason field). */
  children?: ReactNode;
  onDone?: (data: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const { run, pending } = useRunAction();
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button variant={variant} size={size} disabled={disabled}>
          {icon}
          {label}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description ? <AlertDialogDescription>{description}</AlertDialogDescription> : null}
        </AlertDialogHeader>
        {children}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant={destructive ? 'destructive' : 'default'}
            disabled={pending}
            onClick={(e) => {
              e.preventDefault();
              void run(action, { success, onDone }).then((r) => {
                if (r.ok) setOpen(false);
              });
            }}
          >
            {pending ? 'Working…' : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
