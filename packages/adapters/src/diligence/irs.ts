// SPDX-License-Identifier: AGPL-3.0-or-later
// IRS importers:
//  - EO BMF extract: regional CSVs eo1.csv…eo4.csv at https://www.irs.gov/pub/irs-soi/ (header row; EIN, NAME,
//    CITY, STATE, SUBSECTION, RULING (YYYYMM), DEDUCTIBILITY, FOUNDATION, STATUS, NTEE_CD, …), streamed.
//  - Publication 78 (orgs eligible for deductible contributions): pipe-delimited text in
//    https://apps.irs.gov/pub/epostcard/data-download-pub78.zip  (EIN|Name|City|State|Country|Deductibility)
//  - Automatic revocations: https://apps.irs.gov/pub/epostcard/data-download-revocation.zip
//    (EIN|Legal Name|DBA|Address|City|State|ZIP|Country|Exemption Type|Revocation Date|Posting Date|Reinstatement Date)
// Network access goes through an injected fetch; tests never touch the network.
import { decodeText, parseCsvStream } from '../csv';
import type { FetchLike } from '../http';
import type { IrsRecord } from '../types';
import { readZip } from './zip';

export const IRS_BMF_URLS = ['eo1', 'eo2', 'eo3', 'eo4'].map((r) => `https://www.irs.gov/pub/irs-soi/${r}.csv`);
export const IRS_PUB78_URL = 'https://apps.irs.gov/pub/epostcard/data-download-pub78.zip';
export const IRS_REVOCATION_URL = 'https://apps.irs.gov/pub/epostcard/data-download-revocation.zip';

/** "123456789" / "12-3456789" → "12-3456789"; null when not nine digits. */
export function formatEin(raw: string): string | null {
  const d = raw.replace(/\D/g, '');
  if (d.length !== 9) return null;
  return `${d.slice(0, 2)}-${d.slice(2)}`;
}

/** BMF SUBSECTION "03" → "501(c)(3)". */
export function formatSubsection(code: string | undefined): string | null {
  const c = (code ?? '').trim();
  if (!/^\d{1,2}$/.test(c) || Number(c) === 0) return null;
  return `501(c)(${Number(c)})`;
}

/** BMF RULING "YYYYMM" → "YYYY-MM-01". */
export function formatRuling(ruling: string | undefined): string | null {
  const r = (ruling ?? '').trim();
  if (!/^\d{6}$/.test(r) || r === '000000') return null;
  const month = Number(r.slice(4));
  if (month < 1 || month > 12) return null;
  return `${r.slice(0, 4)}-${r.slice(4)}-01`;
}

const clean = (s: string | undefined): string | null => {
  const t = (s ?? '').trim();
  return t ? t : null;
};

/** BMF STATUS codes 01 (unconditional), 02 (conditional), 12 (trust), 25 (PF terminating) are exempt. */
export function bmfRowToRecord(row: Record<string, string>): IrsRecord | null {
  const ein = formatEin(row.EIN ?? '');
  const name = clean(row.NAME);
  if (!ein || !name) return null;
  const status = ['01', '02', '12', '25'].includes((row.STATUS ?? '').trim()) ? 'active' : 'unknown';
  return {
    ein,
    name,
    city: clean(row.CITY),
    state: clean(row.STATE),
    subsection: formatSubsection(row.SUBSECTION),
    foundationCode: clean(row.FOUNDATION),
    deductibility: clean(row.DEDUCTIBILITY),
    status,
    rulingDate: formatRuling(row.RULING),
    pub78: false,
    ntee: clean(row.NTEE_CD),
  };
}

export async function* bmfRecordsFromRows(rows: AsyncIterable<string[]>): AsyncGenerator<IrsRecord> {
  let header: string[] | null = null;
  for await (const r of rows) {
    if (!header) {
      header = r.map((h) => h.trim().toUpperCase());
      if (!header.includes('EIN') || !header.includes('NAME')) throw new Error('not an IRS EO BMF file (missing EIN/NAME header)');
      continue;
    }
    const obj: Record<string, string> = {};
    header.forEach((h, i) => {
      obj[h] = r[i] ?? '';
    });
    const rec = bmfRowToRecord(obj);
    if (rec) yield rec;
  }
}

function* pipeLines(text: string): Generator<string[]> {
  for (const line of text.split(/\r?\n/)) {
    if (line.trim()) yield line.split('|');
  }
}

export function* pub78RecordsFromText(text: string): Generator<IrsRecord> {
  for (const f of pipeLines(text)) {
    const ein = formatEin(f[0] ?? '');
    const name = clean(f[1]);
    if (!ein || !name) continue; // also skips a header line if present
    yield {
      ein,
      name,
      city: clean(f[2]),
      state: clean(f[3]),
      subsection: null,
      foundationCode: null,
      deductibility: clean(f[5]),
      // Pub 78 lists eligibility, not exemption status: leave status to the BMF/revocation data.
      status: 'unknown',
      rulingDate: null,
      pub78: true,
      ntee: null,
    };
  }
}

export function* revocationRecordsFromText(text: string): Generator<IrsRecord> {
  for (const f of pipeLines(text)) {
    const ein = formatEin(f[0] ?? '');
    const name = clean(f[1]);
    if (!ein || !name) continue;
    if (clean(f[11])) continue; // reinstated
    yield {
      ein,
      name,
      city: clean(f[4]),
      state: clean(f[5]),
      subsection: formatSubsection(f[8]),
      foundationCode: null,
      deductibility: null,
      status: 'revoked',
      rulingDate: null,
      pub78: false,
      ntee: null,
    };
  }
}

async function download(fetchImpl: FetchLike, url: string): Promise<Response> {
  const res = await fetchImpl(url, { headers: { 'user-agent': 'GMS diligence importer (+https://github.com/egeria-corporation/gms)' } });
  if (!res.ok || !res.body) throw new Error(`download failed (${res.status}) for ${url}`);
  return res;
}

export async function* streamBmf(fetchImpl: FetchLike, url: string): AsyncGenerator<IrsRecord> {
  const res = await download(fetchImpl, url);
  yield* bmfRecordsFromRows(parseCsvStream(decodeText(res.body!, 'windows-1252')));
}

async function zipText(fetchImpl: FetchLike, url: string): Promise<string> {
  const res = await download(fetchImpl, url);
  const entries = readZip(new Uint8Array(await res.arrayBuffer()));
  const entry = entries.find((e) => /\.txt$/i.test(e.name)) ?? entries[0];
  if (!entry) throw new Error(`empty zip: ${url}`);
  return new TextDecoder('windows-1252').decode(entry.data);
}

export async function* streamPub78(fetchImpl: FetchLike, url = IRS_PUB78_URL): AsyncGenerator<IrsRecord> {
  yield* pub78RecordsFromText(await zipText(fetchImpl, url));
}

export async function* streamRevocations(fetchImpl: FetchLike, url = IRS_REVOCATION_URL): AsyncGenerator<IrsRecord> {
  yield* revocationRecordsFromText(await zipText(fetchImpl, url));
}
