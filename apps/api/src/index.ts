// SPDX-License-Identifier: AGPL-3.0-only
// Worker entry: wires Supabase-backed stores. The service-role client is created once per isolate;
// every store query filters by workspace explicitly (RLS is on for every table regardless).
import { SupabaseLedgerStore } from "@gms/ledger";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createApp, type Deps } from "./app.ts";
import { SupabaseAuthStore, SupabaseMembershipStore } from "./auth/supabase-store.ts";
import type { Env } from "./env.ts";

let cached: { key: string; db: SupabaseClient; deps: Deps } | undefined;

function depsFor(env: Env): Deps | null {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return null;
  const key = `${env.SUPABASE_URL}|${env.SUPABASE_SERVICE_ROLE_KEY.length}`;
  if (!cached || cached.key !== key) {
    const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    cached = { key, db, deps: { auth: new SupabaseAuthStore(db), members: new SupabaseMembershipStore(db), ledger: new SupabaseLedgerStore(db), now: () => new Date() } };
  }
  return cached.deps;
}

const app = createApp(depsFor);

export default { fetch: app.fetch } satisfies ExportedHandler<Env>;
