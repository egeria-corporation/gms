// SPDX-License-Identifier: AGPL-3.0-only
// /gms routes for "Send to the funder" (C4): what an outside application's package holds, the
// package as a PDF or a ZIP, the email preview and the email (a person only), and the footer
// setting. Each handler parses input, builds the ServiceContext and calls one service function.
import { Hono, type Context, type MiddlewareHandler } from "hono";
import type { AppEnv } from "../../app.ts";
import { authenticate } from "../../auth/middleware.ts";
import { ok } from "../../lib/errors.ts";
import { bareUuid } from "../../lib/ids.ts";
import { parse } from "../../lib/input.ts";
import * as pkg from "../../services/send-package.ts";
import { jsonBody, svc } from "../http.ts";

type C = Context<AppEnv>;
export const sendPackageRoutes = new Hono<AppEnv>();

// Authenticated once, whichever router's middleware ran first for the same path.
const signedIn: MiddlewareHandler<AppEnv> = async (c, next) => (c.get("principal") ? next() : authenticate()(c, next));
sendPackageRoutes.use("/outside-applications/:id/package", signedIn);
sendPackageRoutes.use("/outside-applications/:id/package.pdf", signedIn);
sendPackageRoutes.use("/outside-applications/:id/package.zip", signedIn);
sendPackageRoutes.use("/outside-applications/:id/package/*", signedIn);
sendPackageRoutes.use("/send-package/settings", signedIn);

const oaId = (c: C) => bareUuid(c.req.param("id"), "Outside application");
const download = (f: { bytes: Uint8Array; filename: string; sha256: string }, type: string) =>
  new Response(f.bytes as Uint8Array<ArrayBuffer>, {
    status: 200,
    headers: { "Content-Type": type, "Content-Disposition": `attachment; filename="${f.filename.replace(/["\\\r\n]/g, "")}"`, "Content-Length": String(f.bytes.byteLength), "X-Content-SHA256": f.sha256, "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store" },
  });

sendPackageRoutes.get("/outside-applications/:id/package", async (c) => c.json(ok(await pkg.packageSummary(await svc(c), oaId(c)))));
sendPackageRoutes.get("/outside-applications/:id/package.pdf", async (c) => download(await pkg.packagePdfFile(await svc(c), oaId(c)), "application/pdf"));
sendPackageRoutes.get("/outside-applications/:id/package.zip", async (c) => download(await pkg.packageZipFile(await svc(c), oaId(c)), "application/zip"));
// Human only: no MCP tool emails a package, and an agent's token is refused in the service.
sendPackageRoutes.post("/outside-applications/:id/package/email/preview", async (c) => {
  c.header("Cache-Control", "no-store");
  return c.json(ok(await pkg.previewPackageEmail(await svc(c), oaId(c), parse(pkg.emailInput, await jsonBody(c)))));
});
sendPackageRoutes.post("/outside-applications/:id/package/email", async (c) => c.json(ok(await pkg.sendPackageEmailFor(await svc(c), oaId(c), parse(pkg.sendInput, await jsonBody(c))))));
sendPackageRoutes.put("/send-package/settings", async (c) => c.json(ok(await pkg.setPackageFooter(await svc(c), parse(pkg.settingsInput, await jsonBody(c))))));
