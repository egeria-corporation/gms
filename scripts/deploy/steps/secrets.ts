// SPDX-License-Identifier: AGPL-3.0-only
// secrets: generate the signing key and encryption keys, set every Worker secret over stdin, and
// keep the recovery file. Nothing secret is printed or stored under deploy/.
//
// Rotation is staged: the new keys go to <recovery-file>.new, are set on both Workers, and only then
// replace the recovery file (the old one is kept as <recovery-file>.previous). An interrupted rotation
// resumes from the .new file instead of generating a third set.
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { closeSync, existsSync, fsyncSync, lstatSync, openSync, readFileSync, realpathSync, renameSync, writeSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { Ctx, Result } from "../core.ts";
import { brief, confirmOrDry, flagStr, isResult, loadState, patchState, requireConfig, res, reveal, wranglerRun } from "../core.ts";
import { KEYS_MESSAGE, LOGIN_MESSAGE, Supabase, supabaseToken } from "../supabase-api.ts";

export type WorkerKey = "api" | "jobs";

/** Secrets each Worker needs (docs/self-host.md step 3). */
export const API_SECRETS = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_ANON_KEY", "OAUTH_KID", "OAUTH_SIGNING_KEY_JWK", "CREDENTIALS_ENCRYPTION_KEY", "WEBHOOK_SECRET_KEY"];
export const JOBS_SECRETS = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "CREDENTIALS_ENCRYPTION_KEY", "WEBHOOK_SECRET_KEY"];
/** The values worth keeping: losing them strands stored links or signed tokens. */
export const RECOVERY_KEYS = ["CREDENTIALS_ENCRYPTION_KEY", "WEBHOOK_SECRET_KEY", "OAUTH_KID", "OAUTH_SIGNING_KEY_JWK"];
/** Rotating these makes data stored with the old value unreadable, so it needs --rotate-keys as well. */
const ENCRYPTION_KEYS = ["CREDENTIALS_ENCRYPTION_KEY", "WEBHOOK_SECRET_KEY"];
/** Refreshable from Supabase without generating anything. */
const SUPABASE_VALUES = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_ANON_KEY", "SUPABASE_JWT_SECRET"];

export const RECOVERY_FIRST_LINE = "# GMS instance recovery file. Keep it somewhere safe and private (a password manager, not this repository).";
const HEADER = `${RECOVERY_FIRST_LINE}
#
# CREDENTIALS_ENCRYPTION_KEY encrypts the Passport client secrets, refresh tokens and connected-app
# tokens the instance stores. WEBHOOK_SECRET_KEY encrypts outbound webhook signing secrets.
# OAUTH_KID and OAUTH_SIGNING_KEY_JWK sign the tokens the instance issues.
# If you lose the two encryption keys, every stored link and webhook secret becomes unreadable and
# has to be set up again. They cannot be recovered from Cloudflare.
`;

/** Where the recovery file may go: an absolute path outside the repository, not a symlink, and not someone else's file. */
export function recoveryPathProblem(root: string, path: string): string | null {
  if (!isAbsolute(path)) return "Give an absolute path for --recovery-file.";
  const parent = dirname(path);
  if (!existsSync(parent)) return `The folder ${parent} does not exist. Create it first.`;
  const realRoot = realpathSync(root);
  const target = join(realpathSync(parent), basename(path));
  const rel = relative(realRoot, target);
  if (rel === "" || !(rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel))) return "The recovery file must be outside the repository so it is never committed. Choose a path elsewhere.";
  for (const p of [path, `${path}.new`]) {
    let st;
    try {
      st = lstatSync(p);
    } catch {
      continue;
    }
    if (st.isSymbolicLink()) return `${p} is a symbolic link. Point --recovery-file at a plain file path.`;
    if (!st.isFile()) return `${p} is not a regular file.`;
    if (readFileSync(p, "utf8").split("\n")[0] !== RECOVERY_FIRST_LINE) return `${p} already exists and was not written by this tool, so it will not be overwritten. Choose another path.`;
  }
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

/** Write through a new file in the same folder (exclusive create, mode 0600, synced), then rename over the target. */
export function writeRecovery(path: string, values: Record<string, string>): void {
  const body = HEADER + "\n" + Object.entries(values).map(([k, v]) => `${k}=${v}`).join("\n") + "\n";
  const tmp = `${path}.tmp-${process.pid}`;
  const fd = openSync(tmp, "wx", 0o600);
  try {
    writeSync(fd, body);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, path);
}

/** Same values `pnpm --filter @gms/api keygen` prints: an ES256 key pair and a dated key id. */
export function generateSigningKey(now: Date, randomId: () => string = randomUUID): { kid: string; privateJwk: string } {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = privateKey.export({ format: "jwk" });
  return { kid: `oauth-${now.toISOString().slice(0, 10)}-${randomId().slice(0, 8)}`, privateJwk: JSON.stringify(jwk) };
}

/** Names of the secrets on a Worker, an empty set for a Worker that does not exist yet, or null when the answer cannot be trusted. */
export async function existingNames(ctx: Ctx, configPath: string): Promise<Set<string> | null> {
  const r = await wranglerRun(ctx, ["secret", "list", "--config", configPath, "--format", "json"]);
  if (r.code !== 0) return /not found|10007|does not exist|no such/i.test(r.stdout + r.stderr) ? new Set() : null;
  const out = r.stdout.trim();
  const starts = [0, ...[...out.matchAll(/(^|\n)\[/g)].map((m) => m.index! + (m[1] ? 1 : 0))];
  for (const at of starts.reverse()) {
    try {
      const j = JSON.parse(out.slice(at));
      if (Array.isArray(j) && j.every((x) => x && typeof x.name === "string")) return new Set(j.map((x: { name: string }) => x.name));
    } catch {
      /* try the next candidate */
    }
  }
  return null;
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
  const newPath = `${recoveryPath}.new`;

  // --rotate NAME[,NAME]: replace those secrets. The encryption keys also need --rotate-keys.
  const rotateFlag = ctx.flags.rotate;
  if (rotateFlag === true) return res("needs_input", `--rotate takes the names to replace, for example --rotate SUPABASE_SERVICE_ROLE_KEY,SUPABASE_ANON_KEY. Choices: ${[...SUPABASE_VALUES, "OAUTH_SIGNING_KEY_JWK", ...ENCRYPTION_KEYS].join(", ")}. Refreshing the Supabase values never regenerates the encryption keys.`, {}, "secrets");
  const requested = new Set(typeof rotateFlag === "string" ? rotateFlag.split(",").map((x) => x.trim()).filter(Boolean) : []);
  const allowed = new Set([...SUPABASE_VALUES, "OAUTH_KID", "OAUTH_SIGNING_KEY_JWK", ...ENCRYPTION_KEYS]);
  const unknown = [...requested].filter((n) => !allowed.has(n));
  if (unknown.length) return res("needs_input", `Cannot rotate ${unknown.join(", ")}. Choices: ${[...allowed].join(", ")}.`, {}, "secrets");
  if ([...requested].some((n) => ENCRYPTION_KEYS.includes(n)) && ctx.flags["rotate-keys"] !== true) {
    return res("needs_input", "Rotating CREDENTIALS_ENCRYPTION_KEY or WEBHOOK_SECRET_KEY makes everything stored with the old key unreadable (Passport links, connected-app tokens, webhook secrets). If that is intended, add --rotate-keys.", {}, "secrets");
  }
  if (requested.has("OAUTH_KID") || requested.has("OAUTH_SIGNING_KEY_JWK")) {
    requested.add("OAUTH_KID");
    requested.add("OAUTH_SIGNING_KEY_JWK");
  }

  const gen = join(ctx.deployDir, "generated");
  const configs: Record<WorkerKey, string> = { api: join(gen, "api.toml"), jobs: join(gen, "jobs.toml") };
  if (!existsSync(configs.api) || !existsSync(configs.jobs)) return res("needs_input", "The generated Worker configs are missing. Run the cloudflare step first.", {}, "cloudflare");

  const have: Record<WorkerKey, Set<string> | null> = { api: await existingNames(ctx, configs.api), jobs: await existingNames(ctx, configs.jobs) };
  if (!have.api || !have.jobs) return res("error", "Could not read the list of secrets on the Workers (unexpected output from Wrangler, or the Cloudflare login failed). Nothing was changed. Check `pnpm --filter @gms/api exec wrangler whoami` and re-run.", {}, "secrets");

  const sb = new Supabase(ctx, token);
  const wanted: Record<WorkerKey, string[]> = { api: [...API_SECRETS], jobs: [...JOBS_SECRETS] };
  // Projects that still sign sessions with the legacy HS256 secret need it on the API Worker (docs/self-host.md).
  const signing = await sb.signingKeys(ref);
  const legacySigning = signing !== null && !signing.some((k) => k.algorithm && k.algorithm !== "HS256");
  if (legacySigning) wanted.api.push("SUPABASE_JWT_SECRET");
  // The Resend key on the Workers is the domain-restricted one the email step creates; this step only sets the sender.
  const resendFrom = config.resend ? (state.email?.from as string | undefined) : undefined;
  if (resendFrom) for (const w of ["api", "jobs"] as const) wanted[w].push("RESEND_FROM");

  // Rotation in progress (a .new file that differs from the recovery file) is finished first.
  const main = readRecovery(recoveryPath);
  const pending = readRecovery(newPath);
  const interrupted = RECOVERY_KEYS.filter((k) => pending[k] && pending[k] !== main[k]);
  const rotating = new Set([...requested, ...interrupted]);
  const toSet: Record<WorkerKey, string[]> = {
    api: wanted.api.filter((k) => rotating.has(k) || !have.api!.has(k)),
    jobs: wanted.jobs.filter((k) => rotating.has(k) || !have.jobs!.has(k)),
  };
  const total = toSet.api.length + toSet.jobs.length;
  if (total === 0) return res("skipped", "Every Worker secret is already set.", { api: wanted.api, jobs: wanted.jobs }, "deploy");

  // The two Workers must share the encryption keys. If only one has it and the recovery file does not hold the value, a new one would split them.
  for (const k of ENCRYPTION_KEYS) {
    if (!rotating.has(k) && have.api.has(k) !== have.jobs.has(k) && !main[k]) {
      return res("needs_input", `${k} is set on only one Worker and the recovery file does not hold its value, so a matching one cannot be made. Point --recovery-file at the file that has it, or replace it on both with --rotate ${k} --rotate-keys (this strands anything stored with the old key).`, { name: k }, "secrets");
    }
  }

  const plan = [`set ${toSet.api.length} secret(s) on ${state.workers?.api ?? "the API Worker"} and ${toSet.jobs.length} on ${state.workers?.jobs ?? "the jobs Worker"} (names: ${[...new Set([...toSet.api, ...toSet.jobs])].join(", ")})`, `${rotating.size ? "stage the new keys in" : "write the encryption keys and signing key to"} ${rotating.size ? newPath : recoveryPath}${rotating.size ? `, then replace ${recoveryPath} once every Worker has them (the old file is kept as ${recoveryPath}.previous)` : ""}`];
  if (interrupted.length) plan.unshift(`finish an interrupted rotation of ${interrupted.join(", ")}`);
  if ([...rotating].some((n) => ENCRYPTION_KEYS.includes(n))) plan.unshift("ROTATE KEYS: everything stored with the old CREDENTIALS_ENCRYPTION_KEY or WEBHOOK_SECRET_KEY becomes unreadable");
  const gate = confirmOrDry(ctx, "secrets", plan, { names: { api: toSet.api, jobs: toSet.jobs } });
  if (gate) return gate;

  // Values.
  const keys = await sb.keys(ref);
  if (!keys) return res("error", KEYS_MESSAGE, {}, null);
  const values: Record<string, string> = { SUPABASE_URL: state.supabase.url, SUPABASE_SERVICE_ROLE_KEY: keys.service, SUPABASE_ANON_KEY: keys.anon };
  if (wanted.api.includes("SUPABASE_JWT_SECRET")) {
    const jwt = await sb.jwtSecret(ref);
    if (!jwt) return res("needs_input", "This Supabase project still signs sessions with its legacy JWT secret, and the secret could not be read with this token. Read it from the dashboard (Project Settings, API, JWT Settings) and set it with `wrangler secret put SUPABASE_JWT_SECRET`, or move the project to asymmetric signing keys.", {}, null);
    values.SUPABASE_JWT_SECRET = jwt;
  }
  if (resendFrom) values.RESEND_FROM = resendFrom;
  const pick = (k: string, make: () => string) => (rotating.has(k) ? (pending[k] ?? make()) : (main[k] ?? make()));
  for (const k of ENCRYPTION_KEYS) values[k] = pick(k, () => ctx.random(32).toString("base64url"));
  if (rotating.has("OAUTH_KID") ? pending.OAUTH_KID && pending.OAUTH_SIGNING_KEY_JWK : main.OAUTH_KID && main.OAUTH_SIGNING_KEY_JWK) {
    const src = rotating.has("OAUTH_KID") ? pending : main;
    values.OAUTH_KID = src.OAUTH_KID!;
    values.OAUTH_SIGNING_KEY_JWK = src.OAUTH_SIGNING_KEY_JWK!;
  } else {
    const k = generateSigningKey(ctx.now());
    values.OAUTH_KID = k.kid;
    values.OAUTH_SIGNING_KEY_JWK = k.privateJwk;
  }
  for (const [k, v] of Object.entries(values)) if (k !== "SUPABASE_URL" && k !== "RESEND_FROM") reveal(ctx, v);
  try {
    reveal(ctx, (JSON.parse(values.OAUTH_SIGNING_KEY_JWK!) as { d?: string }).d);
  } catch {
    /* not JSON */
  }

  // The recovery copy exists before any secret is set. Only values this run knows to be live are kept:
  // those already in the file (unless being rotated) and those about to be set.
  const setNow = new Set([...toSet.api, ...toSet.jobs]);
  const kept: Record<string, string> = {};
  for (const k of RECOVERY_KEYS) {
    if (rotating.has(k)) kept[k] = values[k]!;
    else if (main[k]) kept[k] = main[k]!;
    else if (setNow.has(k)) kept[k] = values[k]!;
  }
  writeRecovery(rotating.size ? newPath : recoveryPath, kept);

  for (const w of ["api", "jobs"] as const) {
    for (const name of toSet[w]) {
      ctx.log(`Setting ${name} on the ${w} Worker`);
      const r = await wranglerRun(ctx, ["secret", "put", name, "--config", configs[w]], { input: values[name]! });
      if (r.code !== 0) return res("error", `Could not set ${name} on the ${w} Worker: ${brief(ctx, r)}.${rotating.size ? ` The new keys are kept in ${newPath}; re-run the same command to finish. Do not delete either file.` : " Nothing is lost; re-run to continue."}`, { worker: w, name }, "secrets");
    }
  }
  if (rotating.size) {
    if (existsSync(recoveryPath)) writeRecovery(`${recoveryPath}.previous`, readRecovery(recoveryPath));
    renameSync(newPath, recoveryPath);
  }
  patchState(ctx, { secrets: { api: wanted.api, jobs: wanted.jobs, recoveryFileWritten: true, at: ctx.now().toISOString() }, supabase: { legacySigning } });
  return res("ok", `Set ${total} secret(s) and ${rotating.size ? "replaced" : "wrote"} the recovery file (mode 0600). Store that file safely now.`, { api: toSet.api, jobs: toSet.jobs }, "deploy");
}
