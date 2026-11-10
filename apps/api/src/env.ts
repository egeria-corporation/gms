// SPDX-License-Identifier: AGPL-3.0-only
// Worker bindings and variables (build spec §7). Names only; values come from Wrangler secrets or
// `.dev.vars`. Everything beyond the OAuth and origin settings is optional so the Worker boots (and
// answers 503 where it must) on a partly configured self-hosted install.

export interface Env {
  GMS_BASE_URL: string;
  WEB_BASE_URL: string;

  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  SUPABASE_ANON_KEY?: string;
  SUPABASE_JWT_SECRET?: string;

  OAUTH_ISSUER: string;
  OAUTH_KID: string;
  OAUTH_SIGNING_KEY_JWK: string;
  JWKS_EXTRA_PUBLIC_KEYS?: string;
  /** Comma-separated extra HTTPS hosts allowed as redirect targets for dynamically registered clients. */
  OAUTH_DCR_REDIRECT_HOSTS?: string;

  PASSPORT_BASE_URL?: string;
  PASSPORT_ISSUER?: string;
  PASSPORT_GMS_CLIENT_ID?: string;
  PASSPORT_GMS_CLIENT_SECRET?: string;
  PASSPORT_WEBHOOK_SECRET?: string;

  CREDENTIALS_ENCRYPTION_KEY?: string;
  WEBHOOK_SECRET_KEY?: string;

  OPENGRANTS_MCP_URL?: string;
  OPENGRANTS_API_KEY?: string;
  COMPOSIO_API_KEY?: string;
  COMPOSIO_GOOGLE_AUTH_CONFIG_ID?: string;
  RESEND_API_KEY?: string;
  RESEND_FROM?: string;
  RESEND_INBOUND_SECRET?: string;
  ANTHROPIC_API_KEY?: string;
  ASSISTANT_ENABLED?: string;
  ASSISTANT_MODEL?: string;

  ATTACHMENTS?: R2Bucket;
  LEDGER_ARCHIVE?: R2Bucket;
  EXPORTS?: R2Bucket;
  GMS_EVENTS?: Queue;
  RATE_LIMIT?: KVNamespace;
}

export const trimSlash = (s: string) => s.replace(/\/+$/, "");
