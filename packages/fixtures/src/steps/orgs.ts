// SPDX-License-Identifier: AGPL-3.0-only
// Applicant organizations (the applicant commons): the named demo orgs, ~120 generated orgs with verified or
// unverified EINs, and a pool of "alumni" orgs that only appear in past cycles. Each has an org_admin user.
import { FIXTURE_IRS_RECORDS } from '@gms/adapters';
import { sql } from '@gms/db';
import { slugify } from '@gms/domain';
import type { SeedContext } from '../context';
import { demoUser } from '../people';
import { FIRST_NAMES, LAST_NAMES, MISSIONS, ORG_NAME_PARTS, OUTSIDE_PLACES, REGION_PLACES, STREETS, type CauseArea } from '../words';

export interface OrgRec {
  id: string;
  slug: string;
  name: string;
  ein: string | null;
  verified: boolean;
  cause: CauseArea;
  county: string;
  /** County code used by forms: alder | bramble | cinder | other. */
  countyCode: string;
  city: string;
  zip: string;
  street: string;
  budgetCents: number;
  orgType: 'nonprofit_501c3' | 'fiscally_sponsored';
  sponsor: { name: string; ein: string } | null;
  tier: 'named' | 'core' | 'alumni';
  admin: { key: string; id: string; email: string; name: string };
  createdAt: string;
  mission: string;
}

export interface Orgs {
  all: OrgRec[];
  byKey: Record<'eastside' | 'lumen' | 'cedar' | 'oldmill', OrgRec>;
  core: OrgRec[];
  alumni: OrgRec[];
}

const CORE_COUNT = 120;
const ALUMNI_COUNT = 320;

function causeFromNtee(ntee: string | null): CauseArea {
  const c = (ntee ?? 'Z')[0];
  if (c === 'A') return 'arts';
  if (c === 'K') return 'food';
  if (c === 'B') return 'education';
  if (c === 'E' || c === 'F' || c === 'P') return 'health';
  if (c === 'C' || c === 'D') return 'environment';
  if (c === 'L') return 'housing';
  return 'capacity';
}

export async function orgs(ctx: SeedContext): Promise<Orgs> {
  const rng = ctx.stream('orgs');
  const irs = new Map(FIXTURE_IRS_RECORDS.map((r) => [r.ein, r]));
  const out: OrgRec[] = [];
  const usedNames = new Set<string>();
  const usedSlugs = new Set<string>();

  const place = (outside = false) => (outside ? rng.pick(OUTSIDE_PLACES) : rng.pick(REGION_PLACES));
  const person = () => {
    const first = rng.pick(FIRST_NAMES);
    const last = rng.pick(LAST_NAMES);
    return { first, name: `${first} ${last}` };
  };
  const make = (o: Omit<OrgRec, 'id' | 'slug' | 'admin' | 'county' | 'countyCode' | 'city' | 'zip' | 'street' | 'mission'> & { adminKey?: string; adminName?: string; adminEmail?: string; place?: { county: string; city: string; zip: string } }): OrgRec => {
    let slug = slugify(o.name, 40);
    while (usedSlugs.has(slug)) slug = `${slug.slice(0, 36)}-${rng.int(10, 99)}`;
    usedSlugs.add(slug);
    usedNames.add(o.name);
    const p = o.place ?? place();
    const who = o.adminName ? { first: o.adminName.split(' ')[0]!, name: o.adminName } : person();
    const email = o.adminEmail ?? `${who.first.toLowerCase()}@${slug}.example`;
    return {
      ...o,
      id: ctx.id(`org:${slug}`),
      slug,
      county: p.county,
      countyCode: REGION_PLACES.some((r) => r.county === p.county) ? p.county.toLowerCase() : 'other',
      city: p.city,
      zip: p.zip,
      street: `${rng.int(100, 4999)} ${rng.pick(STREETS)}`,
      mission: MISSIONS[o.cause],
      admin: { key: o.adminKey ?? `org:${slug}`, id: ctx.id(`user:${email}`), email, name: who.name },
    };
  };

  // Named demo organizations -----------------------------------------------------------------------------
  const maya = demoUser('maya');
  const theo = demoUser('theo');
  const ada = demoUser('ada');
  const eastside = make({
    name: 'Eastside Youth Music Collective',
    ein: '00-0000001',
    verified: true,
    cause: 'arts',
    budgetCents: 48_000_000,
    orgType: 'nonprofit_501c3',
    sponsor: null,
    tier: 'named',
    adminKey: 'maya',
    adminName: maya.name,
    adminEmail: maya.email,
    place: { county: 'Alder', city: 'Larkspur', zip: '95421' },
    createdAt: ctx.clock.iso(-640),
  });
  eastside.mission = 'Eastside Youth Music Collective gives teenagers on the east side of Larkspur free instruments, lessons and a band to play in, and trains older students to teach younger ones.';
  eastside.street = '218 Orchard Avenue';
  const lumen = make({
    name: 'Lumen Literacy Project',
    ein: null,
    verified: false,
    cause: 'education',
    budgetCents: 16_500_000,
    orgType: 'fiscally_sponsored',
    sponsor: { name: 'Commons Fiscal Partners', ein: '00-0000002' },
    tier: 'named',
    adminKey: 'theo',
    adminName: theo.name,
    adminEmail: theo.email,
    place: { county: 'Bramble', city: 'Thornbury', zip: '95512' },
    createdAt: ctx.clock.iso(-520),
  });
  lumen.mission = 'Lumen Literacy Project runs free reading circles and writing workshops for teens in Bramble County libraries.';
  const cedar = make({
    name: 'Cedar Hollow Food Pantry',
    ein: '00-0000003',
    verified: true,
    cause: 'food',
    budgetCents: 31_000_000,
    orgType: 'nonprofit_501c3',
    sponsor: null,
    tier: 'named',
    adminKey: 'ada',
    adminName: ada.name,
    adminEmail: ada.email,
    place: { county: 'Cinder', city: 'Ashgrove', zip: '95636' },
    createdAt: ctx.clock.iso(-600),
  });
  const oldmill = make({ name: 'Old Mill Arts Guild', ein: '00-0000009', verified: false, cause: 'arts', budgetCents: 9_500_000, orgType: 'nonprofit_501c3', sponsor: null, tier: 'named', createdAt: ctx.clock.iso(-300) });
  out.push(eastside, lumen, cedar, oldmill);

  // Generated organizations --------------------------------------------------------------------------------
  const causes: [CauseArea, number][] = [['arts', 34], ['food', 30], ['education', 10], ['health', 8], ['environment', 7], ['housing', 6], ['capacity', 5]];
  const genName = (cause: CauseArea): string => {
    const parts = ORG_NAME_PARTS[cause];
    for (let i = 0; i < 50; i++) {
      const n = `${rng.pick(parts.stems)} ${rng.pick(parts.kinds)}`;
      if (!usedNames.has(n)) return n;
    }
    let n = `${rng.pick(parts.stems)} ${rng.pick(parts.kinds)}`;
    const suffixes = ['of Alder County', 'of Bramble County', 'of Cinder County', 'Collaborative', 'Project', 'Network', 'Alliance'];
    for (const s of suffixes) {
      if (!usedNames.has(`${n} ${s}`)) return `${n} ${s}`;
    }
    n = `${n} ${rng.int(2, 99)}`;
    return n;
  };
  const generated = FIXTURE_IRS_RECORDS.filter((r) => /^00-00001\d\d$/.test(r.ein));
  for (let i = 0; i < CORE_COUNT + ALUMNI_COUNT; i++) {
    const core = i < CORE_COUNT;
    const irsRec = core && i < generated.length ? generated[i]! : null;
    const cause = irsRec ? causeFromNtee(irsRec.ntee) : rng.weighted(causes);
    const sponsored = !irsRec && rng.chance(0.08);
    const outside = rng.chance(0.05);
    const budget = rng.weighted<[number, number]>([
      [[60_000, 250_000], 35],
      [[250_000, 900_000], 40],
      [[900_000, 1_950_000], 18],
      [[2_100_000, 4_500_000], 7],
    ]);
    out.push(
      make({
        name: irsRec?.name ?? genName(cause),
        ein: sponsored ? null : core ? `00-0000${String(100 + i).padStart(3, '0')}` : `00-0001${String(i - CORE_COUNT).padStart(3, '0')}`,
        verified: Boolean(irsRec && irsRec.status === 'active'),
        cause,
        budgetCents: Math.round(rng.int(budget[0], budget[1]) / 1000) * 1000 * 100,
        orgType: sponsored ? 'fiscally_sponsored' : 'nonprofit_501c3',
        sponsor: sponsored ? { name: 'Commons Fiscal Partners', ein: '00-0000002' } : null,
        tier: core ? 'core' : 'alumni',
        place: place(outside),
        createdAt: ctx.clock.iso(-rng.int(core ? 30 : 420, core ? 700 : 900)),
      }),
    );
  }

  // Users (auth + profiles). Named people already exist; generated admins are inserted in bulk.
  const bulk = out.filter((o) => !['maya', 'theo', 'ada'].includes(o.admin.key));
  for (let i = 0; i < bulk.length; i += 200) {
    const part = bulk.slice(i, i + 200);
    await sql`insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data, created_at)
      values ${sql.join(part.map((o) => sql`(${o.admin.id}::uuid, ${o.admin.email}, ${o.createdAt}::timestamptz, ${JSON.stringify({ full_name: o.admin.name })}::jsonb, ${o.createdAt}::timestamptz)`))}
      on conflict do nothing`.execute(ctx.db);
    await sql`insert into public.profiles (id, email, full_name, created_at)
      values ${sql.join(part.map((o) => sql`(${o.admin.id}::uuid, ${o.admin.email}, ${o.admin.name}, ${o.createdAt}::timestamptz)`))}
      on conflict (id) do update set full_name = excluded.full_name, created_at = excluded.created_at`.execute(ctx.db);
  }
  for (const o of out) {
    if (!['maya', 'theo', 'ada'].includes(o.admin.key)) ctx.people.set(o.admin.key, { id: o.admin.id, email: o.admin.email, name: o.admin.name });
    else o.admin.id = ctx.person(o.admin.key).id;
  }
  ctx.bump('users', bulk.length);

  await ctx.insert(
    'applicant_orgs',
    out.map((o) => {
      const rec = o.ein ? irs.get(o.ein) : undefined;
      return {
        id: o.id,
        legal_name: o.name,
        ein: o.ein,
        org_type: o.orgType,
        mission: o.mission,
        annual_budget_cents: o.budgetCents,
        website: `https://${o.slug}.example`,
        phone: `(555) 555-${String(100 + (Number.parseInt(o.id.slice(0, 4), 16) % 900)).padStart(4, '0')}`,
        email: `info@${o.slug}.example`,
        counties: [o.county],
        fiscal_sponsor_name: o.sponsor?.name ?? null,
        fiscal_sponsor_ein: o.sponsor?.ein ?? null,
        ein_verified_at: o.verified ? o.createdAt : null,
        irs_status: rec ? JSON.stringify({ name: rec.name, status: rec.status, pub78: rec.pub78, subsection: rec.subsection }) : null,
        tags: [o.cause],
        created_by: o.admin.id,
        created_at: o.createdAt,
        last_modified_at: o.createdAt,
      };
    }),
  );
  await ctx.insert(
    'applicant_org_members',
    out.map((o) => ({ id: ctx.id(`org-member:${o.slug}`), org_id: o.id, user_id: o.admin.id, role: 'org_admin', title: o.tier === 'named' ? (o.admin.key === 'maya' ? 'Executive Director' : o.admin.key === 'theo' ? 'Project Director' : 'Coordinator') : 'Executive Director', created_at: o.createdAt })),
  );
  await ctx.insert(
    'org_addresses',
    out.map((o) => ({ id: ctx.id(`org-address:${o.slug}`), org_id: o.id, kind: 'mailing', line1: o.street, city: o.city, state: 'CA', postal_code: o.zip, country: 'US', county: o.county, created_at: o.createdAt })),
  );

  const core = out.filter((o) => o.tier === 'core');
  const alumni = out.filter((o) => o.tier === 'alumni');
  return { all: out, byKey: { eastside, lumen, cedar, oldmill }, core, alumni };
}

/** CommonGrants-shaped profile snapshot, matching what applications.submit stores. */
export function orgProfile(o: OrgRec): Record<string, unknown> {
  const [firstName, ...rest] = o.admin.name.split(' ');
  return {
    organization: {
      id: o.id,
      name: o.name,
      ein: o.ein,
      uei: null,
      mission: o.mission,
      type: o.orgType,
      annualBudget: { amount: (o.budgetCents / 100).toFixed(2), currency: 'USD' },
      website: `https://${o.slug}.example`,
      phone: null,
      email: `info@${o.slug}.example`,
      counties: [o.county],
      fiscalSponsor: o.sponsor ? { name: o.sponsor.name, ein: o.sponsor.ein } : null,
      einVerified: o.verified,
      address: { street1: o.street, street2: null, city: o.city, stateOrProvince: 'CA', postalCode: o.zip, county: o.county, country: 'US' },
    },
    contact: { name: { firstName: firstName ?? null, lastName: rest.join(' ') || null }, email: o.admin.email },
  };
}
