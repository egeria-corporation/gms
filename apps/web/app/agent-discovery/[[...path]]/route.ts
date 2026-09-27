// SPDX-License-Identifier: AGPL-3.0-only
// Discovery documents for agents. The proxy rewrites /.well-known/{oauth-*,agent-card.json}, /llms.txt,
// /llms-full.txt, /agents.md and /opportunities/{slug}.md (or Accept: text/markdown) here.
import { handleDiscovery } from '@gms/agents';
import { agentEnv, publicRequest } from '@/lib/server/agent-env';

export const dynamic = 'force-dynamic';

async function handle(req: Request): Promise<Response> {
  const original = await publicRequest(req);
  const md = /^\/opportunities\/([a-z0-9-]{1,80})$/.exec(new URL(original.url).pathname);
  // Accept: text/markdown on an opportunity page is served as the .md document.
  const target = md ? new Request(new URL(`/opportunities/${md[1]}.md`, original.url), { headers: original.headers }) : original;
  const res = await handleDiscovery(target, await agentEnv());
  return res ?? new Response('Not found\n', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
}

export { handle as GET, handle as HEAD };
