// SPDX-License-Identifier: AGPL-3.0-or-later
// E2E preconditions, created through the real action layer (as Jordan, the program officer):
// an always-open opportunity that uses the flagship LOI form and eligibility questions, independent of
// where today's date falls in the flagship's LOI window.
import { randomUUID } from 'node:crypto';

export const E2E_OPP_SLUG = 'e2e-youth-arts-loi';

export default async function globalSetup(): Promise<void> {
  process.env.GMS_AUTH_MODE ??= 'test';
  const { getRuntime } = await import('@gms/actions');
  const { YOUTH_ARTS_LOI } = await import('@gms/forms');
  const rt = getRuntime();
  const ws = await rt.db.selectFrom('workspaces').select(['id', 'slug', 'name', 'timezone']).where('slug', '=', 'halcyon').executeTakeFirst();
  if (!ws) throw new Error('Seed the database first: pnpm seed');
  const existing = await rt.db.selectFrom('opportunities').select('id').where('workspace_id', '=', ws.id).where('slug', '=', E2E_OPP_SLUG).executeTakeFirst();
  if (existing) return;
  const jordan = await rt.db.selectFrom('profiles').select(['id', 'email', 'full_name']).where('email', '=', 'jordan@halcyonridge.example').executeTakeFirstOrThrow();
  const ctx = {
    workspace: ws,
    actor: { type: 'human' as const, id: jordan.id, name: jordan.full_name ?? 'Jordan Ellis' },
    roles: ['program_officer' as const],
    scopes: '*' as const,
    claims: { role: 'authenticated' as const, sub: jordan.id, email: jordan.email, aal: 'aal2' as const },
    aal: 'aal2' as const,
    requestId: randomUUID(),
    channel: 'test' as const,
  };
  const ex = rt.executor;
  const program = await rt.db.selectFrom('programs').select('id').where('workspace_id', '=', ws.id).where('slug', 'like', 'youth-arts%').executeTakeFirst();
  const form = await ex.run<{ formId: string; versionId: string }>('forms.create', { name: 'E2E — Youth Arts LOI', kind: 'loi', model: YOUTH_ARTS_LOI }, ctx);
  await ex.run('forms.publish', { versionId: form.versionId, changeNote: 'E2E fixture' }, ctx);
  const now = Date.now();
  const opp = await ex.run<{ id: string; competitionId: string }>(
    'opportunities.create',
    {
      programId: program?.id ?? null,
      slug: E2E_OPP_SLUG,
      title: 'Youth Arts Fund — Letter of Inquiry (E2E)',
      summary: 'A letter of inquiry for arts programs serving young people ages 12–24 in Alder, Bramble and Cinder counties.',
      descriptionMd: 'Tell us about your project in a short letter of inquiry. **Invited** applicants submit a full proposal.',
      fundingTotalCents: 40_000_000,
      awardMinCents: 500_000,
      awardMaxCents: 2_500_000,
      expectedAwardCount: 20,
      opensAt: new Date(now - 2 * 86_400_000).toISOString(),
      closesAt: new Date(now + 60 * 86_400_000).toISOString(),
      causeTerms: ['Arts & culture', 'Youth development'],
      geographyTerms: ['Alder County', 'Bramble County', 'Cinder County'],
    },
    ctx,
  );
  await ex.run('competitions.attach_form', { competitionId: opp.competitionId, formId: form.formId }, ctx);
  await ex.run(
    'opportunities.set_eligibility',
    {
      opportunityId: opp.id,
      rules: [
        { question: 'Is your organization a 501(c)(3) nonprofit or fiscally sponsored?', kind: 'yes_no', config: { required: true }, knockoutMessage: 'This fund supports 501(c)(3) nonprofits and fiscally sponsored projects.' },
        { question: 'Does your program serve young people ages 12–24?', kind: 'yes_no', config: { required: true }, knockoutMessage: 'The Youth Arts Fund focuses on young people ages 12 to 24.' },
        { question: 'Which counties do you serve?', kind: 'multi_any', config: { options: ['Alder', 'Bramble', 'Cinder', 'Other'], allowed: ['Alder', 'Bramble', 'Cinder'] }, knockoutMessage: 'This fund serves Alder, Bramble and Cinder counties.' },
        { question: 'What is your annual operating budget (USD)?', kind: 'number_max', config: { max: 2_000_000, unit: 'usd' }, knockoutMessage: 'This fund supports organizations with budgets under $2 million.' },
      ],
    },
    ctx,
  );
  await ex.run('opportunities.publish', { opportunityId: opp.id }, ctx);
}
