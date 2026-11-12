// SPDX-License-Identifier: AGPL-3.0-only
// Shared types and helpers for the deploy tool: the result line, the context every step receives
// (fetch, command runner and output are injected so tests use fakes), config and state files, and
// the redactor that keeps secret values out of everything the tool prints or writes.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export type Code = "ok" | "skipped" | "needs_login" | "needs_input" | "needs_confirmation" | "plan_limit" | "error";

export interface Result {
  code: Code;
  message: string;
  data?: Record<string, unknown>;
  next?: string | null;
}

export interface RunOptions {
  input?: string;
  cwd?: string;
  env?: Record<string, string>;
}
export interface RunOut {
  code: number;
  stdout: string;
  stderr: string;
}

export type Flags = Record<string, string | boolean>;

export interface Ctx {
  /** Repository root. */
  root: string;
  /** Where config.json, state.json and generated/ live (default <root>/deploy). */
  deployDir: string;
  env: Record<string, string | undefined>;
  home: string;
  nodeVersion: string;
  fetch: typeof fetch;
  run: (cmd: string, args: string[], opts?: RunOptions) => Promise<RunOut>;
  /** Progress for a person: stderr. */
  log: (message: string) => void;
  sleep: (ms: number) => Promise<void>;
  random: (bytes: number) => Buffer;
  now: () => Date;
  flags: Flags;
  yes: boolean;
  dryRun: boolean;
  /** Values that must never be printed or stored. */
  secrets: Set<string>;
}

export function res(code: Code, message: string, data: Record<string, unknown> = {}, next: string | null = null): Result {
  return { code, message, data, next };
}

export const exitCodeFor = (code: Code): number => (code === "ok" || code === "skipped" ? 0 : code === "error" ? 1 : 3);

/** Register a value as secret so redact() removes it from any text. Short values are ignored (they would mangle ordinary words). */
export function reveal(ctx: Ctx, value: string | undefined | null): string {
  if (value && value.length >= 8) ctx.secrets.add(value);
  return value ?? "";
}

export function redact(ctx: Ctx, text: string): string {
  let out = text;
  for (const s of ctx.secrets) if (s) out = out.split(s).join("[redacted]");
  return out;
}

export function flagStr(ctx: Ctx, name: string): string | undefined {
  const v = ctx.flags[name];
  return typeof v === "string" ? v : undefined;
}

const BOOLEAN_FLAGS = new Set(["yes", "dry-run", "rotate", "force", "help"]);
export function parseArgs(argv: string[]): { positional: string[]; flags: Flags } {
  const positional: string[] = [];
  const flags: Flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith("--")) {
      positional.push(a);
      continue;
    }
    const eq = a.indexOf("=");
    if (eq > 0) {
      flags[a.slice(2, eq)] = a.slice(eq + 1);
      continue;
    }
    const name = a.slice(2);
    const next = argv[i + 1];
    if (BOOLEAN_FLAGS.has(name) || next === undefined || next.startsWith("--")) flags[name] = true;
    else {
      flags[name] = next;
      i++;
    }
  }
  return { positional, flags };
}

// ---- config and state ----

export interface Config {
  name: string;
  /** Custom domain, or null for workers.dev. */
  host: string | null;
  region: string;
  org: string | null;
  email: string | null;
  passport: boolean;
  passportUrl: string;
  resend: boolean;
  /** The account's workers.dev subdomain, when it could not be read from the API. */
  workersSubdomain: string | null;
}

export type State = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const readJson = <T>(path: string): T | null => {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
};

export function loadConfig(ctx: Ctx): Config | null {
  return readJson<Config>(join(ctx.deployDir, "config.json"));
}
export function saveConfig(ctx: Ctx, config: Config): void {
  mkdirSync(ctx.deployDir, { recursive: true });
  writeFileSync(join(ctx.deployDir, "config.json"), JSON.stringify(config, null, 2) + "\n");
}
export function loadState(ctx: Ctx): State {
  return readJson<State>(join(ctx.deployDir, "state.json")) ?? {};
}
/** Merge a patch into one section (or replace a scalar) of state.json. Refuses to write a registered secret. */
export function patchState(ctx: Ctx, patch: State): State {
  const state = loadState(ctx);
  for (const [k, v] of Object.entries(patch)) {
    state[k] = v && typeof v === "object" && !Array.isArray(v) && state[k] && typeof state[k] === "object" ? { ...state[k], ...v } : v;
  }
  const text = JSON.stringify(state, null, 2) + "\n";
  if (redact(ctx, text) !== text) throw new Error("refusing to write a secret value into state.json");
  mkdirSync(ctx.deployDir, { recursive: true });
  writeFileSync(join(ctx.deployDir, "state.json"), text);
  return state;
}

/** Write a file under deploy/. Refuses text that contains a registered secret. */
export function writeText(ctx: Ctx, path: string, text: string): void {
  if (redact(ctx, text) !== text) throw new Error(`refusing to write a secret value to ${path}`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

export function requireConfig(ctx: Ctx): Config | Result {
  const c = loadConfig(ctx);
  if (!c) return res("needs_input", "There is no deploy/config.json yet. Run init first to record the instance name, domain and region.", {}, "init");
  return c;
}
export const isResult = (x: unknown): x is Result => !!x && typeof x === "object" && "code" in x && "message" in x;

/** The instance's public origin, once known. */
export function instanceUrl(config: Config, state: State): string | null {
  if (config.host) return `https://${config.host}`;
  const sub = state.cloudflare?.workersSubdomain ?? config.workersSubdomain;
  return sub ? `https://${config.name}-web.${sub}.workers.dev` : null;
}

export const names = (name: string) => ({
  api: `${name}-api`,
  jobs: `${name}-jobs`,
  web: `${name}-web`,
  buckets: [`${name}-attachments`, `${name}-ledger-archive`, `${name}-exports`],
  queues: [`${name}-events`, `${name}-events-dlq`],
  kv: `${name}-rate-limit`,
});

export const wranglerRun = (ctx: Ctx, args: string[], opts: RunOptions = {}) =>
  ctx.run("pnpm", ["--filter", "@gms/api", "exec", "wrangler", ...args], { cwd: ctx.root, ...opts });

/** A short plain description of a failed command, secrets removed. */
export function brief(ctx: Ctx, out: RunOut): string {
  const text = redact(ctx, `${out.stderr}\n${out.stdout}`).replace(/\u001b\[[0-9;]*m/g, "").trim();
  return text.split("\n").filter(Boolean).slice(-3).join(" ").slice(0, 300) || `exit code ${out.code}`;
}

export function confirmOrDry(ctx: Ctx, step: string, willDo: string[], data: Record<string, unknown> = {}): Result | null {
  if (ctx.dryRun) return res("ok", `Dry run. This would: ${willDo.join("; ")}.`, { ...data, dryRun: true, plan: willDo }, null);
  if (!ctx.yes) return res("needs_confirmation", `This will: ${willDo.join("; ")}. Ask the person, then re-run with --yes.`, { ...data, plan: willDo }, step);
  return null;
}
