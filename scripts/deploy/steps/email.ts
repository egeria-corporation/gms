// SPDX-License-Identifier: AGPL-3.0-only
// email (optional): a verified Resend sending domain, a key restricted to it, and the Workers' and
// Supabase's mail settings. The restricted key is held in memory and goes only to Cloudflare and Supabase.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { cfAccount, cfRest, cfToken } from "../cloudflare.ts";
import type { Ctx, Result } from "../core.ts";
import { brief, confirmOrDry, flagStr, isResult, loadState, patchState, requireConfig, res, reveal, wranglerRun } from "../core.ts";
import { apiMessage, Supabase, supabaseToken } from "../supabase-api.ts";

const RESEND = "https://api.resend.com";

interface DnsRecord { record?: string; name: string; type: string; value: string; ttl?: string | number; priority?: number; status?: string }

async function resend(ctx: Ctx, key: string, method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await ctx.fetch(`${RESEND}${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  try {
    return { status: r.status, body: text ? JSON.parse(text) : null };
  } catch {
    return { status: r.status, body: text };
  }
}

/** Add the records to the Cloudflare zone for this domain, when the zone is in the account. Returns the zone id or null. */
async function addDns(ctx: Ctx, accountId: string, domain: string, records: DnsRecord[]): Promise<{ added: number } | { reason: string }> {
  if (!cfToken(ctx)) return { reason: "no CLOUDFLARE_API_TOKEN, so DNS records cannot be added automatically" };
  const labels = domain.split(".");
  let zoneId: string | null = null;
  for (let i = 0; i <= labels.length - 2 && !zoneId; i++) {
    const candidate = labels.slice(i).join(".");
    const z = await cfRest(ctx, "GET", `/zones?name=${encodeURIComponent(candidate)}&account.id=${accountId}`);
    if (z.status === 200 && Array.isArray(z.body?.result) && z.body.result[0]?.id) zoneId = z.body.result[0].id;
  }
  if (!zoneId) return { reason: `the DNS zone for ${domain} is not in this Cloudflare account` };
  let added = 0;
  for (const rec of records) {
    const r = await cfRest(ctx, "POST", `/zones/${zoneId}/dns_records`, {
      type: rec.type,
      name: rec.name,
      content: rec.value,
      ttl: 1,
      ...(rec.type === "MX" ? { priority: rec.priority ?? 10 } : {}),
      ...(rec.type === "CNAME" ? { proxied: false } : {}),
    });
    const already = r.status === 400 && JSON.stringify(r.body).match(/already exists|81057|81058/);
    if (r.status >= 300 && !already) return { reason: `Cloudflare refused the ${rec.type} record ${rec.name} (${apiMessage(r.body?.errors?.[0] ?? r.body)})` };
    added++;
  }
  return { added };
}

export async function email(ctx: Ctx): Promise<Result> {
  const config = requireConfig(ctx);
  if (isResult(config)) return config;
  if (!config.resend) return res("skipped", "Email through Resend is switched off in the choices (init --resend on turns it on).", {}, "verify");
  const state = loadState(ctx);
  const key = ctx.env.RESEND_API_KEY?.trim();
  if (!key) return res("needs_input", "Set RESEND_API_KEY (a Resend key that can manage domains) in the environment, then re-run.", {}, "email");
  reveal(ctx, key);

  const domain = (flagStr(ctx, "domain") ?? state.email?.domain) as string | undefined;
  if (!domain) return res("needs_input", "Pass --domain <sending domain>, for example mail.example.org. Mail is sent from an address on it.", {}, "email");
  const from = (flagStr(ctx, "from") ?? state.email?.from ?? `grants@${domain}`) as string;
  if (state.email?.done && state.email.domain === domain && state.email.from === from) return res("skipped", `Email is already set up for ${domain}.`, { domain, from }, "verify");

  const ref = state.supabase?.ref as string | undefined;
  const gen = join(ctx.deployDir, "generated");
  if (!ref || !existsSync(join(gen, "api.toml"))) return res("needs_input", "Run the supabase and cloudflare steps first.", {}, "cloudflare");
  const sbToken = supabaseToken(ctx);
  if (!sbToken) return res("needs_login", "Supabase is not signed in. Run `npx supabase login` (or set SUPABASE_ACCESS_TOKEN), then re-run.", {}, null);
  const account = await cfAccount(ctx);
  if (isResult(account)) return account;

  const gate = confirmOrDry(ctx, "email", [
    `add ${domain} as a sending domain at Resend and its DNS records (in Cloudflare when the zone is in this account)`,
    `create a Resend key that can only send from ${domain}`,
    `set RESEND_API_KEY and RESEND_FROM (${from}) on both Workers and point Supabase's sign-in mail at Resend`,
  ], { domain, from });
  if (gate) return gate;

  // 1. The domain.
  let domainId = state.email?.domainId as string | undefined;
  let records: DnsRecord[] = [];
  if (!domainId) {
    const list = await resend(ctx, key, "GET", "/domains");
    if (list.status === 401 || list.status === 403) return res("needs_input", "Resend refused the key. Use a full-access key, or one allowed to manage domains.", {}, "email");
    const found = (list.body?.data ?? []).find((d: { name: string }) => d.name === domain);
    if (found) domainId = found.id;
    else {
      const created = await resend(ctx, key, "POST", "/domains", { name: domain });
      if (created.status >= 300 || !created.body?.id) return res("error", `Resend could not add the domain: ${apiMessage(created.body)}.`, {}, null);
      domainId = created.body.id as string;
    }
    patchState(ctx, { email: { domain, domainId } });
  }
  const detail = await resend(ctx, key, "GET", `/domains/${domainId}`);
  if (detail.status !== 200) return res("error", `Could not read the Resend domain: ${apiMessage(detail.body)}.`, {}, null);
  records = detail.body.records ?? [];

  // 2. DNS and verification.
  if (detail.body.status !== "verified") {
    if (!state.email?.dnsAdded) {
      const dns = await addDns(ctx, account.id, domain, records);
      if ("reason" in dns) {
        return res("needs_input", `Add these DNS records for ${domain}, then re-run this step (${dns.reason}).`, { records: records.map((r) => ({ type: r.type, name: r.name, value: r.value, priority: r.priority ?? null })) }, "email");
      }
      patchState(ctx, { email: { dnsAdded: true } });
    }
    await resend(ctx, key, "POST", `/domains/${domainId}/verify`);
    let status = "pending";
    for (let i = 0; i < 6 && status !== "verified"; i++) {
      await ctx.sleep(10000);
      status = (await resend(ctx, key, "GET", `/domains/${domainId}`)).body?.status ?? "pending";
    }
    if (status !== "verified") return res("needs_input", `The DNS records are in place but Resend has not verified ${domain} yet (status: ${status}). DNS can take a while; re-run this step later.`, {}, "email");
  }

  // 3. A key that can only send from this domain. A key left over from an interrupted run is replaced.
  if (state.email?.keyId) await resend(ctx, key, "DELETE", `/api-keys/${state.email.keyId}`);
  const made = await resend(ctx, key, "POST", "/api-keys", { name: `${config.name}-sending`, permission: "sending_access", domain_id: domainId });
  if (made.status >= 300 || !made.body?.token) return res("error", `Resend could not create the sending key: ${apiMessage(made.body)}.`, {}, "email");
  const sendKey = reveal(ctx, made.body.token as string);
  patchState(ctx, { email: { keyId: made.body.id } });

  // 4. Workers.
  for (const w of ["api", "jobs"] as const) {
    for (const [name, value] of [["RESEND_API_KEY", sendKey], ["RESEND_FROM", from]] as const) {
      const r = await wranglerRun(ctx, ["secret", "put", name, "--config", join(gen, `${w}.toml`)], { input: value });
      if (r.code !== 0) return res("error", `Could not set ${name} on the ${w} Worker: ${brief(ctx, r)}. Re-run to try again.`, {}, "email");
    }
  }

  // 5. Supabase sign-in mail.
  const sb = new Supabase(ctx, sbToken);
  const smtp = { smtp_host: "smtp.resend.com", smtp_port: "465", smtp_user: "resend", smtp_pass: sendKey, smtp_admin_email: from, smtp_sender_name: config.name };
  const patched = await sb.call("PATCH", `/projects/${ref}/config/auth`, smtp);
  if (patched.status >= 300) return res("error", `Supabase refused the mail settings: ${apiMessage(patched.body)}.`, {}, "email");
  const back = await sb.call<Record<string, unknown>>("GET", `/projects/${ref}/config/auth`);
  if (back.status !== 200 || back.body.smtp_host !== "smtp.resend.com" || back.body.smtp_admin_email !== from) return res("error", "Supabase accepted the mail settings but they did not take. Re-run this step.", {}, "email");

  patchState(ctx, { email: { done: true, domain, domainId, from, at: ctx.now().toISOString() } });
  return res("ok", `Email is set up: ${from} sends through Resend, and Supabase sign-in codes use it.`, { domain, from }, "verify");
}
