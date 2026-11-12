// SPDX-License-Identifier: AGPL-3.0-only
// verify: the instance answers as it should, then a sign-in code goes to the operator.
import type { Ctx, Result } from "../core.ts";
import { confirmOrDry, isResult, loadState, patchState, requireConfig, res } from "../core.ts";
import { KEYS_MESSAGE, SUPABASE_API, Supabase, supabaseToken } from "../supabase-api.ts";
import { LOGIN_MESSAGE } from "./supabase.ts";

interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

const hostOf = (url: string): string => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};
/** A check whose host did not answer at all (DNS, refused connection, TLS, timeout) fails and names the host. */
const unreachable = (url: string) => `could not reach ${hostOf(url)}`;

/** One request; null when the host could not be reached. Never throws, so one dead host fails only its own check. */
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
  add("health", health?.status === 200 && health.json?.database === "configured", health ? (health.json?.database === "configured" ? "the API is up and the database is configured" : `the API answered but the database reads "${health.json?.database ?? "unknown"}"`) : unreachable(url));

  const jwks = await get(ctx, `${url}/.well-known/jwks.json`);
  add("signing key", jwks?.status === 200 && Array.isArray(jwks.json?.keys) && jwks.json.keys.length > 0, jwks?.status === 200 ? "the signing key is published" : jwks ? `status ${jwks.status}` : unreachable(url));

  const meta = await get(ctx, `${url}/.well-known/oauth-authorization-server`);
  const issuer = meta?.json?.issuer as string | undefined;
  add("sign-in server", meta?.status === 200 && issuer?.replace(/\/$/, "") === url, meta?.status === 200 ? (issuer?.replace(/\/$/, "") === url ? "the issuer matches the instance address" : `the issuer is ${issuer ?? "missing"}, not ${url}`) : meta ? `status ${meta.status}` : unreachable(url));

  const cfg = await get(ctx, `${url}/gms/config`);
  add("settings", cfg?.status === 200 && !!cfg.json, cfg?.status === 200 ? "the app settings are served" : cfg ? `status ${cfg.status}` : unreachable(url));

  const page = await get(ctx, `${url}/signin`);
  add("sign-in page", page?.status === 200 && /<html|<!doctype/i.test(page.text), page?.status === 200 ? "the web app loads" : page ? `status ${page.status}` : unreachable(url));
  return checks;
}

/**
 * The sign-in code check: read the project's anon key from the Management API, then ask the
 * project's Auth to send a code. Either host may be unreachable; that fails this check, naming the
 * host, instead of stopping the step. Null when the keys cannot be read (a configuration problem
 * with its own message).
 */
async function sendCode(ctx: Ctx, token: string, ref: string, projectUrl: string, email: string): Promise<Check | null> {
  const name = "sign-in code";
  let keys: { anon: string } | null;
  try {
    keys = await new Supabase(ctx, token).keys(ref);
  } catch {
    return { name, ok: false, detail: `${unreachable(SUPABASE_API)} to read the project's keys, so no code was sent` };
  }
  if (!keys) return null;
  let status: number;
  try {
    const r = await ctx.fetch(`${projectUrl}/auth/v1/otp`, { method: "POST", headers: { "Content-Type": "application/json", apikey: keys.anon }, body: JSON.stringify({ email, create_user: true }) });
    status = r.status;
  } catch {
    return { name, ok: false, detail: `${unreachable(projectUrl)} (the Supabase project), so no code was sent` };
  }
  return { name, ok: status < 300, detail: status < 300 ? `a code was sent to ${email}` : `Supabase answered ${status} when sending the code${status === 429 ? " (too many requests; wait a minute)" : ""}` };
}

export async function verify(ctx: Ctx): Promise<Result> {
  const config = requireConfig(ctx);
  if (isResult(config)) return config;
  const state = loadState(ctx);
  const url = state.urls?.instance as string | undefined;
  if (!url) return res("needs_input", "The instance address is not recorded yet. Run the cloudflare and deploy steps first.", {}, "cloudflare");
  const ref = state.supabase?.ref as string | undefined;
  if (!ref) return res("needs_input", "There is no Supabase project yet.", {}, "supabase");
  if (!state.auth?.configured) return res("needs_input", "Supabase Auth has not been set up yet. Run the auth step first.", {}, "auth");
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
  const otp = await sendCode(ctx, token, ref, state.supabase.url as string, config.email);
  if (!otp) return res("error", KEYS_MESSAGE, { checks }, null);
  record([otp]);
  if (!otp.ok) return res("error", `1 check(s) failed: ${otp.name} (${otp.detail}).`, { checks: [...checks, otp] }, "verify");
  return res("ok", `All checks passed and a sign-in code was sent to ${config.email}.`, { checks: [...checks, otp] }, null);
}
