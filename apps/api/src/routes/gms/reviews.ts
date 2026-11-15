// SPDX-License-Identifier: AGPL-3.0-only
// /gms routes for review parity (v1.8.0): a competition's conflict-of-interest policy and the
// reviewers' signatures, the conflicts register (JSON and CSV), the per-stage review settings
// (anonymized review, blind mode, the panel) and the board docket PDF. Each handler parses input,
// builds the ServiceContext and calls one service function. `/competitions/*` is authenticated by
// the design routes, which are mounted first.
import { Hono, type Context } from "hono";
import type { AppEnv } from "../../app.ts";
import { created, ok } from "../../lib/errors.ts";
import { uuidOf } from "../../lib/ids.ts";
import { parse } from "../../lib/input.ts";
import * as docket from "../../services/docket.ts";
import * as reviews from "../../services/reviews.ts";
import { jsonBody, svc } from "../http.ts";

export const reviewParityRoutes = new Hono<AppEnv>();

type C = Context<AppEnv>;
const competitionId = (c: C) => uuidOf("competition", c.req.param("id"), "Competition");
const file = (body: Uint8Array | string, contentType: string, filename: string, extra: Record<string, string> = {}) =>
  new Response(body as BodyInit, { status: 200, headers: { "Content-Type": contentType, "Content-Disposition": `attachment; filename="${filename}"`, "Cache-Control": "private, no-store", ...extra } });

// ---- the conflict-of-interest policy ----
reviewParityRoutes.get("/competitions/:id/coi-policy", async (c) => c.json(ok(await reviews.getCoiPolicy(await svc(c), competitionId(c)))));
reviewParityRoutes.put("/competitions/:id/coi-policy", async (c) => c.json(ok(await reviews.putCoiPolicy(await svc(c), competitionId(c), parse(reviews.coiPolicyInput, await jsonBody(c))))));
/** The reviewer signs, themselves: refused for an agent or an API client. No MCP tool. */
reviewParityRoutes.post("/competitions/:id/coi-policy/sign", async (c) => {
  const out = await reviews.signCoiPolicy(await svc(c), competitionId(c), parse(reviews.signInput, await jsonBody(c)));
  return out.alreadySigned ? c.json(ok(out, "Already signed")) : c.json(created(out), 201);
});

// ---- the conflicts register ----
reviewParityRoutes.get("/competitions/:id/conflicts-register", async (c) => c.json(ok(await reviews.getConflictsRegister(await svc(c), competitionId(c)))));
reviewParityRoutes.get("/competitions/:id/conflicts-register.csv", async (c) => {
  const out = await reviews.conflictsRegisterCsv(await svc(c), competitionId(c));
  return file(out.body, out.contentType, out.filename);
});

// ---- review settings per stage ----
reviewParityRoutes.get("/competitions/:id/review-settings", async (c) => c.json(ok(await reviews.getReviewSettings(await svc(c), competitionId(c)))));
reviewParityRoutes.put("/competitions/:id/review-settings", async (c) => c.json(ok(await reviews.putReviewSettings(await svc(c), competitionId(c), parse(reviews.reviewSettingsInput, await jsonBody(c))))));

// ---- the board docket ----
reviewParityRoutes.post("/competitions/:id/dockets", async (c) => c.json(created(await docket.createDocket(await svc(c), competitionId(c), parse(docket.docketInput, await jsonBody(c)))), 201));
reviewParityRoutes.get("/competitions/:id/dockets/:docketId", async (c) => {
  const out = await docket.getDocket(await svc(c), competitionId(c), c.req.param("docketId"));
  return file(out.bytes, "application/pdf", out.filename, { "Content-Length": String(out.bytes.byteLength), ETag: `"${out.sha256}"`, "X-Content-SHA256": out.sha256 });
});
