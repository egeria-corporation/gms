// @vitest-environment node
// SPDX-License-Identifier: AGPL-3.0-only
// Dates, money and numbers use Intl with the page's language (docs/i18n.md): no screen formats with a
// hard-coded "en-US".
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { mondayLabel } from "../src/api/digests.ts";
import { changeLocale } from "../src/i18n/current.ts";
import { formatDecimalAmount } from "../src/lib/directAward.ts";
import { displayCell } from "../src/lib/reports.ts";
import type { OutColumn } from "../src/api/reports.ts";

const src = fileURLToPath(new URL("../src/", import.meta.url));
const files = (dir: string): string[] => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? files(join(dir, n)) : /\.tsx?$/.test(n) ? [join(dir, n)] : []));
// Demo data and the design reference boards are sample content; current.ts names the tags.
const SAMPLE = /^(mocks|screens\/styleguide)\/|^i18n\/current\.ts$/;

afterEach(async () => {
  await changeLocale("en");
});

describe("formatting in the page's language", () => {
  it("has no hard-coded en-US in the app", () => {
    const hits = files(src)
      .map((f) => relative(src, f).split("\\").join("/"))
      .filter((p) => !SAMPLE.test(p) && /["']en-US["']/.test(readFileSync(join(src, p), "utf8")));
    expect(hits).toEqual([]);
  });

  it("words the digest day, an award amount and a report number in Spanish", async () => {
    await changeLocale("es");
    expect(mondayLabel("2027-04-19")).toBe("lunes, 19 de abril");
    expect(formatDecimalAmount("25000.5")).toBe("$25,000.50");
    expect(displayCell({ type: "number" } as OutColumn, 1234567)).toBe("1,234,567");
    await changeLocale("en");
    expect(mondayLabel("2027-04-19")).toBe("Monday, April 19");
  });
});
