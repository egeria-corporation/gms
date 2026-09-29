// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { deployConfigProblems } from './deploy-config';

const PROD = {
  GMS_ENV: 'production',
  GMS_MODE: 'multi',
  GMS_ROOT_DOMAIN: 'gms.opengrants.io',
  SUPABASE_URL: 'https://abc.supabase.co',
  SUPABASE_ANON_KEY: 'anon',
  SUPABASE_SERVICE_ROLE_KEY: 'service',
  DATABASE_URL: 'postgres://postgres.abc:pw@aws-0-us-west-1.pooler.supabase.com:6543/postgres',
  GMS_ENCRYPTION_KEY: 'a'.repeat(64),
  RESEND_API_KEY: 're_test',
};

describe('deployConfigProblems', () => {
  it('passes a fully configured production environment', () => {
    expect(deployConfigProblems(PROD)).toEqual([]);
  });

  it('ignores local and CI builds', () => {
    expect(deployConfigProblems({ GMS_AUTH_MODE: 'test' })).toEqual([]);
    expect(deployConfigProblems({ GMS_ENV: 'test', GMS_AUTH_MODE: 'test' })).toEqual([]);
  });

  it('checks Netlify deploy previews and branch deploys like staging', () => {
    expect(deployConfigProblems({ CONTEXT: 'deploy-preview', GMS_AUTH_MODE: 'test' })).toContain('GMS_AUTH_MODE=test is only for local development and tests. Unset it.');
    expect(deployConfigProblems({ ...PROD, GMS_ENV: 'preview' })).toEqual([]);
  });

  it('refuses development fallbacks in production and staging', () => {
    const problems = deployConfigProblems({ GMS_ENV: 'staging', GMS_AUTH_MODE: 'test', DATABASE_URL: 'postgres://postgres:postgres@127.0.0.1:54329/gms', GMS_ENCRYPTION_KEY: 'short', GMS_ROOT_DOMAIN: 'localhost:3000' });
    expect(problems.join('\n')).toMatch(/GMS_AUTH_MODE=test/);
    expect(problems.join('\n')).toMatch(/SUPABASE_URL is required/);
    expect(problems.join('\n')).toMatch(/local database/);
    expect(problems.join('\n')).toMatch(/64 hex/);
    expect(problems.join('\n')).toMatch(/RESEND_API_KEY/);
    expect(problems.join('\n')).toMatch(/localhost/);
  });

  it('accepts Vault instead of an encryption key, and Netlify’s production context', () => {
    const { GMS_ENCRYPTION_KEY: _k, GMS_ENV: _e, ...rest } = PROD;
    expect(deployConfigProblems({ ...rest, CONTEXT: 'production', GMS_SECRET_STORE: 'vault' })).toEqual([]);
  });
});

describe('deployedEnvironment', () => {
  it('agrees with gmsEnvironment() in @gms/domain', async () => {
    const { gmsEnvironment } = await import('@gms/domain');
    const { deployedEnvironment } = await import('./deploy-config');
    const cases = [{}, { GMS_ENV: 'production' }, { GMS_ENV: 'staging', CONTEXT: 'production' }, { GMS_ENV: 'preview' }, { CONTEXT: 'production' }, { CONTEXT: 'deploy-preview' }, { CONTEXT: 'branch-deploy' }, { GMS_ENV: 'test' }];
    for (const env of cases) {
      const d = gmsEnvironment(env);
      expect(deployedEnvironment(env), JSON.stringify(env)).toBe(d === 'production' ? 'production' : d === 'development' ? null : 'staging');
    }
  });
});
