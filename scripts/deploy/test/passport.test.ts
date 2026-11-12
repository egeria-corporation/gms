// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import type { Fake } from "./harness.ts";
import { makeFake } from "./harness.ts";

const PP = "https://passport.opengrants.io/passport/instances/registrations";
const CRED = { clientId: "cid-0123456789", clientSecret: "csecret-ABCDEFGHIJKL", webhookSecret: "whsec-MNOPQRSTUVWX" };
const START = { registrationId: "reg1", userCode: "BCDF-GHJK", verificationUri: "https://app.passport.opengrants.io/instances/approve/reg1", pollToken: "ppi_POLLTOKEN123456", interval: 5, expiresIn: 900, challenge: "challenge-value-0123456789" };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

interface Opts { polls?: Response[]; start?: Response; serveChallenge?: boolean; issuer?: string }
function setup(o: Opts = {}) {
  const approved = () => json(200, { status: "approved", ...CRED, issuer: o.issuer ?? "https://passport.opengrants.io", baseUrl: o.issuer ?? "https://passport.opengrants.io", scopes: [] });
  const polls = [...(o.polls ?? [json(202, { status: "pending" }), approved(), approved()])];
  const state = { f: null as Fake | null };
  const f = makeFake({
    routes: (method, url) => {
      if (url === PP && method === "POST") return o.start ?? json(201, START);
      if (url === `${PP}/reg1/token`) return polls.shift() ?? json(202, { status: "pending" });
      if (url.endsWith("/.well-known/opengrants-passport-challenge")) {
        const has = state.f?.cf.secrets.get("api.toml")?.has("PASSPORT_REGISTRATION_CHALLENGE");
        return o.serveChallenge === false || !has ? new Response("nf", { status: 404 }) : new Response(START.challenge, { status: 200 });
      }
      return undefined;
    },
  });
  state.f = f;
  return f;
}

async function ready(f: Fake) {
  await f.step("init", "--email", "ops@example.org", "--name", "demo", "--host", "grants.example.org");
  for (const s of ["supabase", "migrate", "auth", "cloudflare", "secrets", "deploy"]) {
    const r = await f.step(s, "--yes", ...(s === "deploy" ? ["--replace-dns"] : []), ...(s === "secrets" ? ["--recovery-file", `${f.deployDir}-rec.env`] : []));
    expect(["ok", "skipped"], `${s}: ${r.r.message}`).toContain(r.r.code);
  }
}

describe("passport step", () => {
  it("asks first, registers, stores secrets without printing them, removes the challenge, then skips", async () => {
    const f = setup();
    await ready(f);
    expect((await f.step("passport")).r.code).toBe("needs_confirmation");
    expect(f.requests.some((r) => r.url === PP)).toBe(false);
    const r = await f.step("passport", "--yes");
    expect(r.r.code, r.r.message).toBe("ok");
    const api = f.cf.secrets.get("api.toml")!;
    for (const n of ["PASSPORT_GMS_CLIENT_ID", "PASSPORT_GMS_CLIENT_SECRET", "PASSPORT_WEBHOOK_SECRET"]) expect(api.has(n)).toBe(true);
    expect(api.has("PASSPORT_REGISTRATION_CHALLENGE")).toBe(false);
    expect(f.cf.secrets.get("jobs.toml")!.has("PASSPORT_GMS_CLIENT_SECRET")).toBe(true);
    const put = f.calls.find((c) => c.args.includes("PASSPORT_GMS_CLIENT_SECRET") && c.args.includes("put"))!;
    expect(put.input).toBe(CRED.clientSecret);
    expect(f.logs.join("\n")).toContain("BCDF-GHJK");
    const seen = f.everythingVisible();
    for (const s of [...Object.values(CRED), START.pollToken]) expect(seen).not.toContain(s);
    // The start request carried the instance address, not a secret.
    expect(f.requests.find((q) => q.url === PP)!.body).toMatchObject({ instanceUrl: "https://grants.example.org" });
    expect((await f.step("passport", "--yes")).r.code).toBe("skipped");
  });
  it("--rotate registers again", async () => {
    const f = setup();
    await ready(f);
    await f.step("passport", "--yes");
    const r = await f.step("passport", "--yes", "--rotate");
    expect(r.r.code, r.r.message).toBe("ok");
    expect(f.requests.filter((q) => q.url === PP)).toHaveLength(2);
  });
  it("dry run changes nothing", async () => {
    const f = setup();
    await ready(f);
    const r = await f.step("passport", "--dry-run");
    expect(r.r.data?.dryRun).toBe(true);
    expect(f.requests.some((q) => q.url === PP)).toBe(false);
  });
  it("needs a deployed instance, and is skipped when Passport is off", async () => {
    const f = setup();
    await f.step("init", "--email", "ops@example.org", "--host", "grants.example.org");
    expect((await f.step("passport", "--yes")).r.code).toBe("needs_input");
    await f.step("init", "--passport", "off");
    expect((await f.step("passport")).r.code).toBe("skipped");
  });
  it.each([
    [json(403, { status: "denied" }), /denied/],
    [json(410, { status: "expired" }), /expired/],
    [json(410, { status: "collected" }), /already collected/],
  ])("stops on a refusal and removes the challenge (%#)", async (resp, msg) => {
    const f = setup({ polls: [resp] });
    await ready(f);
    const r = await f.step("passport", "--yes");
    expect(r.r.code).toBe("error");
    expect(r.r.message).toMatch(msg);
    expect(f.cf.secrets.get("api.toml")!.has("PASSPORT_REGISTRATION_CHALLENGE")).toBe(false);
    expect(f.cf.secrets.get("api.toml")!.has("PASSPORT_GMS_CLIENT_ID")).toBe(false);
  });
  it("slow_down widens the wait and polling continues", async () => {
    const f = setup({ polls: [json(429, { status: "slow_down", interval: 10 }), json(200, { status: "approved", ...CRED, issuer: "https://passport.opengrants.io", baseUrl: "https://passport.opengrants.io" })] });
    await ready(f);
    expect((await f.step("passport", "--yes")).r.code).toBe("ok");
  });
  it("fails clearly when the site never serves the challenge", async () => {
    const f = setup({ serveChallenge: false });
    await ready(f);
    const r = await f.step("passport", "--yes");
    expect(r.r.code).toBe("error");
    expect(r.r.message).toContain("does not serve");
    expect(f.cf.secrets.get("api.toml")!.has("PASSPORT_REGISTRATION_CHALLENGE")).toBe(false);
  });
  it("reports start refusals plainly", async () => {
    const a = setup({ start: json(429, {}) });
    await ready(a);
    expect((await a.step("passport", "--yes")).r.code).toBe("error");
    const b = setup({ start: json(400, { message: "address not allowed" }) });
    await ready(b);
    const r = await b.step("passport", "--yes");
    expect(r.r.code).toBe("needs_input");
    expect(r.r.message).toContain("address not allowed");
  });
  it("updates the generated Passport addresses and asks for a redeploy when they differ", async () => {
    const f = setup({ issuer: "https://passport.example.net" });
    await ready(f);
    const r = await f.step("passport", "--yes");
    expect(r.r.code).toBe("ok");
    expect(r.r.next).toBe("deploy");
  });
});
