// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { FIXTURE_IRS_RECORDS, FIXTURE_NEAR_MATCH, FIXTURE_SANCTIONS_RECORDS, FixtureDiligenceSource } from '../src/diligence/fixtures';
import { LiveDiligenceSource } from '../src/diligence/import';
import { formatEin, formatRuling, formatSubsection, IRS_BMF_URLS, IRS_PUB78_URL, IRS_REVOCATION_URL } from '../src/diligence/irs';
import { OFAC_ALT_URL, OFAC_SDN_URL, parsePrograms } from '../src/diligence/ofac';
import { readZip } from '../src/diligence/zip';
import type { IrsRecord, SanctionsRecord } from '../src/types';
import { ALT_CSV, BMF_CSV, makeZip, mockDownloads, PUB78_TXT, REVOCATION_TXT, SDN_CSV } from './diligence-helpers';

async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const v of it) out.push(v);
  return out;
}

describe('diligence fixtures', () => {
  it('contains the named fictional organizations', async () => {
    const irs = await collect(new FixtureDiligenceSource().irsRecords());
    expect(irs.find((r) => r.ein === '00-0000001')).toMatchObject({
      name: 'Eastside Youth Music Collective',
      city: 'Larkspur',
      state: 'CA',
      subsection: '501(c)(3)',
      status: 'active',
      pub78: true,
    });
    expect(irs.find((r) => r.ein === '00-0000002')!.name).toBe('Commons Fiscal Partners');
    expect(irs.find((r) => r.ein === '00-0000003')!.name).toBe('Cedar Hollow Food Pantry');
    expect(irs.find((r) => r.ein === '00-0000009')).toMatchObject({ name: 'Old Mill Arts Guild', status: 'revoked' });
    expect(irs.filter((r) => /^00-00001\d\d$/.test(r.ein)).length).toBeGreaterThanOrEqual(30);
    expect(new Set(irs.map((r) => r.ein)).size).toBe(irs.length);
    expect(irs.every((r) => r.ein.startsWith('00-'))).toBe(true);
  });

  it('has ~40 fictional sanctions entries including the review near-match', async () => {
    const s = await collect(new FixtureDiligenceSource().sanctionsRecords());
    expect(s.length).toBe(40);
    expect(new Set(s.map((r) => r.uid)).size).toBe(40);
    expect(s).toContainEqual(FIXTURE_NEAR_MATCH);
    expect(s.every((r) => r.programs.every((p) => p.startsWith('DEMO-')))).toBe(true);
    // The rejected "too close to a real grantee" variant must never appear.
    expect(s.some((r) => /eastside|musik/i.test(r.name))).toBe(false);
    expect(FIXTURE_SANCTIONS_RECORDS).toHaveLength(40);
    expect(FIXTURE_IRS_RECORDS.length).toBeGreaterThanOrEqual(34);
  });
});

describe('IRS importers', () => {
  it('formats BMF fields', () => {
    expect(formatEin('000000501')).toBe('00-0000501');
    expect(formatEin('12-3456789')).toBe('12-3456789');
    expect(formatEin('123')).toBeNull();
    expect(formatSubsection('03')).toBe('501(c)(3)');
    expect(formatSubsection('00')).toBeNull();
    expect(formatRuling('201104')).toBe('2011-04-01');
    expect(formatRuling('000000')).toBeNull();
    expect(formatRuling('199913')).toBeNull();
  });

  it('streams BMF, Pub 78 and revocations through an injected fetch', async () => {
    const { fetch, requested } = mockDownloads({
      [IRS_BMF_URLS[0]!]: BMF_CSV,
      [IRS_PUB78_URL]: makeZip('data-download-pub78.txt', PUB78_TXT),
      [IRS_REVOCATION_URL]: makeZip('data-download-revocation.txt', REVOCATION_TXT),
    });
    const src = new LiveDiligenceSource({ fetch, bmfUrls: [IRS_BMF_URLS[0]!] });
    const recs: IrsRecord[] = await collect(src.irsRecords());
    expect(requested).toEqual([IRS_BMF_URLS[0], IRS_PUB78_URL, IRS_REVOCATION_URL]);
    expect(recs.slice(0, 3)).toEqual([
      { ein: '00-0000501', name: 'QUILLON BAY LANTERN SOCIETY', city: 'QUILLON BAY', state: 'ME', subsection: '501(c)(3)', foundationCode: '15', deductibility: '1', status: 'active', rulingDate: '2011-04-01', pub78: false, ntee: 'A20' },
      { ein: '00-0000502', name: 'HARROW GLEN, TIDE & KITE CLUB', city: 'HARROW GLEN', state: 'OR', subsection: '501(c)(7)', foundationCode: '00', deductibility: '2', status: 'active', rulingDate: null, pub78: false, ntee: 'N60' },
      { ein: '00-0000503', name: 'UNKNOWN STATUS FUND', city: 'MOSSVALE', state: 'VT', subsection: '501(c)(3)', foundationCode: '15', deductibility: '1', status: 'unknown', rulingDate: null, pub78: false, ntee: null },
    ]);
    const pub78 = recs.filter((r) => r.pub78);
    expect(pub78.map((r) => r.ein)).toEqual(['00-0000501', '00-0000599']);
    expect(pub78[1]).toMatchObject({ deductibility: 'PF', status: 'unknown' });
    const revoked = recs.filter((r) => r.status === 'revoked');
    expect(revoked.map((r) => r.ein)).toEqual(['00-0000503']); // the reinstated org is skipped
  });

  it('rejects files that are not BMF extracts', async () => {
    const { fetch } = mockDownloads({ 'https://x.example/eo.csv': 'A,B\n1,2' });
    const src = new LiveDiligenceSource({ fetch, bmfUrls: ['https://x.example/eo.csv'], pub78Url: null, revocationUrl: null });
    await expect(collect(src.irsRecords())).rejects.toThrow(/EO BMF/);
    const missing = new LiveDiligenceSource({ fetch, bmfUrls: ['https://x.example/missing.csv'] });
    await expect(collect(missing.irsRecords())).rejects.toThrow(/404/);
  });

  it('reads stored and deflated zip entries', () => {
    expect(new TextDecoder().decode(readZip(makeZip('a.txt', 'hello'))[0]!.data)).toBe('hello');
    expect(() => readZip(new Uint8Array([1, 2, 3]))).toThrow(/not a zip/);
  });
});

describe('OFAC importer', () => {
  it('parses SDN rows and aliases with programs', async () => {
    const { fetch } = mockDownloads({ [OFAC_SDN_URL]: SDN_CSV, [OFAC_ALT_URL]: ALT_CSV });
    const recs: SanctionsRecord[] = await collect(new LiveDiligenceSource({ fetch }).sanctionsRecords());
    expect(recs).toEqual([
      { uid: '90001', name: 'ZORVANE KILDRAKE TRADING CO.', entryType: 'Entity', programs: ['DEMO-SDGT', 'DEMO-IRGC'], remarks: 'Fictional test row.' },
      { uid: '90002', name: 'MALTRAVIC, Oskel', entryType: 'Individual', programs: ['DEMO-CYBER'], remarks: null },
      { uid: '90001-alt-501', name: 'ZORVANE KILDRAKE LLC', entryType: 'Entity', programs: ['DEMO-SDGT', 'DEMO-IRGC'], remarks: 'aka of ZORVANE KILDRAKE TRADING CO.' },
      { uid: '90002-alt-502', name: 'MALTRAVIC, O.', entryType: 'Individual', programs: ['DEMO-CYBER'], remarks: 'fka of MALTRAVIC, Oskel' },
    ]);
    const noAlias = await collect(new LiveDiligenceSource({ fetch, includeAliases: false }).sanctionsRecords());
    expect(noAlias).toHaveLength(2);
    expect(parsePrograms('-0- ')).toEqual([]);
  });
});
