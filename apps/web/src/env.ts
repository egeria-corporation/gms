// SPDX-License-Identifier: AGPL-3.0-only
// Build-time configuration. Mock mode is the default until an API is configured, so a fresh clone
// renders the fixture workspaces with `pnpm dev:web` and nothing else running.

const raw = import.meta.env;

const trim = (v: string | undefined) => (v ?? "").trim().replace(/\/+$/, "");

export const env = {
  apiBaseUrl: trim(raw.VITE_API_BASE_URL),
  supabaseUrl: trim(raw.VITE_SUPABASE_URL),
  supabaseAnonKey: (raw.VITE_SUPABASE_ANON_KEY ?? "").trim(),
  passportBaseUrl: trim(raw.VITE_PASSPORT_BASE_URL) || "https://passport.opengrants.io",
  /** True unless VITE_USE_MOCKS is "false" and both an API and a Supabase project are configured. */
  useMocks: raw.VITE_USE_MOCKS !== "false" || !trim(raw.VITE_API_BASE_URL) || !trim(raw.VITE_SUPABASE_URL),
} as const;
