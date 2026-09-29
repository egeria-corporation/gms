// SPDX-License-Identifier: AGPL-3.0-or-later
// `pnpm shots`: a screenshot of every catalog route (lib/catalog.ts) into artifacts/screens/, plus an
// index.html contact sheet and a zip. Reuses a running server on the port, or starts `next start`.
import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 3000);

export default defineConfig({
  testDir: './e2e',
  testMatch: ['**/shots.spec.ts'],
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60 * 60_000,
  reporter: [['list']],
  use: { trace: 'off', screenshot: 'off', actionTimeout: 15_000, navigationTimeout: 60_000 },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: process.env.E2E_SERVER === 'dev' ? `pnpm exec next dev --port ${PORT}` : `pnpm exec next start --port ${PORT}`,
    url: `http://localhost:${PORT}/robots.txt`,
    reuseExistingServer: true,
    timeout: 240_000,
    env: { GMS_AUTH_MODE: 'test', GMS_MODE: 'multi', GMS_ROOT_DOMAIN: `localhost:${PORT}`, GMS_ENV: 'test' },
  },
});
