// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger, Button, Field, Input, RadioGroup, RadioOption, Switch, toast } from '@gms/ui';
import { useState, useTransition } from 'react';
import { requestDeletionAction, updateProfileAction } from './actions';

export function ProfileForm({ fullName, prefs }: { fullName: string; prefs: { email: boolean; in_app: boolean; digest: 'off' | 'daily' | 'weekly' } }) {
  const [name, setName] = useState(fullName);
  const [p, setP] = useState(prefs);
  const [pending, start] = useTransition();
  return (
    <form
      className="grid gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await updateProfileAction({ fullName: name, notificationPrefs: p });
          if (r.ok) toast.success('Saved.');
          else toast.error(r.problem.detail);
        });
      }}
    >
      <Field label="Your name" htmlFor="acct-name">
        <Input id="acct-name" inputSize="lg" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <fieldset className="grid gap-4">
        <legend className="mb-1 font-medium">Notifications</legend>
        <label className="flex min-h-11 items-center justify-between gap-4">
          <span>
            Email me about my applications and grants
            <span className="block text-sm text-muted-foreground">Receipts, status changes, messages and reminders.</span>
          </span>
          <Switch checked={p.email} onCheckedChange={(v) => setP({ ...p, email: v })} />
        </label>
        <label className="flex min-h-11 items-center justify-between gap-4">
          <span>Show notifications when I’m signed in</span>
          <Switch checked={p.in_app} onCheckedChange={(v) => setP({ ...p, in_app: v })} />
        </label>
        <fieldset className="grid gap-2">
          <legend className="text-sm font-medium">Summary email</legend>
          <RadioGroup value={p.digest} onValueChange={(v) => setP({ ...p, digest: v as typeof p.digest })} className="flex flex-wrap gap-6">
            <RadioOption value="off" id="dg-off" label="Off" />
            <RadioOption value="daily" id="dg-daily" label="Daily" />
            <RadioOption value="weekly" id="dg-weekly" label="Weekly" />
          </RadioGroup>
        </fieldset>
      </fieldset>
      <div>
        <Button type="submit" size="lg" pending={pending} pendingLabel="Saving…">
          Save changes
        </Button>
      </div>
    </form>
  );
}

export function DeleteAccount({ requested }: { requested: boolean }) {
  const [done, setDone] = useState(requested);
  const [pending, start] = useTransition();
  if (done) return <p className="text-sm">We received your request to delete your account. We’ll email you when it’s done (usually within 30 days).</p>;
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline" className="text-destructive">
          Ask us to delete my account
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete your account?</AlertDialogTitle>
          <AlertDialogDescription>
            We’ll remove your personal details. Applications you already submitted stay with the foundations you sent them to, as their records require.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={pending}
            onClick={(e) => {
              e.preventDefault();
              start(async () => {
                const r = await requestDeletionAction();
                if (r.ok) setDone(true);
                else toast.error(r.problem.detail);
              });
            }}
          >
            Send request
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
