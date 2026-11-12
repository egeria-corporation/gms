// SPDX-License-Identifier: AGPL-3.0-only
// passport (optional): register this instance with OpenGrants Passport and store the credentials it
// hands back as Worker secrets. The exchange is described in Passport's docs/instances.md:
//   start -> the site proves it holds its address (serves the challenge) -> the person types the code
//   on Passport's page and approves -> the tool collects the credentials once and pipes them into
//   `wrangler secret put`. The credentials are never printed, logged or written to a file.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Ctx, Result } from "../core.ts";
import { brief, confirmOrDry, flagStr, instanceUrl, isResult, loadState, patchState, requireConfig, res, reveal, saveConfig, wranglerRun } from "../core.ts";
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

const messageOf = (b: any): string => String(b?.message ?? b?.errors?.[0]?.message ?? b?.error ?? "").slice(0, 200); // eslint-disable-line @typescript-eslint/no-explicit-any

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

async function removeChallenge(ctx: Ctx, apiConfig: string): Promise<boolean> {
  const r = await wranglerRun(ctx, ["secret", "delete", CHALLENGE_SECRET, "--config", apiConfig], { input: "y\n" });
  // A secret that is already gone is the state we want.
  return r.code === 0 || /not found|does not exist|10056|10007/i.test(`${r.stdout}${r.stderr}`);
}

const isHttpsOrigin = (v: unknown): v is string => typeof v === "string" && /^https:\/\/[a-z0-9.-]+(:\d+)?$/.test(v);

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

  const have = await existingNames(ctx, apiConfig);
  if (!have) return res("error", "Could not read which secrets the API Worker has. Check the Cloudflare login (pnpm exec wrangler whoami) and re-run.", {}, "passport");
  const haveJobs = existsSync(jobsConfig) ? await existingNames(ctx, jobsConfig) : new Set<string>();
  if (!haveJobs) return res("error", "Could not read which secrets the jobs Worker has. Re-run.", {}, "passport");
  if (!rotate && PASSPORT_SECRETS.api.every((n) => have.has(n)) && PASSPORT_SECRETS.jobs.every((n) => haveJobs.has(n))) {
    return res("skipped", "The Workers already hold Passport credentials. To register again and replace them, run this step with --rotate.", { url }, "verify");
  }

  const passportUrl = config.passportUrl.replace(/\/+$/, "");
  const displayName = (flagStr(ctx, "display-name") ?? `${config.name} grants`).trim();
  const gate = confirmOrDry(ctx, "passport", [
    `ask Passport at ${passportUrl} to register ${url} as "${displayName}"${rotate ? " (replacing the credentials the Workers hold now)" : ""}`,
    `briefly serve a one-time check code at ${url}${CHALLENGE_PATH} so Passport can see the site is yours`,
    "show a short code and a link; the person opens the link, signs in to Passport, types the code and approves",
    "store the client id, client secret and webhook secret Passport returns as Worker secrets (they are never shown)",
  ], { url, passportUrl, displayName });
  if (gate) return gate;

  // 1. Start.
  let started: Started;
  try {
    const s = await postJson(ctx, `${passportUrl}/passport/instances/registrations`, { instanceUrl: url, displayName });
    if (s.status === 429) return res("error", `Passport says too many setups were started recently. Wait ${s.retryAfter ? Math.ceil(s.retryAfter / 60) + " minutes" : "a while"} and re-run this step.`, {}, "passport");
    if (s.status === 503) return res("error", "That Passport deployment is not set up to register instances. Check the Passport address, or leave Passport off (init --passport off).", {}, null);
    if (s.status === 400) return res("needs_input", `Passport did not accept this setup: ${messageOf(s.body) || "check the site address and name"}. Instances need a public https address on a domain of their own; a workers.dev address works if Passport allows it.`, {}, "passport");
    const b = s.body;
    if (s.status !== 201 || !b || typeof b.registrationId !== "string" || typeof b.userCode !== "string" || typeof b.pollToken !== "string" || typeof b.challenge !== "string" || typeof b.verificationUri !== "string") {
      return res("error", `Passport answered the start request unexpectedly (status ${s.status}). Nothing was changed on your side; re-run to try again.`, {}, "passport");
    }
    started = b as Started;
  } catch (e) {
    return res("error", `Could not reach Passport at ${passportUrl}: ${e instanceof Error ? e.message : String(e)}. Check the address and re-run.`, {}, "passport");
  }
  reveal(ctx, started.pollToken);
  const interval = Math.max(1, Number(started.interval) || 5);
  const expiresIn = Math.max(60, Number(started.expiresIn) || 900);

  // 2. Serve the challenge, and wait until the site really does.
  const cleanUp = async (): Promise<boolean> => removeChallenge(ctx, apiConfig);
  const stuck = await putSecret(ctx, apiConfig, CHALLENGE_SECRET, started.challenge);
  if (stuck !== null) return res("error", `Could not set ${CHALLENGE_SECRET} on the API Worker: ${stuck}. Nothing else was changed; re-run to try again.`, {}, "passport");
  let serving = false;
  for (let i = 0; i < CHALLENGE_WAIT_TRIES && !serving; i++) {
    try {
      const r = await ctx.fetch(`${url}${CHALLENGE_PATH}`, { headers: { "Cache-Control": "no-cache" } });
      serving = r.status === 200 && (await r.text()).trim() === started.challenge;
    } catch {
      serving = false;
    }
    if (!serving) await ctx.sleep(CHALLENGE_WAIT_MS);
  }
  if (!serving) {
    await cleanUp();
    return res("error", `The site at ${url} does not serve the check code at ${CHALLENGE_PATH}. Deploy this release's API Worker (the deploy step) and make sure the site answers, then re-run.`, {}, "passport");
  }

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
      if (++failures >= NETWORK_TRIES) {
        await cleanUp();
        return res("error", "Lost contact with Passport while waiting. If the person already approved, the credentials could not be collected; re-run this step (a new setup, and delete the unused one in Passport's funder console).", {}, "passport");
      }
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
    const stop = async (message: string): Promise<Result> => {
      const left = await cleanUp();
      patchState(ctx, { passport: { pending: null } });
      return res("error", `${message}${left ? "" : ` The temporary ${CHALLENGE_SECRET} secret could not be removed; delete it with wrangler secret delete.`}`, {}, "passport");
    };
    if (r.status === 403 || st === "denied") return stop("The approval was denied in Passport. Nothing was stored. Re-run this step to try again.");
    if (r.status === 410 && st === "collected") return stop("Passport says these credentials were already collected, and it cannot show them again. Re-run this step for a new registration (and delete the unused one in Passport's funder console).");
    if (r.status === 410) return stop("The setup expired before it was approved (it lasts 15 minutes, and five wrong codes end it). Re-run this step for a new code.");
    if (r.status === 404) return stop("Passport no longer knows this setup. Re-run this step.");
    if (r.status >= 500) {
      if (++failures >= NETWORK_TRIES) return stop("Passport keeps answering with errors. Try again later.");
      continue;
    }
    return stop(`Passport answered the check unexpectedly (status ${r.status}). Re-run this step.`);
  }
  if (!creds) {
    const left = await cleanUp();
    patchState(ctx, { passport: { pending: null } });
    return res("error", `Nobody approved the setup in time. Re-run this step for a new code.${left ? "" : ` Also delete the secret ${CHALLENGE_SECRET} from the API Worker.`}`, {}, "passport");
  }

  // 5. Store the credentials at once; Passport shows them only this once.
  const clientId = reveal(ctx, creds.clientId);
  const clientSecret = reveal(ctx, creds.clientSecret);
  const webhookSecret = reveal(ctx, creds.webhookSecret);
  const values: Record<string, string> = { PASSPORT_GMS_CLIENT_ID: clientId, PASSPORT_GMS_CLIENT_SECRET: clientSecret, PASSPORT_WEBHOOK_SECRET: webhookSecret };
  const configs = { api: apiConfig, jobs: jobsConfig };
  for (const w of ["api", "jobs"] as const) {
    if (w === "jobs" && !existsSync(jobsConfig)) continue;
    for (const name of PASSPORT_SECRETS[w]) {
      const failed = await putSecret(ctx, configs[w], name, values[name]!);
      if (failed !== null) {
        await cleanUp();
        return res("error", `Passport approved the setup, but ${name} could not be set on the ${w} Worker: ${failed}. Passport cannot show the credentials again. Fix the cause, then run this step with --rotate for a fresh registration, and delete the unused one in Passport's funder console.`, { worker: w, name }, "passport");
      }
    }
  }
  const cleaned = await cleanUp();

  // 6. Passport's own addresses. They are plain settings in the generated config; update them there if they differ.
  let redeploy = false;
  const baseUrl = creds.baseUrl;
  const issuer = creds.issuer;
  if (isHttpsOrigin(baseUrl) && isHttpsOrigin(issuer) && (baseUrl !== passportUrl || issuer !== passportUrl)) {
    let text = readFileSync(apiConfig, "utf8");
    text = text.replace(/^PASSPORT_BASE_URL = ".*"$/gm, `PASSPORT_BASE_URL = "${baseUrl}"`).replace(/^PASSPORT_ISSUER = ".*"$/gm, `PASSPORT_ISSUER = "${issuer}"`);
    writeFileSync(apiConfig, text);
    saveConfig(ctx, { ...config, passportUrl: baseUrl });
    redeploy = true;
  }
  patchState(ctx, { passport: { registered: true, pending: null, at: ctx.now().toISOString(), displayName, url: baseUrl && isHttpsOrigin(baseUrl) ? baseUrl : passportUrl } });
  const tail = `${cleaned ? "" : ` The temporary ${CHALLENGE_SECRET} secret could not be removed; delete it with wrangler secret delete.`}`;
  if (redeploy) return res("ok", `This instance is registered with Passport and the credentials are stored. Passport's addresses differ from the defaults, so redeploy to use them.${tail}`, { url, redeploy: true }, "deploy");
  return res("ok", `This instance is registered with Passport as "${displayName}" and the credentials are stored as Worker secrets.${tail}`, { url, displayName }, "verify");
}
