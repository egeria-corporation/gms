// SPDX-License-Identifier: AGPL-3.0-only
// Public open-call feeds (docs/syndication.md), mounted at /gms/public: no token, any origin (the
// open CORS list in app.ts covers /gms/public/). Each answers from one service function. A Worker's
// response is not kept by Cloudflare's cache on its own, so each feed is put in the colo's cache
// (Workers Cache API) for FEED_EDGE_TTL_SECONDS under its canonical address (filters in a fixed
// order, other parameters dropped); browsers and feed readers keep it five minutes; an unchanged
// body answers 304.
//   GET /feeds/opportunities.json | .csv | .rss   ?region= &category= &funder= &closingWithin=
//   GET /feeds/opengrants.json                    ?page= &pageSize= &modifiedSince=
import { Hono, type Context } from "hono";
import type { AppEnv } from "../app.ts";
import { pageInfo, paginated } from "../lib/errors.ts";
import { parse } from "../lib/input.ts";
import * as syn from "../services/syndication.ts";
import { publicCtx } from "./http.ts";

type C = Context<AppEnv>;
export const feedRoutes = new Hono<AppEnv>();

const TYPES = { json: "application/feed+json; charset=utf-8", csv: "text/csv; charset=utf-8", rss: "application/rss+xml; charset=utf-8" } as const;

/** The feed filters from the query string; any other parameter (a newsletter's `utm_*`) is ignored. */
const filters = (c: C) => parse(syn.feedQuery, Object.fromEntries(syn.FEED_PARAMS.flatMap((k) => (c.req.query(k) === undefined ? [] : [[k, c.req.query(k)]]))));

/** How long a colo keeps a feed it built: a call taken out of the feeds leaves them within this. */
export const FEED_EDGE_TTL_SECONDS = 300;

interface EdgeCache {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
}
/** The colo's cache in a Worker; none in tests and in Node. */
const edgeCache = (): EdgeCache | undefined => (globalThis as { caches?: { default?: EdgeCache } }).caches?.default;

type Built = { body: string; type: string; extra?: Record<string, string> };

/** The feed under its canonical address from the colo's cache, or built and put there. A cache that fails is skipped. */
async function fromEdge(key: string, build: () => Promise<Built>): Promise<Built> {
  const cache = edgeCache();
  const request = new Request(key, { method: "GET" });
  const hit = cache ? await cache.match(request).catch(() => undefined) : undefined;
  if (hit) {
    const disposition = hit.headers.get("Content-Disposition");
    return { body: await hit.text(), type: hit.headers.get("Content-Type") ?? "application/octet-stream", ...(disposition ? { extra: { "Content-Disposition": disposition } } : {}) };
  }
  const built = await build();
  if (cache) await cache.put(request, new Response(built.body, { headers: { "Content-Type": built.type, "Cache-Control": `public, max-age=${FEED_EDGE_TTL_SECONDS}`, ...(built.extra ?? {}) } })).catch(() => undefined);
  return built;
}

async function cached(c: C, body: string, type: string, extra: Record<string, string> = {}) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body)));
  const etag = `"${[...digest].map((b) => b.toString(16).padStart(2, "0")).join("")}"`;
  const headers = { "Cache-Control": syn.FEED_CACHE_CONTROL, ETag: etag };
  const seen = (c.req.header("If-None-Match") ?? "").split(",").map((s) => s.trim().replace(/^W\//, ""));
  if (seen.includes(etag)) return new Response(null, { status: 304, headers });
  return new Response(body, { status: 200, headers: { ...headers, "Content-Type": type, ...extra } });
}

for (const format of ["json", "csv", "rss"] as const) {
  feedRoutes.get(`/feeds/opportunities.${format}`, async (c) => {
    const ctx = publicCtx(c);
    const q = filters(c);
    const f = await fromEdge(syn.feedUrl(ctx, format, q), async () => {
      const items = await syn.feedItems(ctx, q);
      if (format === "csv") return { body: syn.csvFeed(items), type: TYPES.csv, extra: { "Content-Disposition": `inline; filename="opportunities.csv"` } };
      const meta = await syn.feedMeta(ctx, format, q);
      return { body: format === "json" ? JSON.stringify(syn.jsonFeed(items, meta)) : syn.rssFeed(items, meta), type: TYPES[format] };
    });
    return cached(c, f.body, f.type, f.extra);
  });
}

/** What OpenGrants may list, as CommonGrants records in the protocol's list envelope. */
feedRoutes.get("/feeds/opengrants.json", async (c) => {
  const q = parse(syn.openGrantsFeedQuery, Object.fromEntries((["page", "pageSize", "modifiedSince"] as const).flatMap((k) => (c.req.query(k) === undefined ? [] : [[k, c.req.query(k)]]))));
  const ctx = publicCtx(c);
  const key = new URL(syn.openGrantsFeedUrl(ctx));
  for (const [k, v] of Object.entries({ page: q.page, pageSize: q.pageSize, modifiedSince: q.modifiedSince })) if (v !== undefined) key.searchParams.set(k, String(v));
  const f = await fromEdge(key.toString(), async () => {
    const { items, total } = await syn.openGrantsIndexFeed(ctx, q);
    return { body: JSON.stringify(paginated(items, pageInfo(q.page, q.pageSize, total))), type: "application/json; charset=utf-8" };
  });
  return cached(c, f.body, f.type, f.extra);
});
