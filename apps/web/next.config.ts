// SPDX-License-Identifier: AGPL-3.0-or-later
import { execSync } from 'node:child_process';
import type { NextConfig } from 'next';
import { deployConfigProblems, deployedEnvironment } from './lib/deploy-config';

// Deployed environments (production, staging) must be fully configured: never ship test sign-in, captured-only
// email, a local database or a derived encryption key.
const problems = deployConfigProblems(process.env);
if (problems.length) {
  throw new Error(`This ${deployedEnvironment(process.env)} build is not configured:\n- ${problems.join('\n- ')}`);
}

function gitSha(): string {
  if (process.env.COMMIT_REF) return process.env.COMMIT_REF; // Netlify
  try {
    return execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return 'unknown';
  }
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // We maintain our own AGENTS.md at the repo root.
  agentRules: false,
  poweredByHeader: false,
  transpilePackages: [
    '@gms/actions',
    '@gms/adapters',
    '@gms/agents',
    '@gms/commongrants',
    '@gms/db',
    '@gms/domain',
    '@gms/email',
    '@gms/forms',
    '@gms/pdf',
    '@gms/ui',
  ],
  serverExternalPackages: ['pg', 'embedded-postgres', '@react-pdf/renderer', 'graphile-worker', 'nodemailer', 'exceljs'],
  env: {
    NEXT_PUBLIC_GMS_VERSION: gitSha(),
    NEXT_PUBLIC_GMS_SOURCE_URL: process.env.GMS_SOURCE_URL ?? 'https://github.com/egeria-corporation/gms',
  },
  experimental: {
    serverActions: { bodySizeLimit: '2mb' },
  },
  async headers() {
    const common = [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
      { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
    ];
    const hsts = process.env.NODE_ENV === 'production' ? [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }] : [];
    return [{ source: '/:path*', headers: [...common, ...hsts] }];
  },
};

export default nextConfig;
