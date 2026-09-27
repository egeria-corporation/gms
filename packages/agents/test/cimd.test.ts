// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import {
  isAllowedRedirectUri,
  isPrivateAddress,
  parseClientMetadataDocument,
  redirectUriMatches,
  validateClientIdUrl,
} from '../src/cimd';
import { opportunityMarkdown, prefersMarkdown } from '../src';
import { passagesFor, rankPassages } from '../src/retrieval';

describe('SSRF guard', () => {
  it.each([
    ['127.0.0.1', true],
    ['10.1.2.3', true],
    ['172.16.0.1', true],
    ['172.32.0.1', false],
    ['192.168.1.1', true],
    ['169.254.169.254', true],
    ['100.64.0.1', true],
    ['0.0.0.0', true],
    ['224.0.0.1', true],
    ['8.8.8.8', false],
    ['::1', true],
    ['::', true],
    ['fc00::1', true],
    ['fd12:3456::1', true],
    ['fe80::1', true],
    ['::ffff:127.0.0.1', true],
    ['::ffff:7f00:1', true],
    ['64:ff9b::a00:1', true],
    ['2606:4700:4700::1111', false],
    ['not-an-ip', true],
  ])('%s private=%s', (ip, expected) => {
    expect(isPrivateAddress(ip)).toBe(expected);
  });

  it('validates client_id URLs', () => {
    expect(validateClientIdUrl('https://agent.example/client.json').hostname).toBe('agent.example');
    for (const bad of [
      'http://agent.example/client.json',
      'https://agent.example/',
      'https://user:pw@agent.example/c.json',
      'https://agent.example:8443/c.json',
      'https://127.0.0.1/c.json',
      'https://[::1]/c.json',
      'https://localhost/c.json',
      'https://intranet/c.json',
      'https://agent.example/c.json#x',
      'https://metadata.internal/c.json',
    ]) {
      expect(() => validateClientIdUrl(bad), bad).toThrow();
    }
  });

  it('validates CIMD documents', () => {
    const url = 'https://agent.example/client.json';
    const ok = parseClientMetadataDocument(url, {
      client_id: url,
      client_name: 'Agent',
      redirect_uris: ['https://agent.example/cb', 'http://127.0.0.1/cb'],
      scope: 'opportunities:read nope',
    });
    expect(ok).toMatchObject({ name: 'Agent', scopes: ['opportunities:read'] });
    expect(() =>
      parseClientMetadataDocument(url, {
        client_id: 'https://evil.example/c.json',
        redirect_uris: ['https://a.example/cb'],
      }),
    ).toThrow(/equal the URL/);
    expect(() =>
      parseClientMetadataDocument(url, {
        client_id: url,
        redirect_uris: ['https://a.example/cb'],
        client_secret: 'x',
      }),
    ).toThrow(/secret/);
    expect(() =>
      parseClientMetadataDocument(url, { client_id: url, redirect_uris: ['javascript:alert(1)'] }),
    ).toThrow(/redirect_uris/);
    expect(() =>
      parseClientMetadataDocument(url, {
        client_id: url,
        redirect_uris: ['https://a.example/cb'],
        token_endpoint_auth_method: 'client_secret_basic',
      }),
    ).toThrow(/public clients/);
  });

  it('applies redirect URI rules (RFC 8252 loopback ports, private-use schemes)', () => {
    expect(isAllowedRedirectUri('https://app.example/cb')).toBe(true);
    expect(isAllowedRedirectUri('http://localhost:3000/cb')).toBe(true);
    expect(isAllowedRedirectUri('http://app.example/cb')).toBe(false);
    expect(isAllowedRedirectUri('com.example.app:/oauth')).toBe(true);
    expect(isAllowedRedirectUri('javascript:alert(1)')).toBe(false);
    expect(isAllowedRedirectUri('https://app.example/cb#frag')).toBe(false);
    expect(redirectUriMatches(['http://127.0.0.1/cb'], 'http://127.0.0.1:51234/cb')).toBe(true);
    expect(redirectUriMatches(['http://127.0.0.1/cb'], 'http://127.0.0.1:51234/other')).toBe(false);
    expect(redirectUriMatches(['https://app.example/cb'], 'https://app.example/cb?x=1')).toBe(false);
  });
});

const OPP = {
  id: 'o1',
  title: 'Youth Arts Fund 2027',
  slug: 'youth-arts-fund',
  status: 'open',
  summary: 'After-school arts.',
  description_md: 'We fund murals, music and theater.',
  eligibility_md: 'Nonprofits with 501(c)(3) status or a fiscal sponsor.',
  guidelines_md:
    '## Budget\n\nRequests may be $5,000 to $25,000.\n\n## Deadline\n\nLate applications are not accepted.',
  faq: [{ q: 'Do fiscally sponsored groups qualify?', a: 'Yes, with the sponsor’s EIN.' }],
  funding_total_cents: 50_000_000,
  award_min_cents: 500_000,
  award_max_cents: 2_500_000,
  currency: 'USD',
  applicant_types: ['nonprofit_501c3'],
  cause_terms: ['arts'],
  geography_terms: ['alder-county'],
  opens_at: '2026-09-01T16:00:00Z',
  closes_at: '2026-12-06T01:00:00Z',
  decision_expected_on: '2027-02-15',
  contact_email: 'grants@halcyon.example',
};

describe('retrieval', () => {
  it('ranks the most relevant passage first', () => {
    const top = rankPassages(passagesFor(OPP), 'Can fiscally sponsored organizations apply?', 3);
    expect(top[0]!.passage.source).toBe('faq');
    const late = rankPassages(passagesFor(OPP), 'are late applications accepted', 1);
    expect(late[0]!.passage.heading).toBe('Deadline');
    expect(rankPassages(passagesFor(OPP), 'zzz qqq', 3)).toEqual([]);
  });
});

describe('Accept: text/markdown negotiation', () => {
  const req = (accept: string) => new Request('http://x.example/opportunities/a', { headers: { accept } });
  it('prefers markdown only when asked for at least as strongly as HTML', () => {
    expect(prefersMarkdown(req('text/markdown'))).toBe(true);
    expect(prefersMarkdown(req('text/markdown, text/html;q=0.5'))).toBe(true);
    expect(prefersMarkdown(req('text/html, text/markdown;q=0.5'))).toBe(false);
    expect(prefersMarkdown(req('text/html,application/xhtml+xml'))).toBe(false);
  });
});

describe('opportunity markdown', () => {
  it('renders dates in the foundation timezone, eligibility, guidelines, FAQ and how to apply', () => {
    const md = opportunityMarkdown(OPP, {
      name: 'Halcyon Foundation',
      timezone: 'America/Los_Angeles',
      origin: 'http://halcyon.localhost:3000',
    });
    expect(md).toContain('# Youth Arts Fund 2027');
    expect(md).toContain('**Deadline:** Dec 5, 2026, 5:00 PM PST (America/Los_Angeles)');
    expect(md).toContain('- **Award size:** $5,000');
    expect(md).toContain('## Eligibility');
    expect(md).toContain('### Do fiscally sponsored groups qualify?');
    expect(md).toContain('## How to apply');
    expect(md).toContain('http://halcyon.localhost:3000/mcp');
    expect(md).toContain('Submitting is always confirmed by a person');
  });
});
