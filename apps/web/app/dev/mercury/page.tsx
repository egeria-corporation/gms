// SPDX-License-Identifier: AGPL-3.0-only
// Dev-only fake Mercury controls for the current tenant: accounts, recipient invites, send-money requests and
// transactions, with buttons to play the bank's side and to deliver signed webhooks to /webhooks/mercury.
import { getRuntime } from '@gms/actions';
import { fakeMercuryControls, type FakeMercuryState } from '@gms/adapters';
import { formatMoney } from '@gms/domain';
import { Alert, Badge, PageHeader, Section, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@gms/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { rls } from '@/lib/server/db';
import { getTenant } from '@/lib/tenant';
import { DevControl } from './controls';

export const metadata: Metadata = { title: 'Dev · fake Mercury' };
export const dynamic = 'force-dynamic';

export default async function DevMercury() {
  const tenant = await getTenant();
  if (!tenant) {
    return (
      <>
        <PageHeader title="Fake Mercury" />
        <Alert variant="warning" title="Open this page on a workspace host">
          For example http://halcyon.localhost:3000/dev/mercury.
        </Alert>
      </>
    );
  }
  const rt = getRuntime();
  const conn = await rt.db
    .selectFrom('bank_connections')
    .select(['provider', 'environment', 'webhook_status'])
    .where('workspace_id', '=', tenant.id)
    .where('status', '=', 'connected')
    .orderBy('created_at', 'desc')
    .executeTakeFirst();
  const fake = conn?.provider === 'mercury' && conn.environment === 'fake';
  const header = (
    <PageHeader
      title="Fake Mercury"
      description={`Simulated bank for ${tenant.brand.displayName}. Play the grantee and the bank’s approvers here; GMS polls and receives signed webhooks exactly as it would from Mercury.`}
    />
  );
  if (!fake) {
    return (
      <>
        {header}
        <Alert variant="info" title="This workspace isn’t using the simulated bank">
          Connect it on <Link href="/console/payments/connect">Payments → Bank connection</Link> and choose the environment “Simulated bank”.
        </Alert>
      </>
    );
  }
  const state: FakeMercuryState = await fakeMercuryControls(tenant.id, rt.db).listState();
  const refs = await rls(async (trx) => {
    const [payees, payments] = await Promise.all([
      trx.selectFrom('payees as p').innerJoin('applicant_orgs as o', 'o.id', 'p.applicant_org_id').select(['p.invite_id', 'p.status', 'o.legal_name']).where('p.workspace_id', '=', tenant.id).execute(),
      trx
        .selectFrom('payments as p')
        .innerJoin('awards as a', 'a.id', 'p.award_id')
        .select(['p.id', 'p.rail_ref', 'p.rail_transaction_id', 'p.status', 'a.reference'])
        .where('p.workspace_id', '=', tenant.id)
        .where('p.rail', '=', 'mercury')
        .where('p.rail_ref', 'is not', null)
        .execute(),
    ]);
    return { payees, payments };
  });
  const payeeByInvite = new Map(refs.payees.map((p) => [p.invite_id, p]));
  const paymentByRequest = new Map(refs.payments.map((p) => [p.rail_ref, p]));
  const paymentByTx = new Map(refs.payments.filter((p) => p.rail_transaction_id).map((p) => [p.rail_transaction_id, p]));
  const recipients = new Map(state.recipients.map((r) => [r.id, r.name]));

  return (
    <>
      {header}
      <div className="flex flex-wrap items-start gap-3">
        <DevControl control={{ kind: 'seed' }} variant="default">
          Add demo accounts and sync
        </DevControl>
        <DevControl control={{ kind: 'reconcile' }}>Run nightly reconciliation now</DevControl>
        <Badge variant={conn.webhook_status === 'active' ? 'success' : 'warning'}>Webhook {conn.webhook_status}</Badge>
      </div>

      <Section title={`Accounts (${state.accounts.length})`}>
        {state.accounts.length ? (
          <Table containerLabel="Fake accounts" className="rounded-md border">
            <TableHeader>
              <TableRow>
                <TableHead>Account</TableHead>
                <TableHead className="text-right">Available</TableHead>
                <TableHead>Id</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {state.accounts.map((a) => (
                <TableRow key={a.id}>
                  <TableCell>
                    {a.name} ··{a.mask}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(a.availableCents)}</TableCell>
                  <TableCell>
                    <code className="text-xs">{a.id}</code>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="text-sm text-muted-foreground">No accounts yet. Add demo accounts to fund payments.</p>
        )}
      </Section>

      <Section title={`Recipient invites (${state.invites.length})`} description="There is no webhook for invites; completing one here and polling marks the GMS payee Ready.">
        <Table containerLabel="Fake recipient invites" className="rounded-md border">
          <TableHeader>
            <TableRow>
              <TableHead>Grantee (GMS)</TableHead>
              <TableHead>Contact</TableHead>
              <TableHead>Invite</TableHead>
              <TableHead>Payee in GMS</TableHead>
              <TableHead>Simulate</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {state.invites.map((i) => {
              const p = payeeByInvite.get(i.inviteId);
              return (
                <TableRow key={i.inviteId}>
                  <TableCell>{p?.legal_name ?? '—'}</TableCell>
                  <TableCell>{i.contactEmail}</TableCell>
                  <TableCell>
                    <Badge variant={i.status === 'completed' ? 'success' : i.status === 'expired' ? 'warning' : 'info'}>{i.status}</Badge>
                    <code className="ml-2 text-xs">{i.inviteId}</code>
                  </TableCell>
                  <TableCell>{p?.status.replace(/_/g, ' ') ?? '—'}</TableCell>
                  <TableCell>
                    {i.status === 'created' ? (
                      <span className="flex flex-wrap gap-2">
                        <DevControl control={{ kind: 'completeInvite', id: i.inviteId }}>Complete onboarding</DevControl>
                        <DevControl control={{ kind: 'expireInvite', id: i.inviteId }}>Expire</DevControl>
                        <Link className="self-center text-xs text-link underline" href={`/dev/mercury/invites/${i.inviteId}`}>
                          Grantee view
                        </Link>
                      </span>
                    ) : null}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Section>

      <Section title={`Send-money requests (${state.requests.length})`} description="In Mercury a person approves each request. Approving creates a pending transaction.">
        <Table containerLabel="Fake send-money requests" className="rounded-md border">
          <TableHeader>
            <TableRow>
              <TableHead>Payment (GMS)</TableHead>
              <TableHead>Recipient</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Request</TableHead>
              <TableHead>Simulate</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {state.requests.map((r) => {
              const p = paymentByRequest.get(r.requestId);
              return (
                <TableRow key={r.requestId}>
                  <TableCell>
                    {p ? (
                      <Link className="hover:underline" href={`/console/payments/${p.id}`}>
                        {p.reference} ({p.status.replace(/_/g, ' ')})
                      </Link>
                    ) : (
                      '—'
                    )}
                  </TableCell>
                  <TableCell>{recipients.get(r.recipientId) ?? r.recipientId}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(r.amountCents)}</TableCell>
                  <TableCell>
                    <Badge variant={r.status === 'approved' ? 'success' : r.status === 'pendingApproval' ? 'info' : 'warning'}>{r.status}</Badge>
                  </TableCell>
                  <TableCell>
                    {r.status === 'pendingApproval' ? (
                      <span className="flex flex-wrap gap-2">
                        <DevControl control={{ kind: 'approveRequest', id: r.requestId }}>Approve in Mercury</DevControl>
                        <DevControl control={{ kind: 'rejectRequest', id: r.requestId }} variant="destructive">
                          Reject
                        </DevControl>
                      </span>
                    ) : null}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Section>

      <Section title={`Transactions (${state.transactions.length})`} description="Settle or fail a transaction, then deliver the signed webhook (or let polling find it).">
        <Table containerLabel="Fake transactions" className="rounded-md border">
          <TableHeader>
            <TableRow>
              <TableHead>Payment (GMS)</TableHead>
              <TableHead>Counterparty</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Simulate</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {state.transactions.map((t) => {
              const p = paymentByTx.get(t.id);
              return (
                <TableRow key={t.id}>
                  <TableCell>
                    {p ? (
                      <Link className="hover:underline" href={`/console/payments/${p.id}`}>
                        {p.reference} ({p.status.replace(/_/g, ' ')})
                      </Link>
                    ) : (
                      <code className="text-xs">{t.id}</code>
                    )}
                  </TableCell>
                  <TableCell>{t.counterpartyName ?? '—'}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(t.amountCents)}</TableCell>
                  <TableCell>
                    <Badge variant={t.status === 'sent' ? 'success' : t.status === 'pending' ? 'info' : 'danger'}>{t.status}</Badge>
                  </TableCell>
                  <TableCell>
                    <span className="flex flex-wrap gap-2">
                      {t.status === 'pending' ? <DevControl control={{ kind: 'settleTransaction', id: t.id }}>Settle</DevControl> : null}
                      {t.status === 'pending' || t.status === 'sent' ? (
                        <DevControl control={{ kind: 'failTransaction', id: t.id }} variant="destructive">
                          Fail
                        </DevControl>
                      ) : null}
                      <DevControl control={{ kind: 'emitWebhook', eventType: 'transaction.updated', id: t.id }}>Send webhook</DevControl>
                    </span>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Section>

      <p className="text-xs text-muted-foreground">
        {state.events.length} bank event(s) recorded · {state.webhooks.length} webhook registration(s). Nothing here is real money.
      </p>
    </>
  );
}
