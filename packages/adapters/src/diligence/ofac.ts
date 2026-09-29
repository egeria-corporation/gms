// SPDX-License-Identifier: AGPL-3.0-or-later
// OFAC SDN importer. The legacy https://www.treasury.gov/ofac/downloads/sdn.csv now redirects to the Sanctions
// List Service export below (checked 2026-09-27). SDN.CSV has no header row; columns:
//   ent_num, SDN_Name, SDN_Type, Program, Title, Call_Sign, Vess_type, Tonnage, GRT, Vess_flag, Vess_owner, Remarks
// Empty values are written as "-0-". ALT.CSV (aliases): ent_num, alt_num, alt_type, alt_name, alt_remarks.
import { decodeText, parseCsvStream } from '../csv';
import type { FetchLike } from '../http';
import type { SanctionsRecord } from '../types';

export const OFAC_SDN_URL = 'https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/SDN.CSV';
export const OFAC_ALT_URL = 'https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/ALT.CSV';

function val(s: string | undefined): string | null {
  const t = (s ?? '').trim();
  return !t || t === '-0-' ? null : t;
}

/** "SDGT] [IRGC" → ["SDGT", "IRGC"] */
export function parsePrograms(s: string | undefined): string[] {
  const v = val(s);
  if (!v) return [];
  return v
    .split(/\]\s*\[/)
    .map((p) => p.replace(/[[\]]/g, '').trim())
    .filter(Boolean);
}

export function sdnRowToRecord(r: string[]): SanctionsRecord | null {
  const uid = val(r[0]);
  const name = val(r[1]);
  if (!uid || !name || !/^\d+$/.test(uid)) return null;
  const type = val(r[2]);
  return {
    uid,
    name,
    entryType: type ? type.charAt(0).toUpperCase() + type.slice(1).toLowerCase() : 'Entity',
    programs: parsePrograms(r[3]),
    remarks: val(r[11]),
  };
}

export async function* sdnRecordsFromRows(rows: AsyncIterable<string[]>): AsyncGenerator<SanctionsRecord> {
  for await (const r of rows) {
    const rec = sdnRowToRecord(r);
    if (rec) yield rec;
  }
}

export async function* altRecordsFromRows(
  rows: AsyncIterable<string[]>,
  parents: ReadonlyMap<string, SanctionsRecord>,
): AsyncGenerator<SanctionsRecord> {
  for await (const r of rows) {
    const ent = val(r[0]);
    const alt = val(r[1]);
    const name = val(r[3]);
    if (!ent || !alt || !name || !/^\d+$/.test(ent)) continue;
    const parent = parents.get(ent);
    yield {
      uid: `${ent}-alt-${alt}`,
      name,
      entryType: parent?.entryType ?? null,
      programs: parent ? [...parent.programs] : [],
      remarks: [`${val(r[2]) ?? 'a.k.a.'} of ${parent?.name ?? `entry ${ent}`}`, val(r[4])].filter(Boolean).join('; '),
    };
  }
}

async function rowsFrom(fetchImpl: FetchLike, url: string): Promise<AsyncGenerator<string[]>> {
  const res = await fetchImpl(url, { headers: { 'user-agent': 'GMS diligence importer' } });
  if (!res.ok || !res.body) throw new Error(`download failed (${res.status}) for ${url}`);
  return parseCsvStream(decodeText(res.body, 'windows-1252'));
}

/** Streams SDN entries, then (optionally) their aliases as separate searchable entries. */
export async function* streamOfac(
  fetchImpl: FetchLike,
  opts: { sdnUrl?: string; altUrl?: string; includeAliases?: boolean } = {},
): AsyncGenerator<SanctionsRecord> {
  const parents = new Map<string, SanctionsRecord>();
  for await (const rec of sdnRecordsFromRows(await rowsFrom(fetchImpl, opts.sdnUrl ?? OFAC_SDN_URL))) {
    parents.set(rec.uid, rec);
    yield rec;
  }
  if (opts.includeAliases === false) return;
  yield* altRecordsFromRows(await rowsFrom(fetchImpl, opts.altUrl ?? OFAC_ALT_URL), parents);
}
