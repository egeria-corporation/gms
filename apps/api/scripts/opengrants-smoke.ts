// SPDX-License-Identifier: AGPL-3.0-only
// Live smoke test of the OpenGrants REST client: one search and one match against the real API.
//
//   cd apps/api && OPENGRANTS_API_KEY=<key> node --experimental-transform-types scripts/opengrants-smoke.ts
//
// Prints counts and the first title of each; never the key.
import { RestOpenGrantsClient } from "../src/services/ports.ts";

const key = process.env.OPENGRANTS_API_KEY;
if (!key) {
  console.error("Set OPENGRANTS_API_KEY.");
  process.exit(2);
}
const client = new RestOpenGrantsClient(process.env.OPENGRANTS_API_URL ?? "https://ops.opengrants.io/functions/v1", key);
const org = { region: "CA", orgType: "nonprofit", mission: "Community health clinics for rural families" };

const search = await client.call("search", { query: "community health" }, org);
console.log(`search: ${search.items.length} listings; first: ${JSON.stringify(search.items[0] ?? null)}`);
const match = await client.call("match", {}, org);
console.log(`match: ${match.items.length} listings; first: ${JSON.stringify(match.items[0] ?? null)}`);
if (search.items.length === 0 || match.items.length === 0) process.exit(1);
