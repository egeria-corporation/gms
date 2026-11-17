// SPDX-License-Identifier: AGPL-3.0-only
// Flow 36 — Live co-editing with presence (F1, docs/co-editing.md). Two people of one team, each in
// a browser context of their own (two sessions, nothing shared), write the same application:
//   - each sees the other in the draft, and the section and question they are in;
//   - while Jamal types in a question, Maria sees it read-only, "Being edited by Jamal Reed", and
//     it opens again when he leaves it;
//   - Maria's saved answer reaches Jamal within seconds, while what he is typing stays as it is;
//   - the presence pieces pass axe in Chromium (contrast included);
// then the same in an outside application's questions. In mock mode the draft's channel is the
// page's hub, relayed between the two contexts; each page keeps its own mock data, so a relayed save
// carries the saved answer for the other page's store (the real channel never carries answers).
import { expect, test } from "./helpers.ts";
import { createRequire } from "node:module";
import { pairContexts } from "./presence.ts";

const require = createRequire(import.meta.url);
const AXE = require.resolve("axe-core/axe.min.js");
const JAMAL = { userId: "10000000-0000-4000-8000-000000000012", name: "Jamal Reed", email: "jamal.reed@aldercreek.example" };
const APP = "app_90000000-0000-7000-8000-000000000001";
const EDITOR = `/w/alder-creek/applications/${APP}/edit`;
const NORTHWIND = "/w/alder-creek/outside/oap_d1000000-0000-7000-8000-000000000001";

async function axeViolations(page: import("@playwright/test").Page): Promise<string[]> {
  await page.addScriptTag({ path: AXE });
  return page.evaluate(async () => {
    const axe = (window as unknown as { axe: { run: (c: Document, o: object) => Promise<{ violations: { id: string; nodes: { html: string }[] }[] }> } }).axe;
    const r = await axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"] } });
    return r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.html.slice(0, 140)).join(" | ")}`);
  });
}

test("two people write one application together and see each other live", async ({ browser }) => {
  const { a: maria, b: jamal, contexts, problems } = await pairContexts(browser, JAMAL);
  try {
    await test.step("both open the draft and see each other", async () => {
      await maria.goto(EDITOR);
      await expect(maria.getByRole("textbox", { name: /Project title/ })).toBeVisible();
      await jamal.goto(EDITOR);
      await expect(jamal.getByRole("textbox", { name: /Project title/ })).toBeVisible();
      await expect(maria.getByRole("img", { name: "Editing now: Maria Santos, Jamal Reed" })).toBeVisible();
      await expect(jamal.getByRole("img", { name: "Editing now: Jamal Reed, Maria Santos" })).toBeVisible();
    });

    const mariaTitle = maria.getByRole("textbox", { name: /Project title/ });
    const jamalTitle = jamal.getByRole("textbox", { name: /Project title/ });

    await test.step("Jamal types in the project title: Maria sees it read-only, with his name", async () => {
      await jamalTitle.click();
      await jamalTitle.press("End");
      await jamalTitle.pressSequentially(" (pilot)");
      await expect(mariaTitle).toBeDisabled();
      const field = maria.locator(".fld").filter({ has: mariaTitle });
      await expect(field.getByText("Being edited by Jamal Reed")).toBeVisible();
      await expect(maria.getByRole("navigation", { name: "Application sections" }).getByText("Jamal Reed is editing")).toBeVisible();
      expect(await axeViolations(maria), "the presence pieces pass axe").toEqual([]);
    });

    await test.step("Maria's save reaches Jamal while he keeps typing", async () => {
      const families = maria.getByRole("spinbutton", { name: /Families served/ });
      await families.fill("512");
      // The editor saves once typing pauses; Jamal's copy takes it without touching his title.
      await expect(jamal.getByRole("spinbutton", { name: /Families served/ })).toHaveValue("512", { timeout: 15_000 });
      await expect(jamalTitle).toHaveValue("Mobile Health Navigation for Rural Families (pilot)");
      await expect(jamalTitle).toBeFocused();
    });

    await test.step("Jamal leaves the question: it opens again for Maria, and his words reach her", async () => {
      await jamal.getByRole("textbox", { name: /What need does this project address/ }).click();
      await expect(mariaTitle).toBeEnabled();
      await expect(mariaTitle).toHaveValue("Mobile Health Navigation for Rural Families (pilot)", { timeout: 15_000 });
      await expect(maria.locator(".fld").filter({ has: maria.getByRole("textbox", { name: /What need does this project address/ }) }).getByText("Jamal Reed is editing")).toBeVisible();
    });
    expect(problems, "no console or page errors").toEqual([]);
  } finally {
    for (const c of contexts) await c.close();
  }
});

test("two people answer an outside application's questions together", async ({ browser }) => {
  const { a: maria, b: jamal, contexts, problems } = await pairContexts(browser, JAMAL);
  try {
    await maria.goto(NORTHWIND);
    await jamal.goto(NORTHWIND);
    await expect(maria.getByRole("img", { name: "Editing now: Maria Santos, Jamal Reed" })).toBeVisible();
    const mariaQ2 = maria.getByRole("textbox", { name: "Answer to question 2" });
    const jamalQ2 = jamal.getByRole("textbox", { name: "Answer to question 2" });

    await test.step("Jamal types an answer: Maria's copy is read-only, with his name", async () => {
      await jamalQ2.click();
      await jamalQ2.pressSequentially("We will count families who reach care within a week.");
      await expect(mariaQ2).toHaveAttribute("readonly", "");
      await expect(maria.getByRole("article").filter({ has: mariaQ2 }).getByText("Being edited by Jamal Reed")).toBeVisible();
    });

    await test.step("Jamal saves: the answer reaches Maria, and she may write again", async () => {
      await jamal.getByRole("article").filter({ has: jamalQ2 }).getByRole("button", { name: "Save answer" }).click();
      await jamal.getByRole("textbox", { name: "Answer to question 1" }).click();
      await expect(mariaQ2).toHaveValue("We will count families who reach care within a week.", { timeout: 15_000 });
      await expect(mariaQ2).not.toHaveAttribute("readonly", "");
      expect(await axeViolations(maria), "the presence pieces pass axe").toEqual([]);
    });
    expect(problems, "no console or page errors").toEqual([]);
  } finally {
    for (const c of contexts) await c.close();
  }
});
