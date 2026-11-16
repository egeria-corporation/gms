// SPDX-License-Identifier: AGPL-3.0-only
// Data behind the embeddable apply widget (`/embed/f/{handle}/o/{slug}` in the web app). No token:
// published fields only, cached at the edge like the funder pages.
import { Hono } from "hono";
import type { AppEnv } from "../app.ts";
import { ok } from "../lib/errors.ts";
import { embedWidget } from "../services/embed.ts";
import { publicCtx } from "./http.ts";

export const embedPages = new Hono<AppEnv>();

embedPages.get("/embed/funders/:handle/opportunities/:slug", async (c) => {
  c.header("Cache-Control", "public, max-age=60, s-maxage=300");
  return c.json(ok(await embedWidget(publicCtx(c), c.req.param("handle"), c.req.param("slug"))));
});
