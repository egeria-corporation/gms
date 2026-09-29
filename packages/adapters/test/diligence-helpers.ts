// SPDX-License-Identifier: AGPL-3.0-or-later
// Test data builders for the IRS/OFAC importers (fictional rows only) and an in-memory fetch.
import { deflateRawSync } from 'node:zlib';
import type { FetchLike } from '../src/http';

/** Builds a single-entry deflate ZIP (enough for the Pub 78 / revocation readers). */
export function makeZip(name: string, content: string): Uint8Array {
  const data = Buffer.from(content, 'latin1');
  const comp = deflateRawSync(data);
  const nameBuf = Buffer.from(name);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(comp.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  const cen = Buffer.alloc(46);
  cen.writeUInt32LE(0x02014b50, 0);
  cen.writeUInt16LE(20, 4);
  cen.writeUInt16LE(20, 6);
  cen.writeUInt16LE(8, 10);
  cen.writeUInt32LE(comp.length, 20);
  cen.writeUInt32LE(data.length, 24);
  cen.writeUInt16LE(nameBuf.length, 28);
  cen.writeUInt32LE(0, 42);
  const cenOffset = local.length + nameBuf.length + comp.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(cen.length + nameBuf.length, 12);
  eocd.writeUInt32LE(cenOffset, 16);
  return new Uint8Array(Buffer.concat([local, nameBuf, comp, cen, nameBuf, eocd]));
}

export const BMF_CSV = [
  'EIN,NAME,ICO,STREET,CITY,STATE,ZIP,GROUP,SUBSECTION,AFFILIATION,CLASSIFICATION,RULING,DEDUCTIBILITY,FOUNDATION,ACTIVITY,ORGANIZATION,STATUS,TAX_PERIOD,ASSET_CD,INCOME_CD,FILING_REQ_CD,PF_FILING_REQ_CD,ACCT_PD,ASSET_AMT,INCOME_AMT,REVENUE_AMT,NTEE_CD,SORT_NAME',
  '000000501,"QUILLON BAY LANTERN SOCIETY",,1 MAIN ST,QUILLON BAY,ME,04000-0000,0000,03,3,1000,201104,1,15,000000000,1,01,202312,0,0,01,0,12,0,0,0,A20,',
  '000000502,"HARROW GLEN, TIDE & KITE CLUB",,2 MAIN ST,HARROW GLEN,OR,97000,0000,07,3,1000,000000,2,00,000000000,1,01,202312,0,0,01,0,12,0,0,0,N60,',
  '000000503,"UNKNOWN STATUS FUND",,3 MAIN ST,MOSSVALE,VT,05000,0000,03,3,1000,199913,1,15,000000000,1,20,202312,0,0,01,0,12,0,0,0,,',
  'bad-ein,"NO EIN ORG",,,,,,,,,,,,,,,,,,,,,,,,,,',
].join('\r\n');

export const PUB78_TXT = ['000000501|Quillon Bay Lantern Society|Quillon Bay|ME|United States|PC', '000000599|Pub78 Only Trust|Wrenfield|WA|United States|PF', ''].join('\r\n');

export const REVOCATION_TXT = [
  '000000503|UNKNOWN STATUS FUND||3 MAIN ST|MOSSVALE|VT|05000|US|03|2020-05-15|2020-08-10|',
  '000000504|REINSTATED GUILD||4 MAIN ST|MOSSVALE|VT|05000|US|03|2019-05-15|2019-08-10|2021-01-01',
].join('\n');

// SDN.CSV has no header; "-0-" marks empty values. All entries are fictional.
export const SDN_CSV = [
  '90001,"ZORVANE KILDRAKE TRADING CO.","-0- ","DEMO-SDGT] [DEMO-IRGC","-0- ","-0- ","-0- ","-0- ","-0- ","-0- ","-0- ","Fictional test row."',
  '90002,"MALTRAVIC, Oskel","individual","DEMO-CYBER","-0- ","-0- ","-0- ","-0- ","-0- ","-0- ","-0- ","-0- "',
  '',
].join('\r\n');

export const ALT_CSV = ['90001,501,"aka","ZORVANE KILDRAKE LLC","-0- "', '90002,502,"fka","MALTRAVIC, O.","-0- "'].join('\r\n');

export function mockDownloads(files: Record<string, string | Uint8Array>): { fetch: FetchLike; requested: string[] } {
  const requested: string[] = [];
  return {
    requested,
    fetch: async (input) => {
      const url = String(input);
      requested.push(url);
      const body = files[url];
      if (body === undefined) return new Response('not found', { status: 404 });
      const bytes = typeof body === 'string' ? Buffer.from(body, 'latin1') : body;
      // Stream in small chunks to exercise incremental parsing.
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          for (let i = 0; i < bytes.length; i += 7) controller.enqueue(new Uint8Array(bytes.subarray(i, i + 7)));
          controller.close();
        },
      });
      return new Response(stream, { status: 200 });
    },
  };
}
