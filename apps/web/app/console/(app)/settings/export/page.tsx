// SPDX-License-Identifier: AGPL-3.0-or-later
// S-09 Workspace export (states: running, empty).
import { Card, CardContent, EmptyState, PageHeader, Section } from '@gms/ui';
import { Archive, FileJson, FolderArchive, Globe2 } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { SettingsTabs } from '@/components/console/admin/settings-tabs';
import { AutoRefresh } from '@/components/console/admin/exports/auto-refresh';
import { ExportsTable, type ExportRow } from '@/components/console/admin/exports/exports-table';
import { RequestWorkspaceExport } from '@/components/console/admin/exports/request-export';
import { requireStaff } from '@/lib/auth';
import { rls } from '@/lib/server/db';
import { forcedState } from '@/lib/site';
import { requireTenant } from '@/lib/tenant';

export const metadata: Metadata = { title: 'Workspace export' };

export default async function WorkspaceExportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [tenant, viewer] = await Promise.all([requireTenant(), requireStaff(['owner', 'admin', 'auditor'])]);
  const forced = forcedState(await searchParams);
  const canRequest = viewer.role === 'owner' || viewer.role === 'admin';

  const rowsDb = await rls((trx) =>
    trx
      .selectFrom('exports as e')
      .leftJoin('profiles as p', 'p.id', 'e.requested_by')
      .select([
        'e.id',
        'e.kind',
        'e.format',
        'e.params',
        'e.status',
        'e.error',
        'e.file_path',
        'e.created_at',
        'e.completed_at',
        'p.full_name',
        'p.email',
      ])
      .where('e.workspace_id', '=', tenant.id)
      .where('e.kind', '=', 'workspace')
      .orderBy('e.created_at', 'desc')
      .limit(25)
      .execute(),
  );

  let rows: ExportRow[] = rowsDb.map((r) => ({
    id: r.id,
    kind: r.kind,
    format: r.format,
    params: {},
    status: r.status,
    error: r.error,
    requestedBy: r.full_name ?? r.email,
    createdAt: r.created_at,
    completedAt: r.completed_at,
    downloadable: r.status === 'succeeded' && Boolean(r.file_path),
  }));
  if (forced === 'empty') rows = [];
  if (forced === 'running' && !rows.some((r) => r.status === 'running' || r.status === 'queued')) {
    rows = [
      {
        id: '00000000-0000-4000-8000-0000000e0001',
        kind: 'workspace',
        format: 'zip',
        params: {},
        status: 'running',
        error: null,
        requestedBy: viewer.name,
        createdAt: new Date(Date.now() - 90_000).toISOString(),
        completedAt: null,
        downloadable: false,
      },
      ...rows,
    ];
  }
  const inProgress = rows.some((r) => r.status === 'queued' || r.status === 'running');

  return (
    <div className="grid gap-8">
      <PageHeader
        title="Workspace export"
        description="Take everything with you. Your data is yours, in open formats, whenever you want it."
      />
      <SettingsTabs current="/console/settings/export" />

      <Section title="What’s in a full export" card>
        <div className="grid gap-5">
          <ul className="grid gap-4 md:grid-cols-3">
            <li className="flex gap-3">
              <FileJson aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
              <span className="text-sm">
                <span className="block font-medium">Raw tables</span>
                <span className="text-muted-foreground">
                  <code className="font-mono text-xs">gms/*.json</code>: programs, opportunities, forms,
                  applications, reviews, decisions, awards, payments, reports, messages and the audit log.
                </span>
              </span>
            </li>
            <li className="flex gap-3">
              <Globe2 aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
              <span className="text-sm">
                <span className="block font-medium">CommonGrants bundle</span>
                <span className="text-muted-foreground">
                  <code className="font-mono text-xs">commongrants/*.json</code>: your opportunities in the
                  open CommonGrants format other systems can import.
                </span>
              </span>
            </li>
            <li className="flex gap-3">
              <FolderArchive aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
              <span className="text-sm">
                <span className="block font-medium">One zip file</span>
                <span className="text-muted-foreground">
                  With a README. Bank account numbers and secrets are never included.
                </span>
              </span>
            </li>
          </ul>
          {canRequest ? (
            <RequestWorkspaceExport
              disabledReason={
                inProgress
                  ? 'An export is already being prepared. You can request another when it finishes.'
                  : null
              }
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              Only owners and admins can request a full workspace export.
            </p>
          )}
          <p className="text-sm text-muted-foreground">
            Need a spreadsheet of one dataset instead? Use{' '}
            <Link href="/console/exports" className="text-link underline underline-offset-4">
              Insights → Exports
            </Link>
            .
          </p>
        </div>
      </Section>

      <Section title="Past workspace exports" description={`Times are in ${tenant.timezone}.`}>
        <AutoRefresh active={inProgress && forced !== 'running'} />
        {forced === 'running' ? (
          <p className="text-sm text-muted-foreground" role="status">
            Exports in progress. This list updates by itself every few seconds; we’ll also notify you when
            they’re ready.
          </p>
        ) : null}
        {rows.length ? (
          <ExportsTable
            rows={rows}
            timeZone={tenant.timezone}
            showKind={false}
            label="Past workspace exports"
          />
        ) : (
          <Card>
            <CardContent className="pt-6">
              <EmptyState
                level={3}
                icon={Archive}
                title="No workspace exports yet"
                description={
                  canRequest
                    ? 'Request one above. Large workspaces can take a few minutes.'
                    : 'When an owner or admin requests one, it appears here.'
                }
              />
            </CardContent>
          </Card>
        )}
      </Section>
    </div>
  );
}
