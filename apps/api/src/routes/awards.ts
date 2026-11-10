// SPDX-License-Identifier: AGPL-3.0-only
// CommonGrants `/awards` routes (build spec §9.1). Bare UUIDs, CommonGrants envelopes. The caller
// sees the awards of its workspace: made (funder) or received (recipient).
import { SearchRequestError } from "@gms/protocol";
import { isUuid } from "@gms/db";
import { Hono } from "hono";
import type { AppEnv } from "../app.ts";
import { authenticate } from "../auth/middleware.ts";
import { ApiError, notFound, ok, pageInfo, paginated } from "../lib/errors.ts";
import * as awards from "../services/awards.ts";
import { jsonBody, page, svc } from "./http.ts";

export const cgAwards = new Hono<AppEnv>();
cgAwards.use("/awards", authenticate());
cgAwards.use("/awards/*", authenticate());

cgAwards.get("/awards", async (c) => {
  const p = page(c);
  const { items, total } = await awards.listCgAwards(await svc(c), p);
  return c.json(paginated(items, pageInfo(p.page, p.pageSize, total)));
});
cgAwards.post("/awards/search", async (c) => {
  try {
    return c.json(await awards.searchCgAwards(await svc(c), await jsonBody(c)));
  } catch (e) {
    if (e instanceof SearchRequestError) throw new ApiError(400, "bad_request", "The search request is not valid", e.errors.map((x) => ({ code: "invalid_field", field: x.field, detail: x.message })));
    throw e;
  }
});
cgAwards.get("/awards/:awdId", async (c) => {
  const id = c.req.param("awdId");
  if (!id || !isUuid(id)) throw notFound("Award");
  return c.json(ok(await awards.getCgAward(await svc(c), id.toLowerCase())));
});
