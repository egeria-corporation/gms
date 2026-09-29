// SPDX-License-Identifier: AGPL-3.0-or-later
// E2E flow 1 — Applicant: eligibility → sign in → org setup (EIN prefill) → LOI with autosave and budget
// validation → submit → receipt email in the dev outbox → status Submitted.
import { expect, test } from '@playwright/test';
import { expectAccessible, query, signIn, waitForEmail } from './helpers';

test.describe.configure({ mode: 'serial' });

test('an applicant checks eligibility, sets up their org and submits a letter of inquiry', async ({ page }) => {
  // An open opportunity with the LOI form and eligibility questions (seeded or created by the dev setup).
  const [opp] = await query<{ slug: string; title: string }>(`select slug, title from public.opportunities where slug = 'e2e-youth-arts-loi'`);
  expect(opp, 'created by e2e/global-setup.ts').toBeTruthy();

  // 1. Eligibility pre-check (no account).
  await page.goto(`/opportunities/${opp!.slug}`);
  await expect(page.getByRole('heading', { level: 1, name: opp!.title })).toBeVisible();
  await expectAccessible(page);
  await page.getByRole('link', { name: /check if you’re eligible/i }).click();
  await expect(page.getByRole('heading', { level: 1, name: /can we apply/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /check my eligibility/i })).toBeEnabled();
  for (const radio of await page.getByRole('radio', { name: 'Yes' }).all()) await radio.check();
  for (const box of await page.getByRole('textbox').all()) await box.fill('480000');
  for (const cb of await page.getByRole('checkbox', { name: /alder/i }).all()) await cb.check();
  await page.getByRole('button', { name: /check my eligibility/i }).click();
  await expect(page.getByText(/you look eligible/i)).toBeVisible();
  await expectAccessible(page);

  // 2. Sign in with a brand-new account (magic link from the dev outbox).
  const email = `e2e-applicant-${Date.now()}@e2e.example`;
  await signIn(page, email, `/portal/apply/${opp!.slug}`);

  // 3. Org setup with EIN lookup → IRS prefill.
  await expect(page).toHaveURL(/\/portal\/org\/new/);
  // A fictional IRS exempt-org record for this run (what the IRS BMF importer would load).
  const suffix = String(Date.now() % 10_000_000).padStart(7, '0');
  const irs = { ein: `09-${suffix}`, name: `LARKSPUR YOUTH CHORUS ${suffix.slice(-3)}` };
  await query(`insert into public.irs_exempt_orgs (ein, name, city, state, subsection, status, pub78, source) values ($1, $2, 'LARKSPUR', 'CA', '03', 'active', true, 'fixture') on conflict do nothing`, [irs.ein, irs.name]);
  expect(irs, 'an unused IRS fixture EIN').toBeTruthy();
  await page.getByLabel('Employer Identification Number (EIN)').fill(irs!.ein);
  await page.getByRole('button', { name: /look up/i }).click();
  await expect(page.getByText('We found your organization')).toBeVisible();
  await expect(page.getByLabel('Legal name')).not.toHaveValue('');
  await page.getByLabel('Annual operating budget (USD)').fill('480,000');
  await page.getByLabel('Street address').fill('12 Larkspur Lane');
  await page.getByLabel('City').fill('Larkspur');
  await page.getByLabel('ZIP code').fill('94939');
  await page.getByRole('button', { name: /save and continue/i }).click();

  // 4. Start the application → LOI workspace with prefilled org fields.
  await expect(page.getByRole('button', { name: /start my application/i })).toBeVisible();
  await page.getByRole('button', { name: /start my application/i }).click();
  await expect(page).toHaveURL(/\/portal\/applications\/[0-9a-f-]+\/form/);
  const appId = page.url().match(/applications\/([0-9a-f-]+)\//)![1]!;
  await expect(page.getByLabel(/Employer Identification Number/i)).toHaveValue(irs!.ein);

  // Page 1 — about your organization.
  await page.getByRole('group', { name: /fiscally sponsored/i }).getByRole('radio', { name: 'No' }).check();
  await page.getByLabel(/annual operating budget/i).fill('480000');
  await page.getByRole('group', { name: /which counties/i }).getByRole('checkbox', { name: /alder/i }).check();
  await page.getByRole('button', { name: /^next/i }).click();

  // Page 2 — project.
  await page.getByLabel('Project title').fill('Songs from the Block: youth recording studio');
  await page.getByLabel('Summarize your project').fill('A free after-school recording studio where teens write, record and perform original music with local mentors, then share it at a spring showcase.');
  await page.getByRole('group', { name: /age groups/i }).getByRole('checkbox', { name: /15/ }).check();
  await page.getByLabel(/how many young people/i).fill('45');
  await page.getByLabel(/what activities/i).fill('Weekly songwriting circles, studio sessions with engineers, and a public showcase.');
  await page.getByRole('button', { name: /^next/i }).click();

  // Page 3 — budget: lines that don't match the request show a fix-it hint; then match.
  await page.getByLabel(/how much are you requesting/i).fill('20000');
  await page.getByRole('button', { name: /add a/i }).click();
  await page.getByLabel(/, row 1/).first().fill('Mentor stipends');
  await page.getByRole('combobox', { name: /category, row 1/i }).click();
  await page.getByRole('option', { name: /stipends/i }).click();
  const amount1 = page.getByLabel(/amount, row 1/i);
  await amount1.fill('15000');
  await amount1.blur();
  await page.getByRole('button', { name: /add a/i }).click();
  await page.getByLabel(/, row 2/).first().fill('Studio time');
  await page.getByRole('combobox', { name: /category, row 2/i }).click();
  await page.getByRole('option', { name: /space/i }).click();
  await page.getByLabel(/amount, row 2/i).fill('4000');
  await page.getByLabel(/amount, row 2/i).blur();
  await expect(page.getByText(/add up to/i).first()).toBeVisible();
  await page.getByLabel(/amount, row 2/i).fill('5000');
  await page.getByLabel(/amount, row 2/i).blur();
  await page.getByRole('button', { name: /^next/i }).click();

  // Page 4 — attachments & attestation.
  const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
  await page.locator('input[type=file]').first().setInputFiles({ name: 'budget.pdf', mimeType: 'application/pdf', buffer: pdf });
  await expect(page.getByText('budget.pdf').first()).toBeVisible();
  await page.getByLabel(/did you use ai tools/i).fill('No AI tools were used.');
  const attest = page.getByRole('group', { name: /confirm and sign/i });
  await attest.getByRole('checkbox').check();
  await attest.getByRole('textbox').fill('E2E Applicant');
  await expect(page.getByText(/saved/i).first()).toBeVisible({ timeout: 15_000 });

  // Autosave persisted the answers.
  const [resp] = await query<{ data: Record<string, unknown> }>('select data from public.form_responses where application_id = $1', [appId]);
  expect(resp!.data.project_title).toBe('Songs from the Block: youth recording studio');

  // 5. Review and submit.
  await page.getByRole('button', { name: /review and submit/i }).click();
  await expect(page).toHaveURL(/\/review$/);
  await expectAccessible(page);
  await page.getByLabel('Type your full name to sign').fill('E2E Applicant');
  await page.getByRole('checkbox', { name: /true and complete/i }).check();
  const submittedAt = new Date(Date.now() - 1000);
  await page.getByRole('button', { name: /submit application/i }).click();
  await expect(page).toHaveURL(/\/submitted$/);
  const receipt = await page.getByTestId('receipt-number').textContent();
  expect(receipt).toMatch(/-R1$/);

  // 6. Receipt email.
  const mail = await waitForEmail(email, { since: submittedAt, subject: /receiv|receipt|submitted/i });
  expect(mail.text).toContain(receipt!.trim());

  // 7. Status Submitted.
  await page.goto(`/portal/applications/${appId}`);
  await expect(page.getByText('Submitted').first()).toBeVisible();
  const [row] = await query<{ status: string }>('select status from public.applications where id = $1', [appId]);
  expect(row!.status).toBe('submitted');
});
