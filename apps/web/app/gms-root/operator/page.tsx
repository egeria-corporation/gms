// SPDX-License-Identifier: AGPL-3.0-only
// G-01 Operator: tenants (states: empty). Multi-tenant mode only; platform operators only.
import { originFor } from '@gms/actions';
import {
  DeniedState,
  EmptyState,
  PageHeader,
  Section,
  StatTile,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  ToneChip,
  formatBytes,
} from '@gms/ui';
import { Activity } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { forcedState } from '@/lib/site';
import { formatDateTime, healthLevel, listTenants, operatorGate, platformHealth, relativeAge } from './data';
import { HEALTH_CHIP, WorkspaceStatusChip } from './ui';

export const metadata: Metadata = { title: 'Operator console' };

export default async function OperatorTenantsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const state = forcedState(await searchParams);
  const { isOperator } = await operatorGate('/operator');
  if (!isOperator) {
    return (
      <div className="py-10">
        <DeniedState
          title="The operator console is for platform operators"
          description="You’re signed in, but your account isn’t a platform operator on this GMS. If you work at a foundation, sign in on your foundation’s own site."
        />
      </div>
    );
  }
  const [tenants, health] = await Promise.all([state === 'empty' ? Promise.resolve([]) : listTenants(), platformHealth()]);
  const level = healthLevel(health);
  const chip = HEALTH_CHIP[level];
  return (
    <div className="grid gap-8 py-8">
      <PageHeader title="Operator console" description="Every foundation on this GMS, their usage, and background job health. Tenant data needs a time-boxed grant from the workspace." />

      <section aria-label="Platform health" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Workspaces" value={tenants.length} footnote={`${tenants.filter((t) => t.status === 'active').length} active`} />
        <StatTile label="Last worker tick" value={relativeAge(health.lastTickAt)} footnote={formatDateTime(health.lastTickAt)} />
        <StatTile label="Outbox backlog" value={health.backlog} footnote={health.oldestPendingAt ? `Oldest waiting since ${relativeAge(health.oldestPendingAt)}` : 'Nothing waiting'} />
        <StatTile label="Background jobs" value={<ToneChip tone={chip.tone} icon={chip.icon} label={chip.label} />} footnote={health.failing ? `${health.failing} event(s) retrying after errors` : 'No errors'} />
      </section>

      <Section title="Tenants" description="Usage counts only. Open a tenant for flags, plan, migrations and support access.">
        {tenants.length === 0 ? (
          <EmptyState
            title="No workspaces yet"
            description="When a foundation is set up (with the setup wizard or `pnpm run setup`), it appears here."
            action={
              <Link className="text-link underline underline-offset-2" href="/setup">
                Open the setup wizard
              </Link>
            }
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Foundation</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead className="text-right">Applications</TableHead>
                <TableHead className="text-right">Awards</TableHead>
                <TableHead className="text-right">Active members</TableHead>
                <TableHead className="text-right">Storage</TableHead>
                <TableHead>Jobs</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tenants.map((t) => {
                const h = HEALTH_CHIP[healthLevel(t.health)];
                return (
                  <TableRow key={t.id}>
                    <TableCell>
                      <Link href={`/operator/${t.id}`} className="font-medium text-link underline-offset-2 hover:underline">
                        {t.displayName}
                      </Link>
                      <div className="font-mono text-xs text-muted-foreground">{originFor(t.slug).replace(/^https?:\/\//, '')}</div>
                    </TableCell>
                    <TableCell>
                      <WorkspaceStatusChip status={t.status} />
                    </TableCell>
                    <TableCell>
                      <span className="capitalize">{t.plan.replace(/_/g, ' ')}</span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{t.applications.toLocaleString('en-US')}</TableCell>
                    <TableCell className="text-right tabular-nums">{t.awards.toLocaleString('en-US')}</TableCell>
                    <TableCell className="text-right tabular-nums">{t.activeMembers.toLocaleString('en-US')}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatBytes(t.storageBytes)}
                      <div className="text-xs text-muted-foreground">{t.attachments.toLocaleString('en-US')} files</div>
                    </TableCell>
                    <TableCell>
                      <ToneChip tone={h.tone} icon={h.icon} label={h.label} size="sm" />
                      <div className="text-xs text-muted-foreground">{t.health.backlog ? `${t.health.backlog} waiting` : `Last ${relativeAge(t.health.lastProcessedAt)}`}</div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{formatDateTime(t.createdAt, { dateStyle: 'medium' })}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Section>
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Activity className="size-3.5" aria-hidden="true" /> Job health comes from the transactional outbox: events waiting to be processed by the worker.
      </p>
    </div>
  );
}
