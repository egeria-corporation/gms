// SPDX-License-Identifier: AGPL-3.0-or-later
// E2E flow 4 — Payments: a grantee completes bank onboarding on the simulated Mercury → Priya (finance) builds a
// batch (P-03) and can't approve it (P-04, maker-checker) → Marcus (finance) approves with an authenticator
// step-up → "Awaiting bank approval (Mercury)" → approved in the simulated Mercury → Sent → Reconciled → the
// award's paid amount updates and the grantee gets the payment email.
//
// Re-runnable: each run creates a fresh grantee organization, application and active award (countersigned
// agreement, one installment) through the real action layer, with the installment due on a date earlier than
// any seeded installment, so the batch builder's "due on or before" picks up exactly this run's payment.
import { expect, test, type Browser, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expectAccessible, query, signInStaff, totpFor, waitForEmail } from './helpers';

test.describe.configure({ mode: 'serial' });

// Origins built in this process (the simulated bank's onboarding links, email links) must match the dev server
// that playwright.config.ts starts.
process.env.GMS_ROOT_DOMAIN = `localhost:${process.env.E2E_PORT ?? 3000}`;
process.env.GMS_MODE ??= 'multi';
process.env.GMS_AUTH_MODE ??= 'test';

const MAYA = 'maya@eastside-youth-music.example';
const PRIYA = 'priya@halcyonridge.example';
const MARCUS = 'marcus@halcyonridge.example';

interface Setup {
  awardId: string;
  reference: string;
  orgName: string;
  amountCents: number;
  dueDate: string;
  suffix: string;
}

let setup: Setup;

/**
 * Fresh grantee + active award with a countersigned agreement and one due installment, created through the action
 * layer by e2e/support/flow4-setup.ts. It runs in its own Node process (tsx) because generating the agreement
 * renders a React PDF, which Playwright's JSX transform can't do in the test process.
 */
function createPayableAward(): Setup {
  const here = dirname(fileURLToPath(import.meta.url));
  const root = join(here, '..', '..', '..');
  const tsx = join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  // The shared compiler options (react-jsx), not the Next app's (jsx: preserve).
  const args = [tsx, '--tsconfig', join(root, 'tsconfig.base.json'), join(here, 'support', 'flow4-setup.ts')];
  const out = execFileSync(process.execPath, args, { env: process.env, encoding: 'utf8', timeout: 170_000 });
  const last = out.trim().split(/\r?\n/).pop() ?? '';
  return JSON.parse(last) as Setup;
}

async function staffPage(browser: Browser, email: string, next: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signInStaff(page, email, next);
  return page;
}

/** Reloads until `check` passes (server-rendered pages that change after background work). */
async function eventually(page: Page, check: () => Promise<void>, timeoutMs = 30_000): Promise<void> {
  await expect(async () => {
    await page.reload();
    await check();
  }).toPass({ timeout: timeoutMs, intervals: [500, 1000, 2000] });
}

test.beforeAll(async () => {
  test.setTimeout(180_000);
  setup = createPayableAward();
});

test('a batch is built by one person, approved by another with step-up, paid through Mercury and reconciled', async ({ browser, page }) => {
  test.setTimeout(420_000);
  const { formatMoney } = await import('@gms/domain');
  const started = new Date(Date.now() - 1000);
  const amount = formatMoney(setup.amountCents);

  await test.step('the grantee finishes bank onboarding on the simulated Mercury', async () => {
    const [payee] = await query<{ status: string; invite_id: string }>(
      `select y.status, y.invite_id from public.payees y join public.applicant_orgs o on o.id = y.applicant_org_id where o.legal_name = $1`,
      [setup.orgName],
    );
    expect(payee?.status, 'signing the agreement invites the grantee to bank onboarding').toBe('invite_sent');
    const mail = await waitForEmail(MAYA, { subject: new RegExp(`Set up how ${setup.orgName} gets paid`) });
    const link = mail.text.match(/https?:\/\/\S+\/dev\/mercury\/invites\/[\w-]+/)?.[0];
    expect(link, 'the onboarding email links to the (simulated) Mercury onboarding page').toBeTruthy();
    expect(link).toContain(payee!.invite_id);
    // The grantee is not signed in to GMS: onboarding happens on "Mercury's" site.
    await page.goto(new URL(link!).pathname);
    await expect(page.getByRole('heading', { level: 1, name: 'Set up how you get paid' })).toBeVisible();
    await expect(page.getByText(/GMS never sees those numbers/)).toBeVisible();
    await page.getByRole('button', { name: 'Finish onboarding' }).click();
    await expect(page.getByText('Onboarding complete')).toBeVisible();
    const [after] = await query<{ status: string }>(`select y.status from public.payees y join public.applicant_orgs o on o.id = y.applicant_org_id where o.legal_name = $1`, [setup.orgName]);
    expect(after!.status).toBe('ready');
  });

  let batchId = '';
  const priya = await staffPage(browser, PRIYA, '/console/payments/batches/new');

  await test.step('Priya builds a batch (P-03) and sends it for approval', async () => {
    await expect(priya.getByRole('heading', { level: 1, name: 'Build a payment batch' })).toBeVisible();
    await expectAccessible(priya);
    await priya.getByLabel('Include installments due on or before').fill(setup.dueDate);
    await priya.getByLabel('Batch name').fill(`E2E flow 4 · ${setup.suffix}`);
    await expect(priya.getByRole('radio', { name: /ACH/ })).toBeChecked();
    await priya.getByRole('button', { name: 'Preview batch' }).click();
    await expect(priya.getByText(`Draft ready: 1 payment totaling ${amount}.`)).toBeVisible();
    const draft = priya.getByRole('region', { name: 'Payments in this draft batch' });
    const row = draft.getByRole('row').filter({ hasText: setup.reference });
    await expect(row).toContainText(setup.orgName);
    await expect(row).toContainText('Ready');
    await expect(row).toContainText(amount);
    await expectAccessible(priya);
    await priya.getByRole('button', { name: 'Send 1 payment for approval' }).click();
    await priya.waitForURL(/\/console\/payments\/batches\/[0-9a-f-]{36}$/);
    batchId = priya.url().split('/').pop()!;
  });

  await test.step('Priya created it, so she cannot approve it (P-04)', async () => {
    await expect(priya.getByRole('heading', { level: 1, name: `E2E flow 4 · ${setup.suffix}` })).toBeVisible();
    await expect(priya.getByText('Awaiting approval (GMS)').first()).toBeVisible();
    await expect(priya.getByText('You created this batch — someone else must approve it')).toBeVisible();
    await expect(priya.getByRole('button', { name: /approve/i })).toHaveCount(0);
    await expectAccessible(priya);
    // The rule holds below the UI too: the action refuses the creator, even with a fresh step-up.
    const { getRuntime } = await import('@gms/actions');
    const rt = getRuntime();
    const ws = await rt.db.selectFrom('workspaces').select(['id', 'slug', 'name', 'timezone']).where('slug', '=', 'halcyon').executeTakeFirstOrThrow();
    const me = await rt.db.selectFrom('profiles').select(['id', 'email', 'full_name']).where('email', '=', PRIYA).executeTakeFirstOrThrow();
    const refused = await rt.executor
      .run('payments.approve_batch', { batchId }, {
        workspace: ws,
        actor: { type: 'human', id: me.id, name: me.full_name ?? 'Priya' },
        roles: ['finance'],
        scopes: '*',
        claims: { role: 'authenticated', sub: me.id, email: me.email, aal: 'aal2' },
        aal: 'aal2',
        stepUpAt: new Date().toISOString(),
        requestId: randomUUID(),
        channel: 'test',
      })
      .then(() => null, (e: { code?: string }) => e.code);
    expect(refused).toBe('forbidden');
    const [b] = await query<{ status: string; created_by: string }>('select status, created_by from public.payment_batches where id = $1', [batchId]);
    expect(b).toEqual({ status: 'awaiting_approval', created_by: me.id });
    await priya.context().close();
  });

  const marcus = await staffPage(browser, MARCUS, `/console/payments/batches/${batchId}`);

  await test.step('Marcus approves with a fresh authenticator code', async () => {
    // His sign-in check was a while ago (outside the step-up window), so approving asks for a fresh code.
    await query(
      `update gms_private.test_auth_sessions set mfa_at = now() - interval '1 hour'
        where user_id = (select id from auth.users where lower(email) = $1) and revoked_at is null`,
      [MARCUS],
    );
    await marcus.reload();
    await expect(marcus.getByRole('heading', { level: 1, name: `E2E flow 4 · ${setup.suffix}` })).toBeVisible();
    await expect(marcus.getByText(`You are approving 1 payment totaling ${amount}`)).toBeVisible();
    await marcus.getByRole('button', { name: 'Approve 1 payment' }).click();
    const dialog = marcus.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/people-only/)).toBeVisible();
    await expectAccessible(marcus);
    await expect(dialog.getByRole('button', { name: /approve/i })).toBeVisible();
    // A complete 6-digit code submits by itself (one-time-code autofill).
    await dialog.getByLabel('6-digit code').fill(await totpFor(MARCUS));
    await expect(dialog).toBeHidden();
    // The decision panel moves on from "awaiting approval" once the approval is recorded.
    await expect(marcus.getByRole('button', { name: 'Approve 1 payment' })).toHaveCount(0);
    const approvals = () =>
      query<{ aal: string; email: string }>(
        `select pa.aal, u.email from public.payment_approvals pa join public.profiles u on u.id = pa.approver_id where pa.batch_id = $1 and pa.decision = 'approve'`,
        [batchId],
      );
    await expect.poll(approvals).toEqual([{ aal: 'aal2', email: MARCUS }]);
  });

  await test.step('GMS asks Mercury to send it: "Awaiting bank approval (Mercury)"', async () => {
    await eventually(marcus, async () => {
      await expect(marcus.getByText('Submitted to bank').first()).toBeVisible({ timeout: 1000 });
    });
    const inBatch = marcus.getByRole('region', { name: 'Payments in this batch' }).getByRole('row').filter({ hasText: setup.reference });
    await expect(inBatch).toContainText('Awaiting bank approval (Mercury)');
    await expect(marcus.getByText('Authenticator verified')).toBeVisible();
    await expectAccessible(marcus);

    await marcus.goto(`/console/payments/status?batch=${batchId}`);
    await expect(marcus.getByRole('heading', { level: 1, name: 'Payment status' })).toBeVisible();
    await expect(marcus.getByRole('row').filter({ hasText: setup.reference })).toContainText('Awaiting bank approval (Mercury)');
    await expectAccessible(marcus);
  });

  const [payment] = await query<{ id: string }>('select id from public.payments where batch_id = $1', [batchId]);
  expect(payment).toBeTruthy();

  await test.step('someone approves the request in (simulated) Mercury and the money settles → Sent', async () => {
    await marcus.goto('/dev/mercury');
    await expect(marcus.getByRole('heading', { level: 1, name: 'Fake Mercury' })).toBeVisible();
    const request = marcus.getByRole('region', { name: 'Fake send-money requests' }).getByRole('row').filter({ hasText: setup.reference });
    await expect(request).toContainText('pendingApproval');
    await request.getByRole('button', { name: 'Approve in Mercury' }).click();
    await expect(request).toContainText('approved');

    const tx = marcus.getByRole('region', { name: 'Fake transactions' }).getByRole('row').filter({ hasText: setup.reference });
    await eventually(marcus, async () => {
      await expect(tx.getByRole('button', { name: 'Settle' })).toBeVisible({ timeout: 1000 });
    });
    await tx.getByRole('button', { name: 'Settle' }).click();
    await expect(tx.getByRole('button', { name: 'Settle' })).toHaveCount(0);
    // GMS polls the bank request, links the transaction and marks the payment Sent.
    await expect.poll(async () => (await query<{ status: string }>('select status from public.payments where id = $1', [payment!.id]))[0]?.status).toBe('sent');

    await marcus.goto(`/console/payments/${payment!.id}`);
    await expect(marcus.getByText('Sent').first()).toBeVisible();
    await expectAccessible(marcus);
  });

  await test.step('nightly reconciliation matches the bank transaction → Reconciled', async () => {
    await marcus.goto('/dev/mercury');
    await marcus.getByRole('button', { name: 'Run nightly reconciliation now' }).click();
    await expect(marcus.getByText(/Reconciliation ran: \d+ transaction\(s\) mirrored, [1-9]\d* reconciled/)).toBeVisible();
    const [p] = await query<{ status: string; rail_transaction_id: string | null }>('select status, rail_transaction_id from public.payments where id = $1', [payment!.id]);
    expect(p!.status).toBe('reconciled');
    expect(p!.rail_transaction_id).toBeTruthy();

    await marcus.goto(`/console/payments/status?batch=${batchId}`);
    await expect(marcus.getByRole('row').filter({ hasText: setup.reference })).toContainText('Reconciled');
    await expectAccessible(marcus);
    await marcus.goto(`/console/payments/${payment!.id}`);
    await expect(marcus.getByText('Reconciled').first()).toBeVisible();
    await expectAccessible(marcus);
  });

  await test.step('the award shows the disbursed amount, and the grantee got the payment email', async () => {
    await marcus.goto(`/console/awards/${setup.awardId}`);
    await expect(marcus.getByRole('heading', { level: 1 })).toContainText(/.+/);
    const paid = marcus.locator('dt', { hasText: /^Paid$/ }).locator('xpath=following-sibling::dd[1]');
    await expect(paid).toHaveText(amount);
    const [award] = await query<{ disbursed_cents: string }>('select disbursed_cents from public.awards where id = $1', [setup.awardId]);
    expect(Number(award!.disbursed_cents)).toBe(setup.amountCents);

    const mail = await waitForEmail(MAYA, { since: started, subject: new RegExp(`^${amount.replace(/[$.]/g, '\\$&')} is on its way from `) });
    expect(mail.text).toContain(setup.reference);
    await marcus.context().close();
  });
});
