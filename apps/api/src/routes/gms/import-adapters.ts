// SPDX-License-Identifier: AGPL-3.0-only
// /gms/imports, importer adapters (v1.9.0): connecting Fluxx and Zengine with the funder's own
// credentials, the Zengine forms to choose from, and the files from a grants system's zip attached
// to the awards an import created. The services (../../services/import-pullers.ts,
// ../../services/import-files.ts) hold the rules and the authorization; these handlers only parse.
import { Hono, type MiddlewareHandler } from "hono";
import type { AppEnv } from "../../app.ts";
import { authenticate } from "../../auth/middleware.ts";
import { ApiError, created, ok } from "../../lib/errors.ts";
import { bareUuid } from "../../lib/ids.ts";
import { parse } from "../../lib/input.ts";
import * as files from "../../services/import-files.ts";
import * as pullers from "../../services/import-pullers.ts";
import { jsonBody, svc } from "../http.ts";

export const importAdapterRoutes = new Hono<AppEnv>();

/** Authenticates unless an earlier middleware on the same path already did (the import routes' own). */
const auth: MiddlewareHandler<AppEnv> = async (c, next) => (c.get("principal") ? next() : authenticate()(c, next));
for (const p of ["/imports/connections/*", "/imports/zengine/*", "/imports/runs/:id/files", "/imports/runs/:id/files/*"]) importAdapterRoutes.use(p, auth);

const provider = (value: string | undefined) => {
  const r = pullers.pullerProviderInput.safeParse(value);
  if (!r.success) throw new ApiError(404, "not_found", "No such import connection");
  return r.data;
};
const runId = (id: string) => bareUuid(id, "Import run");

importAdapterRoutes.get("/imports/connections/:provider", async (c) => c.json(ok(await pullers.getPullerConnection(await svc(c), provider(c.req.param("provider"))))));
importAdapterRoutes.post("/imports/connections/:provider", async (c) => c.json(created(await pullers.connectPuller(await svc(c), provider(c.req.param("provider")), parse(pullers.pullerConnectInput, await jsonBody(c)))), 201));
importAdapterRoutes.delete("/imports/connections/:provider", async (c) => c.json(ok(await pullers.disconnectPuller(await svc(c), provider(c.req.param("provider"))))));
importAdapterRoutes.get("/imports/zengine/forms", async (c) => c.json(ok(await pullers.zengineForms(await svc(c)))));

importAdapterRoutes.get("/imports/runs/:id/files", async (c) => c.json(ok(await files.listImportFiles(await svc(c), runId(c.req.param("id"))))));
importAdapterRoutes.post("/imports/runs/:id/files/match", async (c) => c.json(ok(await files.matchImportFiles(await svc(c), runId(c.req.param("id")), parse(files.matchFilesInput, await jsonBody(c))))));
importAdapterRoutes.post("/imports/runs/:id/files", async (c) => {
  const r = await files.attachImportFile(await svc(c), runId(c.req.param("id")), parse(files.attachFileInput, await jsonBody(c)));
  return c.json(r.created ? created(r) : ok(r), r.created ? 201 : 200);
});
