// @vitest-environment node
// SPDX-License-Identifier: AGPL-3.0-only
// Award sharing through the front Worker as deployed (built by scripts/build-front-worker.mjs, run
// in workerd with the real API in-process behind its service binding): the grants-awarded page and
// an award's page get their own meta, schema.org data and share card; the "Funded by" badge is
// served at /badge/{slug}.svg and kept for an hour; the award kit's portrait card is served at
// /og/f/{handle}/awards/{slug}/portrait.png; a confidential award shows nowhere, with the default
// meta and the same 404 as an award that does not exist.
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { headersFile } from "../build/headers.ts";
import { DEFAULT_TITLE } from "../src/edge/meta.ts";
import { pngSize } from "../src/edge/og/png.ts";
import { loadApi, type ApiHarness } from "./api-harness.ts";

const web = fileURLToPath(new URL("..", import.meta.url));
const fromWrangler = createRequire(realpathSync(join(web, "node_modules", "wrangler", "package.json")));
const HOST = "gms.test";
const WS_APPLICANT = "33333333-3333-4333-8333-333333333333";

interface Mf {
  dispatchFetch(url: string, init?: RequestInit): Promise<Response>;
  dispose(): Promise<void>;
}
let mf: Mf;
let work: string;
let h: ApiHarness;
const apiCalls: string[] = [];
let listed = "";
let secret = "";

async function api(req: Request): Promise<Response> {
  const u = new URL(req.url);
  apiCalls.push(u.pathname);
  const res = await h.request(`${u.pathname}${u.search}`, { method: req.method, headers: req.headers });
  return new Response(await res.arrayBuffer(), { status: res.status, headers: { "Content-Type": res.headers.get("Content-Type") ?? "application/json" } });
}

beforeAll(async () => {
  const helpers = await loadApi();
  h = await helpers.harness();
  const award = async (title: string, confidential: boolean) =>
    (await h.repos.table("awards").insert({ workspace_id: helpers.WS_FUNDER, recipient_workspace_id: WS_APPLICANT, title, status: "active", confidential, funding: { awardedAmount: { amount: "150000.00", currency: "USD" } }, key_dates: { awardDate: { date: "2027-03-01" } } })).public_slug as string;
  listed = `alder-creek-family-services-${await award("Mobile Health Navigation", false)}`;
  secret = `alder-creek-family-services-${await award("Confidential Shelter Project", true)}`;
  const who = { Authorization: `Bearer ${await h.session(helpers.USER_ADMIN)}`, "X-GMS-Workspace": helpers.WS_FUNDER, "Content-Type": "application/json" };
  const on = await h.request("/gms/award-sharing/settings", { method: "PUT", headers: who, body: JSON.stringify({ listAwards: true }) });
  if (on.status !== 200) throw new Error(`could not list awards: ${await on.text()}`);

  work = mkdtempSync(join(tmpdir(), "award-front-"));
  const dist = join(work, "dist");
  for (const f of ["fonts/Ubuntu-Bold.ttf", "fonts/Lato-Regular.ttf", "fonts/Lato-Bold.ttf", "brand/opengrants-icon-color.png", "brand/og-preview.png"]) {
    mkdirSync(dirname(join(dist, f)), { recursive: true });
    cpSync(join(web, "public", f), join(dist, f));
  }
  cpSync(join(web, "index.html"), join(dist, "index.html"));
  writeFileSync(join(dist, "_headers"), headersFile(`https://${HOST}`, "https://supabase.test"));
  const out = join(work, "out");
  execFileSync(process.execPath, [join(web, "..", "..", "scripts", "build-front-worker.mjs"), "--name", "front-test", "--host", HOST, "--api", "api-test", "--dist", dist, "--out", out], { stdio: "pipe" });
  const esbuild = (await import(fromWrangler.resolve("esbuild"))) as { build(o: Record<string, unknown>): Promise<{ outputFiles: { text: string }[] }> };
  const bundle = await esbuild.build({ entryPoints: [join(out, "index.js")], bundle: true, format: "esm", platform: "neutral", target: "es2022", write: false, logLevel: "silent" });
  const { Miniflare, convertV4MiniflareOptions } = (await import(fromWrangler.resolve("miniflare"))) as { Miniflare: new (o: unknown) => Mf; convertV4MiniflareOptions: (o: unknown) => unknown };
  mf = new Miniflare(convertV4MiniflareOptions({ workers: [{ name: "front", modules: true, script: bundle.outputFiles[0]!.text, compatibilityDate: "2026-10-01", serviceBindings: { API: api } }] }));
}, 60_000);

afterAll(async () => {
  await mf?.dispose();
  if (work) rmSync(work, { recursive: true, force: true });
});

const get = (path: string, init?: RequestInit) => mf.dispatchFetch(`https://${HOST}${path}`, { redirect: "manual", ...init });
const titleOf = (html: string) => /<title>([^<]*)<\/title>/.exec(html)?.[1];
const ldOf = (html: string) => JSON.parse(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)![1]!) as Record<string, unknown>[];
const contentOf = (html: string, attr: string) => new RegExp(`<meta ${attr} content="([^"]*)"`).exec(html)?.[1];

describe("front Worker: award pages", () => {
  it("gives the grants-awarded page its own title, list and card", async () => {
    const html = await (await get("/f/riverbend/awards")).text();
    expect(titleOf(html)).toBe("Grants awarded by Riverbend Community Foundation");
    expect(html).toContain(`<link rel="canonical" href="https://${HOST}/f/riverbend/awards" />`);
    const [list] = ldOf(html);
    expect(list).toMatchObject({ "@type": "ItemList", numberOfItems: 1, itemListElement: [{ "@type": "ListItem", position: 1, name: "Riverbend Community Foundation awarded Alder Creek Family Services a grant", url: `https://${HOST}/f/riverbend/awards/${listed}` }] });
    expect(contentOf(html, 'property="og:image"')).toMatch(new RegExp(`^https://${HOST}/og/f/riverbend/awards\\.png\\?v=`));
    expect(html).not.toContain("Confidential Shelter Project");
  });

  it("gives an award its page meta, MonetaryGrant data and a share card without logos", async () => {
    const html = await (await get(`/f/riverbend/awards/${listed}`)).text();
    expect(titleOf(html)).toBe("Riverbend Community Foundation awarded Alder Creek Family Services a grant");
    expect(contentOf(html, 'name="description"')).toBe("A $150,000 grant awarded in 2027, for “Mobile Health Navigation”.");
    const [grant] = ldOf(html);
    expect(grant).toMatchObject({ "@type": "MonetaryGrant", funder: { "@type": "Organization", name: "Riverbend Community Foundation" }, fundedItem: { "@type": "Organization", name: "Alder Creek Family Services" }, amount: { "@type": "MonetaryAmount", currency: "USD", value: 150000 } });
    const image = contentOf(html, 'property="og:image"')!;
    const png = await get(new URL(image).pathname + new URL(image).search);
    expect(png.status).toBe(200);
    expect(png.headers.get("Content-Type")).toBe("image/png");
    expect(pngSize(new Uint8Array(await png.arrayBuffer()))).toEqual({ width: 1200, height: 627 });
  });

  it("keeps a confidential award off every page and card", async () => {
    const page = await (await get(`/f/riverbend/awards/${secret}`)).text();
    expect(titleOf(page)).toBe(DEFAULT_TITLE);
    expect(page).not.toContain("Confidential Shelter Project");
    expect((await get(`/og/f/riverbend/awards/${secret}.png`)).status).toBe(404);
  });

  it("serves the award kit's portrait card at a public address, for posts that take a portrait image", async () => {
    const png = await get(`/og/f/riverbend/awards/${listed}/portrait.png`);
    expect(png.status).toBe(200);
    expect(png.headers.get("Content-Type")).toBe("image/png");
    expect(pngSize(new Uint8Array(await png.arrayBuffer()))).toEqual({ width: 1080, height: 1350 });
    // The amount only when asked for: a different image, drawn on request.
    const withAmount = await get(`/og/f/riverbend/awards/${listed}/portrait.png?amount=1`);
    expect(withAmount.status).toBe(200);
    expect(pngSize(new Uint8Array(await withAmount.arrayBuffer()))).toEqual({ width: 1080, height: 1350 });
    const spanish = await get(`/og/f/riverbend/awards/${listed}/portrait.png?lang=es`);
    expect(spanish.status).toBe(200);
    expect(pngSize(new Uint8Array(await spanish.arrayBuffer()))).toEqual({ width: 1080, height: 1350 });
    const head = await get(`/og/f/riverbend/awards/${listed}/portrait.png`, { method: "HEAD" });
    expect(head.status).toBe(200);
    await head.arrayBuffer();
  });

  it("answers 404 for a confidential award's portrait card, as for one that does not exist", async () => {
    const hidden = await get(`/og/f/riverbend/awards/${secret}/portrait.png`);
    const missing = await get("/og/f/riverbend/awards/nothing-000000000000/portrait.png");
    expect(hidden.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(await hidden.text()).toBe(await missing.text());
    // Another funder's handle does not reach the award either, nor an address that is not a slug.
    for (const path of [`/og/f/someone-else/awards/${listed}/portrait.png`, "/og/f/riverbend/awards/Not_A_Slug/portrait.png"]) {
      const res = await get(path);
      expect(res.status, path).toBe(404);
      await res.arrayBuffer();
    }
  });
});

describe("front Worker: the badge", () => {
  it("serves the SVG for an hour, verified for a Passport-linked funder, and keeps it at the edge", async () => {
    const res = await get(`/badge/${listed}.svg`);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/svg+xml; charset=utf-8");
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=3600");
    expect(res.headers.get("Content-Security-Policy")).toBe("default-src 'none'; style-src 'unsafe-inline'");
    expect(await res.text()).toContain("Riverbend Community Foundation · verified");
    const before = apiCalls.filter((p) => p.startsWith("/gms/public/badges/")).length;
    expect((await get(`/badge/${listed}.svg`)).status).toBe(200);
    expect(apiCalls.filter((p) => p.startsWith("/gms/public/badges/")).length).toBe(before);
    expect((await get(`/badge/${listed}.svg`, { method: "HEAD" })).status).toBe(200);
  });

  it("answers the same plain 404 for a confidential award and one that does not exist", async () => {
    const hidden = await get(`/badge/${secret}.svg`);
    const missing = await get("/badge/nothing-000000000000.svg");
    expect(hidden.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(await hidden.text()).toBe(await missing.text());
    expect(hidden.headers.get("Content-Type")).toBe(missing.headers.get("Content-Type"));
    expect((await get("/badge/Not_A_Slug.svg")).status).toBe(404);
  });
});
