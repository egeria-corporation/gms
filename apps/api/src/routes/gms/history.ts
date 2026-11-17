// SPDX-License-Identifier: AGPL-3.0-only
// /gms/history: imported history (v1.12.0), read-only. A funder's past applications, reviews and
// reports, as the grantee and award pages show them, and the files imported with them. They are
// written only by an import (/gms/imports, ../../services/imports.ts); no route here changes them.
// The service (../../services/history.ts) holds the authorization; these handlers only parse.
import { Hono } from "hono";
import type { AppEnv } from "../../app.ts";
import { authenticate } from "../../auth/middleware.ts";
import { ok } from "../../lib/errors.ts";
import { parse } from "../../lib/input.ts";
import * as history from "../../services/history.ts";
import { svc } from "../http.ts";

export const historyRoutes = new Hono<AppEnv>();

for (const p of ["/history", "/history/*"]) historyRoutes.use(p, authenticate());

const download = (f: { bytes: Uint8Array; mime: string; filename: string }) =>
  new Response(f.bytes as Uint8Array<ArrayBuffer>, { status: 200, headers: { "Content-Type": f.mime, "Content-Disposition": `attachment; filename="${f.filename}"`, "Content-Length": String(f.bytes.byteLength), "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store" } });

historyRoutes.get("/history", async (c) => c.json(ok(await history.listHistory(await svc(c), parse(history.historyQuery, { ...(c.req.query("organization") ? { organization: c.req.query("organization") } : {}), ...(c.req.query("award") ? { award: c.req.query("award") } : {}) })))));
historyRoutes.get("/history/applications/:id", async (c) => c.json(ok(await history.getHistoryApplication(await svc(c), c.req.param("id")))));
historyRoutes.get("/history/applications/:id/files/:docId", async (c) => download(await history.historyFile(await svc(c), "application", c.req.param("id"), c.req.param("docId"))));
historyRoutes.get("/history/reports/:id/files/:docId", async (c) => download(await history.historyFile(await svc(c), "report", c.req.param("id"), c.req.param("docId"))));
