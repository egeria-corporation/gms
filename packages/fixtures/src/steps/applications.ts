// SPDX-License-Identifier: AGPL-3.0-only
// Applications for every opportunity: the flagship's 142 letters of inquiry, ~800 applications from the
// 2025–2026 cycles, and a few on the open opportunities. Submitted ones get immutable snapshots with receipts,
// status history, eligibility results and decisions.
import { createHash } from 'node:crypto';
import { referenceNumber, workspacePrefix } from '@gms/domain';
import type { ResponseData } from '@gms/forms';
import { json, type Row, type SeedContext } from '../context';
import { assertValid, draftOf, generalResponse, loiResponse } from '../responses';
import type { Rng } from '../rng';
import { between } from '../time';
import { PROJECT_TITLES } from '../words';
import type { Catalog, CompRec, OppKey, OppRec } from './catalog';
import { orgProfile, type OrgRec, type Orgs } from './orgs';

export type AppStatus = 'in_progress' | 'submitted' | 'under_review' | 'invited_to_next_stage' | 'awarded' | 'declined' | 'withdrawn' | 'ineligible';

export interface AppRec {
  id: string;
  ws: string;
  opp: OppRec;
  comp: CompRec;
  org: OrgRec;
  ref: string;
  status: AppStatus;
  createdAt: string;
  submittedAt: string | null;
  reviewAt: string | null;
  decisionAt: string | null;
  requested: number;
  title: string;
  data: ResponseData;
  createdVia: 'human' | 'agent';
  reason: string | null;
  /** Staff tags. */
  tags: string[];
}

export interface Apps {
  all: AppRec[];
  byOpp: Record<OppKey, AppRec[]>;
  mayaLoi: AppRec | null;
  mayaAward: AppRec;
}

interface Timeline {
  start: string;
  end: string;
  reviewTo: string;
  decideFrom: string;
  decideTo: string;
}

const LOI_FIRST_PAGE = ['org_legal_name', 'org_ein', 'fiscally_sponsored', 'annual_budget', 'counties_served', 'project_title'];
const GENERAL_FIRST = ['org_legal_name', 'org_ein', 'org_mission', 'annual_budget', 'counties_served'];

const DECLINE_REASONS = [
  'Thank you for applying. We received many strong requests this cycle and could not fund them all.',
  'Thank you for your application. This project was a strong fit, but we did not have enough funds to support it this year.',
];
const INELIGIBLE_REASONS = {
  budget: 'This fund is for organizations with annual budgets under $2 million.',
  region: 'This fund supports programs in Alder, Bramble and Cinder Counties.',
  irs: 'We could not confirm the organization’s tax-exempt status with the IRS. Please contact us if this is a mistake.',
  youth: 'This program does not serve young people ages 12–24.',
};

export function statusList(counts: Partial<Record<AppStatus, number>>): AppStatus[] {
  return (Object.entries(counts) as [AppStatus, number][]).flatMap(([s, n]) => Array<AppStatus>(n).fill(s));
}

function ineligibleReason(o: OrgRec, opp: OppKey): string {
  if (o.ein === '00-0000009') return INELIGIBLE_REASONS.irs;
  if (o.countyCode === 'other') return INELIGIBLE_REASONS.region;
  if ((opp === 'flagship' || opp === 'yaf2025') && o.budgetCents > 200_000_000) return INELIGIBLE_REASONS.budget;
  return opp === 'flagship' || opp === 'yaf2025' ? INELIGIBLE_REASONS.youth : INELIGIBLE_REASONS.region;
}

export async function applications(ctx: SeedContext, cat: Catalog, orgs: Orgs): Promise<Apps> {
  const c = ctx.clock;
  const anchor = c.anchor.getTime();
  const clamp = (iso: string) => (Date.parse(iso) > anchor - 3_600_000 ? c.iso(0, -1) : iso);
  const all: AppRec[] = [];
  const byOpp = {} as Record<OppKey, AppRec[]>;
  const used = new Map<OppKey, Set<string>>();

  const plan = (
    key: OppKey,
    pool: OrgRec[],
    statuses: AppStatus[],
    tl: Timeline,
    build: (rng: Rng, org: OrgRec, request: number, title: string) => ResponseData,
    requestRange: [number, number],
    opts: { fixed?: Record<number, OrgRec>; causeTitles?: boolean } = {},
  ) => {
    const opp = cat.opps[key]!;
    const rng = ctx.stream(`apps:${key}`);
    const comp = opp.stages[0]!;
    const taken = used.get(key) ?? new Set<string>();
    used.set(key, taken);
    const candidates = rng.shuffle(pool.filter((o) => !taken.has(o.id)));
    const list: AppRec[] = [];
    statuses.forEach((status, i) => {
      const org = opts.fixed?.[i] ?? candidates.shift();
      if (!org) throw new Error(`not enough organizations for ${key}`);
      taken.add(org.id);
      const createdAt = clamp(between(tl.start, tl.end, rng.next() * 0.85));
      const submitted = status !== 'in_progress' && !(status === 'withdrawn' && rng.chance(0.3));
      const submittedAt = submitted ? clamp(between(createdAt, tl.end, 0.2 + rng.next() * 0.8)) : null;
      const reviewAt = ['under_review', 'invited_to_next_stage', 'awarded', 'declined'].includes(status) && submittedAt ? clamp(between(submittedAt, tl.reviewTo, rng.next())) : null;
      const decisionAt = ['invited_to_next_stage', 'awarded', 'declined', 'ineligible'].includes(status) ? clamp(between(tl.decideFrom, tl.decideTo, rng.next())) : status === 'withdrawn' ? clamp(between(submittedAt ?? createdAt, tl.decideTo, rng.next() * 0.5)) : null;
      const [lo, hi] = requestRange;
      const request = rng.int(lo / 50_000, hi / 50_000) * 50_000;
      const title = opts.causeTitles ? rng.pick(PROJECT_TITLES[org.cause]) : rng.pick(PROJECT_TITLES.arts);
      const full = build(rng, org, request, title);
      const data = status === 'in_progress' && rng.chance(0.7) ? draftOf(full, key === 'flagship' || key === 'yaf2025' ? LOI_FIRST_PAGE : GENERAL_FIRST) : full;
      list.push({
        id: ctx.id(`application:${opp.ws}:${key}:${org.slug}`),
        ws: opp.ws,
        opp,
        comp,
        org,
        ref: '',
        status,
        createdAt,
        submittedAt,
        reviewAt,
        decisionAt: decisionAt && reviewAt && Date.parse(decisionAt) < Date.parse(reviewAt) ? reviewAt : decisionAt,
        requested: request,
        title: status === 'in_progress' && !('project_title' in data) ? opp.title : title,
        data,
        createdVia: 'human',
        reason: status === 'declined' ? rng.pick(DECLINE_REASONS) : status === 'ineligible' ? ineligibleReason(org, key) : status === 'withdrawn' ? 'We decided to apply next cycle instead.' : null,
        tags: [],
      });
    });
    byOpp[key] = list;
    all.push(...list);
    return list;
  };

  const loi = (rng: Rng, org: OrgRec, request: number, title: string) => loiResponse(rng, org, { request, title });
  const general = (rng: Rng, org: OrgRec, request: number) => generalResponse(rng, org, request);

  // Flagship: 142 letters of inquiry --------------------------------------------------------------------------
  const flag = cat.opps.flagship!;
  const early = flag.status === 'forecasted';
  const flagTl: Timeline = early
    ? { start: c.iso(-24), end: c.iso(-1), reviewTo: c.iso(0, -2), decideFrom: c.iso(-2), decideTo: c.iso(0, -1) }
    : { start: flag.opensAt, end: clamp(flag.closesAt), reviewTo: c.iso(0, -1), decideFrom: clamp(new Date(Math.min(anchor, Date.parse(flag.closesAt))).toISOString()), decideTo: c.iso(0, -1) };
  const { eastside, lumen, oldmill, cedar } = orgs.byKey;
  const risky = orgs.core.filter((o) => o.countyCode === 'other' || o.budgetCents > 200_000_000);
  const flagStatuses = statusList({ in_progress: 24, submitted: 38, under_review: 40, invited_to_next_stage: 18, declined: 12, withdrawn: 5, ineligible: 5 });
  const firstIneligible = flagStatuses.indexOf('ineligible');
  const firstUnder = flagStatuses.indexOf('under_review');
  const fixed: Record<number, OrgRec> = { 0: eastside, [firstUnder]: lumen, [firstIneligible]: oldmill };
  risky.slice(0, 4).forEach((o, i) => (fixed[firstIneligible + 1 + i] = o));
  const flagPool = [...orgs.core.filter((o) => !Object.values(fixed).includes(o)), ...orgs.alumni.slice(0, 40)];
  plan('flagship', flagPool, flagStatuses, flagTl, loi, [500_000, 2_500_000], { fixed });
  // Maya's LOI: fully drafted by her Grant Writer Assistant, waiting for her confirmation to submit.
  const mayaLoi = byOpp.flagship[0]!;
  mayaLoi.title = 'Eastside Summer Strings Intensive';
  mayaLoi.requested = 2_000_000;
  mayaLoi.data = loiResponse(ctx.stream('maya-loi'), eastside, {
    request: 2_000_000,
    title: 'Eastside Summer Strings Intensive',
    aiDisclosure: 'I used the Grant Writer Assistant (an AI agent) to draft this letter from our program notes. I reviewed and edited every answer.',
  });
  mayaLoi.data.youth_served = 64;
  mayaLoi.data.counties_served = ['alder'];
  mayaLoi.data.age_groups = ['12-14', '15-17'];
  mayaLoi.createdVia = 'agent';
  mayaLoi.createdAt = early ? c.iso(-6) : between(flag.opensAt, c.iso(0, -3), 0.5);
  // Only in-progress applications and fully valid submissions exist, so check every submitted LOI.
  for (const a of byOpp.flagship) assertValid(flag.stages[0]!.form.compiled, a.data, a.status === 'in_progress' ? 'save' : 'submit', `${a.ref || a.org.name} (flagship)`);
  assertValid(flag.stages[0]!.form.compiled, mayaLoi.data, 'submit', 'Maya’s LOI');

  // Youth Arts Fund 2025 (archived): 370 applications -------------------------------------------------------------
  const yaf = cat.opps.yaf2025!;
  const yafTl: Timeline = { start: yaf.opensAt, end: yaf.closesAt, reviewTo: '2025-03-15T00:00:00.000Z', decideFrom: '2025-05-12T17:00:00.000Z', decideTo: '2025-05-20T17:00:00.000Z' };
  const yafAwardees = [eastside, lumen, ...orgs.core.filter((o) => !risky.includes(o) && o.cause !== 'food').slice(0, 18)];
  const yafStatuses = statusList({ awarded: 20, declined: 280, withdrawn: 15, ineligible: 20, in_progress: 35 });
  plan('yaf2025', [...orgs.alumni, ...orgs.core.filter((o) => !yafAwardees.includes(o))], yafStatuses, yafTl, loi, [500_000, 2_500_000], {
    fixed: Object.fromEntries(yafAwardees.map((o, i) => [i, o])),
  });
  const mayaAward = byOpp.yaf2025[0]!;
  mayaAward.title = 'Eastside Youth Orchestra: Year-Round Strings';
  mayaAward.requested = 2_500_000;
  mayaAward.data = loiResponse(ctx.stream('maya-2025'), eastside, { request: 2_500_000, title: 'Eastside Youth Orchestra: Year-Round Strings', aiDisclosure: 'None.' });
  for (const a of byOpp.yaf2025) assertValid(yaf.stages[0]!.form.compiled, a.data, a.status === 'in_progress' ? 'save' : 'submit', `${a.org.name} (yaf2025)`);

  // Neighborhood Food Security 2026 (closed): 430 applications -------------------------------------------------------
  const nfs = cat.opps.nfs2026!;
  const nfsTl: Timeline = { start: nfs.opensAt, end: nfs.closesAt, reviewTo: '2026-02-25T00:00:00.000Z', decideFrom: '2026-03-16T17:00:00.000Z', decideTo: '2026-03-24T17:00:00.000Z' };
  const nfsAwardees = [cedar, ...orgs.core.filter((o) => !yafAwardees.includes(o) && o.countyCode !== 'other' && !risky.includes(o)).slice(0, 21)];
  const nfsStatuses = statusList({ awarded: 22, declined: 320, withdrawn: 18, ineligible: 25, in_progress: 45 });
  plan('nfs2026', [...orgs.alumni, ...orgs.core.filter((o) => !nfsAwardees.includes(o)), lumen, oldmill], nfsStatuses, nfsTl, general, [1_000_000, 4_000_000], {
    fixed: Object.fromEntries(nfsAwardees.map((o, i) => [i, o])),
    causeTitles: true,
  });
  for (const a of byOpp.nfs2026) assertValid(nfs.stages[0]!.form.compiled, a.data, a.status === 'in_progress' ? 'save' : 'submit', `${a.org.name} (nfs2026)`);

  // Rapid response (always open): 25 requests, none from Maya's organization -----------------------------------------------
  const rapid = cat.opps.rapid!;
  const rapidTl: Timeline = { start: rapid.opensAt, end: c.iso(0, -2), reviewTo: c.iso(0, -1), decideFrom: c.iso(-3), decideTo: c.iso(0, -1) };
  const foodFirst = [...orgs.core.filter((o) => o.cause === 'food'), ...orgs.core.filter((o) => o.cause !== 'food')].filter((o) => o !== eastside);
  plan('rapid', foodFirst.slice(0, 40), statusList({ under_review: 10, submitted: 8, in_progress: 7 }), rapidTl, general, [250_000, 1_500_000], { causeTitles: true });

  // Capacity mini-grants: a few applications when it is open.
  const mini = cat.opps.capacityMini!;
  if (mini.status === 'open') {
    plan('capacityMini', orgs.core.filter((o) => o.budgetCents <= 75_000_000 && o !== eastside), statusList({ in_progress: 5, submitted: 3 }), { start: mini.opensAt, end: c.iso(0, -2), reviewTo: c.iso(0, -1), decideFrom: c.iso(-1), decideTo: c.iso(0, -1) }, general, [200_000, 750_000]);
  }

  // Marigold: a handful of applications (two awarded).
  const mg = cat.opps.marigold!;
  plan('marigold', orgs.core.filter((o) => o.cause !== 'arts'), statusList({ awarded: 2, submitted: 2, in_progress: 1, declined: 1 }), { start: mg.opensAt, end: c.iso(-4), reviewTo: c.iso(-3), decideFrom: c.iso(-3), decideTo: c.iso(-2) }, general, [100_000, 500_000], { causeTitles: true });
  for (const k of ['rapid', 'capacityMini', 'marigold'] as const) {
    for (const a of byOpp[k] ?? []) assertValid(a.comp.form.compiled, a.data, a.status === 'in_progress' ? 'save' : 'submit', `${a.org.name} (${k})`);
  }

  // Tags a program officer would add.
  for (const a of byOpp.flagship) {
    if (a.status === 'under_review' && a.org.budgetCents < 25_000_000) a.tags.push('small-org');
    if (a.status === 'invited_to_next_stage') a.tags.push('strong-loi');
  }

  assignReferences(ctx, all);
  await write(ctx, all);
  return { all, byOpp, mayaLoi, mayaAward };
}

function yearIn(iso: string, tz: string): number {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric' }).format(new Date(iso)));
}

function assignReferences(ctx: SeedContext, apps: AppRec[]): void {
  const counters = new Map<string, number>();
  for (const a of [...apps].sort((x, y) => x.createdAt.localeCompare(y.createdAt) || x.id.localeCompare(y.id))) {
    const w = ctx.ws(a.ws);
    const year = yearIn(a.createdAt, w.timezone);
    const k = `${a.ws}:${year}`;
    const n = (counters.get(k) ?? 0) + 1;
    counters.set(k, n);
    a.ref = referenceNumber(workspacePrefix(w.name), year, n);
  }
  ctx.refCounters.push(...[...counters.entries()].map(([k, n]) => ({ ws: k.split(':')[0]!, kind: 'application', year: Number(k.split(':')[1]), value: n })));
}

async function write(ctx: SeedContext, apps: AppRec[]): Promise<void> {
  const jordan = ctx.human('jordan');
  const helen = ctx.human('helen');
  const staffFor = (ws: string) => (ws === 'marigold' ? ctx.human('kwame') : jordan);
  const deciderFor = (ws: string) => (ws === 'marigold' ? ctx.human('rosa') : helen);
  const appRows: Row<'applications'>[] = [];
  const responses: Row<'form_responses'>[] = [];
  const submissions: Row<'application_submissions'>[] = [];
  const history: Row<'status_history'>[] = [];
  const eligibility: Row<'eligibility_results'>[] = [];
  const decisions: Row<'decisions'>[] = [];
  const invites: Row<'competition_invites'>[] = [];

  for (const a of apps) {
    const w = ctx.ws(a.ws);
    const lastChange = a.decisionAt ?? a.reviewAt ?? a.submittedAt ?? a.createdAt;
    const applicant = { type: 'human' as const, id: a.org.admin.id, name: a.org.admin.name };
    appRows.push({
      id: a.id,
      workspace_id: w.id,
      opportunity_id: a.opp.id,
      competition_id: a.comp.id,
      applicant_org_id: a.org.id,
      applicant_user_id: a.org.admin.id,
      reference_number: a.ref,
      title: a.title,
      status: a.status,
      requested_amount_cents: a.status === 'in_progress' && !('request_amount' in a.data) ? null : a.requested,
      submitted_at: a.submittedAt,
      ai_disclosure: a.submittedAt && typeof a.data.ai_disclosure === 'string' ? a.data.ai_disclosure : null,
      created_via: a.createdVia,
      submitted_via: a.submittedAt ? 'human' : null,
      tags: a.tags,
      created_at: a.createdAt,
      last_modified_at: lastChange,
    });
    responses.push({
      id: ctx.id(`form-response:${a.id}`),
      workspace_id: w.id,
      application_id: a.id,
      form_id: a.comp.form.id,
      form_version_id: a.comp.form.versionId,
      data: json(a.data),
      field_updated_at: json(Object.fromEntries(Object.keys(a.data).map((k) => [k, a.submittedAt ?? a.createdAt]))),
      etag: ctx.id(`etag:${a.id}`).slice(0, 16).replace(/-/g, ''),
      updated_by: a.org.admin.id,
      created_at: a.createdAt,
      last_modified_at: a.submittedAt ?? a.createdAt,
    });
    if (a.createdVia === 'human') ctx.audit({ workspace: a.ws, at: a.createdAt, actor: applicant, action: 'applications.start', entityType: 'application', entityId: a.id, after: { reference: a.ref } });

    if (a.submittedAt) {
      const profile = orgProfile(a.org);
      const versions = [{ formId: a.comp.form.id, formVersionId: a.comp.form.versionId }];
      const attestation = { typedName: a.org.admin.name, agreed: true, at: a.submittedAt, ip: null, via: 'human' };
      const content = json({ responses: { [a.comp.form.id]: a.data }, profile, versions, attestation });
      const receipt = `${a.ref}-R1`;
      const hash = createHash('sha256').update(content).digest('hex');
      submissions.push({
        id: ctx.id(`submission:${a.id}:1`),
        workspace_id: w.id,
        application_id: a.id,
        competition_id: a.comp.id,
        submitted_at: a.submittedAt,
        submitted_by: a.org.admin.id,
        responses: json({ [a.comp.form.id]: a.data }),
        org_profile: json(profile),
        form_versions: json(versions),
        attestation: json(attestation),
        receipt_number: receipt,
        content_hash: hash,
      });
      history.push({ id: ctx.id(`history:${a.id}:submitted`), workspace_id: w.id, application_id: a.id, from_status: 'in_progress', to_status: 'submitted', actor_type: 'human', actor_id: applicant.id, actor_name: applicant.name, created_at: a.submittedAt });
      ctx.audit({ workspace: a.ws, at: a.submittedAt, actor: applicant, action: 'applications.submit', entityType: 'application', entityId: a.id, before: { status: 'in_progress' }, after: { status: 'submitted', receipt, contentHash: hash }, riskTier: 'R2' });

      if (a.opp.key === 'flagship') {
        const d = a.data;
        const countyLabels = ((d.counties_served as string[] | undefined) ?? []).map((x) => (x === 'other' ? 'Somewhere else' : `${x[0]!.toUpperCase()}${x.slice(1)} County`));
        const answers: [string, unknown, boolean][] = [
          ['Is your organization a 501(c)(3) public charity, or fiscally sponsored by one?', true, a.org.ein !== '00-0000009'],
          ['Does your program serve young people ages 12 to 24?', true, true],
          ['Where does your program take place?', countyLabels, a.org.countyCode !== 'other'],
          ['What is your organization’s annual operating budget?', a.org.budgetCents / 100, a.org.budgetCents <= 200_000_000],
        ];
        answers.forEach(([q, answer, passed], i) =>
          eligibility.push({ id: ctx.id(`eligibility-result:${a.id}:${i}`), workspace_id: w.id, application_id: a.id, rule_id: ctx.id(`eligibility:${a.opp.slug}:${i}`), question: q, passed, answer: json(answer), source: 'submission', evaluated_at: a.submittedAt! }),
        );
      }
    }
    const staff = staffFor(a.ws);
    if (a.reviewAt) {
      history.push({ id: ctx.id(`history:${a.id}:review`), workspace_id: w.id, application_id: a.id, from_status: 'submitted', to_status: 'under_review', actor_type: 'human', actor_id: staff.id, actor_name: staff.name, created_at: a.reviewAt });
    }
    const from = a.reviewAt ? 'under_review' : a.submittedAt ? 'submitted' : 'in_progress';
    if (a.decisionAt && a.status !== 'withdrawn') {
      const actor = a.status === 'ineligible' || a.status === 'invited_to_next_stage' ? staff : deciderFor(a.ws);
      history.push({ id: ctx.id(`history:${a.id}:${a.status}`), workspace_id: w.id, application_id: a.id, from_status: from, to_status: a.status, reason: a.reason, actor_type: 'human', actor_id: actor.id, actor_name: actor.name, created_at: a.decisionAt });
      if (a.status === 'awarded' || a.status === 'declined') {
        decisions.push({
          id: ctx.id(`decision:${a.id}`),
          workspace_id: w.id,
          application_id: a.id,
          outcome: a.status === 'awarded' ? 'approve' : 'decline',
          reason: a.reason,
          recommended_amount_cents: a.status === 'awarded' ? a.requested : null,
          is_final: true,
          recorded_by: actor.id,
          recorded_at: a.decisionAt,
          letter_sent_at: a.decisionAt,
          created_at: a.decisionAt,
        });
        ctx.audit({ workspace: a.ws, at: a.decisionAt, actor, action: 'decisions.record_final', entityType: 'application', entityId: a.id, after: { outcome: a.status === 'awarded' ? 'approve' : 'decline' }, riskTier: 'R3' });
      } else {
        ctx.audit({ workspace: a.ws, at: a.decisionAt, actor, action: a.status === 'ineligible' ? 'applications.mark_ineligible' : 'competitions.invite_applicants', entityType: 'application', entityId: a.id, after: { status: a.status } });
      }
      if (a.status === 'invited_to_next_stage' && a.opp.stages[1]) {
        invites.push({ id: ctx.id(`invite:${a.id}`), workspace_id: w.id, competition_id: a.opp.stages[1].id, applicant_org_id: a.org.id, from_application_id: a.id, status: 'pending', invited_by: staff.id, created_at: a.decisionAt });
      }
    }
    if (a.status === 'withdrawn' && a.decisionAt) {
      history.push({ id: ctx.id(`history:${a.id}:withdrawn`), workspace_id: w.id, application_id: a.id, from_status: a.submittedAt ? 'submitted' : 'in_progress', to_status: 'withdrawn', reason: a.reason, actor_type: 'human', actor_id: applicant.id, actor_name: applicant.name, created_at: a.decisionAt });
      ctx.audit({ workspace: a.ws, at: a.decisionAt, actor: applicant, action: 'applications.withdraw', entityType: 'application', entityId: a.id, after: { status: 'withdrawn' }, riskTier: 'R2' });
    }
  }
  await ctx.insert('applications', appRows);
  await ctx.insert('form_responses', responses);
  await ctx.insert('application_submissions', submissions, 200);
  await ctx.insert('status_history', history);
  await ctx.insert('eligibility_results', eligibility);
  await ctx.insert('decisions', decisions);
  await ctx.insert('competition_invites', invites);
}
