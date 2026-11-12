// SPDX-License-Identifier: AGPL-3.0-only
// secrets: generate the signing key and encryption keys, set every Worker secret over stdin, and
// write the recovery file. Nothing secret is printed or stored under deploy/.
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { Ctx, Result } from "../core.ts";
import { brief, confirmOrDry, flagStr, isResult, loadState, patchState, requireConfig, res, reveal, wranglerRun } from "../core.ts";
import { Supabase, supabaseToken } from "../supabase-api.ts";
import { LOGIN_MESSAGE } from "./supabase.ts";

export type WorkerKey = "api" | "jobs";

/** Secrets each Worker needs (docs/self-host.md step 3). */
export const API_SECRETS = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_ANON_KEY", "OAUTH_KID", "OAUTH_SIGNING_KEY_JWK", "CREDENTIALS_ENCRYPTION_KEY", "WEBHOOK_SECRET_KEY"];
export const JOBS_SECRETS = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "CREDENTIALS_ENCRYPTION_KEY", "WEBHOOK_SECRET_KEY"];
/** The values worth keeping: losing them strands stored links or signed tokens. */
export const RECOVERY_KEYS = ["CREDENTIALS_ENCRYPTION_KEY", "WEBHOOK_SECRET_KEY", "OAUTH_KID", "OAUTH_SIGNING_KEY_JWK"];

const HEADER = `# GMS instance recovery file. Keep it somewhere safe and private (a password manager, not this repository).
#
# CREDENTIALS_ENCRYPTION_KEY encrypts the Passport client secrets, refresh tokens and connected-app
# tokens the instance stores. WEBHOOK_SECRET_KEY encrypts outbound webhook signing secrets.
# OAUTH_KID and OAUTH_SIGNING_KEY_JWK sign the tokens the instance issues.
# If you lose the two encryption keys, every stored link and webhook secret becomes unreadable and
# has to be set up again. They cannot be recovered from Cloudflare.
`;

/** Where the recovery file may go: outside the repository. */
export function recoveryPathProblem(root: string, path: string): string | null {
  if (!isAbsolute(path)) return "Give an absolute path for --recovery-file.";
  const parent = dirname(path);
  if (!existsSync(parent)) return `The folder ${parent} does not exist. Create it first.`;
  const realRoot = realpathSync(root);
  const target = join(realpathSync(parent), basename(path));
  const rel = relative(realRoot, target);
  if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) return "The recovery file must be outside the repository so it is never committed. Choose a path elsewhere.";
  return null;
}

export function readRecovery(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!existsSync(path)) return out;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (m) out[m[1]!] = m[2]!;
  }
  return out;
}

export function writeRecovery(path: string, values: Record<string, string>): void {
  const body = HEADER + "\n" + Object.entries(values).map(([k, v]) => `${k}=${v}`).join("\n") + "\n";
  writeFileSync(path, body, { mode: 0o600 });
  chmodSync(path, 0o600);
}

/** Same values `pnpm --filter @gms/api keygen` prints: an ES256 key pair and a dated key id. */
export function generateSigningKey(now: Date, randomId: () => string = randomUUID): { kid: string; privateJwk: string } {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = privateKey.export({ format: "jwk" });
  return { kid: `oauth-${now.toISOString().slice(0, 10)}-${randomId().slice(0, 8)}`, privateJwk: JSON.stringify(jwk) };
}

async function existingNames(ctx: Ctx, configPath: string): Promise<Set<string> | null> {
  const r = await wranglerRun(ctx, ["secret", "list", "--config", configPath, "--format", "json"]);
  if (r.code !== 0) {
    // A Worker that has never been deployed has no secrets to list.
    if (/not found|10007|does not exist|no such/i.test(r.stdout + r.stderr)) return new Set();
    return null;
  }
  try {
    const j = JSON.parse(r.stdout.slice(r.stdout.indexOf("[")));
    return new Set((j as { name: string }[]).map((s) => s.name));
  } catch {
    return new Set();
  }
}

export async function secrets(ctx: Ctx): Promise<Result> {
  const config = requireConfig(ctx);
  if (isResult(config)) return config;
  const state = loadState(ctx);
  const ref = state.supabase?.ref as string | undefined;
  if (!ref) return res("needs_input", "There is no Supabase project yet. Run the supabase step first.", {}, "supabase");
  if (!state.cloudflare?.kvId) return res("needs_input", "The Worker configs do not exist yet. Run the cloudflare step first.", {}, "cloudflare");
  const token = supabaseToken(ctx);
  if (!token) return res("needs_login", LOGIN_MESSAGE, {}, null);

  const recoveryFlag = flagStr(ctx, "recovery-file");
  if (!recoveryFlag) return res("needs_input", "Pass --recovery-file <absolute path outside this repository>. The encryption keys and signing key are written there (mode 0600); losing them strands stored links.", {}, "secrets");
  const recoveryPath = isAbsolute(recoveryFlag) ? resolve(recoveryFlag) : recoveryFlag;
  const problem = recoveryPathProblem(ctx.root, recoveryPath);
  if (problem) return res("needs_input", problem, {}, "secrets");

  const rotate = ctx.flags.rotate === true;
  const gen = join(ctx.deployDir, "generated");
  const configs: Record<WorkerKey, string> = { api: join(gen, "api.toml"), jobs: join(gen, "jobs.toml") };
  if (!existsSync(configs.api) || !existsSync(configs.jobs)) return res("needs_input", "The generated Worker configs are missing. Run the cloudflare step first.", {}, "cloudflare");

  const have: Record<WorkerKey, Set<string> | null> = { api: await existingNames(ctx, configs.api), jobs: await existingNames(ctx, configs.jobs) };
  if (!have.api || !have.jobs) return res("needs_login", "Could not read the Workers' secrets. Check the Cloudflare login (`pnpm exec wrangler login`) and re-run.", {}, null);

  const wanted: Record<WorkerKey, string[]> = { api: [...API_SECRETS], jobs: [...JOBS_SECRETS] };
  const resendKey = config.resend ? ctx.env.RESEND_API_KEY?.trim() : undefined;
  if (resendKey) for (const w of ["api", "jobs"] as const) wanted[w].push("RESEND_API_KEY");
  const resendFrom = config.resend ? (state.email?.from as string | undefined) : undefined;
  if (resendFrom) for (const w of ["api", "jobs"] as const) wanted[w].push("RESEND_FROM");

  const toSet: Record<WorkerKey, string[]> = {
    api: rotate ? wanted.api : wanted.api.filter((k) => !have.api!.has(k)),
    jobs: rotate ? wanted.jobs : wanted.jobs.filter((k) => !have.jobs!.has(k)),
  };
  const total = toSet.api.length + toSet.jobs.length;
  if (total === 0) return res("skipped", "Every Worker secret is already set.", { api: wanted.api, jobs: wanted.jobs }, "deploy");

  const plan = [`set ${toSet.api.length} secret(s) on ${state.workers?.api ?? "the API Worker"} and ${toSet.jobs.length} on ${state.workers?.jobs ?? "the jobs Worker"} (names: ${[...new Set([...toSet.api, ...toSet.jobs])].join(", ")})`, `write the encryption keys and signing key to ${recoveryPath}`];
  if (rotate) plan.unshift("ROTATE: replace secrets that are already set. Replacing CREDENTIALS_ENCRYPTION_KEY or WEBHOOK_SECRET_KEY makes everything stored with the old key unreadable");
  const gate = confirmOrDry(ctx, "secrets", plan, { names: { api: toSet.api, jobs: toSet.jobs } });
  if (gate) return gate;

  // Values. Reuse what the recovery file already holds (the two Workers must share the encryption keys).
  // The two Workers must share these. If only one has it and the recovery file does not hold the value, a new one would split them.
  const priorFile = rotate ? {} : readRecovery(recoveryPath);
  for (const k of ["CREDENTIALS_ENCRYPTION_KEY", "WEBHOOK_SECRET_KEY"]) {
    const onApi = have.api.has(k);
    const onJobs = have.jobs.has(k);
    if (!rotate && onApi !== onJobs && !priorFile[k]) {
      return res("needs_input", `${k} is set on only one Worker and the recovery file does not hold its value, so a matching one cannot be made. Point --recovery-file at the file that has it, or re-run with --rotate to replace it on both (this strands anything stored with the old key).`, { name: k }, "secrets");
    }
  }
  const keys = await new Supabase(ctx, token).keys(ref);
  if (!keys) return res("error", "Could not read the Supabase API keys.", {}, null);
  const prior = priorFile as Record<string, string>;
  const values: Record<string, string> = {
    SUPABASE_URL: state.supabase.url,
    SUPABASE_SERVICE_ROLE_KEY: keys.service,
    SUPABASE_ANON_KEY: keys.anon,
  };
  for (const k of ["CREDENTIALS_ENCRYPTION_KEY", "WEBHOOK_SECRET_KEY"]) values[k] = prior[k] ?? ctx.random(32).toString("base64url");
  if (prior.OAUTH_KID && prior.OAUTH_SIGNING_KEY_JWK) {
    values.OAUTH_KID = prior.OAUTH_KID;
    values.OAUTH_SIGNING_KEY_JWK = prior.OAUTH_SIGNING_KEY_JWK;
  } else {
    const k = generateSigningKey(ctx.now());
    values.OAUTH_KID = k.kid;
    values.OAUTH_SIGNING_KEY_JWK = k.privateJwk;
  }
  if (resendKey) values.RESEND_API_KEY = resendKey;
  if (resendFrom) values.RESEND_FROM = resendFrom;
  for (const [k, v] of Object.entries(values)) if (k !== "SUPABASE_URL" && k !== "RESEND_FROM") reveal(ctx, v);
  // The JWK is JSON; register its private part separately so a partial echo is caught too.
  try {
    reveal(ctx, (JSON.parse(values.OAUTH_SIGNING_KEY_JWK!) as { d?: string }).d);
  } catch {
    /* not JSON */
  }

  // Recovery first, so no secret is ever set that cannot be recovered.
  mkdirSync(dirname(recoveryPath), { recursive: true });
  // Only values this run knows are the live ones: those already in the file, and those about to be set.
  const setNow = new Set([...toSet.api, ...toSet.jobs]);
  const kept: Record<string, string> = {};
  for (const k of RECOVERY_KEYS) {
    if (prior[k]) kept[k] = prior[k]!;
    else if (setNow.has(k)) kept[k] = values[k]!;
  }
  writeRecovery(recoveryPath, kept);

  for (const w of ["api", "jobs"] as const) {
    for (const name of toSet[w]) {
      ctx.log(`Setting ${name} on the ${w} Worker`);
      const r = await wranglerRun(ctx, ["secret", "put", name, "--config", configs[w]], { input: values[name]! });
      if (r.code !== 0) return res("error", `Could not set ${name} on the ${w} Worker: ${brief(ctx, r)}. Nothing is lost; re-run to continue.`, { worker: w, name }, "secrets");
    }
  }
  patchState(ctx, { secrets: { api: wanted.api, jobs: wanted.jobs, recoveryFileWritten: true, at: ctx.now().toISOString() } });
  return res("ok", `Set ${total} secret(s) and wrote the recovery file (mode 0600). Store that file safely now.`, { api: toSet.api, jobs: toSet.jobs }, "deploy");
}
