// SPDX-License-Identifier: AGPL-3.0-only
// A2A JSON-RPC endpoint. The Agent Card is at /.well-known/agent-card.json.
import { handleA2a } from '@gms/agents';
import { agentEnv } from '@/lib/server/agent-env';
import { kickOutbox } from '@/lib/server/outbox';

export const dynamic = 'force-dynamic';

async function handle(req: Request): Promise<Response> {
  const res = await handleA2a(req, await agentEnv());
  kickOutbox();
  return res;
}

export { handle as GET, handle as POST };
