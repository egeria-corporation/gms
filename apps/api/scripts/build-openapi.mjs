#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Writes public/openapi.json from the compiled TypeSpec document so the Worker can serve
// GET /openapi.json as a static asset. Run `pnpm spec:compile` first.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const src = fileURLToPath(new URL("../../../api/tsp-output/@typespec/openapi3/openapi.GMS.yaml", import.meta.url));
const out = fileURLToPath(new URL("../public/openapi.json", import.meta.url));
if (!existsSync(src)) {
  console.error("The compiled OpenAPI document is missing. Run `pnpm spec:compile` first.");
  process.exit(1);
}
mkdirSync(fileURLToPath(new URL("../public", import.meta.url)), { recursive: true });
writeFileSync(out, JSON.stringify(parse(readFileSync(src, "utf8"))));
console.log(`wrote ${out}`);
