// SPDX-License-Identifier: AGPL-3.0-only
// The apply widget may be framed by any site; nothing else may. Checked on the `_headers` file as
// Cloudflare's static assets apply it (workers-shared asset worker, read in miniflare 5.20261023):
// every rule whose path matches the *request* path applies, in file order; a rule first removes
// its "! Name" headers, then sets its own, appending to a value an earlier rule set.
import { describe, expect, it } from "vitest";
import { contentSecurityPolicy, EMBED_PATHS, embedContentSecurityPolicy, headersFile } from "../build/headers.ts";

const API = "https://gms.example";
const SB = "https://project.supabase.example";
const GOOGLE = { apiKey: "test-picker-key", clientId: "1234-test.apps.googleusercontent.com" };
const USERBACK = "test-userback-token";

interface Rule {
  path: string;
  set: [string, string][];
  unset: string[];
}

function parse(file: string): Rule[] {
  const rules: Rule[] = [];
  for (const line of file.split("\n")) {
    if (!line.trim()) continue;
    if (!/^\s/.test(line)) {
      rules.push({ path: line.trim(), set: [], unset: [] });
      continue;
    }
    const rule = rules.at(-1)!;
    const text = line.trim();
    if (text.startsWith("! ")) rule.unset.push(text.slice(2).toLowerCase());
    else {
      const i = text.indexOf(":");
      rule.set.push([text.slice(0, i).trim().toLowerCase(), text.slice(i + 1).trim()]);
    }
  }
  return rules;
}

const matches = (pattern: string, path: string) => (pattern.endsWith("*") ? path.startsWith(pattern.slice(0, -1)) : pattern === path);

/** The headers a request for `path` gets (an SPA route is served index.html, but rules match the request path). */
function headersFor(file: string, path: string): Headers {
  const out = new Headers();
  const setBefore = new Set<string>();
  for (const rule of parse(file).filter((r) => matches(r.path, path))) {
    for (const name of rule.unset) out.delete(name);
    for (const [name, value] of rule.set) {
      if (setBefore.has(name)) out.append(name, value);
      else {
        out.set(name, value);
        setBefore.add(name);
      }
    }
  }
  return out;
}

const directives = (csp: string) => Object.fromEntries(csp.split("; ").map((d) => [d.split(" ")[0]!, d.split(" ").slice(1)]));

describe("framing the apply widget", () => {
  const configs = [
    ["no extras", headersFile(API, SB), contentSecurityPolicy(API, SB)],
    ["the Picker and Userback", headersFile(API, SB, GOOGLE, USERBACK), contentSecurityPolicy(API, SB, GOOGLE, USERBACK)],
  ] as const;

  it.each(configs)("allows any site to frame /embed/* only (%s)", (_name, file) => {
    for (const path of ["/embed/f/riverbend/o/community-health-grants-2027", "/embed/f/x/o/y"]) {
      const h = headersFor(file, path);
      const csp = h.get("content-security-policy")!;
      // One policy, not the app's joined with the widget's (two policies would both be enforced).
      expect(csp).not.toContain(", ");
      expect(directives(csp)["frame-ancestors"]).toEqual(["*"]);
      expect(h.has("x-frame-options")).toBe(false);
      expect(csp).not.toMatch(/google|userback/);
      // Everything else the app sends still applies.
      expect(h.get("x-content-type-options")).toBe("nosniff");
      expect(h.get("referrer-policy")).toBe("no-referrer");
      expect(h.get("strict-transport-security")).toContain("max-age=");
    }
  });

  it.each(configs)("keeps every other route's policy exactly as it was (%s)", (_name, file, appPolicy) => {
    for (const path of ["/", "/index.html", "/f/riverbend", "/f/riverbend/o/community-health-grants-2027", "/w/riverbend/opportunities", "/signin", "/embed", "/embedded/x", "/preview/embed/f/x/o/y"]) {
      const h = headersFor(file, path);
      expect(h.get("content-security-policy"), path).toBe(appPolicy);
      expect(directives(appPolicy)["frame-ancestors"]).toEqual(["'none'"]);
      expect(h.get("x-frame-options"), path).toBe("DENY");
    }
  });

  it("the widget's policy is the app's own, framable, with nothing the widget does not load", () => {
    const app = directives(contentSecurityPolicy(API, SB));
    const embed = directives(embedContentSecurityPolicy(API, SB));
    expect({ ...embed, "frame-ancestors": app["frame-ancestors"] }).toEqual(app);
    expect(embed["frame-ancestors"]).toEqual(["*"]);
    expect(embed["frame-src"]).toEqual(["'none'"]);
    expect(EMBED_PATHS).toBe("/embed/*");
    // The embed rule comes after "/*", or Cloudflare would let "/*" set the headers last.
    const paths = parse(headersFile(API, SB)).map((r) => r.path);
    expect(paths.indexOf(EMBED_PATHS)).toBeGreaterThan(paths.indexOf("/*"));
  });
});
