// SPDX-License-Identifier: AGPL-3.0-only
// `gms export` / `gms import`, runnable from the repository root:
//   node --experimental-transform-types scripts/gms.ts export --workspace <id|handle>
// The command itself lives with the API Worker so it shares the service layer.
import "../apps/api/scripts/gms.ts";
