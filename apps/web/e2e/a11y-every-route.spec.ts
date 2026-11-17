// SPDX-License-Identifier: AGPL-3.0-only
// WCAG 2.2 AA, automated part: every route in src/app/App.tsx, opened as the people who use it,
// checked with axe-core at a desktop and a phone width, with the system set to light and to dark.
// Any WCAG A or AA violation fails, whatever its impact. The phone pass also fails on sideways
// scrolling. A route added to App.tsx without an entry in a11y-routes.ts fails the first test.
// The manual checks and the conformance report: docs/accessibility.md.
// Every route and every dialog runs again in Spanish (docs/i18n.md), at both widths and in both
// schemes: longer words can wrap into a different layout, and a dark-scheme colour can meet them.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { DIALOGS, ROUTES, type RouteCase } from "./a11y-routes.ts";

const require = createRequire(import.meta.url);
const AXE = require.resolve("axe-core/axe.min.js");
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"];
const COMBOS = [
  { name: "desktop, light", viewport: { width: 1440, height: 900 }, colorScheme: "light" as const },
  { name: "desktop, dark", viewport: { width: 1440, height: 900 }, colorScheme: "dark" as const },
  { name: "phone, light", viewport: { width: 390, height: 844 }, colorScheme: "light" as const },
  { name: "phone, dark", viewport: { width: 390, height: 844 }, colorScheme: "dark" as const },
];
/**
 * Fixed-size pages that do not reflow by design, demo mode only: printed documents shown at paper
 * size, email templates shown at their 640px design width, and the design reference boards.
 * docs/accessibility.md, "Known limits".
 */
const FIXED_LAYOUT = /^\/(preview|styleguide)\//;

/** Route patterns as App.tsx builds them: children of /w/:ws are relative there. */
function appRoutePatterns(): string[] {
  const src = readFileSync(fileURLToPath(new URL("../src/app/App.tsx", import.meta.url)), "utf8");
  const out = new Set<string>();
  for (const m of src.matchAll(/<Route\s+(index\b|path="([^"]+)")/g)) {
    if (m[1] === "index") out.add("/w/:ws");
    else if (m[2] === "*" || m[2]!.startsWith("/")) out.add(m[2]!);
    else out.add(`/w/:ws/${m[2]}`);
  }
  return [...out].sort();
}

/** The Spanish pass: the same routes in the same four combinations (docs/i18n.md). */
const SPANISH_COMBOS = COMBOS;

/** Opens a case in a fresh browser context, as its person, and waits for the screen's data. */
async function openCase(browser: Browser, c: RouteCase, combo: (typeof COMBOS)[number], locale: "en" | "es" = "en"): Promise<{ page: Page; problems: string[]; close: () => Promise<void> }> {
  const context = await browser.newContext({ viewport: combo.viewport, colorScheme: combo.colorScheme });
  // The language a visitor chose: the cookie the switcher sets (docs/i18n.md).
  if (locale !== "en") await context.addCookies([{ name: "gms_lang", value: locale, url: test.info().project.use.baseURL ?? "http://localhost:5179" }]);
  if (c.who === "signed-out" || c.who === "guest-reviewer") {
    // The mock keeps its session in sessionStorage; start this tab signed out.
    await context.addInitScript(() => {
      if (sessionStorage.getItem("gms.mock.session") === null) sessionStorage.setItem("gms.mock.session", "null");
    });
  }
  const page = await context.newPage();
  const problems: string[] = [];
  page.on("pageerror", (e) => problems.push(`page error: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") problems.push(`console error: ${m.text()}`);
  });
  await page.goto(c.path);
  await expect(page.locator("main, [role=main]").first()).toBeVisible();
  if (c.steps) await c.steps(page);
  await page.waitForLoadState("networkidle");
  await expect(page.locator(".loading, [aria-busy=true]")).toHaveCount(0);
  return { page, problems, close: () => context.close() };
}

/** Axe on the page, or on one part of it: every WCAG A and AA violation, as readable lines. */
async function axeViolations(page: Page, within?: string): Promise<string[]> {
  await page.addScriptTag({ path: AXE });
  return page.evaluate(
    async ({ tags, within }) => {
      const axe = (window as unknown as { axe: { run: (c: Element | Document, o: object) => Promise<{ violations: { id: string; impact: string; nodes: { html: string }[] }[] }> } }).axe;
      const result = await axe.run(within ? document.querySelector(within)! : document, { runOnly: { type: "tag", values: tags } });
      return result.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.html.slice(0, 140)).join(" | ")}`);
    },
    { tags: WCAG_TAGS, within },
  );
}

test("every route in App.tsx has an entry in the accessibility route table", () => {
  const missing = appRoutePatterns().filter((p) => !(p in ROUTES));
  const stale = Object.keys(ROUTES).filter((p) => !appRoutePatterns().includes(p));
  expect(missing, "routes with no accessibility check: add them to e2e/a11y-routes.ts").toEqual([]);
  expect(stale, "entries for routes that no longer exist").toEqual([]);
  for (const [pattern, cases] of Object.entries(ROUTES)) expect(cases.length, pattern).toBeGreaterThan(0);
});

for (const [pattern, cases] of Object.entries(ROUTES)) {
  cases.forEach((c, i) => {
    test(`axe: ${pattern} #${i + 1} (${c.who}, ${c.path})`, async ({ browser }) => {
      for (const combo of COMBOS) {
        await test.step(combo.name, async () => {
          const { page, problems, close } = await openCase(browser, c, combo);
          try {
            expect(await axeViolations(page), `${page.url()} at ${combo.name}`).toEqual([]);
            if (combo.viewport.width < 500 && !FIXED_LAYOUT.test(c.path)) {
              const sideways = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
              expect(sideways, `${page.url()} scrolls sideways at ${combo.viewport.width}px`).toBeLessThanOrEqual(0);
            }
            expect(problems, "no console or page errors").toEqual([]);
          } finally {
            await close();
          }
        });
      }
    });
  });
}

for (const [pattern, cases] of Object.entries(ROUTES)) {
  cases.forEach((c, i) => {
    test(`axe in Spanish: ${pattern} #${i + 1} (${c.who}, ${c.path})`, async ({ browser }) => {
      for (const combo of SPANISH_COMBOS) {
        await test.step(combo.name, async () => {
          const { page, problems, close } = await openCase(browser, c, combo, "es");
          try {
            expect(await page.evaluate(() => document.documentElement.lang), "the page says it is in Spanish").toBe("es");
            expect(await axeViolations(page), `${page.url()} in Spanish at ${combo.name}`).toEqual([]);
            if (combo.viewport.width < 500 && !FIXED_LAYOUT.test(c.path)) {
              const sideways = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
              expect(sideways, `${page.url()} scrolls sideways at ${combo.viewport.width}px in Spanish`).toBeLessThanOrEqual(0);
            }
            expect(problems, "no console or page errors").toEqual([]);
          } finally {
            await close();
          }
        });
      }
    });
  });
}

for (const dc of DIALOGS) {
  for (const locale of ["en", "es"] as const) {
    const names = locale === "en" ? dc : dc.es;
    test(`dialog${locale === "es" ? " in Spanish" : ""}: ${names.dialog} (${dc.path})`, async ({ browser }) => {
      const { page, problems, close } = await openCase(browser, { path: dc.path, who: dc.who }, COMBOS[0]!, locale);
      try {
        const opener = page.getByRole("button", { name: names.opener, exact: true }).first();
        await opener.focus();
        await page.keyboard.press("Enter");
        const box = page.getByRole(dc.role ?? "dialog", { name: names.dialog, exact: true });
        await expect(box).toBeVisible();
        await box.evaluate((el) => el.setAttribute("data-a11y-open", ""));
        expect(await axeViolations(page, "[data-a11y-open]"), names.dialog).toEqual([]);
        if ((dc.role ?? "dialog") === "dialog") {
          // Focus starts inside and Tab cannot leave a modal dialog.
          for (let i = 0; i < 12; i++) {
            expect(await box.evaluate((el) => el.contains(document.activeElement)), `focus inside after ${i} Tab presses`).toBe(true);
            await page.keyboard.press("Tab");
          }
        }
        await page.keyboard.press("Escape");
        await expect(box).toBeHidden();
        await expect(opener, "focus returns to the control that opened it").toBeFocused();
        expect(problems, "no console or page errors").toEqual([]);
      } finally {
        await close();
      }
    });
  }
}
