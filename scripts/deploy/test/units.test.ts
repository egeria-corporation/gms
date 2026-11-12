// SPDX-License-Identifier: AGPL-3.0-only
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { generateConfig } from "../generate.ts";
import { forWorkersDev } from "../steps/deploy.ts";
import { recoveryPathProblem } from "../steps/secrets.ts";
import { releaseNotes } from "../steps/upgrade.ts";
import { REPO } from "./harness.ts";

describe("releaseNotes", () => {
  const log = "# Changelog\n\n## [1.2.0] - 2026-12-01\nNew thing.\n\n## v1.1.0\nOld.\n";
  it("finds a version in either heading style and stops at the next heading", () => {
    expect(releaseNotes(log, "v1.2.0")).toBe("## [1.2.0] - 2026-12-01\nNew thing.");
    expect(releaseNotes(log, "v1.1.0")).toBe("## v1.1.0\nOld.");
    expect(releaseNotes(log, "v9.9.9")).toBeNull();
  });
});

describe("generateConfig", () => {
  it("keeps multi-line routes out and replaces dev bindings with production ones", () => {
    const base = 'name = "gms-api"\nmain = "src/index.ts"\nworkers_dev = true\n\n[[r2_buckets]]\nbinding = "A"\nbucket_name = "gms-a-dev"\n\n[env.production]\nname = "gms-api"\nroutes = [\n  { pattern = "x/*" },\n]\n\n[[env.production.r2_buckets]]\nbinding = "A"\nbucket_name = "gms-a"\n';
    const out = generateConfig(base, { name: "zed", workerName: "zed-api", url: "https://z.example", kvId: "0".repeat(32), appDir: "/app", passport: { on: true } });
    expect(out).toContain('name = "zed-api"');
    expect(out).toContain('bucket_name = "zed-a"');
    expect(out).not.toContain("-dev");
    expect(out).not.toContain("routes");
    expect(out).toContain('main = "/app/src/index.ts"');
    expect(out).toContain("workers_dev = false");
  });
});

describe("small helpers", () => {
  it("turns the front Worker config into a workers.dev one", () => {
    const t = forWorkersDev('name = "w"\nworkers_dev = false\nroutes = [{ pattern = "h", custom_domain = true }]\n\n[[services]]\n');
    expect(t).toContain("workers_dev = true");
    expect(t).not.toContain("routes");
  });
  it("refuses recovery paths inside the repository, including through .. segments", () => {
    expect(recoveryPathProblem(REPO, join(REPO, "x.env"))).toContain("outside the repository");
    expect(recoveryPathProblem(REPO, join(REPO, "scripts", "..", "x.env"))).toContain("outside the repository");
    expect(recoveryPathProblem(REPO, join(mkdtempSync(join(tmpdir(), "t1-ok-")), "x.env"))).toBeNull();
  });
});

describe("the real CLI", () => {
  it("runs under Node's type stripping and ends with one JSON line", () => {
    const r = spawnSync(process.execPath, [join(REPO, "scripts", "deploy", "cli.ts"), "deploy", "bogus"], { encoding: "utf8" });
    const lines = r.stdout.trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({ step: "bogus", code: "error", next: null });
    expect(r.status).toBe(1);
    const usage = spawnSync(process.execPath, [join(REPO, "scripts", "deploy", "cli.ts")], { encoding: "utf8" });
    expect(usage.status).toBe(1);
    expect(JSON.parse(usage.stdout.trim().split("\n").at(-1)!).code).toBe("error");
  });
});
