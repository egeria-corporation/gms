// SPDX-License-Identifier: AGPL-3.0-only
// The switch pages and the free migration request, from the mocks: every system page renders with
// its source links and the date stamp, no system lacks a source, list prices appear only where the
// research gives one, and the form previews exactly what it sends, keeps its hidden field hidden,
// waits for a person's few seconds and removes numbers that look like bank or identity numbers.
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { provideMigrationRequestApi } from "../src/api/migrationRequestHooks.ts";
import { App } from "../src/app/App.tsx";
import { createMockServices } from "../src/app/services.tsx";
import { FACTS_AS_OF, LIST_PRICE_LABEL, OUR_NAME, PEAK_SOURCE, SWITCH_ENTRIES, SYSTEM_OPTIONS, TRADEMARK_NOTE, importWizardPath, seoFor } from "../src/content/switch.ts";
import { createMockMigrationRequestApi } from "../src/mocks/migrationRequest.ts";

function open(path: string, clock = { now: Date.parse("2026-11-16T15:00:00Z") }) {
  const services = createMockServices({ session: null });
  const api = createMockMigrationRequestApi({ now: () => clock.now, webBaseUrl: "https://gms.opengrants.io" });
  provideMigrationRequestApi(services, api);
  const view = render(
    <MemoryRouter initialEntries={[path]}>
      <App services={services} />
    </MemoryRouter>,
  );
  return { ...view, api, clock };
}

async function axeProblems() {
  const result = await axe.run(document.body, {
    runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] },
    rules: { "color-contrast": { enabled: false }, "target-size": { enabled: false } },
  });
  return result.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes.map((n) => n.html.slice(0, 120)).join(" | ")}`);
}

describe("switch page content", () => {
  it("gives every system at least one https source, and only the research's list prices", () => {
    const systems = SWITCH_ENTRIES.filter((e) => e.kind === "system");
    expect(systems.map((e) => e.slug)).toEqual(["good-grants", "submittable", "surveymonkey-apply", "foundant", "zengine", "fluxx", "smartsimple", "cybergrants", "openwater"]);
    for (const e of systems) {
      expect(e.sources.length, e.slug).toBeGreaterThan(0);
      for (const s of e.sources) expect(s.url, e.slug).toMatch(/^https:\/\/[^\s]+$/);
    }
    expect(Object.fromEntries(SWITCH_ENTRIES.filter((e) => e.listPrice).map((e) => [e.slug, e.listPrice]))).toEqual({
      "good-grants": "€3,200 or €6,400 a year",
      foundant: "$6,500, $9,900 or $13,900 a year, plus $2,500 to $4,500 for setup",
      fluxx: "from $13,000 a year, plus setup",
      openwater: "from $5,100 a year",
    });
    // Respectful: no comparisons of quality, no superlatives about anyone.
    const all = JSON.stringify(SWITCH_ENTRIES);
    expect(all).not.toMatch(/better than|worse|outdated|clunky|legacy|expensive|cheaper|best\b/i);
  });

  it("lists every system plus spreadsheets in the form, then something else", () => {
    expect(SYSTEM_OPTIONS.map((o) => o.value)).toEqual([...SWITCH_ENTRIES.map((e) => e.slug), "other"]);
  });

  it("has a title, description and Open Graph text for every page", () => {
    for (const e of [null, ...SWITCH_ENTRIES]) {
      const seo = seoFor(e);
      for (const v of Object.values(seo)) expect(v.length).toBeGreaterThan(20);
      expect(seo.title.length).toBeLessThanOrEqual(70);
    }
    expect(importWizardPath("riverbend")).toBe("/w/riverbend/import");
  });
});

describe("/switch/{system}", () => {
  it.each(SWITCH_ENTRIES.map((e) => [e.slug, e] as const))("%s renders with its sources and the date stamp", async (_slug, entry) => {
    const view = open(`/switch/${entry.slug}`);
    expect(await screen.findByRole("heading", { level: 1, name: `Moving from ${entry.name} to ${OUR_NAME}` })).toBeInTheDocument();
    expect(screen.getByText(`Switching · facts as of ${FACTS_AS_OF}`)).toBeInTheDocument();
    expect(screen.getByTestId("switch-note")).toHaveTextContent(TRADEMARK_NOTE);
    if (entry.sources.length) {
      const sources = within(screen.getByRole("list", { name: "Sources" })).getAllByRole("link");
      expect(sources.map((a) => a.getAttribute("href"))).toEqual(entry.sources.map((s) => s.url));
      for (const a of sources) expect(a).toHaveAttribute("rel", expect.stringContaining("noopener"));
    } else {
      expect(screen.queryByRole("list", { name: "Sources" })).toBeNull();
    }
    for (const line of [...entry.exports, ...entry.movesOver]) expect(screen.getAllByText(line).length).toBeGreaterThan(0);
    expect(screen.getByRole("heading", { name: "What stays behind" })).toBeInTheDocument();
    expect(screen.getByText(/dropped automatically and never stored/)).toBeInTheDocument();
    for (const step of ["Upload the files to the import wizard", "Review the dry run", "Import"]) expect(screen.getByText(step, { selector: ".t" })).toBeInTheDocument();
    for (const d of ["Free", "Unlimited seats", "Open source (AGPL-3.0)", "CommonGrants"]) expect(screen.getByRole("heading", { level: 3, name: d })).toBeInTheDocument();
    if (entry.listPrice) {
      const price = screen.getByRole("table", { name: "Price" });
      expect(price).toHaveTextContent(`${entry.listPrice} (${LIST_PRICE_LABEL})`);
      expect(price).toHaveTextContent("Free, with unlimited seats");
    } else {
      expect(screen.queryByRole("table", { name: "Price" })).toBeNull();
    }
    expect(screen.getByRole("form", { name: "Request a free migration" })).toBeInTheDocument();
    // The form starts on this system.
    expect(screen.getByLabelText(/Current system/)).toHaveValue(entry.slug);
    // No logos: the only images are our own.
    for (const img of view.container.querySelectorAll("img")) expect(img.getAttribute("src")).toMatch(/^\/brand\/opengrants-/);
  });

  it("answers Page not found for a system it does not cover", async () => {
    open("/switch/unknown-system");
    expect(await screen.findByRole("heading", { name: "Page not found" })).toBeInTheDocument();
  });

  it("has no serious accessibility problems, with the preview open", async () => {
    open("/switch/submittable");
    await screen.findByRole("heading", { level: 1 });
    expect(await axeProblems()).toEqual([]);
    await fill(userEvent.setup());
    await userEvent.click(screen.getByRole("button", { name: "Preview what will be sent" }));
    await screen.findByRole("region", { name: "What will be sent" });
    expect(await axeProblems()).toEqual([]);
  });
});

describe("/switch", () => {
  it("lists every system and spreadsheets with a one-line summary, cites PEAK and carries the date stamp", async () => {
    open("/switch");
    expect(await screen.findByRole("heading", { level: 1, name: `Switching to ${OUR_NAME}` })).toBeInTheDocument();
    for (const e of SWITCH_ENTRIES) {
      expect(screen.getByRole("link", { name: e.listName })).toHaveAttribute("href", `/switch/${e.slug}`);
      expect(screen.getByText(e.summary)).toBeInTheDocument();
    }
    expect(screen.getByRole("link", { name: new RegExp(PEAK_SOURCE.label) })).toHaveAttribute("href", PEAK_SOURCE.url);
    expect(screen.getByTestId("switch-note")).toHaveTextContent(TRADEMARK_NOTE);
    expect(screen.getByLabelText(/Current system/)).toHaveValue("");
    expect(await axeProblems()).toEqual([]);
  });
});

async function fill(user: ReturnType<typeof userEvent.setup>, note?: string) {
  await user.type(screen.getByLabelText(/Your name/), "Ana Ruiz");
  await user.type(screen.getByLabelText(/Work email/), "ana@riverbendcf.example");
  await user.type(screen.getByLabelText(/^Organization/), "Riverbend Community Foundation");
  await user.selectOptions(screen.getByLabelText(/Programs, about how many/), "2-5");
  await user.selectOptions(screen.getByLabelText(/Past awards, about how many/), "100-999");
  await user.selectOptions(screen.getByLabelText(/When you hope to move/), "3-months");
  if (note) await user.type(screen.getByLabelText(/Note/), note);
}

describe("request a free migration", () => {
  it("previews exactly what it sends, waits a person's few seconds, then sends", async () => {
    const user = userEvent.setup();
    const { api, clock } = open("/switch/submittable");
    await screen.findByRole("heading", { level: 1 });
    // Asking for the preview with nothing filled in says what is missing, under each field.
    await user.click(screen.getByRole("button", { name: "Preview what will be sent" }));
    expect(screen.getByText("Give your name")).toBeInTheDocument();
    expect(screen.getByText("Choose when you hope to move")).toBeInTheDocument();

    await fill(user, "We run two cycles a year.");
    await user.click(screen.getByRole("button", { name: "Preview what will be sent" }));
    const preview = await screen.findByRole("region", { name: "What will be sent" });
    expect(within(preview).getByText("hello@agents.opengrants.io")).toBeInTheDocument();
    expect(within(preview).getByText("Migration request: Riverbend Community Foundation (from Submittable)")).toBeInTheDocument();
    const text = screen.getByTestId("migration-email-text").textContent!;
    expect(text).toContain("Current system: Submittable");
    expect(text).toContain("Note:\nWe run two cycles a year.");

    // Straight away is too quick for a person.
    await user.click(screen.getByRole("button", { name: "Send the request" }));
    expect(await screen.findByText("That was quick. Wait a few seconds, then send it again")).toBeInTheDocument();
    expect(api.store.sent).toHaveLength(0);

    clock.now += 5_000;
    await user.click(screen.getByRole("button", { name: "Send the request" }));
    expect(await screen.findByText("Request sent")).toBeInTheDocument();
    expect(screen.getByText("A person at OpenGrants will reply to ana@riverbendcf.example. Migration help can start right away.")).toBeInTheDocument();
    const [request, confirmation] = api.store.sent;
    expect(request).toMatchObject({ to: ["hello@agents.opengrants.io"], replyTo: "ana@riverbendcf.example", subject: "Migration request: Riverbend Community Foundation (from Submittable)", text });
    expect(confirmation!.to).toEqual(["ana@riverbendcf.example"]);
    expect(confirmation!.text).toContain("A person at OpenGrants will reply to this address, and migration help can start right away.");
  });

  it("clears the preview on any edit, so what is sent is what was last shown", async () => {
    const user = userEvent.setup();
    open("/switch/fluxx");
    await screen.findByRole("heading", { level: 1 });
    await fill(user);
    await user.click(screen.getByRole("button", { name: "Preview what will be sent" }));
    await screen.findByRole("region", { name: "What will be sent" });
    await user.type(screen.getByLabelText(/^Organization/), " Trust");
    expect(screen.queryByRole("region", { name: "What will be sent" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Send the request" })).toBeNull();
  });

  it("removes numbers that look like bank or identity numbers from the note, and says so", async () => {
    const user = userEvent.setup();
    open("/switch/foundant");
    await screen.findByRole("heading", { level: 1 });
    expect(screen.getByText(/Numbers that look like a bank account, routing or identity number are removed before anything is sent/)).toBeInTheDocument();
    await fill(user, "Our acct 11111 and 000000000 are on file.");
    await user.click(screen.getByRole("button", { name: "Preview what will be sent" }));
    await screen.findByRole("region", { name: "What will be sent" });
    const text = screen.getByTestId("migration-email-text").textContent!;
    expect(text).toContain("Our acct [number removed] and [number removed] are on file.");
    expect(text).not.toMatch(/11111|000000000/);
    expect(screen.getByText("2 numbers were removed from your note because they looked like a bank or identity number.")).toBeInTheDocument();
  });

  it("keeps the hidden field out of sight and out of reach, and refuses a send with it filled", async () => {
    const { api, clock, container } = open("/switch/openwater");
    await screen.findByRole("heading", { level: 1 });
    const trap = container.querySelector<HTMLInputElement>('input[name="website"]')!;
    expect(trap).toHaveAttribute("tabindex", "-1");
    expect(trap.closest("[aria-hidden=true]")).not.toBeNull();
    expect(trap.closest(".sr")).not.toBeNull();
    const { formToken } = await api.form();
    clock.now += 5_000;
    await expect(api.send({ name: "Bot", email: "bot@example.org", organization: "Bots", system: "openwater", programs: "1", pastAwards: "0-99", timing: "asap", website: "https://spam.example", formToken })).rejects.toMatchObject({ status: 422, errors: [{ code: "not_sent" }] });
    expect(api.store.sent).toHaveLength(0);
  });
});
