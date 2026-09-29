// SPDX-License-Identifier: AGPL-3.0-or-later
// E2E flow 2 — Staff: Jordan (program officer) builds a form in the console builder (FB-01/FB-02) and publishes
// it → creates an opportunity (C-04), attaches the form to its first stage and schedules it to open a few minutes
// from now → publishes it (C-05), so it is Forecasted → it shows on the public site and in
// GET /common-grants/opportunities → the schedule tick (the worker's `system.tick_opportunity_schedule`) opens it
// once the open time passes → Open on the public site and in the CommonGrants feed.
import { expect, test, type Page } from '@playwright/test';
import { expectAccessible, query, signInStaff } from './helpers';

test.describe.configure({ mode: 'serial' });

const JORDAN = 'jordan@halcyonridge.example';

/** `YYYY-MM-DDTHH:mm` wall-clock time in `timeZone`, the value a datetime-local input takes. */
function wallClock(at: Date, timeZone: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

interface CgOpportunity {
  id: string;
  title: string;
  status: { value: string };
  keyDates?: unknown;
}

/** GET /common-grants/opportunities from the page (the tenant origin is a *.localhost name Node may not resolve). */
async function cgOpportunities(page: Page): Promise<{ httpStatus: number; items: CgOpportunity[] }> {
  return page.evaluate(async () => {
    const r = await fetch('/common-grants/opportunities?pageSize=100', { headers: { accept: 'application/json' } });
    const body = (await r.json()) as { items?: CgOpportunity[] };
    return { httpStatus: r.status, items: body.items ?? [] };
  });
}

test('staff build a form, schedule an opportunity with it, and it goes public and into the CommonGrants feed', async ({ page, context }) => {
  test.setTimeout(240_000);
  const run = Date.now();
  const formName = `E2E Arts Access Application ${run}`;
  const oppTitle = `E2E Arts Access Fund ${run}`;
  const [ws] = await query<{ timezone: string }>(`select timezone from public.workspaces where slug = 'halcyon'`);
  const tz = ws!.timezone;

  await signInStaff(page, JORDAN, '/console/forms');

  // ---- FB-01: create a blank form -------------------------------------------------------------------------
  await page.goto('/console/forms');
  await expect(page.getByRole('heading', { level: 1, name: 'Forms' })).toBeVisible();
  await page.getByRole('button', { name: 'New form' }).click();
  const create = page.getByRole('dialog', { name: 'Create a form' });
  await create.getByLabel('Name').fill(formName);
  await create.getByRole('button', { name: 'Create and open builder' }).click();
  await page.waitForURL(/\/console\/forms\/[0-9a-f-]{36}$/);
  const formId = page.url().split('/').at(-1)!;
  await expect(page.getByRole('heading', { level: 1, name: formName })).toBeVisible();

  // ---- FB-02: add a short-text and a dollar-amount question, label them, save, publish ----------------------
  const palette = page.getByRole('complementary', { name: 'Add to the form' });
  const settings = page.getByRole('complementary', { name: 'Settings' });
  await palette.getByRole('button', { name: /^Short text/ }).click();
  await settings.getByRole('textbox', { name: 'Question', exact: true }).fill('What is the name of your project?');
  await palette.getByRole('button', { name: /^Dollar amount/ }).click();
  await settings.getByRole('textbox', { name: 'Question', exact: true }).fill('How much are you requesting?');
  await expect(page.getByText(/1 page · 2 questions/)).toBeVisible();
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByText(/Unsaved changes/)).toBeHidden();
  await expectAccessible(page);

  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  const publishForm = page.getByRole('alertdialog', { name: 'Publish this version?' });
  await publishForm.getByLabel('What changed?').fill('First version for the E2E arts access fund.');
  await publishForm.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(page.getByText('Published version 1.').first()).toBeVisible();
  await expect(page.getByText(/Editing v1 \(published, view only\)/)).toBeVisible();
  const [formRow] = await query<{ status: string; version: number; field_count: number }>(
    `select v.status, v.version, jsonb_array_length(v.builder_model -> 'pages' -> 0 -> 'elements') as field_count
       from public.forms f join public.form_versions v on v.id = f.current_version_id where f.id = $1`,
    [formId],
  );
  expect(formRow).toEqual({ status: 'published', version: 1, field_count: 2 });

  // ---- C-04: create the opportunity (opens in ~10 minutes, closes in 5 weeks) -------------------------------
  const opensAt = new Date(Math.ceil((Date.now() + 10 * 60_000) / 60_000) * 60_000);
  const closesAt = new Date(opensAt.getTime() + 35 * 86_400_000);
  await page.goto('/console/opportunities/new');
  await expect(page.getByRole('heading', { level: 1, name: 'New opportunity' })).toBeVisible();
  await page.getByLabel('Title').fill(oppTitle);
  await page.getByLabel('Summary').fill('Grants of up to $15,000 that help small arts organizations make their programs accessible.');
  await page.getByLabel('Opens').fill(wallClock(opensAt, tz));
  await page.getByLabel('Deadline').fill(wallClock(closesAt, tz));
  await page.getByLabel('Total available').fill('150,000');
  await page.getByLabel('Smallest award').fill('5,000');
  await page.getByLabel('Largest award').fill('15,000');
  await page.getByRole('button', { name: 'Create draft' }).click();
  await page.waitForURL(/\/console\/opportunities\/[0-9a-f-]{36}\?tab=stages/);
  const oppId = new URL(page.url()).pathname.split('/').at(-1)!;

  // Attach the new (published) form to the first stage.
  await expect(page.getByRole('tab', { name: /Stages & forms/, selected: true })).toBeVisible();
  const stage1 = page.getByRole('listitem').filter({ has: page.getByRole('heading', { level: 3, name: /^Stage 1:/ }) });
  await stage1.getByRole('combobox', { name: 'Attach a form' }).click();
  await page.getByRole('option', { name: `${formName} · v1` }).click();
  await stage1.getByRole('button', { name: 'Attach form' }).click();
  await expect(stage1.getByRole('link', { name: formName })).toBeVisible();
  await expect(stage1.getByText('Pinned to v1 (published)')).toBeVisible();
  await expectAccessible(page);

  // ---- C-05: review & publish → Forecasted (opens on schedule) ---------------------------------------------
  await page.goto(`/console/opportunities/${oppId}/publish`);
  await expect(page.getByRole('heading', { level: 1, name: `Review & publish: ${oppTitle}` })).toBeVisible();
  await expect(page.getByText('First stage has a published form')).toBeVisible();
  await expect(page.getByText(/Publishing makes it Forecasted now/)).toBeVisible();
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(page.getByText('Published. It is forecasted and opens on schedule.').first()).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: `Lifecycle: ${oppTitle}` })).toBeVisible();
  const [published] = await query<{ status: string; slug: string; opens_at: string | Date; stage_status: string }>(
    `select o.status, o.slug, o.opens_at, c.status as stage_status
       from public.opportunities o join public.competitions c on c.opportunity_id = o.id and c.stage_order = 1 where o.id = $1`,
    [oppId],
  );
  expect(published).toMatchObject({ status: 'forecasted', stage_status: 'scheduled' });
  expect(new Date(published!.opens_at).getTime()).toBe(opensAt.getTime());
  const slug = published!.slug;

  // ---- Public site + CommonGrants while Forecasted ---------------------------------------------------------
  const pub = await context.newPage();
  await pub.goto(`/opportunities?q=${encodeURIComponent(oppTitle)}`);
  await expect(pub.getByRole('link', { name: oppTitle })).toBeVisible();
  await pub.goto(`/opportunities/${slug}`);
  await expect(pub.getByRole('heading', { level: 1, name: oppTitle })).toBeVisible();
  await expect(pub.getByText('This opportunity isn’t open yet')).toBeVisible();
  let cg = await cgOpportunities(pub);
  expect(cg.httpStatus).toBe(200);
  expect(cg.items.find((o) => o.id === oppId)).toMatchObject({ title: oppTitle, status: { value: 'forecasted' } });

  // ---- The schedule tick opens it once the open time has passed ------------------------------------------
  // In production the worker runs this action every minute. Here the same action runs on a runtime whose clock
  // reads just after the scheduled open time, so the test does not have to wait ten minutes.
  const { createRuntime, systemContext } = await import('@gms/actions');
  const later = createRuntime({ clock: () => new Date(opensAt.getTime() + 30_000) });
  const tick = await later.executor.run<{ opened: number; closed: number }>('system.tick_opportunity_schedule', {}, systemContext(null));
  expect(tick.opened).toBeGreaterThanOrEqual(1);
  const [opened] = await query<{ status: string; stage_status: string }>(
    `select o.status, c.status as stage_status from public.opportunities o join public.competitions c on c.opportunity_id = o.id and c.stage_order = 1 where o.id = $1`,
    [oppId],
  );
  expect(opened).toEqual({ status: 'open', stage_status: 'open' });

  // ---- Public site + CommonGrants while Open ---------------------------------------------------------------
  await pub.goto(`/opportunities?q=${encodeURIComponent(oppTitle)}`);
  await expect(pub.getByRole('link', { name: oppTitle })).toBeVisible();
  await pub.goto(`/opportunities/${slug}`);
  await expect(pub.getByRole('heading', { level: 1, name: oppTitle })).toBeVisible();
  await expect(pub.getByText('This opportunity isn’t open yet')).toBeHidden();
  await expect(pub.getByText('Open').first()).toBeVisible();
  await expectAccessible(pub);
  cg = await cgOpportunities(pub);
  expect(cg.items.find((o) => o.id === oppId)).toMatchObject({ title: oppTitle, status: { value: 'open' } });
  await pub.close();
});
