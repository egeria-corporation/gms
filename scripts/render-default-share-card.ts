// SPDX-License-Identifier: AGPL-3.0-only
// Draws the default share card, apps/web/public/brand/og-preview.png: what index.html gives a link
// preview when nothing more specific is set. Run it after changing LANDING_CARD or the card's design:
//
//   node scripts/render-default-share-card.ts [--site gms.opengrants.io]
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadCardAssets, renderCard } from "../apps/web/src/edge/og/card.ts";
import { landingCard } from "../apps/web/src/edge/meta.ts";

const i = process.argv.indexOf("--site");
const site = i > 0 && process.argv[i + 1] ? process.argv[i + 1] : "gms.opengrants.io";
const pub = fileURLToPath(new URL("../apps/web/public", import.meta.url));
const assets = await loadCardAssets((path) => new Uint8Array(readFileSync(`${pub}${path}`)));
const png = await renderCard(landingCard(site), assets);
writeFileSync(`${pub}/brand/og-preview.png`, png);
console.log(`apps/web/public/brand/og-preview.png: ${png.length} bytes`);
