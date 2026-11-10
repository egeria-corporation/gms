// SPDX-License-Identifier: AGPL-3.0-only
// CommonGrants `/applications` routes (build spec §9.1). Bare UUIDs, CommonGrants envelopes. A
// client that speaks only the protocol gets the same result as the web app, because both call
// the functions in services/apply.ts.
import { SearchRequestError } from "@gms/protocol";
import { isUuid } from "@gms/db";
import { Hono, type Context } from "hono";
import type { AppEnv } from "../app.ts";
import { authenticate } from "../auth/middleware.ts";
import { ApiError, created, notFound, ok } from "../lib/errors.ts";
import { parse } from "../lib/input.ts";
import * as apply from "../services/apply.ts";
import { jsonBody, svc } from "./http.ts";

type C = Context<AppEnv>;
const uuid = (c: C, name: string, what: string) => {
  const v = c.req.param(name);
  if (!v || !isUuid(v)) throw notFound(what);
  return v.toLowerCase();
};

export const cgApplications = new Hono<AppEnv>();
cgApplications.use("/applications/*", authenticate());

cgApplications.post("/applications/start", async (c) => {
  const { application, created: isNew } = await apply.startApplication(await svc(c), parse(apply.startInput, await jsonBody(c)));
  return isNew ? c.json(created(application), 201) : c.json(ok(application));
});
cgApplications.post("/applications/search", async (c) => {
  try {
    return c.json(await apply.searchApplications(await svc(c), await jsonBody(c)));
  } catch (e) {
    if (e instanceof SearchRequestError) throw new ApiError(400, "bad_request", "The search request is not valid", e.errors.map((x) => ({ code: "invalid_field", field: x.field, detail: x.message })));
    throw e;
  }
});
cgApplications.get("/applications/:appId", async (c) => c.json(ok(await apply.getApplication(await svc(c), uuid(c, "appId", "Application")))));
cgApplications.get("/applications/:appId/forms/:formId", async (c) => c.json(ok(await apply.getFormResponse(await svc(c), uuid(c, "appId", "Application"), uuid(c, "formId", "Form")))));
cgApplications.put("/applications/:appId/forms/:formId", async (c) =>
  c.json(ok(await apply.putFormResponse(await svc(c), uuid(c, "appId", "Application"), uuid(c, "formId", "Form"), parse(apply.formResponseInput, await jsonBody(c))))),
);
cgApplications.put("/applications/:appId/submit", async (c) => c.json(ok(await apply.submitApplication(await svc(c), uuid(c, "appId", "Application")))));
