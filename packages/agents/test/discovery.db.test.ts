// SPDX-License-Identifier: AGPL-3.0-only
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { agentsMd, handleDiscovery, llmsFullTxt, llmsTxt } from '../src';
import { ORIGIN, setup, type Setup } from './helpers';

let s: Setup;

beforeAll(async () => {
  s = await setup('gms_agents_discovery');
  await s.t.db
    .insertInto('opportunities')
    .values([
      {
        workspace_id: s.wsA.id,
        slug: 'youth-arts-fund',
        title: 'Youth Arts Fund 2027',
        status: 'open',
        summary: 'After-school arts for young people.',
        eligibility_md: '501(c)(3) nonprofits or fiscally sponsored projects.',
        guidelines_md: '## Budget\n\nRequests may be $5,000 to $25,000.',
        faq: JSON.stringify([{ q: 'Can we get operating support?', a: 'No, program support only.' }]),
        award_min_cents: 500_000,
        award_max_cents: 2_500_000,
        closes_at: '2026-12-06T01:00:00Z',
        opens_at: '2026-09-01T16:00:00Z',
      },
      { workspace_id: s.wsA.id, slug: 'secret-draft', title: 'Secret draft', status: 'draft' },
      { workspace_id: s.wsB.id, slug: 'other-fund', title: 'Other foundation fund', status: 'open' },
    ])
    .execute();
  await s.t.db
    .updateTable('agent_policies')
    .set({ ai_use: 'prohibited', mcp_enabled: false })
    .where('workspace_id', '=', s.wsA.id)
    .execute();
}, 120_000);
afterAll(async () => {
  await s?.t.drop();
});

describe('discovery documents', () => {
  it('llms.txt lists published opportunities (only this tenant’s) and the agent entry points', async () => {
    const txt = await llmsTxt(s.env());
    expect(txt.startsWith('# Halcyon Foundation')).toBe(true);
    expect(txt).toContain(`[Youth Arts Fund 2027](${ORIGIN}/opportunities/youth-arts-fund.md)`);
    expect(txt).toContain('closes Dec 5, 2026, 5:00 PM PST');
    expect(txt).not.toContain('Secret draft');
    expect(txt).not.toContain('Other foundation fund');
    for (const p of [
      '/agents.md',
      '/mcp',
      '/.well-known/agent-card.json',
      '/api/v1/openapi.json',
      '/api/v1/workflows.arazzo.yaml',
      '/llms-full.txt',
    ])
      expect(txt).toContain(`${ORIGIN}${p}`);
  });

  it('llms-full.txt has every published opportunity in full with dates in the workspace timezone', async () => {
    const txt = await llmsFullTxt(s.env());
    expect(txt).toContain('# Youth Arts Fund 2027');
    expect(txt).toContain('Dec 5, 2026, 5:00 PM PST (America/Los_Angeles)');
    expect(txt).toContain('## Eligibility');
    expect(txt).toContain('### Can we get operating support?');
    expect(txt).toContain('## How to apply');
    expect(txt).toContain(`${ORIGIN}/mcp`);
  });

  it('agents.md explains connection, OAuth, scopes, rules and the foundation’s AI-use policy', async () => {
    const md = await agentsMd(s.env());
    expect(md).toContain(`${ORIGIN}/mcp`);
    expect(md).toContain(`${ORIGIN}/.well-known/agent-card.json`);
    expect(md).toContain(`${ORIGIN}/api/v1/openapi.json`);
    expect(md).toContain('code_challenge_method=S256');
    expect(md).toContain('Client ID Metadata Document');
    expect(md).toContain('gms_pat_');
    expect(md).toContain('| `applications:submit` |');
    expect(md).toContain('R3 is people-only');
    expect(md).toContain('<applicant_supplied');
    expect(md).toContain('Not allowed: this foundation asks applicants not to use AI tools');
    expect(md).toContain('Currently turned off by the foundation');
    expect(md).toContain('Supabase OAuth 2.1 server does not support Client ID Metadata Documents yet');
    expect(md).toMatch(/Rate limits/);
  });

  it('serves opportunity markdown, well-known metadata and the agent card through handleDiscovery', async () => {
    const md = await handleDiscovery(new Request(`${ORIGIN}/opportunities/youth-arts-fund.md`), s.env());
    expect(md!.headers.get('content-type')).toContain('text/markdown');
    expect(await md!.text()).toContain('**Deadline:** Dec 5, 2026, 5:00 PM PST (America/Los_Angeles)');
    const draft = await handleDiscovery(new Request(`${ORIGIN}/opportunities/secret-draft.md`), s.env());
    expect(draft!.status).toBe(404);
    const card = await handleDiscovery(new Request(`${ORIGIN}/.well-known/agent-card.json`), s.env());
    expect(((await card!.json()) as { url: string }).url).toBe(`${ORIGIN}/a2a`);
    const prm = await handleDiscovery(new Request(`${ORIGIN}/.well-known/oauth-protected-resource`), s.env());
    expect(((await prm!.json()) as { resource: string }).resource).toBe(ORIGIN);
    expect(await handleDiscovery(new Request(`${ORIGIN}/something-else`), s.env())).toBeNull();
  });
});
