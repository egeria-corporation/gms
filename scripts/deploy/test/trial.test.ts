// SPDX-License-Identifier: AGPL-3.0-only
// Fixes from the first live trial: no asset upload, step order on workers.dev, one cron trigger.
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { OPENAPI_OBJECT_KEY } from "../steps/deploy.ts";
import { makeFake, REPO } from "./harness.ts";

const recovery = () => join(mkdtempSync(join(tmpdir(), "t1b-rec-")), "recovery.env");

describe("deploy without static assets", () => {
  it("generates an API config with no [assets] block and uploads openapi.json to R2 first", async () => {
    const f = makeFake();
    await f.step("init", "--email", "ops@example.org", "--name", "demo", "--workers-subdomain", "tester");
    for (const s of ["supabase", "migrate", "cloudflare", "auth"]) expect(["ok", "skipped"]).toContain((await f.step(s, "--yes")).r.code);
    await f.step("secrets", "--yes", "--recovery-file", recovery());
    const api = readFileSync(join(f.deployDir, "generated", "api.toml"), "utf8");
    expect(api).not.toContain("[assets]");
    expect(api).not.toContain("run_worker_first");
    expect(api).toContain("[[r2_buckets]]");
    expect(api).toContain('bucket_name = "demo-exports"');
    const n = f.calls.length;
    expect((await f.step("deploy", "--yes")).r.code).toBe("ok");
    const cmds = f.calls.slice(n).map((c) => c.args.join(" "));
    const put = cmds.findIndex((c) => c.includes("r2 object put"));
    expect(put).toBeGreaterThan(-1);
    expect(cmds[put]).toContain(`demo-exports/${OPENAPI_OBJECT_KEY}`);
    expect(cmds[put]).toContain("--remote");
    expect(cmds[put]).toContain(join(f.root, "apps", "api", "public", "openapi.json"));
    expect(put).toBeGreaterThan(cmds.findIndex((c) => c.includes("build:openapi")));
    expect(put).toBeLessThan(cmds.findIndex((c) => c.includes("@gms/api exec wrangler deploy")));
    expect(readFileSync(join(REPO, "apps", "api", "wrangler.toml"), "utf8")).toContain("[assets]"); // checked-in file unchanged
  });
  it("refuses a generated config from before this change", async () => {
    const f = makeFake();
    await f.step("init", "--email", "ops@example.org", "--name", "demo", "--workers-subdomain", "tester");
    for (const s of ["supabase", "migrate", "cloudflare", "auth"]) await f.step(s, "--yes");
    await f.step("secrets", "--yes", "--recovery-file", recovery());
    const p = join(f.deployDir, "generated", "api.toml");
    writeFileSync(p, readFileSync(p, "utf8") + '\n[assets]\ndirectory = "./public"\n');
    const r = await f.step("deploy", "--yes");
    expect(r.r.code).toBe("needs_input");
    expect(r.r.next).toBe("cloudflare");
  });
  it("the object key matches what the API reads, and the front Worker forwards /openapi.json", () => {
    expect(readFileSync(join(REPO, "apps", "api", "src", "index.ts"), "utf8")).toContain(`OPENAPI_OBJECT_KEY = "${OPENAPI_OBJECT_KEY}"`);
    expect(readFileSync(join(REPO, "apps", "api", "src", "index.ts"), "utf8")).toContain("env.EXPORTS?.get(OPENAPI_OBJECT_KEY)");
    expect(readFileSync(join(REPO, "scripts", "build-front-worker.mjs"), "utf8")).toContain('"/openapi.json"');
  });
});

describe("step order on workers.dev", () => {
  it("following `next` from supabase gives migrate, cloudflare, auth, secrets, deploy, verify", async () => {
    const f = makeFake();
    await f.step("init", "--email", "ops@example.org", "--name", "demo", "--workers-subdomain", "tester");
    const seen: string[] = [];
    let step: string | null = "supabase";
    const rec = recovery();
    while (step && step !== "status" && seen.length < 10) {
      seen.push(step);
      const extra = step === "secrets" ? ["--recovery-file", rec] : [];
      const r = await f.step(step, "--yes", ...extra);
      expect(["ok", "skipped"], `${step}: ${r.r.message}`).toContain(r.r.code);
      step = r.r.next ?? null;
    }
    expect(seen).toEqual(["supabase", "migrate", "cloudflare", "auth", "secrets", "deploy", "verify"]);
  });
  it("auth before cloudflare on workers.dev points back to cloudflare", async () => {
    const f = makeFake({ env: { CLOUDFLARE_API_TOKEN: "cf_api_token_DDDDDDDDDDDDDDDD" } }); // the subdomain is only read by the cloudflare step
    await f.step("init", "--email", "ops@example.org", "--name", "demo");
    await f.step("supabase", "--yes");
    await f.step("migrate", "--yes");
    const r = await f.step("auth", "--yes");
    expect(r.r.code).toBe("needs_input");
    expect(r.r.next).toBe("cloudflare");
  });
});

describe("doctor and the jobs schedule", () => {
  it("the checked-in jobs config needs one trigger, so there is no warning; seven would warn", async () => {
    const f = makeFake();
    const ok = await f.step("doctor");
    expect(ok.r.data?.cronTriggers).toBe(1);
    expect(JSON.stringify(ok.r.data?.warnings)).not.toContain("scheduled triggers");
    const bad = makeFake();
    const p = join(bad.root, "apps", "jobs", "wrangler.toml");
    writeFileSync(p, readFileSync(p, "utf8").replace(/(\[env\.production\.triggers\]\s*\ncrons = )\[.*\]/, '$1["*/5 * * * *", "*/15 * * * *", "0 * * * *", "0 */6 * * *", "30 2 * * *", "0 15 * * *", "5 15 * * 1"]'));
    expect(JSON.stringify((await bad.step("doctor")).r.data?.warnings)).toContain("7 scheduled triggers");
  });
});
