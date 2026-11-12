// SPDX-License-Identifier: AGPL-3.0-only
// verify: the instance answers as it should, then a sign-in code goes to the operator.
import type { Ctx, Result } from "../core.ts";
import { confirmOrDry, isResult, loadState, patchState, requireConfig, res } from "../core.ts";
import { KEYS_MESSAGE, Supabase, supabaseToken } from "../supabase-api.ts";
import { LOGIN_MESSAGE } from "./supabase.ts";

interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

async function get(ctx: Ctx, url: string): Promise<{ status: number; text: string; json: any } | null> { // eslint-disable-line @typescript-eslint/no-explicit-any
  try {
    const r = await ctx.fetch(url, { headers: { Accept: "application/json, text/html" } });
    const text = await r.text();
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* not JSON */
    }
    return { status: r.status, text, json };
  } catch {
    return null;
  }
}

export async function runChecks(ctx: Ctx, url: string): Promise<Check[]> {
  const checks: Check[] = [];
  const add = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });

  const health = await get(ctx, `${url}/health`);
  add("health", health?.status === 200 && health.json?.database === "configured", health ? (health.json?.database === "configured" ? "the API is up and the database is configured" : `the API answered but the database reads "${health.json?.database ?? "unknown"}"`) : "no answer");

  const jwks = await get(ctx, `${url}/.well-known/jwks.json`);
  add("signing key", jwks?.status === 200 && Array.isArray(jwks.json?.keys) && jwks.json.keys.length > 0, jwks?.status === 200 ? "the signing key is published" : `status ${jwks?.status ?? "no answer"}`);

  const meta = await get(ctx, `${url}/.well-known/oauth-authorization-server`);
  const issuer = meta?.json?.issuer as string | undefined;
  add("sign-in server", meta?.status === 200 && issuer?.replace(/\/$/, "") === url, meta?.status === 200 ? (issuer?.replace(/\/$/, "") === url ? "the issuer matches the instance address" : `the issuer is ${issuer ?? "missing"}, not ${url}`) : `status ${meta?.status ?? "no answer"}`);

  const cfg = await get(ctx, `${url}/gms/config`);
  add("settings", cfg?.status === 200 && !!cfg.json, cfg?.status === 200 ? "the app settings are served" : `status ${cfg?.status ?? "no answer"}`);

  const page = await get(ctx, `${url}/`);
  add("sign-in page", page?.status === 200 && /<html|<!doctype/i.test(page.text), page?.status === 200 ? "the web app loads" : `status ${page?.status ?? "no answer"}`);
  return checks;
}

export async function verify(ctx: Ctx): Promise<Result> {
  const config = requireConfig(ctx);
  if (isResult(config)) return config;
  const state = loadState(ctx);
  const url = state.urls?.instance as string | undefined;
  if (!url) return res("needs_input", "The instance address is not recorded yet. Run the cloudflare and deploy steps first.", {}, "cloudflare");
  const ref = state.supabase?.ref as string | undefined;
  if (!ref) return res("needs_input", "There is no Supabase project yet.", {}, "supabase");
  if (!config.email) return res("needs_input", "No operator email is recorded. Run init --email <address>.", {}, "init");

  if (ctx.dryRun) return res("ok", `Dry run. Would check ${url} and send a sign-in code to ${config.email}.`, { dryRun: true }, null);
  const checks = await runChecks(ctx, url);
  // A project that signs sessions with its legacy secret breaks sign-in without SUPABASE_JWT_SECRET on the API Worker.
  if (state.supabase?.legacySigning && !(state.secrets?.api ?? []).includes("SUPABASE_JWT_SECRET")) checks.push({ name: "session signing", ok: false, detail: "this Supabase project signs sessions with its legacy secret but SUPABASE_JWT_SECRET is not set on the API Worker; run the secrets step" });
  const failed = checks.filter((c) => !c.ok);
  const record = (extra: Check[]) => patchState(ctx, { verify: { at: ctx.now().toISOString(), ok: [...checks, ...extra].every((c) => c.ok), checks: [...checks, ...extra] } });
  if (failed.length) {
    record([]);
    return res("error", `${failed.length} check(s) failed: ${failed.map((c) => `${c.name} (${c.detail})`).join("; ")}.`, { checks }, "verify");
  }
  const gate = confirmOrDry(ctx, "verify", [`send a sign-in code to ${config.email} through Supabase Auth (this also creates that sign-in account if it is new)`], { checks });
  if (gate) return gate;

  const token = supabaseToken(ctx);
  if (!token) return res("needs_login", LOGIN_MESSAGE, {}, null);
  const keys = await new Supabase(ctx, token).keys(ref);
  if (!keys) return res("error", KEYS_MESSAGE, { checks }, null);
  const r = await ctx.fetch(`${state.supabase.url}/auth/v1/otp`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: keys.anon },
    body: JSON.stringify({ email: config.email, create_user: true }),
  });
  const otp: Check = { name: "sign-in code", ok: r.status < 300, detail: r.status < 300 ? `a code was sent to ${config.email}` : `Supabase answered ${r.status} when sending the code${r.status === 429 ? " (too many requests; wait a minute)" : ""}` };
  record([otp]);
  if (!otp.ok) return res("error", otp.detail + ".", { checks: [...checks, otp] }, "verify");
  return res("ok", `All checks passed and a sign-in code was sent to ${config.email}.`, { checks: [...checks, otp] }, null);
}
