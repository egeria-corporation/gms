// SPDX-License-Identifier: AGPL-3.0-or-later
// P-08 Bank connection: provider choice (Mercury token mode, fake/sandbox; OAuth pending partner approval;
// or pay outside GMS), account → program mapping, webhook status.
// ?state= (non-production): not-connected · connected · webhook-failing · error
import { formatInZone } from '@gms/domain';
import { Alert, Card, CardContent, CardHeader, CardTitle, DeniedState, DescriptionList, ErrorState, PageHeader, ToneChip } from '@gms/ui';
import { CircleAlert, CircleCheck, CircleMinus, ShieldCheck } from 'lucide-react';
import type { Metadata } from 'next';
import { ConnectBankForm, ProgramAccountMapping, type MappingAccount, type MappingProgram } from '@/components/console/finance/connect-bank';
import { can, FINANCE_READ, FINANCE_WRITE, type SearchParams } from '@/components/console/finance/params';
import { SyncBalancesButton } from '@/components/console/finance/sync-button';
import { NextLink } from '@/components/next-link';
import { requireStaff } from '@/lib/auth';
import { rls } from '@/lib/server/db';
import { forcedState } from '@/lib/site';
import { requireTenant } from '@/lib/tenant';

export const metadata: Metadata = { title: 'Bank connection' };

function WebhookChip({ status }: { status: string }) {
  if (status === 'active') return <ToneChip tone="success" icon={CircleCheck} label="Receiving webhooks" />;
  if (status === 'failing') return <ToneChip tone="danger" icon={CircleAlert} label="Webhook failing — polling instead" />;
  return <ToneChip tone="muted" icon={CircleMinus} label="No webhook" />;
}

export default async function ConnectPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const [tenant, viewer] = await Promise.all([requireTenant(), requireStaff(FINANCE_READ)]);
  const forced = forcedState(await searchParams);
  const header = (
    <PageHeader
      title="Bank connection"
      breadcrumbs={[{ label: 'Payments', href: '/console/payments' }, { label: 'Bank connection' }]}
      linkComponent={NextLink}
      description="GMS never holds funds and never stores bank account numbers. Payments leave your own account only after approval in GMS and in Mercury."
    />
  );
  if (forced === 'error') {
    return (
      <div className="grid gap-6">
        {header}
        <ErrorState title="We couldn’t load the bank connection" description="Nothing was changed. Refresh to try again." />
      </div>
    );
  }
  const d = await rls(async (trx) => {
    const conn = await trx
      .selectFrom('bank_connections as c')
      .leftJoin('profiles as u', 'u.id', 'c.connected_by')
      .select(['c.id', 'c.provider', 'c.mode', 'c.environment', 'c.webhook_status', 'c.status', 'c.last_synced_at', 'c.created_at', 'u.full_name'])
      .where('c.workspace_id', '=', tenant.id)
      .where('c.status', '!=', 'disconnected')
      .orderBy('c.created_at', 'desc')
      .executeTakeFirst();
    const [accounts, programs, mappings] = await Promise.all([
      conn ? trx.selectFrom('bank_accounts').select(['id', 'name', 'mask', 'available_cents']).where('connection_id', '=', conn.id).orderBy('name').execute() : Promise.resolve([]),
      trx.selectFrom('programs').select(['id', 'name']).where('workspace_id', '=', tenant.id).where('status', '!=', 'archived').orderBy('name').execute(),
      trx.selectFrom('program_accounts').select(['program_id', 'bank_account_id']).where('workspace_id', '=', tenant.id).where('is_default', '=', true).execute(),
    ]);
    return { conn, accounts, programs, mappings };
  });
  const conn = forced === 'not-connected' ? undefined : d.conn;
  const webhookStatus = forced === 'webhook-failing' ? 'failing' : (conn?.webhook_status ?? 'none');
  const writer = can(viewer.role, FINANCE_WRITE);
  const accounts: MappingAccount[] = d.accounts.map((a) => ({ id: a.id, name: a.name, mask: a.mask, availableCents: a.available_cents }));
  const programs: MappingProgram[] = d.programs.map((p) => ({ id: p.id, name: p.name, bankAccountId: d.mappings.find((m) => m.program_id === p.id)?.bank_account_id ?? null }));

  return (
    <div className="grid gap-6">
      {header}
      {conn ? (
        <Card>
          <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
            <CardTitle as="h2" className="text-base">
              Current connection
            </CardTitle>
            {conn.provider === 'mercury' && writer ? <SyncBalancesButton /> : null}
          </CardHeader>
          <CardContent className="grid gap-4">
            <DescriptionList
              layout="grid"
              columns={3}
              items={[
                { term: 'Provider', detail: conn.provider === 'manual' ? 'Pay outside GMS' : `Mercury (${conn.mode === 'oauth' ? 'OAuth' : 'API token'})` },
                { term: 'Environment', detail: conn.provider === 'manual' ? '—' : conn.environment === 'fake' ? 'Simulated bank' : conn.environment === 'sandbox' ? 'Mercury sandbox' : 'Production' },
                { term: 'Connection', detail: <ToneChip tone={conn.status === 'connected' ? 'success' : 'danger'} icon={conn.status === 'connected' ? CircleCheck : CircleAlert} label={conn.status === 'connected' ? 'Connected' : 'Error'} size="sm" /> },
                { term: 'Webhook', detail: conn.provider === 'manual' ? '—' : <WebhookChip status={webhookStatus} /> },
                { term: 'Last balance refresh', detail: conn.last_synced_at ? formatInZone(conn.last_synced_at, tenant.timezone) : null },
                { term: 'Connected by', detail: `${conn.full_name ?? 'A teammate'} · ${formatInZone(conn.created_at, tenant.timezone, { dateOnly: true })}` },
              ]}
            />
            {webhookStatus === 'failing' ? (
              <Alert variant="warning" title="Mercury can’t reach GMS">
                We couldn’t register the webhook. GMS still checks Mercury every five minutes, so payments keep updating — just less quickly. Reconnect to try again.
              </Alert>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle as="h2" className="text-base">
            {conn ? 'Change how you pay' : 'Connect your bank'}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {writer ? (
            <ConnectBankForm connected={conn ? { provider: conn.provider, environment: conn.environment } : null} oauthPreview={Boolean(tenant.flags.mercury_oauth)} />
          ) : (
            <DeniedState variant="inline" level={3} title="Only finance admins and owners can connect the bank" description="Ask a workspace owner or a finance admin." />
          )}
        </CardContent>
      </Card>

      {conn?.provider === 'mercury' ? (
        <Card>
          <CardHeader>
            <CardTitle as="h2" className="text-base">
              Which account pays each program
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ProgramAccountMapping programs={programs} accounts={accounts} canWrite={writer} />
          </CardContent>
        </Card>
      ) : null}

      <Alert variant="info" icon={<ShieldCheck aria-hidden="true" />} title="How GMS keeps money safe">
        Every batch is approved in GMS by someone other than the person who built it, large batches need a second approver, and each payment is then approved again by a person in Mercury. AI agents can propose batches but can never approve payments or change the bank.
      </Alert>
    </div>
  );
}
