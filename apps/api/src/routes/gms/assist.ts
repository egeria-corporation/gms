// SPDX-License-Identifier: AGPL-3.0-only
// /gms/assist: the drafting assistant. Every route returns a draft and changes nothing but the
// call log; all of them answer 404 `assistant_disabled` when the assistant is off.
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../../app.ts";
import { authenticate } from "../../auth/middleware.ts";
import { ok } from "../../lib/errors.ts";
import { uuidOf } from "../../lib/ids.ts";
import { parse } from "../../lib/input.ts";
import * as assist from "../../services/assist.ts";
import { config, jsonBody, svc } from "../http.ts";

export const assistRoutes = new Hono<AppEnv>();
assistRoutes.use("/assist/*", authenticate());
// Switched off, every drafting route is simply not there (404), whatever the body says. Only
// `/assist/status` answers, so the web app knows to hide its panels.
assistRoutes.use("/assist/*", async (c, next) => {
  if (!c.req.path.endsWith("/assist/status") && !assist.assistantOn({ config: config(c), ports: c.get("deps").ports?.(c.env) ?? {} })) throw assist.assistantDisabled();
  await next();
});
assistRoutes.use("/my/answers/:id/adapt", authenticate());

const summarizeInput = z.object({ applicationId: z.string().min(1).max(100) }).strict();
const compareInput = z.object({ applicationId: z.string().min(1).max(100), rubricId: z.uuid() }).strict();
const adaptBody = assist.adaptAnswerInput.omit({ answerId: true });

assistRoutes.get("/assist/status", async (c) => c.json(ok(await assist.assistStatus(await svc(c)))));

assistRoutes.post("/assist/summarize", async (c) => {
  const input = parse(summarizeInput, await jsonBody(c));
  return c.json(ok(await assist.summarize(await svc(c), uuidOf("application", input.applicationId, "Application"))));
});

assistRoutes.post("/assist/compare-rubric", async (c) => {
  const input = parse(compareInput, await jsonBody(c));
  return c.json(ok(await assist.compareToRubric(await svc(c), uuidOf("application", input.applicationId, "Application"), input.rubricId)));
});

assistRoutes.post("/assist/draft-letter", async (c) => {
  const { applicationId, ...input } = parse(assist.draftLetterInput, await jsonBody(c));
  return c.json(ok(await assist.draftLetter(await svc(c), input, applicationId ? uuidOf("application", applicationId, "Application") : undefined)));
});

assistRoutes.post("/assist/adapt-answer", async (c) => c.json(ok(await assist.adaptAnswer(await svc(c), parse(assist.adaptAnswerInput, await jsonBody(c))))));

assistRoutes.post("/my/answers/:id/adapt", async (c) => {
  const body = parse(adaptBody, await jsonBody(c));
  return c.json(ok(await assist.adaptAnswer(await svc(c), parse(assist.adaptAnswerInput, { ...body, answerId: c.req.param("id") }))));
});
