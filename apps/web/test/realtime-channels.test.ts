// SPDX-License-Identifier: AGPL-3.0-only
// Every Supabase Realtime channel the GMS opens is private (Realtime Authorization, migration 0050),
// so turning off Realtime's "Allow public access" breaks nothing and no public channel can carry a
// draft's presence (docs/co-editing.md, docs/self-host.md step 7). Read from the source of every app
// and package: each `.channel(` call must ask for `private: true` in its options, nothing may
// construct a RealtimeChannel by hand, and nothing may subscribe to `postgres_changes` (table changes
// reach the browser through the API, which checks access on every read).
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// Run from the repository root or from apps/web.
const ROOT = [process.cwd(), join(process.cwd(), "../..")].find((d) => existsSync(join(d, "apps/web/src/app/App.tsx")))!;
const SOURCE_DIRS = ["apps", "packages"];
const SKIP = new Set(["node_modules", "dist", "build", "test", "tests", "e2e", "coverage", ".wrangler"]);

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name) || name.startsWith(".")) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sources(path, out);
    else if (/\.(ts|tsx|js|mjs)$/.test(name) && !/\.(test|spec)\.[a-z]+$/.test(name) && !name.endsWith(".d.ts")) out.push(path);
  }
  return out;
}

/** The text between the parenthesis at `open` and its match. */
function argsAt(text: string, open: number): string {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")" && --depth === 0) return text.slice(open + 1, i);
  }
  return text.slice(open + 1);
}

const files = SOURCE_DIRS.flatMap((d) => sources(join(ROOT, d)));
const where = (file: string, text: string, index: number) => `${relative(ROOT, file)}:${text.slice(0, index).split("\n").length}`;

describe("Supabase Realtime channels", () => {
  const channels: { at: string; args: string }[] = [];
  const handMade: string[] = [];
  const tableChanges: string[] = [];
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(/(?<=[\w)\]])\.channel\s*\(/g)) channels.push({ at: where(file, text, m.index), args: argsAt(text, m.index + m[0].length - 1) });
    for (const m of text.matchAll(/new\s+RealtimeChannel\s*\(/g)) handMade.push(where(file, text, m.index));
    for (const m of text.matchAll(/postgres_changes/g)) tableChanges.push(where(file, text, m.index));
  }

  it("finds the channels it checks (the drafts' live channel at least)", () => {
    expect(files.length).toBeGreaterThan(100);
    expect(channels.some((c) => c.at.startsWith("apps/web/src/lib/presence.ts:"))).toBe(true);
  });

  it("opens every channel as a private one", () => {
    const open = channels.filter((c) => !/\bprivate\s*:\s*true\b/.test(c.args)).map((c) => `${c.at} ${c.args.replace(/\s+/g, " ").slice(0, 120)}`);
    expect(open, "a channel without `config: { private: true }` would be public: Realtime's 'Allow public access' is off").toEqual([]);
  });

  it("never builds a channel by hand or listens for table changes", () => {
    expect(handMade).toEqual([]);
    expect(tableChanges).toEqual([]);
  });
});
