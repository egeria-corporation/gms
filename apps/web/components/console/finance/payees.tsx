// SPDX-License-Identifier: AGPL-3.0-only
'use client';
// P-02 client parts: the payee table (reissue expired invites) and the "awarded, not invited" list.
import { formatDateOnly } from '@gms/domain';
import {
  Button,
  DataTable,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  EmptyState,
  Field,
  Input,
  StatusChip,
  type ColumnDefFor,
} from '@gms/ui';
import { MailPlus, RotateCw } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';
import { invitePayeeAction, reissuePayeeAction } from '@/app/console/(app)/payments/actions';
import { FeedbackRegion, UrlFilterSelect, useRunner, useUrlPagination, type Feedback } from './client-utils';

export interface PayeeRow {
  id: string;
  orgId: string;
  grantee: string;
  status: string;
  provider: string;
  contactEmail: string;
  invitedAt: string | null;
  readyAt: string | null;
  lastPolledAt: string | null;
}

function ReissueButton({ payeeId, grantee }: { payeeId: string; grantee: string }) {
  const { run, pending, feedback } = useRunner();
  return (
    <div className="grid justify-items-end gap-1">
      <Button size="sm" variant="outline" pending={pending} pendingLabel="Sending…" onClick={() => run(() => reissuePayeeAction(payeeId), () => ({ variant: 'success', title: `New invite sent to ${grantee}.` }))}>
        <RotateCw aria-hidden="true" /> Send a new invite
      </Button>
      <FeedbackRegion feedback={feedback} className="max-w-xs text-left" />
    </div>
  );
}

export function PayeesTable({ rows, total, page, pageSize, status, canWrite }: { rows: PayeeRow[]; total: number; page: number; pageSize: number; status?: string; canWrite: boolean }) {
  const { pagination, onPaginationChange, loading } = useUrlPagination(page, pageSize);
  const columns = React.useMemo<ColumnDefFor<PayeeRow>[]>(
    () => [
      {
        id: 'grantee',
        header: 'Grantee',
        enableSorting: false,
        cell: ({ row }) => <span className="font-medium">{row.original.grantee}</span>,
      },
      { id: 'status', header: 'Status', enableSorting: false, cell: ({ row }) => <StatusChip kind="payee" value={row.original.status} size="sm" /> },
      { id: 'contact', header: 'Contact', enableSorting: false, cell: ({ row }) => <span className="text-muted-foreground">{row.original.contactEmail}</span> },
      {
        id: 'rail',
        header: 'Pays through',
        enableSorting: false,
        cell: ({ row }) => (row.original.provider === 'manual' ? 'Outside GMS' : 'Mercury'),
      },
      { id: 'invited', header: 'Invited', enableSorting: false, cell: ({ row }) => (row.original.invitedAt ? formatDateOnly(row.original.invitedAt) : '—') },
      { id: 'ready', header: 'Ready since', enableSorting: false, cell: ({ row }) => (row.original.readyAt ? formatDateOnly(row.original.readyAt) : '—') },
      {
        id: 'actions',
        header: () => <span className="sr-only">Actions</span>,
        enableSorting: false,
        meta: { align: 'right', label: 'Actions', alwaysVisible: true },
        cell: ({ row }) =>
          canWrite && (row.original.status === 'invite_expired' || row.original.status === 'invite_sent') && row.original.provider === 'mercury' ? (
            <ReissueButton payeeId={row.original.id} grantee={row.original.grantee} />
          ) : null,
      },
    ],
    [canWrite],
  );
  return (
    <DataTable
      caption="Payees"
      columns={columns}
      data={rows}
      getRowId={(r) => r.id}
      mode="server"
      pagination={pagination}
      onPaginationChange={onPaginationChange}
      pageCount={Math.max(1, Math.ceil(total / pageSize))}
      totalRows={total}
      loading={loading}
      searchable={false}
      itemLabel="payees"
      toolbar={
        <UrlFilterSelect
          param="status"
          label="Status"
          value={status}
          options={[
            { value: 'invite_sent', label: 'Invite sent' },
            { value: 'onboarding', label: 'Onboarding' },
            { value: 'ready', label: 'Ready' },
            { value: 'invite_expired', label: 'Invite expired' },
          ]}
        />
      }
      emptyState={<EmptyState level={3} title={status ? 'No payees with this status' : 'No payees yet'} description="Invite awarded grantees to bank onboarding below." />}
    />
  );
}

export interface UninvitedRow {
  orgId: string;
  grantee: string;
  email: string | null;
  awards: { id: string; reference: string }[];
}

function InviteDialog({ row, onInvited }: { row: UninvitedRow; onInvited: (f: Feedback) => void }) {
  const [open, setOpen] = React.useState(false);
  const [email, setEmail] = React.useState(row.email ?? '');
  const { run, pending, feedback, setFeedback } = useRunner();
  const id = React.useId();
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setFeedback(null);
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">
          <MailPlus aria-hidden="true" /> Invite to onboarding
        </Button>
      </DialogTrigger>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Invite {row.grantee} to bank onboarding</DialogTitle>
          <DialogDescription>
            We email a secure Mercury onboarding link. The grantee enters their bank details and tax form with Mercury directly — GMS never sees account numbers.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void run(
              () => invitePayeeAction({ applicantOrgId: row.orgId, contactEmail: email.trim() || undefined }),
              (d) => {
                // The row leaves this list on success, so the list announces the result.
                onInvited({ variant: 'success', title: d.status === 'ready' ? `${row.grantee} is ready to be paid outside GMS.` : `Invite sent to ${email || row.grantee}.` });
              },
            ).then((ok) => {
              if (ok) setOpen(false);
            });
          }}
        >
          <Field label="Send the invite to" htmlFor={id} description="Leave as is to use the organization’s contact email or its admin.">
            <Input id={id} type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="finance@grantee.example" />
          </Field>
          <FeedbackRegion feedback={feedback} />
          <DialogFooter>
            <Button variant="outline" type="button" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" pending={pending} pendingLabel="Sending invite…">
              Send invite
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function UninvitedList({ rows, canWrite }: { rows: UninvitedRow[]; canWrite: boolean }) {
  const [invited, setInvited] = React.useState<Feedback>(null);
  return (
    <div className="grid gap-2">
      <FeedbackRegion feedback={invited} />
      {rows.length ? <InviteRows rows={rows} canWrite={canWrite} onInvited={setInvited} /> : <p className="text-sm text-muted-foreground">Every awarded grantee has been invited.</p>}
    </div>
  );
}

function InviteRows({ rows, canWrite, onInvited }: { rows: UninvitedRow[]; canWrite: boolean; onInvited: (f: Feedback) => void }) {
  return (
    <ul className="grid gap-2">
      {rows.map((r) => (
        <li key={r.orgId} className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3 text-sm">
          <div className="grid gap-0.5">
            <span className="font-medium">{r.grantee}</span>
            <span className="text-xs text-muted-foreground">
              {r.awards.map((a, i) => (
                <React.Fragment key={a.id}>
                  {i ? ', ' : ''}
                  <Link className="hover:underline" href={`/console/awards/${a.id}`}>
                    {a.reference}
                  </Link>
                </React.Fragment>
              ))}
            </span>
          </div>
          {canWrite ? <InviteDialog row={r} onInvited={onInvited} /> : null}
        </li>
      ))}
    </ul>
  );
}
