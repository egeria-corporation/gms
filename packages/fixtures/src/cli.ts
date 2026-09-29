// SPDX-License-Identifier: AGPL-3.0-or-later
// `pnpm seed [--minimal] [--reset] [--force]`: loads deterministic, fictional demo data.
//
//   --minimal  one workspace (halcyon) + its owner (Helen Ortiz, with a TOTP factor) + its brand
//   --reset    drop and re-create the LOCAL database (and re-run migrations) first
//   --force    seed even though demo data exists (implies --reset; local databases only)
//
// Set GMS_SEED_NOW=YYYY-MM-DD to reproduce a run exactly (default: today at 12:00 UTC).
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { closeDb, databaseUrl, getDb, loadDotEnv, repoRoot } from '@gms/db';
import { dropDatabase, ensureDatabase, migrate } from '@gms/db/migrate';

const HELP = `Usage: pnpm seed [--minimal] [--reset] [--force]

  --minimal  Only the Halcyon workspace, its owner and brand.
  --reset    Drop and re-create the local database first (refuses non-local URLs).
  --force    Seed even when demo data exists (resets the local database first).

Environment: DATABASE_URL, GMS_SEED_NOW (YYYY-MM-DD anchor for relative dates), GMS_AUTH_MODE (default "test").`;

function isLocal(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return ['localhost', '127.0.0.1', '[::1]', '::1'].includes(host);
  } catch {
    return false;
  }
}

function redact(url: string): string {
  return url.replace(/\/\/([^:@/]+):[^@/]*@/, '//$1:****@');
}

async function main(): Promise<number> {
  const args = new Set(process.argv.slice(2));
  if (args.has('--help') || args.has('-h')) {
    console.log(HELP);
    return 0;
  }
  const unknown = [...args].filter((a) => !['--minimal', '--reset', '--force'].includes(a));
  if (unknown.length) {
    console.error(`Unknown option(s): ${unknown.join(' ')}\n\n${HELP}`);
    return 2;
  }
  loadDotEnv();
  process.env.GMS_AUTH_MODE ??= 'test';
  const url = databaseUrl();
  const minimal = args.has('--minimal');
  const force = args.has('--force');
  let reset = args.has('--reset');

  // Imported after the environment is settled (the runtime reads GMS_AUTH_MODE when it is created).
  const { hasDemoData, seed, SEED_IDS } = await import('./index');

  if (!reset) {
    // Forward-only and idempotent: makes sure the schema is current before seeding.
    await ensureDatabase(url);
    await migrate({ url, shim: 'auto' });
  }
  if (!reset && (await hasDemoData(getDb(url)))) {
    if (!force) {
      console.log(`[seed] Demo data already exists in ${redact(url)} (workspace "halcyon"). Nothing to do.`);
      console.log('[seed] Use --force (or --reset) to wipe the local database and seed again.');
      return 0;
    }
    reset = true;
  }
  if (reset) {
    if (!isLocal(url)) {
      console.error(`[seed] Refusing to reset a non-local database (${redact(url)}).`);
      return 1;
    }
    await closeDb(url);
    console.log(`[seed] Resetting ${redact(url)}`);
    await dropDatabase(url);
    await ensureDatabase(url);
    await migrate({ url, shim: 'auto', log: (m) => console.log(`[migrate] ${m}`) });
  }

  console.log(`[seed] Seeding ${minimal ? 'minimal' : 'full'} demo data into ${redact(url)}`);
  const result = await seed({ minimal, log: (m) => console.log(`[seed] ${m}`) });
  const counts = Object.entries(result.counts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join(' ');
  console.log(`[seed] Done in ${(result.durationMs / 1000).toFixed(1)}s (anchor ${result.anchor.slice(0, 10)}, flagship ${result.flagshipStatus}).`);
  console.log(`[seed] ${counts}`);

  if (result.tokens) {
    const file = join(repoRoot(), '.gms', 'dev-tokens.json');
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(
      file,
      JSON.stringify({ note: 'DEV-ONLY demo credentials created by `pnpm seed`. Never commit this file.', createdAt: new Date().toISOString(), database: redact(url), ...result.tokens }, null, 2) + '\n',
      { mode: 0o600 },
    );
    // Printed once, on purpose: these are local development credentials for fictional demo agents.
    console.log('\n[seed] DEV-ONLY agent credentials (also written to .gms/dev-tokens.json, which is gitignored):');
    console.log(`  Grant Writer Assistant (acts for ${result.tokens.grantWriterAssistant.ownerEmail}): ${result.tokens.grantWriterAssistant.token}`);
    console.log(`  Ops Assistant (owned by ${result.tokens.opsAssistant.ownerEmail}): ${result.tokens.opsAssistant.key}`);
  }
  console.log(`\n[seed] Sign in at http://${SEED_IDS.workspaces.halcyon}.localhost:3000 as helen@halcyonridge.example (magic link in /dev/mail; TOTP secrets in packages/fixtures/README.md).`);
  return 0;
}

main()
  .then(async (code) => {
    await closeDb();
    process.exit(code);
  })
  .catch(async (err: unknown) => {
    console.error(`[seed] Failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
    await closeDb().catch(() => {});
    process.exit(1);
  });
