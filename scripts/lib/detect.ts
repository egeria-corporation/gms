// SPDX-License-Identifier: AGPL-3.0-only
// Capability detection shared by `pnpm doctor` and `pnpm db:up`.
import { execSync } from 'node:child_process';
import { loadDotEnv } from '../../packages/db/src/env';

export type DbTier = 'supabase-local' | 'supabase-remote' | 'embedded';

function cmdOk(cmd: string, timeoutMs = 8000): string | null {
  try {
    return execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'], timeout: timeoutMs }).toString().trim();
  } catch {
    return null;
  }
}

export function dockerAvailable(): boolean {
  return cmdOk('docker info --format "{{.ServerVersion}}"') !== null;
}

export function supabaseCliVersion(): string | null {
  return cmdOk('supabase --version');
}

export async function detectDbTier(): Promise<{ tier: DbTier; reason: string }> {
  loadDotEnv();
  const forced = process.env.GMS_DB_TIER as DbTier | undefined;
  if (forced) return { tier: forced, reason: 'forced by GMS_DB_TIER' };
  if (process.env.SUPABASE_DB_URL || (process.env.DATABASE_URL && !/127\.0\.0\.1|localhost/.test(process.env.DATABASE_URL))) {
    return { tier: 'supabase-remote', reason: 'SUPABASE_DB_URL / remote DATABASE_URL is set' };
  }
  if (supabaseCliVersion() && dockerAvailable()) {
    return { tier: 'supabase-local', reason: 'supabase CLI and Docker are available' };
  }
  return { tier: 'embedded', reason: 'no Docker daemon and no remote Supabase credentials; using embedded Postgres' };
}

export interface AdapterReport {
  name: string;
  active: string;
  real: boolean;
  note: string;
}

export function detectAdapters(): AdapterReport[] {
  loadDotEnv();
  const e = process.env;
  const mercuryEnv = e.MERCURY_ENV === 'sandbox' && e.MERCURY_API_TOKEN ? 'sandbox' : 'fake';
  return [
    {
      name: 'PaymentRail',
      active: mercuryEnv === 'sandbox' ? 'mercury (sandbox)' : 'fake-mercury',
      real: mercuryEnv === 'sandbox',
      note: mercuryEnv === 'sandbox' ? 'MERCURY_ENV=sandbox with token' : 'set MERCURY_ENV=sandbox + MERCURY_API_TOKEN for the sandbox',
    },
    {
      name: 'Mailer',
      active: e.RESEND_API_KEY ? 'resend' : e.SMTP_URL ? 'smtp' : 'dev-outbox',
      real: Boolean(e.RESEND_API_KEY || e.SMTP_URL),
      note: e.RESEND_API_KEY || e.SMTP_URL ? '' : 'mail is captured in the dev_outbox table (/dev/mail)',
    },
    {
      name: 'Storage',
      active: e.SUPABASE_URL && e.SUPABASE_SERVICE_ROLE_KEY ? 'supabase-storage' : 'local-filesystem',
      real: Boolean(e.SUPABASE_URL && e.SUPABASE_SERVICE_ROLE_KEY),
      note: e.SUPABASE_URL ? '' : 'files stored under .gms/storage',
    },
    {
      name: 'Scanner',
      active: e.CLAMAV_HOST ? 'clamav' : 'noop',
      real: Boolean(e.CLAMAV_HOST),
      note: e.CLAMAV_HOST ? '' : 'uploads marked "not scanned"',
    },
    {
      name: 'SecretStore',
      active: e.GMS_SECRET_STORE === 'vault' ? 'supabase-vault' : 'aes-256-gcm',
      real: true,
      note: e.GMS_ENCRYPTION_KEY ? 'GMS_ENCRYPTION_KEY set' : 'using a derived development key (set GMS_ENCRYPTION_KEY in production)',
    },
    {
      name: 'LLMProvider',
      active: e.ANTHROPIC_API_KEY ? 'anthropic' : e.OPENAI_API_KEY ? 'openai' : 'fake-llm',
      real: Boolean(e.ANTHROPIC_API_KEY || e.OPENAI_API_KEY),
      note: 'optional features only',
    },
    {
      name: 'DiligenceSource',
      active: 'fixtures',
      real: false,
      note: 'IRS/OFAC importers exist; bundled fictional fixtures loaded by seed',
    },
    {
      name: 'AuthAdapter',
      active: e.GMS_AUTH_MODE === 'test' || !e.SUPABASE_URL ? 'test-auth' : 'supabase-auth',
      real: Boolean(e.SUPABASE_URL) && e.GMS_AUTH_MODE !== 'test',
      note: !e.SUPABASE_URL ? 'TestAuthAdapter (GMS_AUTH_MODE=test; never in production builds)' : '',
    },
  ];
}

export function toolVersions(): Record<string, string | null> {
  return {
    node: process.version,
    pnpm: cmdOk('pnpm -v'),
    git: cmdOk('git --version'),
    docker: cmdOk('docker --version'),
    dockerDaemon: dockerAvailable() ? 'running' : null,
    supabase: supabaseCliVersion(),
    gh: cmdOk('gh --version')?.split('\n')[0] ?? null,
    netlify: cmdOk('netlify --version'),
  };
}
