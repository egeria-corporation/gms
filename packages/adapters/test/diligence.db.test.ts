// SPDX-License-Identifier: AGPL-3.0-or-later
import { sql } from '@gms/db';
import { createTestDatabase, type TestDatabase } from '@gms/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FIXTURE_IRS_RECORDS, FIXTURE_NEAR_MATCH, FixtureDiligenceSource } from '../src/diligence/fixtures';
import { importDiligence, LiveDiligenceSource } from '../src/diligence/import';
import { IRS_BMF_URLS, IRS_PUB78_URL, IRS_REVOCATION_URL } from '../src/diligence/irs';
import { OFAC_ALT_URL, OFAC_SDN_URL } from '../src/diligence/ofac';
import { ALT_CSV, BMF_CSV, makeZip, mockDownloads, PUB78_TXT, REVOCATION_TXT, SDN_CSV } from './diligence-helpers';

let tdb: TestDatabase;

beforeAll(async () => {
  tdb = await createTestDatabase('gms_adapters_diligence');
});
afterAll(async () => {
  await tdb?.drop();
});

async function similarity(a: string, entryName: string): Promise<number> {
  const r = await sql<{ s: number }>`select similarity(gms.normalize_name(${entryName}), gms.normalize_name(${a}))::float8 as s`.execute(tdb.db);
  return Number(r.rows[0]!.s);
}

describe('importDiligence (fixtures)', () => {
  it('imports every fixture row idempotently', async () => {
    const first = await importDiligence(tdb.db, new FixtureDiligenceSource(), { batchSize: 7 });
    expect(first.irs).toBe(FIXTURE_IRS_RECORDS.length);
    expect(first.sanctions).toBe(40);
    await importDiligence(tdb.db, new FixtureDiligenceSource());
    const irs = await tdb.db.selectFrom('irs_exempt_orgs').selectAll().where('source', '=', 'fixture').execute();
    expect(irs).toHaveLength(FIXTURE_IRS_RECORDS.length);
    expect(irs.find((r) => r.ein === '00-0000009')!.status).toBe('revoked');
    expect(irs.find((r) => r.ein === '00-0000001')).toMatchObject({ city: 'Larkspur', state: 'CA', pub78: true, ruling_date: '2011-04-01' });
    const entries = await tdb.db.selectFrom('sanctions_entries').select(['source_uid', 'name_normalized', 'programs']).where('source', '=', 'fixture').execute();
    expect(entries).toHaveLength(40);
    expect(entries.find((e) => e.source_uid === 'FIX-0001')!.name_normalized).toBe('cedar holow food pantri trading');
  });

  it('screens "Cedar Hollow Food Pantry" into the 0.45–0.8 review range via pg_trgm', async () => {
    const score = await similarity('Cedar Hollow Food Pantry', FIXTURE_NEAR_MATCH.name);
    expect(score).toBeGreaterThanOrEqual(0.45);
    expect(score).toBeLessThanOrEqual(0.8);
    const r = await sql<{ name: string; score: number }>`select name, score::float8 as score from gms.sanctions_search(${'Cedar Hollow Food Pantry'}, 0.45)`.execute(tdb.db);
    expect(r.rows.map((x) => x.name)).toEqual([FIXTURE_NEAR_MATCH.name]);
  });

  it('produces no other potential matches for fixture organizations', async () => {
    for (const org of FIXTURE_IRS_RECORDS) {
      const r = await sql<{ name: string }>`select name from gms.sanctions_search(${org.name}, 0.45)`.execute(tdb.db);
      const expected = org.name === 'Cedar Hollow Food Pantry' ? [FIXTURE_NEAR_MATCH.name] : [];
      expect({ org: org.name, hits: r.rows.map((x) => x.name) }).toEqual({ org: org.name, hits: expected });
    }
    for (const project of ['Lumen Literacy Project']) {
      const r = await sql<{ name: string }>`select name from gms.sanctions_search(${project}, 0.45)`.execute(tdb.db);
      expect(r.rows).toEqual([]);
    }
  });
});

describe('importDiligence (live source, mocked network)', () => {
  it('merges BMF, Pub 78 and revocations and imports OFAC with aliases', async () => {
    const { fetch } = mockDownloads({
      [IRS_BMF_URLS[0]!]: BMF_CSV,
      [IRS_PUB78_URL]: makeZip('pub78.txt', PUB78_TXT),
      [IRS_REVOCATION_URL]: makeZip('revocation.txt', REVOCATION_TXT),
      [OFAC_SDN_URL]: SDN_CSV,
      [OFAC_ALT_URL]: ALT_CSV,
    });
    const r = await importDiligence(tdb.db, new LiveDiligenceSource({ fetch, bmfUrls: [IRS_BMF_URLS[0]!] }));
    expect(r).toEqual({ irs: 6, sanctions: 4 });
    const rows = await tdb.db.selectFrom('irs_exempt_orgs').selectAll().where('ein', 'in', ['00-0000501', '00-0000503', '00-0000599']).orderBy('ein').execute();
    // BMF data kept, Pub 78 flag merged in.
    expect(rows[0]).toMatchObject({ ein: '00-0000501', name: 'Quillon Bay Lantern Society', subsection: '501(c)(3)', status: 'active', pub78: true, source: 'bmf', city: 'Quillon Bay' });
    // Revocation wins over unknown.
    expect(rows[1]).toMatchObject({ ein: '00-0000503', status: 'revoked', subsection: '501(c)(3)', foundation_code: '15' });
    // Pub 78-only organization.
    expect(rows[2]).toMatchObject({ ein: '00-0000599', status: 'unknown', pub78: true, source: 'pub78' });
    const sdn = await tdb.db.selectFrom('sanctions_entries').select(['source_uid', 'name_normalized', 'programs']).where('source', '=', 'ofac_sdn').orderBy('source_uid').execute();
    expect(sdn.map((s) => s.source_uid)).toEqual(['90001', '90001-alt-501', '90002', '90002-alt-502']);
    expect(sdn[0]!.name_normalized).toBe('zorvane kildrake trading');
    expect(sdn[0]!.programs).toEqual(['DEMO-SDGT', 'DEMO-IRGC']);
  });

  it('honors limit per dataset', async () => {
    const { fetch } = mockDownloads({ [OFAC_SDN_URL]: SDN_CSV, [OFAC_ALT_URL]: ALT_CSV });
    const r = await importDiligence(tdb.db, new LiveDiligenceSource({ fetch }), { only: 'sanctions', limit: 1 });
    expect(r).toEqual({ irs: 0, sanctions: 1 });
  });
});
