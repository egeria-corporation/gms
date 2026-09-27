// SPDX-License-Identifier: AGPL-3.0-only
import { config, sourceLink } from './config';

/** "Powered by GMS · Source code" (AGPL §13): always linked to the exact running version. */
export function poweredBy() {
  const v = config.version;
  return { sourceUrl: sourceLink(), version: v === 'dev' || v === 'unknown' ? 'development build' : v.slice(0, 7) };
}

/** Non-production only: a `?state=` override to reach every documented screen state. */
export function forcedState(sp: Record<string, string | string[] | undefined> | undefined): string | null {
  if (!config.devToolsEnabled) return null;
  const s = sp?.state;
  return typeof s === 'string' ? s : null;
}

export function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export function many(v: string | string[] | undefined): string[] {
  if (!v) return [];
  return (Array.isArray(v) ? v : v.split(',')).map((x) => x.trim()).filter(Boolean);
}
