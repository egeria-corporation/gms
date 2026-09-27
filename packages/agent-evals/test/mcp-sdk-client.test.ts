// SPDX-License-Identifier: AGPL-3.0-only
// Interop: the official MCP TypeScript SDK client (Streamable HTTP transport) against the stateless /mcp handler.
// The SDK validates every structuredContent against the tool's outputSchema, so this also checks the schemas.
import { handleMcp } from '@gms/agents';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildAgentWorld, ORIGIN, type AgentWorld } from '../src';

let w: AgentWorld;

beforeAll(async () => {
  w = await buildAgentWorld('gms_eval_sdk');
}, 180_000);
afterAll(async () => {
  await w?.t.drop();
});

async function connect(token?: string) {
  const transport = new StreamableHTTPClientTransport(new URL(`${ORIGIN}/mcp`), {
    fetch: (url, init) => handleMcp(new Request(url, init), w.env()),
    ...(token ? { requestInit: { headers: { authorization: `Bearer ${token}` } } } : {}),
  });
  const client = new Client({ name: 'gms-eval-sdk', version: '1.0.0' });
  await client.connect(transport);
  return client;
}

describe('MCP SDK client interop', () => {
  it('connects anonymously and calls public tools with schema-valid structured results', async () => {
    const client = await connect();
    try {
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name).sort()).toEqual([
        'check_eligibility',
        'get_opportunity',
        'search_opportunities',
      ]);
      const search = await client.callTool({
        name: 'search_opportunities',
        arguments: { query: 'youth arts' },
      });
      expect(search.isError).toBeFalsy();
      const opp = await client.callTool({ name: 'get_opportunity', arguments: { slug: 'youth-arts-fund' } });
      expect((opp.structuredContent as { title: string }).title).toBe('Youth Arts Fund 2027');
      const elig = await client.callTool({
        name: 'check_eligibility',
        arguments: { opportunityId: w.ids.opportunity, answers: {} },
      });
      expect(
        (elig.structuredContent as { status: string; result: { eligible: boolean | null } }).result.eligible,
      ).toBeNull();
    } finally {
      await client.close();
    }
  });

  it('connects with a token and every read tool returns output that matches its schema', async () => {
    const client = await connect(w.tokens.grantWriterPat);
    try {
      const { tools } = await client.listTools();
      expect(tools.length).toBeGreaterThan(13);
      for (const name of [
        'get_status',
        'list_requests',
        'get_payment_status',
        'list_reports',
        'list_my_awards',
      ]) {
        const r = await client.callTool({ name, arguments: {} });
        expect(r.isError, `${name}: ${JSON.stringify(r.content)}`).toBeFalsy();
      }
      const form = await client.callTool({
        name: 'get_application_form',
        arguments: { opportunityId: w.ids.opportunity },
      });
      expect(form.isError).toBeFalsy();
    } finally {
      await client.close();
    }
  });
});
