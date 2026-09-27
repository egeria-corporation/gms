// SPDX-License-Identifier: AGPL-3.0-only
// Post-award: 25 report requirements across every status (with submissions), indicators, change requests
// and site visits.
import { json, type Row, type SeedContext } from '../context';
import { assertValid, finalReport, interimReport } from '../responses';
import type { AwardRec, Awards } from './awards';
import type { Catalog } from './catalog';

type ReportStatus = 'upcoming' | 'due' | 'overdue' | 'submitted' | 'accepted' | 'revisions_requested';

interface ReqDef {
  award: AwardRec;
  key: string;
  title: string;
  kind: 'interim' | 'final';
  due: string;
  status: ReportStatus;
  draft?: boolean;
}

export interface PostAward {
  mayaUpcomingRequirementId: string;
  requirements: number;
}

export async function postAward(ctx: SeedContext, cat: Catalog, aw: Awards): Promise<PostAward> {
  const c = ctx.clock;
  const rng = ctx.stream('reports');
  const yaf = aw.yaf;
  const nfs = aw.nfs;
  const defs: ReqDef[] = [];
  // Completed one-year grants: interim + final, both accepted (8).
  for (const a of yaf.filter((x) => x.status === 'completed')) {
    defs.push({ award: a, key: 'interim', title: 'Interim report', kind: 'interim', due: '2025-12-01', status: 'accepted' });
    defs.push({ award: a, key: 'final', title: 'Final report', kind: 'final', due: '2026-06-30', status: 'accepted' });
  }
  // Maya: year-one report accepted; year-two interim report upcoming (her agent drafted it).
  defs.push({ award: aw.maya, key: 'year1', title: 'Year 1 report', kind: 'interim', due: '2026-06-30', status: 'accepted' });
  defs.push({ award: aw.maya, key: 'year2-interim', title: 'Year 2 interim report', kind: 'interim', due: c.date(30), status: 'upcoming', draft: true });
  // Other year-one reports.
  for (const i of [1, 2, 3, 4]) defs.push({ award: yaf[i]!, key: 'year1', title: 'Year 1 report', kind: 'interim', due: '2026-06-30', status: 'submitted' });
  for (const i of [5, 6]) defs.push({ award: yaf[i]!, key: 'year1', title: 'Year 1 report', kind: 'interim', due: '2026-06-30', status: 'revisions_requested' });
  for (const i of [14, 15]) defs.push({ award: yaf[i]!, key: 'year1', title: 'Year 1 report', kind: 'interim', due: c.date(-20), status: 'overdue' });
  defs.push({ award: nfs[12]!, key: 'interim', title: 'Interim report', kind: 'interim', due: c.date(-12), status: 'overdue' });
  for (const [n, i] of [7, 8, 9].entries()) defs.push({ award: yaf[i]!, key: 'year1', title: 'Year 1 report', kind: 'interim', due: c.date(5 + n * 3), status: 'due', draft: n === 0 });
  for (const [n, i] of [1, 2, 3].entries()) defs.push({ award: nfs[i]!, key: 'interim', title: 'Interim report', kind: 'interim', due: c.date(45 + n * 7), status: 'upcoming' });
  if (defs.length !== 25) throw new Error(`expected 25 report requirements, planned ${defs.length}`);

  const hal = ctx.ws('halcyon');
  const interimForm = cat.forms.interim!;
  const finalForm = cat.forms.final!;
  const reqRows: Row<'report_requirements'>[] = [];
  const subRows: Row<'report_submissions'>[] = [];
  const indicatorValues: Row<'indicator_values'>[] = [];
  const indicators = {
    youth: ctx.id('indicator:youth-served'),
    households: ctx.id('indicator:households-served'),
  };
  await ctx.insert('indicators', [
    { id: indicators.youth, workspace_id: hal.id, program_id: cat.programs.yaf!, name: 'Young people served', unit: 'count', description: 'Unique young people who took part.' },
    { id: indicators.households, workspace_id: hal.id, program_id: cat.programs.nfs!, name: 'Households served', unit: 'count', description: 'Unique households that received food.' },
  ]);
  let mayaUpcomingRequirementId = '';

  for (const d of defs) {
    const id = ctx.id(`report-req:${d.award.id}:${d.key}`);
    if (d.award === aw.maya && d.status === 'upcoming') mayaUpcomingRequirementId = id;
    const form = d.kind === 'interim' ? interimForm : finalForm;
    reqRows.push({
      id,
      workspace_id: hal.id,
      award_id: d.award.id,
      form_id: form.id,
      title: d.title,
      kind: d.kind,
      due_date: d.due,
      status: d.status,
      holds_payments: true,
      reminder_sent_at: ['due', 'overdue'].includes(d.status) ? c.iso(-3) : null,
      created_at: d.award.createdAt,
    });
    const youth = rng.int(20, 140);
    const org = d.award.app.org;
    const data = d.kind === 'interim' ? { ...interimReport(rng, youth), attestation: { agreed: true, name: org.admin.name } } : { ...finalReport(rng, youth), attestation: { agreed: true, name: org.admin.name } };
    if (d.award === aw.maya && d.status === 'upcoming') continue; // drafted by her agent through the action layer
    if (['submitted', 'accepted', 'revisions_requested'].includes(d.status) || d.draft) {
      assertValid(form.compiled, data, 'submit', `${d.title} for ${d.award.ref}`);
      const submittedAt = d.status === 'accepted' || d.status === 'revisions_requested' || d.status === 'submitted' ? new Date(Date.parse(`${d.due}T20:00:00Z`) - rng.int(1, 12) * 86_400_000).toISOString() : null;
      const reviewedAt = submittedAt && d.status !== 'submitted' ? new Date(Date.parse(submittedAt) + rng.int(3, 15) * 86_400_000).toISOString() : null;
      const sid = ctx.id(`report-sub:${id}`);
      subRows.push({
        id: sid,
        workspace_id: hal.id,
        requirement_id: id,
        award_id: d.award.id,
        form_version_id: form.versionId,
        data: json(submittedAt ? { ...data, _attestation: { typedName: org.admin.name, agreed: true, at: submittedAt } } : data),
        status: d.draft ? 'draft' : d.status === 'accepted' ? 'accepted' : d.status === 'revisions_requested' ? 'revisions_requested' : 'submitted',
        submitted_by: submittedAt ? org.admin.id : null,
        submitted_at: submittedAt,
        reviewer_id: reviewedAt ? ctx.person('jordan').id : null,
        review_note: d.status === 'revisions_requested' ? 'Thanks! Could you add the spending to date for each budget line, and a sentence about the spring showcase?' : d.status === 'accepted' ? 'Accepted. Thank you for the thoughtful report.' : null,
        reviewed_at: reviewedAt,
        created_at: submittedAt ?? c.iso(-2),
      });
      if (submittedAt) {
        ctx.audit({ workspace: 'halcyon', at: submittedAt, actor: { type: 'human', id: org.admin.id, name: org.admin.name }, action: 'reports.submit', entityType: 'report_requirement', entityId: id, before: { status: 'due' }, after: { status: 'submitted' }, riskTier: 'R2' });
      }
      if (reviewedAt) {
        ctx.audit({ workspace: 'halcyon', at: reviewedAt, actor: ctx.human('jordan'), action: 'reports.review', entityType: 'report_requirement', entityId: id, before: { status: 'submitted' }, after: { status: d.status } });
      }
      if (d.status === 'accepted') {
        const isFood = d.award.group === 'nfs';
        indicatorValues.push({ id: ctx.id(`indicator-value:${id}`), workspace_id: hal.id, indicator_id: isFood ? indicators.households : indicators.youth, award_id: d.award.id, report_submission_id: sid, value: youth, period_end: d.due, created_at: reviewedAt! });
      }
    }
    if (d.status === 'overdue') {
      ctx.audit({ workspace: 'halcyon', at: c.iso(-1, -12), actor: { type: 'system' }, action: 'system.tick_reports', entityType: 'report_requirement', entityId: id, before: { status: 'due' }, after: { status: 'overdue' } });
    }
  }
  await ctx.insert('report_requirements', reqRows);
  await ctx.insert('report_submissions', subRows);
  await ctx.insert('indicator_values', indicatorValues);

  // Change requests: one pending extension (overdue report), one approved amendment (the approved child award).
  const overdue = yaf[14]!;
  await ctx.insert('change_requests', [
    {
      id: ctx.id('change-request:extension'),
      workspace_id: hal.id,
      award_id: overdue.id,
      requirement_id: ctx.id(`report-req:${overdue.id}:year1`),
      kind: 'extension',
      details: json({ newDueDate: c.date(14) }),
      reason: 'Our program director left in August and we are still rebuilding our attendance records. Two more weeks would let us send an accurate report.',
      status: 'pending',
      requested_by: overdue.app.org.admin.id,
      created_at: c.iso(-2),
    },
    {
      id: ctx.id('change-request:amendment'),
      workspace_id: hal.id,
      award_id: aw.children[0]!.parent.id,
      kind: 'amendment',
      details: json({ amountCents: aw.children[0]!.amount, newEndDate: '2027-06-30' }),
      reason: 'We opened a second distribution site at the Emberton community center and need three more months and $5,000 to cover it.',
      status: 'approved',
      requested_by: aw.children[0]!.parent.app.org.admin.id,
      decided_by: ctx.person('helen').id,
      decided_at: c.iso(-16),
      decision_note: 'Approved. Thank you for responding so quickly to the need.',
      created_at: c.iso(-24),
    },
  ]);
  ctx.audit({ workspace: 'halcyon', at: c.iso(-2), actor: { type: 'human', id: overdue.app.org.admin.id, name: overdue.app.org.admin.name }, action: 'awards.request_change', entityType: 'change_request', entityId: ctx.id('change-request:extension'), after: { kind: 'extension' } });

  await ctx.insert(
    'site_visits',
    [yaf[0]!, yaf[2]!, nfs[3]!].map((a, i) => ({
      id: ctx.id(`site-visit:${a.id}`),
      workspace_id: hal.id,
      applicant_org_id: a.app.org.id,
      award_id: a.id,
      visited_on: c.date(-60 + i * 17),
      visited_by: ctx.person('jordan').id,
      summary: ['Sat in on a Tuesday rehearsal: 22 students, two teaching artists, and a very proud peer mentor running sectionals.', 'Toured the new studio space. Walls are up for the spring mural.', 'Visited the Saturday market. Line out the door by 9:30; volunteers were organized and kind.'][i]!,
      follow_ups: i === 1 ? 'Send them the contact for the county arts council.' : null,
    })),
  );

  return { mayaUpcomingRequirementId, requirements: reqRows.length };
}
