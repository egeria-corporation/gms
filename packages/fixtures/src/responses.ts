// SPDX-License-Identifier: AGPL-3.0-or-later
// Realistic, valid form answers built from the LOI fixture shapes (@gms/forms fixtures): budgets whose lines
// add up to the request, word limits respected, attestation signed. Validated against the compiled form.
import { validateResponses, type CompiledForm, type ResponseData } from '@gms/forms';
import type { Rng } from './rng';
import type { OrgRec } from './steps/orgs';
import { ACTIVITY_SENTENCES, PROJECT_TITLES, SUMMARY_SENTENCES, type CauseArea } from './words';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Rounds to whole $50 (in cents). */
function round50(cents: number): number {
  return Math.round(cents / 5_000) * 5_000;
}

export function budgetLines(rng: Rng, total: number, cause: CauseArea): { item: string; category: string; amount: number }[] {
  const templates: Record<string, [string, string][]> = {
    arts: [['Teaching artist fees', 'personnel'], ['Instruments and art supplies', 'supplies'], ['Studio or rehearsal space', 'space'], ['Youth mentor stipends', 'stipends'], ['Showcase costs', 'other']],
    food: [['Food purchases', 'supplies'], ['Driver and coordinator hours', 'personnel'], ['Cold storage rental', 'space'], ['Volunteer stipends', 'stipends'], ['Delivery fuel', 'other']],
    default: [['Program staff', 'personnel'], ['Materials', 'supplies'], ['Space rental', 'space'], ['Participant stipends', 'stipends'], ['Outreach', 'other']],
  };
  const lines = (templates[cause] ?? templates.default)!;
  const n = rng.int(3, 4);
  const picks = lines.slice(0, n);
  const weights = picks.map(() => rng.int(15, 45));
  const wsum = weights.reduce((s, w) => s + w, 0);
  const amounts = weights.map((w) => round50((total * w) / wsum));
  const diff = total - amounts.reduce((s, a) => s + a, 0);
  amounts[0] = amounts[0]! + diff;
  return picks.map(([item, category], i) => ({ item, category, amount: amounts[i]! }));
}

function sentences(rng: Rng, pool: readonly string[], n: number): string {
  return rng.sample(pool, n).join(' ');
}

export function projectTitle(rng: Rng, cause: CauseArea, arts = false): string {
  return rng.pick(PROJECT_TITLES[arts ? 'arts' : cause]);
}

export interface LoiOptions {
  request: number;
  title: string;
  aiDisclosure?: string;
  cause?: CauseArea;
}

/** Answers for the Youth Arts LOI (and the 2025 application, which uses the same questions). */
export function loiResponse(rng: Rng, org: OrgRec, o: LoiOptions): ResponseData {
  const sponsored = org.orgType === 'fiscally_sponsored';
  const counties = org.countyCode === 'other' ? ['other'] : rng.chance(0.25) ? [org.countyCode, rng.pick(['alder', 'bramble', 'cinder'].filter((c) => c !== org.countyCode))] : [org.countyCode];
  const ages = rng.sample(['12-14', '15-17', '18-24'], rng.int(1, 3)).sort();
  return {
    org_legal_name: org.name,
    org_ein: org.ein ?? org.sponsor?.ein ?? '00-0000002',
    fiscally_sponsored: sponsored,
    ...(sponsored && org.sponsor ? { sponsor_name: org.sponsor.name, sponsor_ein: org.sponsor.ein } : {}),
    annual_budget: org.budgetCents,
    counties_served: counties,
    project_title: o.title,
    project_summary: `${o.title} is a free program run by ${org.name}. ${sentences(rng, SUMMARY_SENTENCES, 3)}`,
    age_groups: ages,
    youth_served: rng.int(15, 160),
    activities: sentences(rng, ACTIVITY_SENTENCES, 4),
    request_amount: o.request,
    budget_lines: budgetLines(rng, o.request, o.cause ?? 'arts'),
    other_funding: rng.pick([
      'Alder Community Foundation, $10,000 (secured).',
      'City arts commission, $5,000 (pending). Individual donors, $3,000 (secured).',
      'None yet. We are applying to two local family foundations this winter.',
      'Local business sponsors, $2,500 (secured).',
    ]),
    budget_file: { fileId: `file_${org.slug.replace(/-/g, '_').slice(0, 30)}_budget`, name: `${org.slug.slice(0, 30)}-budget.xlsx`, size: rng.int(18_000, 90_000), mimeType: XLSX },
    ai_disclosure: o.aiDisclosure ?? rng.weighted([
      ['None.', 6],
      ['We used an AI writing assistant to tighten the summary. All ideas and numbers are our own.', 2],
      ['I used AI to check spelling and grammar.', 2],
    ]),
    attestation: { agreed: true, name: org.admin.name },
  };
}

/** Answers for the general operating / rapid response / capacity / organizing forms. */
export function generalResponse(rng: Rng, org: OrgRec, request: number, useOfFunds?: string): ResponseData {
  return {
    org_legal_name: org.name,
    org_ein: org.ein ?? org.sponsor?.ein ?? '00-0000002',
    org_mission: org.mission,
    annual_budget: org.budgetCents,
    counties_served: org.countyCode === 'other' ? ['other'] : [org.countyCode],
    request_amount: request,
    use_of_funds:
      useOfFunds ??
      rng.pick([
        'Demand at our pantry is up by a third since spring. This grant would buy food for the next three months and pay for an extra delivery driver two days a week.',
        'We would use the funds for rent and staff time so that our volunteers can focus on the families we serve.',
        'Flexible funding would let us keep our doors open on Saturdays, when working families can actually come.',
        'We want to upgrade our bookkeeping, train our board on finances, and finally have a real budget process.',
      ]),
    attestation: { agreed: true, name: org.admin.name },
  };
}

/** A partial draft: the first page only (valid in save mode, not in submit mode). */
export function draftOf(data: ResponseData, keys: readonly string[]): ResponseData {
  return Object.fromEntries(Object.entries(data).filter(([k]) => keys.includes(k)));
}

/** Throws with a readable message when seeded answers would not pass the form's own validation. */
export function assertValid(compiled: CompiledForm, data: ResponseData, mode: 'save' | 'submit', what: string): void {
  const r = validateResponses(compiled, data, { mode });
  if (!r.valid) {
    throw new Error(`seed data for ${what} is not valid (${mode}): ${r.errors.map((e) => `${e.pointer} ${e.message}`).join('; ')}`);
  }
}

export function interimReport(rng: Rng, youth: number): ResponseData {
  return {
    progress_narrative: rng.pick([
      'We have held 38 sessions since the grant began. Attendance has been steady, and six older students now help lead warm-ups. In May our students performed at the county library.',
      'Our spring term filled up in two weeks, so we added a waitlist and a Saturday session. Young people designed two murals, and one is now on the wall of the corner grocery.',
      'Things are going well. We hired a second teaching artist, and the youth advisory council picked this year’s theme. Families came to our open house in record numbers.',
    ]),
    youth_served_to_date: youth,
    milestone_status: { recruitment: rng.pick(['on_track', 'ahead']), programming: 'on_track', staffing: rng.pick(['on_track', 'behind']) },
    budget_to_actual: [
      { item: 'Teaching artist fees', budgeted: 800_000, spent: rng.int(300, 800) * 1000 },
      { item: 'Supplies', budgeted: 250_000, spent: rng.int(80, 250) * 1000, note: 'Bought in bulk in the fall' },
    ],
    challenges: 'Transportation was hard in the winter. We partnered with the transit agency for free passes, which helped a lot.',
    attestation: { agreed: true, name: 'Program Director' },
  };
}

export function finalReport(rng: Rng, youth: number): ResponseData {
  return {
    outcomes_narrative: 'Young people told us they feel more confident speaking up and more connected to their neighborhood. Most returned for a second term, and several now volunteer as mentors.',
    youth_served_total: youth,
    participant_story: rng.chance(0.5) ? 'One student joined shy and unsure. By June she was leading the warm-up for the whole group and introducing the final show.' : undefined,
    budget_to_actual: [
      { item: 'Program staff', budgeted: 1_000_000, spent: 1_000_000 },
      { item: 'Supplies', budgeted: 300_000, spent: 285_000 },
    ],
    final_financial_report: { fileId: `file_final_${rng.int(1000, 9999)}`, name: 'final-financial-report.pdf', size: rng.int(40_000, 200_000), mimeType: 'application/pdf' },
    lessons_learned: 'Paying older youth as mentors made the biggest difference. We will keep that in every program from now on.',
    attestation: { agreed: true, name: 'Executive Director' },
  };
}
