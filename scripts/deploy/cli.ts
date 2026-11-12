// SPDX-License-Identifier: AGPL-3.0-only
// pnpm gms deploy <step> [flags]
// Every run prints human progress on stderr and exactly one JSON line on stdout (see CODES.md).
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Ctx, Result, RunOptions, RunOut } from "./core.ts";
import { exitCodeFor, parseArgs, redact, res, reveal } from "./core.ts";
import { auth } from "./steps/auth.ts";
import { cloudflare } from "./steps/cloudflare.ts";
import { deploy } from "./steps/deploy.ts";
import { doctor } from "./steps/doctor.ts";
import { email } from "./steps/email.ts";
import { init } from "./steps/init.ts";
import { migrate } from "./steps/migrate.ts";
import { passport } from "./steps/passport.ts";
import { secrets } from "./steps/secrets.ts";
import { status } from "./steps/status.ts";
import { supabase } from "./steps/supabase.ts";
import { upgrade } from "./steps/upgrade.ts";
import { verify } from "./steps/verify.ts";

export const STEPS: Record<string, (ctx: Ctx) => Promise<Result>> = { doctor, init, supabase, migrate, auth, cloudflare, secrets, deploy, email, passport, verify, upgrade, status };
export const ORDER = ["doctor", "init", "supabase", "migrate", "auth", "cloudflare", "secrets", "deploy", "email", "passport", "verify", "upgrade", "status"];

export function run(cmd: string, args: string[], opts: RunOptions = {}): Promise<RunOut> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: opts.cwd, env: { ...process.env, ...opts.env }, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (e) => resolve({ code: 127, stdout, stderr: stderr + String(e.message) }));
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
    child.stdin.on("error", () => undefined);
    child.stdin.end(opts.input ?? "");
  });
}

export function defaultCtx(argv: string[]): { ctx: Ctx; positional: string[] } {
  const { positional, flags } = parseArgs(argv);
  const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const ctx: Ctx = {
    root,
    deployDir: join(root, "deploy"),
    env: process.env,
    home: homedir(),
    nodeVersion: process.version,
    fetch: globalThis.fetch,
    run,
    log: (m) => process.stderr.write(`${redact(ctx, m)}\n`),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    random: (n) => randomBytes(n),
    now: () => new Date(),
    flags,
    yes: flags.yes === true,
    dryRun: flags["dry-run"] === true,
    secrets: new Set(),
  };
  // Credentials from the environment are secret from the start, whatever step runs.
  for (const name of ["CLOUDFLARE_API_TOKEN", "SUPABASE_ACCESS_TOKEN", "RESEND_API_KEY"]) reveal(ctx, process.env[name]?.trim());
  return { ctx, positional };
}

/** Run one step and return the line to print. Exposed so tests drive the same path as the CLI. */
export async function execute(ctx: Ctx, step: string): Promise<{ line: string; exit: number; result: Result }> {
  const fn = STEPS[step];
  let result: Result;
  if (!fn) result = res("error", `There is no step called "${step}". Steps: ${ORDER.join(", ")}.`, { steps: ORDER }, null);
  else {
    try {
      result = await fn(ctx);
    } catch (e) {
      result = res("error", `The ${step} step stopped unexpectedly: ${e instanceof Error ? e.message : String(e)}`, {}, null);
    }
  }
  const out = { step, code: result.code, message: result.message, data: result.data ?? {}, next: result.next ?? null };
  const line = redact(ctx, JSON.stringify(out));
  return { line, exit: exitCodeFor(result.code), result };
}

async function main(): Promise<void> {
  const { ctx, positional } = defaultCtx(process.argv.slice(2));
  const [group, step] = positional;
  if (group !== "deploy" || !step || ctx.flags.help === true) {
    process.stderr.write(`Usage: pnpm gms deploy <step> [--yes] [--dry-run] [flags]\nSteps: ${ORDER.join(", ")}\nSee scripts/deploy/README.md.\n`);
    const r = res("error", group === "deploy" && !step ? `Name a step: ${ORDER.join(", ")}.` : "Usage: pnpm gms deploy <step>.", { steps: ORDER }, null);
    process.stdout.write(`${JSON.stringify({ step: step ?? null, code: r.code, message: r.message, data: r.data, next: null })}\n`);
    process.exit(1);
  }
  const { line, exit } = await execute(ctx, step);
  process.stdout.write(`${line}\n`);
  process.exit(exit);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
