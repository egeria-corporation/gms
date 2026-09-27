// SPDX-License-Identifier: AGPL-3.0-only
// OAuth 2.1 authorization server (fallback when Supabase's OAuth server is not configured): token endpoint.
import { handleOAuth } from '@gms/agents';
import { agentEnv } from '@/lib/server/agent-env';

export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<Response> {
  return handleOAuth(req, await agentEnv(), 'token');
}
