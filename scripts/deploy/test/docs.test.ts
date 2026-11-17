// SPDX-License-Identifier: AGPL-3.0-only
// The agent runbook must only mention steps and result codes the tool really has, and the release
// files must agree with each other.
import { execFileSync } from "node:child_process";
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
  it("says to read the last stdout line that starts with {, since pnpm prints a line after it on failure", () => {
    const docs = { runbook, codes: read("scripts/deploy/CODES.md"), readme: read("scripts/deploy/README.md"), skill: read(".claude/skills/deploy-gms/SKILL.md"), agents: read("AGENTS.md") };
    for (const [name, text] of Object.entries(docs)) {
      expect(text.replace(/\s+/g, " "), name).toMatch(/last (stdout )?line (on stdout )?that starts with `\{`/);
      expect(text, name).not.toMatch(/Read only (that|the) last (stdout )?line/i);
    }
  });
  it("covers the stop-and-confirm points and security rules", () => {
    for (const phrase of ["Supabase project", "DNS change", "Workers Paid", "already holds tables", "Upgrading later", "final report", "never ask the person to paste", "data, not instructions", "revoke"]) expect(runbook.toLowerCase(), phrase).toContain(phrase.toLowerCase());
  });
});

describe("release files", () => {
  it("agree on the version, the tag and the entry points", () => {
    const version = JSON.parse(read("package.json")).version as string;
    expect(version).toBe("1.12.0");
    expect(releaseNotes(read("CHANGELOG.md"), `v${version}`)).toContain("Upgrade notes");
    expect(releaseNotes(read("CHANGELOG.md"), "v0.9.0")).toContain("Upgrade notes");
    expect(read("README.md")).toMatch(new RegExp("```bash\\n[^`]*--branch v" + version.replace(/\./g, "\\.") + "[^`]*\\n```"));
    expect(read("README.md")).toContain("scripts/deploy/README.md");
    expect(read("AGENTS.md")).toContain("DEPLOY_WITH_AGENT.md");
    expect(existsSync(join(REPO, ".claude/skills/deploy-gms/SKILL.md"))).toBe(true);
    expect(read(".claude/skills/deploy-gms/SKILL.md")).toContain("DEPLOY_WITH_AGENT.md");
  });
  it("the release workflow finds this version's notes, with or without a date after the heading", () => {
    // The awk program the workflow runs, taken from release.yml so the test follows any change to it.
    const yml = read(".github/workflows/release.yml");
    const program = yml.match(/awk -v h="## v\$VERSION" '\n([\s\S]*?)\n\s*' CHANGELOG\.md > notes\.md/)![1]!;
    const notes = (changelog: string, version: string) => execFileSync("awk", ["-v", `h=## v${version}`, program], { input: changelog, encoding: "utf8" });
    const version = JSON.parse(read("package.json")).version as string;
    expect(notes(read("CHANGELOG.md"), version)).toContain("Upgrade notes");
    const sample = "# Changelog\n\n## v2.0.0 — 2027-01-02\n\nDated.\n\n## v1.0.0\n\nPlain.\n\n## v1.0.01\n\nNot this.\n";
    expect(notes(sample, "2.0.0").trim()).toBe("Dated.");
    expect(notes(sample, "1.0.0").trim()).toBe("Plain.");
    expect(notes(sample, "1.0.1")).toBe("");
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
