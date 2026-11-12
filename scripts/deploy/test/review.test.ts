// SPDX-License-Identifier: AGPL-3.0-only
// Tests for the findings of the independent review (reviews/T1.json), one block per finding.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Fake } from "./harness.ts";
import { makeFake, SECRET } from "./harness.ts";

async function initted(f: Fake, ...extra: string[]) {
  expect((await f.step("init", "--email", "ops@example.org", "--name", "demo", ...extra)).r.code).toBe("ok");
}
const recovery = () => join(mkdtempSync(join(tmpdir(), "t1-rec-")), "recovery.env");
const state = (f: Fake) => JSON.parse(readFileSync(join(f.deployDir, "state.json"), "utf8"));

describe("T1-01 organization slug", () => {
  it("sends organization_slug, accepts an id or a slug in --org, and reads ref", async () => {
    for (const org of ["org1", "orgid-1"]) {
      const f = makeFake();
      await initted(f, "--org", org);
      const r = await f.step("supabase", "--yes");
      expect(r.r.code, r.r.message).toBe("ok");
      const post = f.requests.find((q) => q.method === "POST" && q.url.endsWith("/projects"))!;
      expect(post.body).toMatchObject({ organization_slug: "org1" });
      expect(post.body).not.toHaveProperty("organization_id");
      expect(state(f).supabase.ref).toBe("abcdefghijklmnopqrst");
    }
  });
});

describe("T1-08 Supabase token", () => {
  it("one clear message about SUPABASE_ACCESS_TOKEN, and SUPABASE_HOME is honoured", async () => {
    const f = makeFake({ env: { SUPABASE_ACCESS_TOKEN: undefined } });
    await initted(f);
    const r = await f.step("supabase", "--yes");
    expect(r.r.code).toBe("needs_login");
    expect(r.r.message).toContain("SUPABASE_ACCESS_TOKEN");
    expect(r.r.message).toContain("keyring");
    const home = mkdtempSync(join(tmpdir(), "t1-sbhome-"));
    writeFileSync(join(home, "access-token"), SECRET.sbToken + "\n");
    const g = makeFake({ env: { SUPABASE_ACCESS_TOKEN: undefined, SUPABASE_HOME: home } });
    await initted(g);
    expect((await g.step("doctor")).r.data?.supabase).toMatchObject({ loggedIn: true, source: "access-token file" });
  });
});

describe("T1-17, T1-18 supabase edge cases", () => {
  it("adopting a different project than the recorded one asks first", async () => {
    const f = makeFake();
    await initted(f);
    await f.step("supabase", "--yes");
    f.sb.projects.push({ ref: "zzzzzzzzzzzzzzzzzzzz", name: "other", organization_slug: "org1", status: "ACTIVE_HEALTHY" });
    const ask = await f.step("supabase", "--adopt", "zzzzzzzzzzzzzzzzzzzz");
    expect(ask.r.code).toBe("needs_confirmation");
    expect(state(f).supabase.ref).toBe("abcdefghijklmnopqrst");
    expect((await f.step("supabase", "--adopt", "zzzzzzzzzzzzzzzzzzzz", "--yes")).r.code).toBe("ok");
    expect(state(f).supabase.ref).toBe("zzzzzzzzzzzzzzzzzzzz");
  });
  it("a rate limit is not a plan limit, and a failed project stops the wait", async () => {
    const f = makeFake();
    await initted(f);
    f.sb.createStatus = 429;
    f.sb.createMessage = "rate limit exceeded";
    expect((await f.step("supabase", "--yes")).r.code).toBe("error");
    const g = makeFake();
    await initted(g);
    g.sb.healthyAfter = 1000;
    const orig = g.ctx.fetch;
    g.ctx.fetch = (async (u: string, i?: RequestInit) => (/\/projects\/[a-z]+$/.test(String(u)) && (i?.method ?? "GET") === "GET" && g.sb.projects[0] ? new Response(JSON.stringify({ ref: g.sb.projects[0].ref, status: "INIT_FAILED" }), { status: 200 }) : orig(u, i))) as typeof fetch;
    const { execute } = await import("../cli.ts");
    const out = await execute({ ...g.ctx, flags: { yes: true }, yes: true }, "supabase");
    expect(out.result.code).toBe("error");
    expect(out.result.message).toContain("INIT_FAILED");
    expect(g.sb.polls).toBe(0);
  });
});

async function secretsReady(f: Fake, ...init: string[]) {
  await initted(f, "--host", "grants.example.org", ...init);
  for (const s of ["supabase", "migrate", "auth", "cloudflare"]) expect(["ok", "skipped"]).toContain((await f.step(s, "--yes")).r.code);
}
const putsOf = (f: Fake, name: string) => f.calls.filter((c) => c.args.includes("put") && c.args.includes(name));

describe("T1-03 staged, resumable rotation", () => {
  it("refreshing Supabase values never regenerates the encryption keys", async () => {
    const f = makeFake();
    await secretsReady(f);
    const rec = recovery();
    await f.step("secrets", "--yes", "--recovery-file", rec);
    const before = readFileSync(rec, "utf8");
    const credBefore = putsOf(f, "CREDENTIALS_ENCRYPTION_KEY").map((c) => c.input);
    const r = await f.step("secrets", "--yes", "--recovery-file", rec, "--rotate", "SUPABASE_SERVICE_ROLE_KEY,SUPABASE_ANON_KEY");
    expect(r.r.code, r.r.message).toBe("ok");
    expect(putsOf(f, "CREDENTIALS_ENCRYPTION_KEY").map((c) => c.input)).toEqual(credBefore);
    expect(putsOf(f, "SUPABASE_SERVICE_ROLE_KEY")).toHaveLength(4);
    expect(readFileSync(rec, "utf8")).toBe(before);
  });
  it("stages new keys, keeps the old file, and resumes after a failed put without a third set", async () => {
    const f = makeFake();
    await secretsReady(f);
    const rec = recovery();
    await f.step("secrets", "--yes", "--recovery-file", rec);
    const old = readFileSync(rec, "utf8");
    const args = ["--yes", "--recovery-file", rec, "--rotate", "WEBHOOK_SECRET_KEY", "--rotate-keys"];
    f.cf.failPut = "WEBHOOK_SECRET_KEY";
    const orig = f.ctx.run;
    // fail only the jobs Worker's put, after the API Worker has the new value
    f.ctx.run = async (cmd, a, o) => (a.includes("put") && a.includes("WEBHOOK_SECRET_KEY") && a.some((x) => x.endsWith("jobs.toml")) ? { code: 1, stdout: "", stderr: "network down" } : orig(cmd, a, o));
    const { execute } = await import("../cli.ts");
    const { parseArgs } = await import("../core.ts");
    const bad = await execute({ ...f.ctx, flags: parseArgs(args).flags, yes: true }, "secrets");
    expect(bad.result.code).toBe("error");
    expect(readFileSync(rec, "utf8")).toBe(old); // the live file still holds what the old value was
    expect(existsSync(`${rec}.new`)).toBe(true);
    const staged = /^WEBHOOK_SECRET_KEY=(.+)$/m.exec(readFileSync(`${rec}.new`, "utf8"))![1]!;
    expect(staged).not.toBe(/^WEBHOOK_SECRET_KEY=(.+)$/m.exec(old)![1]);
    // resume: same command with a working jobs Worker, and also with no flags at all
    f.ctx.run = orig;
    f.cf.failPut = null;
    const ok = await f.step("secrets", "--yes", "--recovery-file", rec);
    expect(ok.r.code, ok.r.message).toBe("ok");
    const sets = putsOf(f, "WEBHOOK_SECRET_KEY").map((c) => c.input);
    expect(sets.at(-1)).toBe(staged);
    expect(sets.at(-2)).toBe(staged);
    expect(existsSync(`${rec}.new`)).toBe(false);
    expect(readFileSync(rec, "utf8")).toContain(`WEBHOOK_SECRET_KEY=${staged}`);
    expect(readFileSync(`${rec}.previous`, "utf8")).toBe(old);
  });
});

describe("T1-04 secret list output", () => {
  it("unparseable output is an error and changes nothing; a banner before the array is fine", async () => {
    const f = makeFake();
    await secretsReady(f);
    f.cf.listOutput = "something unexpected";
    const bad = await f.step("secrets", "--yes", "--recovery-file", recovery());
    expect(bad.r.code).toBe("error");
    expect(f.calls.some((c) => c.args.includes("put"))).toBe(false);
    f.cf.listOutput = 'Note [beta] feature\n[{"name":"SUPABASE_URL","type":"secret_text"}]';
    expect((await f.step("secrets", "--yes", "--recovery-file", recovery())).r.code).toBe("ok");
    expect(putsOf(f, "SUPABASE_URL")).toHaveLength(0);
  });
});

describe("T1-05 recovery file safety", () => {
  it("refuses '..name' in the repo, symlinks, and files this tool did not write", async () => {
    const f = makeFake();
    await secretsReady(f);
    const dir = mkdtempSync(join(tmpdir(), "t1-rf-"));
    const inRepoName = await f.step("secrets", "--yes", "--recovery-file", join(f.root, "..recovery.env"));
    expect(inRepoName.r.code).toBe("needs_input");
    // a symlink outside the repo that points into it
    mkdirSync(join(f.root, "inside"));
    symlinkSync(join(f.root, "inside"), join(dir, "link"));
    expect((await f.step("secrets", "--yes", "--recovery-file", join(dir, "link", "r.env"))).r.code).toBe("needs_input");
    symlinkSync(join(dir, "elsewhere"), join(dir, "r2.env"));
    expect((await f.step("secrets", "--yes", "--recovery-file", join(dir, "r2.env"))).r.message).toContain("symbolic link");
    // someone else's file
    writeFileSync(join(dir, "config"), "Host x\n  User y\n");
    const other = await f.step("secrets", "--yes", "--recovery-file", join(dir, "config"));
    expect(other.r.code).toBe("needs_input");
    expect(readFileSync(join(dir, "config"), "utf8")).toBe("Host x\n  User y\n");
    expect(f.calls.some((c) => c.args.includes("put"))).toBe(false);
  });
  it("creates the file with mode 0600 and no temp files left behind", async () => {
    const f = makeFake();
    await secretsReady(f);
    const rec = recovery();
    await f.step("secrets", "--yes", "--recovery-file", rec);
    const { readdirSync, statSync } = await import("node:fs");
    const { dirname } = await import("node:path");
    expect(readdirSync(dirname(rec))).toEqual(["recovery.env"]);
    expect(statSync(rec).mode & 0o777).toBe(0o600);
  });
});

describe("T1-07 Resend key", () => {
  it("secrets never puts the operator's Resend key on the Workers", async () => {
    const f = makeFake({ env: { RESEND_API_KEY: SECRET.resend } });
    await secretsReady(f, "--resend", "on");
    await f.step("secrets", "--yes", "--recovery-file", recovery());
    expect(f.calls.some((c) => c.args.includes("RESEND_API_KEY"))).toBe(false);
    expect(f.calls.some((c) => c.input === SECRET.resend)).toBe(false);
    expect(f.cf.secrets.get("api.toml")!.has("RESEND_API_KEY")).toBe(false);
    expect((await f.step("secrets", "--yes", "--recovery-file", recovery(), "--rotate", "RESEND_API_KEY")).r.code).toBe("needs_input");
  });
});

describe("T1-09 legacy keys and session signing", () => {
  it("sets SUPABASE_JWT_SECRET only for a project that signs with the legacy secret, and verify insists on it", async () => {
    const f = makeFake();
    f.sb.signing = [];
    await secretsReady(f);
    await f.step("secrets", "--yes", "--recovery-file", recovery());
    expect(f.cf.secrets.get("api.toml")!.has("SUPABASE_JWT_SECRET")).toBe(true);
    expect(f.cf.secrets.get("jobs.toml")!.has("SUPABASE_JWT_SECRET")).toBe(false);
    expect(f.everythingVisible()).not.toContain(f.sb.jwtSecret);
    const g = makeFake();
    await secretsReady(g);
    await g.step("secrets", "--yes", "--recovery-file", recovery());
    expect(g.cf.secrets.get("api.toml")!.has("SUPABASE_JWT_SECRET")).toBe(false);
  });
  it("says what to do when the legacy API keys are switched off", async () => {
    const f = makeFake({ routes: (_m, url) => (url.includes("/api-keys") ? new Response("[]", { status: 200 }) : undefined) });
    await secretsReady(f).catch(() => undefined);
    const r = await f.step("secrets", "--yes", "--recovery-file", recovery());
    expect(["error", "needs_input"]).toContain(r.r.code);
    expect(r.r.message + JSON.stringify(f.printed)).toMatch(/legacy/i);
  });
});

describe("T1-09 verify and legacy signing", () => {
  it("verify fails when legacy signing is recorded but the secret is missing", async () => {
    const f = makeFake();
    await secretsReady(f);
    await f.step("secrets", "--yes", "--recovery-file", recovery());
    const { patchState } = await import("../core.ts");
    patchState(f.ctx, { supabase: { legacySigning: true }, secrets: { api: ["SUPABASE_URL"] } });
    const r = await f.step("verify", "--yes");
    expect(r.r.code).toBe("error");
    expect(r.r.message).toContain("session signing");
  });
});
