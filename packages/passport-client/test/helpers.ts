// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from "node:fs";
import type { Fixture } from "../src/index.ts";

export function loadFixture(name: string): Fixture {
  return JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8")) as Fixture;
}

export const ORG = "0193a1c0-0000-7000-8000-0000000000a1";
export const AWARD = "0193a1c0-0000-7000-8000-00000000aa01";
