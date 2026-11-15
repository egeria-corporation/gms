// SPDX-License-Identifier: AGPL-3.0-only
// Writes the OpenGrants starter library (src/services/gallery-starters.ts) into the two places
// that carry it as data: the insert at the end of supabase/migrations/0036_template_gallery.sql and
// the mock-mode fixture apps/web/src/mocks/galleryStarters.json. A test fails when either drifts.
//
//   node --experimental-strip-types apps/api/scripts/gallery-starters.ts
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { STARTER_ITEMS, STARTERS_PUBLISHED_AT } from "../src/services/gallery-starters.ts";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const MIGRATION = `${root}supabase/migrations/0036_template_gallery.sql`;
const FIXTURE = `${root}apps/web/src/mocks/galleryStarters.json`;

/** The SQL that goes between the `starters:begin` and `starters:end` markers. */
export function startersSql(): string {
  const json = JSON.stringify(STARTER_ITEMS, null, 1);
  if (json.includes("$starters$")) throw new Error("The starter content may not contain the SQL quote tag");
  return [
    "insert into public.gallery_items (id, slug, kind, title, summary, tags, author_workspace_id, version, snapshot, published_at)",
    `select s.id, s.slug, s.kind, s.title, s.summary, s.tags, null, 1, s.snapshot, '${STARTERS_PUBLISHED_AT}'::timestamptz`,
    "  from pg_catalog.jsonb_to_recordset($starters$",
    json,
    "$starters$::jsonb) as s(id uuid, slug text, kind text, title text, summary text, tags jsonb, snapshot jsonb)",
    "on conflict do nothing;",
  ].join("\n");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const sql = readFileSync(MIGRATION, "utf8");
  const next = sql.replace(/-- starters:begin\n[\s\S]*?-- starters:end/, `-- starters:begin\n${startersSql()}\n-- starters:end`);
  if (next === sql && !sql.includes("-- starters:begin")) throw new Error("starters markers not found in the migration");
  writeFileSync(MIGRATION, next);
  writeFileSync(FIXTURE, `${JSON.stringify({ publishedAt: STARTERS_PUBLISHED_AT, items: STARTER_ITEMS }, null, 2)}\n`);
  console.log(`wrote ${STARTER_ITEMS.length} starter items`);
}
