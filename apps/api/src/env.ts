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
  /** Where people use Passport in a browser (its web app), for links. The API lives at PASSPORT_BASE_URL. */
  PASSPORT_WEB_URL?: string;
  PASSPORT_ISSUER?: string;
  PASSPORT_GMS_CLIENT_ID?: string;
  PASSPORT_GMS_CLIENT_SECRET?: string;
  PASSPORT_WEBHOOK_SECRET?: string;
  /** Set only while the deploy tool registers this instance with Passport: the text served at /.well-known/opengrants-passport-challenge. */
  PASSPORT_REGISTRATION_CHALLENGE?: string;
  /** "true" adds `payee:read` to the applicant consent (see docs/payments.md). Default off. */
  PASSPORT_APPLICANT_PAYEE_READ?: string;
  /** "true" once Passport serves the funder award routes (award:write); awards are mirrored on acceptance. */
  PASSPORT_AWARD_WRITE?: string;
  /** "true" lets the GMS release payments through Passport. Off by default: payments are recorded after being paid elsewhere. */
  PAYMENTS_FACILITATED?: string;

  CREDENTIALS_ENCRYPTION_KEY?: string;
  WEBHOOK_SECRET_KEY?: string;

  /** OpenGrants REST API base (default https://ops.opengrants.io/functions/v1). Funding search is on when OPENGRANTS_API_KEY is set. */
  OPENGRANTS_API_URL?: string;
  OPENGRANTS_API_KEY?: string;
  COMPOSIO_API_KEY?: string;
  COMPOSIO_GOOGLE_AUTH_CONFIG_ID?: string;
  RESEND_API_KEY?: string;
  RESEND_FROM?: string;
  RESEND_INBOUND_SECRET?: string;
  /** Domain of the inbound reply address; defaults to the domain of RESEND_FROM. */
  RESEND_INBOUND_DOMAIN?: string;
  /** Where consulting requests from outside applications go (default hello@agents.opengrants.io; on on every install). */
  CONSULTING_REQUEST_TO?: string;
  ANTHROPIC_API_KEY?: string;
  ASSISTANT_ENABLED?: string;
  ASSISTANT_MODEL?: string;

  /** Static assets of this Worker (the compiled OpenAPI document). */
  ASSETS?: Fetcher;
  ATTACHMENTS?: R2Bucket;
  LEDGER_ARCHIVE?: R2Bucket;
  EXPORTS?: R2Bucket;
  GMS_EVENTS?: Queue;
  RATE_LIMIT?: KVNamespace;
  /** "true" only behind a proxy you run that sets X-Forwarded-For; otherwise only CF-Connecting-IP is trusted. */
  TRUSTED_PROXY?: string;
}

export const trimSlash = (s: string) => s.replace(/\/+$/, "");
