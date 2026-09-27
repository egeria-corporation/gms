// SPDX-License-Identifier: AGPL-3.0-only
// Tier-3 database: a real Postgres started from the embedded-postgres npm binaries.
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import pg from 'pg';
import { EMBEDDED_PORT, repoRoot } from './env';

const run = promisify(execFile);

async function binaries(): Promise<{ pg_ctl: string; initdb: string; postgres: string }> {
  const plat = `${process.platform}-${process.arch}`;
  const map: Record<string, string> = {
    'win32-x64': '@embedded-postgres/windows-x64',
    'linux-x64': '@embedded-postgres/linux-x64',
    'linux-arm64': '@embedded-postgres/linux-arm64',
    'darwin-arm64': '@embedded-postgres/darwin-arm64',
    'darwin-x64': '@embedded-postgres/darwin-x64',
  };
  const pkg = map[plat];
  if (!pkg) throw new Error(`embedded-postgres has no binaries for ${plat}`);
  // Resolve through embedded-postgres so pnpm's strict layout works.
  const { createRequire } = await import('node:module');
  const req = createRequire(join(repoRoot(), 'packages', 'db', 'package.json'));
  const epMain = req.resolve('embedded-postgres');
  const req2 = createRequire(epMain);
  const binMain = req2.resolve(pkg);
  const { pathToFileURL } = await import('node:url');
  const mod = (await import(pathToFileURL(binMain).href)) as {
    pg_ctl?: string;
    initdb: string;
    postgres: string;
  };
  const ext = process.platform === 'win32' ? '.exe' : '';
  return {
    initdb: mod.initdb,
    postgres: mod.postgres,
    pg_ctl: mod.pg_ctl ?? join(dirname(mod.postgres), `pg_ctl${ext}`),
  };
}

export function embeddedDataDir(): string {
  return join(repoRoot(), '.gms', 'pgdata');
}

async function isUp(port: number): Promise<boolean> {
  const c = new pg.Client({ connectionString: `postgres://postgres:postgres@127.0.0.1:${port}/postgres` });
  try {
    await c.connect();
    await c.query('select 1');
    return true;
  } catch {
    return false;
  } finally {
    await c.end().catch(() => {});
  }
}

export async function embeddedStatus(port = EMBEDDED_PORT): Promise<'running' | 'stopped' | 'uninitialized'> {
  if (await isUp(port)) return 'running';
  return existsSync(join(embeddedDataDir(), 'PG_VERSION')) ? 'stopped' : 'uninitialized';
}

/** Initializes (once) and starts a detached Postgres on 127.0.0.1:port. Idempotent. */
export async function startEmbedded(opts: { port?: number; dataDir?: string; log?: (m: string) => void } = {}): Promise<string> {
  const port = opts.port ?? EMBEDDED_PORT;
  const dataDir = opts.dataDir ?? embeddedDataDir();
  const log = opts.log ?? (() => {});
  const url = `postgres://postgres:postgres@127.0.0.1:${port}/postgres`;
  if (await isUp(port)) return url;
  const bin = await binaries();
  if (!existsSync(join(dataDir, 'PG_VERSION'))) {
    mkdirSync(dataDir, { recursive: true });
    log(`initializing Postgres data directory at ${dataDir}`);
    const pwfile = join(dirname(dataDir), 'pwfile');
    const { writeFileSync, rmSync } = await import('node:fs');
    writeFileSync(pwfile, 'postgres\n');
    try {
      await run(bin.initdb, [`--pgdata=${dataDir}`, '--auth=password', '--username=postgres', `--pwfile=${pwfile}`, '--encoding=UTF8', '--locale=C']);
    } finally {
      rmSync(pwfile, { force: true });
    }
  }
  log(`starting Postgres on port ${port}`);
  const logFile = join(dirname(dataDir), 'postgres.log');
  // pg_ctl leaves the server holding inherited handles, so never wait on it: spawn detached and poll.
  const { spawn } = await import('node:child_process');
  const child = spawn(
    bin.pg_ctl,
    ['-D', dataDir, '-l', logFile, '-o', `-p ${port} -c listen_addresses=127.0.0.1 -c max_connections=200`, 'start'],
    { detached: true, stdio: 'ignore', windowsHide: true },
  );
  child.unref();
  for (let i = 0; i < 150; i++) {
    if (await isUp(port)) return url;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Postgres did not start; see ${logFile}`);
}

export async function stopEmbedded(opts: { dataDir?: string } = {}): Promise<void> {
  const dataDir = opts.dataDir ?? embeddedDataDir();
  if (!existsSync(join(dataDir, 'PG_VERSION'))) return;
  const bin = await binaries();
  await run(bin.pg_ctl, ['-D', dataDir, '-m', 'fast', 'stop']).catch(() => {});
}
