// SPDX-License-Identifier: AGPL-3.0-only
// Operator console reads (G-01, G-02). Root host, no tenant: these use the service connection, so every caller
// must first check the viewer is a platform operator (operatorGate). Tenant data (beyond platform metadata and
// usage counts) is only read while an active support-access grant exists, and each view is audited.
import 'server-only';
import { getRuntime, systemContext, type WorkspaceRef } from '@gms/actions';
import { sql } from '@gms/db';
import { notFound, redirect } from 'next/navigation';
import { getViewer, type Viewer } from '@/lib/auth';
import { config } from '@/lib/config';

export const KNOWN_FLAGS: { key: string; label: string; description: string }[] = [
  { key: 'sso_enabled', label: 'Single sign-on (SSO)', description: 'Staff can sign in with the foundation’s identity provider.' },
  { key: 'mercury_oauth', label: 'Mercury OAuth connect', description: 'Connect Mercury with OAuth instead of pasting an API token.' },
  { key: 'direct_send_stub', label: 'Direct send (stub)', description: 'Show the direct-send payment option backed by the stub rail.' },
  { key: 'agents_beta', label: 'AI agents beta', description: 'Early access to new agent tools and policies.' },
];

/** Multi-tenant only; signed-in operators get their Viewer, others get null (render a DeniedState). */
export async function operatorGate(next: string): Promise<{ viewer: Viewer; isOperator: boolean }> {
  if (config.mode !== 'multi') notFound();
  const viewer = await getViewer();
  if (!viewer) redirect(`/sign-in?next=${encodeURIComponent(next)}`);
  // Operators see every tenant's metadata: require a fresh two-step check (aal2) like staff.
  if (viewer.isOperator && viewer.session.aal !== 'aal2') redirect(`/mfa?next=${encodeURIComponent(next)}`);
  return { viewer, isOperator: viewer.isOperator };
}

export interface TenantHealth {
  backlog: number;
  oldestPendingAt: string | null;
  lastProcessedAt: string | null;
  failing: number;
}

export interface TenantRow {
  id: string;
  slug: string;
  name: string;
  displayName: string;
  status: string;
  plan: string;
  billingStatus: string;
  createdAt: string;
  applications: number;
  awards: number;
  activeMembers: number;
  attachments: number;
  storageBytes: number;
  health: TenantHealth;
}

function countMap(rows: { workspace_id: string | null; n: number | string | bigint }[]): Map<string, number> {
  return new Map(rows.filter((r) => r.workspace_id).map((r) => [r.workspace_id as string, Number(r.n)]));
}

export async function listTenants(onlyId?: string): Promise<TenantRow[]> {
  const rt = getRuntime();
  const db = rt.db;
  let wq = db
    .selectFrom('workspaces as w')
    .leftJoin('workspace_brand as b', 'b.workspace_id', 'w.id')
    .select(['w.id', 'w.slug', 'w.name', 'w.status', 'w.plan', 'w.created_at', 'b.display_name'])
    .orderBy('w.created_at', 'desc');
  if (onlyId) wq = wq.where('w.id', '=', onlyId);
  const workspaces = await wq.execute();
  if (!workspaces.length) return [];
  const ids = workspaces.map((w) => w.id);
  const [apps, awards, members, files, backlog, processed, failing] = await Promise.all([
    db.selectFrom('applications').select(['workspace_id', (eb) => eb.fn.countAll<number>().as('n')]).where('workspace_id', 'in', ids).groupBy('workspace_id').execute(),
    db.selectFrom('awards').select(['workspace_id', (eb) => eb.fn.countAll<number>().as('n')]).where('workspace_id', 'in', ids).groupBy('workspace_id').execute(),
    db.selectFrom('workspace_members').select(['workspace_id', (eb) => eb.fn.countAll<number>().as('n')]).where('workspace_id', 'in', ids).where('status', '=', 'active').groupBy('workspace_id').execute(),
    db
      .selectFrom('attachments')
      .select(['workspace_id', (eb) => eb.fn.countAll<number>().as('n'), (eb) => eb.fn.coalesce(eb.fn.sum<number>('size_bytes'), sql<number>`0`).as('bytes')])
      .where('workspace_id', 'in', ids)
      .groupBy('workspace_id')
      .execute(),
    db
      .selectFrom('outbox')
      .select(['workspace_id', (eb) => eb.fn.countAll<number>().as('n'), (eb) => eb.fn.min('created_at').as('oldest')])
      .where('workspace_id', 'in', ids)
      .where('processed_at', 'is', null)
      .groupBy('workspace_id')
      .execute(),
    db.selectFrom('outbox').select(['workspace_id', (eb) => eb.fn.max('processed_at').as('last')]).where('workspace_id', 'in', ids).groupBy('workspace_id').execute(),
    db
      .selectFrom('outbox')
      .select(['workspace_id', (eb) => eb.fn.countAll<number>().as('n')])
      .where('workspace_id', 'in', ids)
      .where('processed_at', 'is', null)
      .where('last_error', 'is not', null)
      .groupBy('workspace_id')
      .execute(),
  ]);
  const appsBy = countMap(apps);
  const awardsBy = countMap(awards);
  const membersBy = countMap(members);
  const filesBy = new Map(files.map((f) => [f.workspace_id, { n: Number(f.n), bytes: Number(f.bytes) }]));
  const backlogBy = new Map(backlog.filter((b) => b.workspace_id).map((b) => [b.workspace_id as string, { n: Number(b.n), oldest: (b.oldest as string | null) ?? null }]));
  const lastBy = new Map(processed.filter((p) => p.workspace_id).map((p) => [p.workspace_id as string, (p.last as string | null) ?? null]));
  const failingBy = countMap(failing);
  const plans = await Promise.all(workspaces.map((w) => rt.adapters.billing.planFor(w.id).catch(() => ({ plan: w.plan, status: 'none' as const }))));
  return workspaces.map((w, i) => ({
    id: w.id,
    slug: w.slug,
    name: w.name,
    displayName: w.display_name ?? w.name,
    status: w.status,
    plan: plans[i]?.plan ?? w.plan,
    billingStatus: plans[i]?.status ?? 'none',
    createdAt: w.created_at,
    applications: appsBy.get(w.id) ?? 0,
    awards: awardsBy.get(w.id) ?? 0,
    activeMembers: membersBy.get(w.id) ?? 0,
    attachments: filesBy.get(w.id)?.n ?? 0,
    storageBytes: filesBy.get(w.id)?.bytes ?? 0,
    health: {
      backlog: backlogBy.get(w.id)?.n ?? 0,
      oldestPendingAt: backlogBy.get(w.id)?.oldest ?? null,
      lastProcessedAt: lastBy.get(w.id) ?? null,
      failing: failingBy.get(w.id) ?? 0,
    },
  }));
}

export interface PlatformHealth {
  lastTickAt: string | null;
  backlog: number;
  oldestPendingAt: string | null;
  failing: number;
}

export async function platformHealth(): Promise<PlatformHealth> {
  const db = getRuntime().db;
  const [last, pending] = await Promise.all([
    db.selectFrom('outbox').select((eb) => eb.fn.max('processed_at').as('last')).executeTakeFirst(),
    db
      .selectFrom('outbox')
      .select([
        (eb) => eb.fn.countAll<number>().as('n'),
        (eb) => eb.fn.min('created_at').as('oldest'),
        sql<number>`count(*) filter (where last_error is not null)`.as('failing'),
      ])
      .where('processed_at', 'is', null)
      .executeTakeFirst(),
  ]);
  return {
    lastTickAt: (last?.last as string | null) ?? null,
    backlog: Number(pending?.n ?? 0),
    oldestPendingAt: (pending?.oldest as string | null) ?? null,
    failing: Number(pending?.failing ?? 0),
  };
}

export type HealthLevel = 'ok' | 'idle' | 'backlog' | 'stalled';

/** Healthy when nothing is waiting; a backlog older than 15 minutes means the worker is behind; over an hour, stalled. */
export function healthLevel(h: { backlog: number; oldestPendingAt: string | null; failing: number }, now = Date.now()): HealthLevel {
  if (h.backlog === 0) return 'ok';
  const ageMin = h.oldestPendingAt ? (now - Date.parse(h.oldestPendingAt)) / 60000 : 0;
  if (ageMin > 60 || h.failing > 0) return 'stalled';
  if (ageMin > 15) return 'backlog';
  return 'idle';
}

export interface MigrationRow {
  version: string;
  name: string;
  appliedAt: string;
}

/** Applied migrations (platform-wide). Null when the tracking table is missing. */
export async function appliedMigrations(): Promise<MigrationRow[] | null> {
  try {
    const r = await sql<{ version: string; name: string; applied_at: string | Date }>`
      select version, name, applied_at from gms_meta.schema_migrations order by version desc`.execute(getRuntime().db);
    return r.rows.map((m) => ({ version: m.version, name: m.name, appliedAt: typeof m.applied_at === 'string' ? m.applied_at : m.applied_at.toISOString() }));
  } catch {
    return null;
  }
}

export interface SupportGrant {
  id: string;
  reason: string;
  expiresAt: string;
  createdAt: string;
  grantedByName: string | null;
  grantedByEmail: string | null;
}

/** The viewer's active (unexpired, unrevoked) support-access grant for this workspace, if any. */
export async function activeGrant(workspaceId: string, operatorUserId: string): Promise<SupportGrant | null> {
  const row = await getRuntime()
    .db.selectFrom('support_access_grants as g')
    .leftJoin('profiles as p', 'p.id', 'g.granted_by')
    .select(['g.id', 'g.reason', 'g.expires_at', 'g.created_at', 'p.full_name', 'p.email'])
    .where('g.workspace_id', '=', workspaceId)
    .where('g.operator_user_id', '=', operatorUserId)
    .where('g.revoked_at', 'is', null)
    .where('g.expires_at', '>', sql<string>`now()`)
    .orderBy('g.expires_at', 'desc')
    .executeTakeFirst();
  return row ? { id: row.id, reason: row.reason, expiresAt: row.expires_at, createdAt: row.created_at, grantedByName: row.full_name, grantedByEmail: row.email } : null;
}

export async function workspaceRefById(id: string): Promise<WorkspaceRef | null> {
  const row = await getRuntime().db.selectFrom('workspaces').select(['id', 'slug', 'name', 'timezone']).where('id', '=', id).executeTakeFirst();
  return row ?? null;
}

export interface TenantPanelData {
  applicationsByStatus: { status: string; n: number }[];
  audit: { id: string; occurredAt: string; actor: string; actorType: string; action: string; entity: string | null }[];
}

/**
 * Read-only tenant data for support. Records the view in the tenant's audit log FIRST (operator.record_view);
 * if the audit write fails, no data is returned.
 */
export async function readTenantPanel(ws: WorkspaceRef, viewer: Viewer, grant: SupportGrant): Promise<TenantPanelData> {
  const rt = getRuntime();
  await rt.executor.execute('operator.record_view', { operatorUserId: viewer.userId, operatorEmail: viewer.email, view: 'operator.tenant_detail.support_panel', supportGrantId: grant.id }, systemContext(ws, 'ui'));
  const [byStatus, audit] = await Promise.all([
    rt.db.selectFrom('applications').select(['status', (eb) => eb.fn.countAll<number>().as('n')]).where('workspace_id', '=', ws.id).groupBy('status').orderBy('status').execute(),
    rt.db
      .selectFrom('audit_log')
      .select(['id', 'occurred_at', 'actor_name', 'actor_type', 'action', 'entity_type'])
      .where('workspace_id', '=', ws.id)
      .orderBy('occurred_at', 'desc')
      .limit(15)
      .execute(),
  ]);
  return {
    applicationsByStatus: byStatus.map((r) => ({ status: r.status, n: Number(r.n) })),
    audit: audit.map((a) => ({ id: a.id, occurredAt: a.occurred_at, actor: a.actor_name ?? a.actor_type, actorType: a.actor_type, action: a.action, entity: a.entity_type })),
  };
}

export function formatDateTime(iso: string | null, opts: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' }): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-US', { ...opts, timeZone: 'UTC' }).format(new Date(iso)) + (opts.timeStyle ? ' UTC' : '');
}

export function relativeAge(iso: string | null, now = Date.now()): string {
  if (!iso) return 'never';
  const min = Math.round((now - Date.parse(iso)) / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}
