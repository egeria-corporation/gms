// SPDX-License-Identifier: AGPL-3.0-only
// deploy: build, then deploy the API Worker, the jobs Worker and the single front Worker that
// serves the web app and forwards API paths to the API Worker over a service binding.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cfToken, hostUsage } from "../cloudflare.ts";
import type { Ctx, Result } from "../core.ts";
import { brief, confirmOrDry, isResult, loadState, names, patchState, requireConfig, res } from "../core.ts";
import { KEYS_MESSAGE, Supabase, supabaseToken } from "../supabase-api.ts";
import { LOGIN_MESSAGE } from "./supabase.ts";

/** Wrangler/Cloudflare wording for plan limits: cron triggers per account, script size. */
export const PLAN_LIMIT = /exceeded the limit of \d+ cron|too many cron|cron triggers? limit|script (is )?too large|exceeds the size limit|workers paid|10027|10054|upgrade (to|your) .*plan/i;

/** Must equal OPENAPI_OBJECT_KEY in apps/api/src/index.ts (a test checks). */
export const OPENAPI_OBJECT_KEY = "site/openapi.json";

export async function currentVersion(ctx: Ctx): Promise<{ version: string; commit: string }> {
  const d = await ctx.run("git", ["describe", "--tags", "--always", "--dirty"], { cwd: ctx.root });
  const c = await ctx.run("git", ["rev-parse", "HEAD"], { cwd: ctx.root });
  return { version: d.code === 0 ? d.stdout.trim() : "unknown", commit: c.code === 0 ? c.stdout.trim() : "unknown" };
}

/** The front Worker's config for workers.dev: no custom-domain route. */
export function forWorkersDev(toml: string): string {
  return toml.replace(/^workers_dev = false$/m, "workers_dev = true").replace(/^routes = \[.*\]$/m, "").replace(/\n{3,}/g, "\n\n");
}

export async function deploy(ctx: Ctx): Promise<Result> {
  const config = requireConfig(ctx);
  if (isResult(config)) return config;
  const state = loadState(ctx);
  const gen = join(ctx.deployDir, "generated");
  if (!state.supabase?.ref || !state.urls?.instance || !existsSync(join(gen, "api.toml"))) return res("needs_input", "Resources are not ready. Run supabase, migrate, auth, cloudflare and secrets first.", {}, "cloudflare");
  if (readFileSync(join(gen, "api.toml"), "utf8").includes("[assets]")) return res("needs_input", "The generated API Worker config still has a static-assets block, which needs a token that can upload assets. Re-run the cloudflare step to regenerate it.", {}, "cloudflare");
  if (!state.secrets?.api) return res("needs_input", "Worker secrets are not set yet. Run the secrets step first.", {}, "secrets");
  const token = supabaseToken(ctx);
  if (!token) return res("needs_login", LOGIN_MESSAGE, {}, null);

  const url = state.urls.instance as string;
  const n = names(config.name);
  const { version, commit } = await currentVersion(ctx);
  if (state.deploy?.version === version && state.deploy?.commit === commit && !version.endsWith("-dirty") && ctx.flags.force !== true) {
    return res("skipped", `Version ${version} is already deployed at ${url}.`, { version, url }, "verify");
  }

  if (!state.auth?.configured) return res("needs_input", "Supabase Auth has not been set up yet, so sign-in would use Supabase's defaults. Run the auth step first.", {}, "auth");

  // A custom domain is attached with "override existing DNS", and Wrangler cannot ask here. Look first.
  const conflicts: string[] = [];
  if (config.host && !state.deploy?.domainAttached) {
    const usage = await hostUsage(ctx, state.cloudflare.accountId, config.host, n.web);
    conflicts.push(...usage.items);
    if (!usage.checked) conflicts.push(`unknown: ${cfToken(ctx) ? "Cloudflare would not say" : "no CLOUDFLARE_API_TOKEN, so this tool cannot see"} what already uses ${config.host}`);
  }
  if (conflicts.length && !ctx.dryRun && ctx.flags["replace-dns"] !== true) {
    return res("needs_confirmation", `Attaching ${config.host} to ${n.web} would replace whatever uses it now: ${conflicts.join("; ")}. If ${config.host} is not in use (or you want it replaced), re-run with --replace-dns --yes. Otherwise choose another host with init --host.`, { conflicts, plan: ["replace what uses " + config.host] }, "deploy");
  }

  const gate = confirmOrDry(ctx, "deploy", [
    ...(conflicts.length ? [`REPLACE what uses ${config.host} now: ${conflicts.join("; ")}`] : []),
    `build the API description and the web app (pointing at ${url})`,
    `deploy the Workers ${n.api}, ${n.jobs} and ${n.web}${config.host ? `, and attach ${config.host} to ${n.web}` : " on workers.dev"}`,
    `version ${version}`,
  ], { version, url });
  if (gate) return gate;

  const step = async (label: string, cmd: string, args: string[], env?: Record<string, string>) => {
    ctx.log(label);
    const r = await ctx.run(cmd, args, { cwd: ctx.root, env });
    if (r.code === 0) return null;
    // Free-plan limits (cron triggers, Worker size) surface as plain command failures.
    if (PLAN_LIMIT.test(`${r.stdout}\n${r.stderr}`)) return res("plan_limit", `${label}: Cloudflare says this plan does not allow it (${brief(ctx, r)}). The front Worker carries the whole web app, and the account's limits on Workers (size, scheduled triggers) may be exceeded; the Workers Paid plan lifts them.`, { stage: label }, null);
    return res("error", `${label} failed: ${brief(ctx, r)}`, { stage: label }, "deploy");
  };
  const keys = await new Supabase(ctx, token).keys(state.supabase.ref);
  if (!keys) return res("error", KEYS_MESSAGE, {}, null);

  const wrangler = (app: string, config_: string) => ["--filter", app, "exec", "wrangler", "deploy", "--config", config_];
  const stages: [string, string, string[], Record<string, string>?][] = [
    ["Compiling the API description", "pnpm", ["spec:compile"]],
    ["Building the OpenAPI document", "pnpm", ["--filter", "@gms/api", "build:openapi"]],
    // No static assets: the API Worker serves /openapi.json from the exports bucket (OPENAPI_OBJECT_KEY in apps/api/src/index.ts).
    ["Uploading the OpenAPI document", "pnpm", ["--filter", "@gms/api", "exec", "wrangler", "r2", "object", "put", `${n.buckets[2]}/${OPENAPI_OBJECT_KEY}`, "--file", join(ctx.root, "apps", "api", "public", "openapi.json"), "--content-type", "application/json", "--remote"]],
    ["Deploying the API Worker", "pnpm", wrangler("@gms/api", join(gen, "api.toml"))],
    ["Deploying the jobs Worker", "pnpm", wrangler("@gms/jobs", join(gen, "jobs.toml"))],
    [
      "Building the web app",
      "pnpm",
      ["--filter", "@gms/web", "build"],
      {
        VITE_USE_MOCKS: "false",
        VITE_API_BASE_URL: url,
        VITE_SUPABASE_URL: state.supabase.url,
        VITE_SUPABASE_ANON_KEY: keys.anon,
        ...(config.passport ? { VITE_PASSPORT_BASE_URL: config.passportUrl } : {}),
      },
    ],
  ];
  for (const [label, cmd, args, env] of stages) {
    const failed = await step(label, cmd, args, env);
    if (failed) return failed;
  }

  const host = new URL(url).host;
  const front = await step("Building the front Worker", "node", ["scripts/build-front-worker.mjs", "--name", n.web, "--host", host, "--api", n.api]);
  if (front) return front;
  const frontToml = join(ctx.root, "apps", "web", ".front-worker", "wrangler.toml");
  if (!config.host && existsSync(frontToml)) writeFileSync(frontToml, forWorkersDev(readFileSync(frontToml, "utf8")));
  const pushed = await step("Deploying the front Worker", "pnpm", ["--filter", "@gms/web", "exec", "wrangler", "deploy", "--config", ".front-worker/wrangler.toml"]);
  if (pushed) return pushed;

  patchState(ctx, { deploy: { domainAttached: !!config.host, version, commit, at: ctx.now().toISOString(), urls: { instance: url, api: `${url}/gms/config` } }, version });
  return res("ok", `Deployed ${version} to ${url}.`, { version, url }, "verify");
}
