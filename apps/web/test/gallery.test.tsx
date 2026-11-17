// SPDX-License-Identifier: AGPL-3.0-only
// The template gallery screens from the mocks: the public pages pass axe at desktop and phone
// width; "Use this template" sends a signed-out visitor to sign in and back, and is not offered to
// an applicant; a funder admin shares a published form and sees it wait for review; a moderator
// approves it from the queue.
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../src/app/App.tsx";
import { createMockServices } from "../src/app/services.tsx";
import { demoSession } from "../src/mocks/auth.ts";
import { MOCK_MEMBERSHIPS } from "../src/mocks/fixtures.ts";
import { IDS } from "../src/mocks/store.ts";
import { viewport } from "./setup.ts";

const T = { timeout: 15_000 };

function mount(path: string, opts: Parameters<typeof createMockServices>[0] = { session: demoSession() }) {
  const services = createMockServices(opts);
  let location = "";
  function Where() {
    const l = useLocation();
    location = l.pathname + l.search;
    return null;
  }
  const view = render(
    <MemoryRouter initialEntries={[path]}>
      <App services={services} />
      <Routes>
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
  return { ...view, services, where: () => location };
}

async function serious() {
  const result = await axe.run(document.body, {
    runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] },
    rules: { "color-contrast": { enabled: false }, "target-size": { enabled: false } },
  });
  return result.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes.map((n) => n.html.slice(0, 120)).join(" | ")}`);
}

afterEach(() => {
  viewport.phone = false;
});

describe("template gallery pages", () => {
  it.each(["/templates", "/templates/common-application", "/templates/five-criterion-rubric", "/templates/small-grants-program-kit", "/gallery/moderation"])("axe: %s", async (path) => {
    const { container } = mount(path);
    await waitFor(() => {
      expect(container.querySelector("main")).not.toBeNull();
      expect(container.querySelector("[aria-busy=true]")).toBeNull();
      expect(screen.queryByText(/^Loading/)).toBeNull();
    }, T);
    expect(await serious()).toEqual([]);
  }, 30_000);

  it("axe at phone width, and the filters narrow the list", async () => {
    viewport.phone = true;
    mount("/templates");
    const list = await screen.findByRole("list", { name: "Templates" }, T);
    expect(within(list).getAllByRole("heading", { level: 2 }).length).toBe(10);
    expect(await serious()).toEqual([]);
    await userEvent.click(screen.getByRole("button", { name: "Report forms" }));
    await waitFor(() => expect(within(screen.getByRole("list", { name: "Templates" })).getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual(["Final report", "Interim report"]));
    await userEvent.click(screen.getByRole("button", { name: "All" }));
    await userEvent.selectOptions(screen.getByLabelText("Tag"), "Health");
    await waitFor(() => expect(screen.getByRole("heading", { name: "Community health mini-grant application" })).toBeTruthy());
    expect(screen.getByText("Verified by Passport")).toBeTruthy();
  }, 30_000);

  it("sends a signed-out visitor to sign in, and back to the template", async () => {
    const { where } = mount("/templates/decline-email", { session: null });
    await userEvent.click(await screen.findByRole("button", { name: /Use this template/ }, T));
    await waitFor(() => expect(where()).toBe(`/signin?next=${encodeURIComponent("/templates/decline-email?use=1")}`));
    // The preview stays readable without signing in.
    mount("/templates/decline-email", { session: null });
    expect(await screen.findAllByText(/Your application to \{\{funder\.name\}\}/, {}, T)).not.toHaveLength(0);
  }, 30_000);

  it("offers no copy to an applicant", async () => {
    mount("/templates/decline-email", { session: demoSession(), memberships: MOCK_MEMBERSHIPS.filter((m) => m.kind === "applicant") });
    expect(await screen.findByText(/Templates are copied into a funder workspace/, {}, T)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Use this template/ })).toBeNull();
  }, 30_000);

  it("a funder admin shares a published form; it waits for review, and a moderator publishes it", async () => {
    mount(`/w/riverbend/forms/${IDS.formLoi}/edit`);
    await userEvent.click(await screen.findByRole("button", { name: /Share to the gallery/ }, T));
    const dialog = await screen.findByRole("dialog", { name: /Share “Letter of intent” to the gallery/ }, T);
    expect(await within(dialog).findByText("What we took out", {}, T)).toBeTruthy();
    expect(within(dialog).getByText(/These names become “\[Your organization\]”: Riverbend Community Foundation/)).toBeTruthy();
    const send = within(dialog).getByRole("button", { name: /Send for review/ });
    expect((send as HTMLButtonElement).disabled).toBe(true);
    await userEvent.type(within(dialog).getByLabelText(/Summary/), "A short letter of intent for any program.");
    await userEvent.click(within(dialog).getByRole("checkbox", { name: "Any field" }));
    await userEvent.click(within(dialog).getByRole("checkbox", { name: /I agree to share it under/ }));
    await userEvent.click(send);
    expect(await within(dialog).findByText("A moderator will review it", {}, T)).toBeTruthy();
    await userEvent.click(within(dialog).getByRole("button", { name: "Done" }));

    // The same app (the mock keeps its state in the page): Forms lists it as waiting for review.
    await userEvent.click(screen.getAllByRole("link", { name: "Forms" })[0]!);
    const panel = await screen.findByRole("list", { name: "Shared to the gallery" }, T);
    const mine = within(panel).getAllByRole("listitem").find((li) => li.textContent?.includes("Letter of intent"))!;
    expect(within(mine).getByText("Waiting for review")).toBeTruthy();

    // The demo person moderates the mock gallery: from the gallery to the queue.
    await userEvent.click(screen.getAllByRole("link", { name: /Template gallery/ })[0]!);
    await userEvent.click(await screen.findByRole("link", { name: /Review shared templates/ }, T));
    const queue = await screen.findByRole("list", { name: "Waiting for review" }, T);
    const card = within(queue).getAllByRole("listitem").find((li) => li.textContent?.includes("Letter of intent"))!;
    await userEvent.click(within(card).getByRole("button", { name: /Approve and publish/ }));
    expect(await screen.findByText(/Published “Letter of intent” at \/templates\/letter-of-intent/, {}, T)).toBeTruthy();
  }, 60_000);
});
