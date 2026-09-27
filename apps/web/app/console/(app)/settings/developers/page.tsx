// SPDX-License-Identifier: AGPL-3.0-only
// S-07 Developers: API keys & webhooks (states: key-created, secret-created, empty).
import { WEBHOOK_EVENTS_LIST } from '@gms/actions';
import { sql } from '@gms/db';
import { formatInZone } from '@gms/domain';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Field,
  PageHeader,
  Section,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  ToneChip,
} from '@gms/ui';
import { CircleCheck, Clock, ExternalLink, FileJson, Send, TriangleAlert, Workflow } from 'lucide-react';
import type { Metadata } from 'next';
import { SettingsTabs } from '@/components/console/admin/settings-tabs';
import { ApiKeys, type ApiKeyRow } from '@/components/console/admin/developers/api-keys';
import { Webhooks, type WebhookRow } from '@/components/console/admin/developers/webhooks';
import { requireStaff } from '@/lib/auth';
import { rls } from '@/lib/server/db';
import { forcedState, one } from '@/lib/site';
import { requireTenant } from '@/lib/tenant';

export const metadata: Metadata = { title: 'Developers' };

const PREVIEW_KEY = 'gms_sk_Xr8Kd2PqW7mZt4Lb9Nc1Vy6Hs3Jf0GeQ';
const PREVIEW_SECRET = 'whsec_Tq5Wn8Rk2Lp7Zx4Cv9Bm1Yd6Hf3Gs0Ja';
const ANY = 'any';

function DeliveryStatus({ status }: { status: string }) {
  if (status === 'succeeded')
    return <ToneChip tone="success" icon={CircleCheck} label="Delivered" size="sm" />;
  if (status === 'failed') return <ToneChip tone="danger" icon={TriangleAlert} label="Failed" size="sm" />;
  return <ToneChip tone="progress" icon={Clock} label="Pending" size="sm" />;
}

export default async function DevelopersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [tenant, viewer] = await Promise.all([requireTenant(), requireStaff(['owner', 'admin', 'auditor'])]);
  const sp = await searchParams;
  const forced = forcedState(sp);
  const canEdit = viewer.role === 'owner' || viewer.role === 'admin';
  const endpointFilter = one(sp.endpoint);

  const d = await rls(async (trx) => {
    const [keys, endpoints] = await Promise.all([
      trx
        .selectFrom('api_keys as k')
        .leftJoin('profiles as p', 'p.id', 'k.owner_id')
        .select([
          'k.id',
          'k.name',
          'k.prefix',
          'k.scopes',
          'k.created_at',
          'k.last_used_at',
          'k.expires_at',
          'k.revoked_at',
          'p.full_name',
          'p.email',
        ])
        .where('k.workspace_id', '=', tenant.id)
        .where('k.agent_client_id', 'is', null)
        .orderBy(sql`k.revoked_at is not null`)
        .orderBy('k.created_at', 'desc')
        .execute(),
      trx
        .selectFrom('webhook_endpoints')
        .select(['id', 'url', 'description', 'events', 'status', 'created_at'])
        .where('workspace_id', '=', tenant.id)
        .orderBy('created_at', 'desc')
        .execute(),
    ]);
    const filterId = endpointFilter && endpoints.some((e) => e.id === endpointFilter) ? endpointFilter : null;
    let dq = trx
      .selectFrom('webhook_deliveries as d')
      .innerJoin('webhook_endpoints as e', 'e.id', 'd.endpoint_id')
      .select([
        'd.id',
        'd.event_type',
        'd.status',
        'd.attempt',
        'd.response_status',
        'd.next_attempt_at',
        'd.delivered_at',
        'd.created_at',
        'e.url',
      ])
      .where('d.workspace_id', '=', tenant.id);
    if (filterId) dq = dq.where('d.endpoint_id', '=', filterId);
    const deliveries = await dq.orderBy('d.created_at', 'desc').limit(50).execute();
    return { keys, endpoints, deliveries, filterId };
  });

  const empty = forced === 'empty';
  const keys: ApiKeyRow[] = empty
    ? []
    : d.keys.map((k) => ({
        id: k.id,
        name: k.name,
        prefix: k.prefix,
        scopes: k.scopes,
        ownerName: k.full_name ?? k.email,
        createdAt: k.created_at,
        lastUsedAt: k.last_used_at,
        expiresAt: k.expires_at,
        revokedAt: k.revoked_at,
      }));
  const endpoints: WebhookRow[] = empty
    ? []
    : d.endpoints.map((e) => ({
        id: e.id,
        url: e.url,
        description: e.description,
        events: e.events,
        status: e.status,
        createdAt: e.created_at,
      }));
  const deliveries = empty ? [] : d.deliveries;

  return (
    <div className="grid gap-8">
      <PageHeader
        title="Developers"
        description="API keys for your own systems, signed webhooks when things change in GMS, and the API reference."
      />
      <SettingsTabs current="/console/settings/developers" />

      <div className="grid gap-4 md:grid-cols-2">
        {[
          {
            href: '/api/v1/openapi.json',
            title: 'REST API reference',
            body: 'OpenAPI 3.1 description of every /api/v1 endpoint, generated from the same actions the console uses.',
            icon: FileJson,
          },
          {
            href: '/api/v1/workflows.arazzo.yaml',
            title: 'Workflows',
            body: 'Arazzo descriptions of multi-step flows such as “submit an application” and “propose a payment batch”.',
            icon: Workflow,
          },
        ].map((c) => (
          <Card key={c.href}>
            <CardHeader>
              <CardTitle as="h2" className="flex items-center gap-2 text-base">
                <c.icon aria-hidden="true" className="size-4 text-muted-foreground" />
                {c.title}
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 text-sm">
              <p className="text-muted-foreground">{c.body}</p>
              <a
                href={c.href}
                target="_blank"
                rel="noopener"
                className="inline-flex items-center gap-1.5 justify-self-start font-mono text-xs text-link underline underline-offset-4"
              >
                {c.href}
                <ExternalLink aria-hidden="true" className="size-3.5" />
                <span className="sr-only">(opens in a new tab)</span>
              </a>
            </CardContent>
          </Card>
        ))}
      </div>

      <Section
        title="API keys"
        description="Keys act as the workspace with the permissions you choose. Agent account keys are managed on the AI agents page."
      >
        <ApiKeys
          keys={keys}
          timeZone={tenant.timezone}
          canEdit={canEdit}
          previewKey={forced === 'key-created' && canEdit ? PREVIEW_KEY : null}
        />
      </Section>

      <Section
        title="Webhook endpoints"
        description="Each delivery is a signed POST (gms-signature: HMAC-SHA256) retried with exponential backoff."
      >
        <Webhooks
          endpoints={endpoints}
          events={WEBHOOK_EVENTS_LIST}
          timeZone={tenant.timezone}
          canEdit={canEdit}
          previewSecret={forced === 'secret-created' && canEdit ? PREVIEW_SECRET : null}
        />
      </Section>

      <Section
        title="Recent deliveries"
        description="The latest 50 webhook deliveries."
        actions={
          endpoints.length ? (
            <form
              method="get"
              action="/console/settings/developers"
              className="flex items-end gap-2"
              aria-label="Filter deliveries"
            >
              <Field label="Endpoint" htmlFor="delivery-endpoint">
                <Select name="endpoint" defaultValue={d.filterId ?? ANY}>
                  <SelectTrigger id="delivery-endpoint" size="sm" className="w-64">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ANY}>All endpoints</SelectItem>
                    {endpoints.map((e) => (
                      <SelectItem key={e.id} value={e.id}>
                        {e.url}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Button type="submit" size="sm" variant="secondary">
                Filter
              </Button>
            </form>
          ) : undefined
        }
      >
        {deliveries.length ? (
          <Table containerLabel="Recent webhook deliveries">
            <TableHeader>
              <TableRow>
                <TableHead>Event</TableHead>
                <TableHead>Endpoint</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Attempts</TableHead>
                <TableHead className="text-right">Response</TableHead>
                <TableHead>Delivered / next try</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {deliveries.map((x) => (
                <TableRow key={x.id}>
                  <TableCell className="font-mono text-xs">{x.event_type}</TableCell>
                  <TableCell className="max-w-64 truncate font-mono text-xs" title={x.url}>
                    {x.url}
                  </TableCell>
                  <TableCell>
                    <DeliveryStatus status={x.status} />
                  </TableCell>
                  <TableCell className="text-right">{x.attempt}</TableCell>
                  <TableCell className="text-right font-mono text-xs">{x.response_status ?? '—'}</TableCell>
                  <TableCell className="whitespace-nowrap text-xs">
                    {x.delivered_at
                      ? `Delivered ${formatInZone(x.delivered_at, tenant.timezone)}`
                      : x.status === 'pending' && x.next_attempt_at
                        ? `Next try ${formatInZone(x.next_attempt_at, tenant.timezone)}`
                        : x.status === 'failed'
                          ? 'Gave up'
                          : '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <EmptyState
            level={3}
            icon={Send}
            title="No deliveries yet"
            description={
              endpoints.length
                ? 'Deliveries appear here when a subscribed event happens.'
                : 'Add an endpoint to start receiving events.'
            }
          />
        )}
      </Section>
    </div>
  );
}
