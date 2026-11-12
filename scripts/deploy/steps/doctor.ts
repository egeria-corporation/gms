// SPDX-License-Identifier: AGPL-3.0-only
// doctor: what is installed, which logins work, how many Supabase projects exist, and whether the
// checkout is a clean tagged release. Changes nothing.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cfAccount, cfLogin } from "../cloudflare.ts";
import type { Ctx, Result } from "../core.ts";
import { flagStr, loadConfig, res } from "../core.ts";
import { isActiveProject, LOGIN_MESSAGE, Supabase, supabaseToken } from "../supabase-api.ts";

export async function doctor(ctx: Ctx): Promise<Result> {
  const problems: string[] = [];
  const warnings: string[] = [];
  const data: Record<string, unknown> = {};

  const major = Number(ctx.nodeVersion.replace(/^v/, "").split(".")[0]);
  data.node = ctx.nodeVersion;
  if (!(major >= 22)) problems.push(`Node ${ctx.nodeVersion} is too old; Node 22 or newer is needed`);
  for (const [tool, args] of [["pnpm", ["--version"]], ["git", ["--version"]]] as const) {
    const r = await ctx.run(tool, [...args], { cwd: ctx.root });
    data[tool] = r.code === 0 ? r.stdout.trim().split("\n")[0] : null;
    if (r.code !== 0) problems.push(`${tool} is not installed`);
  }
  const w = await ctx.run("pnpm", ["--filter", "@gms/api", "exec", "wrangler", "--version"], { cwd: ctx.root });
  data.wrangler = w.code === 0 ? w.stdout.trim().split("\n").pop() : null;
  if (w.code !== 0) problems.push("Wrangler is not available; run `pnpm install`");

  // Cloudflare
  const cf = await cfLogin(ctx);
  data.cloudflare = { loggedIn: cf.loggedIn, via: cf.via };
  if (cf.loggedIn) {
    const account = await cfAccount(ctx);
    if ("id" in account) data.cloudflareAccountId = account.id;
    else warnings.push(account.message);
  }

  // Supabase
  const token = supabaseToken(ctx);
  data.supabase = { loggedIn: !!token, source: token ? (ctx.env.SUPABASE_ACCESS_TOKEN ? "SUPABASE_ACCESS_TOKEN" : "access-token file") : null };
  let supabaseNeedsLogin = !token;
  if (token) {
    const api = new Supabase(ctx, token);
    const orgFlag = flagStr(ctx, "org") ?? loadConfig(ctx)?.org ?? null;
    const orgs = await api.organizations();
    if (orgs.status === 401) supabaseNeedsLogin = true;
    else if (orgs.status === 200 && Array.isArray(orgs.body)) {
      data.organizations = orgs.body.map((o) => ({ id: o.id, name: o.name }));
    } else if (!orgFlag) warnings.push("The Supabase token cannot list organizations. Pass --org <organization slug> to init.");
    if (!supabaseNeedsLogin) {
      const list = await api.projects();
      if (list.status === 200 && Array.isArray(list.body)) {
        const hit = Array.isArray(orgs.body) ? orgs.body.find((o) => o.slug === orgFlag || o.id === orgFlag) : undefined;
        const orgIds = new Set([orgFlag, hit?.id, hit?.slug].filter(Boolean) as string[]);
        const mine = list.body.filter((p) => isActiveProject(p) && (!orgFlag || orgIds.has(p.organization_id ?? "") || orgIds.has(p.organization_slug ?? "")));
        data.supabaseActiveProjects = mine.length;
        if (mine.length >= 2) warnings.push(`The Supabase organization already has ${mine.length} active projects. The free plan allows 2; a third may need a paid plan.`);
      } else warnings.push("Could not list Supabase projects.");
    }
  }

  // The jobs Worker's schedule: the Workers Free plan allows 5 cron triggers per account.
  try {
    const jobs = readFileSync(join(ctx.root, "apps", "jobs", "wrangler.toml"), "utf8");
    const block = /\[env\.production\.triggers\]\s*\ncrons\s*=\s*\[([^\]]*)\]/.exec(jobs)?.[1] ?? "";
    const crons = (block.match(/"[^"]+"/g) ?? []).length;
    data.cronTriggers = crons;
    if (crons > 5) warnings.push(`The jobs Worker uses ${crons} scheduled triggers. The Workers Free plan allows 5 per account, so deploying needs the Workers Paid plan.`);
    else if (crons > 1) warnings.push(`The jobs Worker declares ${crons} scheduled triggers; keep it to one so the Workers Free plan (5 per account) is enough.`);
  } catch {
    /* no jobs config to read */
  }

  // Checkout
  const tag = await ctx.run("git", ["describe", "--tags", "--exact-match"], { cwd: ctx.root });
  const dirty = await ctx.run("git", ["status", "--porcelain"], { cwd: ctx.root });
  data.release = tag.code === 0 ? tag.stdout.trim() : null;
  data.cleanCheckout = dirty.code === 0 && dirty.stdout.trim() === "";
  if (!data.release) warnings.push("This checkout is not at a tagged release. Fine for trying things; deploy a tagged release for a real instance.");
  if (!data.cleanCheckout) warnings.push("The checkout has uncommitted changes.");
  data.warnings = warnings;

  if (problems.length) return res("error", `${problems.join("; ")}.`, { ...data, problems }, null);
  const missing = [!cf.loggedIn && "Cloudflare", supabaseNeedsLogin && "Supabase"].filter(Boolean);
  if (missing.length) {
    const how = [
      !cf.loggedIn && "Cloudflare: run `pnpm --filter @gms/api exec wrangler login` or set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID",
      supabaseNeedsLogin && `Supabase: ${LOGIN_MESSAGE}`,
    ].filter(Boolean);
    return res("needs_login", `Not signed in to ${missing.join(" and ")}. ${how.join(". ")}.`, data, null);
  }
  return res("ok", warnings.length ? `Ready, with ${warnings.length} thing(s) to note: ${warnings.join(" ")}` : "Everything needed is in place.", data, "init");
}
