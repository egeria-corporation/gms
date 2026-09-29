// SPDX-License-Identifier: AGPL-3.0-or-later
// Board dockets: a closed March 2026 meeting that approved Food Security grants, and a meeting in session today
// with Rapid Response recommendations and some votes already cast.
import type { Row, SeedContext } from '../context';
import type { Apps } from './applications';

export async function board(ctx: SeedContext, apps: Apps): Promise<void> {
  const c = ctx.clock;
  const hal = ctx.ws('halcyon');
  const boardMembers = ['ruth', 'dennis', 'mei'].map((k) => ctx.person(k));

  const past = ctx.id('docket:2026-03');
  const current = ctx.id('docket:current');
  await ctx.insert('dockets', [
    { id: past, workspace_id: hal.id, name: 'Board meeting: March 2026 grants', meeting_at: '2026-03-18T01:00:00.000Z', status: 'closed', quorum: 3, created_by: ctx.person('jordan').id, created_at: '2026-03-06T18:00:00.000Z' },
    { id: current, workspace_id: hal.id, name: 'Board meeting: Rapid Response recommendations', meeting_at: c.iso(0, 3), status: 'in_session', quorum: 3, created_by: ctx.person('jordan').id, created_at: c.iso(-5) },
  ]);
  const items: Row<'docket_items'>[] = [];
  const votes: Row<'votes'>[] = [];
  const recs: Row<'decisions'>[] = [];

  const awarded = apps.byOpp.nfs2026.filter((a) => a.status === 'awarded').slice(0, 10);
  awarded.forEach((a, i) => {
    const id = ctx.id(`docket-item:${past}:${a.id}`);
    items.push({ id, workspace_id: hal.id, docket_id: past, application_id: a.id, position: i + 1, recommended_amount_cents: a.requested, recommendation: 'Approve at the requested amount.', outcome: 'approved', created_at: '2026-03-06T18:00:00.000Z' });
    for (const m of boardMembers) votes.push({ id: ctx.id(`vote:${id}:${m.id}`), workspace_id: hal.id, docket_item_id: id, voter_id: m.id, vote: 'approve', recorded_at: '2026-03-18T01:30:00.000Z' });
  });

  const pending = apps.byOpp.rapid.filter((a) => a.status === 'under_review').slice(0, 4);
  pending.forEach((a, i) => {
    const id = ctx.id(`docket-item:${current}:${a.id}`);
    const amount = Math.min(a.requested, 1_500_000);
    items.push({ id, workspace_id: hal.id, docket_id: current, application_id: a.id, position: i + 1, recommended_amount_cents: amount, recommendation: `Approve $${(amount / 100).toLocaleString('en-US')} for emergency food purchases.`, created_at: c.iso(-5) });
    recs.push({ id: ctx.id(`recommendation:${a.id}`), workspace_id: hal.id, application_id: a.id, outcome: 'approve', reason: 'Documented jump in demand; strong partner references.', recommended_amount_cents: amount, is_final: false, recorded_by: ctx.person('jordan').id, recorded_at: c.iso(-6), created_at: c.iso(-6) });
    ctx.audit({ workspace: 'halcyon', at: c.iso(-6), actor: ctx.human('jordan'), action: 'decisions.recommend', entityType: 'application', entityId: a.id, after: { outcome: 'approve', amountCents: amount } });
    if (i < 2) votes.push({ id: ctx.id(`vote:${id}:ruth`), workspace_id: hal.id, docket_item_id: id, voter_id: boardMembers[0]!.id, vote: 'approve', recorded_at: c.iso(0, -1) });
    if (i === 0) votes.push({ id: ctx.id(`vote:${id}:dennis`), workspace_id: hal.id, docket_item_id: id, voter_id: boardMembers[1]!.id, vote: 'approve', recorded_at: c.iso(0, -1) });
  });
  await ctx.insert('docket_items', items);
  await ctx.insert('votes', votes);
  await ctx.insert('decisions', recs);
  ctx.audit({ workspace: 'halcyon', at: '2026-03-06T18:00:00.000Z', actor: ctx.human('jordan'), action: 'board.create_docket', entityType: 'docket', entityId: past, after: { items: awarded.length } });
  ctx.audit({ workspace: 'halcyon', at: '2026-03-18T02:00:00.000Z', actor: ctx.human('jordan'), action: 'board.set_docket_status', entityType: 'docket', entityId: past, before: { status: 'in_session' }, after: { status: 'closed' }, riskTier: 'R2' });
  ctx.audit({ workspace: 'halcyon', at: c.iso(-5), actor: ctx.human('jordan'), action: 'board.create_docket', entityType: 'docket', entityId: current, after: { items: pending.length } });
  ctx.audit({ workspace: 'halcyon', at: c.iso(0, -2), actor: ctx.human('jordan'), action: 'board.set_docket_status', entityType: 'docket', entityId: current, before: { status: 'published' }, after: { status: 'in_session' }, riskTier: 'R2' });
  for (const v of votes.filter((x) => x.docket_item_id && items.find((i) => i.id === x.docket_item_id)?.docket_id === current)) {
    const m = boardMembers.find((b) => b.id === v.voter_id)!;
    ctx.audit({ workspace: 'halcyon', at: String(v.recorded_at), actor: { type: 'human', id: m.id, name: m.name }, action: 'board.vote', entityType: 'docket_item', entityId: v.docket_item_id, after: { vote: v.vote } });
  }
}
