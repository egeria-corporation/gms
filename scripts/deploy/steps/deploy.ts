// SPDX-License-Identifier: AGPL-3.0-only
// deploy: build, then deploy the API Worker, the jobs Worker and the single front Worker that
// serves the web app and forwards API paths to the API Worker over a service binding.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Ctx, Result } from "../core.ts";
import { brief, confirmOrDry, isResult, loadState, names, patchState, requireConfig, res } from "../core.ts";
import { Supabase, supabaseToken } from "../supabase-api.ts";
import { LOGIN_MESSAGE } from "./supabase.ts";

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
  if (!state.secrets?.api) return res("needs_input", "Worker secrets are not set yet. Run the secrets step first.", {}, "secrets");
  const token = supabaseToken(ctx);
  if (!token) return res("needs_login", LOGIN_MESSAGE, {}, null);

  const url = state.urls.instance as string;
  const n = names(config.name);
  const { version, commit } = await currentVersion(ctx);
  if (state.deploy?.version === version && state.deploy?.commit === commit && !version.endsWith("-dirty") && ctx.flags.force !== true) {
    return res("skipped", `Version ${version} is already deployed at ${url}.`, { version, url }, "verify");
  }

  const gate = confirmOrDry(ctx, "deploy", [
    `build the API description and the web app (pointing at ${url})`,
    `deploy the Workers ${n.api}, ${n.jobs} and ${n.web}${config.host ? `, and attach ${config.host} to ${n.web}` : " on workers.dev"}`,
    `version ${version}`,
  ], { version, url });
  if (gate) return gate;

  const step = async (label: string, cmd: string, args: string[], env?: Record<string, string>) => {
    ctx.log(label);
    const r = await ctx.run(cmd, args, { cwd: ctx.root, env });
    return r.code === 0 ? null : res("error", `${label} failed: ${brief(ctx, r)}`, { stage: label }, "deploy");
  };
  const keys = await new Supabase(ctx, token).keys(state.supabase.ref);
  if (!keys) return res("error", "Could not read the Supabase API keys.", {}, null);

  const wrangler = (app: string, config_: string) => ["--filter", app, "exec", "wrangler", "deploy", "--config", config_];
  const stages: [string, string, string[], Record<string, string>?][] = [
    ["Compiling the API description", "pnpm", ["spec:compile"]],
    ["Building the OpenAPI document", "pnpm", ["--filter", "@gms/api", "build:openapi"]],
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

  patchState(ctx, { deploy: { version, commit, at: ctx.now().toISOString(), urls: { instance: url, api: `${url}/gms/config` } }, version });
  return res("ok", `Deployed ${version} to ${url}.`, { version, url }, "verify");
}
