// SPDX-License-Identifier: AGPL-3.0-only
// `POST /webhooks/zernio`: Zernio's account and post events. The raw body is read once and its
// signature (X-Zernio-Signature, HMAC-SHA256 with ZERNIO_WEBHOOK_SECRET) checked before it is
// parsed; a bad signature answers 401 and stores nothing. Not set up on this server: 404.
import { Hono } from "hono";
import type { AppEnv } from "../app.ts";
import { notFound } from "../lib/errors.ts";
import { receiveZernioEvent } from "../services/social.ts";
import { config } from "./http.ts";

export const zernioWebhook = new Hono<AppEnv>();

zernioWebhook.post("/", async (c) => {
  const deps = c.get("deps");
  const base = { repos: deps.repos, ledger: deps.ledger, webhooks: deps.webhooks, now: deps.now, config: config(c), ports: deps.ports?.(c.env) ?? {} };
  const r = await receiveZernioEvent(base, c.req.raw.headers, await c.req.text());
  return c.json({ status: r.status, message: r.outcome }, r.status);
});

zernioWebhook.all("*", () => {
  throw notFound("Webhook");
});
