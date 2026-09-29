// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger, Button, Field, Textarea, toast } from '@gms/ui';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { withdrawApplication } from '../actions';

export function WithdrawButton({ applicationId }: { applicationId: string }) {
  const router = useRouter();
  const [reason, setReason] = useState('');
  const [pending, start] = useTransition();
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" className="justify-self-start text-destructive">
          Withdraw this application
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Withdraw this application?</AlertDialogTitle>
          <AlertDialogDescription>The foundation will stop considering it. You can’t undo this, but you can apply again in a future round.</AlertDialogDescription>
        </AlertDialogHeader>
        <Field label="Reason" htmlFor="wd-reason" optional>
          <Textarea id="wd-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep it</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={pending}
            onClick={(e) => {
              e.preventDefault();
              start(async () => {
                const r = await withdrawApplication(applicationId, reason);
                if (r.ok) {
                  toast.success('Your application was withdrawn.');
                  router.refresh();
                } else toast.error(r.problem.detail);
              });
            }}
          >
            Withdraw
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
