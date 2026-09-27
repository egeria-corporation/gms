// SPDX-License-Identifier: AGPL-3.0-only
// S-09 Insights → Exports (states: empty).
import { EmptyState, PageHeader } from '@gms/ui';
import { FileDown } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { AutoRefresh } from '@/components/console/admin/exports/auto-refresh';
import { ExportsTable, type ExportRow } from '@/components/console/admin/exports/exports-table';
import { requireStaff } from '@/lib/auth';
import { rls } from '@/lib/server/db';
import { forcedState } from '@/lib/site';
import { requireTenant } from '@/lib/tenant';

export const metadata: Metadata = { title: 'Exports' };

export default async function ExportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [tenant, viewer] = await Promise.all([
    requireTenant(),
    requireStaff(['owner', 'admin', 'program_officer', 'finance', 'auditor']),
  ]);
  const forced = forcedState(await searchParams);

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
      .orderBy('e.created_at', 'desc')
      .limit(100)
      .execute(),
  );

  const rows: ExportRow[] =
    forced === 'empty'
      ? []
      : rowsDb.map((r) => ({
          id: r.id,
          kind: r.kind,
          format: r.format,
          params:
            r.params && typeof r.params === 'object' && !Array.isArray(r.params)
              ? (r.params as Record<string, unknown>)
              : {},
          status: r.status,
          error: r.error,
          requestedBy: r.full_name ?? r.email,
          createdAt: r.created_at,
          completedAt: r.completed_at,
          downloadable: r.status === 'succeeded' && Boolean(r.file_path),
        }));
  const inProgress = rows.some((r) => r.status === 'queued' || r.status === 'running');
  const isAdmin = viewer.role === 'owner' || viewer.role === 'admin';

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Exports"
        description={`CSV, Excel and JSON files you (and, for admins and auditors, your team) have requested. Files are kept private to ${tenant.brand.displayName}. Times are in ${tenant.timezone}.`}
      />
      <AutoRefresh active={inProgress} />
      {rows.length ? (
        <ExportsTable rows={rows} timeZone={tenant.timezone} label="Exports" />
      ) : (
        <EmptyState
          icon={FileDown}
          title="No exports yet"
          description="Export a list from the pipeline, awards, payments or reports pages, or the 990-PF schedule from Compliance. Your files will be listed here when they’re ready."
          action={
            isAdmin ? (
              <Link
                href="/console/settings/export"
                className="text-sm font-medium text-link underline underline-offset-4"
              >
                Export the whole workspace
              </Link>
            ) : undefined
          }
        />
      )}
    </div>
  );
}
