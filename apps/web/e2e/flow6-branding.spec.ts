// SPDX-License-Identifier: AGPL-3.0-or-later
// E2E flow 6 — Branding: the owner changes colors in S-01 → a color that fails contrast is auto-corrected with a
// warning → the public site updates to the corrected color. Restores the original colors afterwards.
import { expect, test, type Page } from '@playwright/test';
import { expectAccessible, signInStaff } from './helpers';

test.describe.configure({ mode: 'serial' });

const HELEN = 'helen@halcyonridge.example';
const FAILING_PRIMARY = '#F5D90A'; // bright yellow: about 1.4:1 on white
const ACCENT = '#7C3AED';

async function setColors(page: Page, primary: string, accent: string): Promise<void> {
  await page.getByLabel('Primary color', { exact: true }).fill(primary);
  await page.getByLabel('Accent color', { exact: true }).fill(accent);
}

async function primaryToken(page: Page): Promise<string> {
  return (await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--primary'))).trim().toUpperCase();
}

test('the owner rebrands; a failing color is corrected with a warning and the public site updates', async ({ page, context }) => {
  await signInStaff(page, HELEN, '/console/settings/branding');
  await page.goto('/console/settings/branding');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  const original = {
    primary: await page.getByLabel('Primary color', { exact: true }).inputValue(),
    accent: await page.getByLabel('Accent color', { exact: true }).inputValue(),
  };

  try {
    await setColors(page, FAILING_PRIMARY, ACCENT);
    // Live contrast check before saving.
    const warning = page.getByTestId('contrast-autofix');
    await expect(warning).toBeVisible();
    await expect(warning).toContainText(FAILING_PRIMARY);
    const hexes = (await warning.innerText()).match(/#[0-9A-F]{6}/gi) ?? [];
    const adjusted = hexes.find((h) => h.toUpperCase() !== FAILING_PRIMARY)?.toUpperCase();
    expect(adjusted, 'the corrected color is shown').toBeTruthy();
    await expectAccessible(page);

    await page.getByRole('button', { name: 'Save branding' }).click();
    await expect(page.getByText(/we adjusted some colors for readability/i)).toBeVisible();
    await expect(page.getByText('All changes saved')).toBeVisible();

    // The public site uses the corrected color, never the failing one.
    const pub = await context.newPage();
    await expect(async () => {
      await pub.goto('/');
      expect(await primaryToken(pub)).toBe(adjusted);
    }).toPass({ timeout: 30_000 });
    expect(await primaryToken(pub)).not.toBe(FAILING_PRIMARY);
    await expectAccessible(pub);
    await pub.close();
  } finally {
    await page.goto('/console/settings/branding');
    await setColors(page, original.primary, original.accent);
    const save = page.getByRole('button', { name: 'Save branding' });
    if (await save.isEnabled()) {
      await save.click();
      await expect(page.getByText('All changes saved')).toBeVisible();
    }
  }
});
