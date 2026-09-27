// SPDX-License-Identifier: AGPL-3.0-only
// CM-01 Email templates (states: empty).
import { Button, Card, EmptyState, PageHeader, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@gms/ui';
import { Plus } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { formatDateTime } from '@/components/console/admin/comms/meta';
import { NextLink } from '@/components/next-link';
import { requireStaff } from '@/lib/auth';
import { rls } from '@/lib/server/db';
import { forcedState } from '@/lib/site';
import { requireTenant } from '@/lib/tenant';

export const metadata: Metadata = { title: 'Email templates' };

export default async function TemplatesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [tenant, viewer] = await Promise.all([requireTenant(), requireStaff(['owner', 'admin', 'program_officer', 'auditor'])]);
  const forced = forcedState(await searchParams);
  const canEdit = viewer.role !== 'auditor';
  const rows =
    forced === 'empty'
      ? []
      : await rls((trx) =>
          trx
            .selectFrom('email_templates as t')
            .leftJoin('profiles as p', 'p.id', 't.updated_by')
            .select(['t.id', 't.key', 't.name', 't.subject', 't.last_modified_at', 'p.full_name'])
            .where('t.workspace_id', '=', tenant.id)
            .orderBy('t.name')
            .execute(),
        );

  const newButton = canEdit ? (
    <Button asChild>
      <Link href="/console/comms/templates/new">
        <Plus aria-hidden="true" />
        New template
      </Link>
    </Button>
  ) : null;

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Email templates"
        description="Reusable messages with merge fields like {{applicant.first_name}}. Every email goes out in your branding."
        breadcrumbs={[{ label: 'Messages & email', href: '/console/comms' }, { label: 'Templates' }]}
        linkComponent={NextLink}
        actions={newButton}
      />
      {rows.length ? (
        <Card>
          <Table containerLabel="Email templates">
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Key</TableHead>
                <TableHead>Subject</TableHead>
                <TableHead>Last updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="font-medium">
                    <Link href={`/console/comms/templates/${t.key}`} className="hover:underline">
                      {t.name}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{t.key}</code>
                  </TableCell>
                  <TableCell className="max-w-md truncate text-muted-foreground">{t.subject}</TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {formatDateTime(t.last_modified_at, tenant.timezone)}
                    {t.full_name ? <span className="block text-xs">by {t.full_name}</span> : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      ) : (
        <Card>
          <EmptyState
            title="No templates yet"
            description="Save messages you send often, like info-session invites or report reminders, so your team can reuse them."
            action={newButton}
          />
        </Card>
      )}
    </div>
  );
}
