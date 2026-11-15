// SPDX-License-Identifier: AGPL-3.0-only
// Open data exports (docs/open-data.md): the summary behind the Reporting panel, the 360Giving
// downloads (JSON, CSV), the CommonGrants download, the funder's settings and per-award
// confidential mark, and the public 360Giving feed. Every route calls one service function; the
// feed is the only one without a token, and it is read-only and cached.
import { Hono, type Context } from "hono";
import type { AppEnv } from "../../app.ts";
import { authenticate } from "../../auth/middleware.ts";
import { ok } from "../../lib/errors.ts";
import { uuidOf } from "../../lib/ids.ts";
import { parse } from "../../lib/input.ts";
import * as openData from "../../services/open-data.ts";
import { jsonBody, publicCtx, svc } from "../http.ts";

export const openDataRoutes = new Hono<AppEnv>();
type C = Context<AppEnv>;
const auth = authenticate();

const range = (c: C) => openData.rangeOf({ year: c.req.query("year"), from: c.req.query("from"), to: c.req.query("to") });

const download = (f: openData.ExportFile) =>
  new Response(f.body, {
    status: 200,
    headers: { "Content-Type": f.contentType, "Content-Disposition": `attachment; filename="${f.filename}"`, "Cache-Control": "private, no-store", ...(f.draft ? { "X-Open-Data-Draft": "true" } : {}) },
  });

openDataRoutes.get("/open-data/summary", auth, async (c) => c.json(ok(await openData.openDataSummary(await svc(c), range(c)))));
openDataRoutes.get("/open-data/360giving.json", auth, async (c) => download(await openData.threeSixtyGivingExport(await svc(c), range(c), "json")));
openDataRoutes.get("/open-data/360giving.csv", auth, async (c) => download(await openData.threeSixtyGivingExport(await svc(c), range(c), "csv")));
openDataRoutes.get("/open-data/commongrants.json", auth, async (c) => download(await openData.commonGrantsExport(await svc(c), range(c))));
openDataRoutes.put("/open-data/settings", auth, async (c) => c.json(ok(await openData.updateOpenDataSettings(await svc(c), parse(openData.settingsInput, await jsonBody(c))))));
openDataRoutes.put("/open-data/awards/:id/confidential", auth, async (c) => c.json(ok(await openData.setAwardConfidential(await svc(c), uuidOf("award", c.req.param("id"), "Award"), parse(openData.confidentialInput, await jsonBody(c))))));

/** The public feed. Any origin may read it; caches hold it for five minutes (fifteen at the edge), and an unchanged body answers 304. */
openDataRoutes.get("/open-data/:handle/360giving.json", async (c) => {
  const body = JSON.stringify(await openData.publicFeed(publicCtx(c), c.req.param("handle")));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body)));
  const etag = `"${[...digest].map((b) => b.toString(16).padStart(2, "0")).join("")}"`;
  const headers = { "Cache-Control": "public, max-age=300, s-maxage=900", ETag: etag, "Access-Control-Allow-Origin": "*" };
  const seen = (c.req.header("If-None-Match") ?? "").split(",").map((s) => s.trim());
  if (seen.includes(etag)) return new Response(null, { status: 304, headers });
  return new Response(body, { status: 200, headers: { ...headers, "Content-Type": "application/json; charset=utf-8" } });
});
