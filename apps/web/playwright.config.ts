// SPDX-License-Identifier: AGPL-3.0-only
// End-to-end flows from the design canvas, driven in a real browser against the mock API
// (VITE_USE_MOCKS=true). Mock state lives in the page, so each flow navigates by clicks only.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

/** The port the e2e server listens on: `E2E_PORT`, so checkouts side by side do not share one. */
export const PORT = Number(process.env.E2E_PORT ?? 5179);

const web = fileURLToPath(new URL(".", import.meta.url));
const git = (...args: string[]) => {
  try {
    return execFileSync("git", ["-C", web, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 });
  } catch {
    return "";
  }
};
/**
 * Which build the server must serve: this checkout's path, its commit and its uncommitted changes.
 * The e2e build writes it to /e2e-build.txt, and e2e/global-setup.ts stops the run when the server on
 * the port answers with another (another checkout's server, or a build of older code).
 */
const BUILD_ID = (process.env.E2E_BUILD_ID ??= createHash("sha256")
  .update([web, git("rev-parse", "HEAD"), git("diff", "HEAD", "--no-ext-diff", "--", "."), git("ls-files", "--others", "--exclude-standard", "--", ".")].join("\0"))
  .digest("hex")
  .slice(0, 16));

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
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
  // A built app, not the dev server. The dev server reloads the page the first time it has to
  // optimize a dependency it had not seen; a reload mid-flow wipes typed input and the in-page mock
  // state, which is how "applicant applies" used to fail on a cold run. A build cannot do that.
  webServer: {
    command: `pnpm exec vite build --outDir .e2e-dist --logLevel warn && node -e "require('fs').writeFileSync('.e2e-dist/e2e-build.txt', process.env.E2E_BUILD_ID)" && pnpm exec vite preview --outDir .e2e-dist --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/e2e-build.txt`,
    env: { VITE_USE_MOCKS: "true", E2E_BUILD_ID: BUILD_ID },
    // Never in CI. Locally a running server is reused only when it serves this build (global setup).
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
