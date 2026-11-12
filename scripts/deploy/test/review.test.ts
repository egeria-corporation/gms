// SPDX-License-Identifier: AGPL-3.0-only
// Tests for the findings of the independent review (reviews/T1.json), one block per finding.
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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
