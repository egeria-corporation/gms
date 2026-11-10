// SPDX-License-Identifier: AGPL-3.0-only
// End-to-end flows from the design canvas, driven in a real browser against the mock API
// (VITE_USE_MOCKS=true). Mock state lives in the page, so each flow navigates by clicks only.
import { defineConfig, devices } from "@playwright/test";

const PORT = 5179;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [["list"], ["github"]] : "list",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "off",
    screenshot: "only-on-failure",
    ...devices["Desktop Chrome"],
    viewport: { width: 1440, height: 900 },
  },
  webServer: {
    command: `pnpm exec vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    env: { VITE_USE_MOCKS: "true" },
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
