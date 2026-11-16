// SPDX-License-Identifier: AGPL-3.0-only
// Regression tests for the WCAG 2.2 AA fixes in docs/accessibility.md, one class of fix each.
// The browser checks (axe on every route and dialog, contrast, reflow) are in
// e2e/a11y-every-route.spec.ts; these hold the rules in place where jsdom can see them.
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../src/app/App.tsx";
import { createMockServices } from "../src/app/services.tsx";
import { CopyButton } from "../src/components/CopyButton.tsx";
import { NotFound } from "../src/components/NotFound.tsx";
import { Field, Notice } from "../src/components/ui.tsx";
import { organizationAutocomplete } from "../src/forms/FormView.tsx";
import { actedRecently, announce, forgetActions, watchActions } from "../src/lib/announce.ts";
import { contrastRatio } from "../src/lib/contrast.ts";
import { demoSession } from "../src/mocks/auth.ts";

// The suite runs from the repository root or from apps/web.
const SRC = [join(process.cwd(), "apps/web/src"), join(process.cwd(), "src")].find((d) => existsSync(join(d, "app/App.tsx")))!;
const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? files(join(dir, f)) : [join(dir, f)]));
const tsx = files(SRC).filter((f) => f.endsWith(".tsx"));
const css = (name: string) => readFileSync(join(SRC, "theme", name), "utf8");

afterEach(() => document.getElementById("gms-announcer")?.remove());

describe("a field's control carries what the field says (1.3.1, 3.3.1, 3.3.2)", () => {
  it("required, help, and the error in place of the help", () => {
    const { rerender } = render(
      <Field id="f" label="Organization name" required help="As registered.">
        <input id="f" aria-describedby="other f-help" />
      </Field>,
    );
    const input = screen.getByRole("textbox", { name: /Organization name/ });
    expect(input).toHaveAttribute("aria-required", "true");
    expect(input).toHaveAccessibleDescription("As registered.");
    expect(input.getAttribute("aria-describedby")).toBe("other f-help");
    expect(input).not.toHaveAttribute("aria-invalid");
    rerender(
      <Field id="f" label="Organization name" required help="As registered." error="Enter the name.">
        <input id="f" aria-describedby="other f-help" />
      </Field>,
    );
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input.getAttribute("aria-describedby")).toBe("other f-err");
    expect(input).toHaveAccessibleDescription("Enter the name.");
  });

  it("never points at help that is not on the page", () => {
    render(
      <Field id="t" label="Title">
        <input id="t" aria-describedby="t-help" />
      </Field>,
    );
    expect(screen.getByRole("textbox", { name: "Title" })).not.toHaveAttribute("aria-describedby");
  });
});

describe("visible words start the accessible name (2.5.3)", () => {
  it("a labelled copy button is named by its label; a plain one by what it copies", () => {
    render(
      <>
        <CopyButton value="x" what="the embed code" label="Copy embed code" />
        <CopyButton value="y" what="the short post" />
      </>,
    );
    expect(screen.getByRole("button", { name: "Copy embed code" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy the short post" })).toHaveTextContent("Copy");
  });
});

describe("landmarks, headings and roles (1.3.1, 4.1.2)", () => {
  it("page not found has a main landmark and a level-1 heading", () => {
    render(
      <MemoryRouter>
        <NotFound />
      </MemoryRouter>,
    );
    expect(within(screen.getByRole("main")).getByRole("heading", { level: 1, name: "Page not found" })).toBeInTheDocument();
  });

  it("no plain div, span, pre, p or dl carries an aria-label without a role", () => {
    const offenders = tsx.flatMap((f) =>
      [...readFileSync(f, "utf8").matchAll(/<(div|span|pre|p|dl)\b[^>]*?aria-label=[^>]*>/g)].filter((m) => !/\brole=/.test(m[0])).map((m) => `${f.slice(SRC.length)}: ${m[0].slice(0, 80)}`),
    );
    expect(offenders).toEqual([]);
  });

  it("every scrolling table wrapper can be reached and scrolled by keyboard (2.1.1)", () => {
    const offenders = tsx.flatMap((f) =>
      [...readFileSync(f, "utf8").matchAll(/<div className="tbl-wrap"[^>]*>\s*<table/g)].filter((m) => !/tabIndex=\{0\}/.test(m[0]) || !/role="region"/.test(m[0])).map((m) => `${f.slice(SRC.length)}: ${m[0].slice(0, 80)}`),
    );
    expect(offenders).toEqual([]);
  });

  it("the workspace menu owns only menu items", async () => {
    render(
      <MemoryRouter initialEntries={["/w/riverbend"]}>
        <App services={createMockServices({ session: demoSession() })} />
      </MemoryRouter>,
    );
    await userEvent.click(await screen.findByRole("button", { name: /Riverbend Community Foundation/ }));
    const menu = await screen.findByRole("menu", { name: "Switch workspace" });
    await within(menu).findAllByRole("menuitem");
    const result = await axe.run(menu, { runOnly: { type: "rule", values: ["aria-required-children", "aria-required-parent"] } });
    expect(result.violations.map((v) => v.id)).toEqual([]);
  });
});

describe("the conformance report", () => {
  it("is linked from the landing page's footer", async () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <App services={createMockServices({ session: null })} />
      </MemoryRouter>,
    );
    const footer = await screen.findByRole("contentinfo");
    expect(within(footer).getByRole("link", { name: "Accessibility" })).toHaveAttribute("href", "https://github.com/egeria-corporation/gms/blob/main/docs/accessibility.md");
  });
});

describe("skip link (2.4.1)", () => {
  it("is the first link and moves focus to the main content", async () => {
    render(
      <MemoryRouter initialEntries={["/w/riverbend"]}>
        <App services={createMockServices({ session: demoSession() })} />
      </MemoryRouter>,
    );
    await screen.findByRole("navigation", { name: "Funder workspace" });
    const skip = screen.getAllByRole("link")[0]!;
    expect(skip).toHaveTextContent("Skip to main content");
    await userEvent.click(skip);
    expect(screen.getByRole("main")).toHaveFocus();
  });
});

describe("status messages (4.1.3)", () => {
  it("a banner shown after an action is spoken through the page's live region; one present on load is not", async () => {
    forgetActions();
    const stop = watchActions(document);
    const region = document.getElementById("gms-announcer")!;
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(region).not.toHaveAttribute("role");
    render(<Notice tone="ok" title="Shown with the page" />);
    await new Promise((r) => setTimeout(r, 80));
    expect(region.textContent).toBe("");
    await userEvent.click(document.body);
    expect(actedRecently()).toBe(true);
    render(<Notice tone="ok" title="Saved">Board of directors 2026.pdf was added to the vault</Notice>);
    await waitFor(() => expect(region.textContent).toBe("Saved. Board of directors 2026.pdf was added to the vault"));
    // The banner itself is a quiet status element, so nothing is said twice.
    for (const banner of screen.getAllByRole("status")) expect(banner).toHaveAttribute("aria-live", "off");
    act(() => announce("Imported 3 of 3"));
    await waitFor(() => expect(region).toHaveTextContent("Imported 3 of 3"));
    stop();
  });
});

describe("errors tied to the sign-in code (3.3.1)", () => {
  it("each digit is invalid and described by the problem", async () => {
    render(
      <MemoryRouter initialEntries={["/signin"]}>
        <App services={createMockServices({ session: null })} />
      </MemoryRouter>,
    );
    await userEvent.type(await screen.findByLabelText("Work email"), "sam@newcomer.example");
    await userEvent.click(screen.getByRole("button", { name: "Send code" }));
    const digits = within(await screen.findByRole("group", { name: "One-time code" })).getAllByRole("textbox");
    for (const [i, d] of digits.entries()) await userEvent.type(d, String((i + 2) % 10));
    await userEvent.click(screen.getByRole("button", { name: "Verify and continue" }));
    const problem = await screen.findByRole("alert");
    for (const d of digits) {
      expect(d).toHaveAttribute("aria-invalid", "true");
      expect(d.getAttribute("aria-describedby")).toBe(problem.id);
    }
  });
});

describe("input purpose (1.3.5)", () => {
  it("organization fields an applicant types carry an autofill purpose", () => {
    expect(organizationAutocomplete("/organization/legalName")).toBe("organization");
    expect(organizationAutocomplete("/organization/contactEmail")).toBe("email");
    expect(organizationAutocomplete("/organization/phone")).toBe("tel");
    expect(organizationAutocomplete("/organization/website")).toBe("url");
    expect(organizationAutocomplete("/project/summary")).toBeUndefined();
  });
});

describe("non-text contrast of the theme (1.4.11, 2.4.7)", () => {
  const app = css("app.css");
  const screens = css("screens.css");
  const tokens = css("tokens.css");
  const token = (name: string, from = tokens + app) => new RegExp(`${name}:\\s*(#[0-9A-Fa-f]{6})`).exec(from)?.[1];
  const surfaces = ["--og-white", "--og-gray-50", "--og-gray-100", "--og-teal-soft"].map((t) => token(t)!);

  it("form control outlines are 3:1 or more on every surface a field sits on", () => {
    const border = token("--ctl-border")!;
    for (const bg of surfaces) expect(contrastRatio(border, bg)!, `${border} on ${bg}`).toBeGreaterThanOrEqual(3);
    expect(screens).toMatch(/\.inp, \.sel, \.ta \{ border-color: var\(--ctl-border/);
    expect(screens).toMatch(/\.tog \{ background: var\(--ctl-border/);
  });

  it("the focus ring is 3:1 or more on every light surface, with a white halo for dark ones", () => {
    expect(screens).toMatch(/\.gms :focus-visible \{ outline: 2px solid var\(--og-teal-dark\); outline-offset: 2px; box-shadow: 0 0 0 2px var\(--og-white\); \}/);
    for (const bg of surfaces) expect(contrastRatio(token("--og-teal-dark")!, bg)!).toBeGreaterThanOrEqual(3);
    // The brand teal it replaced was not.
    expect(contrastRatio(token("--og-teal")!, "#FFFFFF")!).toBeLessThan(3);
  });

  it("a resolved comment is not faded below text contrast", () => {
    expect(screens).toMatch(/\.cmt-res \{ opacity: 1;/);
  });
});
