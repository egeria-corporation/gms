// SPDX-License-Identifier: AGPL-3.0-only
// upgrade --to vX.Y.Z: from a clean checkout at that tag, show the release notes, then migrate, deploy, verify.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Ctx, Result } from "../core.ts";
import { confirmOrDry, flagStr, loadState, patchState, res } from "../core.ts";
import { deploy } from "./deploy.ts";
import { migrate } from "./migrate.ts";
import { verify } from "./verify.ts";

/** The CHANGELOG.md section for a version ("## v1.2.3", "## [1.2.3]" and so on), or null. */
export function releaseNotes(changelog: string, version: string): string | null {
  const bare = version.replace(/^v/, "");
  const lines = changelog.split("\n");
  const at = lines.findIndex((l) => /^##\s/.test(l) && l.replace(/[[\]]/g, "").split(/\s+/).some((w) => w.replace(/^v/, "") === bare));
  if (at < 0) return null;
  let end = lines.findIndex((l, i) => i > at && /^##\s/.test(l));
  if (end < 0) end = lines.length;
  return lines.slice(at, end).join("\n").trim();
}

export async function upgrade(ctx: Ctx): Promise<Result> {
  const to = flagStr(ctx, "to");
  if (!to || !/^v\d+\.\d+\.\d+$/.test(to)) return res("needs_input", "Pass --to vX.Y.Z, the release to upgrade to (for example --to v1.2.0).", {}, "upgrade");
  const tag = await ctx.run("git", ["describe", "--tags", "--exact-match"], { cwd: ctx.root });
  const dirty = await ctx.run("git", ["status", "--porcelain"], { cwd: ctx.root });
  if (tag.code !== 0 || tag.stdout.trim() !== to || dirty.stdout.trim() !== "") {
    return res("needs_input", `Switch this checkout to the ${to} release first and make sure it has no local changes: git fetch --tags && git checkout ${to}. This tool does not change branches itself.`, { at: tag.code === 0 ? tag.stdout.trim() : null, clean: dirty.stdout.trim() === "" }, "upgrade");
  }
  if (loadState(ctx).version === to && loadState(ctx).deploy?.version === to) return res("skipped", `The instance is already on ${to}.`, { version: to }, "status");

  const changelog = join(ctx.root, "CHANGELOG.md");
  const notes = existsSync(changelog) ? releaseNotes(readFileSync(changelog, "utf8"), to) : null;
  const gate = confirmOrDry(ctx, "upgrade", ["apply any new database migrations, redeploy the Workers and web app, then check the instance"], { to, notes: notes ?? "No upgrade notes were found for this release in CHANGELOG.md." });
  if (gate) return { ...gate, message: `${gate.message}${notes ? ` Upgrade notes for ${to}:\n${notes}` : ` No upgrade notes for ${to} were found in CHANGELOG.md.`}` };

  const sub = { ...ctx, yes: true };
  for (const [name, fn] of [["migrate", migrate], ["deploy", deploy], ["verify", verify]] as const) {
    ctx.log(`Upgrade: ${name}`);
    const r = await fn(sub);
    if (r.code !== "ok" && r.code !== "skipped") return { ...r, message: `Upgrade stopped at ${name}: ${r.message}`, next: "upgrade" };
  }
  patchState(ctx, { version: to, upgradedAt: ctx.now().toISOString() });
  return res("ok", `Upgraded to ${to}.`, { version: to }, "status");
}
