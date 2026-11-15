// @vitest-environment node
// SPDX-License-Identifier: AGPL-3.0-only
// The front Worker as it is deployed: built by scripts/build-front-worker.mjs, bundled, and run in
// workerd (Miniflare) with the real API Worker in-process behind its service binding. Checks the
// per-page meta and JSON-LD set with HTMLRewriter, closed and forecasted calls, robots.txt, share
// images, the edge cache, failing open to the default meta, and the `_headers` rules.
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { contentSecurityPolicy, embedContentSecurityPolicy, headersFile } from "../build/headers.ts";
import { DATA_TIMEOUT_MS } from "../src/edge/front.ts";
import { DEFAULT_DESCRIPTION } from "../src/edge/meta.ts";
import { decodePng, pngSize } from "../src/edge/og/png.ts";
import { loadApi, type ApiHarness } from "./api-harness.ts";

const web = fileURLToPath(new URL("..", import.meta.url));
const fromWrangler = createRequire(realpathSync(join(web, "node_modules", "wrangler", "package.json")));
const HOST = "gms.test";
const API_ORIGIN = `https://${HOST}`;
const SUPABASE = "https://supabase.test";

interface Mf {
  dispatchFetch(url: string, init?: RequestInit): Promise<Response>;
  dispose(): Promise<void>;
}
let mf: Mf;
let work: string;
let h: ApiHarness;
const apiCalls: string[] = [];
let releaseSlow: () => void = () => undefined;
const slow = new Promise<void>((resolve) => (releaseSlow = resolve));

const json = (who: Record<string, string>, body: unknown, method = "POST"): RequestInit => ({ method, headers: { ...who, "Content-Type": "application/json" }, body: JSON.stringify(body) });
const data = async <T>(res: Response) => ((await res.json()) as { data: T }).data;

/** Open, forecasted and closed calls on the harness's funder (Riverbend Community Foundation, `riverbend`). */
async function publishCalls(api: ApiHarness, userId: string, workspaceId: string) {
  const who = { Authorization: `Bearer ${await api.session(userId)}`, "X-GMS-Workspace": workspaceId };
  const OPP = {
    description: "Grants for community health navigation in Riverbend County.",
    funding: { minAwardAmount: { amount: "50000.00", currency: "USD" }, maxAwardAmount: { amount: "150000.00", currency: "USD" } },
    keyDates: { closeDate: { name: "Deadline", eventType: "singleDate", date: "2099-09-30" }, postDate: { name: "Opens", eventType: "singleDate", date: "2099-01-05" } },
    acceptedApplicantTypes: ["non_profit_with_501c3"],
  };
  const make = async (title: string) => data<{ id: string }>(await api.request("/gms/opportunities", json(who, { ...OPP, title })));
  const open = await make("Open Call");
  const form = await data<{ id: string }>(await api.request("/gms/forms", json(who, { title: "Application", purpose: "application", jsonSchema: { type: "object", properties: { a: { type: "string" } } }, uiSchema: { type: "VerticalLayout", elements: [{ type: "Control", scope: "#/properties/a" }] } })));
  await api.request(`/gms/forms/${form.id}/publish`, { method: "POST", headers: who });
  const rubric = await data<{ id: string }>(await api.request("/gms/rubrics", json(who, { name: "Screen", criteria: [{ key: "fit", label: "Fit", weight: 1, scale: { type: "numeric", min: 1, max: 5 } }] })));
  const comp = await data<{ id: string }>(await api.request("/gms/competitions", json(who, { opportunityId: open.id, title: "Round 1" })));
  await api.request(`/gms/competitions/${comp.id}/stages`, json(who, { stages: [{ key: "full", label: "Full application", forms: { [form.id]: 1 }, opens: "2027-01-01T00:00:00Z", closes: "2099-09-30T00:00:00Z", rubricId: rubric.id }] }, "PUT"));
  await api.request(`/gms/opportunities/${open.id}/publish`, json(who, { status: "open" }));
  const opened = await api.request(`/gms/competitions/${comp.id}/open`, { method: "POST", headers: who });
  if (opened.status !== 200) throw new Error(`could not open the competition: ${await opened.text()}`);
  const forecast = await make("Forecast Call");
  await api.request(`/gms/opportunities/${forecast.id}/publish`, json(who, { status: "forecasted" }));
  const closed = await make("Closed Call");
  await api.request(`/gms/opportunities/${closed.id}/publish`, json(who, { status: "open" }));
  await api.request(`/gms/opportunities/${closed.id}/close`, { method: "POST", headers: who });
}

/** The fake API behind the service binding: the real API in-process, plus a slow and a failing funder. */
async function api(req: Request): Promise<Response> {
  const u = new URL(req.url);
  apiCalls.push(u.pathname);
  if (u.pathname.startsWith("/gms/public/funders/slow")) {
    await slow;
    return new Response("{}", { status: 503 });
  }
  if (u.pathname.startsWith("/gms/public/funders/broken")) return new Response('{"status":500}', { status: 500, headers: { "Content-Type": "application/json" } });
  const res = await h.request(`${u.pathname}${u.search}`, { method: req.method, headers: req.headers });
  return new Response(await res.arrayBuffer(), { status: res.status, headers: { "Content-Type": res.headers.get("Content-Type") ?? "application/json" } });
}

beforeAll(async () => {
  const helpers = await loadApi();
  h = await helpers.harness();
  await publishCalls(h, helpers.USER_ADMIN, helpers.WS_FUNDER);
  // The template gallery: one approved item, and one withdrawn (no longer public).
  const item = (slug: string, title: string, status: string) => h.repos.table("gallery_items").insert({ slug, kind: "rubric", title, summary: "Five criteria, each scored 1 to 5, with guidance for reviewers.", tags: {}, author_workspace_id: null, licence: "CC-BY-4.0", status, version: 1, snapshot: { forms: [], rubrics: [], emails: [] }, uses_count: 0, published_at: "2026-11-15T00:00:00Z", withdrawn_at: status === "withdrawn" ? "2026-11-16T00:00:00Z" : null });
  await item("five-criterion-rubric", "Five-criterion rubric <b>", "approved");
  await item("old-rubric", "Old rubric", "withdrawn");

  // A built app: index.html, the card's fonts and images, one asset, and the _headers file the build writes.
  work = mkdtempSync(join(tmpdir(), "front-worker-"));
  const dist = join(work, "dist");
  for (const f of ["fonts/Ubuntu-Bold.ttf", "fonts/Lato-Regular.ttf", "fonts/Lato-Bold.ttf", "brand/opengrants-icon-color.png", "brand/og-preview.png"]) {
    mkdirSync(dirname(join(dist, f)), { recursive: true });
    cpSync(join(web, "public", f), join(dist, f));
  }
  cpSync(join(web, "index.html"), join(dist, "index.html"));
  mkdirSync(join(dist, "assets"));
  writeFileSync(join(dist, "assets", "app-1234.js"), "console.log(1)");
  writeFileSync(join(dist, "_headers"), headersFile(API_ORIGIN, SUPABASE));

  const out = join(work, "out");
  execFileSync(process.execPath, [join(web, "..", "..", "scripts", "build-front-worker.mjs"), "--name", "front-test", "--host", HOST, "--api", "api-test", "--redirect-from", "old.gms.test", "--dist", dist, "--out", out], { stdio: "pipe" });
  const esbuild = (await import(fromWrangler.resolve("esbuild"))) as { build(o: Record<string, unknown>): Promise<{ outputFiles: { text: string }[] }> };
  const bundle = await esbuild.build({ entryPoints: [join(out, "index.js")], bundle: true, format: "esm", platform: "neutral", target: "es2022", write: false, logLevel: "silent" });

  const { Miniflare, convertV4MiniflareOptions } = (await import(fromWrangler.resolve("miniflare"))) as { Miniflare: new (o: unknown) => Mf; convertV4MiniflareOptions: (o: unknown) => unknown };
  mf = new Miniflare(convertV4MiniflareOptions({ workers: [{ name: "front", modules: true, script: bundle.outputFiles[0]!.text, compatibilityDate: "2026-10-01", serviceBindings: { API: api } }] }));
}, 60_000);

// Shutting the runtime down costs about what starting it does, so it gets the same allowance; the
// default 10 s ran out on a loaded CI runner.
afterAll(async () => {
  releaseSlow();
  await mf?.dispose();
  if (work) rmSync(work, { recursive: true, force: true });
}, 60_000);

const get = (path: string, init?: RequestInit) => mf.dispatchFetch(`https://${HOST}${path}`, { redirect: "manual", ...init });
const count = (html: string, needle: string) => html.split(needle).length - 1;
const ldOf = (html: string) => JSON.parse(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)![1]!) as unknown;
const contentOf = (html: string, attr: string) => new RegExp(`<meta ${attr} content="([^"]*)"`).exec(html)?.[1];

describe("front Worker: public pages", () => {
  it("gives an opportunity page its own title, description, canonical, share image and JSON-LD", async () => {
    const res = await get("/f/riverbend/o/open-call");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/html");
    expect(res.headers.get("Cache-Control")).toBe("no-cache");
    expect(res.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
    const html = await res.text();
    expect(html).toContain("<title>Open Call | Riverbend Community Foundation</title>");
    expect(contentOf(html, 'name="description"')).toBe("Open for applications until Sep 30, 2099. Awards of $50,000 \u2013 $150,000. Grants for community health navigation in Riverbend County.");
    expect(html).toContain('<link rel="canonical" href="https://gms.test/f/riverbend/o/open-call" />');
    expect(contentOf(html, 'property="og:url"')).toBe("https://gms.test/f/riverbend/o/open-call");
    expect(contentOf(html, 'property="og:image"')).toMatch(/^https:\/\/gms\.test\/og\/f\/riverbend\/o\/open-call\.png\?v=[0-9a-z]+$/);
    expect(contentOf(html, 'name="twitter:card"')).toBe("summary_large_image");
    // The defaults are replaced, not repeated; the app itself is untouched.
    for (const tag of ['name="description"', 'property="og:title"', 'property="og:description"', 'property="og:image"', 'name="twitter:title"', 'rel="canonical"']) expect(count(html, tag), tag).toBe(1);
    expect(html).not.toContain(DEFAULT_DESCRIPTION);
    expect(html).toContain('<div id="root"></div>');
    const [grant, crumbs] = ldOf(html) as Record<string, unknown>[];
    expect(grant).toMatchObject({ "@type": "MonetaryGrant", name: "Open Call", url: "https://gms.test/f/riverbend/o/open-call", funder: { "@type": "Organization", name: "Riverbend Community Foundation" }, amount: { "@type": "MonetaryAmount", currency: "USD", minValue: 50000, maxValue: 150000 } });
    expect(crumbs).toMatchObject({ "@type": "BreadcrumbList" });
  });

  it("still renders closed and forecasted calls, with their status in the description", async () => {
    expect(contentOf(await (await get("/f/riverbend/o/closed-call")).text(), 'name="description"')).toMatch(/^Closed to applications\. /);
    expect(contentOf(await (await get("/f/riverbend/o/forecast-call")).text(), 'name="description"')).toMatch(/^Forecasted to open Jan 5, 2099\. /);
  });

  it("describes a funder page as an Organization with its calls", async () => {
    const html = await (await get("/f/riverbend")).text();
    expect(html).toContain("<title>Grants from Riverbend Community Foundation</title>");
    expect(contentOf(html, 'name="description"')).toMatch(/^1 call open for applications, 1 forecasted, 1 closed\./);
    expect(ldOf(html)).toMatchObject({ "@type": "Organization", name: "Riverbend Community Foundation", mainEntityOfPage: "https://gms.test/f/riverbend" });
    expect(contentOf(html, 'property="og:image"')).toMatch(/^https:\/\/gms\.test\/og\/f\/riverbend\.png\?v=/);
  });

  it("gives the landing page its canonical address and its own card", async () => {
    const html = await (await get("/")).text();
    expect(html).toContain('<link rel="canonical" href="https://gms.test/" />');
    expect(contentOf(html, 'name="description"')).toBe(DEFAULT_DESCRIPTION);
    expect(contentOf(html, 'property="og:image"')).toMatch(/^https:\/\/gms\.test\/og\/home\.png\?v=/);
    expect(ldOf(html)).toMatchObject({ "@type": "WebSite", url: "https://gms.test/" });
  });

  it("keeps page data at the edge: a second view does not ask the API again", async () => {
    await get("/f/riverbend/o/closed-call");
    const before = apiCalls.filter((p) => p.endsWith("/opportunities/closed-call")).length;
    await get("/f/riverbend/o/closed-call");
    expect(apiCalls.filter((p) => p.endsWith("/opportunities/closed-call")).length).toBe(before);
    expect(before).toBeGreaterThanOrEqual(1);
  });

  it("falls back to the default meta when the page is not found, the API fails or is slow", async () => {
    for (const path of ["/f/nobody", "/f/riverbend/o/no-such-call", "/f/broken", "/f/slow"]) {
      const started = Date.now();
      const res = await get(path);
      expect(res.status, path).toBe(200);
      const html = await res.text();
      expect(contentOf(html, 'name="description"'), path).toBe(DEFAULT_DESCRIPTION);
      expect(html, path).not.toContain('rel="canonical"');
      expect(html, path).toContain('<div id="root"></div>');
      if (path === "/f/slow") expect(Date.now() - started).toBeLessThan(DATA_TIMEOUT_MS + 3000);
    }
    // The front Worker has given up on the slow funder; let its request finish now rather than
    // leave it open until the runtime shuts down.
    releaseSlow();
    // Other app screens are served as built, without asking the API.
    const calls = apiCalls.length;
    expect(contentOf(await (await get("/w/abc/home")).text(), 'name="description"')).toBe(DEFAULT_DESCRIPTION);
    expect(apiCalls.length).toBe(calls);
  }, 20_000);

  it("gives the switch pages their own title, description and Open Graph text, and an unknown system the defaults", async () => {
    const hub = await (await get("/switch")).text();
    expect(hub).toContain("<title>Switch to OpenGrants GMS: what moves over, and a free migration</title>");
    expect(contentOf(hub, 'name="description"')).toMatch(/^What moves over to the free, open-source OpenGrants Grant Management System from Good Grants, .* Facts as of November 2026\.$/);
    expect(contentOf(hub, 'property="og:title"')).toBe("Switching to the OpenGrants Grant Management System");
    expect(contentOf(hub, 'name="twitter:title"')).toBe("Switching to the OpenGrants Grant Management System");
    expect(hub).toContain('<link rel="canonical" href="https://gms.test/switch" />');
    const one = await (await get("/switch/submittable")).text();
    expect(one).toContain("<title>Moving from Submittable to OpenGrants GMS</title>");
    expect(contentOf(one, 'property="og:title"')).toBe("Moving from Submittable to the OpenGrants Grant Management System");
    expect(contentOf(one, 'property="og:url"')).toBe("https://gms.test/switch/submittable");
    expect(ldOf(one)).toMatchObject({ "@type": "WebPage", url: "https://gms.test/switch/submittable" });
    for (const tag of ['name="description"', 'property="og:title"', 'rel="canonical"']) expect(count(one, tag), tag).toBe(1);
    expect(contentOf(await (await get("/switch/no-such-system")).text(), 'name="description"')).toBe(DEFAULT_DESCRIPTION);
  });

  it("gives the template gallery and an approved item their own meta, and a withdrawn or unknown item the defaults", async () => {
    const gallery = await (await get("/templates")).text();
    expect(gallery).toContain("<title>Template gallery \u2014 OpenGrants GMS</title>");
    expect(contentOf(gallery, 'name="description"')).toBe("Free, ready-to-use grant application forms, rubrics, report forms and email templates. Copy one into your workspace and start in minutes.");
    const item = await (await get("/templates/five-criterion-rubric")).text();
    // The item's own words, escaped: a title cannot add markup to the page.
    expect(item).toContain("<title>Five-criterion rubric &lt;b&gt; \u2014 Template gallery \u2014 OpenGrants GMS</title>");
    expect(contentOf(item, 'name="description"')).toBe("Five criteria, each scored 1 to 5, with guidance for reviewers.");
    expect(contentOf(item, 'property="og:type"')).toBe("website");
    expect(contentOf(item, 'property="og:url"')).toBe("https://gms.test/templates/five-criterion-rubric");
    expect(ldOf(item)).toMatchObject({ "@type": "CreativeWork", license: "https://creativecommons.org/licenses/by/4.0/" });
    for (const path of ["/templates/old-rubric", "/templates/no-such-item"]) expect(contentOf(await (await get(path)).text(), 'name="description"'), path).toBe(DEFAULT_DESCRIPTION);
  });

  it("answers HEAD for a page without a body", async () => {
    const res = await get("/f/riverbend", { method: "HEAD" });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("");
  });
});

describe("front Worker: share images", () => {
  it("draws a 1200x627 PNG under 600 KB for an opportunity, a funder and the landing page", async () => {
    for (const path of ["/og/f/riverbend/o/open-call.png?v=1", "/og/f/riverbend/o/closed-call.png", "/og/f/riverbend.png", "/og/home.png"]) {
      const res = await get(path);
      expect(res.status, path).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("image/png");
      expect(res.headers.get("Cache-Control")).toBe("public, max-age=300");
      const png = new Uint8Array(await res.arrayBuffer());
      expect(pngSize(png), path).toEqual({ width: 1200, height: 627 });
      expect(png.length).toBeLessThan(600 * 1024);
      expect((await decodePng(png)).width).toBe(1200);
    }
  }, 30_000);

  it("answers 404 for a page that does not exist and the default card when the API fails", async () => {
    expect((await get("/og/f/nobody.png")).status).toBe(404);
    const failed = await get("/og/f/broken.png");
    expect(failed.status).toBe(302);
    expect(failed.headers.get("Location")).toBe("https://gms.test/brand/og-preview.png");
  });
});

describe("front Worker: robots, sitemap, headers and forwarding", () => {
  it("serves robots.txt and forwards the sitemap, which lists forecasted and closed calls", async () => {
    const robots = await get("/robots.txt");
    expect(robots.status).toBe(200);
    expect(robots.headers.get("Content-Type")).toContain("text/plain");
    const text = await robots.text();
    for (const line of ["Disallow: /w/", "Disallow: /gms/", "Disallow: /signin", "Disallow: /onboarding", "Disallow: /gallery/", "Allow: /gms/public/", "Sitemap: https://gms.test/sitemap.xml"]) expect(text).toContain(line);
    expect(text).not.toMatch(/Disallow: \/(switch|templates)/);
    const xml = await (await get("/sitemap.xml")).text();
    for (const slug of ["open-call", "forecast-call", "closed-call"]) expect(xml).toContain(`/f/riverbend/o/${slug}</loc>`);
    for (const path of ["/switch", "/switch/submittable", "/switch/spreadsheets", "/templates", "/templates/five-criterion-rubric"]) expect(xml).toContain(`${path}</loc>`);
    expect(xml).not.toContain("old-rubric");
  });

  it("applies _headers rules to the requested path as Cloudflare does, removing with `!`", async () => {
    expect((await get("/assets/app-1234.js")).headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
    expect((await get("/assets/missing.js")).status).toBe(404);
  });

  it("lets any site frame the apply widget, and only the apply widget", async () => {
    for (const method of ["GET", "HEAD"]) {
      for (const path of ["/embed/f/riverbend/o/open-call", "/embed/f/riverbend/o/closed-call", "/embed/f/nobody/o/nothing"]) {
        const res = await get(path, { method });
        expect(res.status, path).toBe(200);
        const csp = res.headers.get("Content-Security-Policy");
        // One policy, the widget's: not the app's joined to it with a comma (both would be enforced).
        expect(csp, path).toBe(embedContentSecurityPolicy(API_ORIGIN, SUPABASE));
        expect(csp, path).toContain("frame-ancestors *");
        expect(csp, path).not.toContain("frame-ancestors 'none'");
        expect(res.headers.get("X-Frame-Options"), path).toBeNull();
        // The rest of the app's headers still apply.
        expect(res.headers.get("X-Content-Type-Options"), path).toBe("nosniff");
        expect(res.headers.get("Referrer-Policy"), path).toBe("no-referrer");
      }
    }
    const app = contentSecurityPolicy(API_ORIGIN, SUPABASE);
    expect(app).toContain("frame-ancestors 'none'");
    for (const path of ["/", "/f/riverbend", "/f/riverbend/o/open-call", "/w/abc/home", "/signin", "/embed", "/embedded/f/riverbend/o/open-call", "/preview/embed/f/riverbend/o/open-call", "/f/riverbend/embed/x", "/robots.txt", "/og/home.png", "/og/f/riverbend/o/open-call.png", "/assets/app-1234.js", "/brand/og-preview.png", "/index.html"]) {
      const res = await get(path);
      expect(res.status, path).toBe(200);
      expect(res.headers.get("Content-Security-Policy"), path).toBe(app);
      expect(res.headers.get("X-Frame-Options"), path).toBe("DENY");
    }
  }, 30_000);

  it("forwards the API's paths and redirects the old address", async () => {
    const res = await get("/gms/public/funders/riverbend");
    expect(res.status).toBe(200);
    expect(((await res.json()) as { data: { opportunities: { title: string; acceptingApplications: boolean }[] } }).data.opportunities.find((o) => o.title === "Open Call")?.acceptingApplications).toBe(true);
    const old = await mf.dispatchFetch("https://old.gms.test/f/riverbend?x=1", { redirect: "manual" });
    expect(old.status).toBe(308);
    expect(old.headers.get("Location")).toBe("https://gms.test/f/riverbend?x=1");
  });

  it("is built from the handler in the web app, which the deploy reads", () => {
    const index = readFileSync(join(work, "out", "index.js"), "utf8");
    expect(index).toMatch(/import \{ createFront \} from ".*apps\/web\/src\/edge\/front\.ts";/);
    expect(index).toContain('host: "gms.test"');
  });
});
