// SPDX-License-Identifier: AGPL-3.0-only
// auth: Supabase Auth settings through the Management API, read back and compared.
import type { Ctx, Result } from "../core.ts";
import { confirmOrDry, instanceUrl, isResult, loadState, patchState, requireConfig, res } from "../core.ts";
import { apiMessage, Supabase, supabaseToken } from "../supabase-api.ts";
import { LOGIN_MESSAGE } from "./supabase.ts";

/** The sign-in return addresses the web app uses (docs/self-host.md step 1.5 and apps/web/src/auth/supabase.ts). */
export const callbackPaths = ["/auth/callback", "/signin"];

type AuthConfig = Record<string, unknown>;

export function desiredAuth(url: string, existingAllowList: string): AuthConfig {
  const wanted = callbackPaths.map((p) => `${url}${p}`);
  const existing = existingAllowList.split(",").map((s) => s.trim()).filter(Boolean);
  return {
    site_url: url,
    uri_allow_list: [...new Set([...existing, ...wanted])].join(","),
    external_email_enabled: true,
    mailer_autoconfirm: false,
    mfa_totp_enroll_enabled: true,
    mfa_totp_verify_enabled: true,
  };
}

const differs = (want: AuthConfig, have: AuthConfig) => Object.keys(want).filter((k) => {
  if (k === "uri_allow_list") {
    const have_ = new Set(String(have[k] ?? "").split(",").map((s) => s.trim()));
    return !String(want[k]).split(",").every((x) => have_.has(x));
  }
  return have[k] !== want[k];
});

export async function auth(ctx: Ctx): Promise<Result> {
  const config = requireConfig(ctx);
  if (isResult(config)) return config;
  const state = loadState(ctx);
  const ref = state.supabase?.ref as string | undefined;
  if (!ref) return res("needs_input", "There is no Supabase project yet. Run the supabase step first.", {}, "supabase");
  const url = instanceUrl(config, state);
  if (!url) return res("needs_input", "The instance address is not known yet (no domain chosen and no workers.dev address). Run the cloudflare step first, or init with --host.", {}, "cloudflare");
  const token = supabaseToken(ctx);
  if (!token) return res("needs_login", LOGIN_MESSAGE, {}, null);
  const api = new Supabase(ctx, token);

  const current = await api.call<AuthConfig>("GET", `/projects/${ref}/config/auth`);
  if (current.status === 401 || current.status === 403) return res("needs_login", LOGIN_MESSAGE, {}, null);
  if (current.status !== 200 || !current.body || typeof current.body !== "object") return res("error", `Could not read the Auth settings: ${apiMessage(current.body)}.`, {}, null);

  const want = desiredAuth(url, String(current.body.uri_allow_list ?? ""));
  // site_url alone can differ legitimately only before the first run; compare every field.
  const diff = differs(want, current.body);
  const smtp = config.resend ? (current.body.smtp_host === "smtp.resend.com" ? "set" : "pending: the email step sets it") : "not used";
  if (diff.length === 0) {
    if (!ctx.dryRun) patchState(ctx, { auth: { configured: true, url } });
    return res("skipped", "Supabase Auth is already set as needed.", { smtp }, "cloudflare");
  }
  const gate = confirmOrDry(ctx, "auth", [`change Supabase Auth settings (${diff.join(", ")}): email sign-in on, email confirmation required, TOTP on, site address ${url}, return addresses ${callbackPaths.map((p) => url + p).join(" and ")}`], { changes: diff });
  if (gate) return gate;

  const patch: AuthConfig = {};
  for (const k of diff) patch[k] = want[k];
  const r = await api.call("PATCH", `/projects/${ref}/config/auth`, patch);
  if (r.status >= 300) return res("error", `Supabase refused the Auth change: ${apiMessage(r.body)}.`, {}, null);
  const back = await api.call<AuthConfig>("GET", `/projects/${ref}/config/auth`);
  const still = back.status === 200 ? differs(want, back.body) : ["read-back failed"];
  if (still.length) return res("error", `Supabase accepted the change but these settings did not take: ${still.join(", ")}.`, { notApplied: still }, "auth");
  patchState(ctx, { auth: { configured: true, url } });
  return res("ok", `Set ${diff.length} Auth setting(s) and confirmed them by reading them back.`, { changed: diff, smtp }, "cloudflare");
}
