// SPDX-License-Identifier: AGPL-3.0-only
// The `gms` operator CLI: export a funder workspace as a bundle, or import one.
//
//   node --experimental-transform-types scripts/gms.ts export --workspace <id|handle> [--out ./export]
//   node --experimental-transform-types scripts/gms.ts import <dir> --workspace <id|handle>
//
// Runs with the service-role key (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY in the environment), so
// it is for whoever operates the instance. Export calls the same service code as
// `POST /gms/exports/bundle`; import has no route (a workspace can never call it) and writes only
// inside the workspace named here. Each run is ledgered as `system:cli`.
//
// A bundle is three files:
//   commongrants.json          opportunities, competitions, forms, applications, awards, org references
//   gms.json                   everything else, plus the workspace's own rows for an exact restore
//   attachments/manifest.json  name, size, SHA-256 and a download URL valid for 24 hours per file
// File bytes are not in the bundle. Files kept in the Passport locker are listed by reference only.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { DbClient } from "@gms/db";
import { SupabaseLedgerStore } from "@gms/ledger";
import { SupabaseWebhookStore } from "@gms/webhooks";
import { createClient } from "@supabase/supabase-js";
import { exportWorkspaceBundle, importWorkspaceBundle, SupabaseRepos, type BaseContext } from "../src/jobs.ts";

const SIGNED_URL_SECONDS = 24 * 60 * 60;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(message: string): never {
  console.error(`gms: ${message}`);
  process.exit(1);
}

function parseArgs(argv: string[]) {
  const flags: Record<string, string> = {};
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith("--")) flags[a.slice(2)] = argv[++i] ?? "";
    else positional.push(a);
  }
  return { command: positional[0], rest: positional.slice(1), flags };
}

const USAGE = `Usage:
  gms export --workspace <id|handle> [--out <dir>]
  gms import <dir> --workspace <id|handle>

Environment: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (and GMS_BASE_URL, WEB_BASE_URL for links).`;

const { command, rest, flags } = parseArgs(process.argv.slice(2));
if (!command || command === "help" || flags.help !== undefined) {
  console.log(USAGE);
  process.exit(command ? 0 : 1);
}
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) fail("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
if (!flags.workspace) fail(`--workspace is required\n\n${USAGE}`);

const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const trim = (s: string | undefined, fallback: string) => (s ?? fallback).replace(/\/+$/, "");
const base: BaseContext = {
  repos: new SupabaseRepos(db as unknown as DbClient),
  ledger: new SupabaseLedgerStore(db),
  webhooks: new SupabaseWebhookStore(db),
  now: () => new Date(),
  config: { baseUrl: trim(process.env.GMS_BASE_URL, "http://localhost:8787"), webBaseUrl: trim(process.env.WEB_BASE_URL, "http://localhost:5173"), passportBaseUrl: null, credentialsKey: null, passportClient: null, mailFrom: null },
  ports: {},
};

async function workspaceId(ref: string): Promise<string> {
  const row = await base.repos.table("workspaces").one(UUID.test(ref) ? { id: ref } : { handle: ref });
  if (!row) fail(`no workspace "${ref}"`);
  return row.id;
}

if (command === "export") {
  const out = flags.out || "./gms-export";
  const result = await exportWorkspaceBundle(base, await workspaceId(flags.workspace));
  const files = (result.bundle ?? {}) as Record<string, unknown>;
  type Entry = { storage: string; path: string; passportDocumentId: string | null; url?: string | null; urlExpiresAt?: string | null; note?: string };
  const manifest = (files["attachments/manifest.json"] ?? []) as Entry[];
  const expires = new Date(Date.now() + SIGNED_URL_SECONDS * 1000).toISOString();
  for (const entry of manifest) {
    if (entry.passportDocumentId) {
      entry.url = null;
      entry.note = "Held in the organization's Passport locker; referenced, never copied";
    } else if (entry.storage === "supabase") {
      const { data, error } = await db.storage.from("attachments").createSignedUrl(entry.path, SIGNED_URL_SECONDS);
      entry.url = error ? null : data.signedUrl;
      entry.urlExpiresAt = error ? null : expires;
      if (error) entry.note = "A download URL could not be signed for this file";
    } else {
      entry.url = null;
      entry.note = "Stored in R2: fetch with `wrangler r2 object get <bucket>/<path>`";
    }
  }
  await mkdir(join(out, "attachments"), { recursive: true });
  for (const [name, body] of Object.entries(files)) await writeFile(join(out, name), `${JSON.stringify(body, null, 2)}\n`);
  console.log(`Exported to ${out}`);
  for (const [k, v] of Object.entries(result.counts)) console.log(`  ${k}: ${v}`);
} else if (command === "import") {
  const dir = rest[0];
  if (!dir) fail(`import needs the bundle directory\n\n${USAGE}`);
  let gms: unknown;
  try {
    gms = JSON.parse(await readFile(join(dir, "gms.json"), "utf8"));
  } catch {
    fail(`could not read ${join(dir, "gms.json")}`);
  }
  const result = await importWorkspaceBundle(base, await workspaceId(flags.workspace), { gms });
  console.log(`Imported: ${result.inserted} inserted, ${result.existing} already present, ${result.skipped} skipped`);
  for (const [table, c] of Object.entries(result.counts)) if (c.inserted || c.skipped) console.log(`  ${table}: +${c.inserted}${c.skipped ? `, ${c.skipped} skipped` : ""}`);
  if (result.skipped) console.log("Skipped rows depend on an applicant workspace that is not on this instance (it joins when the organization connects Passport here).");
} else {
  fail(`unknown command "${command}"\n\n${USAGE}`);
}
