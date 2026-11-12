// SPDX-License-Identifier: AGPL-3.0-only
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { exitCodeFor, parseArgs } from "../core.ts";
import type { Fake } from "./harness.ts";
import { makeFake, SECRET } from "./harness.ts";

const parse = (line: string) => JSON.parse(line) as { step: string; code: string; message: string; data: Record<string, any>; next: string | null }; // eslint-disable-line @typescript-eslint/no-explicit-any

async function initted(f: Fake, ...extra: string[]) {
  const r = await f.step("init", "--email", "ops@example.org", "--name", "demo", ...extra);
  expect(r.r.code).toBe("ok");
}
const recoveryPath = () => join(mkdtempSync(join(tmpdir(), "t1-rec-")), "recovery.env");

/** Run the steps up to (and including) `upto`, all confirmed. */
async function through(f: Fake, upto: string, extra: Record<string, string[]> = {}) {
  await initted(f, ...(extra.init ?? []));
  const order = ["supabase", "migrate", "auth", "cloudflare", "secrets", "deploy"];
  for (const s of order) {
    const r = await f.step(s, "--yes", ...(s === "deploy" ? ["--replace-dns"] : []), ...(extra[s] ?? []));
    expect(["ok", "skipped"], `${s}: ${r.r.message}`).toContain(r.r.code);
    if (s === upto) return;
  }
}

describe("output contract", () => {
  it("prints one JSON line with the documented fields and maps codes to exit codes", async () => {
    const f = makeFake();
    const { line, exit } = await f.step("status");
    expect(line.split("\n")).toHaveLength(1);
    expect(Object.keys(parse(line)).sort()).toEqual(["code", "data", "message", "next", "step"]);
    expect(exit).toBe(3);
    expect(exitCodeFor("ok")).toBe(0);
    expect(exitCodeFor("skipped")).toBe(0);
    expect(exitCodeFor("error")).toBe(1);
    for (const c of ["needs_login", "needs_input", "needs_confirmation", "plan_limit"] as const) expect(exitCodeFor(c)).toBe(3);
    expect((await f.step("nope")).exit).toBe(1);
  });
  it("parses flags", () => {
    expect(parseArgs(["deploy", "secrets", "--yes", "--recovery-file", "/x/y", "--org=o1", "--dry-run"])).toEqual({ positional: ["deploy", "secrets"], flags: { yes: true, "recovery-file": "/x/y", org: "o1", "dry-run": true } });
  });
});

describe("init", () => {
  it("records choices, is idempotent, and dry-run writes nothing", async () => {
    const f = makeFake();
    expect((await f.step("init", "--dry-run", "--email", "a@b.org")).r.code).toBe("ok");
    expect(existsSync(join(f.deployDir, "config.json"))).toBe(false);
    expect((await f.step("init")).r.code).toBe("needs_input");
    expect((await f.step("init", "--email", "a@b.org", "--host", "grants.example.org", "--passport", "off")).r.code).toBe("ok");
    const cfg = JSON.parse(readFileSync(join(f.deployDir, "config.json"), "utf8"));
    expect(cfg).toMatchObject({ name: "gms", host: "grants.example.org", passport: false, region: "us-east-1", resend: false });
    expect((await f.step("init", "--email", "a@b.org", "--host", "grants.example.org", "--passport", "off")).r.code).toBe("skipped");
    expect((await f.step("init", "--host", "not a host")).r.code).toBe("needs_input");
  });
});

describe("supabase", () => {
  it("asks first, creates once, stores only ref and url, and resumes as skipped", async () => {
    const f = makeFake();
    await initted(f);
    const ask = await f.step("supabase");
    expect(ask.r.code).toBe("needs_confirmation");
    expect(f.requests.some((r) => r.method === "POST")).toBe(false);
    expect((await f.step("supabase", "--dry-run")).r.code).toBe("ok");
    expect(f.requests.some((r) => r.method === "POST")).toBe(false);
    f.sb.healthyAfter = 3;
    const made = await f.step("supabase", "--yes");
    expect(made.r.code).toBe("ok");
    const post = f.requests.find((r) => r.method === "POST" && r.url.endsWith("/projects"))!;
    expect(post.body).toMatchObject({ name: "demo", organization_slug: "org1", region_selection: { type: "specific", code: "us-east-1" } });
    const dbPass = (post.body as { db_pass: string }).db_pass;
    expect(dbPass.length).toBeGreaterThan(20);
    const state = JSON.parse(readFileSync(join(f.deployDir, "state.json"), "utf8"));
    expect(state.supabase).toEqual({ ref: "abcdefghijklmnopqrst", url: "https://abcdefghijklmnopqrst.supabase.co", region: "us-east-1" });
    expect(f.everythingVisible()).not.toContain(dbPass);
    expect((await f.step("supabase", "--yes")).r.code).toBe("skipped");
    expect(f.requests.filter((r) => r.method === "POST" && r.url.endsWith("/projects"))).toHaveLength(1);
  });
  it("needs a login, a plan, and reports the plan limit", async () => {
    const f = makeFake({ env: { SUPABASE_ACCESS_TOKEN: undefined } });
    await initted(f);
    expect((await f.step("supabase", "--yes")).r.code).toBe("needs_login");
    const g = makeFake();
    await initted(g);
    g.sb.createStatus = 402;
    g.sb.createMessage = "You have reached the maximum limit of free projects";
    const r = await g.step("supabase", "--yes");
    expect(r.r.code).toBe("plan_limit");
    expect(r.r.message).toContain("--adopt");
  });
  it("warns at the free-plan count and refuses to duplicate a project with the same name", async () => {
    const f = makeFake();
    await initted(f);
    f.sb.projects = [
      { ref: "aaaaaaaaaaaaaaaaaaaa", name: "x", organization_slug: "org1", status: "ACTIVE_HEALTHY" },
      { ref: "bbbbbbbbbbbbbbbbbbbb", name: "y", organization_slug: "org1", status: "ACTIVE_HEALTHY" },
    ];
    const ask = await f.step("supabase");
    expect(ask.r.message).toContain("free plan allows 2");
    f.sb.projects.push({ ref: "cccccccccccccccccccc", name: "demo", organization_slug: "org1", status: "ACTIVE_HEALTHY" });
    const dup = await f.step("supabase", "--yes");
    expect(dup.r.code).toBe("needs_input");
    expect(dup.r.message).toContain("--adopt cccccccccccccccccccc");
  });
  it("adopts an existing project", async () => {
    const f = makeFake();
    await initted(f);
    f.sb.projects = [{ ref: "cccccccccccccccccccc", name: "mine", organization_slug: "org1", status: "ACTIVE_HEALTHY" }];
    expect((await f.step("supabase", "--adopt", "cccccccccccccccccccc")).r.code).toBe("ok");
    expect(JSON.parse(readFileSync(join(f.deployDir, "state.json"), "utf8")).supabase.ref).toBe("cccccccccccccccccccc");
  });
});

describe("migrate", () => {
  it("applies pending files in order, each in a transaction that records itself", async () => {
    const f = makeFake();
    await through(f, "supabase");
    expect((await f.step("migrate")).r.code).toBe("needs_confirmation");
    const before = f.sb.queries.length;
    expect((await f.step("migrate", "--dry-run")).r.data?.plan).toBeTruthy();
    expect(f.sb.queries.slice(before).every((q) => q.startsWith("select"))).toBe(true);
    const r = await f.step("migrate", "--yes");
    expect(r.r.code).toBe("ok");
    const applies = f.sb.queries.filter((q) => q.startsWith("begin;"));
    expect(applies).toHaveLength(3);
    for (const q of applies) {
      expect(q.trimEnd().endsWith("commit;")).toBe(true);
      expect(q).toContain("insert into supabase_migrations.schema_migrations");
    }
    expect(applies[0]).toContain("0001_init.sql");
    expect(f.sb.sbVersions).toEqual(["0001", "0002", "0003"]);
    expect((await f.step("migrate", "--yes")).r.code).toBe("skipped");
  });
  it("counts a migration as applied if it is in either history table", async () => {
    const f = makeFake();
    await through(f, "supabase");
    f.sb.sbVersions = ["0001"];
    f.sb.gmsNames = ["0002_workspaces.sql"];
    const r = await f.step("migrate", "--yes");
    expect(r.r.data?.applied).toEqual(["0003_programs.sql"]);
    f.sb.gmsNames = ["0001_init.sql", "0002_workspaces.sql", "0003_programs.sql"];
    f.sb.sbVersions = null;
    expect((await f.step("migrate", "--yes")).r.code).toBe("skipped");
  });
  it("warns before touching a database that holds tables the GMS did not create", async () => {
    const f = makeFake();
    await through(f, "supabase");
    f.sb.publicTables = 4;
    const r = await f.step("migrate");
    expect(r.r.code).toBe("needs_confirmation");
    expect(r.r.message).toContain("did not create");
    expect(f.sb.queries.some((q) => q.startsWith("begin;") || q.startsWith("create schema"))).toBe(false);
  });
  it("stops at a failing migration and resumes from it", async () => {
    const f = makeFake();
    await through(f, "supabase");
    f.sb.failMigration = "0002_workspaces.sql";
    const r = await f.step("migrate", "--yes");
    expect(r.r.code).toBe("error");
    expect(r.r.data?.failed).toBe("0002_workspaces.sql");
    f.sb.failMigration = null;
    expect((await f.step("migrate", "--yes")).r.data?.applied).toEqual(["0002_workspaces.sql", "0003_programs.sql"]);
  });
});

describe("auth", () => {
  it("sets the sign-in settings, keeps existing return addresses, reads back, then skips", async () => {
    const f = makeFake();
    await through(f, "migrate", { init: ["--host", "grants.example.org"] });
    expect((await f.step("auth")).r.code).toBe("needs_confirmation");
    expect((await f.step("auth", "--dry-run")).r.code).toBe("ok");
    expect(f.requests.some((r) => r.method === "PATCH")).toBe(false);
    expect((await f.step("auth", "--yes")).r.code).toBe("ok");
    expect(f.sb.authConfig).toMatchObject({ site_url: "https://grants.example.org", mailer_autoconfirm: false, external_email_enabled: true, mfa_totp_enroll_enabled: true, mfa_totp_verify_enabled: true });
    expect((f.sb.authConfig.uri_allow_list as string).split(",")).toEqual(["https://old.example/cb", "https://grants.example.org/auth/callback", "https://grants.example.org/signin"]);
    expect((await f.step("auth", "--yes")).r.code).toBe("skipped");
  });
  it("reports a setting that did not take", async () => {
    const f = makeFake({
      routes: (method, url, body) => (method === "PATCH" && url.endsWith("/config/auth") && "mfa_totp_enroll_enabled" in body ? new Response("{}", { status: 200 }) : undefined),
    });
    await through(f, "migrate", { init: ["--host", "grants.example.org"] });
    const r = await f.step("auth", "--yes");
    expect(r.r.code).toBe("error");
    expect(r.r.message).toContain("did not take");
  });
});

describe("cloudflare", () => {
  it("creates resources, writes configs with this instance's names, and then skips", async () => {
    const f = makeFake();
    await through(f, "auth", { init: ["--host", "grants.example.org"] });
    expect((await f.step("cloudflare")).r.code).toBe("needs_confirmation");
    expect(f.cf.buckets.size).toBe(0);
    expect((await f.step("cloudflare", "--dry-run")).r.code).toBe("ok");
    expect(f.cf.buckets.size).toBe(0);
    expect((await f.step("cloudflare", "--yes")).r.code).toBe("ok");
    expect([...f.cf.buckets].sort()).toEqual(["demo-attachments", "demo-exports", "demo-ledger-archive"]);
    expect([...f.cf.queues].sort()).toEqual(["demo-events", "demo-events-dlq"]);
    expect(f.cf.kv.map((k) => k.title)).toEqual(["demo-rate-limit"]);

    const api = readFileSync(join(f.deployDir, "generated", "api.toml"), "utf8");
    const jobs = readFileSync(join(f.deployDir, "generated", "jobs.toml"), "utf8");
    expect(api).toContain('name = "demo-api"');
    expect(jobs).toContain('name = "demo-jobs"');
    for (const t of [api, jobs]) {
      expect(t).not.toMatch(/-dev"|-staging"|gms-/);
      expect(t).not.toMatch(/^\[+env\./m);
      expect(t).not.toContain("workers_dev = true");
      expect(t).not.toContain("00000000000000000000000000000000");
    }
    expect(api).toContain('bucket_name = "demo-attachments"');
    expect(api).toContain('queue = "demo-events"');
    expect(api).toContain('id = "0123456789abcdef0123456789abcdef"');
    expect(api).toContain('GMS_BASE_URL = "https://grants.example.org"');
    expect(api).toContain('OAUTH_ISSUER = "https://grants.example.org"');
    expect(api).toContain('PASSPORT_BASE_URL = "https://passport.opengrants.io"');
    expect(api).toContain(`main = "${join(f.root, "apps", "api", "src", "index.ts")}"`);
    expect(api).not.toContain("[assets]"); // served from R2 instead (see the deploy step)
    expect(jobs).toContain('queue = "demo-events"');
    expect(jobs).toContain('dead_letter_queue = "demo-events-dlq"');
    expect(jobs).toContain("crons =");
    expect(jobs).not.toContain("routes");
    expect(readFileSync(join(f.root, "apps", "api", "wrangler.toml"), "utf8")).toContain('name = "gms-api"'); // checked-in file untouched
    expect((await f.step("cloudflare", "--yes")).r.code).toBe("skipped");
  });
  it("leaves out Passport settings when Passport is off, and needs the workers.dev name when there is no domain", async () => {
    const f = makeFake();
    await through(f, "migrate", { init: ["--passport", "off", "--workers-subdomain", "tester"] });
    await f.step("auth", "--yes");
    await f.step("cloudflare", "--yes");
    const api = readFileSync(join(f.deployDir, "generated", "api.toml"), "utf8");
    expect(api).not.toContain("PASSPORT_");
    expect(api).toContain('GMS_BASE_URL = "https://demo-web.tester.workers.dev"');

    const g = makeFake();
    await initted(g);
    expect((await g.step("cloudflare", "--yes")).r.code).toBe("needs_input");
  });
  it("needs a login when Cloudflare is not signed in", async () => {
    const f = makeFake();
    await initted(f, "--host", "grants.example.org");
    f.cf.loggedIn = false;
    expect((await f.step("cloudflare", "--yes")).r.code).toBe("needs_login");
  });
});

describe("secrets", () => {
  async function ready(f: Fake) {
    await through(f, "cloudflare", { init: ["--host", "grants.example.org"] });
  }
  it("requires a recovery file outside the repository", async () => {
    const f = makeFake();
    await ready(f);
    expect((await f.step("secrets", "--yes")).r.code).toBe("needs_input");
    const inside = await f.step("secrets", "--yes", "--recovery-file", join(f.root, "recovery.env"));
    expect(inside.r.code).toBe("needs_input");
    expect(inside.r.message).toContain("outside the repository");
    expect(existsSync(join(f.root, "recovery.env"))).toBe(false);
    expect((await f.step("secrets", "--yes", "--recovery-file", "relative.env")).r.code).toBe("needs_input");
    expect([...f.cf.secrets.values()].every((x) => x.size === 0)).toBe(true);
  });
  it("sets every secret over stdin, writes a private recovery file, prints and stores none of them, then skips", async () => {
    const f = makeFake();
    await ready(f);
    const rec = recoveryPath();
    expect((await f.step("secrets", "--recovery-file", rec)).r.code).toBe("needs_confirmation");
    expect(existsSync(rec)).toBe(false);
    expect((await f.step("secrets", "--dry-run", "--recovery-file", rec)).r.code).toBe("ok");
    expect([...f.cf.secrets.values()].every((x) => x.size === 0)).toBe(true);
    expect(existsSync(rec)).toBe(false);
    const r = await f.step("secrets", "--yes", "--recovery-file", rec);
    expect(r.r.code).toBe("ok");
    expect(statSync(rec).mode & 0o777).toBe(0o600);
    const text = readFileSync(rec, "utf8");
    expect(text).toContain("lose");
    expect(text).toMatch(/^CREDENTIALS_ENCRYPTION_KEY=\S+$/m);
    expect(text).toMatch(/^WEBHOOK_SECRET_KEY=\S+$/m);
    expect(text).toMatch(/^OAUTH_KID=oauth-2026-11-12-/m);
    const jwk = JSON.parse(/^OAUTH_SIGNING_KEY_JWK=(.*)$/m.exec(text)![1]!);
    expect(jwk).toMatchObject({ kty: "EC", crv: "P-256" });
    expect(jwk.d).toBeTruthy();
    expect([...f.cf.secrets.get("api.toml")!].sort()).toEqual(["CREDENTIALS_ENCRYPTION_KEY", "OAUTH_KID", "OAUTH_SIGNING_KEY_JWK", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_URL", "WEBHOOK_SECRET_KEY"]);
    expect([...f.cf.secrets.get("jobs.toml")!].sort()).toEqual(["CREDENTIALS_ENCRYPTION_KEY", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_URL", "WEBHOOK_SECRET_KEY"]);
    const put = f.calls.filter((c) => c.args.includes("put"));
    expect(put.every((c) => c.input && !c.args.join(" ").includes(c.input))).toBe(true);
    const cred = put.filter((c) => c.args.includes("CREDENTIALS_ENCRYPTION_KEY")).map((c) => c.input);
    expect(new Set(cred).size).toBe(1); // both Workers share it
    const visible = f.everythingVisible();
    for (const secret of [SECRET.service, SECRET.anon, SECRET.sbToken, jwk.d, /^CREDENTIALS_ENCRYPTION_KEY=(\S+)$/m.exec(text)![1]!, /^WEBHOOK_SECRET_KEY=(\S+)$/m.exec(text)![1]!]) expect(visible).not.toContain(secret);
    expect((await f.step("secrets", "--yes", "--recovery-file", rec)).r.code).toBe("skipped");
  });
  it("never overwrites existing secrets without --rotate, and --rotate asks first", async () => {
    const f = makeFake();
    await ready(f);
    const rec = recoveryPath();
    await f.step("secrets", "--yes", "--recovery-file", rec);
    const before = readFileSync(rec, "utf8");
    f.cf.secrets.get("jobs.toml")!.delete("WEBHOOK_SECRET_KEY");
    const putsBefore = f.calls.filter((c) => c.args.includes("put")).length;
    const part = await f.step("secrets", "--yes", "--recovery-file", rec);
    expect(part.r.data?.jobs).toEqual(["WEBHOOK_SECRET_KEY"]);
    expect(f.calls.filter((c) => c.args.includes("put")).length - putsBefore).toBe(1);
    expect(readFileSync(rec, "utf8")).toBe(before); // the same value is reused, so the file is unchanged
    expect((await f.step("secrets", "--rotate", "--recovery-file", rec)).r.code).toBe("needs_input");
    expect((await f.step("secrets", "--rotate", "WEBHOOK_SECRET_KEY", "--recovery-file", rec)).r.code).toBe("needs_input");
    const rot = await f.step("secrets", "--rotate", "WEBHOOK_SECRET_KEY", "--rotate-keys", "--recovery-file", rec);
    expect(rot.r.code).toBe("needs_confirmation");
    expect(rot.r.message).toContain("unreadable");
  });
});

describe("deploy", () => {
  async function ready(f: Fake, ...init: string[]) {
    await through(f, "cloudflare", { init });
    const r = await f.step("secrets", "--yes", "--recovery-file", recoveryPath());
    expect(r.r.code).toBe("ok");
  }
  it("builds and deploys in order with the instance's origins, then skips the same version", async () => {
    const f = makeFake();
    await ready(f, "--host", "grants.example.org");
    expect((await f.step("deploy", "--replace-dns")).r.code).toBe("needs_confirmation");
    const n = f.calls.length;
    expect((await f.step("deploy", "--dry-run")).r.code).toBe("ok");
    expect(f.calls.slice(n).filter((c) => c.cmd !== "git")).toEqual([]);
    const m = f.calls.length;
    const r = await f.step("deploy", "--yes", "--replace-dns");
    expect(r.r.code).toBe("ok");
    const cmds = f.calls.slice(m).map((c) => `${c.cmd} ${c.args.join(" ")}`);
    const idx = (needle: string) => cmds.findIndex((c) => c.includes(needle));
    expect(idx("spec:compile")).toBeLessThan(idx("build:openapi"));
    expect(idx("build:openapi")).toBeLessThan(idx("@gms/api exec wrangler deploy"));
    expect(idx("@gms/api exec wrangler deploy")).toBeLessThan(idx("@gms/jobs exec wrangler deploy"));
    expect(idx("@gms/jobs exec wrangler deploy")).toBeLessThan(idx("@gms/web build"));
    expect(idx("@gms/web build")).toBeLessThan(idx("build-front-worker.mjs"));
    expect(idx("build-front-worker.mjs")).toBeLessThan(idx("@gms/web exec wrangler deploy"));
    expect(cmds[idx("build-front-worker.mjs")]).toContain("--name demo-web --host grants.example.org --api demo-api");
    expect(cmds[idx("@gms/api exec wrangler deploy")]).toContain(join(f.deployDir, "generated", "api.toml"));
    const web = f.calls.find((c) => c.args.join(" ").includes("@gms/web build"))!;
    expect(web.env).toMatchObject({ VITE_USE_MOCKS: "false", VITE_API_BASE_URL: "https://grants.example.org", VITE_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co", VITE_PASSPORT_BASE_URL: "https://passport.opengrants.io" });
    const state = JSON.parse(readFileSync(join(f.deployDir, "state.json"), "utf8"));
    expect(state.deploy).toMatchObject({ version: "v1.0.0", urls: { instance: "https://grants.example.org" } });
    expect(f.everythingVisible()).not.toContain(SECRET.anon);
    expect((await f.step("deploy", "--yes", "--replace-dns")).r.code).toBe("skipped");
  });
  it("needs the earlier steps", async () => {
    const f = makeFake();
    await initted(f);
    expect((await f.step("deploy", "--yes", "--replace-dns")).r.code).toBe("needs_input");
  });
  it("stops and says where when a build fails", async () => {
    const f = makeFake();
    await ready(f, "--host", "grants.example.org");
    const orig = f.ctx.run;
    f.ctx.run = async (cmd, args, o) => (args.includes("build:openapi") ? { code: 1, stdout: "", stderr: "tsc failed" } : orig(cmd, args, o));
    const { flags } = parseArgs(["--yes", "--replace-dns"]);
    const { execute } = await import("../cli.ts");
    const out = await execute({ ...f.ctx, flags, yes: true }, "deploy");
    expect(out.result.code).toBe("error");
    expect(out.result.message).toContain("OpenAPI");
  });
});

describe("verify", () => {
  it("runs the read-only checks, asks before sending the code, and records the result", async () => {
    const f = makeFake();
    await through(f, "cloudflare", { init: ["--host", "grants.example.org"] });
    const ask = await f.step("verify");
    expect(ask.r.code).toBe("needs_confirmation");
    expect(ask.r.data?.checks).toHaveLength(5);
    expect(f.requests.some((r) => r.url.includes("/auth/v1/otp"))).toBe(false);
    const ok = await f.step("verify", "--yes");
    expect(ok.r.code).toBe("ok");
    const otp = f.requests.find((r) => r.url.includes("/auth/v1/otp"))!;
    expect(otp.body).toMatchObject({ email: "ops@example.org" });
    expect(JSON.parse(readFileSync(join(f.deployDir, "state.json"), "utf8")).verify.ok).toBe(true);
    expect((await f.step("status")).r.data?.lastVerify).toMatchObject({ ok: true });
  });
  it("fails with the failing check named", async () => {
    const f = makeFake({ routes: (_m, url) => (url.endsWith("/health") ? new Response(JSON.stringify({ database: "not_configured" }), { status: 200 }) : undefined) });
    await through(f, "cloudflare", { init: ["--host", "grants.example.org"] });
    const r = await f.step("verify", "--yes");
    expect(r.r.code).toBe("error");
    expect(r.r.message).toContain("health");
  });
});

describe("upgrade", () => {
  it("wants a clean checkout at the tag, shows notes, then migrates, deploys and verifies", async () => {
    const f = makeFake();
    await through(f, "cloudflare", { init: ["--host", "grants.example.org"] });
    await f.step("secrets", "--yes", "--recovery-file", recoveryPath());
    await f.step("deploy", "--yes", "--replace-dns");
    f.git.tag = "v1.0.0";
    expect((await f.step("upgrade")).r.code).toBe("needs_input");
    expect((await f.step("upgrade", "--to", "v1.1.0")).r.message).toContain("git checkout v1.1.0");
    f.git.tag = "v1.1.0";
    f.git.dirty = true;
    expect((await f.step("upgrade", "--to", "v1.1.0")).r.code).toBe("needs_input");
    f.git.dirty = false;
    writeFileSync(join(f.root, "CHANGELOG.md"), "# Changelog\n\n## v1.1.0\nRun the email step again.\n\n## v1.0.0\nFirst.\n");
    const ask = await f.step("upgrade", "--to", "v1.1.0");
    expect(ask.r.code).toBe("needs_confirmation");
    expect(ask.r.message).toContain("Run the email step again.");
    expect(ask.r.message).not.toContain("First.");
    writeFileSync(join(f.root, "supabase", "migrations", "0004_new.sql"), "-- 0004_new.sql\nselect 1;\n");
    const done = await f.step("upgrade", "--to", "v1.1.0", "--yes");
    expect(done.r.code).toBe("ok");
    expect(f.sb.sbVersions).toContain("0004");
    const state = JSON.parse(readFileSync(join(f.deployDir, "state.json"), "utf8"));
    expect(state.version).toBe("v1.1.0");
    expect(state.deploy.version).toBe("v1.1.0");
    expect(state.verify.ok).toBe(true);
    expect((await f.step("upgrade", "--to", "v1.1.0", "--yes")).r.code).toBe("skipped");
  });
});

describe("email, passport and no-leak", () => {
  it("email is skipped when off, and lists DNS records when it cannot add them", async () => {
    const f = makeFake({
      env: { RESEND_API_KEY: SECRET.resend },
      routes: (method, url) => {
        if (url === "https://api.resend.com/domains" && method === "GET") return new Response(JSON.stringify({ data: [] }), { status: 200 });
        if (url === "https://api.resend.com/domains" && method === "POST") return new Response(JSON.stringify({ id: "dom1" }), { status: 201 });
        if (url === "https://api.resend.com/domains/dom1") return new Response(JSON.stringify({ status: "not_started", records: [{ type: "MX", name: "send.mail", value: "feedback-smtp.resend.com", priority: 10 }] }), { status: 200 });
        return undefined;
      },
    });
    await through(f, "cloudflare", { init: ["--host", "grants.example.org"] });
    expect((await f.step("email", "--yes")).r.code).toBe("skipped");
    await f.step("init", "--resend", "on");
    expect((await f.step("email", "--yes")).r.code).toBe("needs_input"); // no --domain
    const r = await f.step("email", "--yes", "--domain", "mail.example.org");
    expect(r.r.code).toBe("needs_input");
    expect(r.r.data?.records).toEqual([{ type: "MX", name: "send.mail", value: "feedback-smtp.resend.com", priority: 10 }]);
    expect(f.everythingVisible()).not.toContain(SECRET.resend);
  });
  it("email completes: DNS, restricted key, Worker secrets and Supabase mail, key never printed", async () => {
    let verified = false;
    const f = makeFake({
      env: { RESEND_API_KEY: SECRET.resend, CLOUDFLARE_API_TOKEN: SECRET.cfToken },
      routes: (method, url, body) => {
        if (url === "https://api.resend.com/domains" && method === "GET") return new Response(JSON.stringify({ data: [] }), { status: 200 });
        if (url === "https://api.resend.com/domains" && method === "POST") return new Response(JSON.stringify({ id: "dom1" }), { status: 201 });
        if (url === "https://api.resend.com/domains/dom1/verify") {
          verified = true;
          return new Response("{}", { status: 200 });
        }
        if (url === "https://api.resend.com/domains/dom1") return new Response(JSON.stringify({ status: verified ? "verified" : "not_started", records: [{ type: "TXT", name: "resend._domainkey.mail", value: "p=abc" }] }), { status: 200 });
        if (url.startsWith("https://api.cloudflare.com/client/v4/zones?name=")) return new Response(JSON.stringify({ result: url.includes("name=example.org") ? [{ id: "zone1" }] : [] }), { status: 200 });
        if (url === "https://api.cloudflare.com/client/v4/zones/zone1/dns_records") return new Response(JSON.stringify({ result: { id: "r" }, sent: body }), { status: 200 });
        if (url === "https://api.resend.com/api-keys" && method === "POST") {
          expect(body).toMatchObject({ permission: "sending_access", domain_id: "dom1" });
          return new Response(JSON.stringify({ id: "key1", token: SECRET.resendSend }), { status: 201 });
        }
        return undefined;
      },
    });
    await through(f, "cloudflare", { init: ["--host", "grants.example.org", "--resend", "on"] });
    const r = await f.step("email", "--yes", "--domain", "mail.example.org", "--from", "grants@mail.example.org");
    expect(r.r.message).toBeTruthy();
    expect(r.r.code, r.r.message).toBe("ok");
    expect(f.cf.secrets.get("api.toml")!.has("RESEND_API_KEY")).toBe(true);
    expect(f.cf.secrets.get("jobs.toml")!.has("RESEND_FROM")).toBe(true);
    expect(f.sb.authConfig).toMatchObject({ smtp_host: "smtp.resend.com", smtp_admin_email: "grants@mail.example.org" });
    const visible = f.everythingVisible();
    for (const s of [SECRET.resend, SECRET.resendSend, SECRET.cfToken]) expect(visible).not.toContain(s);
    expect((await f.step("email", "--yes", "--domain", "mail.example.org", "--from", "grants@mail.example.org")).r.code).toBe("skipped");
  });
  it("doctor reports logins, warns on project count and release state, and changes nothing", async () => {
    const f = makeFake();
    f.sb.projects = [
      { ref: "aaaaaaaaaaaaaaaaaaaa", name: "x", organization_slug: "org1", status: "ACTIVE_HEALTHY" },
      { ref: "bbbbbbbbbbbbbbbbbbbb", name: "y", organization_slug: "org1", status: "ACTIVE_HEALTHY" },
      { ref: "cccccccccccccccccccc", name: "z", organization_slug: "org1", status: "INACTIVE" },
    ];
    f.git.tag = null;
    const r = await f.step("doctor", "--org", "org1");
    expect(r.r.code).toBe("ok");
    expect(r.r.data).toMatchObject({ supabaseActiveProjects: 2, release: null, cloudflareAccountId: "acct1" });
    expect(String(r.r.message)).toContain("free plan allows 2");
    expect(f.requests.every((q) => q.method === "GET")).toBe(true);
    expect(existsSync(join(f.deployDir, "state.json"))).toBe(false);
    f.cf.loggedIn = false;
    expect((await f.step("doctor")).r.code).toBe("needs_login");
  });
  it("a complete run never shows any secret in output, logs, state or generated files", async () => {
    const f = makeFake({ env: { CLOUDFLARE_API_TOKEN: SECRET.cfToken } });
    const rec = recoveryPath();
    await through(f, "cloudflare", { init: ["--host", "grants.example.org"] });
    await f.step("secrets", "--yes", "--recovery-file", rec);
    await f.step("deploy", "--yes", "--replace-dns");
    await f.step("verify", "--yes");
    await f.step("status");
    const recText = readFileSync(rec, "utf8");
    const secretsInFile = [...recText.matchAll(/^[A-Z_]+=(.+)$/gm)].map((m) => m[1]!);
    const visible = f.everythingVisible();
    for (const s of [SECRET.service, SECRET.anon, SECRET.sbToken, SECRET.cfToken, ...secretsInFile]) expect(visible).not.toContain(s);
    // the recovery file is the only place keys land
    expect(visible).not.toContain("BEGIN");
  });
  it("redacts a secret that leaks into an error message", async () => {
    const f = makeFake();
    await through(f, "cloudflare", { init: ["--host", "grants.example.org"] });
    f.cf.failPut = "SUPABASE_ANON_KEY";
    const orig = f.ctx.run;
    f.ctx.run = async (cmd, args, o) => (args.includes("SUPABASE_ANON_KEY") && args.includes("put") ? { code: 1, stdout: "", stderr: `bad value ${o?.input}` } : orig(cmd, args, o));
    const { execute } = await import("../cli.ts");
    const out = await execute({ ...f.ctx, flags: { yes: true, "recovery-file": recoveryPath() }, yes: true }, "secrets");
    expect(out.result.code).toBe("error");
    expect(out.line).not.toContain(SECRET.anon);
    expect(out.line).toContain("[redacted]");
  });
});
