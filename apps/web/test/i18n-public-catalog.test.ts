// @vitest-environment node
// SPDX-License-Identifier: AGPL-3.0-only
// The `public` catalog is a chunk of its own, loaded only with the public screens (docs/i18n.md).
// So every public route waits for it (publicScreen in app/App.tsx), and every other screen that
// shows a public screen's part waits for it too (usePublicMessages), or that part would show keys.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const src = fileURLToPath(new URL("../src/", import.meta.url));
const files = (dir: string): string[] => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? files(join(dir, n)) : /\.tsx?$/.test(n) ? [join(dir, n)] : []));
// The code without its comments (a comment may name `translator("public")`).
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const all = files(src).map((f) => ({ path: relative(src, f).split("\\").join("/"), code: code(readFileSync(f, "utf8")) }));
const isPublic = (path: string) => path.startsWith("screens/public/");

// Code outside the public screens that reads `public` messages itself: each runs only where they are
// loaded (the front Worker loads its catalogs per request; the switch pages' content and the landing
// page's Userback answer are read by public screens alone).
const READS_PUBLIC_OUTSIDE = ["edge/meta.ts", "content/switch.ts", "lib/userback.ts", "i18n/index.tsx", "i18n/current.ts"];

describe("the public catalog", () => {
  it("is waited for by every public route", () => {
    const app = all.find((f) => f.path === "app/App.tsx")!.code;
    const routes = [...app.matchAll(/^const \w+ = (\w+)\(\(\) => import\("\.\.\/screens\/public\/[^"]+"\)\);$/gm)];
    expect(routes.length).toBeGreaterThan(20);
    expect(routes.filter((m) => m[1] !== "publicScreen").map((m) => m[0])).toEqual([]);
    // No public screen is imported any other way.
    expect(app.match(/screens\/public\//g)?.length).toBe(routes.length);
  });

  it("is waited for by every other screen that borrows a public screen's part", () => {
    const borrowers = all.filter((f) => !isPublic(f.path) && /from "(\.\.\/)+public\/|from "\.\.\/screens\/public\//.test(f.code));
    expect(borrowers.length).toBeGreaterThan(0);
    expect(borrowers.filter((f) => !f.code.includes("usePublicMessages();")).map((f) => f.path)).toEqual([]);
  });

  it("is read outside the public screens only where it is loaded", () => {
    const readers = all.filter((f) => !isPublic(f.path) && /translator\("public"\)|useT\("public"\)|translate\("public"|Key<"public">/.test(f.code)).map((f) => f.path);
    expect(readers.filter((p) => !READS_PUBLIC_OUTSIDE.includes(p))).toEqual([]);
  });
});
