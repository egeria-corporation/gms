// SPDX-License-Identifier: AGPL-3.0-or-later
// MCP server (stateless Streamable HTTP, JSON-RPC). See packages/agents/src/mcp.ts.
import { handleMcp } from '@gms/agents';
import { agentEnv } from '@/lib/server/agent-env';
import { kickOutbox } from '@/lib/server/outbox';

export const dynamic = 'force-dynamic';

async function handle(req: Request): Promise<Response> {
  const res = await handleMcp(req, await agentEnv());
  kickOutbox();
  return res;
}

export { handle as GET, handle as POST, handle as DELETE };
