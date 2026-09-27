// SPDX-License-Identifier: AGPL-3.0-only
// E2E flow 3 — Review: a reviewer passes the conflict-of-interest gate (D-02) and scores an application against
// the rubric (D-03) → Jordan records the final decision (R-05) → builds the award with two installments and
// activates it (R-06) → generates and sends the agreement (R-07) → the applicant's org admin signs it in the
// portal (B-10). Preconditions (an opportunity with a rubric-scored review stage, and a fresh submitted
// application assigned to the reviewer) are created through the real action layer, so the flow can be re-run.
import type { ActionContext } from '@gms/actions';
import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { expectAccessible, query, signIn, signInStaff, signOut } from './helpers';

test.describe.configure({ mode: 'serial' });

const OPP_SLUG = 'e2e-flow3-review';
const JORDAN = 'jordan@halcyonridge.example';
const MAYA = 'maya@eastside-youth-music.example';
const REVIEWER = 'harriet.osei@reviewers.example';
const AWARD_CENTS = 1_200_000; // $12,000 → two installments of $6,000

interface Fixture {
  applicationId: string;
  reference: string;
  title: string;
  orgName: string;
  assignmentId: string;
}

async function runtime() {
  const { getRuntime } = await import('@gms/actions');
  return getRuntime();
}

/** A person's ActionContext, exactly as the UI builds it for a signed-in (TOTP-verified) session. */
async function personCtx(email: string, roles: ActionContext['roles']): Promise<ActionContext> {
  const rt = await runtime();
  const ws = await rt.db.selectFrom('workspaces').select(['id', 'slug', 'name', 'timezone']).where('slug', '=', 'halcyon').executeTakeFirstOrThrow();
  const p = await rt.db.selectFrom('profiles').select(['id', 'email', 'full_name']).where('email', '=', email).executeTakeFirstOrThrow();
  return {
    workspace: ws,
    actor: { type: 'human' as const, id: p.id, name: p.full_name ?? email },
    roles,
    scopes: '*',
    claims: { role: 'authenticated', sub: p.id, email: p.email, aal: 'aal2' },
    aal: 'aal2',
    requestId: randomUUID(),
    channel: 'test',
  };
}

/** The review opportunity (simple form + two-criterion rubric + an active stage); created once per database. */
async function ensureReviewOpportunity(): Promise<{ competitionId: string; formId: string; stageId: string }> {
  const rt = await runtime();
  const ex = rt.executor;
  const jordan = await personCtx(JORDAN, ['program_officer']);
  const wsId = jordan.workspace!.id;
  const existing = await rt.db
    .selectFrom('opportunities as o')
    .innerJoin('competitions as c', 'c.opportunity_id', 'o.id')
    .innerJoin('competition_forms as cf', 'cf.competition_id', 'c.id')
    .innerJoin('review_stages as rs', 'rs.competition_id', 'c.id')
    .select(['c.id as competitionId', 'cf.form_id as formId', 'rs.id as stageId'])
    .where('o.workspace_id', '=', wsId)
    .where('o.slug', '=', OPP_SLUG)
    .executeTakeFirst();
  if (existing) return existing;

  const { defineForm, instantiateQuestion } = await import('@gms/forms');
  const model = defineForm({
    version: 1,
    title: 'Community Arts Grant — Application (E2E)',
    pages: [
      {
        id: 'project',
        title: 'Your project',
        elements: [instantiateQuestion('project_title'), instantiateQuestion('project_summary'), instantiateQuestion('request_amount')],
      },
    ],
  });
  const form = await ex.run<{ formId: string; versionId: string }>('forms.create', { name: 'E2E — Community Arts Grant', kind: 'application', model }, jordan);
  await ex.run('forms.publish', { versionId: form.versionId, changeNote: 'E2E fixture (flow 3)' }, jordan);
  const program = await rt.db.selectFrom('programs').select('id').where('workspace_id', '=', wsId).where('slug', 'like', 'youth-arts%').executeTakeFirst();
  const now = Date.now();
  const opp = await ex.run<{ id: string; competitionId: string }>(
    'opportunities.create',
    {
      programId: program?.id ?? null,
      slug: OPP_SLUG,
      title: 'Community Arts Grant (E2E review)',
      summary: 'Project grants for community arts organizations in Alder, Bramble and Cinder counties.',
      descriptionMd: 'Tell us about your project. A panel of community reviewers scores every application.',
      fundingTotalCents: 50_000_000,
      awardMinCents: 500_000,
      awardMaxCents: 2_500_000,
      expectedAwardCount: 20,
      opensAt: new Date(now - 2 * 86_400_000).toISOString(),
      closesAt: new Date(now + 365 * 86_400_000).toISOString(),
      causeTerms: ['Arts & culture'],
      geographyTerms: ['Alder County'],
    },
    jordan,
  );
  await ex.run('competitions.attach_form', { competitionId: opp.competitionId, formId: form.formId }, jordan);
  await ex.run('opportunities.publish', { opportunityId: opp.id }, jordan);
  const rubric = await ex.run<{ id: string }>(
    'review.save_rubric',
    {
      name: 'E2E community arts rubric',
      criteria: [
        { label: 'Community impact', guidance: 'Who benefits, and how much?', weightPct: 60, scaleMin: 1, scaleMax: 5, scaleLabels: { '1': 'Weak', '5': 'Excellent' } },
        { label: 'Feasibility', guidance: 'Can the team deliver this plan with this budget?', weightPct: 40, scaleMin: 1, scaleMax: 5, scaleLabels: { '1': 'Weak', '5': 'Excellent' } },
      ],
    },
    jordan,
  );
  const stage = await ex.run<{ id: string }>(
    'review.save_stage',
    { competitionId: opp.competitionId, name: 'Community panel review', rubricId: rubric.id, blind: false, reviewersPerApplication: 1, status: 'active' },
    jordan,
  );
  return { competitionId: opp.competitionId, formId: form.formId, stageId: stage.id };
}

/** A fresh organization (Maya is its admin) submits an application, and Jordan assigns it to the reviewer. */
async function freshAssignedApplication(): Promise<Fixture> {
  const rt = await runtime();
  const ex = rt.executor;
  const { competitionId, formId, stageId } = await ensureReviewOpportunity();
  const maya = await personCtx(MAYA, []);
  const jordan = await personCtx(JORDAN, ['program_officer']);
  const run = `${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`.toUpperCase();
  const orgName = `Riverside Clay Studio ${run}`;
  const title = `Clay Together ${run}: intergenerational pottery nights`;
  const org = await ex.run<{ id: string }>('orgs.create', { legalName: orgName, orgType: 'nonprofit_501c3', annualBudgetCents: 31_000_000, counties: ['Alder'] }, maya);
  const started = await ex.run<{ applicationId: string; referenceNumber: string }>('applications.start', { competitionId, applicantOrgId: org.id }, maya);
  await ex.run(
    'applications.save_answers',
    {
      applicationId: started.applicationId,
      formId,
      answers: {
        project_title: title,
        project_summary: 'Weekly pottery nights where teens and elders from the same neighborhood learn wheel-throwing together and fire a shared community tile wall.',
        request_amount: 1_500_000,
      },
    },
    maya,
  );
  await ex.run('applications.submit', { applicationId: started.applicationId, attestation: { typedName: 'Maya Chen', agreed: true }, aiDisclosure: 'No AI tools were used.' }, maya);
  const reviewer = await rt.db.selectFrom('profiles').select('id').where('email', '=', REVIEWER).executeTakeFirstOrThrow();
  await ex.run('review.assign', { stageId, assignments: [{ applicationId: started.applicationId, reviewerId: reviewer.id }] }, jordan);
  const [assignment] = await query<{ id: string; status: string }>('select id, status from public.review_assignments where stage_id = $1 and application_id = $2 and reviewer_id = $3', [
    stageId,
    started.applicationId,
    reviewer.id,
  ]);
  expect(assignment!.status).toBe('not_started');
  return { applicationId: started.applicationId, reference: started.referenceNumber, title, orgName, assignmentId: assignment!.id };
}

async function clickConfirm(page: Page, name: RegExp) {
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name }).click();
}

let fx: Fixture;

test.beforeAll(async () => {
  fx = await freshAssignedApplication();
});

test('a reviewer declares no conflict and submits rubric scores', async ({ page }) => {
  await signInStaff(page, REVIEWER, '/review');
  await page.goto('/review');
  await expect(page.getByRole('heading', { level: 1, name: 'Your review assignments' })).toBeVisible();

  // D-01 → D-02: the conflict gate comes first.
  await page.getByRole('link', { name: `Declare conflicts: ${fx.title}` }).click();
  await expect(page).toHaveURL(new RegExp(`/review/${fx.assignmentId}/coi$`));
  await expect(page.getByRole('heading', { level: 1, name: /any conflicts of interest/i })).toBeVisible();
  await expect(page.getByText(fx.orgName)).toBeVisible();
  // Opening the review directly before declaring redirects back to the gate.
  await page.goto(`/review/${fx.assignmentId}`);
  await expect(page).toHaveURL(new RegExp(`/review/${fx.assignmentId}/coi$`));
  await expectAccessible(page);
  await page.getByRole('radio', { name: /I have no conflict/i }).click();
  await page.getByRole('button', { name: /confirm and open the application/i }).click();

  // D-03: the application and the rubric.
  await expect(page).toHaveURL(new RegExp(`/review/${fx.assignmentId}$`));
  await expect(page.getByRole('heading', { level: 1, name: fx.title })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Score this application' })).toBeVisible();
  await expectAccessible(page);

  // Submitting with a criterion missing is refused with a field error.
  await page.getByRole('radiogroup', { name: /Community impact score/i }).getByRole('radio', { name: /^5/ }).click();
  await page.getByRole('button', { name: 'Submit review' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Submit review' }).click();
  await expect(page.getByRole('alert').filter({ hasText: /score every criterion/i })).toBeVisible();

  await page.getByRole('radiogroup', { name: /Feasibility score/i }).getByRole('radio', { name: /^4/ }).click();
  await expect(page.getByText('2 of 2 criteria scored')).toBeVisible();
  await page.getByRole('radio', { name: 'Fund' }).click();
  await page.getByLabel('Overall comment').fill('Strong community reach and a realistic plan. The elders-and-teens format is distinctive.');
  await page.getByRole('button', { name: 'Submit review' }).click();
  await clickConfirm(page, /^submit review$/i);
  await expect(page.getByText('You submitted this review')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your scores' })).toBeVisible();

  // Weighted score: 60 × (5−1)/4 + 40 × (4−1)/4 = 90.
  const [review] = await query<{ status: string; weighted_score: string; recommendation: string; assignment_status: string }>(
    `select r.status, r.weighted_score, r.recommendation, ra.status as assignment_status
       from public.reviews r join public.review_assignments ra on ra.id = r.assignment_id where ra.id = $1`,
    [fx.assignmentId],
  );
  expect(review).toMatchObject({ status: 'submitted', recommendation: 'fund', assignment_status: 'submitted' });
  expect(Number(review!.weighted_score)).toBe(90);
  const [coi] = await query<{ has_conflict: boolean }>('select has_conflict from public.coi_declarations where assignment_id = $1', [fx.assignmentId]);
  expect(coi!.has_conflict).toBe(false);
});

test('staff approve the application, build a two-installment award, activate it and send the agreement', async ({ page }) => {
  await signInStaff(page, JORDAN, '/console/decisions');

  // R-05: the final decision (R3, people only).
  await page.goto(`/console/decisions?q=${encodeURIComponent(fx.reference)}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Decisions' })).toBeVisible();
  await expect(page.getByRole('button', { name: `Record the final decision for ${fx.reference}` })).toBeVisible();
  await expectAccessible(page);
  await page.getByRole('button', { name: `Record the final decision for ${fx.reference}` }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Record the final decision' })).toBeVisible();
  await dialog.getByRole('radio', { name: /^Approve/ }).click();
  await dialog.getByLabel('Award amount (USD)').fill('12,000');
  await dialog.getByLabel('Reason').fill('Top-scored by the community panel.');
  await dialog.getByRole('button', { name: 'Review decision' }).click();
  await expect(dialog.getByRole('heading', { name: 'Confirm the final decision' })).toBeVisible();
  await expect(dialog.getByText(/Final decision: Approve \$12,000/)).toBeVisible();
  await dialog.getByRole('button', { name: /record final decision/i }).click();
  await expect(dialog.getByRole('heading', { name: 'Final decision recorded' })).toBeVisible();
  await dialog.getByRole('link', { name: /open the award builder/i }).click();

  // R-06: exactly two installments that add up to the award.
  await expect(page).toHaveURL(new RegExp(`/console/decisions/${fx.applicationId}/award$`));
  await expect(page.getByRole('heading', { level: 1, name: `Award: ${fx.title}` })).toBeVisible();
  const amount = page.getByLabel('Award amount (USD)');
  await expect(amount).toHaveValue('12000.00');
  // Checked before editing, at the top of the page (scrolled, the sticky console header covers the terms).
  await expectAccessible(page);
  const installments = page.getByRole('list', { name: 'Installments' }).getByRole('listitem');
  while ((await installments.count()) < 2) await page.getByRole('button', { name: 'Add installment' }).click();
  while ((await installments.count()) > 2) await page.getByRole('button', { name: `Remove installment ${await installments.count()}` }).click();
  await expect(installments).toHaveCount(2);
  const start = await page.getByLabel('Start date').inputValue();
  const [y, m] = start.split('-').map(Number);
  const second = new Date(Date.UTC(y!, m! - 1 + 6, 1)).toISOString().slice(0, 10);
  await page.getByLabel('Installment 1 due date').fill(start);
  await page.getByLabel('Installment 1 amount').fill('5,000');
  await page.getByLabel('Installment 1 condition').fill('On signed agreement');
  await page.getByLabel('Installment 2 due date').fill(second);
  await page.getByLabel('Installment 2 amount').fill('5,000');
  await page.getByLabel('Installment 2 condition').fill('After the interim report is accepted');
  await expect(page.getByText(/Schedule total \$10,000\.00 of \$12,000\.00 — \$2,000\.00 still to schedule/)).toBeVisible();
  await expect(page.getByRole('button', { name: /save draft award/i })).toBeDisabled();
  await page.getByRole('button', { name: 'Split evenly' }).click();
  await expect(page.getByLabel('Installment 1 amount')).toHaveValue('6000.00');
  await expect(page.getByLabel('Installment 2 amount')).toHaveValue('6000.00');
  await expect(page.getByText(/Schedule total \$12,000\.00 of \$12,000\.00 — matches the award amount/)).toBeVisible();
  await page.getByLabel('Purpose').fill('Intergenerational pottery nights and a shared community tile wall.');
  await page.getByRole('button', { name: /save draft award/i }).click();
  await expect(page.getByText('Award draft saved.')).toBeVisible();
  await expect(page.getByText('You have unsaved changes')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Activate award' })).toBeEnabled();

  const [award] = await query<{ id: string; status: string; amount_cents: string }>(`select id, status, amount_cents from public.awards where application_id = $1 and kind = 'original'`, [fx.applicationId]);
  expect(award!.status).toBe('draft');
  expect(Number(award!.amount_cents)).toBe(AWARD_CENTS);
  const saved = await query<{ amount_cents: string; due_date: string }>('select amount_cents, due_date::text from public.installments where award_id = $1 order by position', [award!.id]);
  expect(saved.map((i) => Number(i.amount_cents))).toEqual([600_000, 600_000]);
  expect(saved.map((i) => i.due_date)).toEqual([start, second]);

  await page.getByRole('button', { name: 'Activate award' }).click();
  await clickConfirm(page, /^activate award$/i);

  // R-07: generate, preview and send the agreement.
  await expect(page).toHaveURL(new RegExp(`/console/decisions/${fx.applicationId}/agreement$`));
  await expect(page.getByRole('heading', { level: 1, name: 'Award letter & agreement' })).toBeVisible();
  const [active] = await query<{ status: string }>('select status from public.awards where id = $1', [award!.id]);
  expect(active!.status).toBe('active');
  await page.getByRole('button', { name: 'Generate letter & agreement' }).click();
  await expect(page.getByText('SHA-256 of the PDF (signatures bind to this hash)')).toBeVisible();
  await expect(page.getByTitle(/Grant agreement PDF for award/)).toBeVisible();
  // The exact PDF the grantee will sign (fetched in the page: Node can't resolve *.localhost tenant hosts).
  const pdf = await page.evaluate(async (url) => {
    const r = await fetch(url);
    const head = new Uint8Array(await r.arrayBuffer()).subarray(0, 5);
    return { status: r.status, type: r.headers.get('content-type'), magic: String.fromCharCode(...head) };
  }, `/console/decisions/${fx.applicationId}/agreement/pdf`);
  expect(pdf).toMatchObject({ status: 200, magic: '%PDF-' });
  expect(pdf.type).toContain('application/pdf');
  await page.getByRole('button', { name: 'Send for signature' }).click();
  await expect(page.getByRole('alertdialog').getByText(MAYA)).toBeVisible();
  await clickConfirm(page, /^send agreement$/i);
  await expect(page.getByText('Waiting for the grantee to sign.')).toBeVisible();
  const [agreement] = await query<{ status: string }>(`select status from public.agreements where award_id = $1 and status <> 'void'`, [award!.id]);
  expect(agreement!.status).toBe('sent');
});

test('the applicant’s org admin signs the agreement in the portal', async ({ page }) => {
  const [award] = await query<{ id: string; reference: string }>(`select id, reference from public.awards where application_id = $1 and kind = 'original'`, [fx.applicationId]);
  expect(award, 'created by the previous step').toBeTruthy();
  await signOut(page);
  await signIn(page, MAYA, `/portal/grants/${award!.id}`);

  // The grant hub (B-09) points to the agreement.
  await page.goto(`/portal/grants/${award!.id}`);
  await expect(page.getByText('Next step: review and sign your grant agreement')).toBeVisible();
  await page.getByRole('link', { name: 'Review and sign' }).click();

  // B-10: typed-name click-to-sign.
  await expect(page).toHaveURL(new RegExp(`/portal/grants/${award!.id}/agreement$`));
  await expect(page.getByRole('heading', { level: 1, name: 'Your grant agreement' })).toBeVisible();
  await expectAccessible(page);
  await page.getByRole('button', { name: 'Sign agreement' }).click();
  await expect(page.getByText('Type your full name to sign.').first()).toBeVisible();
  await page.getByLabel('Type your full name to sign').fill('Maya Chen');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Sign agreement' }).click();
  await expect(page.getByText('Signed — thank you')).toBeVisible();

  const [agreement] = await query<{ id: string; status: string; document_hash: string }>(`select id, status, document_hash from public.agreements where award_id = $1 and status <> 'void'`, [award!.id]);
  expect(agreement!.status).toBe('signed');
  const [sig] = await query<{ signer_role: string; typed_name: string; document_hash: string }>('select signer_role, typed_name, document_hash from public.signatures where agreement_id = $1', [agreement!.id]);
  expect(sig).toMatchObject({ signer_role: 'grantee', typed_name: 'Maya Chen', document_hash: agreement!.document_hash });

  // The signing page and the grant hub reflect it.
  await page.reload();
  await expect(page.getByText('You signed this agreement')).toBeVisible();
  await expect(page.getByText(/Signed for your organization/)).toBeVisible();
  await page.goto(`/portal/grants/${award!.id}`);
  await expect(page.getByText('Next step: review and sign your grant agreement')).toHaveCount(0);
  await expect(page.getByText('signed', { exact: true })).toBeVisible();
});
