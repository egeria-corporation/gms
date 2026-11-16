// @vitest-environment node
// SPDX-License-Identifier: AGPL-3.0-only
// The flows look up page-wide text with `shown(page, …)` (e2e/helpers.ts), never `page.getByText`:
// a banner shown after an action is also copied into the page's live region for a few seconds
// (src/lib/announce.ts), so a page-wide text lookup can match two elements or one depending on
// timing. That race failed flow 9 and flow 11 under parallel workers.
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const e2e = fileURLToPath(new URL("../e2e/", import.meta.url));

describe("the end-to-end flows", () => {
  it("never look up page-wide text with page.getByText", () => {
    const uses = readdirSync(e2e)
      .filter((f) => f.endsWith(".ts") && f !== "helpers.ts")
      .flatMap((f) => readFileSync(e2e + f, "utf8").split("\n").map((line, i) => [f, i + 1, line] as const))
      .filter(([, , line]) => /\bpage\.getByText\(/.test(line))
      .map(([f, n]) => `${f}:${n}`);
    expect(uses).toEqual([]);
  });

  it("leave out the live region's copy in the helper", () => {
    expect(readFileSync(e2e + "helpers.ts", "utf8")).toContain(':not(#gms-announcer)');
    expect(readFileSync(fileURLToPath(new URL("../src/lib/announce.ts", import.meta.url)), "utf8")).toContain('const REGION_ID = "gms-announcer"');
  });
});
