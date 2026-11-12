// SPDX-License-Identifier: AGPL-3.0-only
// passport (optional): register this instance with OpenGrants Passport and store the credentials it
// hands back as Worker secrets. The exchange is described in Passport's docs/instances.md:
//   start -> the site proves it holds its address (serves the challenge) -> the person types the code
//   on Passport's page and approves -> the tool collects the credentials once and pipes them into
//   `wrangler secret put`. The credentials are never printed, logged or written to a file.
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Ctx, Result } from "../core.ts";
import { brief, confirmOrDry, flagStr, instanceUrl, isResult, loadState, patchState, requireConfig, res, reveal, wranglerRun } from "../core.ts";
import { existingNames } from "./secrets.ts";

export const CHALLENGE_PATH = "/.well-known/opengrants-passport-challenge";
export const CHALLENGE_SECRET = "PASSPORT_REGISTRATION_CHALLENGE";
/** Secrets this step sets, per Worker. The webhook secret only matters to the API Worker. */
export const PASSPORT_SECRETS = { api: ["PASSPORT_GMS_CLIENT_ID", "PASSPORT_GMS_CLIENT_SECRET", "PASSPORT_WEBHOOK_SECRET"], jobs: ["PASSPORT_GMS_CLIENT_ID", "PASSPORT_GMS_CLIENT_SECRET"] } as const;

/** Tunables, in one place. */
const CHALLENGE_WAIT_TRIES = 30;
const CHALLENGE_WAIT_MS = 2000;
const PUT_TRIES = 3;
const NETWORK_TRIES = 5;

interface Started {
  registrationId: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete?: string;
  pollToken: string;
  interval: number;
  expiresIn: number;
  challenge: string;
}

async function postJson(ctx: Ctx, url: string, body: unknown): Promise<{ status: number; body: any; retryAfter: number | null }> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await ctx.fetch(url, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(body) });
  const text = await r.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  const ra = Number(r.headers.get("retry-after"));
  return { status: r.status, body: parsed, retryAfter: Number.isFinite(ra) && ra > 0 ? ra : null };
}

/** Text from Passport, safe to show: control characters removed, shortened, and quoted by the caller as data. */
const clean = (v: unknown): string => String(v ?? "").replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069]/g, " ").trim().slice(0, 200);
const messageOf = (b: any): string => clean(b?.message ?? b?.errors?.[0]?.message ?? b?.error); // eslint-disable-line @typescript-eslint/no-explicit-any
const USER_CODE = /^[B-Z]{4}-[B-Z]{4}$/;
/** The approval link must be https on Passport's host or a host under it (its web app). */
function linkOk(link: string, passportUrl: string): boolean {
  try {
    const u = new URL(link);
    const ph = new URL(passportUrl).hostname;
    return u.protocol === "https:" && !u.username && !u.password && (u.hostname === ph || u.hostname.endsWith(`.${ph}`));
  } catch {
    return false;
  }
}
const origin = (v: unknown): string | null => {
  try {
    return typeof v === "string" ? new URL(v).origin : null;
  } catch {
    return null;
  }
};

/** Set a secret over stdin, retrying a couple of times. Returns the failure text, or null. */
async function putSecret(ctx: Ctx, configPath: string, name: string, value: string): Promise<string | null> {
  let last = "";
  for (let i = 0; i < PUT_TRIES; i++) {
    const r = await wranglerRun(ctx, ["secret", "put", name, "--config", configPath], { input: value });
    if (r.code === 0) return null;
    last = brief(ctx, r);
  }
  return last;
}

export async function removeChallenge(ctx: Ctx, apiConfig: string): Promise<boolean> {
  const r = await wranglerRun(ctx, ["secret", "delete", CHALLENGE_SECRET, "--config", apiConfig], { input: "y\n" });
  // A secret that is already gone is the state we want.
  return r.code === 0 || /not found|does not exist|10056|10007/i.test(`${r.stdout}${r.stderr}`);
}

const CLEANUP_HINT = `Run \`pnpm -s gms deploy passport --cleanup\` to remove the temporary ${CHALLENGE_SECRET} secret.`;
const FUNDER_CONSOLE = (passportUrl: string) => (passportUrl === "https://passport.opengrants.io" ? "https://app.passport.opengrants.io" : passportUrl);

export async function passport(ctx: Ctx): Promise<Result> {
  const config = requireConfig(ctx);
  if (isResult(config)) return config;
  if (!config.passport) return res("skipped", "Connecting to Passport is switched off in the choices (init --passport on turns it on).", {}, "verify");
  const state = loadState(ctx);
  const gen = join(ctx.deployDir, "generated");
  const apiConfig = join(gen, "api.toml");
  const jobsConfig = join(gen, "jobs.toml");
  const url = (state.deploy?.urls?.instance as string | undefined) ?? instanceUrl(config, state);
  if (!state.deploy || !url || !existsSync(apiConfig)) return res("needs_input", "The instance has to be deployed before it can be connected to Passport (Passport checks the site's address). Run the deploy step first.", {}, "deploy");
  const rotate = ctx.flags.rotate !== undefined && ctx.flags.rotate !== false;
  const passportUrl = config.passportUrl.replace(/\/+$/, "");

  // --cleanup: remove a temporary challenge secret left by an interrupted run.
  if (ctx.flags.cleanup === true) {
    if (ctx.dryRun) return res("ok", `Dry run. Would remove ${CHALLENGE_SECRET} from the API Worker.`, { dryRun: true }, null);
    const gone = await removeChallenge(ctx, apiConfig);
    if (!gone) return res("error", `Could not remove ${CHALLENGE_SECRET}. Check the Cloudflare login and re-run with --cleanup.`, {}, "passport");
    patchState(ctx, { passport: { pending: null, challenge: null } });
    return res("ok", "No temporary Passport check code is left on the API Worker.", {}, "passport");
  }

  // Another run may still be waiting for approval; two runs would delete each other's challenge.
  const pendingUntil = state.passport?.pending?.expiresAt as string | undefined;
  if (pendingUntil && new Date(pendingUntil).getTime() > ctx.now().getTime()) {
    return res("needs_input", `A Passport registration started earlier may still be waiting for approval (until ${pendingUntil}). Let it finish or expire, or if it was interrupted run \`pnpm -s gms deploy passport --cleanup\` first.`, {}, "passport");
  }

  const have = await existingNames(ctx, apiConfig);
  if (!have) return res("error", "Could not read which secrets the API Worker has. Check the Cloudflare login (`pnpm --filter @gms/api exec wrangler whoami`) and re-run.", {}, "passport");
  // A challenge left behind by an interrupted run is removed before anything else.
  if ((have.has(CHALLENGE_SECRET) || state.passport?.challenge) && !ctx.dryRun) {
    if (await removeChallenge(ctx, apiConfig)) {
      have.delete(CHALLENGE_SECRET);
      patchState(ctx, { passport: { pending: null, challenge: null } });
    } else return res("error", `A temporary ${CHALLENGE_SECRET} secret is left on the API Worker and could not be removed. ${CLEANUP_HINT}`, {}, "passport");
  }
  const haveJobs = existsSync(jobsConfig) ? await existingNames(ctx, jobsConfig) : new Set<string>();
  if (!haveJobs) return res("error", "Could not read which secrets the jobs Worker has. Re-run.", {}, "passport");
  if (!rotate && PASSPORT_SECRETS.api.every((n) => have.has(n)) && PASSPORT_SECRETS.jobs.every((n) => haveJobs.has(n))) {
    return res("skipped", "The Workers already hold Passport credentials. To register again and replace them, run this step with --rotate.", { url }, "verify");
  }

  const displayName = clean(flagStr(ctx, "display-name") ?? `${config.name} grants`);
  const plan = [
    `ask Passport at ${passportUrl} to register ${url} as "${displayName}"`,
    `briefly serve a one-time check code at ${url}${CHALLENGE_PATH} so Passport can see the site is yours`,
    "show a short code and a link; the person opens the link, signs in to Passport (a funder organization admin), types the code and approves",
    "store the client id, client secret and webhook secret Passport returns as Worker secrets (they are never shown)",
  ];
  if (rotate) plan.unshift(`WARNING, replacing the registration this instance has now: every organization already linked to this instance will have to reconnect, because the stored links belong to the old registration; and the old registration stays in Passport until the person removes it in the funder console (${FUNDER_CONSOLE(passportUrl)}), so remove it there afterwards`);
  const gate = confirmOrDry(ctx, "passport", plan, { url, passportUrl, displayName, rotate });
  if (gate) return gate;

  let outcome: Result;
  let removed = true;
  const onSignal = (sig: NodeJS.Signals) => void removeChallenge(ctx, apiConfig).finally(() => process.exit(sig === "SIGINT" ? 130 : 143));
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  try {
    outcome = await exchange(ctx, { config, passportUrl, url, displayName, apiConfig, jobsConfig, rotate });
  } finally {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    removed = await removeChallenge(ctx, apiConfig);
    if (removed) patchState(ctx, { passport: { challenge: null, pending: null } });
  }
  if (!removed) return { ...outcome, message: `${outcome.message} The temporary ${CHALLENGE_SECRET} secret could not be removed. ${CLEANUP_HINT}` };
  return outcome;
}

interface Job { config: { passportUrl: string }; passportUrl: string; url: string; displayName: string; apiConfig: string; jobsConfig: string; rotate: boolean }

/** Start, serve the challenge, show the code, poll, store. The caller removes the challenge whatever happens here. */
async function exchange(ctx: Ctx, j: Job): Promise<Result> {
  const { passportUrl, url, displayName, apiConfig, jobsConfig } = j;
  // 1. Start.
  let started: Started;
  try {
    const s = await postJson(ctx, `${passportUrl}/passport/instances/registrations`, { instanceUrl: url, displayName });
    if (s.status === 429) return res("error", `Passport says too many setups were started recently. Wait ${s.retryAfter ? Math.ceil(s.retryAfter / 60) + " minutes" : "a while"} and re-run this step.`, {}, "passport");
    if (s.status === 503) return res("error", "That Passport deployment is not set up to register instances. Check the Passport address, or leave Passport off (init --passport off).", {}, null);
    if (s.status === 400) return res("needs_input", `Passport did not accept this setup. It said: "${messageOf(s.body) || "no reason given"}". Instances need a public https address on a domain of their own.`, {}, "passport");
    const b = s.body;
    if (s.status !== 201 || !b || typeof b.registrationId !== "string" || typeof b.userCode !== "string" || typeof b.pollToken !== "string" || typeof b.challenge !== "string" || typeof b.verificationUri !== "string") {
      return res("error", `Passport answered the start request unexpectedly (status ${s.status}). Nothing was changed on your side; re-run to try again.`, {}, "passport");
    }
    if (!USER_CODE.test(b.userCode) || !linkOk(b.verificationUri, passportUrl) || !/^[A-Za-z0-9_-]{16,200}$/.test(b.challenge) || !/^[A-Za-z0-9._~-]{1,100}$/.test(b.registrationId)) {
      return res("error", `Passport's answer did not look right (the approval link must be on ${new URL(passportUrl).hostname}). Nothing was changed. Check the Passport address and re-run.`, {}, "passport");
    }
    started = b as Started;
  } catch (e) {
    return res("error", `Could not reach Passport at ${passportUrl}: ${clean(e instanceof Error ? e.message : e)}. Check the address and re-run.`, {}, "passport");
  }
  reveal(ctx, started.pollToken);
  const interval = Math.max(1, Number(started.interval) || 5);
  const expiresIn = Math.max(60, Number(started.expiresIn) || 900);

  // 2. Serve the challenge, and wait until the site really does (directly, as Passport will fetch it: no redirects).
  patchState(ctx, { passport: { challenge: true } });
  const stuck = await putSecret(ctx, apiConfig, CHALLENGE_SECRET, started.challenge);
  if (stuck !== null) return res("error", `Could not set ${CHALLENGE_SECRET} on the API Worker: ${stuck}. Nothing else was changed; re-run to try again.`, {}, "passport");
  let serving = false;
  for (let i = 0; i < CHALLENGE_WAIT_TRIES && !serving; i++) {
    try {
      const r = await ctx.fetch(`${url}${CHALLENGE_PATH}`, { redirect: "manual", headers: { "Cache-Control": "no-cache" } });
      serving = r.status === 200 && (await r.text()).trim() === started.challenge;
    } catch {
      serving = false;
    }
    if (!serving) await ctx.sleep(CHALLENGE_WAIT_MS);
  }
  if (!serving) return res("error", `The site at ${url} does not serve the check code directly at ${CHALLENGE_PATH} (a redirect does not count). Deploy this release's API Worker (the deploy step) and make sure the site answers, then re-run.`, {}, "passport");

  // 3. Show the person what to do. The code goes on stderr for a person and in state.json (not secret) for an agent that missed it.
  const link = started.verificationUri;
  patchState(ctx, { passport: { pending: { userCode: started.userCode, link, expiresAt: new Date(ctx.now().getTime() + expiresIn * 1000).toISOString() } } });
  ctx.log("");
  ctx.log("Open this link, sign in to Passport, choose the organization that will own this site, then type the code and approve:");
  ctx.log(`  ${link}`);
  ctx.log(`  Code: ${started.userCode}`);
  ctx.log(`Approve only if you started this setup yourself. Waiting up to ${Math.round(expiresIn / 60)} minutes.`);
  ctx.log("");

  // 4. Poll.
  let wait = interval;
  let creds: { clientId: string; clientSecret: string; webhookSecret: string; baseUrl?: unknown; issuer?: unknown } | null = null;
  let failures = 0;
  const maxPolls = Math.ceil(expiresIn / interval) + 6;
  for (let i = 0; i < maxPolls && !creds; i++) {
    await ctx.sleep(wait * 1000);
    let r;
    try {
      r = await postJson(ctx, `${passportUrl}/passport/instances/registrations/${encodeURIComponent(started.registrationId)}/token`, { pollToken: started.pollToken });
    } catch {
      if (++failures >= NETWORK_TRIES) return res("error", "Lost contact with Passport while waiting. If the person already approved, the credentials could not be collected; re-run this step (a new setup, and delete the unused one in Passport's funder console).", {}, "passport");
      continue;
    }
    failures = 0;
    if (r.status === 202) continue;
    if (r.status === 429) {
      wait = Math.max(wait, Number(r.body?.interval) || r.retryAfter || wait + 5);
      continue;
    }
    if (r.status === 200 && r.body?.status === "approved" && typeof r.body.clientId === "string" && typeof r.body.clientSecret === "string" && typeof r.body.webhookSecret === "string") {
      creds = r.body;
      break;
    }
    const st = String(r.body?.status ?? "");
    if (r.status === 403 || st === "denied") return res("error", "The approval was denied in Passport. Nothing was stored. Re-run this step to try again.", {}, "passport");
    if (r.status === 410 && st === "collected") return res("error", "Passport says these credentials were already collected, and it cannot show them again. Re-run this step for a new registration (and delete the unused one in Passport's funder console).", {}, "passport");
    if (r.status === 410) return res("error", "The setup expired before it was approved (it lasts 15 minutes, and five wrong codes end it). Re-run this step for a new code.", {}, "passport");
    if (r.status === 404) return res("error", "Passport no longer knows this setup. Re-run this step.", {}, "passport");
    if (r.status >= 500) {
      if (++failures >= NETWORK_TRIES) return res("error", "Passport keeps answering with errors. Try again later.", {}, "passport");
      continue;
    }
    return res("error", `Passport answered the check unexpectedly (status ${r.status}). Re-run this step.`, {}, "passport");
  }
  if (!creds) return res("error", "Nobody approved the setup in time. Re-run this step for a new code.", {}, "passport");

  // 5. The response never moves the trust root: its addresses must be the Passport address the person chose.
  const clientId = reveal(ctx, creds.clientId);
  const clientSecret = reveal(ctx, creds.clientSecret);
  const webhookSecret = reveal(ctx, creds.webhookSecret);
  const mine = origin(passportUrl);
  const gotBase = origin(creds.baseUrl);
  const gotIssuer = origin(creds.issuer);
  if (gotBase !== mine || gotIssuer !== mine) {
    return res("needs_input", `Passport's answer names a different address than the one chosen (${passportUrl}): base address ${clean(creds.baseUrl)}, issuer ${clean(creds.issuer)}. Nothing was stored. If you trust that address, run init --passport-url <address> and then this step again; otherwise leave it.`, {}, "passport");
  }

  // 6. Store the credentials at once; Passport shows them only this once.
  const values: Record<string, string> = { PASSPORT_GMS_CLIENT_ID: clientId, PASSPORT_GMS_CLIENT_SECRET: clientSecret, PASSPORT_WEBHOOK_SECRET: webhookSecret };
  const configs = { api: apiConfig, jobs: jobsConfig };
  for (const w of ["api", "jobs"] as const) {
    if (w === "jobs" && !existsSync(jobsConfig)) continue;
    for (const name of PASSPORT_SECRETS[w]) {
      const failed = await putSecret(ctx, configs[w], name, values[name]!);
      if (failed !== null) return res("error", `Passport approved the setup, but ${name} could not be set on the ${w} Worker: ${failed}. Passport cannot show the credentials again. Fix the cause, then run this step with --rotate for a fresh registration, and delete the unused one in Passport's funder console.`, { worker: w, name }, "passport");
    }
  }
  patchState(ctx, { passport: { registered: true, at: ctx.now().toISOString(), displayName, url: passportUrl } });
  const warn = j.rotate ? ` Organizations linked through the old registration must reconnect, and the old registration should be removed in Passport's funder console (${FUNDER_CONSOLE(passportUrl)}).` : "";
  return res("ok", `This instance is registered with Passport as "${displayName}" and the credentials are stored as Worker secrets.${warn}`, { url, displayName, rotated: j.rotate }, "verify");
}
