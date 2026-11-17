// SPDX-License-Identifier: AGPL-3.0-only
// Public open-call feeds (docs/syndication.md), mounted at /gms/public: no token, any origin (the
// open CORS list in app.ts covers /gms/public/). Each answers from one service function, is held
// by caches for five minutes (fifteen at the edge), and an unchanged body answers 304.
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
    const items = await syn.feedItems(ctx, q);
    if (format === "csv") return cached(c, syn.csvFeed(items), TYPES.csv, { "Content-Disposition": `inline; filename="opportunities.csv"` });
    const meta = await syn.feedMeta(ctx, format, q);
    return cached(c, format === "json" ? JSON.stringify(syn.jsonFeed(items, meta)) : syn.rssFeed(items, meta), TYPES[format]);
  });
}

/** What OpenGrants may list, as CommonGrants records in the protocol's list envelope. */
feedRoutes.get("/feeds/opengrants.json", async (c) => {
  const q = parse(syn.openGrantsFeedQuery, Object.fromEntries((["page", "pageSize", "modifiedSince"] as const).flatMap((k) => (c.req.query(k) === undefined ? [] : [[k, c.req.query(k)]]))));
  const { items, total } = await syn.openGrantsIndexFeed(publicCtx(c), q);
  return cached(c, JSON.stringify(paginated(items, pageInfo(q.page, q.pageSize, total))), "application/json; charset=utf-8");
});
