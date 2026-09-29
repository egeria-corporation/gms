// SPDX-License-Identifier: AGPL-3.0-or-later
// Platform API /api/v1 (OpenAPI 3.1 at /api/v1/openapi.json), generated from the action registry.
import { handleApiV1 } from '@gms/agents';
import { agentEnv } from '@/lib/server/agent-env';
import { kickOutbox } from '@/lib/server/outbox';

export const dynamic = 'force-dynamic';

async function handle(req: Request): Promise<Response> {
  const res = await handleApiV1(req, await agentEnv());
  if (req.method !== 'GET') kickOutbox();
  return res;
}

export { handle as GET, handle as POST, handle as PUT, handle as PATCH, handle as DELETE, handle as HEAD };
