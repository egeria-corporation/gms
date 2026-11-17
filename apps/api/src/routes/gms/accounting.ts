// SPDX-License-Identifier: AGPL-3.0-only
// /gms/accounting (v1.13.0, docs/accounting.md): the QuickBooks sync of a funder workspace. Connecting
// QuickBooks is `/gms/connectors/quickbooks` (./admin.ts). Reading is for admins and finance staff,
// and their agents (payments:read); every write is a signed-in person's, in the GMS (the service
// refuses agent and API-client tokens before it reads a body). Record-keeping only: no route here
// pays, schedules or moves money.
import { Hono } from "hono";
import type { AppEnv } from "../../app.ts";
import { authenticate } from "../../auth/middleware.ts";
import { ok } from "../../lib/errors.ts";
import * as accounting from "../../services/accounting.ts";
import { jsonBody, svc } from "../http.ts";

export const accountingRoutes = new Hono<AppEnv>();

accountingRoutes.use("/accounting", authenticate());
accountingRoutes.use("/accounting/*", authenticate());

accountingRoutes.get("/accounting", async (c) => c.json(ok(await accounting.getAccounting(await svc(c)))));
accountingRoutes.get("/accounting/options", async (c) => c.json(ok(await accounting.getAccountingOptions(await svc(c)))));
accountingRoutes.put("/accounting/settings", async (c) => {
  const ctx = await svc(c);
  return c.json(ok(await accounting.putAccountingSettings(ctx, await jsonBody(c))));
});
accountingRoutes.get("/accounting/vendors", async (c) => c.json(ok(await accounting.getAccountingVendors(await svc(c)))));
accountingRoutes.put("/accounting/vendors", async (c) => {
  const ctx = await svc(c);
  return c.json(ok(await accounting.putAccountingVendors(ctx, await jsonBody(c))));
});
/** The reconciliation view, read only. `?compare=true` reads the entries shown back from QuickBooks. */
accountingRoutes.get("/accounting/entries", async (c) => c.json(ok(await accounting.listAccountingEntries(await svc(c), { compare: c.req.query("compare") === "true" }))));
accountingRoutes.post("/accounting/entries/:id/handled", async (c) => c.json(ok(await accounting.markEntryHandled(await svc(c), c.req.param("id")))));
accountingRoutes.post("/accounting/entries/:id/retry", async (c) => c.json(ok(await accounting.retryEntry(await svc(c), c.req.param("id")))));
