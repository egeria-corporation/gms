// SPDX-License-Identifier: AGPL-3.0-only
// Builds the adapter set for the current environment. Selection mirrors scripts/lib/detect.ts exactly, and every
// dependency has a fake so a missing credential never blocks the app. Real mailers are always wrapped by the
// allowlist guard outside production deploys.
import { getDb, type Database } from '@gms/db';
import { SupabaseAuthAdapter } from './auth/supabase-auth';
import { TestAuthAdapter } from './auth/test-auth';
import { StubBilling } from './billing/stub';
import { isProductionDeploy } from './crypto';
import { FixtureDiligenceSource } from './diligence/fixtures';
import { LiveDiligenceSource } from './diligence/import';
import type { FetchLike } from './http';
import { AnthropicLlm } from './llm/anthropic';
import { FakeLlm } from './llm/fake';
import { OpenAiLlm } from './llm/openai';
import { DevOutboxMailer } from './mail/dev-outbox';
import { GuardedMailer } from './mail/guard';
import { ResendMailer } from './mail/resend';
import { SmtpMailer } from './mail/smtp';
import { RailConfigurationError } from './payments/common';
import { FakeMercury } from './payments/fake-mercury';
import { ManualRail } from './payments/manual';
import { MercuryRail } from './payments/mercury';
import { ClamAvScanner } from './scanner/clamav';
import { NoopScanner } from './scanner/noop';
import { AesSecretStore } from './secrets/aes';
import { VaultSecretStore } from './secrets/vault';
import { LocalStorage } from './storage/local';
import { SupabaseStorage } from './storage/supabase';
import type { AuthAdapter, BillingAdapter, DiligenceSource, LLMProvider, Mailer, PaymentRail, Scanner, SecretStore, Storage } from './types';

export interface AdapterSet {
  mailer: Mailer;
  storage: Storage;
  scanner: Scanner;
  secrets: SecretStore;
  llm: LLMProvider | null;
  auth: AuthAdapter;
  diligence: DiligenceSource;
  billing: BillingAdapter;
}

export interface CreateAdaptersOptions {
  db?: () => Database;
  env?: NodeJS.ProcessEnv;
  fetch?: FetchLike;
}

export function createMailer(db: () => Database, env: NodeJS.ProcessEnv = process.env, fetchImpl?: FetchLike): Mailer {
  const outbox = new DevOutboxMailer(db);
  let real: Mailer | null = null;
  if (env.RESEND_API_KEY) real = new ResendMailer({ apiKey: env.RESEND_API_KEY, fetch: fetchImpl });
  else if (env.SMTP_URL) real = new SmtpMailer({ url: env.SMTP_URL });
  if (!real) return outbox;
  const production = env === process.env ? isProductionDeploy() : env.GMS_ENV === 'production' || env.CONTEXT === 'production';
  if (production) return real;
  return new GuardedMailer(real, outbox, { production: false, allowlist: (env.GMS_EMAIL_ALLOWLIST ?? '').split(/[,\s]+/).filter(Boolean) });
}

export function createAdapters(opts: CreateAdaptersOptions = {}): AdapterSet {
  const env = opts.env ?? process.env;
  const db = opts.db ?? (() => getDb());
  const mailer = createMailer(db, env, opts.fetch);

  const storage: Storage =
    env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY
      ? new SupabaseStorage({ url: env.SUPABASE_URL, serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY })
      : new LocalStorage();

  const scanner: Scanner = env.CLAMAV_HOST ? ClamAvScanner.fromEnv(env.CLAMAV_HOST) : new NoopScanner();
  const secrets: SecretStore = env.GMS_SECRET_STORE === 'vault' ? new VaultSecretStore(db) : new AesSecretStore(db);

  let llm: LLMProvider;
  if (env.ANTHROPIC_API_KEY) llm = new AnthropicLlm({ apiKey: env.ANTHROPIC_API_KEY, model: env.GMS_LLM_MODEL, fetch: opts.fetch });
  else if (env.OPENAI_API_KEY) llm = new OpenAiLlm({ apiKey: env.OPENAI_API_KEY, model: env.GMS_LLM_MODEL, baseUrl: env.OPENAI_BASE_URL, fetch: opts.fetch });
  else llm = new FakeLlm();

  const auth: AuthAdapter =
    env.GMS_AUTH_MODE === 'test' || !env.SUPABASE_URL
      ? new TestAuthAdapter({ db, mailer })
      : new SupabaseAuthAdapter({
          url: env.SUPABASE_URL,
          anonKey: env.SUPABASE_ANON_KEY ?? env.SUPABASE_PUBLISHABLE_KEY ?? env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
          serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
          mailer,
          db,
        });

  const diligence: DiligenceSource = env.GMS_DILIGENCE_SOURCE === 'live' ? new LiveDiligenceSource({ fetch: opts.fetch }) : new FixtureDiligenceSource();

  return { mailer, storage, scanner, secrets, llm, auth, diligence, billing: new StubBilling() };
}

/**
 * The payment rail for a workspace, from its latest active bank_connections row:
 *   manual → ManualRail · mercury/fake → FakeMercury · mercury/sandbox → MercuryRail (token from the SecretStore)
 *   mercury/production → refused unless MERCURY_ENV=production and GMS_ALLOW_MERCURY_PRODUCTION=true.
 * Returns null when the workspace has no bank connection.
 */
export async function paymentRailFor(
  workspaceId: string,
  db: Database,
  secrets: SecretStore,
  opts: { fetch?: FetchLike; env?: NodeJS.ProcessEnv } = {},
): Promise<PaymentRail | null> {
  const conn = await db
    .selectFrom('bank_connections')
    .select(['provider', 'environment', 'secret_ref'])
    .where('workspace_id', '=', workspaceId)
    .where('status', '!=', 'disconnected')
    .orderBy('created_at', 'desc')
    .limit(1)
    .executeTakeFirst();
  if (!conn) return null;
  if (conn.provider === 'manual') return new ManualRail();
  if (conn.provider !== 'mercury') throw new RailConfigurationError(`unknown payment provider: ${conn.provider}`);
  if (conn.environment === 'fake') return new FakeMercury({ workspaceId, db });
  if (conn.environment !== 'sandbox' && conn.environment !== 'production') {
    throw new RailConfigurationError(`unknown Mercury environment: ${conn.environment}`);
  }
  if (!conn.secret_ref) throw new RailConfigurationError('The Mercury connection has no API token; reconnect the bank.');
  const token = await secrets.get(conn.secret_ref);
  if (!token) throw new RailConfigurationError('The Mercury API token could not be read from the secret store; reconnect the bank.');
  // MercuryRail enforces the production double opt-in in its constructor.
  return new MercuryRail({ token, environment: conn.environment, fetch: opts.fetch, env: opts.env });
}
