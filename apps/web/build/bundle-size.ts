// SPDX-License-Identifier: AGPL-3.0-only
// What an English visitor downloads: the gzipped size of the built app's scripts and styles, with
// the Spanish catalogs left out (they load only when someone picks Spanish). `initial` is what the
// first page needs (the entry and what it preloads); `total` is every chunk a screen can load.
// test/bundle-size.test.ts holds the growth from internationalization under its budget.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

export interface BundleSize {
  initial: number;
  total: number;
  /** Chunks holding Spanish catalogs (excluded from both numbers). */
  spanish: string[];
}

const gz = (file: string) => gzipSync(readFileSync(file), { level: 9 }).length;

/** A chunk is Spanish when it is a catalog chunk built from catalogs/es (Vite names it after the file, e.g. `public-<hash>.js`, and it is only ever imported dynamically). */
export function measureBundle(outDir: string, isSpanish: (file: string, source: string) => boolean): BundleSize {
  const assets = join(outDir, "assets");
  const files = readdirSync(assets).filter((f) => /\.(js|css)$/.test(f));
  const html = readFileSync(join(outDir, "index.html"), "utf8");
  const referenced = new Set(Array.from(html.matchAll(/(?:src|href)="\/assets\/([^"]+)"/g), (m) => m[1]!));
  const spanish: string[] = [];
  let initial = 0;
  let total = 0;
  for (const f of files) {
    const path = join(assets, f);
    if (f.endsWith(".js") && isSpanish(f, readFileSync(path, "utf8"))) {
      spanish.push(f);
      continue;
    }
    const size = gz(path);
    total += size;
    if (referenced.has(f)) initial += size;
  }
  return { initial, total, spanish };
}
