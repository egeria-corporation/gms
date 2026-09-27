// SPDX-License-Identifier: AGPL-3.0-only
import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 3000);
const useDev = process.env.E2E_SERVER === 'dev';

export default defineConfig({
  testDir: './e2e',
  testIgnore: ['**/shots.spec.ts'],
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://halcyon.localhost:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 60_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
  webServer: {
    command: useDev ? `pnpm exec next dev --port ${PORT}` : `pnpm exec next start --port ${PORT}`,
    url: `http://localhost:${PORT}/robots.txt`,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
    env: { GMS_AUTH_MODE: 'test', GMS_MODE: 'multi', GMS_ROOT_DOMAIN: `localhost:${PORT}`, GMS_ENV: 'test' },
  },
});
