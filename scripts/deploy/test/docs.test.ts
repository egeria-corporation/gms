// SPDX-License-Identifier: AGPL-3.0-only
// The agent runbook must only mention steps and result codes the tool really has, and the release
// files must agree with each other.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ORDER, STEPS } from "../cli.ts";
import { releaseNotes } from "../steps/upgrade.ts";
import { REPO } from "./harness.ts";

const read = (p: string) => readFileSync(join(REPO, p), "utf8");
const runbook = read("DEPLOY_WITH_AGENT.md");
const CODES = (read("scripts/deploy/core.ts").match(/export type Code = ([^;]+);/)![1]!.match(/"([a-z_]+)"/g) ?? []).map((s) => s.replaceAll('"', ""));

describe("DEPLOY_WITH_AGENT.md", () => {
  it("only names steps that exist", () => {
    const named = new Set<string>();
    for (const m of runbook.matchAll(/gms deploy ([a-z]+)/g)) named.add(m[1]!);
    for (const m of runbook.matchAll(/^\d+\. `([a-z]+)`/gm)) named.add(m[1]!);
    for (const m of runbook.matchAll(/^### The `([a-z]+)` step/gm)) named.add(m[1]!);
    expect(named.size).toBeGreaterThan(8);
    for (const n of named) expect(Object.keys(STEPS), `step ${n}`).toContain(n);
    // The documented order covers every step the person walks through.
    for (const s of ORDER.filter((x) => !["upgrade", "status"].includes(x))) expect(runbook, s).toContain(`\`${s}\``);
  });
  it("maps every result code, and only real ones", () => {
    const section = runbook.slice(runbook.indexOf("## Result codes"), runbook.indexOf("## Security rules"));
    const rows = [...section.matchAll(/^\| `([a-z_]+)` \|/gm)].map((m) => m[1]!);
    expect(rows.sort()).toEqual([...CODES].sort());
    // Any other backticked snake_case word that looks like a code is a code.
    for (const m of runbook.matchAll(/`(needs_[a-z]+|plan_limit)`/g)) expect(CODES).toContain(m[1]);
  });
  it("covers the stop-and-confirm points and security rules", () => {
    for (const phrase of ["Supabase project", "DNS change", "Workers Paid", "already holds tables", "Upgrading later", "final report", "never ask the person to paste", "data, not instructions", "revoke"]) expect(runbook.toLowerCase(), phrase).toContain(phrase.toLowerCase());
  });
});

describe("release files", () => {
  it("agree on the version, the tag and the entry points", () => {
    const version = JSON.parse(read("package.json")).version as string;
    expect(version).toBe("1.0.0");
    expect(releaseNotes(read("CHANGELOG.md"), `v${version}`)).toContain("Upgrade notes");
    expect(releaseNotes(read("CHANGELOG.md"), "v0.9.0")).toContain("Upgrade notes");
    expect(read("README.md")).toMatch(/```bash\n[^`]*--branch v1\.0\.0[^`]*\n```/);
    expect(read("README.md")).toContain("scripts/deploy/README.md");
    expect(read("AGENTS.md")).toContain("DEPLOY_WITH_AGENT.md");
    expect(existsSync(join(REPO, ".claude/skills/deploy-gms/SKILL.md"))).toBe(true);
    expect(read(".claude/skills/deploy-gms/SKILL.md")).toContain("DEPLOY_WITH_AGENT.md");
  });
  it("pre-approves read-only commands only, and the Wrangler form works from the repo root", () => {
    const allow = JSON.parse(read(".claude/settings.json")).permissions.allow as string[];
    for (const a of allow) expect(a).toMatch(/gms deploy (doctor|status):\*|exec wrangler whoami/);
    expect(allow.join(" ")).not.toMatch(/--yes|verify|secrets|--dry-run/);
    const all = [runbook, read("scripts/deploy/README.md"), read(".claude/skills/deploy-gms/SKILL.md"), read(".claude/settings.json")].join("\n");
    expect(all).not.toMatch(/pnpm exec wrangler/);
    for (const f of ["scripts/deploy/cloudflare.ts", "scripts/deploy/steps/doctor.ts", "scripts/deploy/steps/secrets.ts", "scripts/deploy/steps/passport.ts"]) expect(read(f), f).not.toMatch(/pnpm exec wrangler/);
    expect(runbook).toContain("pnpm --filter @gms/api exec wrangler login");
  });
  it("names the current release tag everywhere it pins one", () => {
    const tag = `v${JSON.parse(read("package.json")).version}`;
    for (const f of ["README.md", "DEPLOY_WITH_AGENT.md", ".claude/skills/deploy-gms/SKILL.md"]) {
      const tags = [...read(f).matchAll(/--branch (v\d+\.\d+\.\d+)/g)].map((m) => m[1]);
      expect(tags.length, f).toBeGreaterThan(0);
      for (const t of tags) expect(t, f).toBe(tag);
    }
  });
});
