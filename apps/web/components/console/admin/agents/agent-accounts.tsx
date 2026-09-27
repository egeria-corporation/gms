// SPDX-License-Identifier: AGPL-3.0-only
'use client';
// S-04: foundation-owned agent accounts: list, create (R3 + step-up, key shown once), pause/resume/revoke.
import { formatInZone, SCOPES, STAFF_SCOPES, type Scope } from '@gms/domain';
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
  Badge,
  Button,
  CheckboxField,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Field,
  FieldSet,
  Input,
  RadioGroup,
  RadioOption,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from '@gms/ui';
import { Bot, Pause, Play, Plus, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import {
  changeAgentAccountAction,
  createAgentAccountAction,
} from '@/app/console/(app)/settings/agents/actions';
import { SecretOnce } from '@/components/console/admin/secret-once';
import { useStepUp } from '@/components/console/step-up';
import { AgentStatusChip } from './agent-status';

export interface AgentAccountRow {
  id: string;
  name: string;
  clientId: string;
  ownerName: string | null;
  scopes: string[];
  toolAllowlist: string[] | null;
  rateLimitPerMin: number;
  status: string;
  createdAt: string;
  keyPrefix: string | null;
}

export interface StaffOption {
  id: string;
  name: string;
  roleLabel: string;
}

export interface ToolOption {
  id: string;
  title: string;
  tier: string;
}

function scopeLabel(s: string): string {
  return SCOPES[s as Scope]?.label ?? s;
}

export function AgentAccounts({
  accounts,
  staff,
  tools,
  timeZone,
  canEdit,
  previewKey,
}: {
  accounts: AgentAccountRow[];
  staff: StaffOption[];
  tools: ToolOption[];
  timeZone: string;
  canEdit: boolean;
  /** Forced `key-created` state: open the dialog on the one-time key. */
  previewKey?: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const { withStepUp, dialog } = useStepUp({ actionLabel: 'Create agent account' });
  const [open, setOpen] = useState(Boolean(previewKey));
  const [created, setCreated] = useState<string | null>(previewKey ?? null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [name, setName] = useState('');
  const [owner, setOwner] = useState('');
  const [scopes, setScopes] = useState<Scope[]>(['pipeline:read', 'analytics:read']);
  const [toolMode, setToolMode] = useState<'all' | 'only'>('all');
  const [allowed, setAllowed] = useState<string[]>([]);
  const [toolFilter, setToolFilter] = useState('');
  const [rate, setRate] = useState('60');
  const [confirmRevoke, setConfirmRevoke] = useState<AgentAccountRow | null>(null);

  const visibleTools = useMemo(() => {
    const q = toolFilter.trim().toLowerCase();
    return q ? tools.filter((t) => t.id.includes(q) || t.title.toLowerCase().includes(q)) : tools;
  }, [tools, toolFilter]);

  const reset = () => {
    setCreated(null);
    setError(null);
    setFieldErrors({});
    setName('');
    setOwner('');
    setScopes(['pipeline:read', 'analytics:read']);
    setToolMode('all');
    setAllowed([]);
    setToolFilter('');
    setRate('60');
  };

  const change = (row: AgentAccountRow, action: 'pause' | 'resume' | 'revoke') =>
    start(async () => {
      const r = await changeAgentAccountAction(row.id, action);
      if (r.ok) {
        toast.success(
          action === 'revoke'
            ? `${row.name} can no longer act in GMS.`
            : action === 'pause'
              ? `${row.name} is paused.`
              : `${row.name} is active again.`,
        );
        setConfirmRevoke(null);
        router.refresh();
      } else toast.error(r.problem.detail);
    });

  const submit = () => {
    const errs: Record<string, string> = {};
    if (!name.trim()) errs.name = 'Give the agent a name your team will recognize.';
    if (!owner) errs.ownerUserId = 'Choose the person responsible for this agent.';
    if (!scopes.length) errs.scopes = 'Choose at least one permission.';
    if (toolMode === 'only' && !allowed.length)
      errs.toolAllowlist = 'Pick at least one tool, or allow every tool its permissions cover.';
    const n = Number(rate);
    if (!Number.isInteger(n) || n < 1 || n > 600)
      errs.rateLimitPerMin = 'Enter a whole number from 1 to 600.';
    setFieldErrors(errs);
    if (Object.keys(errs).length) {
      setError('Check the highlighted fields.');
      return;
    }
    setError(null);
    start(async () => {
      const r = await withStepUp(() =>
        createAgentAccountAction({
          name: name.trim(),
          ownerUserId: owner,
          scopes,
          toolAllowlist: toolMode === 'only' ? allowed : null,
          rateLimitPerMin: n,
        }),
      );
      if (r.ok) {
        setCreated(r.data.key);
        toast.success('Agent account created.');
        router.refresh();
      } else {
        setError(r.problem.detail);
        const fe: Record<string, string> = {};
        for (const i of r.problem.errors ?? []) {
          const k = i.pointer.split('/')[1];
          if (k) fe[k] = i.message;
        }
        setFieldErrors(fe);
      }
    });
  };

  return (
    <div className="grid gap-3">
      {accounts.length ? (
        <Table containerLabel="Agent accounts">
          <TableHeader>
            <TableRow>
              <TableHead>Agent</TableHead>
              <TableHead>Owner</TableHead>
              <TableHead>Permissions</TableHead>
              <TableHead>Tools</TableHead>
              <TableHead className="text-right">Rate limit</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Created</TableHead>
              {canEdit ? <TableHead className="sr-only">Actions</TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {accounts.map((a) => (
              <TableRow key={a.id}>
                <TableCell>
                  <span className="flex items-center gap-2 font-medium">
                    <Bot aria-hidden="true" className="size-4 text-muted-foreground" />
                    {a.name}
                  </span>
                  <span className="block font-mono text-xs text-muted-foreground">
                    {a.keyPrefix ? `${a.keyPrefix}…` : a.clientId}
                  </span>
                </TableCell>
                <TableCell>{a.ownerName ?? '—'}</TableCell>
                <TableCell>
                  <ul className="flex max-w-xs flex-wrap gap-1" aria-label={`Permissions for ${a.name}`}>
                    {a.scopes.map((s) => (
                      <li key={s}>
                        <Badge variant="neutral" title={scopeLabel(s)}>
                          {s}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                </TableCell>
                <TableCell>
                  {a.toolAllowlist ? (
                    <details>
                      <summary className="cursor-pointer text-sm">{a.toolAllowlist.length} tools</summary>
                      <ul className="mt-1 grid gap-0.5 font-mono text-xs">
                        {a.toolAllowlist.map((t) => (
                          <li key={t}>{t}</li>
                        ))}
                      </ul>
                    </details>
                  ) : (
                    <span className="text-sm text-muted-foreground">Any its permissions allow</span>
                  )}
                </TableCell>
                <TableCell className="text-right">{a.rateLimitPerMin}/min</TableCell>
                <TableCell>
                  <AgentStatusChip status={a.status} />
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  {formatInZone(a.createdAt, timeZone, { dateOnly: true })}
                </TableCell>
                {canEdit ? (
                  <TableCell>
                    {a.status !== 'revoked' ? (
                      <span className="flex justify-end gap-1">
                        {a.status === 'active' ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={pending}
                            onClick={() => change(a, 'pause')}
                          >
                            <Pause aria-hidden="true" /> Pause<span className="sr-only"> {a.name}</span>
                          </Button>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={pending}
                            onClick={() => change(a, 'resume')}
                          >
                            <Play aria-hidden="true" /> Resume<span className="sr-only"> {a.name}</span>
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive"
                          disabled={pending}
                          onClick={() => setConfirmRevoke(a)}
                        >
                          <Trash2 aria-hidden="true" /> Revoke<span className="sr-only"> {a.name}</span>
                        </Button>
                      </span>
                    ) : null}
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <EmptyState
          level={3}
          icon={Bot}
          title="No agent accounts yet"
          description="An agent account lets software your foundation runs (for example an operations assistant) work in GMS with its own key, an owner who answers for it, and a rate limit. It can never approve payments, record decisions or change roles."
        />
      )}

      {canEdit ? (
        <Button
          className="justify-self-start"
          onClick={() => {
            reset();
            setOpen(true);
          }}
        >
          <Plus aria-hidden="true" /> Create agent account
        </Button>
      ) : null}

      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) reset();
        }}
      >
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle>{created ? 'Copy the agent’s key' : 'Create agent account'}</DialogTitle>
            <DialogDescription>
              {created
                ? 'Put this key in the agent’s configuration. It works with the MCP server, A2A and the REST API within the permissions you chose.'
                : 'This is a people-only step, so we check your authenticator first. Consequential actions the agent asks for still wait for a person to confirm.'}
            </DialogDescription>
          </DialogHeader>
          {created ? (
            <SecretOnce label="Agent API key" value={created} />
          ) : (
            <form
              id="agent-account-form"
              className="grid max-h-[65vh] gap-5 overflow-y-auto pr-1"
              onSubmit={(e) => {
                e.preventDefault();
                submit();
              }}
            >
              {error ? (
                <Alert variant="danger" title="The agent account wasn’t created">
                  {error}
                </Alert>
              ) : null}
              <Field
                label="Name"
                htmlFor="agent-name"
                required
                error={fieldErrors.name}
                description="For example, “Operations assistant”."
              >
                <Input
                  id="agent-name"
                  value={name}
                  maxLength={100}
                  onChange={(e) => setName(e.target.value)}
                />
              </Field>
              <Field
                label="Owner"
                htmlFor="agent-owner"
                required
                error={fieldErrors.ownerUserId}
                description="The staff member who answers for what this agent does."
              >
                <Select value={owner} onValueChange={setOwner}>
                  <SelectTrigger id="agent-owner">
                    <SelectValue placeholder="Choose a staff member" />
                  </SelectTrigger>
                  <SelectContent>
                    {staff.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name} · {s.roleLabel}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <FieldSet
                legend="Permissions"
                required
                error={fieldErrors.scopes}
                description="Staff permissions only. None of them allow people-only (R3) actions."
              >
                <div className="grid gap-1 sm:grid-cols-2">
                  {STAFF_SCOPES.map((s) => (
                    <CheckboxField
                      key={s}
                      id={`agent-scope-${s}`}
                      label={SCOPES[s].label}
                      description={<span className="font-mono text-xs">{s}</span>}
                      checked={scopes.includes(s)}
                      onCheckedChange={(c) =>
                        setScopes(c === true ? [...scopes, s] : scopes.filter((x) => x !== s))
                      }
                    />
                  ))}
                </div>
              </FieldSet>
              <FieldSet
                legend="Tools"
                error={fieldErrors.toolAllowlist}
                description="Narrow the agent to specific actions, on top of its permissions."
              >
                <RadioGroup
                  value={toolMode}
                  onValueChange={(v) => setToolMode(v === 'only' ? 'only' : 'all')}
                >
                  <RadioOption value="all" label="Any tool its permissions allow" />
                  <RadioOption value="only" label="Only the tools I pick" />
                </RadioGroup>
                {toolMode === 'only' ? (
                  <div className="grid gap-2">
                    <Field label="Filter tools" htmlFor="agent-tool-filter">
                      <Input
                        id="agent-tool-filter"
                        inputSize="sm"
                        value={toolFilter}
                        placeholder="e.g. applications"
                        onChange={(e) => setToolFilter(e.target.value)}
                      />
                    </Field>
                    <p className="text-xs text-muted-foreground" aria-live="polite">
                      {allowed.length} selected · people-only (R3) actions are never listed
                    </p>
                    <div
                      role="group"
                      aria-label="Allowed tools"
                      className="grid max-h-56 gap-0.5 overflow-y-auto rounded-md border p-2"
                    >
                      {visibleTools.map((t) => (
                        <CheckboxField
                          key={t.id}
                          id={`agent-tool-${t.id}`}
                          label={<span className="font-mono text-xs">{t.id}</span>}
                          description={`${t.title} · ${t.tier}`}
                          checked={allowed.includes(t.id)}
                          onCheckedChange={(c) =>
                            setAllowed(c === true ? [...allowed, t.id] : allowed.filter((x) => x !== t.id))
                          }
                        />
                      ))}
                      {!visibleTools.length ? (
                        <p className="p-2 text-sm text-muted-foreground">No tools match.</p>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </FieldSet>
              <Field
                label="Rate limit (requests per minute)"
                htmlFor="agent-rate"
                required
                error={fieldErrors.rateLimitPerMin}
              >
                <Input
                  id="agent-rate"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={600}
                  className="max-w-32"
                  value={rate}
                  onChange={(e) => setRate(e.target.value)}
                />
              </Field>
            </form>
          )}
          <DialogFooter>
            {created ? (
              <Button onClick={() => setOpen(false)}>Done</Button>
            ) : (
              <>
                <Button variant="secondary" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" form="agent-account-form" pending={pending} pendingLabel="Creating…">
                  Create agent account
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(confirmRevoke)} onOpenChange={(o) => !o && setConfirmRevoke(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke {confirmRevoke?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Its key stops working right away and it can’t be turned back on. Anything it already did stays
              in the audit log.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={(e) => {
                e.preventDefault();
                if (confirmRevoke) change(confirmRevoke, 'revoke');
              }}
            >
              Revoke agent
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {dialog}
    </div>
  );
}
