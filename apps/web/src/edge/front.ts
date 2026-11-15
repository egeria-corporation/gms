// SPDX-License-Identifier: AGPL-3.0-only
// The front Worker that scripts/build-front-worker.mjs builds (docs/staging.md): it serves the web
// app from files embedded in its script, forwards the API's paths to the API Worker, and gives the
// public pages what links and search engines read: per-page meta and JSON-LD (set with
// HTMLRewriter), share images and robots.txt.
//
// Page data comes from the API's public routes over the service binding and is kept at the edge for
// EDGE_TTL_SECONDS. Anything that fails, is slow or is not found leaves the page as it was built,
// with the default meta: a preview is never worth a broken page.
import { apiPathOf, funderCard, funderMeta, headTags, imageRouteOf, landingCard, landingMeta, opportunityCard, opportunityMeta, robotsTxt, routeOf, DEFAULT_IMAGE, type FunderPageData, type OpportunityPageData, type PageMeta, type PageRoute, type PublicRoute } from "./meta.ts";
import { loadCardAssets, renderCard, type CardAssets, type CardText } from "./og/card.ts";

export interface EmbeddedFile {
  type: string;
  /** base64 */
  body: string;
}
/** A `_headers` rule: a path pattern and its headers; a name that starts with "!" removes that header. */
export interface HeaderRule {
  pattern: string;
  headers: Record<string, string>;
}
export interface FrontConfig {
  files: Record<string, EmbeddedFile>;
  headerRules: HeaderRule[];
  /** The address the site is served at; canonical addresses and the share card use it. */
  host: string;
  /** An old address that redirects permanently to `host`. */
  redirectFrom: string | null;
  apiPrefixes: string[];
  apiExact: string[];
}
export interface FrontEnv {
  API: { fetch(request: Request): Promise<Response> };
}
export interface FrontContext {
  waitUntil(promise: Promise<unknown>): void;
}

/** How long page data and share images are kept at the edge (and by browsers, for images). */
export const EDGE_TTL_SECONDS = 300;
/** How long a page waits for its data before it is served with the default meta. */
export const DATA_TIMEOUT_MS = 2000;

// The parts of the Workers runtime this uses, typed here so the web app's type-check needs no Workers types.
interface RewriterElement {
  setInnerContent(content: string): void;
  remove(): void;
  append(content: string, options: { html: boolean }): void;
}
interface Rewriter {
  on(selector: string, handlers: { element(e: RewriterElement): void }): Rewriter;
  transform(response: Response): Response;
}
const runtime = globalThis as unknown as { HTMLRewriter?: new () => Rewriter; caches?: { default?: Cache } };
const edgeCache = (): Cache | null => {
  try {
    return runtime.caches?.default ?? null;
  } catch {
    return null;
  }
};

/** Cloudflare's `_headers` matching: `*` matches anything, `:name` one path segment. */
function matches(pattern: string, path: string): boolean {
  const re = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/:[A-Za-z]\w*/g, "[^/]+");
  return new RegExp(`^${re}$`).test(path);
}

/**
 * Applies the rules that match the request's path, in order, as Cloudflare does for static assets:
 * a header set by two rules gets both values joined by a comma; `! Name` removes one an earlier rule set.
 */
export function applyHeaderRules(headers: Headers, rules: HeaderRule[], path: string) {
  const fromRules = new Set<string>();
  for (const rule of rules) {
    if (!matches(rule.pattern, path)) continue;
    for (const [name, value] of Object.entries(rule.headers)) {
      if (name.startsWith("!")) {
        const n = name.slice(1).trim().toLowerCase();
        headers.delete(n);
        fromRules.delete(n);
        continue;
      }
      const n = name.toLowerCase();
      headers.set(name, fromRules.has(n) ? `${headers.get(n)}, ${value}` : value);
      fromRules.add(n);
    }
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([promise, new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error("timed out")), ms)))]).finally(() => clearTimeout(timer));
}

export function createFront(config: FrontConfig) {
  const origin = `https://${config.host}`;
  const isApi = (path: string) => config.apiExact.includes(path) || path === "/mcp" || path.startsWith("/mcp/") || config.apiPrefixes.some((p) => path.startsWith(p));

  const decoded = new Map<string, Uint8Array<ArrayBuffer>>();
  const bodyOf = (path: string): Uint8Array<ArrayBuffer> | null => {
    const file = config.files[path];
    if (!file) return null;
    let bytes = decoded.get(path);
    if (!bytes) {
      const raw = atob(file.body);
      bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
      decoded.set(path, bytes);
    }
    return bytes;
  };

  let assets: Promise<CardAssets> | null = null;
  const cardAssets = () =>
    (assets ??= loadCardAssets(bodyOf).catch((e: unknown) => {
      assets = null;
      throw e;
    }));

  /** The public page data for a route, from the edge cache or the API; null when it is not found. */
  async function pageData<T>(route: PageRoute, request: Request, env: FrontEnv, ctx: FrontContext): Promise<T | null> {
    const cache = edgeCache();
    const key = new Request(`${origin}/__front/data${apiPathOf(route)}`);
    const hit = cache ? await cache.match(key).catch(() => undefined) : undefined;
    let text: string;
    if (hit) text = await hit.text();
    else {
      const res = await withTimeout(env.API.fetch(new Request(new URL(apiPathOf(route), request.url), { headers: { Accept: "application/json" } })), DATA_TIMEOUT_MS);
      // Not found: no data. Anything else that is not a success is a failure the caller falls back from.
      if (res.status === 404) return null;
      if (res.status !== 200) throw new Error(`The API answered ${res.status}`);
      text = await res.text();
      if (cache) ctx.waitUntil(cache.put(key, new Response(text, { headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${EDGE_TTL_SECONDS}` } })).catch(() => undefined));
    }
    const data = (JSON.parse(text) as { data?: unknown }).data;
    return data && typeof data === "object" ? (data as T) : null;
  }

  async function metaFor(route: PublicRoute, request: Request, env: FrontEnv, ctx: FrontContext): Promise<PageMeta | null> {
    if (route.kind === "landing") return landingMeta(origin);
    if (route.kind === "funder") {
      const d = await pageData<FunderPageData>(route, request, env, ctx);
      return d?.funder && Array.isArray(d.opportunities) ? funderMeta(d, origin) : null;
    }
    const d = await pageData<OpportunityPageData>(route, request, env, ctx);
    return d?.funder && d.opportunity ? opportunityMeta(d, origin) : null;
  }

  async function cardFor(route: PublicRoute, request: Request, env: FrontEnv, ctx: FrontContext): Promise<CardText | null> {
    if (route.kind === "landing") return landingCard(config.host);
    if (route.kind === "funder") {
      const d = await pageData<FunderPageData>(route, request, env, ctx);
      return d?.funder && Array.isArray(d.opportunities) ? funderCard(d, config.host) : null;
    }
    const d = await pageData<OpportunityPageData>(route, request, env, ctx);
    return d?.funder && d.opportunity ? opportunityCard(d, config.host) : null;
  }

  function staticFile(path: string, requestPath: string, head: boolean): Response {
    const headers = new Headers({ "Content-Type": config.files[path]!.type });
    if (path === "/index.html") headers.set("Cache-Control", "no-cache");
    applyHeaderRules(headers, config.headerRules, requestPath);
    return new Response(head ? null : bodyOf(path), { headers });
  }

  /** The app's page with this page's meta in place of the defaults. */
  function withMeta(page: Response, meta: PageMeta): Response {
    const Rewriter = runtime.HTMLRewriter;
    if (!Rewriter) return page;
    const tags = headTags(meta);
    const drop = { element: (e: RewriterElement) => e.remove() };
    return new Rewriter()
      .on("title", { element: (e) => e.setInnerContent(meta.title) })
      .on('meta[name="description"]', drop)
      .on('meta[property^="og:"]', drop)
      .on('meta[name^="twitter:"]', drop)
      .on('link[rel="canonical"]', drop)
      .on('script[type="application/ld+json"]', drop)
      .on("head", { element: (e) => e.append(tags, { html: true }) })
      .transform(page);
  }

  async function shareImage(route: PublicRoute, request: Request, env: FrontEnv, ctx: FrontContext): Promise<Response> {
    const cache = edgeCache();
    const key = new Request(new URL(request.url).toString());
    const hit = cache ? await cache.match(key).catch(() => undefined) : undefined;
    if (hit) return hit;
    let card: CardText | null;
    let png: Uint8Array<ArrayBuffer>;
    try {
      card = await cardFor(route, request, env, ctx);
      if (!card) return new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=60" } });
      png = await renderCard(card, await cardAssets());
    } catch {
      // The data could not be read or the card drawn: the default card rather than none.
      return Response.redirect(`${origin}${DEFAULT_IMAGE}`, 302);
    }
    const headers = new Headers({ "Content-Type": "image/png", "Cache-Control": `public, max-age=${EDGE_TTL_SECONDS}` });
    applyHeaderRules(headers, config.headerRules, new URL(request.url).pathname);
    const res = new Response(png, { headers });
    if (cache) ctx.waitUntil(cache.put(key, res.clone()).catch(() => undefined));
    return res;
  }

  return {
    async fetch(request: Request, env: FrontEnv, ctx: FrontContext): Promise<Response> {
      const url = new URL(request.url);
      // The old address: send people (and their bookmarks) to the same page on the new one.
      if (config.redirectFrom && url.hostname === config.redirectFrom) {
        url.hostname = config.host;
        return Response.redirect(url.toString(), 308);
      }
      if (isApi(url.pathname)) return env.API.fetch(request);
      if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
      const head = request.method === "HEAD";

      if (url.pathname === "/robots.txt") {
        const headers = new Headers({ "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" });
        applyHeaderRules(headers, config.headerRules, url.pathname);
        return new Response(head ? null : robotsTxt(origin), { headers });
      }
      const imageRoute = imageRouteOf(url.pathname);
      if (imageRoute) {
        const res = await shareImage(imageRoute, request, env, ctx);
        return head ? new Response(null, res) : res;
      }

      // A path with a file extension that is not a known file is a 404; every other path is the app.
      let path = url.pathname;
      if (!config.files[path]) {
        if (/\.[a-z0-9]+$/i.test(path)) return new Response("Not found", { status: 404 });
        path = "/index.html";
      }
      const page = staticFile(path, url.pathname, head);
      const route = path === "/index.html" && !head ? routeOf(url.pathname) : null;
      if (!route) return page;
      try {
        const meta = await metaFor(route, request, env, ctx);
        return meta ? withMeta(page, meta) : page;
      } catch {
        return page;
      }
    },
  };
}
