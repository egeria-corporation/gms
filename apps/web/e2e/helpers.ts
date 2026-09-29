// SPDX-License-Identifier: AGPL-3.0-or-later
// Shared E2E helpers: sign in through the real magic-link flow (reading the link from the dev outbox),
// pass TOTP with the seeded dev-only secrets, run axe, and query the database for assertions.
import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';
import { authenticator } from 'otplib';
import pg from 'pg';

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:54329/gms';

let pool: pg.Pool | null = null;
export function db(): pg.Pool {
  pool ??= new pg.Pool({ connectionString: DATABASE_URL, max: 3 });
  return pool;
}

export async function query<T extends pg.QueryResultRow = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  return (await db().query<T>(text, params)).rows;
}

/** Waits for the newest email to `to` created after `since` and returns it. */
export async function waitForEmail(to: string, opts: { since?: Date; subject?: RegExp; timeoutMs?: number } = {}) {
  const deadline = Date.now() + (opts.timeoutMs ?? 20_000);
  const since = opts.since ?? new Date(Date.now() - 5 * 60_000);
  while (Date.now() < deadline) {
    const rows = await query<{ subject: string; text: string; html: string; created_at: Date }>(
      'select subject, text, html, created_at from public.dev_outbox where lower(to_email) = lower($1) and created_at >= $2 order by created_at desc limit 5',
      [to, since],
    );
    const hit = rows.find((r) => !opts.subject || opts.subject.test(r.subject));
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`No email to ${to}${opts.subject ? ` matching ${opts.subject}` : ''} within timeout`);
}

export function firstLink(text: string, pattern: RegExp = /https?:\/\/\S+/): string {
  const m = text.match(pattern);
  if (!m) throw new Error('No link found in email');
  return m[0].replace(/[).,]+$/, '');
}

/** Real magic-link sign-in: request a link in the UI, read it from the dev outbox, open it. */
export async function signIn(page: Page, email: string, next = '/portal'): Promise<void> {
  const since = new Date(Date.now() - 1000);
  // Test housekeeping: the suite signs the same seeded people in many times; reset their sign-in rate-limit
  // windows (the limiter itself is exercised by its own test).
  await query(`delete from public.rate_limit_buckets where key = $1 or key like 'signin:ip:%'`, [`signin:email:${email.toLowerCase()}`]);
  await page.goto(`/portal/sign-in?next=${encodeURIComponent(next)}`);
  if (!page.url().includes('/portal/sign-in')) return; // already signed in
  await page.getByLabel('Email address').fill(email);
  await page.getByRole('button', { name: /email me a sign-in link/i }).click();
  await expect(page.getByText('Check your email')).toBeVisible();
  const mail = await waitForEmail(email, { since, subject: /sign-in link/i });
  const link = firstLink(mail.text, /https?:\/\/\S+\/auth\/callback\S+/);
  await page.goto(link);
}

/** TOTP for seeded staff (dev-only secrets exported by @gms/fixtures). */
export async function totpFor(email: string): Promise<string> {
  const { DEMO_TOTP_SECRETS } = (await import('@gms/fixtures')) as { DEMO_TOTP_SECRETS: Record<string, string> };
  const secret = DEMO_TOTP_SECRETS[email.toLowerCase()];
  if (!secret) throw new Error(`No demo TOTP secret for ${email}`);
  return authenticator.generate(secret);
}

/** Signs a staff member in and completes the console's two-step check. */
export async function signInStaff(page: Page, email: string, next = '/console'): Promise<void> {
  await signIn(page, email, next);
  if (page.url().includes('/console/mfa')) {
    await page.getByLabel('6-digit code').fill(await totpFor(email));
    await page.getByRole('button', { name: /continue|finish setup/i }).click();
    await page.waitForURL((u) => !u.pathname.startsWith('/console/mfa'));
  }
}

export async function signOut(page: Page): Promise<void> {
  await page.context().clearCookies();
}

/** Zero serious or critical axe violations (WCAG 2.2 AA rules). */
export async function expectAccessible(page: Page, opts: { exclude?: string[] } = {}): Promise<void> {
  let builder = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']);
  for (const sel of opts.exclude ?? []) builder = builder.exclude(sel);
  const results = await builder.analyze();
  const bad = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(bad.map((v) => `${v.id}: ${v.help} (${v.nodes.length}) → ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);
}
