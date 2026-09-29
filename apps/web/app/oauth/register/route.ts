// SPDX-License-Identifier: AGPL-3.0-or-later
// OAuth 2.1 authorization server (fallback when Supabase's OAuth server is not configured): register endpoint.
import { handleOAuth } from '@gms/agents';
import { agentEnv } from '@/lib/server/agent-env';

export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<Response> {
  return handleOAuth(req, await agentEnv(), 'register');
}
