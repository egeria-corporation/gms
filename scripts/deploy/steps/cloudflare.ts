// SPDX-License-Identifier: AGPL-3.0-only
// cloudflare: the R2 buckets, queues and KV namespace the Workers bind, and generated Wrangler configs.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cfAccount, cfRest, cfToken } from "../cloudflare.ts";
import type { Ctx, Result } from "../core.ts";
import { brief, confirmOrDry, isResult, loadState, names, patchState, requireConfig, res, wranglerRun, writeText } from "../core.ts";
import { generateConfig, HEADER } from "../generate.ts";

const ALREADY = /already exists|already taken|10004|11009/i;

async function existingBuckets(ctx: Ctx): Promise<Set<string> | null> {
  const r = await wranglerRun(ctx, ["r2", "bucket", "list"]);
  if (r.code !== 0) return null;
  return new Set([...r.stdout.matchAll(/^\s*name:\s*(\S+)/gm)].map((m) => m[1]!));
}
async function queueExists(ctx: Ctx, name: string): Promise<boolean> {
  return (await wranglerRun(ctx, ["queues", "info", name])).code === 0;
}
async function workerExists(ctx: Ctx, name: string): Promise<boolean> {
  return (await wranglerRun(ctx, ["deployments", "list", "--name", name])).code === 0;
}
async function kvNamespaces(ctx: Ctx): Promise<{ id: string; title: string }[] | null> {
  const r = await wranglerRun(ctx, ["kv", "namespace", "list"]);
  if (r.code !== 0) return null;
  try {
    const j = JSON.parse(r.stdout.slice(r.stdout.indexOf("[")));
    return Array.isArray(j) ? j : null;
  } catch {
    return null;
  }
}

/** The account's workers.dev subdomain (needs a token; otherwise --workers-subdomain at init). */
async function workersSubdomain(ctx: Ctx, accountId: string): Promise<string | null> {
  if (!cfToken(ctx)) return null;
  const r = await cfRest(ctx, "GET", `/accounts/${accountId}/workers/subdomain`);
  return r.status === 200 ? (r.body?.result?.subdomain ?? null) : null;
}

export function renderConfigs(ctx: Ctx, instance: string, url: string, kvId: string, passport: { on: boolean; url?: string }) {
  const n = names(instance);
  const make = (app: "api" | "jobs", workerName: string) =>
    HEADER(`${app} Worker`) + generateConfig(readFileSync(join(ctx.root, "apps", app, "wrangler.toml"), "utf8"), { name: instance, workerName, url, kvId, appDir: join(ctx.root, "apps", app), passport, dropAssets: app === "api" });
  return { api: make("api", n.api), jobs: make("jobs", n.jobs) };
}

export async function cloudflare(ctx: Ctx): Promise<Result> {
  const config = requireConfig(ctx);
  if (isResult(config)) return config;
  const account = await cfAccount(ctx);
  if (isResult(account)) return account;
  const n = names(config.name);
  const state = loadState(ctx);

  // The instance address.
  let subdomain: string | null = state.cloudflare?.workersSubdomain ?? config.workersSubdomain;
  if (!config.host && !subdomain) subdomain = await workersSubdomain(ctx, account.id);
  if (!config.host && !subdomain) return res("needs_input", "No custom domain was chosen, so the address will be on workers.dev, but this account's workers.dev subdomain could not be read. Re-run init with --workers-subdomain <name> (the part before .workers.dev), or set CLOUDFLARE_API_TOKEN, or choose --host.", {}, "init");
  const url = config.host ? `https://${config.host}` : `https://${n.web}.${subdomain}.workers.dev`;

  // What exists.
  const buckets = await existingBuckets(ctx);
  if (!buckets) return res("error", "Could not list R2 buckets. Check that R2 is enabled for the Cloudflare account and the login can use it.", {}, null);
  const missingBuckets = n.buckets.filter((b) => !buckets.has(b));
  const missingQueues: string[] = [];
  for (const q of n.queues) if (!(await queueExists(ctx, q))) missingQueues.push(q);
  const kvList = await kvNamespaces(ctx);
  if (!kvList) return res("error", "Could not list KV namespaces.", {}, null);
  let kvId: string | undefined = kvList.find((k) => k.title === n.kv)?.id;

  // Things that already exist under this instance's names but were not created by this tool: adopting
  // them would mean overwriting another app's Worker or using its bucket.
  const owned = new Set<string>(state.cloudflare?.owned ?? []);
  const foreign: string[] = [];
  for (const b of n.buckets) if (buckets.has(b) && !owned.has(`r2:${b}`)) foreign.push(`R2 bucket ${b}`);
  for (const q of n.queues) if (!missingQueues.includes(q) && !owned.has(`queue:${q}`)) foreign.push(`queue ${q}`);
  if (kvId && !owned.has(`kv:${n.kv}`)) foreign.push(`KV namespace ${n.kv}`);
  for (const w of [n.api, n.jobs, n.web]) if (!owned.has(`worker:${w}`) && (await workerExists(ctx, w))) foreign.push(`Worker ${w}`);
  if (foreign.length && !ctx.dryRun && ctx.flags["adopt-existing"] !== true) {
    return res("needs_confirmation", `These already exist in the Cloudflare account and were not created by this tool: ${foreign.join(", ")}. Using them would reuse their data and overwrite those Workers on deploy. If they really belong to this instance (for example you are resuming after losing deploy/state.json), re-run with --adopt-existing. Otherwise choose another name with init --name.`, { existing: foreign }, "cloudflare");
  }
  const ownedNow = [...new Set([...owned, ...n.buckets.map((b) => `r2:${b}`), ...n.queues.map((q) => `queue:${q}`), `kv:${n.kv}`, ...[n.api, n.jobs, n.web].map((w) => `worker:${w}`)])];

  const plan: string[] = [];
  if (foreign.length) plan.push(`use existing ${foreign.join(", ")}`);
  if (missingBuckets.length) plan.push(`create R2 bucket(s) ${missingBuckets.join(", ")}`);
  if (missingQueues.length) plan.push(`create queue(s) ${missingQueues.join(", ")}`);
  if (!kvId) plan.push(`create the KV namespace ${n.kv}`);

  const writeConfigs = (id: string) => {
    const rendered = renderConfigs(ctx, config.name, url, id, { on: config.passport, url: config.passportUrl });
    let changed = 0;
    for (const [app, text] of Object.entries(rendered)) {
      const path = join(ctx.deployDir, "generated", `${app}.toml`);
      let old = "";
      try {
        old = readFileSync(path, "utf8");
      } catch {
        /* not there yet */
      }
      if (old !== text) {
        writeText(ctx, path, text);
        changed++;
      }
    }
    return changed;
  };

  const next = state.auth?.configured ? "secrets" : "auth";
  if (plan.length === 0) {
    if (ctx.dryRun) return res("ok", "Dry run. All resources exist; would refresh the generated Worker configs.", { dryRun: true }, next);
    const changed = writeConfigs(kvId!);
    patchState(ctx, { cloudflare: { accountId: account.id, kvId, buckets: n.buckets, queues: n.queues, owned: ownedNow, workersSubdomain: subdomain }, workers: { api: n.api, jobs: n.jobs, web: n.web }, urls: { instance: url } });
    return changed ? res("ok", "All resources already exist; refreshed the generated Worker configs.", { url }, next) : res("skipped", "All resources and generated configs are already in place.", { url }, next);
  }

  const gate = confirmOrDry(ctx, "cloudflare", plan, { url });
  if (gate) return gate;

  for (const b of missingBuckets) {
    ctx.log(`Creating R2 bucket ${b}`);
    const r = await wranglerRun(ctx, ["r2", "bucket", "create", b]);
    if (r.code !== 0 && !ALREADY.test(r.stdout + r.stderr)) return res("error", `Could not create bucket ${b}: ${brief(ctx, r)}`, {}, "cloudflare");
  }
  for (const q of missingQueues) {
    ctx.log(`Creating queue ${q}`);
    const r = await wranglerRun(ctx, ["queues", "create", q]);
    if (r.code !== 0 && !ALREADY.test(r.stdout + r.stderr)) return res("error", `Could not create queue ${q}: ${brief(ctx, r)}`, {}, "cloudflare");
  }
  if (!kvId) {
    ctx.log(`Creating KV namespace ${n.kv}`);
    const r = await wranglerRun(ctx, ["kv", "namespace", "create", n.kv]);
    if (r.code !== 0 && !ALREADY.test(r.stdout + r.stderr)) return res("error", `Could not create the KV namespace: ${brief(ctx, r)}`, {}, "cloudflare");
    kvId = (await kvNamespaces(ctx))?.find((k) => k.title === n.kv)?.id;
    if (!kvId) return res("error", "The KV namespace was created but its id could not be read back. Re-run this step.", {}, "cloudflare");
  }
  writeConfigs(kvId);
  patchState(ctx, { cloudflare: { accountId: account.id, kvId, buckets: n.buckets, queues: n.queues, owned: ownedNow, workersSubdomain: subdomain }, workers: { api: n.api, jobs: n.jobs, web: n.web }, urls: { instance: url } });
  return res("ok", `Created ${plan.length} resource group(s) and wrote the Worker configs under deploy/generated/.`, { created: plan, url }, next);
}
