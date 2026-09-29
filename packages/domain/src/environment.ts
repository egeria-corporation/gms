// SPDX-License-Identifier: AGPL-3.0-or-later
// Which environment this process runs in. GMS_ENV wins when set: Netlify reports CONTEXT=production for every
// site's main deploy, including the staging site, so CONTEXT is only a fallback.

export type GmsEnvironment = 'production' | 'staging' | 'preview' | 'development';

export function gmsEnvironment(env: Record<string, string | undefined> = process.env): GmsEnvironment {
  const explicit = env.GMS_ENV?.trim();
  if (explicit) return explicit === 'production' || explicit === 'staging' || explicit === 'preview' ? explicit : 'development';
  if (env.CONTEXT === 'production') return 'production';
  if (env.CONTEXT === 'deploy-preview' || env.CONTEXT === 'branch-deploy') return 'preview';
  return 'development';
}

/** Real email to anyone, real banks only, no fakes. */
export function isProductionEnvironment(env: Record<string, string | undefined> = process.env): boolean {
  return gmsEnvironment(env) === 'production';
}

/** Production, staging and previews: reachable from the internet, so no dev tools and no test sign-in. */
export function isInternetFacing(env: Record<string, string | undefined> = process.env): boolean {
  return gmsEnvironment(env) !== 'development';
}
