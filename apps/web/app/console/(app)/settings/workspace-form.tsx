// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { formatMoney, parseMoneyToCents } from '@gms/domain';
import { Alert, Badge, Button, Field, Input, Section, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Switch, Textarea, toast } from '@gms/ui';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { useUnsavedChangesWarning } from '@/components/console/admin/unsaved';
import { updateWorkspaceAction, type WorkspaceSettingsInput } from './actions';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

type Errors = Partial<Record<keyof WorkspaceSettingsInput, string>>;

export function WorkspaceForm({ initial, zones, readOnly }: { initial: WorkspaceSettingsInput; zones: string[]; readOnly: boolean }) {
  const router = useRouter();
  const [saved, setSaved] = useState(initial);
  const [v, setV] = useState(initial);
  const [threshold, setThreshold] = useState((initial.secondApprovalThresholdCents / 100).toFixed(2));
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const thresholdCents = parseMoneyToCents(threshold);
  const current = { ...v, secondApprovalThresholdCents: thresholdCents ?? -1 };
  const dirty = JSON.stringify(current) !== JSON.stringify(saved);
  useUnsavedChangesWarning(dirty && !readOnly);
  const set = <K extends keyof WorkspaceSettingsInput>(k: K, val: WorkspaceSettingsInput[K]) => {
    setV((x) => ({ ...x, [k]: val }));
    setErrors((e) => ({ ...e, [k]: undefined }));
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Errors = {};
    if (!v.name.trim()) errs.name = 'Enter your foundation’s name.';
    if (v.publicContactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.publicContactEmail)) errs.publicContactEmail = 'Enter an email address, like grants@example.org.';
    if (thresholdCents === null || thresholdCents < 0) errs.secondApprovalThresholdCents = 'Enter an amount in dollars, like 50,000.';
    setErrors(errs);
    if (Object.keys(errs).length) {
      setFormError('Fix the highlighted fields, then save again.');
      return;
    }
    setFormError(null);
    const input: WorkspaceSettingsInput = { ...v, name: v.name.trim(), publicContactEmail: v.publicContactEmail?.trim() || null, aboutMd: v.aboutMd?.trim() || null, secondApprovalThresholdCents: thresholdCents! };
    start(async () => {
      const r = await updateWorkspaceAction(input);
      if (r.ok) {
        setSaved(input);
        setV(input);
        toast.success('Workspace settings saved.');
        router.refresh();
      } else {
        const fe: Errors = {};
        for (const i of r.problem.errors ?? []) fe[i.pointer.replace(/^\//, '') as keyof WorkspaceSettingsInput] = i.message;
        setErrors(fe);
        setFormError(r.problem.detail);
      }
    });
  };

  return (
    <form onSubmit={submit} noValidate className="grid gap-8">
      {readOnly ? <Alert variant="info" title="View only">Only owners and admins can change workspace settings.</Alert> : null}
      {formError ? (
        <Alert variant="danger" title="Not saved" role="alert">
          {formError}
        </Alert>
      ) : null}
      <Section title="About your foundation">
        <div className="grid gap-4 lg:grid-cols-2">
          <Field label="Workspace name" htmlFor="ws-name" error={errors.name} required description="Your legal or formal name. The public display name is set in Branding.">
            <Input id="ws-name" value={v.name} disabled={readOnly} maxLength={200} onChange={(e) => set('name', e.target.value)} />
          </Field>
          <Field label="Timezone" htmlFor="ws-tz" error={errors.timezone} description="Deadlines, reminders and reports use this timezone.">
            <Select value={v.timezone} onValueChange={(z) => set('timezone', z)} disabled={readOnly}>
              <SelectTrigger id="ws-tz">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {zones.map((z) => (
                  <SelectItem key={z} value={z}>
                    {z.replace(/_/g, ' ')}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Public contact email" htmlFor="ws-contact" error={errors.publicContactEmail} description="Shown on your public site for applicant questions.">
            <Input id="ws-contact" type="email" value={v.publicContactEmail ?? ''} disabled={readOnly} onChange={(e) => set('publicContactEmail', e.target.value)} />
          </Field>
          <Field label="Fiscal year starts in" htmlFor="ws-fy" description="Used for budgets, dashboards and reports. Fiscal years are named by the year they end.">
            <Select value={String(v.fiscalYearStartMonth)} onValueChange={(m) => set('fiscalYearStartMonth', Number(m))} disabled={readOnly}>
              <SelectTrigger id="ws-fy">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MONTHS.map((m, i) => (
                  <SelectItem key={m} value={String(i + 1)}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="About (shown on your public home page)" htmlFor="ws-about" className="lg:col-span-2" description="A few sentences about who you fund and why. Basic formatting: **bold**, _italic_, links and lists.">
            <Textarea id="ws-about" rows={5} value={v.aboutMd ?? ''} disabled={readOnly} maxLength={10000} onChange={(e) => set('aboutMd', e.target.value)} />
          </Field>
        </div>
      </Section>

      <Section title="Safeguards" description="Rules GMS enforces for everyone in this workspace, including agents.">
        <div className="grid gap-3">
          <ToggleRow
            label="Require virus scanning for uploads"
            description="Applicants can’t submit until every file is scanned clean. Needs a scanner on this deployment; without one, uploads show “not scanned”."
            checked={v.scanRequired}
            disabled={readOnly}
            onChange={(c) => set('scanRequired', c)}
          />
          <ToggleRow
            label="Hold payments when a report is overdue"
            description="Payments to a grantee with an overdue report are held until the report is accepted (you can release a hold by hand)."
            checked={v.overdueReportHold}
            disabled={readOnly}
            onChange={(c) => set('overdueReportHold', c)}
          />
          <ToggleRow
            label="Publish awarded grants"
            description="Show a public “Grants awarded” page (recipient, amount, purpose). Grants to individuals are never listed."
            checked={v.transparencyEnabled}
            disabled={readOnly}
            onChange={(c) => set('transparencyEnabled', c)}
          />
          <Field
            label="Second approval for payment batches over"
            htmlFor="ws-threshold"
            error={errors.secondApprovalThresholdCents}
            description={thresholdCents !== null ? `Batches above ${formatMoney(thresholdCents)} need a second finance approver (never the person who created the batch).` : 'Amount in US dollars.'}
            className="max-w-sm"
          >
            <div className="flex items-center gap-2">
              <span aria-hidden="true" className="text-muted-foreground">
                $
              </span>
              <Input id="ws-threshold" inputMode="decimal" value={threshold} disabled={readOnly} onChange={(e) => setThreshold(e.target.value)} />
            </div>
          </Field>
        </div>
      </Section>

      {readOnly ? null : (
        <div className="sticky bottom-0 z-10 flex flex-wrap items-center gap-3 border-t bg-background/95 py-3 backdrop-blur">
          <span role="status" className="text-sm text-muted-foreground">
            {dirty ? <Badge variant="warning">Unsaved changes</Badge> : 'All changes saved'}
          </span>
          <Button type="submit" className="ml-auto" pending={pending} pendingLabel="Saving…" disabled={!dirty}>
            Save workspace settings
          </Button>
        </div>
      )}
    </form>
  );
}

function ToggleRow({ label, description, checked, disabled, onChange }: { label: string; description: string; checked: boolean; disabled: boolean; onChange: (c: boolean) => void }) {
  return (
    <label className="flex items-start justify-between gap-4 rounded-lg border bg-card p-3">
      <span>
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-sm text-muted-foreground">{description}</span>
      </span>
      <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} className="mt-0.5" />
    </label>
  );
}
