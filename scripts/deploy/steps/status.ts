// SPDX-License-Identifier: AGPL-3.0-only
// status: what is recorded about this instance. Reads local files only.
import type { Ctx, Result } from "../core.ts";
import { loadConfig, loadState, res } from "../core.ts";

export async function status(ctx: Ctx): Promise<Result> {
  const config = loadConfig(ctx);
  const state = loadState(ctx);
  if (!config) return res("needs_input", "Nothing is set up yet. Run init.", {}, "init");
  const data = {
    name: config.name,
    version: state.version ?? state.deploy?.version ?? null,
    deployedAt: state.deploy?.at ?? null,
    urls: { instance: state.urls?.instance ?? null, supabase: state.supabase?.url ?? null },
    resources: {
      supabaseProject: state.supabase?.ref ?? null,
      migrations: state.migrations ?? null,
      authConfigured: !!state.auth?.configured,
      buckets: state.cloudflare?.buckets ?? [],
      queues: state.cloudflare?.queues ?? [],
      kvNamespace: state.cloudflare?.kvId ?? null,
      workers: state.workers ?? {},
      secretsSet: !!state.secrets?.api,
    },
    optional: { passport: config.passport, passportUrl: config.passport ? config.passportUrl : null, resend: config.resend, emailDomain: state.email?.done ? state.email.domain : null },
    lastVerify: state.verify ?? null,
    warnings: state.passport?.challenge ? ["A temporary Passport check code may still be set on the API Worker. Run `pnpm -s gms deploy passport --cleanup`."] : [],
  };
  return res("ok", state.deploy ? `Instance "${config.name}" is on ${data.version} at ${data.urls.instance}.` : `Instance "${config.name}" is set up but not deployed yet.`, data, null);
}
