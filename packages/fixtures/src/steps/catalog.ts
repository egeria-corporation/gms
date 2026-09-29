// SPDX-License-Identifier: AGPL-3.0-or-later
// Programs & budgets, forms (published, immutable versions), opportunities with stages, eligibility rules,
// rubrics and review stages, plus the global form template library and question bank.
import {
  compileForm,
  FINAL_REPORT_TEMPLATE,
  FORM_TEMPLATES,
  FULL_PROPOSAL_TEMPLATE,
  GENERAL_OPERATING_TEMPLATE,
  INTERIM_REPORT_TEMPLATE,
  QUESTION_BANK,
  YOUTH_ARTS_LOI,
  type CompiledForm,
  type FormModel,
} from '@gms/forms';
import { json, type SeedContext } from '../context';
import { zoned } from '../time';

export interface FormRec {
  id: string;
  versionId: string;
  model: FormModel;
  compiled: CompiledForm;
}

export interface CompRec {
  id: string;
  name: string;
  form: FormRec;
  opensAt: string | null;
  closesAt: string | null;
  status: string;
}

export type OppKey = 'flagship' | 'rapid' | 'nfs2026' | 'yaf2025' | 'capacityDraft' | 'capacityMini' | 'marigold' | 'sunbeam';

export interface OppRec {
  key: OppKey;
  id: string;
  ws: string;
  slug: string;
  title: string;
  status: 'draft' | 'forecasted' | 'open' | 'closed' | 'archived';
  programId: string | null;
  stages: CompRec[];
  opensAt: string;
  closesAt: string;
  publishedAt: string | null;
}

export interface Catalog {
  programs: Record<string, string>;
  forms: Record<string, FormRec>;
  opps: Partial<Record<OppKey, OppRec>>;
  rubrics: Record<string, { id: string; criteria: { id: string; weight: number; min: number; max: number }[] }>;
  reviewStages: Record<string, string>;
}

const PT = 'America/Los_Angeles';

/** The flagship's status follows the anchor date: before Nov 3 2026 forecasted, then open, then closed. */
export function flagshipStatus(anchor: Date): 'forecasted' | 'open' | 'closed' {
  if (anchor.getTime() < Date.parse(zoned('2026-11-03T09:00', PT))) return 'forecasted';
  if (anchor.getTime() <= Date.parse(zoned('2026-12-05T17:00', PT))) return 'open';
  return 'closed';
}

function withTitle(model: FormModel, title: string, flags?: Record<string, boolean>): FormModel {
  return { ...structuredClone(model), title, ...(flags ? { flags } : {}) };
}

export async function formLibrary(ctx: SeedContext): Promise<void> {
  const existing = await ctx.db.selectFrom('form_templates').select('id').where('workspace_id', 'is', null).executeTakeFirst();
  if (existing) return;
  await ctx.insert(
    'form_templates',
    FORM_TEMPLATES.map((t) => ({ id: ctx.id(`template:${t.key}`), workspace_id: null, name: t.name, description: t.description, kind: t.kind, builder_model: json(t.model), source: 'gms' })),
  );
  await ctx.insert(
    'question_bank_items',
    QUESTION_BANK.map((q) => ({ id: ctx.id(`question:${q.key}`), workspace_id: null, label: q.label, field: json(q.field), tags: [...q.tags], cg_path: q.cgPath ?? null })),
  );
}

async function publishedForm(
  ctx: SeedContext,
  ws: string,
  key: string,
  name: string,
  kind: 'application' | 'loi' | 'report',
  model: FormModel,
  at: string,
  by: string,
  status: 'published' | 'draft' = 'published',
): Promise<FormRec> {
  const w = ctx.ws(ws);
  const compiled = compileForm(model);
  const id = ctx.id(`form:${ws}:${key}`);
  const versionId = ctx.id(`form-version:${ws}:${key}:1`);
  const author = ctx.person(by).id;
  await ctx.insert('forms', [{ id, workspace_id: w.id, name, kind, description: model.description ?? null, created_by: author, created_at: at, last_modified_at: at }]);
  await ctx.insert('form_versions', [
    {
      id: versionId,
      workspace_id: w.id,
      form_id: id,
      version: 1,
      status,
      builder_model: json(model),
      json_schema: json(compiled.jsonSchema),
      ui_schema: json(compiled.uiSchema),
      mapping_to_cg: json(compiled.mappingToCg),
      mapping_from_cg: json(compiled.mappingFromCg),
      field_meta: json(compiled.fieldMeta),
      change_note: status === 'published' ? 'First published version.' : null,
      published_at: status === 'published' ? at : null,
      published_by: status === 'published' ? author : null,
      created_by: author,
      created_at: at,
      last_modified_at: at,
    },
  ]);
  if (status === 'published') {
    await ctx.db.updateTable('forms').set({ current_version_id: versionId }).where('id', '=', id).execute();
    ctx.audit({ workspace: ws, at, actor: ctx.human(by), action: 'forms.publish', entityType: 'form_version', entityId: versionId, before: { status: 'draft' }, after: { status: 'published', version: 1 }, riskTier: 'R2' });
  }
  ctx.audit({ workspace: ws, at, actor: ctx.human(by), action: 'forms.create', entityType: 'form', entityId: id, after: { name, kind } });
  return { id, versionId, model, compiled };
}

async function programs(ctx: SeedContext): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const defs: { ws: string; key: string; name: string; slug: string; cause: string; description: string; budgets: [number, number][] }[] = [
    { ws: 'halcyon', key: 'yaf', name: 'Youth Arts Fund', slug: 'youth-arts-fund', cause: 'arts', description: 'Creative programs where young people ages 12–24 make, perform and lead.', budgets: [[2025, 36_000_000], [2026, 38_000_000], [2027, 45_000_000]] },
    { ws: 'halcyon', key: 'nfs', name: 'Neighborhood Food Security', slug: 'neighborhood-food-security', cause: 'food', description: 'Pantries, community kitchens, mobile markets and growers making sure every family has enough to eat.', budgets: [[2025, 48_000_000], [2026, 54_000_000], [2027, 60_000_000]] },
    { ws: 'halcyon', key: 'cbg', name: 'Capacity Building Grants', slug: 'capacity-building-grants', cause: 'capacity', description: 'Board development, financial systems, planning and the other foundations of a healthy nonprofit.', budgets: [[2026, 20_000_000], [2027, 25_000_000]] },
    { ws: 'marigold', key: 'organizing', name: 'Small Grants for Community Organizing', slug: 'small-grants-for-community-organizing', cause: 'organizing', description: 'Fast, small grants for tenant unions, block clubs and youth councils.', budgets: [[2026, 6_000_000], [2027, 7_500_000]] },
    { ws: 'sunbeam', key: 'mini', name: 'Community Mini-Grants', slug: 'community-mini-grants', cause: 'community', description: 'Small grants for neighborhood projects.', budgets: [[2027, 1_000_000]] },
  ];
  for (const d of defs) {
    const w = ctx.ws(d.ws);
    const id = ctx.id(`program:${d.ws}:${d.key}`);
    out[d.key] = id;
    const lead = d.ws === 'halcyon' ? 'jordan' : d.ws === 'marigold' ? 'kwame' : 'sam';
    const at = ctx.clock.iso(d.ws === 'halcyon' ? -690 : d.ws === 'marigold' ? -410 : -55);
    await ctx.insert('programs', [{ id, workspace_id: w.id, name: d.name, slug: d.slug, description: d.description, cause_area: d.cause, lead_user_id: ctx.person(lead).id, created_at: at, last_modified_at: at }]);
    ctx.audit({ workspace: d.ws, at, actor: ctx.human(lead), action: 'programs.create', entityType: 'program', entityId: id, after: { name: d.name } });
    await ctx.insert(
      'program_budgets',
      d.budgets.map(([fy, cents]) => ({ id: ctx.id(`budget:${d.ws}:${d.key}:${fy}`), workspace_id: w.id, program_id: id, fiscal_year: fy, amount_cents: cents, created_at: at })),
    );
    const finance = d.ws === 'halcyon' ? 'priya' : d.ws === 'marigold' ? 'ines' : 'sam';
    for (const [fy, cents] of d.budgets) {
      ctx.audit({ workspace: d.ws, at, actor: ctx.human(finance), action: 'programs.set_budget', entityType: 'program', entityId: id, after: { fiscalYear: fy, amountCents: cents } });
    }
  }
  return out;
}

const FLAGSHIP_DESCRIPTION = [
  'The **Youth Arts Fund** supports creative programs where young people ages 12–24 make, perform and lead. In 2027 we will make about **20 grants of $5,000 to $25,000**, for a total of **$400,000**.',
  '',
  '### What we fund',
  '',
  '- Ongoing programs (not one-time events) in music, theater, dance, visual art, writing, film and digital media',
  '- Programs where young people have real decision-making power',
  '- Paid roles for youth, such as peer mentors or apprentices',
  '- Programs in Alder, Bramble and Cinder Counties',
  '',
  '### How to apply',
  '',
  '1. **Letter of inquiry (everyone):** a short form that takes about 30 minutes. Opens November 3, 2026 and closes **December 5, 2026 at 5:00 PM Pacific**.',
  '2. **Full proposal (by invitation):** if we invite you, the full proposal is due **February 13, 2027 at 5:00 PM Pacific**.',
  '',
  'We will let every applicant know about their letter of inquiry by mid-January 2027.',
].join('\n');

const FLAGSHIP_ELIGIBILITY = [
  'To apply, your organization must:',
  '',
  '- Be a 501(c)(3) public charity **or** have a fiscal sponsor that is one',
  '- Serve young people ages 12–24',
  '- Work in Alder, Bramble or Cinder County',
  '- Have an annual operating budget under $2 million',
  '',
  'Not sure? Take the two-minute eligibility check, or write to us. We are happy to talk it through.',
].join('\n');

const FLAGSHIP_GUIDELINES = [
  '## Guidelines',
  '',
  '### Budget',
  'Requests can be from **$5,000 to $25,000**. Your budget lines must add up to the amount you request. You may include staff time, teaching artists, supplies, space, stipends for young people and a reasonable share of overhead (up to 15%).',
  '',
  '### Using AI tools',
  'You are welcome to use AI writing tools. We ask you to tell us whether (and how) you used them. It does not affect your score.',
  '',
  '### How we review',
  'Community reviewers, including young artists, score each letter of inquiry on community need, youth voice and leadership, program quality, and feasibility. Applicant names are hidden from reviewers during the first round.',
  '',
  '### Accessibility',
  'If you need the form in another format, more time because of a disability, or help in another language, email grants@halcyonridge.example.',
].join('\n');

const FLAGSHIP_FAQ = [
  { q: 'Can we apply if we are fiscally sponsored?', a: 'Yes. Tell us your fiscal sponsor’s name and EIN in the form. The grant agreement will be with your sponsor.' },
  { q: 'Can we apply for general operating support?', a: 'This fund supports youth arts programs. For general support, see our Capacity Building Grants.' },
  { q: 'We applied last year and did not get a grant. Can we apply again?', a: 'Please do. Many of our grantees were not funded the first time they applied.' },
  { q: 'Do young people need to be involved in writing the application?', a: 'It is not required, but we love to hear young people’s voices. You can include a quote or a short story in your answers.' },
  { q: 'When will we hear back?', a: 'We will contact every applicant by mid-January 2027 about their letter of inquiry.' },
];

interface OppDef {
  key: OppKey;
  ws: string;
  program: string | null;
  slug: string;
  title: string;
  status: OppRec['status'];
  form: string;
  opensAt: string;
  closesAt: string;
  publishedAt: string | null;
  summary: string;
  descriptionMd: string;
  eligibilityMd?: string;
  guidelinesMd?: string;
  faq?: { q: string; a: string }[];
  fundingTotalCents: number;
  awardMinCents: number;
  awardMaxCents: number;
  expectedAwardCount: number;
  cause: string[];
  decisionExpectedOn: string | null;
  stage2?: { name: string; form: string; opensAt: string; closesAt: string };
  by: string;
  createdAt: string;
  contactEmail: string;
}

function stageStatus(oppStatus: OppRec['status'], opensAt: string, closesAt: string, anchor: Date): string {
  if (oppStatus === 'draft') return 'draft';
  const t = anchor.getTime();
  if (t < Date.parse(opensAt)) return 'scheduled';
  if (t <= Date.parse(closesAt)) return oppStatus === 'open' || oppStatus === 'forecasted' ? 'open' : 'closed';
  return 'closed';
}

export async function catalog(ctx: SeedContext): Promise<Catalog> {
  const c = ctx.clock;
  const progs = await programs(ctx);
  const forms: Record<string, FormRec> = {};

  // Forms ---------------------------------------------------------------------------------------------
  forms.loi2027 = await publishedForm(ctx, 'halcyon', 'yaf-2027-loi', 'Youth Arts Fund 2027 — Letter of Inquiry', 'loi', YOUTH_ARTS_LOI, c.iso(-40), 'jordan');
  forms.full2027 = await publishedForm(ctx, 'halcyon', 'yaf-2027-full', 'Youth Arts Fund 2027 — Full proposal', 'application', withTitle(FULL_PROPOSAL_TEMPLATE, 'Youth Arts Fund 2027 — Full proposal'), c.iso(-38), 'jordan');
  forms.yaf2025 = await publishedForm(ctx, 'halcyon', 'yaf-2025', 'Youth Arts Fund 2025 — Application', 'application', withTitle(YOUTH_ARTS_LOI, 'Youth Arts Fund 2025 — Application', { aiDisclosure: false }), '2024-10-15T17:00:00.000Z', 'jordan');
  forms.nfs2026 = await publishedForm(ctx, 'halcyon', 'nfs-2026', 'Neighborhood Food Security 2026 — Application', 'application', withTitle(GENERAL_OPERATING_TEMPLATE, 'Neighborhood Food Security 2026 — Application'), '2025-09-15T17:00:00.000Z', 'jordan');
  forms.rapid = await publishedForm(ctx, 'halcyon', 'rapid-response', 'Rapid Response — Request', 'application', withTitle(GENERAL_OPERATING_TEMPLATE, 'Neighborhood Food Security Rapid Response — Request'), c.iso(-35), 'jordan');
  forms.capacity = await publishedForm(ctx, 'halcyon', 'capacity-mini', 'Capacity Building Mini-Grants — Application', 'application', withTitle(GENERAL_OPERATING_TEMPLATE, 'Capacity Building Mini-Grants 2027 — Application'), c.iso(-20), 'jordan');
  forms.capacityDraft = await publishedForm(ctx, 'halcyon', 'capacity-2027', 'Capacity Building Grants 2027 — Application (draft)', 'application', withTitle(GENERAL_OPERATING_TEMPLATE, 'Capacity Building Grants 2027 — Application'), c.iso(-6), 'jordan', 'draft');
  forms.interim = await publishedForm(ctx, 'halcyon', 'interim-report', 'Grantee interim report', 'report', INTERIM_REPORT_TEMPLATE, '2024-09-01T17:00:00.000Z', 'jordan');
  forms.final = await publishedForm(ctx, 'halcyon', 'final-report', 'Final report', 'report', FINAL_REPORT_TEMPLATE, '2024-09-01T17:05:00.000Z', 'jordan');
  forms.marigold = await publishedForm(ctx, 'marigold', 'organizing', 'Organizing Small Grant — Application', 'application', withTitle(GENERAL_OPERATING_TEMPLATE, 'Small Grants for Community Organizing — Application'), c.iso(-60), 'kwame');
  forms.marigoldReport = await publishedForm(ctx, 'marigold', 'final-report', 'Final report', 'report', FINAL_REPORT_TEMPLATE, c.iso(-300), 'kwame');
  forms.sunbeam = await publishedForm(ctx, 'sunbeam', 'mini', 'Mini-Grant — Application', 'application', withTitle(GENERAL_OPERATING_TEMPLATE, 'Community Mini-Grant — Application'), c.iso(-30), 'sam');

  // Opportunities -------------------------------------------------------------------------------------------
  const flagship = flagshipStatus(c.anchor);
  // The second open Halcyon opportunity: open while the flagship is only forecasted, otherwise forecasted.
  const miniOpen = flagship === 'forecasted';
  const defs: OppDef[] = [
    {
      key: 'flagship',
      ws: 'halcyon',
      program: 'yaf',
      slug: 'youth-arts-fund-2027',
      title: 'Youth Arts Fund 2027',
      status: flagship,
      form: 'loi2027',
      opensAt: zoned('2026-11-03T09:00', PT),
      closesAt: zoned('2026-12-05T17:00', PT),
      publishedAt: c.anchor.getTime() < Date.parse('2026-10-15T17:00:00Z') ? c.iso(-14) : '2026-10-15T17:00:00.000Z',
      summary: 'Grants of $5,000–$25,000 for youth arts programs in Alder, Bramble and Cinder Counties. Letters of inquiry are due December 5, 2026.',
      descriptionMd: FLAGSHIP_DESCRIPTION,
      eligibilityMd: FLAGSHIP_ELIGIBILITY,
      guidelinesMd: FLAGSHIP_GUIDELINES,
      faq: FLAGSHIP_FAQ,
      fundingTotalCents: 40_000_000,
      awardMinCents: 500_000,
      awardMaxCents: 2_500_000,
      expectedAwardCount: 20,
      cause: ['arts'],
      decisionExpectedOn: '2027-05-14',
      stage2: { name: 'Full proposal', form: 'full2027', opensAt: zoned('2027-01-11T09:00', PT), closesAt: zoned('2027-02-13T17:00', PT) },
      by: 'jordan',
      createdAt: c.iso(-45),
      contactEmail: 'grants@halcyonridge.example',
    },
    {
      key: 'rapid',
      ws: 'halcyon',
      program: 'nfs',
      slug: 'neighborhood-food-security-rapid-response-2027',
      title: 'Neighborhood Food Security Rapid Response 2027',
      status: 'open',
      form: 'rapid',
      opensAt: c.iso(-30),
      closesAt: c.iso(45),
      publishedAt: c.iso(-31),
      summary: 'Quick grants of up to $15,000 for pantries and community kitchens facing a sudden jump in need. Decisions within three weeks.',
      descriptionMd:
        'When a plant closes, a storm hits or benefits are delayed, neighborhood food programs feel it first. **Rapid Response** grants help pantries, kitchens and mobile markets meet a sudden rise in need.\n\n- Grants of **$2,500 to $15,000**\n- A one-page request\n- Decisions within **three weeks**',
      eligibilityMd: '- 501(c)(3) organizations or fiscally sponsored projects\n- Programs that provide food directly to people in Alder, Bramble or Cinder County',
      guidelinesMd: 'Tell us what changed, how many more people you are serving, and how you will use the grant. Budgets can be simple.',
      faq: [{ q: 'Can we apply more than once?', a: 'One request per organization per year, please.' }],
      fundingTotalCents: 15_000_000,
      awardMinCents: 250_000,
      awardMaxCents: 1_500_000,
      expectedAwardCount: 12,
      cause: ['food'],
      decisionExpectedOn: c.date(66),
      by: 'jordan',
      createdAt: c.iso(-36),
      contactEmail: 'grants@halcyonridge.example',
    },
    {
      key: 'nfs2026',
      ws: 'halcyon',
      program: 'nfs',
      slug: 'neighborhood-food-security-grants-2026',
      title: 'Neighborhood Food Security Grants 2026',
      status: 'closed',
      form: 'nfs2026',
      opensAt: zoned('2025-10-01T09:00', PT),
      closesAt: zoned('2026-01-30T17:00', PT),
      publishedAt: '2025-09-20T17:00:00.000Z',
      summary: 'One-year grants of $10,000–$40,000 for food programs in Alder, Bramble and Cinder Counties.',
      descriptionMd: 'One-year grants for pantries, community kitchens, mobile markets and growers. Applications for this cycle are closed.',
      fundingTotalCents: 54_000_000,
      awardMinCents: 1_000_000,
      awardMaxCents: 4_000_000,
      expectedAwardCount: 22,
      cause: ['food'],
      decisionExpectedOn: '2026-03-20',
      by: 'jordan',
      createdAt: '2025-09-10T17:00:00.000Z',
      contactEmail: 'grants@halcyonridge.example',
    },
    {
      key: 'yaf2025',
      ws: 'halcyon',
      program: 'yaf',
      slug: 'youth-arts-fund-2025',
      title: 'Youth Arts Fund 2025',
      status: 'archived',
      form: 'yaf2025',
      opensAt: zoned('2024-11-04T09:00', PT),
      closesAt: zoned('2025-01-31T17:00', PT),
      publishedAt: '2024-10-20T17:00:00.000Z',
      summary: 'Grants of $5,000–$25,000 for youth arts programs (2025 cycle).',
      descriptionMd: 'The 2025 cycle of the Youth Arts Fund. Most grants run for two years.',
      fundingTotalCents: 36_000_000,
      awardMinCents: 500_000,
      awardMaxCents: 2_500_000,
      expectedAwardCount: 20,
      cause: ['arts'],
      decisionExpectedOn: '2025-05-16',
      by: 'jordan',
      createdAt: '2024-10-10T17:00:00.000Z',
      contactEmail: 'grants@halcyonridge.example',
    },
    {
      key: 'capacityDraft',
      ws: 'halcyon',
      program: 'cbg',
      slug: 'capacity-building-grants-2027',
      title: 'Capacity Building Grants 2027',
      status: 'draft',
      form: 'capacityDraft',
      opensAt: c.iso(90),
      closesAt: c.iso(150),
      publishedAt: null,
      summary: 'Grants of up to $30,000 for board development, financial systems and planning.',
      descriptionMd: '_Draft: details coming soon._',
      fundingTotalCents: 25_000_000,
      awardMinCents: 500_000,
      awardMaxCents: 3_000_000,
      expectedAwardCount: 10,
      cause: ['capacity'],
      decisionExpectedOn: null,
      by: 'jordan',
      createdAt: c.iso(-6),
      contactEmail: 'grants@halcyonridge.example',
    },
    {
      key: 'capacityMini',
      ws: 'halcyon',
      program: 'cbg',
      slug: 'capacity-building-mini-grants-2027',
      title: 'Capacity Building Mini-Grants 2027',
      status: miniOpen ? 'open' : 'forecasted',
      form: 'capacity',
      opensAt: miniOpen ? c.iso(-10) : c.iso(20),
      closesAt: miniOpen ? c.iso(60) : c.iso(80),
      publishedAt: c.iso(-12),
      summary: 'Mini-grants of $2,000–$7,500 for small nonprofits to strengthen boards, books and systems.',
      descriptionMd: 'Small, flexible grants for the behind-the-scenes work that helps nonprofits last: board training, bookkeeping software, a new website, a strategic plan.',
      eligibilityMd: '- 501(c)(3) organizations with annual budgets under $750,000\n- Based in Alder, Bramble or Cinder County',
      fundingTotalCents: 7_500_000,
      awardMinCents: 200_000,
      awardMaxCents: 750_000,
      expectedAwardCount: 12,
      cause: ['capacity'],
      decisionExpectedOn: c.date(95),
      by: 'jordan',
      createdAt: c.iso(-18),
      contactEmail: 'grants@halcyonridge.example',
    },
    {
      key: 'marigold',
      ws: 'marigold',
      program: 'organizing',
      slug: 'organizing-small-grants-2027',
      title: 'Organizing Small Grants 2027',
      status: 'open',
      form: 'marigold',
      opensAt: c.iso(-21),
      closesAt: c.iso(39),
      publishedAt: c.iso(-22),
      summary: 'Grants of $1,000–$5,000 for tenant unions, block clubs and youth councils.',
      descriptionMd: 'Small, fast grants for people organizing their neighbors. We fund stipends, childcare, food for meetings, printing and training.',
      fundingTotalCents: 5_000_000,
      awardMinCents: 100_000,
      awardMaxCents: 500_000,
      expectedAwardCount: 15,
      cause: ['organizing'],
      decisionExpectedOn: c.date(60),
      by: 'kwame',
      createdAt: c.iso(-25),
      contactEmail: 'hello@marigoldstreet.example',
    },
    {
      key: 'sunbeam',
      ws: 'sunbeam',
      program: 'mini',
      slug: 'community-mini-grants-2027',
      title: 'Community Mini-Grants 2027',
      status: 'open',
      form: 'sunbeam',
      opensAt: c.iso(-14),
      closesAt: c.iso(30),
      publishedAt: c.iso(-15),
      summary: 'Mini-grants of up to $2,500 for neighborhood projects. (Demonstration workspace.)',
      descriptionMd: 'A demonstration opportunity in a workspace with a low-contrast brand color.',
      fundingTotalCents: 1_000_000,
      awardMinCents: 50_000,
      awardMaxCents: 250_000,
      expectedAwardCount: 6,
      cause: ['community'],
      decisionExpectedOn: c.date(45),
      by: 'sam',
      createdAt: c.iso(-16),
      contactEmail: 'grants@sunbeamtest.example',
    },
  ];

  const opps: Partial<Record<OppKey, OppRec>> = {};
  for (const d of defs) {
    const w = ctx.ws(d.ws);
    const id = ctx.id(`opportunity:${d.ws}:${d.slug}`);
    const halcyon = d.ws === 'halcyon';
    await ctx.insert('opportunities', [
      {
        id,
        workspace_id: w.id,
        program_id: d.program ? progs[d.program]! : null,
        slug: d.slug,
        title: d.title,
        status: d.status,
        visibility: 'public',
        summary: d.summary,
        description_md: d.descriptionMd,
        eligibility_md: d.eligibilityMd ?? null,
        guidelines_md: d.guidelinesMd ?? null,
        faq: json(d.faq ?? []),
        funding_total_cents: d.fundingTotalCents,
        award_min_cents: d.awardMinCents,
        award_max_cents: d.awardMaxCents,
        expected_award_count: d.expectedAwardCount,
        applicant_types: ['nonprofit_501c3', 'fiscally_sponsored'],
        cause_terms: d.cause,
        geography_terms: halcyon ? ['alder', 'bramble', 'cinder'] : [],
        population_terms: d.key === 'flagship' || d.key === 'yaf2025' ? ['youth-12-24'] : halcyon ? ['families'] : [],
        forecast_at: d.publishedAt,
        opens_at: d.opensAt,
        closes_at: d.closesAt,
        decision_expected_on: d.decisionExpectedOn,
        contact_email: d.contactEmail,
        distribution: json({ site: true, embed: true, cgFeed: true, openGrants: false }),
        published_at: d.publishedAt,
        created_by: ctx.person(d.by).id,
        created_at: d.createdAt,
        last_modified_at: d.publishedAt ?? d.createdAt,
      },
    ]);
    ctx.audit({ workspace: d.ws, at: d.createdAt, actor: ctx.human(d.by), action: 'opportunities.create', entityType: 'opportunity', entityId: id, after: { title: d.title, slug: d.slug } });
    if (d.publishedAt) {
      ctx.audit({ workspace: d.ws, at: d.publishedAt, actor: ctx.human(d.by), action: 'opportunities.publish', entityType: 'opportunity', entityId: id, before: { status: 'draft' }, after: { status: Date.parse(d.opensAt) <= Date.parse(d.publishedAt) ? 'open' : 'forecasted' }, riskTier: 'R2' });
    }
    if (d.status === 'closed' || d.status === 'archived') {
      ctx.audit({ workspace: d.ws, at: d.closesAt, actor: { type: 'system' }, action: 'system.tick_opportunity_schedule', entityType: 'opportunity', entityId: id, before: { status: 'open' }, after: { status: 'closed' } });
    }
    if (d.status === 'archived') {
      ctx.audit({ workspace: d.ws, at: '2025-09-30T17:00:00.000Z', actor: ctx.human(d.by), action: 'opportunities.set_status', entityType: 'opportunity', entityId: id, before: { status: 'closed' }, after: { status: 'archived' }, riskTier: 'R2' });
    }

    const stages: CompRec[] = [];
    const stageDefs = [
      { name: d.key === 'flagship' ? 'Letter of inquiry' : 'Application', form: d.form, opensAt: d.opensAt, closesAt: d.closesAt, access: 'public' as const },
      ...(d.stage2 ? [{ ...d.stage2, access: 'invite' as const }] : []),
    ];
    for (const [i, s] of stageDefs.entries()) {
      const cid = ctx.id(`competition:${d.ws}:${d.slug}:${i + 1}`);
      const status = stageStatus(d.status, s.opensAt, s.closesAt, c.anchor);
      const form = forms[s.form]!;
      await ctx.insert('competitions', [
        {
          id: cid,
          workspace_id: w.id,
          opportunity_id: id,
          name: s.name,
          description: s.access === 'invite' ? 'By invitation, after the letter of inquiry.' : null,
          stage_order: i + 1,
          access: s.access,
          status,
          opens_at: s.opensAt,
          closes_at: s.closesAt,
          grace_minutes: 0,
          per_org_limit: 1,
          created_at: d.createdAt,
        },
      ]);
      await ctx.insert('competition_forms', [{ id: ctx.id(`competition-form:${cid}`), workspace_id: w.id, competition_id: cid, form_id: form.id, form_version_id: form.versionId, position: 1, created_at: d.createdAt }]);
      stages.push({ id: cid, name: s.name, form, opensAt: s.opensAt, closesAt: s.closesAt, status });
    }
    opps[d.key] = { key: d.key, id, ws: d.ws, slug: d.slug, title: d.title, status: d.status, programId: d.program ? progs[d.program]! : null, stages, opensAt: d.opensAt, closesAt: d.closesAt, publishedAt: d.publishedAt };
  }

  // Eligibility rules for the flagship (kind knockout messages) and the rapid-response opportunity.
  const flag = opps.flagship!;
  const counties = { options: ['Alder County', 'Bramble County', 'Cinder County', 'Somewhere else'], allowed: ['Alder County', 'Bramble County', 'Cinder County'] };
  const rules: { opp: OppRec; question: string; help: string | null; kind: string; config: Record<string, unknown>; knockout: string }[] = [
    { opp: flag, question: 'Is your organization a 501(c)(3) public charity, or fiscally sponsored by one?', help: 'Fiscally sponsored projects are welcome.', kind: 'yes_no', config: { required: true }, knockout: 'Thanks for your interest! This fund can only make grants to 501(c)(3) organizations or projects with a 501(c)(3) fiscal sponsor. If you are working on finding a sponsor, we would be glad to point you to local options. Just write to grants@halcyonridge.example.' },
    { opp: flag, question: 'Does your program serve young people ages 12 to 24?', help: null, kind: 'yes_no', config: { required: true }, knockout: 'The Youth Arts Fund focuses on young people ages 12–24, so this program is not a fit this time. Our Capacity Building Grants may be a better match. Take a look!' },
    { opp: flag, question: 'Where does your program take place?', help: 'Choose all that apply.', kind: 'multi_any', config: counties, knockout: 'We can only fund programs in Alder, Bramble or Cinder County. We are sorry we can’t help this time, and we hope you find a great partner closer to home.' },
    { opp: flag, question: 'What is your organization’s annual operating budget?', help: 'In US dollars. A close estimate is fine.', kind: 'number_max', config: { max: 2_000_000, unit: 'usd' }, knockout: 'This fund is for organizations with budgets under $2 million, so we can focus on smaller groups. Thank you for the work you do. Please keep an eye on our other opportunities.' },
    { opp: opps.rapid!, question: 'Do you provide food directly to people in Alder, Bramble or Cinder County?', help: null, kind: 'yes_no', config: { required: true }, knockout: 'Rapid Response grants go to programs that provide food directly to people in our three counties. Please contact us if you are not sure; we are happy to help.' },
  ];
  await ctx.insert(
    'eligibility_rules',
    rules.map((r, i) => ({
      id: ctx.id(`eligibility:${r.opp.slug}:${i}`),
      workspace_id: ctx.ws(r.opp.ws).id,
      opportunity_id: r.opp.id,
      position: rules.filter((x, j) => x.opp === r.opp && j < i).length + 1,
      question: r.question,
      help_text: r.help,
      kind: r.kind,
      config: json(r.config),
      knockout_message: r.knockout,
    })),
  );

  // Rubrics and review stages.
  const rubrics: Catalog['rubrics'] = {};
  const rubricDefs: { key: string; ws: string; name: string; criteria: [string, number, string][] }[] = [
    {
      key: 'yaf',
      ws: 'halcyon',
      name: 'Youth Arts Fund rubric',
      criteria: [
        ['Community need', 25, 'How clearly does the applicant show the need among young people in their area?'],
        ['Youth voice & leadership', 25, 'Do young people shape and lead the program?'],
        ['Program quality', 30, 'Is the artistic and youth-development approach strong and realistic?'],
        ['Feasibility & budget', 20, 'Can they do what they propose with this budget and team?'],
      ],
    },
    {
      key: 'nfs',
      ws: 'halcyon',
      name: 'Food Security rubric',
      criteria: [
        ['Need', 30, 'Evidence of food insecurity among the people served.'],
        ['Approach', 30, 'Dignified, choice-based, culturally relevant food access.'],
        ['Partnerships', 20, 'Connections with other providers and the people served.'],
        ['Budget', 20, 'Reasonable and clear.'],
      ],
    },
  ];
  for (const r of rubricDefs) {
    const rid = ctx.id(`rubric:${r.ws}:${r.key}`);
    const w = ctx.ws(r.ws);
    await ctx.insert('rubrics', [{ id: rid, workspace_id: w.id, name: r.name, description: 'Scores from 1 (weak) to 5 (excellent).', status: 'active', created_at: '2024-10-01T17:00:00.000Z' }]);
    const crit = r.criteria.map(([label, weight, guidance], i) => ({
      id: ctx.id(`criterion:${r.key}:${i}`),
      workspace_id: w.id,
      rubric_id: rid,
      position: i + 1,
      label,
      guidance,
      weight_pct: weight,
      scale_min: 1,
      scale_max: 5,
      scale_labels: json({ 1: 'Weak', 3: 'Solid', 5: 'Excellent' }),
    }));
    await ctx.insert('rubric_criteria', crit);
    rubrics[r.key] = { id: rid, criteria: crit.map((x) => ({ id: x.id, weight: x.weight_pct, min: 1, max: 5 })) };
    ctx.audit({ workspace: r.ws, at: '2024-10-01T17:00:00.000Z', actor: ctx.human('jordan'), action: 'review.save_rubric', entityType: 'rubric', entityId: rid, after: { name: r.name, criteria: crit.length } });
  }
  const reviewStages: Record<string, string> = {};
  const stageRows = [
    { key: 'flagship', comp: flag.stages[0]!, rubric: 'yaf', name: 'LOI community review', blind: true, due: zoned('2027-01-08T17:00', PT), status: 'active' },
    { key: 'nfs2026', comp: opps.nfs2026!.stages[0]!, rubric: 'nfs', name: 'Community review', blind: false, due: '2026-03-01T01:00:00.000Z', status: 'closed' },
    { key: 'yaf2025', comp: opps.yaf2025!.stages[0]!, rubric: 'yaf', name: 'Community review', blind: true, due: '2025-03-15T01:00:00.000Z', status: 'closed' },
  ];
  for (const s of stageRows) {
    const id = ctx.id(`review-stage:${s.key}`);
    reviewStages[s.key] = id;
    await ctx.insert('review_stages', [
      { id, workspace_id: ctx.ws('halcyon').id, competition_id: s.comp.id, rubric_id: rubrics[s.rubric]!.id, name: s.name, position: 1, blind: s.blind, reviewers_per_application: 2, due_at: s.due, status: s.status },
    ]);
  }

  return { programs: progs, forms, opps, rubrics, reviewStages };
}
