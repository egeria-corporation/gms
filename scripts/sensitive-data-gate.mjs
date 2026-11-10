#!/usr/bin/env node
// CI gate: The GMS never stores, logs, or transmits bank or identity numbers (CLAUDE.md §3).
// Fails if a migration, type, source file, or API definition mentions a field that would hold one.
// Allow-listed paths must justify themselves in scripts/sensitive-data-allowlist.json.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const root = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const scanRoots = ["supabase/migrations", "supabase/seed", "supabase/tests", "packages", "apps", "api"];
const skipDirs = new Set(["node_modules", "dist", "tsp-output", ".wrangler", "coverage", "base"]);
const exts = /\.(ts|tsx|js|mjs|sql|tsp|json|csv|yaml|yml)$/;

const patterns = [
  /routing[\s_-]*(number|num|no)\b/i,
  /routingNumber/i,
  /account[\s_-]*number/i,
  /accountNumber/i,
  /\bssn\b/i,
  /social[\s_-]*security/i,
  /date[\s_-]*of[\s_-]*birth/i,
  /dateOfBirth/i,
  /birth[\s_-]*date/i,
  /\bdob\b/i,
  /(?<!employer)tax[\s_-]*id\b/i,
  /government[\s_-]*id[\s_-]*(number|num|no)\b/i,
];

const allow = JSON.parse(readFileSync(join(root, "scripts/sensitive-data-allowlist.json"), "utf8"));
const allowed = (rel) => allow.paths.some((a) => rel === a.path || (a.path.endsWith("/") && rel.startsWith(a.path)));

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (skipDirs.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (exts.test(name)) yield full;
  }
}

const hits = [];
const notUtf8 = [];
const utf8 = new TextDecoder("utf-8", { fatal: true });
for (const r of scanRoots) {
  for (const file of walk(join(root, r))) {
    const rel = relative(root, file).split(sep).join("/");
    let text;
    try {
      // Every source file must be valid UTF-8 (a legacy-encoded file would hide matches as U+FFFD).
      text = utf8.decode(readFileSync(file));
    } catch {
      notUtf8.push(rel);
      continue;
    }
    if (allowed(rel) || rel.endsWith("package.json")) continue;
    text
      .split("\n")
      .forEach((line, i) => {
        if (patterns.some((p) => p.test(line))) hits.push(`${rel}:${i + 1}: ${line.trim().slice(0, 120)}`);
      });
  }
}

if (notUtf8.length) {
  console.error("Sensitive-data gate FAILED. These files are not valid UTF-8:\n");
  for (const f of notUtf8) console.error("  " + f);
  process.exit(1);
}

if (hits.length) {
  console.error("Sensitive-data gate FAILED. The GMS must not model bank or identity numbers:\n");
  for (const h of hits) console.error("  " + h);
  console.error("\nIf this is the log redactor, add it to scripts/sensitive-data-allowlist.json with a reason.");
  process.exit(1);
}
console.log("Sensitive-data gate passed.");
