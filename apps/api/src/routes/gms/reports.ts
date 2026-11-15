// SPDX-License-Identifier: AGPL-3.0-only
// /gms routes of the report builder (docs/reports.md, api/reports.tsp): the data set catalog,
// previews and CSV downloads of a definition, saved views and their schedules, and the scheduled
// files a member was sent. Funder workspaces, members who may read reports. Each handler parses
// input, builds the ServiceContext and calls one service function; CSV bodies are streamed.
import { Hono, type Context } from "hono";
import { z } from "zod";
import type { AppEnv } from "../../app.ts";
import { authenticate } from "../../auth/middleware.ts";
import { created, ok } from "../../lib/errors.ts";
import { parse } from "../../lib/input.ts";
import * as reports from "../../services/report-builder.ts";
import { jsonBody, svc } from "../http.ts";

type C = Context<AppEnv>;
export const reportRoutes = new Hono<AppEnv>();

for (const prefix of ["reports", "report-views", "report-files"]) {
  reportRoutes.use(`/${prefix}`, authenticate());
  reportRoutes.use(`/${prefix}/*`, authenticate());
}

const viewId = (c: C) => c.req.param("id") ?? "";
const store = (c: C) => reports.r2ReportStore(c.env.EXPORTS);
const exportInput = z.object({ definition: reports.definitionInput, name: z.string().trim().min(1).max(120).optional() }).strict();

/** A CSV body, streamed, with its row counts in headers. */
function csv(out: { filename: string; columns: Parameters<typeof reports.csvStream>[0]["columns"]; rows: Parameters<typeof reports.csvStream>[0]["rows"]; total: number; truncated: boolean }) {
  return new Response(reports.csvStream(out), {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${out.filename}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Report-Rows": String(out.rows.length),
      "X-Report-Total": String(out.total),
      "X-Report-Truncated": String(out.truncated),
    },
  });
}

// ---- building ----
reportRoutes.get("/reports/data-sets", async (c) => c.json(ok(await reports.dataSetCatalog(await svc(c)))));
reportRoutes.post("/reports/preview", async (c) => c.json(ok(await reports.previewReport(await svc(c), parse(reports.definitionInput, await jsonBody(c))))));
reportRoutes.post("/reports/export", async (c) => {
  const input = parse(exportInput, await jsonBody(c));
  return csv(await reports.exportReport(await svc(c), input.definition, input.name));
});

// ---- saved views ----
reportRoutes.get("/report-views", async (c) => c.json(ok(await reports.listViews(await svc(c)))));
reportRoutes.post("/report-views", async (c) => c.json(created(await reports.createView(await svc(c), parse(reports.viewInput, await jsonBody(c)))), 201));
reportRoutes.get("/report-views/:id", async (c) => c.json(ok(await reports.getView(await svc(c), viewId(c)))));
reportRoutes.patch("/report-views/:id", async (c) => c.json(ok(await reports.updateView(await svc(c), viewId(c), parse(reports.viewPatch, await jsonBody(c))))));
reportRoutes.delete("/report-views/:id", async (c) => c.json(ok(await reports.deleteView(await svc(c), viewId(c), store(c)))));
reportRoutes.post("/report-views/:id/run", async (c) => c.json(ok(await reports.runView(await svc(c), viewId(c)))));
reportRoutes.get("/report-views/:id/export", async (c) => csv(await reports.exportView(await svc(c), viewId(c))));

// ---- schedules (people only) ----
reportRoutes.get("/report-views/:id/recipients", async (c) => c.json(ok(await reports.scheduleRecipients(await svc(c), viewId(c)))));
reportRoutes.put("/report-views/:id/schedule", async (c) => c.json(ok(await reports.setSchedule(await svc(c), viewId(c), parse(reports.scheduleInput, await jsonBody(c))))));
reportRoutes.delete("/report-views/:id/schedule", async (c) => c.json(ok(await reports.stopSchedule(await svc(c), viewId(c)))));

// ---- scheduled files ----
reportRoutes.get("/report-files", async (c) => c.json(ok(await reports.listMyFiles(await svc(c)))));
reportRoutes.get("/report-files/:id/download", async (c) => {
  const f = await reports.downloadFile(await svc(c), c.req.param("id"), store(c));
  return new Response(f.body as BodyInit, { status: 200, headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${f.filename}"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
});
