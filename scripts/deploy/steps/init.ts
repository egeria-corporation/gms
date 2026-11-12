// SPDX-License-Identifier: AGPL-3.0-only
// init: record the choices for this instance in deploy/config.json.
import type { Config, Ctx, Result } from "../core.ts";
import { flagStr, loadConfig, res, saveConfig } from "../core.ts";

const onOff = (v: string | undefined, fallback: boolean): boolean | null => {
  if (v === undefined) return fallback;
  if (/^(on|true|yes|1)$/i.test(v)) return true;
  if (/^(off|false|no|0)$/i.test(v)) return false;
  return null;
};

export async function init(ctx: Ctx): Promise<Result> {
  const prev = loadConfig(ctx);
  const f = (n: string) => flagStr(ctx, n);

  const name = f("name") ?? prev?.name ?? "gms";
  if (!/^[a-z][a-z0-9-]{1,23}[a-z0-9]$/.test(name)) return res("needs_input", "The instance name must be 3 to 25 lowercase letters, digits or hyphens, starting with a letter. It prefixes every resource name.", {}, "init");

  const hostFlag = f("host");
  const host = hostFlag !== undefined ? (/^(none|workers\.dev)$/i.test(hostFlag) ? null : hostFlag.toLowerCase()) : prev ? prev.host : null;
  if (host && !/^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(host)) return res("needs_input", `"${host}" is not a domain name. Give a host such as grants.example.org, or leave --host out to use workers.dev.`, {}, "init");

  const passport = onOff(f("passport"), prev?.passport ?? true);
  const resend = onOff(f("resend"), prev?.resend ?? false);
  if (passport === null || resend === null) return res("needs_input", "--passport and --resend take on or off.", {}, "init");

  const email = f("email") ?? prev?.email ?? null;
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res("needs_input", "Give the operator email with --email. The final check sends a sign-in code to it.", {}, "init");

  const config: Config = {
    name,
    host,
    region: f("region") ?? prev?.region ?? "us-east-1",
    org: f("org") ?? prev?.org ?? null,
    email,
    passport,
    passportUrl: f("passport-url") ?? prev?.passportUrl ?? "https://passport.opengrants.io",
    resend,
    workersSubdomain: f("workers-subdomain") ?? prev?.workersSubdomain ?? null,
  };

  if (prev && JSON.stringify(prev) === JSON.stringify(config)) return res("skipped", "The choices are already recorded and unchanged.", { config }, "doctor");
  if (ctx.dryRun) return res("ok", "Dry run. Would record these choices in deploy/config.json.", { dryRun: true, config }, "supabase");
  saveConfig(ctx, config);
  return res("ok", `Recorded the choices for "${name}" in deploy/config.json.`, { config }, "supabase");
}
