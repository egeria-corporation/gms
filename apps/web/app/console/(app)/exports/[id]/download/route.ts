// SPDX-License-Identifier: AGPL-3.0-or-later
// Streams a finished export file. The console layout's guard doesn't run for route handlers, so this checks
// the tenant, a staff role (with MFA) and the export row under RLS before reading from storage.
import { getRuntime } from '@gms/actions';
import { MFA_REQUIRED_ROLES, type WorkspaceRole } from '@gms/domain';
import { getViewer } from '@/lib/auth';
import { rls } from '@/lib/server/db';
import { getTenant } from '@/lib/tenant';

const STAFF: readonly WorkspaceRole[] = ['owner', 'admin', 'program_officer', 'finance', 'auditor'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CONTENT_TYPES: Record<string, string> = {
  csv: 'text/csv; charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  json: 'application/json; charset=utf-8',
  zip: 'application/zip',
  pdf: 'application/pdf',
};

const notFound = () =>
  new Response('Not found', { status: 404, headers: { 'cache-control': 'private, no-store' } });

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const tenant = await getTenant();
  if (!tenant || tenant.status !== 'active') return notFound();
  const viewer = await getViewer();
  if (!viewer)
    return new Response('Sign in to download this file.', {
      status: 401,
      headers: { 'cache-control': 'private, no-store' },
    });
  if (!viewer.role || !STAFF.includes(viewer.role)) return notFound();
  const member = viewer.memberships.find((m) => m.workspaceId === tenant.id);
  if (
    MFA_REQUIRED_ROLES.includes(viewer.role) &&
    (member?.mfaRequired ?? true) &&
    viewer.session.aal !== 'aal2'
  ) {
    return new Response('Verify with your authenticator app first.', {
      status: 403,
      headers: { 'cache-control': 'private, no-store' },
    });
  }
  if (!UUID.test(id)) return notFound();

  const ex = await rls((trx) =>
    trx
      .selectFrom('exports')
      .select(['kind', 'format', 'status', 'file_path', 'completed_at', 'created_at'])
      .where('id', '=', id)
      .where('workspace_id', '=', tenant.id)
      .executeTakeFirst(),
  );
  if (!ex || ex.status !== 'succeeded' || !ex.file_path) return notFound();

  const bytes = await getRuntime().adapters.storage.get('exports', ex.file_path);
  if (!bytes) return notFound();

  const ext = (/\.([a-z0-9]+)$/i.exec(ex.file_path)?.[1] ?? ex.format).toLowerCase();
  const contentType = CONTENT_TYPES[ext] ?? 'application/octet-stream';
  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone: tenant.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(ex.completed_at ?? ex.created_at));
  const kind = ex.kind.replace(/[^a-z0-9_-]/gi, '').replace(/_/g, '-') || 'export';
  const safeExt = /^[a-z0-9]{1,5}$/.test(ext) ? ext : 'bin';

  return new Response(Buffer.from(bytes), {
    headers: {
      'content-type': contentType,
      'content-disposition': `attachment; filename="${kind}-${date}.${safeExt}"`,
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}
