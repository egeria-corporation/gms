// SPDX-License-Identifier: AGPL-3.0-only
// Live diligence source (IRS + OFAC over the network) and the importer that upserts any DiligenceSource into
// public.irs_exempt_orgs / public.sanctions_entries (service role; run by the worker or `pnpm seed`).
import { sql, type Database } from '@gms/db';
import type { FetchLike } from '../http';
import type { DiligenceSource, IrsRecord, SanctionsRecord } from '../types';
import { IRS_BMF_URLS, IRS_PUB78_URL, IRS_REVOCATION_URL, streamBmf, streamPub78, streamRevocations } from './irs';
import { OFAC_ALT_URL, OFAC_SDN_URL, streamOfac } from './ofac';

export interface LiveDiligenceOptions {
  fetch?: FetchLike;
  bmfUrls?: string[];
  pub78Url?: string | null;
  revocationUrl?: string | null;
  sdnUrl?: string;
  altUrl?: string;
  includeAliases?: boolean;
}

export class LiveDiligenceSource implements DiligenceSource {
  readonly name = 'irs-ofac' as const;
  private readonly fetchImpl: FetchLike;

  constructor(private readonly opts: LiveDiligenceOptions = {}) {
    this.fetchImpl = opts.fetch ?? ((input, init) => fetch(input, init));
  }

  /** BMF first, then Pub 78 eligibility, then revocations (so revoked status wins). */
  async *irsRecords(): AsyncIterable<IrsRecord> {
    for (const url of this.opts.bmfUrls ?? IRS_BMF_URLS) yield* streamBmf(this.fetchImpl, url);
    if (this.opts.pub78Url !== null) yield* streamPub78(this.fetchImpl, this.opts.pub78Url ?? IRS_PUB78_URL);
    if (this.opts.revocationUrl !== null) yield* streamRevocations(this.fetchImpl, this.opts.revocationUrl ?? IRS_REVOCATION_URL);
  }

  async *sanctionsRecords(): AsyncIterable<SanctionsRecord> {
    yield* streamOfac(this.fetchImpl, {
      sdnUrl: this.opts.sdnUrl ?? OFAC_SDN_URL,
      altUrl: this.opts.altUrl ?? OFAC_ALT_URL,
      includeAliases: this.opts.includeAliases,
    });
  }
}

export interface ImportDiligenceResult {
  irs: number;
  sanctions: number;
}

async function* take<T>(it: AsyncIterable<T>, limit: number | undefined): AsyncGenerator<T> {
  if (limit !== undefined && limit <= 0) return;
  let n = 0;
  for await (const v of it) {
    yield v;
    if (limit !== undefined && ++n >= limit) return;
  }
}

async function batches<T>(it: AsyncIterable<T>, size: number, fn: (batch: T[]) => Promise<void>): Promise<number> {
  let batch: T[] = [];
  let total = 0;
  for await (const v of it) {
    batch.push(v);
    if (batch.length >= size) {
      await fn(batch);
      total += batch.length;
      batch = [];
    }
  }
  if (batch.length) {
    await fn(batch);
    total += batch.length;
  }
  return total;
}

/** Collapses records with the same key within a batch (ON CONFLICT cannot touch a row twice in one statement). */
function dedupe<T>(rows: T[], key: (r: T) => string, merge: (prev: T, next: T) => T = (_p, n) => n): T[] {
  const m = new Map<string, T>();
  for (const r of rows) {
    const k = key(r);
    const prev = m.get(k);
    m.set(k, prev ? merge(prev, r) : r);
  }
  return [...m.values()];
}

/** Same merge rules as the SQL upsert below, applied in memory within a batch. */
function mergeIrs(prev: IrsRecord, next: IrsRecord): IrsRecord {
  return {
    ein: next.ein,
    name: next.name,
    city: next.city ?? prev.city,
    state: next.state ?? prev.state,
    subsection: next.subsection ?? prev.subsection,
    foundationCode: next.foundationCode ?? prev.foundationCode,
    deductibility: next.deductibility ?? prev.deductibility,
    status: next.status === 'unknown' ? prev.status : next.status,
    rulingDate: next.rulingDate ?? prev.rulingDate,
    pub78: prev.pub78 || next.pub78,
    ntee: next.ntee ?? prev.ntee,
  };
}

/**
 * Upserts a source. IRS rows merge field by field: nulls never overwrite known values, `pub78` is sticky once
 * true, and status "unknown" never overwrites a known status. `limit` caps records per dataset.
 */
export async function importDiligence(
  db: Database,
  source: DiligenceSource,
  opts: { limit?: number; batchSize?: number; only?: 'irs' | 'sanctions' } = {},
): Promise<ImportDiligenceResult> {
  const batchSize = opts.batchSize ?? 1000;
  const fixture = source.name === 'fixtures';
  let irs = 0;
  let sanctions = 0;

  if (opts.only !== 'sanctions') {
    irs = await batches(take(source.irsRecords(), opts.limit), batchSize, async (raw) => {
      const rows = dedupe(raw, (r) => r.ein, mergeIrs);
      const src = (r: IrsRecord) => (fixture ? 'fixture' : r.pub78 && r.subsection === null && r.status === 'unknown' ? 'pub78' : 'bmf');
      await db
        .insertInto('irs_exempt_orgs')
        .values(
          rows.map((r) => ({
            ein: r.ein,
            name: r.name,
            city: r.city,
            state: r.state,
            subsection: r.subsection,
            foundation_code: r.foundationCode,
            deductibility: r.deductibility,
            status: r.status,
            ruling_date: r.rulingDate,
            pub78: r.pub78,
            ntee: r.ntee,
            source: src(r),
          })),
        )
        .onConflict((oc) =>
          oc.column('ein').doUpdateSet({
            name: sql`excluded.name`,
            city: sql`coalesce(excluded.city, irs_exempt_orgs.city)`,
            state: sql`coalesce(excluded.state, irs_exempt_orgs.state)`,
            subsection: sql`coalesce(excluded.subsection, irs_exempt_orgs.subsection)`,
            foundation_code: sql`coalesce(excluded.foundation_code, irs_exempt_orgs.foundation_code)`,
            deductibility: sql`coalesce(excluded.deductibility, irs_exempt_orgs.deductibility)`,
            status: sql`case when excluded.status = 'unknown' then irs_exempt_orgs.status else excluded.status end`,
            ruling_date: sql`coalesce(excluded.ruling_date, irs_exempt_orgs.ruling_date)`,
            pub78: sql`irs_exempt_orgs.pub78 or excluded.pub78`,
            ntee: sql`coalesce(excluded.ntee, irs_exempt_orgs.ntee)`,
            source: sql`case when irs_exempt_orgs.source = 'bmf' and excluded.source = 'pub78' then 'bmf' else excluded.source end`,
            imported_at: sql`now()`,
          }),
        )
        .execute();
    });
  }

  if (opts.only !== 'irs') {
    const sourceLabel = fixture ? 'fixture' : 'ofac_sdn';
    sanctions = await batches(take(source.sanctionsRecords(), opts.limit), batchSize, async (raw) => {
      const rows = dedupe(raw, (r) => r.uid);
      await db
        .insertInto('sanctions_entries')
        .values(
          rows.map((r) => ({
            source: sourceLabel,
            source_uid: r.uid,
            name: r.name,
            name_normalized: sql<string>`gms.normalize_name(${r.name})`,
            entry_type: r.entryType,
            programs: r.programs,
            remarks: r.remarks,
          })),
        )
        .onConflict((oc) =>
          oc.columns(['source', 'source_uid']).doUpdateSet({
            name: sql`excluded.name`,
            name_normalized: sql`excluded.name_normalized`,
            entry_type: sql`excluded.entry_type`,
            programs: sql`excluded.programs`,
            remarks: sql`excluded.remarks`,
            imported_at: sql`now()`,
          }),
        )
        .execute();
    });
  }

  return { irs, sanctions };
}
