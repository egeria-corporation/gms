// SPDX-License-Identifier: AGPL-3.0-only
// Mercury webhook receiver. Reads the raw body, hands it (with the Mercury-Signature header) to the
// system.ingest_rail_webhook action, which finds the workspace whose signing secret verifies it and stores the
// event once. Invalid signatures get 401 and nothing is stored. Processing (system.process_rail_event) runs
// after the response so Mercury gets a fast 200.
import { getRuntime, systemContext, workspaceRef, type WorkspaceRef } from '@gms/actions';
import { financeExtra } from '@gms/actions/modules';
import { isDomainError } from '@gms/domain';
import { after } from 'next/server';
import { kickOutbox } from '@/lib/server/outbox';
import { getTenant } from '@/lib/tenant';

const { MAX_WEBHOOK_BYTES } = financeExtra;

export const dynamic = 'force-dynamic';

const json = (status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

export async function POST(req: Request) {
  const declared = Number(req.headers.get('content-length') ?? 0);
  if (declared > MAX_WEBHOOK_BYTES) return json(413, { error: 'payload_too_large' });
  const rawBody = await req.text();
  if (rawBody.length > MAX_WEBHOOK_BYTES) return json(413, { error: 'payload_too_large' });
  const signature = req.headers.get('mercury-signature');
  if (!signature) return json(401, { error: 'invalid_signature' });

  const rt = getRuntime();
  const tenant = await getTenant();
  const hint = new URL(req.url).searchParams.get('ws');
  const ws: WorkspaceRef | null = tenant ? { id: tenant.id, slug: tenant.slug, name: tenant.name, timezone: tenant.timezone } : null;
  let out: { railEventId: string; workspaceId: string; duplicate: boolean; eventType: string };
  try {
    out = await rt.executor.run('system.ingest_rail_webhook', { rawBody, signature, workspaceHint: hint && /^[a-z0-9-]{2,60}$/.test(hint) ? hint : null }, systemContext(ws, 'webhook'));
  } catch (err) {
    if (isDomainError(err) && err.code === 'unauthenticated') return json(401, { error: 'invalid_signature' });
    if (isDomainError(err) && err.code === 'validation_failed') return json(400, { error: 'invalid_event' });
    console.error('[webhooks/mercury] ingest failed', (err as Error).message);
    return json(500, { error: 'internal' });
  }

  after(async () => {
    try {
      const ref = ws && ws.id === out.workspaceId ? ws : await workspaceRef(rt.db, out.workspaceId);
      await rt.executor.run('system.process_rail_event', { railEventId: out.railEventId }, systemContext(ref, 'webhook'));
      kickOutbox();
    } catch (err) {
      // The worker's polling is the backstop; the stored event can be re-applied.
      console.error('[webhooks/mercury] processing failed', (err as Error).message);
    }
  });
  return json(200, { received: true, duplicate: out.duplicate });
}
