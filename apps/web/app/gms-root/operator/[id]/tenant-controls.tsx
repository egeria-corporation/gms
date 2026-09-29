// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';
import {
  Alert,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  Field,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  toast,
} from '@gms/ui';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { saveTenantControls } from './actions';

export interface FlagRow {
  key: string;
  label: string;
  description: string;
  value: boolean;
}

const STATUSES = [
  { value: 'active', label: 'Active' },
  { value: 'suspended', label: 'Suspended — public site and console closed' },
  { value: 'archived', label: 'Archived' },
] as const;

const PLANS = [
  { value: 'self_hosted', label: 'Self-hosted' },
  { value: 'free', label: 'Free' },
  { value: 'standard', label: 'Standard' },
  { value: 'enterprise', label: 'Enterprise' },
] as const;

export function TenantControls({ workspaceId, name, flags, status, plan, readOnly }: { workspaceId: string; name: string; flags: FlagRow[]; status: string; plan: string; readOnly: boolean }) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, boolean>>(() => Object.fromEntries(flags.map((f) => [f.key, f.value])));
  const [nextStatus, setNextStatus] = useState(status);
  const [nextPlan, setNextPlan] = useState(plan);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const dirty = nextStatus !== status || nextPlan !== plan || flags.some((f) => values[f.key] !== f.value);
  const closing = nextStatus !== status && nextStatus !== 'active';

  function save() {
    setError(null);
    startTransition(async () => {
      const r = await saveTenantControls({ workspaceId, flags: values, status: nextStatus, plan: nextPlan });
      if (r.ok) {
        toast.success('Workspace settings saved');
        router.refresh();
      } else {
        setError(r.message);
        toast.error(r.message);
      }
    });
  }

  return (
    <form
      className="grid gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (closing) setConfirming(true);
        else save();
      }}
    >
      {error ? (
        <Alert variant="danger" title="Settings weren’t saved">
          {error}
        </Alert>
      ) : null}
      <fieldset className="grid gap-3" disabled={readOnly}>
        <legend className="mb-1 text-sm font-medium">Feature flags</legend>
        {flags.map((f) => (
          <div key={f.key} className="flex items-start justify-between gap-4 rounded-md border p-3">
            <div className="grid gap-0.5">
              <label htmlFor={`flag-${f.key}`} className="text-sm font-medium">
                {f.label}
              </label>
              <p id={`flag-${f.key}-description`} className="text-sm text-muted-foreground">
                {f.description} <code className="font-mono text-xs">{f.key}</code>
              </p>
            </div>
            <Switch
              id={`flag-${f.key}`}
              aria-describedby={`flag-${f.key}-description`}
              checked={values[f.key] ?? false}
              onCheckedChange={(v) => setValues((s) => ({ ...s, [f.key]: v }))}
              disabled={readOnly}
            />
          </div>
        ))}
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Workspace status" htmlFor="tenant-status">
          <Select value={nextStatus} onValueChange={setNextStatus} disabled={readOnly}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUSES.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Plan" htmlFor="tenant-plan">
          <Select value={nextPlan} onValueChange={setNextPlan} disabled={readOnly}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PLANS.map((p) => (
                <SelectItem key={p.value} value={p.value}>
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" pending={pending} pendingLabel="Saving…" disabled={readOnly || !dirty}>
          Save workspace settings
        </Button>
        {readOnly ? <p className="text-sm text-muted-foreground">Preview data — saving is turned off.</p> : dirty ? <p className="text-sm text-muted-foreground">Unsaved changes</p> : null}
      </div>
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{nextStatus === 'suspended' ? `Suspend ${name}?` : `Archive ${name}?`}</AlertDialogTitle>
            <AlertDialogDescription>
              Their public site, applicant portal and console stop working until the workspace is set back to active. No data is deleted. The change is recorded in the
              workspace’s audit log under your name.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it active</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                setConfirming(false);
                save();
              }}
            >
              {nextStatus === 'suspended' ? 'Suspend workspace' : 'Archive workspace'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </form>
  );
}
