// SPDX-License-Identifier: AGPL-3.0-only
// S-06 Audit log (states: empty, diff-open).
import { sql } from '@gms/db';
import { zonedTimeToUtc } from '@gms/domain';
import {
  Button,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Pagination,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@gms/ui';
import { ScrollText } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { SettingsTabs } from '@/components/console/admin/settings-tabs';
import { AuditTable, type AuditRow } from '@/components/console/admin/audit/audit-table';
import { NextLink } from '@/components/next-link';
import { requireStaff } from '@/lib/auth';
import { rls } from '@/lib/server/db';
import { forcedState, one } from '@/lib/site';
import { requireTenant } from '@/lib/tenant';

export const metadata: Metadata = { title: 'Audit log' };

const PAGE_SIZE = 50;
const ANY = 'any';

function dateParam(v: string | undefined): string | null {
  return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

function nextDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

const PREVIEW_ROW: AuditRow = {
  id: '00000000-0000-4000-8000-00000000a0d1',
  occurredAt: '2026-09-24T17:42:00.000Z',
  actorType: 'agent',
  actorName: 'Operations assistant',
  onBehalfOfName: 'Maya Okafor',
  action: 'awards.update_draft',
  entityType: 'award',
  entityId: '6f1c2b8e-3d4a-4c5e-9f10-2a3b4c5d6e7f',
  riskTier: 'R2',
  before: {
    amount_cents: 2500000,
    start_date: '2026-10-01',
    purpose: 'General operating support',
    conditions: ['Annual report'],
  },
  after: {
    amount_cents: 3000000,
    start_date: '2026-10-01',
    purpose: 'General operating support for youth literacy programs',
    payment_schedule: 'two_installments',
  },
  requestId: 'req_7Hq2Lm9Xw4',
  ip: '203.0.113.24',
  userAgent: 'GMS MCP client/1.4',
  approvalRequestId: null,
};

export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [tenant] = await Promise.all([requireTenant(), requireStaff(['owner', 'admin', 'auditor'])]);
  const sp = await searchParams;
  const forced = forcedState(sp);
  const actorRaw = one(sp.actor);
  const actor = actorRaw === 'human' || actorRaw === 'agent' || actorRaw === 'system' ? actorRaw : null;
  const entityRaw = one(sp.entity);
  const entity = entityRaw && entityRaw !== ANY ? entityRaw.slice(0, 80) : null;
  const q = (one(sp.q) ?? '').trim().slice(0, 100);
  const from = dateParam(one(sp.from));
  const to = dateParam(one(sp.to));
  const page = Math.max(1, Math.floor(Number(one(sp.page) ?? '1')) || 1);

  const d = await rls(async (trx) => {
    let base = trx.selectFrom('audit_log').where('workspace_id', '=', tenant.id);
    if (actor) base = base.where('actor_type', '=', actor);
    if (entity) base = base.where('entity_type', '=', entity);
    if (q) base = base.where('action', 'ilike', `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`);
    if (from)
      base = base.where('occurred_at', '>=', zonedTimeToUtc(`${from}T00:00`, tenant.timezone).toISOString());
    if (to)
      base = base.where(
        'occurred_at',
        '<',
        zonedTimeToUtc(`${nextDay(to)}T00:00`, tenant.timezone).toISOString(),
      );
    const [count, rows, entities] = await Promise.all([
      base.select(sql<number>`count(*)::int`.as('n')).executeTakeFirst(),
      base
        .select([
          'id',
          'occurred_at',
          'actor_type',
          'actor_name',
          'on_behalf_of_name',
          'action',
          'entity_type',
          'entity_id',
          'risk_tier',
          'before',
          'after',
          'request_id',
          'ip',
          'user_agent',
          'approval_request_id',
        ])
        .orderBy('occurred_at', 'desc')
        .orderBy('id', 'desc')
        .limit(PAGE_SIZE)
        .offset((page - 1) * PAGE_SIZE)
        .execute(),
      trx
        .selectFrom('audit_log')
        .select('entity_type')
        .distinct()
        .where('workspace_id', '=', tenant.id)
        .where('entity_type', 'is not', null)
        .orderBy('entity_type')
        .limit(200)
        .execute(),
    ]);
    return {
      total: Number(count?.n ?? 0),
      rows,
      entities: entities.map((e) => e.entity_type).filter((e): e is string => Boolean(e)),
    };
  });

  let rows: AuditRow[] = d.rows.map((r) => ({
    id: r.id,
    occurredAt: r.occurred_at,
    actorType: r.actor_type === 'agent' || r.actor_type === 'system' ? r.actor_type : 'human',
    actorName: r.actor_name ?? (r.actor_type === 'system' ? 'GMS' : 'Unknown'),
    onBehalfOfName: r.on_behalf_of_name,
    action: r.action,
    entityType: r.entity_type,
    entityId: r.entity_id,
    riskTier: r.risk_tier,
    before: r.before,
    after: r.after,
    requestId: r.request_id,
    ip: r.ip,
    userAgent: r.user_agent,
    approvalRequestId: r.approval_request_id,
  }));
  let total = d.total;
  if (forced === 'empty') {
    rows = [];
    total = 0;
  }
  if (forced === 'diff-open' && !rows.length) {
    rows = [PREVIEW_ROW];
    total = 1;
  }
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const filtered = Boolean(actor || entity || q || from || to);

  const href = (p: number) => {
    const u = new URLSearchParams();
    if (actor) u.set('actor', actor);
    if (entity) u.set('entity', entity);
    if (q) u.set('q', q);
    if (from) u.set('from', from);
    if (to) u.set('to', to);
    if (p > 1) u.set('page', String(p));
    const s = u.toString();
    return `/console/settings/audit${s ? `?${s}` : ''}`;
  };

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Audit log"
        description={`Every change in ${tenant.brand.displayName}: who made it (a person, an agent acting for a person, or GMS itself), what changed, and when. Times are in ${tenant.timezone}.`}
      />
      <SettingsTabs current="/console/settings/audit" />

      <form
        role="search"
        aria-label="Filter the audit log"
        method="get"
        action="/console/settings/audit"
        className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-[10rem_12rem_1fr_10rem_10rem_auto]"
      >
        <Field label="Who" htmlFor="audit-actor">
          <Select name="actor" defaultValue={actor ?? ANY}>
            <SelectTrigger id="audit-actor" size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>Anyone</SelectItem>
              <SelectItem value="human">People</SelectItem>
              <SelectItem value="agent">Agents</SelectItem>
              <SelectItem value="system">GMS (system)</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label="Record type" htmlFor="audit-entity">
          <Select name="entity" defaultValue={entity ?? ANY}>
            <SelectTrigger id="audit-entity" size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>All record types</SelectItem>
              {d.entities.map((e) => (
                <SelectItem key={e} value={e}>
                  {e.replace(/_/g, ' ')}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Action contains" htmlFor="audit-q">
          <Input id="audit-q" name="q" inputSize="sm" defaultValue={q} placeholder="e.g. payments.approve" />
        </Field>
        <Field label="From" htmlFor="audit-from">
          <Input id="audit-from" name="from" type="date" inputSize="sm" defaultValue={from ?? ''} />
        </Field>
        <Field label="To" htmlFor="audit-to">
          <Input id="audit-to" name="to" type="date" inputSize="sm" defaultValue={to ?? ''} />
        </Field>
        <div className="flex gap-2">
          <Button type="submit" size="sm">
            Apply filters
          </Button>
          {filtered ? (
            <Button asChild variant="ghost" size="sm">
              <Link href="/console/settings/audit">Clear</Link>
            </Button>
          ) : null}
        </div>
      </form>

      {rows.length ? (
        <div className="grid gap-3">
          <AuditTable
            rows={rows}
            timeZone={tenant.timezone}
            initialOpenId={forced === 'diff-open' ? (rows[0]?.id ?? null) : null}
          />
          <Pagination
            page={Math.min(page, pageCount)}
            pageCount={pageCount}
            total={total}
            pageSize={PAGE_SIZE}
            itemLabel="entries"
            getHref={href}
            linkComponent={NextLink}
          />
        </div>
      ) : (
        <EmptyState
          icon={ScrollText}
          title={filtered ? 'No entries match these filters' : 'Nothing in the audit log yet'}
          description={
            filtered
              ? 'Try a wider date range or clear the filters.'
              : 'Changes made by people, agents and GMS itself are recorded here as they happen. The log can’t be edited or deleted.'
          }
          action={
            filtered ? (
              <Button asChild variant="secondary">
                <Link href="/console/settings/audit">Clear filters</Link>
              </Button>
            ) : undefined
          }
        />
      )}
    </div>
  );
}
