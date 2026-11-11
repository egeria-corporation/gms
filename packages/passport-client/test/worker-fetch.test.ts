// SPDX-License-Identifier: AGPL-3.0-only
// Cloudflare Workers refuses to run the platform's `fetch` as a method of another object
// ("Illegal invocation: function called with incorrect `this` reference"). Node allows it, so a
// client that stores `fetch` and calls `this.doFetch(...)` passes every Node test and fails on the
// first request once deployed. That is what stopped Sign in with Passport on 2026-11-11: the
// organization read never left the Worker. These tests give `fetch` the Workers behaviour.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PassportClient, staticToken } from "../src/index.ts";

/** A `fetch` that, like the Workers runtime, throws unless called as a plain function. */
function strictFetch(respond: () => Response) {
  return function (this: unknown) {
    if (this !== undefined && this !== globalThis) throw new TypeError("Illegal invocation: function called with incorrect `this` reference.");
    return Promise.resolve(respond());
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("the platform fetch is never called as a method", () => {
  it("PassportClient reaches Passport with the default fetch", async () => {
    vi.stubGlobal("fetch", strictFetch(() => Response.json({ status: 200, message: "ok", data: { id: "018f2e77-0000-7000-8000-0000000000a1", name: "Alder Creek" } })));
    const c = new PassportClient({ baseUrl: "https://passport.test", tokens: staticToken("at") });
    await expect(c.getOrg("018f2e77-0000-7000-8000-0000000000a1")).resolves.toMatchObject({ name: "Alder Creek" });
  });

  it("no source file stores the bare fetch on an object", () => {
    // `this.x = … ?? fetch` and `private readonly x: … = fetch` are the two shapes that break.
    const root = join(import.meta.dirname, "../../..");
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        if (name === "node_modules" || name === "dist" || name.startsWith(".")) continue;
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) {
          readFileSync(full, "utf8")
            .split("\n")
            .forEach((line, i) => {
              if (/^\s*(\/\/|\*)/.test(line)) return;
              if (/this\.\w+\s*=\s*[^;]*\?\?\s*\(?\s*fetch\b(?!\()/.test(line) || /(private|public|protected|readonly)[^=]*=\s*fetch\s*[,;)]/.test(line)) offenders.push(`${full.slice(root.length + 1)}:${i + 1}`);
            });
        }
      }
    };
    for (const top of ["packages", "apps/api/src", "apps/jobs/src"]) walk(join(root, top));
    expect(offenders).toEqual([]);
  });
});
