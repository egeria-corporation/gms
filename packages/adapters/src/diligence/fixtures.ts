// SPDX-License-Identifier: AGPL-3.0-only
// Bundled diligence data for demos, tests and the plain-Postgres tier. EVERYTHING HERE IS FICTIONAL:
// the EINs use the never-issued 00- prefix, and no row describes a real organization or a real sanctions
// listing. Program codes are prefixed "DEMO-" so fixture sanctions entries can never be mistaken for OFAC data.
import type { DiligenceSource, IrsRecord, SanctionsRecord } from '../types';

const PC = { subsection: '501(c)(3)', foundationCode: '15', deductibility: '1' } as const;

/** Named demo organizations referenced by the seed and the docs. */
export const FIXTURE_IRS_NAMED: readonly IrsRecord[] = [
  {
    ein: '00-0000001',
    name: 'Eastside Youth Music Collective',
    city: 'Larkspur',
    state: 'CA',
    ...PC,
    status: 'active',
    rulingDate: '2011-04-01',
    pub78: true,
    ntee: 'A68',
  },
  {
    // Fiscal sponsor of the "Lumen Literacy Project" (the project has no EIN of its own).
    ein: '00-0000002',
    name: 'Commons Fiscal Partners',
    city: 'Harrow Glen',
    state: 'OR',
    ...PC,
    status: 'active',
    rulingDate: '2004-09-01',
    pub78: true,
    ntee: 'T99',
  },
  {
    ein: '00-0000003',
    name: 'Cedar Hollow Food Pantry',
    city: 'Wrenfield',
    state: 'WA',
    ...PC,
    status: 'active',
    rulingDate: '2016-02-01',
    pub78: true,
    ntee: 'K31',
  },
  {
    // Revoked: exercises the IRS status-warning path.
    ein: '00-0000009',
    name: 'Old Mill Arts Guild',
    city: 'Mossvale',
    state: 'VT',
    ...PC,
    status: 'revoked',
    rulingDate: '1998-06-01',
    pub78: false,
    ntee: 'A20',
  },
];

/** Fiscally sponsored projects (no EIN): project name → sponsor EIN. */
export const FIXTURE_FISCAL_SPONSORSHIPS: Readonly<Record<string, string>> = {
  'Lumen Literacy Project': '00-0000002',
};

const GENERATED_ORGS: readonly [string, string, string, string][] = [
  ['Harrow Glen Watershed Stewards', 'Harrow Glen', 'OR', 'C32'],
  ['Wrenfield Tenant Resource Center', 'Wrenfield', 'WA', 'L41'],
  ['Mossvale Senior Companions', 'Mossvale', 'VT', 'P81'],
  ['Alder County Bicycle Kitchen', 'Larkspur', 'CA', 'N99'],
  ['Quillon Bay Oyster Restoration League', 'Quillon Bay', 'ME', 'C34'],
  ['Brightwater Refugee Welcome Circle', 'Brightwater', 'MN', 'P84'],
  ['Thistle Ridge Rural Health Cooperative', 'Thistle Ridge', 'NE', 'E32'],
  ['Saltmarsh Maker Library', 'Saltmarsh', 'NC', 'B70'],
  ['Kestrel Point Youth Rowing', 'Kestrel Point', 'MI', 'N67'],
  ['Juniper Flats Adult Learning Hub', 'Juniper Flats', 'NM', 'B60'],
  ['Northgate Legal Aid Clinic', 'Northgate', 'IL', 'I80'],
  ['Pinecrest Seed Library', 'Pinecrest', 'CO', 'C41'],
  ['Larkspur Neighborhood Mediation Project', 'Larkspur', 'CA', 'I21'],
  ['Emberly Street Theater Company', 'Emberly', 'PA', 'A65'],
  ['Foxglove Family Resource Network', 'Foxglove', 'KY', 'P40'],
  ['Silverbirch Wildlife Rehabilitation', 'Silverbirch', 'WI', 'D34'],
  ['Copper Hollow Digital Inclusion Lab', 'Copper Hollow', 'AZ', 'B99'],
  ['Marrowstone Community Radio', 'Marrowstone', 'WA', 'A34'],
  ['Tidewell Housing Land Trust', 'Tidewell', 'VA', 'L22'],
  ['Greyfield Veterans Peer Support', 'Greyfield', 'OH', 'W30'],
  ['Brambleton Early Childhood Collaborative', 'Brambleton', 'GA', 'B21'],
  ['Oakhaven Dance Collective', 'Oakhaven', 'TX', 'A62'],
  ['Stillwater Crisis Line Volunteers', 'Stillwater Crossing', 'MO', 'F40'],
  ['Hollin Park Urban Orchard', 'Hollin Park', 'NY', 'C42'],
  ['Redfern Immigrant Workers Center', 'Redfern', 'NJ', 'J40'],
  ['Clearbrook Adaptive Sports', 'Clearbrook', 'UT', 'N50'],
  ['Wildrye Prairie Conservancy', 'Wildrye', 'KS', 'C36'],
  ['Lanternfield Public Art Fund', 'Lanternfield', 'MA', 'A40'],
  ['Ferncliff Maternal Health Partners', 'Ferncliff', 'SC', 'E70'],
  ['Cobalt Mesa STEM Girls', 'Cobalt Mesa', 'NV', 'U40'],
];

export const FIXTURE_IRS_GENERATED: readonly IrsRecord[] = GENERATED_ORGS.map(([name, city, state, ntee], i) => ({
  ein: `00-0000${String(100 + i).padStart(3, '0')}`,
  name,
  city,
  state,
  ...PC,
  // A couple of variations so filters and badges have something to show.
  foundationCode: i % 10 === 7 ? '04' : PC.foundationCode,
  status: 'active' as const,
  rulingDate: `${2000 + (i % 24)}-${String((i % 12) + 1).padStart(2, '0')}-01`,
  pub78: i % 10 !== 7,
  ntee,
}));

export const FIXTURE_IRS_RECORDS: readonly IrsRecord[] = [...FIXTURE_IRS_NAMED, ...FIXTURE_IRS_GENERATED];

/**
 * The single fuzzy near-match used to demo sanctions review: screening "Cedar Hollow Food Pantry" scores in
 * the 0.45–0.8 trigram range against this entry (verified in fixtures.db.test.ts). It is fictional.
 */
export const FIXTURE_NEAR_MATCH: SanctionsRecord = {
  uid: 'FIX-0001',
  name: 'Cedar Holow Food Pantri Trading LLC',
  entryType: 'Entity',
  programs: ['DEMO-TRADE'],
  remarks: 'Fictional entry for demonstrations. Near-match for review-queue testing.',
};

const SANCTIONS_ENTITIES: readonly [string, string][] = [
  ['Obsidian Tern Maritime Holdings', 'DEMO-MARITIME'],
  ['Vantrell Qazimir Logistics FZE', 'DEMO-TRADE'],
  ['Kharvost Pellucid Minerals', 'DEMO-MINING'],
  ['Zerwick Nightjar Freight Forwarding', 'DEMO-TRADE'],
  ['Ultramar Gossamer Petrochem', 'DEMO-ENERGY'],
  ['Brastova Kilnworks Industrial Group', 'DEMO-INDUSTRY'],
  ['Quendrix Halloway Capital Partners', 'DEMO-FINANCE'],
  ['Morvane Isklander Shipping Line', 'DEMO-MARITIME'],
  ['Talvoreth Cobaltine Exports', 'DEMO-MINING'],
  ['Yzmerit Aerodyne Components', 'DEMO-AVIATION'],
  ['Pelgrave Umbrine Exchange House', 'DEMO-FINANCE'],
  ['Drossvald Arcturine Chemicals', 'DEMO-INDUSTRY'],
  ['Scarrow Vexholm Telecom', 'DEMO-CYBER'],
  ['Norrhavik Blackglass Security Services', 'DEMO-CYBER'],
  ['Ostrevin Tallowmere Agro Holdings', 'DEMO-TRADE'],
  ['Kavrosk Leadwing Airlines', 'DEMO-AVIATION'],
  ['Gremlauth Sarrow Precious Metals', 'DEMO-MINING'],
  ['Hexmoor Quillfin Tanker Company', 'DEMO-MARITIME'],
  ['Vorlaine Ibexfield Construction', 'DEMO-INDUSTRY'],
  ['Ashkarel Mirrowin Investments', 'DEMO-FINANCE'],
  ['Zolvenko Driftmark Cargo', 'DEMO-TRADE'],
  ['Crennick Varsovar Energy Trading', 'DEMO-ENERGY'],
  ['Istrand Pomeroth Microelectronics', 'DEMO-CYBER'],
  ['Belmaric Thornquay Ship Management', 'DEMO-MARITIME'],
  ['Fennrow Osgallin Timber Exports', 'DEMO-TRADE'],
];

const SANCTIONS_INDIVIDUALS: readonly [string, string][] = [
  ['KALVORETH, Dmitran Osk', 'DEMO-FINANCE'],
  ['VESHNARI, Ilyavet', 'DEMO-CYBER'],
  ['ORVANDEL, Pasko Mirren', 'DEMO-TRADE'],
  ['TRAZKOVIC, Helmar Zinn', 'DEMO-MARITIME'],
  ['QUILLANE, Soravet Ansk', 'DEMO-ENERGY'],
  ['MAZREDDIN, Tovhal', 'DEMO-MINING'],
  ['GRENSKOLD, Ivarro Petz', 'DEMO-INDUSTRY'],
  ['ZANTHIMER, Oleskav', 'DEMO-AVIATION'],
  ['BRUVANOK, Selidar Mott', 'DEMO-FINANCE'],
  ['HOLLENVAR, Kestrin Oduz', 'DEMO-CYBER'],
  ['PRAVISKE, Momcilan', 'DEMO-TRADE'],
  ['DURNAVEK, Aslo Viremm', 'DEMO-MARITIME'],
  ['XERVANDI, Loskar', 'DEMO-ENERGY'],
  ['FALKORVIN, Radomar Uzt', 'DEMO-INDUSTRY'],
];

export const FIXTURE_SANCTIONS_RECORDS: readonly SanctionsRecord[] = [
  FIXTURE_NEAR_MATCH,
  ...SANCTIONS_ENTITIES.map(([name, program], i) => ({
    uid: `FIX-${String(i + 2).padStart(4, '0')}`,
    name,
    entryType: 'Entity',
    programs: [program],
    remarks: 'Fictional entry for demonstrations.',
  })),
  ...SANCTIONS_INDIVIDUALS.map(([name, program], i) => ({
    uid: `FIX-${String(i + 2 + SANCTIONS_ENTITIES.length).padStart(4, '0')}`,
    name,
    entryType: 'Individual',
    programs: [program],
    remarks: 'Fictional entry for demonstrations.',
  })),
];

export class FixtureDiligenceSource implements DiligenceSource {
  readonly name = 'fixtures' as const;

  async *irsRecords(): AsyncIterable<IrsRecord> {
    for (const r of FIXTURE_IRS_RECORDS) yield { ...r };
  }

  async *sanctionsRecords(): AsyncIterable<SanctionsRecord> {
    for (const r of FIXTURE_SANCTIONS_RECORDS) yield { ...r, programs: [...r.programs] };
  }
}
