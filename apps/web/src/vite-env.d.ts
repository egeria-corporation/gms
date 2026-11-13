/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  readonly VITE_PASSPORT_BASE_URL?: string;
  readonly VITE_PASSPORT_WEB_URL?: string;
  readonly VITE_USE_MOCKS?: string;
  readonly VITE_GOOGLE_PICKER_API_KEY?: string;
  readonly VITE_GOOGLE_OAUTH_CLIENT_ID?: string;
  readonly VITE_USERBACK_TOKEN?: string;
}
