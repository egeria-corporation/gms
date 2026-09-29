// SPDX-License-Identifier: AGPL-3.0-or-later
// Runtime configuration shared by proxy.ts and server code. No secrets here.

export type GmsMode = 'single' | 'multi';

export const config = {
  get mode(): GmsMode {
    return process.env.GMS_MODE === 'single' ? 'single' : 'multi';
  },
  /** e.g. "gms.example.org" in production, "localhost:3000" in development. */
  get rootDomain(): string {
    return (process.env.GMS_ROOT_DOMAIN ?? 'localhost:3000').toLowerCase();
  },
  get defaultTenant(): string {
    return process.env.DEFAULT_TENANT ?? 'halcyon';
  },
  get isProductionDeploy(): boolean {
    return process.env.GMS_ENV === 'production' || process.env.CONTEXT === 'production';
  },
  /** Dev-only surfaces (/dev/*, ?state=, tenant override header) are available outside production deploys. */
  get devToolsEnabled(): boolean {
    return !this.isProductionDeploy && process.env.GMS_DEV_TOOLS !== 'false';
  },
  get protocol(): 'http' | 'https' {
    return /localhost|127\.0\.0\.1/.test(this.rootDomain) ? 'http' : 'https';
  },
  get version(): string {
    return process.env.NEXT_PUBLIC_GMS_VERSION ?? 'dev';
  },
  get sourceUrl(): string {
    return process.env.NEXT_PUBLIC_GMS_SOURCE_URL ?? 'https://github.com/egeria-corporation/gms';
  },
};

/** The public origin for a tenant slug (null → root host). */
export function tenantOrigin(slug: string | null, customDomain?: string | null): string {
  if (customDomain) return `https://${customDomain}`;
  const root = config.rootDomain;
  if (!slug || config.mode === 'single') return `${config.protocol}://${root}`;
  return `${config.protocol}://${slug}.${root}`;
}

export function sourceLink(): string {
  const v = config.version;
  return v && v !== 'dev' && v !== 'unknown' ? `${config.sourceUrl}/tree/${v}` : config.sourceUrl;
}

export interface HostResolution {
  kind: 'tenant-slug' | 'custom-domain' | 'root';
  slug: string | null;
  host: string;
}

/** Pure host → tenant hint (no DB). Custom domains are resolved against workspace_domains on the server. */
export function resolveHost(hostHeader: string | null, override?: string | null): HostResolution {
  const host = (hostHeader ?? '').toLowerCase().trim();
  if (override && /^[a-z0-9-]{2,40}$/.test(override)) return { kind: 'tenant-slug', slug: override, host };
  if (config.mode === 'single') return { kind: 'tenant-slug', slug: config.defaultTenant, host };
  const root = config.rootDomain;
  const hostNoPort = host.replace(/:\d+$/, '');
  const rootNoPort = root.replace(/:\d+$/, '');
  if (host === root || hostNoPort === rootNoPort || hostNoPort === 'www.' + rootNoPort || hostNoPort === '127.0.0.1') {
    return { kind: 'root', slug: null, host };
  }
  if (hostNoPort.endsWith('.' + rootNoPort)) {
    const sub = hostNoPort.slice(0, -(rootNoPort.length + 1));
    if (/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(sub)) return { kind: 'tenant-slug', slug: sub, host };
  }
  return { kind: 'custom-domain', slug: null, host: hostNoPort };
}
