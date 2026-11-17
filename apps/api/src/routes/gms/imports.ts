// SPDX-License-Identifier: AGPL-3.0-only
// /gms/imports: import from a spreadsheet (CSV, XLSX, Google Sheets, Airtable). The service
// (../../services/imports.ts) holds the rules and the authorization; these handlers only parse.
import { Hono } from "hono";
import type { AppEnv } from "../../app.ts";
import { authenticate } from "../../auth/middleware.ts";
import { ApiError, created, ok } from "../../lib/errors.ts";
import { bareUuid } from "../../lib/ids.ts";
import { parse } from "../../lib/input.ts";
import * as imports from "../../services/imports.ts";
import { jsonBody, svc } from "../http.ts";

export const importRoutes = new Hono<AppEnv>();

for (const p of ["/imports/sources", "/imports/read", "/imports/preview", "/imports/runs", "/imports/runs/*"]) importRoutes.use(p, authenticate());

const targetQuery = (value: string | undefined) => {
  const r = imports.targetInput.safeParse(value);
  if (!r.success) throw new ApiError(400, "bad_request", "target must be outside_applications, award_history, history_applications, history_reviews or history_reports", [{ code: "invalid_parameter", field: "target" }]);
  return r.data;
};

importRoutes.get("/imports/sources", async (c) => c.json(ok(await imports.importSources(await svc(c), targetQuery(c.req.query("target"))))));
importRoutes.post("/imports/read", async (c) => c.json(ok(await imports.readImportSource(await svc(c), parse(imports.readInput, await jsonBody(c))))));
importRoutes.post("/imports/preview", async (c) => c.json(created(await imports.previewImport(await svc(c), parse(imports.previewInput, await jsonBody(c)))), 201));
importRoutes.get("/imports/runs", async (c) => c.json(ok(await imports.listImportRuns(await svc(c), targetQuery(c.req.query("target"))))));
importRoutes.get("/imports/runs/:id", async (c) => c.json(ok(await imports.getImportRun(await svc(c), bareUuid(c.req.param("id"), "Import run")))));
importRoutes.post("/imports/runs/:id/commit", async (c) => c.json(ok(await imports.commitImport(await svc(c), bareUuid(c.req.param("id"), "Import run")))));
