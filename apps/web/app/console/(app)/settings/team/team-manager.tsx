// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';
import type { WorkspaceRole } from '@gms/domain';
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
  Field,
  Input,
  Section,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  StepUpDialog,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
  ToneChip,
} from '@gms/ui';
import { CircleCheck, Clock, MailPlus, UserMinus, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { useStepUp } from '@/components/console/step-up';
import { verifyTotpAction } from '@/app/console/(auth)/mfa/actions';
import { changeRoleAction, inviteAction, removeMemberAction, revokeInviteAction, setCapacityAction } from './actions';

export interface MemberRow {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: WorkspaceRole;
  status: string;
  title: string | null;
  capacity: number | null;
  openAssignments: number;
  joinedAt: string;
}

export interface InvitationRow {
  id: string;
  email: string;
  role: WorkspaceRole;
  invitedBy: string | null;
  createdAt: string;
  expiresAt: string;
}

interface RoleOption {
  value: WorkspaceRole;
  label: string;
  description: string;
}

const REVIEW_ROLES: WorkspaceRole[] = ['reviewer', 'program_officer'];

export function TeamManager({
  members,
  invitations,
  viewerId,
  viewerIsOwner,
  canManage,
  timeZone,
  roles,
  forced,
}: {
  members: MemberRow[];
  invitations: InvitationRow[];
  viewerId: string;
  viewerIsOwner: boolean;
  canManage: boolean;
  timeZone: string;
  roles: RoleOption[];
  forced: 'invite-pending' | 'step-up' | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const { withStepUp, dialog } = useStepUp({ reason: 'Changing who can do what is a people-only action, so we check your authenticator app first.', actionLabel: 'Confirm' });
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<WorkspaceRole>('program_officer');
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [lastInvited, setLastInvited] = useState<string | null>(forced === 'invite-pending' ? (invitations[0]?.email ?? null) : null);
  const [removeTarget, setRemoveTarget] = useState<MemberRow | null>(null);
  const [demoStepUp, setDemoStepUp] = useState(forced === 'step-up');
  const label = (r: string) => roles.find((x) => x.value === r)?.label ?? r;
  const date = (iso: string) => new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone }).format(new Date(iso));
  // Only owners can grant or change the owner role (the action enforces this too).
  const assignable = roles.filter((r) => viewerIsOwner || r.value !== 'owner');

  const invite = (e: React.FormEvent) => {
    e.preventDefault();
    setInviteError(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setInviteError('Enter an email address, like jordan@example.org.');
      return;
    }
    start(async () => {
      const r = await inviteAction({ email: email.trim().toLowerCase(), role });
      if (r.ok) {
        setLastInvited(email.trim().toLowerCase());
        setEmail('');
        router.refresh();
      } else setInviteError(r.problem.detail);
    });
  };

  const changeRole = (m: MemberRow, next: WorkspaceRole) =>
    start(async () => {
      const r = await withStepUp(() => changeRoleAction(m.id, next));
      if (r.ok) {
        toast.success(`${m.name} is now ${label(next).toLowerCase()}.`);
        router.refresh();
      } else if (r.problem.code !== 'step_up_required') toast.error(r.problem.detail);
    });

  const remove = (m: MemberRow) =>
    start(async () => {
      const r = await withStepUp(() => removeMemberAction(m.id));
      setRemoveTarget(null);
      if (r.ok) {
        toast.success(`${m.name} was removed from the workspace.`);
        router.refresh();
      } else if (r.problem.code !== 'step_up_required') toast.error(r.problem.detail);
    });

  return (
    <div className="grid gap-8">
      {dialog}
      {forced === 'step-up' ? (
        <StepUpDialog
          open={demoStepUp}
          onOpenChange={setDemoStepUp}
          reason="Changing Jordan Lee from Program officer to Admin is a people-only action, so we check your authenticator app first."
          actionLabel="Change role"
          onVerify={async (code) => (await verifyTotpAction(null, code)).ok}
        />
      ) : null}

      {canManage ? (
        <Section title="Invite someone" description="They get an email with a link that works for 14 days. People join with the role you pick here.">
          <form onSubmit={invite} className="grid gap-4 rounded-xl border bg-card p-4 md:grid-cols-[minmax(0,1fr)_16rem_auto] md:items-end" noValidate>
            <Field label="Email address" htmlFor="invite-email" error={inviteError ?? undefined}>
              <Input id="invite-email" type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="jordan@example.org" />
            </Field>
            <Field label="Role" htmlFor="invite-role">
              <Select value={role} onValueChange={(v) => setRole(v as WorkspaceRole)}>
                <SelectTrigger id="invite-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {assignable.map((r) => (
                    <SelectItem key={r.value} value={r.value}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Button type="submit" pending={pending} pendingLabel="Sending…">
              <MailPlus aria-hidden="true" /> Send invite
            </Button>
            <p className="text-sm text-muted-foreground md:col-span-3">{roles.find((r) => r.value === role)?.description}</p>
          </form>
          {lastInvited ? (
            <Alert variant="success" title={`Invitation sent to ${lastInvited}`} role="status">
              It’s listed under pending invitations until they accept. You can revoke it any time.
            </Alert>
          ) : null}
        </Section>
      ) : (
        <Alert variant="info" title="View only">Only owners and admins can invite people or change roles.</Alert>
      )}

      <Section title="Pending invitations" description={invitations.length ? `${invitations.length} waiting to be accepted.` : undefined}>
        {invitations.length ? (
          <Table containerLabel="Pending invitations" className="rounded-lg border">
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Invited by</TableHead>
                <TableHead>Expires</TableHead>
                {canManage ? <TableHead className="text-right">Actions</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {invitations.map((i) => (
                <TableRow key={i.id} data-testid="pending-invitation">
                  <TableCell className="font-medium">{i.email}</TableCell>
                  <TableCell>{label(i.role)}</TableCell>
                  <TableCell>
                    <ToneChip tone="warning" icon={Clock} label="Invite pending" size="sm" />
                  </TableCell>
                  <TableCell>{i.invitedBy ?? '—'}</TableCell>
                  <TableCell>{date(i.expiresAt)}</TableCell>
                  {canManage ? (
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={pending || i.id === 'preview-invitation'}
                        onClick={() =>
                          start(async () => {
                            const r = await revokeInviteAction(i.id);
                            if (r.ok) {
                              toast.success(`Invitation for ${i.email} revoked.`);
                              if (lastInvited === i.email) setLastInvited(null);
                              router.refresh();
                            } else toast.error(r.problem.detail);
                          })
                        }
                      >
                        <X aria-hidden="true" /> Revoke<span className="sr-only"> invitation for {i.email}</span>
                      </Button>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="text-sm text-muted-foreground">No pending invitations.</p>
        )}
      </Section>

      <Section title="Members" description={`${members.length} ${members.length === 1 ? 'person' : 'people'} in this workspace.`}>
        <Table containerLabel="Members" className="rounded-lg border">
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Review capacity</TableHead>
              <TableHead>Joined</TableHead>
              {canManage ? <TableHead className="text-right">Actions</TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.map((m) => {
              const self = m.userId === viewerId;
              const lockedOwner = m.role === 'owner' && !viewerIsOwner;
              return (
                <TableRow key={m.id}>
                  <TableCell>
                    <span className="block font-medium">
                      {m.name}
                      {self ? <span className="font-normal text-muted-foreground"> (you)</span> : null}
                    </span>
                    <span className="block text-xs text-muted-foreground">{m.title ? `${m.title} · ` : ''}{m.email}</span>
                  </TableCell>
                  <TableCell>
                    {canManage && !lockedOwner ? (
                      <Select value={m.role} disabled={pending} onValueChange={(v) => v !== m.role && changeRole(m, v as WorkspaceRole)}>
                        <SelectTrigger size="sm" className="w-48" aria-label={`Role for ${m.name}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {assignable.map((r) => (
                            <SelectItem key={r.value} value={r.value}>
                              {r.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <span title={roles.find((r) => r.value === m.role)?.description}>{label(m.role)}</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {m.status === 'active' ? <ToneChip tone="success" icon={CircleCheck} label="Active" size="sm" /> : <ToneChip tone="warning" icon={Clock} label="Suspended" size="sm" />}
                  </TableCell>
                  <TableCell>
                    {REVIEW_ROLES.includes(m.role) ? (
                      <CapacityEditor member={m} editable={canManage} />
                    ) : (
                      <span className="text-xs text-muted-foreground">Doesn’t review</span>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{date(m.joinedAt)}</TableCell>
                  {canManage ? (
                    <TableCell className="text-right">
                      {!self && m.role !== 'owner' ? (
                        <Button variant="ghost" size="sm" className="text-destructive" disabled={pending} onClick={() => setRemoveTarget(m)}>
                          <UserMinus aria-hidden="true" /> Remove<span className="sr-only"> {m.name}</span>
                        </Button>
                      ) : null}
                    </TableCell>
                  ) : null}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Section>

      <Section title="What each role can do" level={2}>
        <dl className="grid gap-3 sm:grid-cols-2">
          {roles.map((r) => (
            <div key={r.value} className="rounded-lg border bg-card p-3">
              <dt className="font-medium">
                {r.label} {['owner', 'admin', 'program_officer', 'finance', 'auditor'].includes(r.value) ? <Badge variant="neutral">Authenticator required</Badge> : null}
              </dt>
              <dd className="text-sm text-muted-foreground">{r.description}</dd>
            </div>
          ))}
        </dl>
      </Section>

      <AlertDialog open={Boolean(removeTarget)} onOpenChange={(o) => !o && setRemoveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {removeTarget?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              They lose access to this workspace right away. Their past work (reviews, notes, decisions) stays in the record. We’ll ask for your authenticator code.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={pending}
              onClick={(e) => {
                e.preventDefault();
                if (removeTarget) remove(removeTarget);
              }}
            >
              Remove from workspace
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function CapacityEditor({ member, editable }: { member: MemberRow; editable: boolean }) {
  const router = useRouter();
  const [value, setValue] = useState(member.capacity === null ? '' : String(member.capacity));
  const [pending, start] = useTransition();
  const current = member.capacity === null ? '' : String(member.capacity);
  if (!editable) {
    return (
      <span className="text-sm tabular-nums">
        {member.openAssignments} open{member.capacity !== null ? ` of ${member.capacity}` : ' · no limit'}
      </span>
    );
  }
  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const n = value.trim() === '' ? null : Number(value);
        if (n !== null && (!Number.isInteger(n) || n < 0 || n > 500)) {
          toast.error('Capacity is a whole number from 0 to 500, or blank for no limit.');
          return;
        }
        start(async () => {
          const r = await setCapacityAction(member.id, n);
          if (r.ok) {
            toast.success(`Capacity for ${member.name} saved.`);
            router.refresh();
          } else toast.error(r.problem.detail);
        });
      }}
    >
      <Input
        inputSize="sm"
        inputMode="numeric"
        className="w-16"
        aria-label={`Review capacity for ${member.name} (blank for no limit)`}
        value={value}
        placeholder="—"
        onChange={(e) => setValue(e.target.value.replace(/[^\d]/g, ''))}
      />
      <span className="text-xs text-muted-foreground tabular-nums">{member.openAssignments} open</span>
      {value !== current ? (
        <Button type="submit" size="sm" variant="secondary" pending={pending}>
          Save
        </Button>
      ) : null}
    </form>
  );
}
