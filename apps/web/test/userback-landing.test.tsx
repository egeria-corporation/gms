// SPDX-License-Identifier: AGPL-3.0-only
// The landing page discloses Userback only when the widget is on (a token set outside mock mode).
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { USERBACK_DISCLOSURE } from "../src/lib/userback.ts";

async function landing(token: string, useMocks: boolean) {
  vi.resetModules();
  vi.doMock("../src/env.ts", async (orig) => ({ env: { ...((await orig()) as { env: object }).env, userbackToken: token, useMocks } }));
  const { App } = await import("../src/app/App.tsx");
  const { createMockServices } = await import("../src/app/services.tsx");
  render(
    <MemoryRouter initialEntries={["/"]}>
      <App services={createMockServices({ session: null })} />
    </MemoryRouter>,
  );
  await screen.findByText("Who can see my organization's information?", { exact: false });
}

describe("landing disclosure", () => {
  it("is absent without a token and in mock mode", async () => {
    await landing("", false);
    expect(screen.queryByText(/Userback/)).toBeNull();
  });
  it("is absent in mock mode even with a token", async () => {
    await landing("A-test", true);
    expect(screen.queryByText(/Userback/)).toBeNull();
  });
  it("shows with a token outside mock mode", async () => {
    await landing("A-test", false);
    expect(await screen.findByText(new RegExp(USERBACK_DISCLOSURE.slice(0, 40)))).toBeInTheDocument();
  });
});
