// SPDX-License-Identifier: AGPL-3.0-or-later
// Build-time check for deployed environments (production, staging and Netlify previews). A deploy that would
// silently fall back to a development adapter — test sign-in, the dev mail outbox, an embedded database, a derived
// encryption key — fails the build with a list of what to set. Local and CI builds are not checked.
// Imported by next.config.ts, so it must stay dependency-free.

export type DeployEnv = Record<string, string | undefined>;

/**
 * Same rule as gmsEnvironment() in @gms/domain (GMS_ENV wins; Netlify's CONTEXT is only a fallback, because it
 * says "production" for every site's main deploy, staging included). Duplicated because next.config.ts can't
 * import workspace packages; deploy-config.test.ts checks the two agree.
 */
export function deployedEnvironment(env: DeployEnv): 'production' | 'staging' | null {
  const explicit = env.GMS_ENV?.trim();
  let e: string;
  if (explicit) e = explicit;
  else if (env.CONTEXT === 'production') e = 'production';
  else if (env.CONTEXT === 'deploy-preview' || env.CONTEXT === 'branch-deploy') e = 'preview';
  else e = 'development';
  if (e === 'production') return 'production';
  // Staging and previews are internet-facing too.
  if (e === 'staging' || e === 'preview') return 'staging';
  return null;
}

/** Problems that make this environment unsafe to deploy (empty when it's fine or not a deployed environment). */
export function deployConfigProblems(env: DeployEnv): string[] {
  if (!deployedEnvironment(env)) return [];
  const problems: string[] = [];
  const set = (k: string) => Boolean(env[k]?.trim());

  if (env.GMS_AUTH_MODE === 'test') problems.push('GMS_AUTH_MODE=test is only for local development and tests. Unset it.');
  for (const k of ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY']) if (!set(k)) problems.push(`${k} is required (Supabase sign-in and storage).`);

  const db = env.DATABASE_URL ?? env.SUPABASE_DB_URL ?? '';
  if (!db) problems.push('DATABASE_URL is required (Supabase transaction pooler, port 6543).');
  else if (/@(localhost|127\.0\.0\.1)[:/]/.test(db)) problems.push('DATABASE_URL points at a local database.');

  if (env.GMS_SECRET_STORE !== 'vault') {
    if (!set('GMS_ENCRYPTION_KEY')) problems.push('GMS_ENCRYPTION_KEY is required (64 hex characters: `openssl rand -hex 32`), or set GMS_SECRET_STORE=vault.');
    else if (!/^[0-9a-f]{64}$/i.test(env.GMS_ENCRYPTION_KEY!.trim())) problems.push('GMS_ENCRYPTION_KEY must be 64 hex characters.');
  }

  if (!set('RESEND_API_KEY') && !set('SMTP_URL')) problems.push('RESEND_API_KEY (or SMTP_URL) is required; without it email is only captured, never sent.');

  if (env.GMS_MODE !== 'single') {
    const root = env.GMS_ROOT_DOMAIN ?? '';
    if (!root) problems.push('GMS_ROOT_DOMAIN is required in multi-tenant mode (e.g. gms.opengrants.io).');
    else if (/localhost|127\.0\.0\.1/.test(root)) problems.push('GMS_ROOT_DOMAIN points at localhost.');
  }
  return problems;
}
