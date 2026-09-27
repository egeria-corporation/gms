// SPDX-License-Identifier: AGPL-3.0-only
// Netlify Background Function (up to 15 minutes): long exports, PDF bundles and board books.
import { getRuntime } from '@gms/actions';
import { runExport } from '../../apps/worker/src/exports';

export default async function handler(req: Request): Promise<Response> {
  const secret = process.env.GMS_INTERNAL_SECRET;
  if (!secret || req.headers.get('x-gms-internal') !== secret) return new Response('forbidden', { status: 403 });
  const { exportId } = (await req.json()) as { exportId: string };
  await runExport(getRuntime(), exportId);
  return new Response(null, { status: 202 });
}
