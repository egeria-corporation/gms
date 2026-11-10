// SPDX-License-Identifier: AGPL-3.0-only
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types.ts";

/** A Supabase client typed against the GMS schema. */
export type DbClient = SupabaseClient<Database>;

export interface ServiceEnv {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
}

/**
 * Service-role client for Workers and jobs. The service role bypasses RLS, so every query must
 * still filter by workspace: use {@link forWorkspace} for workspace-owned tables.
 *
 * - No session persistence or token refresh (stateless Worker isolates).
 * - `fetch` is wrapped so it is always called unbound, which Workers require.
 * - Errors here never echo env values.
 */
export function createServiceClient(env: ServiceEnv): DbClient {
  const url = env.SUPABASE_URL?.trim();
  const key = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url) throw new Error("SUPABASE_URL is not set");
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("SUPABASE_URL is not a valid URL");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("SUPABASE_URL must be an http(s) URL");
  }

  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      fetch: (input, init) => fetch(input, init),
      headers: { "x-client-info": "gms-db" },
    },
  });
}
