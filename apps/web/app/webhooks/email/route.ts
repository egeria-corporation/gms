// SPDX-License-Identifier: AGPL-3.0-or-later
// Resend (Svix-signed) delivery events → system.record_email_event. Verified with RESEND_WEBHOOK_SECRET;
// without a secret configured this endpoint is not available (501). Unverified bodies are never stored.
import { getRuntime, systemContext } from '@gms/actions';
import { verifySvixSignature } from '@gms/adapters';

export const dynamic = 'force-dynamic';

const MAX_BYTES = 262_144;

const EVENTS = {
  'email.sent': 'sent',
  'email.delivered': 'delivered',
  'email.bounced': 'bounced',
  'email.complained': 'complained',
  'email.opened': 'opened',
  'email.clicked': 'clicked',
  'email.failed': 'failed',
} as const;

const json = (status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export async function POST(req: Request) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) return json(501, { error: 'not_configured' });
  if (Number(req.headers.get('content-length') ?? 0) > MAX_BYTES) return json(413, { error: 'payload_too_large' });
  const rawBody = await req.text();
  if (rawBody.length > MAX_BYTES) return json(413, { error: 'payload_too_large' });
  const headers: Record<string, string | undefined> = {};
  for (const h of ['svix-id', 'svix-timestamp', 'svix-signature', 'webhook-id', 'webhook-timestamp', 'webhook-signature']) headers[h] = req.headers.get(h) ?? undefined;
  if (!verifySvixSignature(rawBody, headers, secret)) return json(401, { error: 'invalid_signature' });

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return json(400, { error: 'invalid_json' });
  }
  if (!isRecord(body) || typeof body.type !== 'string') return json(400, { error: 'invalid_event' });
  const event = EVENTS[body.type as keyof typeof EVENTS];
  if (!event) return json(200, { received: true, ignored: body.type.slice(0, 60) });
  const data = isRecord(body.data) ? body.data : {};
  const to = Array.isArray(data.to) ? data.to.find((x): x is string => typeof x === 'string') : typeof data.to === 'string' ? data.to : null;
  const eventId = headers['svix-id'] ?? headers['webhook-id'] ?? '';
  try {
    await getRuntime().executor.run(
      'system.record_email_event',
      {
        provider: 'resend',
        providerEventId: eventId,
        providerMessageId: typeof data.email_id === 'string' ? data.email_id : null,
        event,
        recipient: to ?? null,
        payload: { type: body.type, created_at: typeof body.created_at === 'string' ? body.created_at : null, data: { email_id: data.email_id ?? null, subject: typeof data.subject === 'string' ? data.subject : null, bounce: isRecord(data.bounce) ? data.bounce : null } },
      },
      systemContext(null, 'webhook'),
    );
  } catch (err) {
    console.error('[webhooks/email] record failed', (err as Error).message);
    return json(500, { error: 'internal' });
  }
  return json(200, { received: true });
}
