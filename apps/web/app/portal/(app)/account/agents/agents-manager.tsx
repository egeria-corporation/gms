// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';
import { APPLICANT_SCOPES, SCOPES, type Scope } from '@gms/domain';
import { Alert, Badge, Button, CheckboxField, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger, Field, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, toast } from '@gms/ui';
import { Bot, Copy, KeyRound, Pause, Play, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { createTokenAction, revokeAgentAction } from '../actions';

export interface AgentConnection {
  kind: 'token' | 'grant';
  id: string;
  name: string;
  scopes: string[];
  status: 'active' | 'paused' | 'revoked' | 'expired';
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
}

const ALWAYS_ASKS: Scope[] = ['applications:submit', 'reports:write'];

export function AgentsManager({ connections, timeZone }: { connections: AgentConnection[]; timeZone: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<Scope[]>(['opportunities:read', 'profile:read', 'applications:read', 'applications:write']);
  const [days, setDays] = useState('90');
  const [created, setCreated] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const act = (kind: 'token' | 'grant', id: string, action: 'pause' | 'resume' | 'revoke') =>
    start(async () => {
      const r = await revokeAgentAction(kind, id, action);
      if (r.ok) {
        toast.success(action === 'revoke' ? 'Access removed.' : action === 'pause' ? 'Paused.' : 'Resumed.');
        router.refresh();
      } else toast.error(r.problem.detail);
    });

  return (
    <div className="grid gap-6">
      {connections.length ? (
        <ul className="grid gap-3">
          {connections.map((c) => (
            <li key={`${c.kind}-${c.id}`} className="grid gap-3 rounded-xl border bg-card p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Bot aria-hidden="true" className="size-5 text-muted-foreground" />
                  <span className="font-medium">{c.name}</span>
                  <Badge variant="agent">Agent</Badge>
                  <Badge variant={c.status === 'active' ? 'success' : c.status === 'paused' ? 'warning' : 'neutral'}>{c.status === 'active' ? 'Active' : c.status === 'paused' ? 'Paused' : c.status === 'expired' ? 'Expired' : 'Removed'}</Badge>
                </div>
                {c.status === 'active' || c.status === 'paused' ? (
                  <div className="flex gap-2">
                    {c.status === 'active' ? (
                      <Button variant="secondary" size="sm" disabled={pending} onClick={() => act(c.kind, c.id, 'pause')}>
                        <Pause aria-hidden="true" /> Pause
                      </Button>
                    ) : (
                      <Button variant="secondary" size="sm" disabled={pending} onClick={() => act(c.kind, c.id, 'resume')}>
                        <Play aria-hidden="true" /> Resume
                      </Button>
                    )}
                    <Button variant="ghost" size="sm" className="text-destructive" disabled={pending} onClick={() => act(c.kind, c.id, 'revoke')}>
                      <Trash2 aria-hidden="true" /> Remove
                    </Button>
                  </div>
                ) : null}
              </div>
              <ul className="flex flex-wrap gap-2" aria-label="Permissions">
                {c.scopes.map((s) => (
                  <li key={s}>
                    <Badge variant="neutral" title={SCOPES[s as Scope]?.label}>
                      {SCOPES[s as Scope]?.label ?? s}
                      {ALWAYS_ASKS.includes(s as Scope) ? ' · always asks you first' : ''}
                    </Badge>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-muted-foreground">
                Connected {new Date(c.createdAt).toLocaleDateString('en-US', { timeZone })}
                {c.expiresAt ? ` · expires ${new Date(c.expiresAt).toLocaleDateString('en-US', { timeZone })}` : ''}
                {c.lastUsedAt ? ` · last used ${new Date(c.lastUsedAt).toLocaleString('en-US', { timeZone })}` : ' · not used yet'}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">No agents are connected. When you connect one, it appears here with exactly what it can do.</p>
      )}

      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) {
            setCreated(null);
            setError(null);
          }
        }}
      >
        <DialogTrigger asChild>
          <Button className="justify-self-start">
            <KeyRound aria-hidden="true" /> Connect an agent with a token
          </Button>
        </DialogTrigger>
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle>{created ? 'Copy your token now' : 'Connect an agent'}</DialogTitle>
            <DialogDescription>
              {created
                ? 'This is the only time we show it. Paste it into your AI tool’s settings. Anyone with this token can act for you within the permissions you chose.'
                : 'Use this for AI tools that don’t support “Sign in with GMS”. You choose what the agent can do; important steps still come back to you to confirm.'}
            </DialogDescription>
          </DialogHeader>
          {created ? (
            <div className="grid gap-3">
              <code className="block break-all rounded-md bg-muted p-3 font-mono text-sm">{created}</code>
              <Button
                variant="secondary"
                className="justify-self-start"
                onClick={() => {
                  void navigator.clipboard.writeText(created);
                  toast.success('Copied.');
                }}
              >
                <Copy aria-hidden="true" /> Copy token
              </Button>
            </div>
          ) : (
            <form
              id="token-form"
              className="grid gap-5"
              onSubmit={(e) => {
                e.preventDefault();
                if (!name.trim()) {
                  setError('Give the agent a name you’ll recognize.');
                  return;
                }
                start(async () => {
                  const r = await createTokenAction({ agentName: name.trim(), scopes, expiresInDays: Number(days) });
                  if (r.ok) {
                    setCreated(r.data.token);
                    router.refresh();
                  } else setError(r.problem.detail);
                });
              }}
            >
              {error ? <Alert variant="danger" title="Not yet">{error}</Alert> : null}
              <Field label="Agent name" htmlFor="tok-name" description="For example, “Grant Writer Assistant”.">
                <Input id="tok-name" value={name} onChange={(e) => setName(e.target.value)} />
              </Field>
              <fieldset className="grid gap-2">
                <legend className="mb-1 text-sm font-medium">What can it do?</legend>
                {APPLICANT_SCOPES.map((s) => (
                  <CheckboxField
                    key={s}
                    id={`scope-${s}`}
                    label={SCOPES[s].label}
                    description={ALWAYS_ASKS.includes(s) ? 'Always asks you first' : undefined}
                    checked={scopes.includes(s)}
                    onCheckedChange={(c) => setScopes(c ? [...scopes, s] : scopes.filter((x) => x !== s))}
                  />
                ))}
              </fieldset>
              <Field label="Expires after" htmlFor="tok-days">
                <Select value={days} onValueChange={setDays}>
                  <SelectTrigger id="tok-days">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="7">7 days</SelectItem>
                    <SelectItem value="30">30 days</SelectItem>
                    <SelectItem value="90">90 days</SelectItem>
                    <SelectItem value="365">1 year</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </form>
          )}
          <DialogFooter>
            {created ? (
              <Button onClick={() => setOpen(false)}>Done</Button>
            ) : (
              <Button type="submit" form="token-form" pending={pending} pendingLabel="Creating…">
                Create token
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
