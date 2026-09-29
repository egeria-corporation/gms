// SPDX-License-Identifier: AGPL-3.0-or-later
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Default connection for the embedded (tier 3) Postgres started by `pnpm db:up`. */
export const EMBEDDED_PORT = Number(process.env.GMS_EMBEDDED_PG_PORT ?? 54329);
export const EMBEDDED_URL = `postgres://postgres:postgres@127.0.0.1:${EMBEDDED_PORT}/gms`;

/** Walks up from this file to find the monorepo root (the folder with pnpm-workspace.yaml). */
export function repoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    dir = resolve(dir, '..');
  }
  return process.cwd();
}

let envLoaded = false;
/** Loads `.env` from the repo root into process.env without overriding existing values. */
export function loadDotEnv(): void {
  if (envLoaded) return;
  envLoaded = true;
  const file = join(repoRoot(), '.env');
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || line.trimStart().startsWith('#')) continue;
    const key = m[1]!;
    let value = m[2]!;
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

export function databaseUrl(): string {
  loadDotEnv();
  return process.env.DATABASE_URL || process.env.SUPABASE_DB_URL || EMBEDDED_URL;
}
