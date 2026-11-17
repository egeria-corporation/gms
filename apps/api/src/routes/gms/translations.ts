// SPDX-License-Identifier: AGPL-3.0-only
// /gms/translations: "Draft with the assistant" for a funder's translations (docs/forms.md,
// "Languages"). Each route returns drafts and saves nothing; the funder reviews them in the
// builder. 404 `assistant_disabled` when the assistant is off.
import { Hono } from "hono";
import type { AppEnv } from "../../app.ts";
import { authenticate } from "../../auth/middleware.ts";
import { ok } from "../../lib/errors.ts";
import { uuidOf } from "../../lib/ids.ts";
import { parse } from "../../lib/input.ts";
import * as translations from "../../services/translation-assist.ts";
import { jsonBody, svc } from "../http.ts";

export const translationRoutes = new Hono<AppEnv>();
translationRoutes.use("/translations/*", authenticate());

translationRoutes.post("/translations/forms/:id/draft", async (c) => {
  const input = parse(translations.translationDraftInput, await jsonBody(c));
  return c.json(ok(await translations.draftFormTranslation(await svc(c), uuidOf("form", c.req.param("id"), "Form"), input)));
});

translationRoutes.post("/translations/opportunities/:id/draft", async (c) => {
  const input = parse(translations.translationDraftInput, await jsonBody(c));
  return c.json(ok(await translations.draftOpportunityTranslation(await svc(c), uuidOf("opportunity", c.req.param("id"), "Opportunity"), input)));
});
