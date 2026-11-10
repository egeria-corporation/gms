// SPDX-License-Identifier: AGPL-3.0-only
// Worker entry: wires Supabase-backed stores. The service-role client is created once per isolate;
// every store query filters by workspace explicitly (RLS is on for every table regardless).
import type { DbClient } from "@gms/db";
import { SupabaseLedgerStore } from "@gms/ledger";
import { SupabaseWebhookStore } from "@gms/webhooks";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createApp, type Deps } from "./app.ts";
import { SupabaseAuthStore } from "./auth/supabase-store.ts";
import type { Env } from "./env.ts";
import { RepoMembershipStore } from "./services/repos/membership.ts";
import { SupabaseRepos } from "./services/repos/supabase.ts";

let cached: { key: string; db: SupabaseClient; deps: Deps } | undefined;

function depsFor(env: Env): Deps | null {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return null;
  const key = `${env.SUPABASE_URL}|${env.SUPABASE_SERVICE_ROLE_KEY.length}`;
  if (!cached || cached.key !== key) {
    const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const repos = new SupabaseRepos(db as unknown as DbClient);
    cached = {
      key,
      db,
      deps: {
        auth: new SupabaseAuthStore(db),
        members: new RepoMembershipStore(repos),
        ledger: new SupabaseLedgerStore(db),
        repos,
        webhooks: new SupabaseWebhookStore(db),
        now: () => new Date(),
        openapi,
      },
    };
  }
  return cached.deps;
}

/** The compiled OpenAPI document ships as a static asset (`pnpm --filter @gms/api build:openapi`). */
async function openapi(env: Env): Promise<unknown | null> {
  const res = await env.ASSETS?.fetch(new Request("https://assets.local/openapi.json"));
  return res?.ok ? ((await res.json()) as unknown) : null;
}

const app = createApp(depsFor);

export default { fetch: app.fetch } satisfies ExportedHandler<Env>;
