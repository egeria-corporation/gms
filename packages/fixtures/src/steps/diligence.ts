// SPDX-License-Identifier: AGPL-3.0-or-later
// Due diligence: the IRS/OFAC fixtures (fictional) and a real screening of every grantee through the
// diligence.run action (system actor). Cedar Hollow Food Pantry ends up with a potential match to review.
import { FixtureDiligenceSource, importDiligence } from '@gms/adapters';
import type { SeedContext } from '../context';
import type { Awards } from './awards';

export async function importFixtures(ctx: SeedContext): Promise<{ irs: number; sanctions: number }> {
  const r = await importDiligence(ctx.db, new FixtureDiligenceSource());
  return { irs: r.irs, sanctions: r.sanctions };
}

export async function screenGrantees(ctx: SeedContext, aw: Awards): Promise<{ potentialMatches: number }> {
  let potential = 0;
  for (const a of aw.all) {
    const r = await ctx.run<{ irs: string; ofac: string; bestScore: number }>('diligence.run', { applicantOrgId: a.app.org.id, awardId: a.id, context: 'award' }, ctx.system(a.ws));
    if (r.ofac === 'potential_match') potential++;
  }
  // Backdate the checks to when each award was made, so the compliance history reads naturally.
  for (const a of aw.all) {
    const at = new Date(Date.parse(a.createdAt) + 3_600_000).toISOString();
    await ctx.db.updateTable('diligence_checks').set({ checked_at: at, created_at: at }).where('award_id', '=', a.id).execute();
    await ctx.db.updateTable('sanctions_screenings').set({ created_at: at }).where('award_id', '=', a.id).execute();
  }
  return { potentialMatches: potential };
}
