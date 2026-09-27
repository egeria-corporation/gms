// SPDX-License-Identifier: AGPL-3.0-only
// Screenshots of every screen in the catalog:
//   - branded surfaces (public, embed, portal, OAuth) for both demo foundations;
//   - the staff console in light and dark;
//   - the public site and portal at 1440px and 390px.
// Output: artifacts/screens/<surface>/<file>.png, artifacts/screens/index.html (contact sheet) and
// artifacts/screens.zip. A screen that fails to render is listed on the contact sheet rather than failing the run.
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, type Browser, type BrowserContext } from '@playwright/test';
import { DEMO_USERS, SEED_IDS } from '@gms/fixtures';
import { zipSync } from 'fflate';
import { CATALOG, SURFACE_LABELS, catalogUrl, isDynamicPath, type CatalogScreen, type CatalogSurface } from '../lib/catalog';
import { query, signIn, signInStaff } from './helpers';

const PORT = Number(process.env.E2E_PORT ?? 3000);
const OUT = fileURLToPath(new URL('../../../artifacts/screens', import.meta.url));
const TENANTS = ['halcyon', 'marigold'] as const;
type Tenant = (typeof TENANTS)[number];
interface Viewer {
  email: string;
  staff: boolean;
}

const MAYA: Viewer = { email: 'maya@eastside-youth-music.example', staff: false };
const RUTH: Viewer = { email: 'ruth@halcyonridge.example', staff: false };
// Reviewers see applicant PII, so they sign in with TOTP like staff.
const REVIEWER: Viewer = { email: DEMO_USERS.find((u) => u.role === 'reviewer')!.email, staff: true };
const STAFF: Record<Tenant, Viewer> = {
  halcyon: { email: 'helen@halcyonridge.example', staff: true },
  marigold: { email: 'rosa@marigoldstreet.example', staff: true },
};

/** Who is signed in to look at each surface. */
function viewerFor(surface: CatalogSurface, tenant: Tenant): Viewer | null {
  switch (surface) {
    case 'portal':
    case 'oauth':
      return MAYA;
    case 'console':
    case 'email':
    case 'pdf':
    case 'dev':
      return STAFF[tenant];
    case 'reviewer':
      return REVIEWER;
    case 'board':
      return RUTH;
    default:
      return null;
  }
}

/**
 * Concrete values for dynamic route segments, from the deterministic seed (halcyon). Keyed by a path prefix +
 * parameter name; the first matching entry wins.
 */
const HALCYON = `(select id from public.workspaces where slug = 'halcyon')`;
const PARAMS: [prefix: string, param: string, value: string | (() => Promise<string | undefined>)][] = [
  ['/opportunities/', 'slug', SEED_IDS.alwaysOpen.slug],
  ['/portal/apply/', 'slug', SEED_IDS.alwaysOpen.slug],
  ['/portal/org/', 'orgId', SEED_IDS.maya.orgId],
  ['/portal/applications/[id]/submitted', 'id', SEED_IDS.maya.awardApplicationId],
  ['/portal/applications/[id]/', 'id', SEED_IDS.maya.flagshipLoiApplicationId],
  ['/portal/applications/', 'id', SEED_IDS.maya.awardApplicationId],
  ['/portal/grants/', 'awardId', SEED_IDS.maya.awardId],
  ['/portal/grants/', 'reqId', SEED_IDS.maya.upcomingReportRequirementId],
  ['/portal/confirm/', 'id', async () => (await query<{ id: string }>(`select id from public.approval_requests where on_behalf_of = $1 order by created_at desc limit 1`, [SEED_IDS.maya.userId]))[0]?.id],
  ['/console/programs/', 'programId', SEED_IDS.programs.youthArts],
  ['/console/opportunities/', 'id', SEED_IDS.flagship.opportunityId],
  ['/console/forms/', 'formId', SEED_IDS.flagship.loiFormId],
  ['/console/applications/', 'id', SEED_IDS.maya.awardApplicationId],
  ['/console/grantees/', 'orgId', SEED_IDS.orgs.eastside],
  ['/console/review/rubrics/', 'rubricId', async () => (await query<{ id: string }>(`select id from public.rubrics where workspace_id = ${HALCYON} order by created_at limit 1`))[0]?.id],
  ['/console/review/', 'stageId', async () => (await query<{ id: string }>(`select id from public.review_stages where workspace_id = ${HALCYON} order by (status = 'active') desc, created_at limit 1`))[0]?.id],
  ['/console/decisions/', 'applicationId', SEED_IDS.maya.awardApplicationId],
  ['/console/dockets/', 'docketId', SEED_IDS.currentDocketId],
  ['/board/', 'docketId', SEED_IDS.currentDocketId],
  ['/console/awards/', 'awardId', SEED_IDS.maya.awardId],
  ['/console/payments/batches/', 'id', SEED_IDS.batchAwaitingApprovalId],
  ['/console/payments/', 'paymentId', async () => (await query<{ id: string }>(`select id from public.payments where workspace_id = ${HALCYON} order by created_at desc limit 1`))[0]?.id],
  ['/console/reports/', 'requirementId', SEED_IDS.maya.upcomingReportRequirementId],
  ['/console/approvals/', 'id', async () => (await query<{ id: string }>(`select id from public.approval_requests where workspace_id = ${HALCYON} and audience = 'staff' order by created_at desc limit 1`))[0]?.id],
  ['/review/', 'assignmentId', async () => (await query<{ id: string }>(`select ra.id from public.review_assignments ra join public.profiles p on p.id = ra.reviewer_id where lower(p.email) = lower($1) order by (ra.status = 'in_progress') desc, ra.created_at limit 1`, [REVIEWER.email]))[0]?.id],
  ['/operator/', 'id', async () => (await query<{ id: string }>(`select id from public.workspaces where slug = 'halcyon'`))[0]?.id],
];

const resolved = new Map<string, string | undefined>();
async function concreteUrl(url: string): Promise<string | null> {
  const [path = '', rest = ''] = url.split(/(?=[?#])/);
  let out = path;
  for (const m of path.matchAll(/\[([^\]]+)\]/g)) {
    const param = m[1]!;
    const entry = PARAMS.find(([prefix, p]) => p === param && path.startsWith(prefix));
    if (!entry) return null;
    const key = `${entry[0]}:${param}`;
    if (!resolved.has(key)) resolved.set(key, typeof entry[2] === 'string' ? entry[2] : await entry[2]());
    const value = resolved.get(key);
    if (!value) return null;
    out = out.replace(m[0], encodeURIComponent(value));
  }
  return out + rest;
}

const BRANDED: CatalogSurface[] = ['public', 'embed', 'portal', 'oauth'];
const NARROW: CatalogSurface[] = ['public', 'portal'];

interface Shot {
  screen: CatalogScreen;
  state?: string;
  tenant: Tenant | 'root';
  width: number;
  theme: 'light' | 'dark';
  file?: string;
  error?: string;
}

function variants(s: CatalogScreen): Omit<Shot, 'screen' | 'state'>[] {
  if (!s.tenantScoped) return [{ tenant: 'root', width: 1440, theme: 'light' }];
  // Example URLs for dynamic routes point at halcyon's seeded records.
  const tenants: Tenant[] = BRANDED.includes(s.surface) && !isDynamicPath(s.path) ? [...TENANTS] : ['halcyon'];
  const widths = NARROW.includes(s.surface) ? [1440, 390] : [1440];
  const themes: ('light' | 'dark')[] = s.surface === 'console' ? ['light', 'dark'] : ['light'];
  return tenants.flatMap((tenant) => widths.flatMap((width) => themes.map((theme) => ({ tenant, width, theme }))));
}

function originFor(tenant: Tenant | 'root'): string {
  return tenant === 'root' ? `http://localhost:${PORT}` : `http://${tenant}.localhost:${PORT}`;
}

const slug = (v: string) =>
  v
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

async function contextFor(browser: Browser, cache: Map<string, BrowserContext>, surface: CatalogSurface, tenant: Tenant | 'root'): Promise<BrowserContext> {
  const viewer = tenant === 'root' ? null : viewerFor(surface, tenant);
  const key = `${tenant}:${viewer?.email ?? 'anon'}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const ctx = await browser.newContext({ baseURL: originFor(tenant) });
  if (viewer) {
    const page = await ctx.newPage();
    if (viewer.staff) await signInStaff(page, viewer.email, surface === 'reviewer' ? '/review' : '/console');
    else await signIn(page, viewer.email, '/portal');
    await page.close();
  }
  cache.set(key, ctx);
  return ctx;
}

const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function contactSheet(shots: Shot[]): string {
  const groups = new Map<CatalogSurface, Shot[]>();
  for (const s of shots) groups.set(s.screen.surface, [...(groups.get(s.screen.surface) ?? []), s]);
  const failed = shots.filter((s) => s.error).length;
  const sections = [...groups.entries()]
    .map(([surface, list]) => {
      const figures = list
        .map((s) => {
          const label = `${s.screen.id} · ${s.screen.title}${s.state ? ` · ${s.state}` : ''} · ${s.tenant} · ${s.width}px${s.theme === 'dark' ? ' · dark' : ''}`;
          return s.file
            ? `<figure><a href="${esc(s.file)}"><img loading="lazy" src="${esc(s.file)}" alt="${esc(label)}"></a><figcaption>${esc(label)}</figcaption></figure>`
            : `<figure class="err"><div>Not captured: ${esc(s.error ?? 'unknown')}</div><figcaption>${esc(label)}</figcaption></figure>`;
        })
        .join('');
      return `<section><h2>${esc(SURFACE_LABELS[surface])} <small>${list.length}</small></h2><div class="grid">${figures}</div></section>`;
    })
    .join('');
  return [
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>GMS screens</title><style>',
    ':root{color-scheme:light dark;--bg:#fafaf9;--fg:#1c1917;--muted:#57534e;--card:#fff;--line:#e7e5e4;--err:#b91c1c}',
    '@media (prefers-color-scheme:dark){:root{--bg:#1c1917;--fg:#fafaf9;--muted:#d6d3d1;--card:#292524;--line:#44403c;--err:#fca5a5}}',
    'body{margin:0;padding:24px 16px;background:var(--bg);color:var(--fg);font:14px/1.5 system-ui,sans-serif}h1{margin:0 0 4px}p{color:var(--muted);margin:0 0 24px}',
    'h2{font-size:18px;margin:32px 0 12px}h2 small{color:var(--muted);font-weight:400}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:16px}',
    'figure{margin:0;background:var(--card);border:1px solid var(--line);border-radius:8px;overflow:hidden}img{display:block;width:100%;height:200px;object-fit:cover;object-position:top}',
    'figcaption{padding:8px 10px;font-size:12px;color:var(--muted)}.err div{height:200px;display:grid;place-items:center;padding:12px;text-align:center;color:var(--err)}',
    `</style></head><body><h1>GMS screens</h1><p>${shots.length} screenshots from the screen catalog${failed ? ` · ${failed} not captured` : ''} · generated ${new Date().toISOString()}</p>${sections}</body></html>`,
  ].join('\n');
}

function zipDir(dir: string, target: string): void {
  const files: Record<string, Uint8Array> = {};
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else files[`screens/${relative(dir, p).replace(/\\/g, '/')}`] = readFileSync(p);
    }
  };
  walk(dir);
  writeFileSync(target, zipSync(files, { level: 0 }));
}

test('screenshot every catalog screen', async ({ browser }) => {
  rmSync(OUT, { recursive: true, force: true }); // no stale screenshots from earlier catalogs
  mkdirSync(OUT, { recursive: true });
  const contexts = new Map<string, BrowserContext>();
  const shots: Shot[] = [];
  for (const screen of CATALOG) {
    for (const state of [undefined, ...screen.states]) {
      const example = catalogUrl(screen, state);
      const url = example ?? (await concreteUrl(isDynamicPath(screen.path) && state ? `${screen.path}?state=${encodeURIComponent(state)}` : screen.path));
      for (const v of variants(screen)) {
        const shot: Shot = { screen, state, ...v };
        shots.push(shot);
        if (!url) {
          shot.error = 'no seeded record for this dynamic route';
          continue;
        }
        const name = [slug(screen.id), state ? slug(state) : null, v.tenant, String(v.width), v.theme === 'dark' ? 'dark' : null].filter(Boolean).join('_');
        const file = `${screen.surface}/${name}.png`;
        try {
          const ctx = await contextFor(browser, contexts, screen.surface, v.tenant);
          const page = await ctx.newPage();
          await page.setViewportSize({ width: v.width, height: v.width < 768 ? 844 : 900 });
          await page.emulateMedia({ colorScheme: v.theme, reducedMotion: 'reduce' });
          // /dev/catalog prefetches hundreds of links, so it never goes network-idle; wait for load instead.
          const res = await page.goto(url, { waitUntil: screen.id === 'dev-catalog' ? 'load' : 'networkidle' });
          if (res && res.status() >= 500) throw new Error(`HTTP ${res.status()}`);
          mkdirSync(join(OUT, screen.surface), { recursive: true });
          await page.screenshot({ path: join(OUT, file), fullPage: true, animations: 'disabled' });
          shot.file = file;
          await page.close();
        } catch (err) {
          shot.error = ((err as Error).message.split('\n')[0] ?? 'error').slice(0, 200);
        }
      }
    }
  }
  for (const ctx of contexts.values()) await ctx.close();
  writeFileSync(join(OUT, 'index.html'), contactSheet(shots));
  zipDir(OUT, join(OUT, '..', 'screens.zip'));
  const failed = shots.filter((s) => s.error);
  console.log(`[shots] ${shots.length - failed.length}/${shots.length} captured → artifacts/screens/index.html`);
  for (const f of failed.slice(0, 60)) console.log(`[shots] not captured: ${f.screen.id} ${f.state ?? ''} ${f.tenant} ${f.width} — ${f.error}`);
});
