// SPDX-License-Identifier: AGPL-3.0-only
// Routes anyone may call: the CommonGrants read routes (published records; drafts with a token for
// the owning workspace), the data behind the funder pages, and the sitemap.
import { SearchRequestError } from "@gms/protocol";
import { Hono, type Context } from "hono";
import type { AppEnv } from "../app.ts";
import { authenticate } from "../auth/middleware.ts";
import { ApiError, notFound, ok, pageInfo, paginated } from "../lib/errors.ts";
import { isUuid } from "@gms/db";
import * as pub from "../services/public.ts";
import { cgSearchOpportunities } from "../services/search.ts";
import { jsonBody, page, publicCtx, versionQuery } from "./http.ts";

type C = Context<AppEnv>;

/** A token is optional on protocol reads; when one is sent it must be valid, and it unlocks the owner's drafts. */
async function viewer(c: C): Promise<pub.Viewer | null> {
  if (!c.req.header("Authorization")) return null;
  await authenticate()(c, async () => {});
  const p = c.get("principal");
  const has = (s: string) => p.scopes.includes(s);
  return { workspaceId: p.workspaceId, canReadDrafts: { opportunities: has("opportunities:read"), competitions: has("competitions:read"), forms: has("forms:read") } };
}

const uuid = (c: C, name: string, what: string) => {
  const v = c.req.param(name);
  if (!v || !isUuid(v)) throw notFound(what);
  return v.toLowerCase();
};

export const commonGrants = new Hono<AppEnv>();

commonGrants.get("/opportunities", async (c) => {
  const p = page(c);
  const { items, total } = await pub.cgListOpportunities(publicCtx(c), { status: c.req.query("status"), limit: p.pageSize, offset: p.offset });
  return c.json(paginated(items, pageInfo(p.page, p.pageSize, total)));
});
commonGrants.post("/opportunities/search", async (c) => {
  try {
    return c.json(await cgSearchOpportunities(publicCtx(c), await jsonBody(c)));
  } catch (e) {
    if (e instanceof SearchRequestError) throw new ApiError(400, "bad_request", "The search request is not valid", e.errors.map((x) => ({ code: "invalid_field", field: x.field, detail: x.message })));
    throw e;
  }
});
commonGrants.get("/opportunities/:oppId", async (c) => c.json(ok(await pub.cgGetOpportunity(publicCtx(c), uuid(c, "oppId", "Opportunity"), await viewer(c)))));
commonGrants.get("/competitions/:compId", async (c) => c.json(ok(await pub.cgGetCompetition(publicCtx(c), uuid(c, "compId", "Competition"), await viewer(c)))));
commonGrants.get("/forms", async (c) => {
  const p = page(c);
  const { items, total } = await pub.cgListForms(publicCtx(c), { limit: p.pageSize, offset: p.offset });
  return c.json(paginated(items, pageInfo(p.page, p.pageSize, total)));
});
commonGrants.get("/forms/:formId", async (c) => c.json(ok(await pub.cgGetForm(publicCtx(c), uuid(c, "formId", "Form"), versionQuery(c), await viewer(c)))));

/** Data for the web app's `/f/{handle}` and `/f/{handle}/o/{slug}` pages. */
export const publicPages = new Hono<AppEnv>();
const edge = (c: C) => c.header("Cache-Control", "public, max-age=60, s-maxage=300");
publicPages.get("/funders/:handle", async (c) => {
  edge(c);
  return c.json(ok(await pub.funderPage(publicCtx(c), c.req.param("handle"))));
});
publicPages.get("/funders/:handle/opportunities/:slug", async (c) => {
  edge(c);
  return c.json(ok(await pub.opportunityPage(publicCtx(c), c.req.param("handle"), c.req.param("slug"))));
});

const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export async function sitemap(c: C) {
  const entries = await pub.sitemapEntries(publicCtx(c));
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.map((e) => `  <url><loc>${xml(e.loc)}</loc><lastmod>${xml(new Date(e.lastmod).toISOString())}</lastmod></url>`).join("\n")}\n</urlset>\n`;
  return c.body(body, 200, { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=300" });
}
