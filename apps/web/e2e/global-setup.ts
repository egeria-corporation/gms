// SPDX-License-Identifier: AGPL-3.0-only
// Before any flow: the server on the e2e port must serve this checkout's build (playwright.config.ts).
// A server left running by another checkout, or a build of older code, would otherwise be tested
// silently in its place.
import type { FullConfig } from "@playwright/test";

export default async function globalSetup(config: FullConfig): Promise<void> {
  const base = config.projects[0]?.use.baseURL;
  const expected = process.env.E2E_BUILD_ID;
  if (!base || !expected) throw new Error("The e2e run has no base URL or build id (playwright.config.ts sets both).");
  const res = await fetch(new URL("/e2e-build.txt", base)).catch((error: unknown) => {
    throw new Error(`No e2e server answers on ${base}: ${(error as Error).message}`);
  });
  const served = (await res.text()).trim();
  if (served !== expected) {
    throw new Error(
      `The server on ${base} serves another build (${served.slice(0, 16) || "no build id"}, this checkout is ${expected}). ` +
        "Stop that server, or run on another port: E2E_PORT=5293 pnpm --filter @gms/web e2e",
    );
  }
}
