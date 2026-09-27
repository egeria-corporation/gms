// SPDX-License-Identifier: AGPL-3.0-only
// G-02 Operator: tenant detail (states: no-access, access-granted). Multi-tenant mode only; platform operators only.
// Tenant data is shown only while the workspace has granted this operator time-boxed support access, and
// every render of that panel is recorded in the tenant's audit log (operator.record_view).
import { getRuntime, originFor, type WorkspaceRef } from '@gms/actions';
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DeniedState,
  DescriptionList,
  EmptyState,
  PageHeader,
  Section,
  StatTile,
  StatusChip,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  ToneChip,
  formatBytes,
} from '@gms/ui';
import { ExternalLink, LockKeyhole, ShieldCheck } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { NextLink } from '@/components/next-link';
import { forcedState } from '@/lib/site';
import {
  KNOWN_FLAGS,
  activeGrant,
  appliedMigrations,
  formatDateTime,
  healthLevel,
  listTenants,
  operatorGate,
  readTenantPanel,
  relativeAge,
  type MigrationRow,
  type SupportGrant,
  type TenantPanelData,
  type TenantRow,
} from '../data';
import { HEALTH_CHIP, WorkspaceStatusChip } from '../ui';
import { TenantControls, type FlagRow } from './tenant-controls';

export const metadata: Metadata = { title: 'Tenant detail' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Params = Promise<{ id: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function OperatorTenantPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const state = forcedState(sp);
  const { viewer, isOperator } = await operatorGate(`/operator/${id}`);
  if (!isOperator) {
    return (
      <div className="py-10">
        <DeniedState title="The operator console is for platform operators" description="Your account isn’t a platform operator on this GMS." />
      </div>
    );
  }

  // `/operator/preview?state=…` renders fictional data (dev tools only) so every state can be reviewed without a tenant.
  const preview = id === 'preview' && state !== null;
  let tenant: TenantRow;
  let rawFlags: Record<string, unknown> = {};
  let timezone = 'America/Denver';
  if (preview) {
    tenant = PREVIEW_TENANT;
    rawFlags = { agents_beta: true, setup_payments_fake: true };
  } else {
    if (!UUID.test(id)) notFound();
    const [row] = await listTenants(id);
    if (!row) notFound();
    tenant = row;
    const w = await getRuntime().db.selectFrom('workspaces').select(['feature_flags', 'timezone']).where('id', '=', id).executeTakeFirst();
    rawFlags = (w?.feature_flags ?? {}) as Record<string, unknown>;
    timezone = w?.timezone ?? timezone;
  }

  const flags: FlagRow[] = [
    ...KNOWN_FLAGS.map((f) => ({ ...f, value: rawFlags[f.key] === true })),
    ...Object.entries(rawFlags)
      .filter(([k, v]) => typeof v === 'boolean' && !KNOWN_FLAGS.some((f) => f.key === k))
      .map(([k, v]) => ({ key: k, label: k.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()), description: k.startsWith('setup_payments_') ? 'Recorded by setup.' : 'Custom flag.', value: v === true })),
  ];

  const migrations = await appliedMigrations();

  // Support access: a real grant for this operator, or the forced preview states.
  const ws: WorkspaceRef = { id: tenant.id, slug: tenant.slug, name: tenant.name, timezone };
  let grant: SupportGrant | null = null;
  let panel: TenantPanelData | null = null;
  let panelError = false;
  if (state !== 'no-access') {
    grant = preview ? null : await activeGrant(tenant.id, viewer.userId);
    if (grant) {
      try {
        panel = await readTenantPanel(ws, viewer, grant);
      } catch (err) {
        console.error('[operator] support panel failed', (err as Error).message);
        panelError = true;
      }
    } else if (state === 'access-granted') {
      grant = PREVIEW_GRANT;
      panel = PREVIEW_PANEL;
    }
  }

  const h = HEALTH_CHIP[healthLevel(tenant.health)];
  const origin = originFor(tenant.slug);

  return (
    <div className="grid gap-8 py-8">
      <PageHeader
        title={tenant.displayName}
        description={`Workspace ${tenant.slug} · created ${formatDateTime(tenant.createdAt, { dateStyle: 'medium' })}`}
        breadcrumbs={[{ label: 'Operator console', href: '/operator' }, { label: tenant.displayName }]}
        linkComponent={NextLink}
        meta={<WorkspaceStatusChip status={tenant.status} />}
        actions={
          <Button asChild variant="secondary">
            <a href={origin} target="_blank" rel="noreferrer">
              Open public site <ExternalLink aria-hidden="true" />
            </a>
          </Button>
        }
      />

      <section aria-label="Usage" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Applications" value={tenant.applications.toLocaleString('en-US')} />
        <StatTile label="Awards" value={tenant.awards.toLocaleString('en-US')} />
        <StatTile label="Active members" value={tenant.activeMembers.toLocaleString('en-US')} />
        <StatTile label="Storage" value={formatBytes(tenant.storageBytes)} footnote={`${tenant.attachments.toLocaleString('en-US')} files`} />
      </section>

      <div className="grid gap-8 lg:grid-cols-[2fr_1fr] lg:items-start">
        <div className="grid gap-8">
          <Section title="Support access" description="Operators see tenant data only while a workspace admin has granted time-boxed access. Every view is written to the workspace’s audit log.">
            {grant && panel ? (
              <div className="grid gap-5">
                <Alert variant="success" title="Support access granted" icon={<ShieldCheck aria-hidden="true" />}>
                  <p>
                    Granted by {grant.grantedByName ?? grant.grantedByEmail ?? 'a workspace admin'}
                    {grant.grantedByEmail && grant.grantedByName ? ` (${grant.grantedByEmail})` : ''} on {formatDateTime(grant.createdAt)}. Expires {formatDateTime(grant.expiresAt)}.
                  </p>
                  <p className="mt-1">Reason: “{grant.reason}”</p>
                  <p className="mt-1 text-sm">This view was just recorded in {tenant.displayName}’s audit log. Read-only.</p>
                </Alert>
                <TenantPanel panel={panel} />
              </div>
            ) : panelError ? (
              <Alert variant="danger" title="Couldn’t record this view">
                Tenant data is only shown after the view is written to the audit log, and that failed. Try again in a minute.
              </Alert>
            ) : (
              <EmptyState
                icon={LockKeyhole}
                title="No support access"
                description="A workspace admin can grant time-boxed access from their console (Settings → Workspace → Support access). Until then, you can see usage counts and platform settings only."
              />
            )}
          </Section>

          <Section title="Workspace controls" description="Feature flags, status and plan. Changes are audited in the workspace’s log with your name.">
            <TenantControls workspaceId={tenant.id} name={tenant.displayName} flags={flags} status={tenant.status} plan={tenant.plan} readOnly={preview} />
          </Section>
        </div>

        <div className="grid gap-6">
          <Card>
            <CardHeader>
              <CardTitle as="h2">Summary</CardTitle>
            </CardHeader>
            <CardContent>
              <DescriptionList
                layout="stacked"
                items={[
                  { term: 'Web address', detail: <span className="font-mono text-sm">{origin.replace(/^https?:\/\//, '')}</span> },
                  { term: 'Legal name', detail: tenant.name },
                  { term: 'Time zone', detail: timezone },
                  { term: 'Background jobs', detail: <ToneChip tone={h.tone} icon={h.icon} label={`${h.label}${tenant.health.backlog ? ` · ${tenant.health.backlog} waiting` : ''}`} size="sm" /> },
                  { term: 'Last processed event', detail: relativeAge(tenant.health.lastProcessedAt) },
                ]}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle as="h2">Billing</CardTitle>
              <CardDescription>Billing is a stub in v1: plans are recorded, nothing is charged.</CardDescription>
            </CardHeader>
            <CardContent>
              <DescriptionList
                layout="stacked"
                items={[
                  { term: 'Plan', detail: <span className="capitalize">{tenant.plan.replace(/_/g, ' ')}</span> },
                  { term: 'Subscription', detail: <span className="capitalize">{tenant.billingStatus.replace(/_/g, ' ')}</span> },
                  { term: 'Provider', detail: 'Stub (no payment processor connected)' },
                ]}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle as="h2">Database migrations</CardTitle>
              <CardDescription>Platform-wide: every workspace shares one schema.</CardDescription>
            </CardHeader>
            <CardContent>
              <Migrations rows={migrations} />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Migrations({ rows }: { rows: MigrationRow[] | null }) {
  if (rows === null) {
    return <p className="text-sm text-muted-foreground">No migration history found (gms_meta.schema_migrations is missing). Run `pnpm db:migrate`.</p>;
  }
  if (!rows.length) return <p className="text-sm text-muted-foreground">No migrations recorded yet.</p>;
  return (
    <div className="grid gap-2">
      <p className="text-sm">
        {rows.length} applied · latest <span className="font-mono">{rows[0]!.version}</span> on {formatDateTime(rows[0]!.appliedAt, { dateStyle: 'medium' })}
      </p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Version</TableHead>
            <TableHead>Applied</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.slice(0, 8).map((m) => (
            <TableRow key={m.version}>
              <TableCell>
                <span className="font-mono text-xs">{m.version}</span>
                <div className="text-xs text-muted-foreground">{m.name}</div>
              </TableCell>
              <TableCell className="whitespace-nowrap text-xs">{formatDateTime(m.appliedAt, { dateStyle: 'medium' })}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function TenantPanel({ panel }: { panel: TenantPanelData }) {
  return (
    <div className="grid gap-6">
      <section aria-labelledby="support-apps-title" className="grid gap-2">
        <h3 id="support-apps-title" className="text-base font-semibold">
          Applications by status
        </h3>
        {panel.applicationsByStatus.length ? (
          <ul className="flex flex-wrap gap-3">
            {panel.applicationsByStatus.map((r) => (
              <li key={r.status} className="flex items-center gap-2 rounded-md border px-3 py-2">
                <StatusChip kind="application" value={r.status} size="sm" />
                <span className="font-semibold tabular-nums">{r.n.toLocaleString('en-US')}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No applications yet.</p>
        )}
      </section>
      <section aria-labelledby="support-audit-title" className="grid gap-2">
        <h3 id="support-audit-title" className="text-base font-semibold">
          Recent audit entries
        </h3>
        {panel.audit.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Who</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Record</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {panel.audit.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="whitespace-nowrap text-xs">{formatDateTime(a.occurredAt)}</TableCell>
                  <TableCell>
                    {a.actor}
                    <div className="text-xs capitalize text-muted-foreground">{a.actorType}</div>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{a.action}</TableCell>
                  <TableCell className="text-xs">{a.entity ?? '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="text-sm text-muted-foreground">No audit entries yet.</p>
        )}
      </section>
    </div>
  );
}

// Fictional preview data (dev tools only) -------------------------------------------------------------------
const PREVIEW_TENANT: TenantRow = {
  id: '00000000-0000-4000-8000-000000000001',
  slug: 'juniper-valley',
  name: 'Juniper Valley Community Fund',
  displayName: 'Juniper Valley Community Fund',
  status: 'active',
  plan: 'self_hosted',
  billingStatus: 'active',
  createdAt: '2026-08-14T16:20:00.000Z',
  applications: 148,
  awards: 37,
  activeMembers: 9,
  attachments: 412,
  storageBytes: 734_003_200,
  health: { backlog: 0, oldestPendingAt: null, lastProcessedAt: '2026-09-27T15:58:00.000Z', failing: 0 },
};

const PREVIEW_GRANT: SupportGrant = {
  id: '00000000-0000-4000-8000-000000000002',
  reason: 'Payment batch 2026-09 shows one payee stuck in “processing”; please check the rail sync.',
  createdAt: '2026-09-27T14:05:00.000Z',
  expiresAt: '2026-09-28T14:05:00.000Z',
  grantedByName: 'Rosa Delgado',
  grantedByEmail: 'rosa@juniperfund.example',
};

const PREVIEW_PANEL: TenantPanelData = {
  applicationsByStatus: [
    { status: 'in_progress', n: 31 },
    { status: 'submitted', n: 46 },
    { status: 'under_review', n: 22 },
    { status: 'awarded', n: 37 },
    { status: 'declined', n: 12 },
  ],
  audit: [
    { id: 'a1', occurredAt: '2026-09-27T14:05:00.000Z', actor: 'Rosa Delgado', actorType: 'human', action: 'operator.grant_support_access', entity: 'support_access_grant' },
    { id: 'a2', occurredAt: '2026-09-27T13:41:00.000Z', actor: 'Lena Park', actorType: 'human', action: 'payments.approve_batch', entity: 'payment_batch' },
    { id: 'a3', occurredAt: '2026-09-27T13:02:00.000Z', actor: 'System', actorType: 'system', action: 'payments.sync_rail', entity: 'payment' },
    { id: 'a4', occurredAt: '2026-09-26T21:17:00.000Z', actor: 'Marcus Webb', actorType: 'human', action: 'applications.record_decision', entity: 'application' },
  ],
};
