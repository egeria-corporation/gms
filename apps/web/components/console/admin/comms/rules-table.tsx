// SPDX-License-Identifier: AGPL-3.0-only
'use client';
// CM-03 rules table with inline enable/disable and an add/edit dialog (comms.save_rule).
import {
  Alert,
  Button,
  Card,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Field,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from '@gms/ui';
import { Pencil, Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { saveRuleAction } from '@/app/console/(app)/comms/actions';
import { AUDIENCES, audienceLabel, CHANNELS, channelLabel, eventLabel, EVENT_TYPES, offsetLabel, type Audience, type Channel } from './meta';

export interface RuleRow {
  id: string;
  eventType: string;
  channel: string;
  audience: string;
  templateKey: string | null;
  offsetDays: number | null;
  enabled: boolean;
}

interface Draft {
  ruleId?: string;
  eventType: string;
  channel: Channel;
  audience: Audience;
  templateKey: string | null;
  offset: string;
  enabled: boolean;
}

const NO_TEMPLATE = '__default__';
const BLANK: Draft = { eventType: 'application.submitted', channel: 'email', audience: 'applicant', templateKey: null, offset: '', enabled: true };

function toDraft(r: RuleRow): Draft {
  return {
    ruleId: r.id,
    eventType: r.eventType,
    channel: (CHANNELS.some((c) => c.value === r.channel) ? r.channel : 'email') as Channel,
    audience: (AUDIENCES.some((a) => a.value === r.audience) ? r.audience : 'applicant') as Audience,
    templateKey: r.templateKey,
    offset: r.offsetDays === null ? '' : String(r.offsetDays),
    enabled: r.enabled,
  };
}

function toInput(d: Draft) {
  return {
    ruleId: d.ruleId,
    eventType: d.eventType,
    channel: d.channel,
    audience: d.audience,
    templateKey: d.channel === 'email' ? d.templateKey : null,
    offsetDays: d.offset.trim() === '' ? null : Number(d.offset),
    enabled: d.enabled,
  };
}

export function RulesTable({ rules, templates, canEdit }: { rules: RuleRow[]; templates: { key: string; name: string }[]; canEdit: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState<Draft | null>(null);
  const [offsetError, setOffsetError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, startSave] = useTransition();
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [optimistic, setOptimistic] = useState<Record<string, boolean>>({});
  const templateName = (key: string | null) => (key ? (templates.find((t) => t.key === key)?.name ?? key) : 'Built-in email');

  const toggle = (r: RuleRow, enabled: boolean) => {
    setTogglingId(r.id);
    setOptimistic((o) => ({ ...o, [r.id]: enabled }));
    void saveRuleAction(toInput({ ...toDraft(r), enabled })).then((res) => {
      setTogglingId(null);
      if (res.ok) {
        toast.success(`${eventLabel(r.eventType)} → ${audienceLabel(r.audience)}: ${enabled ? 'on' : 'off'}.`);
        router.refresh();
      } else {
        setOptimistic((o) => {
          const next = { ...o };
          delete next[r.id];
          return next;
        });
        toast.error(res.problem.detail);
      }
    });
  };

  const open = (d: Draft) => {
    setOffsetError(null);
    setFormError(null);
    setEditing(d);
  };

  const save = () => {
    if (!editing) return;
    const off = editing.offset.trim();
    if (off !== '' && (!/^-?\d+$/.test(off) || Number(off) < -60 || Number(off) > 60)) {
      setOffsetError('Enter a whole number of days between −60 and 60, or leave it empty.');
      return;
    }
    setOffsetError(null);
    startSave(async () => {
      const r = await saveRuleAction(toInput(editing));
      if (!r.ok) {
        setFormError(r.problem.detail);
        return;
      }
      toast.success(editing.ruleId ? 'Rule saved.' : 'Rule added.');
      setEditing(null);
      router.refresh();
    });
  };

  const addButton = canEdit ? (
    <Button onClick={() => open(BLANK)}>
      <Plus aria-hidden="true" />
      Add rule
    </Button>
  ) : null;

  const hint = editing ? EVENT_TYPES.find((e) => e.value === editing.eventType)?.hint : undefined;

  return (
    <div className="grid gap-4">
      {canEdit && rules.length ? <div className="flex justify-end">{addButton}</div> : null}
      <Card>
        {rules.length ? (
          <Table containerLabel="Notification rules">
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Who</TableHead>
                <TableHead>How</TableHead>
                <TableHead>Timing</TableHead>
                <TableHead>Template</TableHead>
                <TableHead>On</TableHead>
                {canEdit ? (
                  <TableHead>
                    <span className="sr-only">Actions</span>
                  </TableHead>
                ) : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rules.map((r) => {
                const enabled = optimistic[r.id] ?? r.enabled;
                const name = `${eventLabel(r.eventType)} to ${audienceLabel(r.audience)} by ${channelLabel(r.channel)}`;
                return (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">
                      {eventLabel(r.eventType)}
                      <code className="block font-mono text-[11px] font-normal text-muted-foreground">{r.eventType}</code>
                    </TableCell>
                    <TableCell>{audienceLabel(r.audience)}</TableCell>
                    <TableCell>{channelLabel(r.channel)}</TableCell>
                    <TableCell className="whitespace-nowrap">{offsetLabel(r.offsetDays)}</TableCell>
                    <TableCell className="text-muted-foreground">{r.channel === 'email' ? templateName(r.templateKey) : '—'}</TableCell>
                    <TableCell>
                      <span className="flex items-center gap-2">
                        <Switch checked={enabled} disabled={!canEdit || togglingId === r.id} onCheckedChange={(v) => toggle(r, v)} aria-label={`${name}: ${enabled ? 'on' : 'off'}`} />
                        <span className="text-xs text-muted-foreground" aria-hidden="true">
                          {enabled ? 'On' : 'Off'}
                        </span>
                      </span>
                    </TableCell>
                    {canEdit ? (
                      <TableCell className="text-right">
                        <Button variant="ghost" size="sm" onClick={() => open(toDraft(r))}>
                          <Pencil aria-hidden="true" />
                          Edit<span className="sr-only"> {name}</span>
                        </Button>
                      </TableCell>
                    ) : null}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        ) : (
          <EmptyState
            title="No notification rules yet"
            description={canEdit ? 'Add a rule to email people automatically, for example a reminder 14 days before a report is due.' : 'An owner or admin can add rules to send notifications automatically.'}
            action={addButton}
          />
        )}
      </Card>

      <Dialog open={editing !== null} onOpenChange={(o) => (o ? null : setEditing(null))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing?.ruleId ? 'Edit rule' : 'Add a rule'}</DialogTitle>
            <DialogDescription>GMS sends this automatically whenever the event happens.</DialogDescription>
          </DialogHeader>
          {editing ? (
            <form
              className="grid gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                save();
              }}
            >
              {formError ? (
                <Alert variant="danger" role="alert">
                  {formError}
                </Alert>
              ) : null}
              <Field label="When this happens" htmlFor="rule-event" description={hint}>
                <Select value={editing.eventType} onValueChange={(v) => setEditing({ ...editing, eventType: v })}>
                  <SelectTrigger id="rule-event">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {EVENT_TYPES.map((e) => (
                      <SelectItem key={e.value} value={e.value}>
                        {e.label}
                      </SelectItem>
                    ))}
                    {EVENT_TYPES.some((e) => e.value === editing.eventType) ? null : <SelectItem value={editing.eventType}>{editing.eventType}</SelectItem>}
                  </SelectContent>
                </Select>
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Notify" htmlFor="rule-audience">
                  <Select value={editing.audience} onValueChange={(v) => setEditing({ ...editing, audience: v as Audience })}>
                    <SelectTrigger id="rule-audience">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {AUDIENCES.map((a) => (
                        <SelectItem key={a.value} value={a.value}>
                          {a.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="By" htmlFor="rule-channel">
                  <Select value={editing.channel} onValueChange={(v) => setEditing({ ...editing, channel: v as Channel })}>
                    <SelectTrigger id="rule-channel">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CHANNELS.map((c) => (
                        <SelectItem key={c.value} value={c.value}>
                          {c.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>
              <Field label="Offset in days" htmlFor="rule-offset" optional error={offsetError} description="Negative sends before the event date (−14 = two weeks before); positive sends after. Leave empty to send right away.">
                <Input id="rule-offset" inputMode="numeric" value={editing.offset} onChange={(e) => setEditing({ ...editing, offset: e.target.value })} className="max-w-32 tabular-nums" />
              </Field>
              {editing.channel === 'email' ? (
                <Field label="Email template" htmlFor="rule-template" optional description="Without one, GMS uses its built-in email for this event.">
                  <Select value={editing.templateKey ?? NO_TEMPLATE} onValueChange={(v) => setEditing({ ...editing, templateKey: v === NO_TEMPLATE ? null : v })}>
                    <SelectTrigger id="rule-template">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_TEMPLATE}>Built-in email</SelectItem>
                      {templates.map((t) => (
                        <SelectItem key={t.key} value={t.key}>
                          {t.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              ) : null}
              <label className="flex min-h-9 items-center justify-between gap-4 text-sm font-medium" htmlFor="rule-enabled">
                Turn this rule on
                <Switch id="rule-enabled" checked={editing.enabled} onCheckedChange={(v) => setEditing({ ...editing, enabled: v })} />
              </label>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setEditing(null)}>
                  Cancel
                </Button>
                <Button type="submit" pending={saving} pendingLabel="Saving…">
                  {editing.ruleId ? 'Save rule' : 'Add rule'}
                </Button>
              </DialogFooter>
            </form>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
