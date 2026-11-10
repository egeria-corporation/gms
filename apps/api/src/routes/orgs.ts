// SPDX-License-Identifier: AGPL-3.0-only
// CommonGrants `/orgs` routes (build spec §9.1), served from cached Passport projections. Reads
// need `org:read`; changes are never made here: they are forwarded to Passport as proposals.
import { isUuid } from "@gms/db";
import { Hono, type Context } from "hono";
import type { AppEnv } from "../app.ts";
import { authenticate } from "../auth/middleware.ts";
import { notFound, ok, pageInfo, paginated } from "../lib/errors.ts";
import { parse } from "../lib/input.ts";
import * as grantees from "../services/grantees.ts";
import { jsonBody, page, svc } from "./http.ts";

export const cgOrgs = new Hono<AppEnv>();
cgOrgs.use("/orgs", authenticate());
cgOrgs.use("/orgs/*", authenticate());

const orgId = (c: Context<AppEnv>) => {
  const id = c.req.param("orgId");
  if (!id || !isUuid(id)) throw notFound("Organization");
  return id.toLowerCase();
};

cgOrgs.get("/orgs", async (c) => {
  const p = page(c);
  const { items, total } = await grantees.listCgOrgs(await svc(c), p, { registry: c.req.query("registry") || undefined, id: c.req.query("id") || undefined });
  return c.json(paginated(items, pageInfo(p.page, p.pageSize, total)));
});
cgOrgs.get("/orgs/:orgId", async (c) => c.json(ok(await grantees.getCgOrg(await svc(c), orgId(c)))));
cgOrgs.patch("/orgs/:orgId", async (c) => c.json(ok(await grantees.patchCgOrg(await svc(c), orgId(c), parse(grantees.cgChangeInput, await jsonBody(c))), "Proposed to Passport"), 202));
cgOrgs.get("/orgs/:orgId/changes", async (c) => {
  const p = page(c);
  const { items, total } = await grantees.listCgOrgChanges(await svc(c), orgId(c), p);
  return c.json(paginated(items, pageInfo(p.page, p.pageSize, total)));
});
cgOrgs.post("/orgs/:orgId/changes", async (c) => c.json(ok(await grantees.proposeCgOrgChange(await svc(c), orgId(c), parse(grantees.cgChangeInput, await jsonBody(c))), "Proposed to Passport"), 202));
cgOrgs.get("/orgs/:orgId/changes/:changeId", async (c) => c.json(ok(await grantees.getCgOrgChange(await svc(c), orgId(c), c.req.param("changeId")))));
