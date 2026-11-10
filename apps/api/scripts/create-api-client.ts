// SPDX-License-Identifier: AGPL-3.0-only
// Create a workspace API client (OAuth client credentials) from the command line.
//
//   node --experimental-transform-types scripts/create-api-client.ts --workspace <id|handle> --name "Board dashboard" --scopes applications:read,awards:read
//
// Prints the client id and the secret once; only a hash of the secret is stored. Runs with the
// service-role key, so it is for the instance operator. Workspace admins create clients in
// Settings (`POST /gms/api-clients`) instead.
import { createClient } from "@supabase/supabase-js";
import { generateClientSecret, hashSecret } from "../src/auth/crypto.ts";
import { DYNAMIC_CLIENT_SCOPES, isScope } from "../src/auth/scopes.ts";

function fail(message: string): never {
  console.error(`create-api-client: ${message}`);
  process.exit(1);
}
const flags: Record<string, string> = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) if (argv[i]!.startsWith("--")) flags[argv[i]!.slice(2)] = argv[++i] ?? "";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) fail("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
if (!flags.workspace || !flags.name || !flags.scopes) fail('usage: --workspace <id|handle> --name "<name>" --scopes scope[,scope...] [--admin]');

const scopes = [...new Set(flags.scopes.split(",").map((s) => s.trim()).filter(Boolean))];
const unknown = scopes.filter((s) => !isScope(s));
if (unknown.length) fail(`unknown scope(s): ${unknown.join(", ")}`);
// workspace:admin is powerful; it has to be asked for by name twice.
if (scopes.includes("workspace:admin") && flags.admin === undefined) fail("workspace:admin needs --admin as well. Other scopes: " + DYNAMIC_CLIENT_SCOPES.join(", "));

const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const ref = flags.workspace;
const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ref);
const { data: ws, error: wsError } = await db.from("workspaces").select("id, display_name").eq(isUuid ? "id" : "handle", ref).maybeSingle();
if (wsError) fail("the database could not be reached");
if (!ws) fail(`no workspace "${ref}"`);

const secret = generateClientSecret();
const { data, error } = await db.from("api_clients").insert({ workspace_id: ws.id, name: flags.name, client_secret_hash: await hashSecret(secret), allowed_scopes: scopes }).select("id").single();
if (error) fail("the client could not be created");
await db.from("ledger_events").insert({ workspace_id: ws.id, actor: "system:cli", event_type: "api_client.created", subject_type: "api_client", subject_id: data.id, data: { name: flags.name, scopes } });

console.log(`API client for ${ws.display_name}\n`);
console.log(`client_id:     ${data.id}`);
console.log(`client_secret: ${secret}`);
console.log(`scopes:        ${scopes.join(" ")}`);
console.log("\nThe secret is shown once. Store it now; only its hash is kept.");
