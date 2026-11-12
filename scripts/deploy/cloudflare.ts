// SPDX-License-Identifier: AGPL-3.0-only
// Cloudflare credentials and account detection. Resources are managed through Wrangler (works with
// an API token or with `wrangler login`); the REST API is used only where Wrangler has no command and
// a token is present.
import type { Ctx, Result } from "./core.ts";
import { reveal, res, wranglerRun } from "./core.ts";

export const CF_API = "https://api.cloudflare.com/client/v4";

export const cfToken = (ctx: Ctx): string | null => (ctx.env.CLOUDFLARE_API_TOKEN ? reveal(ctx, ctx.env.CLOUDFLARE_API_TOKEN.trim()) : null);

export interface CfLogin {
  loggedIn: boolean;
  via: "token" | "wrangler" | null;
  accounts: { id: string; name?: string }[];
}

/** Whether Cloudflare credentials work, and which accounts they reach. Changes nothing. */
export async function cfLogin(ctx: Ctx): Promise<CfLogin> {
  const out = await wranglerRun(ctx, ["whoami", "--json"]);
  let accounts: { id: string; name?: string }[] = [];
  let ok = out.code === 0;
  if (ok) {
    try {
      const j = JSON.parse(out.stdout.slice(out.stdout.indexOf("{")));
      if (j.loggedIn === false) ok = false;
      accounts = (j.accounts ?? []).filter((a: { id?: string }) => a?.id).map((a: { id: string; name?: string }) => ({ id: a.id, name: a.name }));
    } catch {
      /* output not JSON: logged in but accounts unknown */
    }
  }
  if (!ok) return { loggedIn: false, via: null, accounts: [] };
  return { loggedIn: true, via: ctx.env.CLOUDFLARE_API_TOKEN ? "token" : "wrangler", accounts };
}

export const CF_LOGIN_MESSAGE = "Cloudflare is not signed in. Run `pnpm --filter @gms/api exec wrangler login` (or set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID), then re-run.";

/** The account to use: CLOUDFLARE_ACCOUNT_ID, else the only account the login reaches. */
export async function cfAccount(ctx: Ctx): Promise<{ id: string } | Result> {
  const login = await cfLogin(ctx);
  if (!login.loggedIn) return res("needs_login", CF_LOGIN_MESSAGE, {}, null);
  const fromEnv = ctx.env.CLOUDFLARE_ACCOUNT_ID?.trim();
  if (fromEnv) return { id: fromEnv };
  if (login.accounts.length === 1) return { id: login.accounts[0]!.id };
  if (login.accounts.length === 0) return res("needs_input", "Could not tell which Cloudflare account to use. Set CLOUDFLARE_ACCOUNT_ID.", {}, null);
  return res("needs_input", "The Cloudflare login reaches several accounts. Set CLOUDFLARE_ACCOUNT_ID to the one to use.", { accounts: login.accounts }, null);
}

export async function cfRest(ctx: Ctx, method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await ctx.fetch(`${CF_API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${cfToken(ctx)}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  try {
    return { status: r.status, body: text ? JSON.parse(text) : null };
  } catch {
    return { status: r.status, body: text };
  }
}

/** The DNS zone (name and id) that contains `domain`, among this account's zones. Needs a token. */
export async function findZone(ctx: Ctx, accountId: string, domain: string): Promise<{ id: string; name: string } | null> {
  if (!cfToken(ctx)) return null;
  const labels = domain.split(".");
  for (let i = 0; i <= labels.length - 2; i++) {
    const candidate = labels.slice(i).join(".");
    const z = await cfRest(ctx, "GET", `/zones?name=${encodeURIComponent(candidate)}&account.id=${accountId}`);
    if (z.status === 200 && Array.isArray(z.body?.result) && z.body.result[0]?.id) return { id: z.body.result[0].id, name: candidate };
  }
  return null;
}

/**
 * What already uses `host`: DNS records on it, or a custom domain of a Worker other than `ownWorker`.
 * `checked` is false when it could not be looked up (no API token), which callers treat as "unknown".
 */
export async function hostUsage(ctx: Ctx, accountId: string, host: string, ownWorker: string): Promise<{ checked: boolean; items: string[] }> {
  if (!cfToken(ctx)) return { checked: false, items: [] };
  const items: string[] = [];
  const doms = await cfRest(ctx, "GET", `/accounts/${accountId}/workers/domains?hostname=${encodeURIComponent(host)}`);
  if (doms.status !== 200) return { checked: false, items: [] };
  let ownsDomain = false;
  for (const d of (doms.body?.result ?? []) as { hostname?: string; service?: string }[]) {
    if (d.hostname && d.hostname !== host) continue;
    if (d.service === ownWorker) ownsDomain = true;
    else items.push(`the custom domain ${host} is attached to the Worker "${d.service ?? "unknown"}"`);
  }
  const zone = await findZone(ctx, accountId, host);
  if (!zone) return { checked: false, items };
  const recs = await cfRest(ctx, "GET", `/zones/${zone.id}/dns_records?name=${encodeURIComponent(host)}`);
  if (recs.status !== 200) return { checked: false, items };
  // A custom domain managed by Workers shows up as a DNS record too; it is ours when the domain is ours.
  if (!ownsDomain) for (const r of (recs.body?.result ?? []) as { type?: string; content?: string }[]) items.push(`a ${r.type ?? "DNS"} record for ${host} (${String(r.content ?? "").slice(0, 60)})`);
  return { checked: true, items };
}
