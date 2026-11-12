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

export const CF_LOGIN_MESSAGE = "Cloudflare is not signed in. Run `pnpm exec wrangler login` (or set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID), then re-run.";

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
