// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { Alert, Badge, Button, Field, Input, RadioGroup, RadioOption, toast } from '@gms/ui';
import { Trash2, UserPlus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { inviteCollaboratorAction, removeCollaboratorAction } from './actions';

export interface CollaboratorView {
  id: string;
  email: string;
  name: string | null;
  role: 'editor' | 'viewer';
  status: 'invited' | 'active' | 'removed';
}

export function ManageCollaborators({ applicationId, collaborators, canManage }: { applicationId: string; collaborators: CollaboratorView[]; canManage: boolean }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'editor' | 'viewer'>('editor');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="grid gap-6">
      {collaborators.length ? (
        <ul className="grid gap-2">
          {collaborators.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card p-3">
              <span className="grid">
                <span className="font-medium">{c.name ?? c.email}</span>
                {c.name ? <span className="text-sm text-muted-foreground">{c.email}</span> : null}
              </span>
              <span className="flex items-center gap-2">
                <Badge variant="neutral">{c.role === 'editor' ? 'Can edit' : 'Can view'}</Badge>
                {c.status === 'invited' ? <Badge variant="warning">Invite pending</Badge> : <Badge variant="success">Joined</Badge>}
                {canManage ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove ${c.email}`}
                    disabled={pending}
                    onClick={() =>
                      start(async () => {
                        const r = await removeCollaboratorAction(applicationId, c.id);
                        if (r.ok) router.refresh();
                        else toast.error(r.problem.detail);
                      })
                    }
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">No one else is working on this yet.</p>
      )}
      {canManage ? (
        <form
          className="grid gap-4 rounded-xl border bg-muted/40 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            start(async () => {
              const r = await inviteCollaboratorAction(applicationId, email, role);
              if (r.ok) {
                toast.success(`We emailed an invitation to ${email}.`);
                setEmail('');
                router.refresh();
              } else setError(r.problem.errors?.[0]?.message ?? r.problem.detail);
            });
          }}
        >
          <h2 className="font-semibold">Invite someone</h2>
          {error ? <Alert variant="danger" title="Invitation not sent">{error}</Alert> : null}
          <Field label="Their email address" htmlFor="collab-email">
            <Input id="collab-email" type="email" inputSize="lg" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <fieldset className="grid gap-2">
            <legend className="text-sm font-medium">What can they do?</legend>
            <RadioGroup value={role} onValueChange={(v) => setRole(v as 'editor' | 'viewer')} className="grid gap-2">
              <RadioOption value="editor" id="role-editor" label="Edit answers" description="They can’t submit — only you and your organization’s admins can." />
              <RadioOption value="viewer" id="role-viewer" label="View only" />
            </RadioGroup>
          </fieldset>
          <div>
            <Button type="submit" pending={pending} pendingLabel="Sending…">
              <UserPlus aria-hidden="true" /> Send invitation
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
