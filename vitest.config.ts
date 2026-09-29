// SPDX-License-Identifier: AGPL-3.0-or-later
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['packages/**/*.test.ts', 'apps/**/src/**/*.test.ts', 'apps/**/lib/**/*.test.ts'],
          exclude: ['**/*.db.test.ts', '**/node_modules/**', 'packages/agent-evals/**'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'db',
          include: ['packages/**/*.db.test.ts', 'apps/**/*.db.test.ts'],
          exclude: ['**/node_modules/**'],
          globalSetup: ['./packages/db/test/global-setup.ts'],
          testTimeout: 60_000,
          hookTimeout: 120_000,
          fileParallelism: true,
          maxWorkers: 4,
        },
      },
      {
        test: {
          name: 'evals',
          include: ['packages/agent-evals/**/*.test.ts'],
          globalSetup: ['./packages/db/test/global-setup.ts'],
          testTimeout: 60_000,
          hookTimeout: 180_000,
        },
      },
    ],
  },
});
