// SPDX-License-Identifier: AGPL-3.0-only
// Inbound webhooks (build spec §10.7): `POST /webhooks/passport` and `POST /webhooks/resend`.
// The raw body is read once and verified before it is parsed; a bad signature answers 401 and
// stores nothing.
import { Hono } from "hono";
import type { AppEnv } from "../app.ts";
import { notFound } from "../lib/errors.ts";
import { receivePassportEvent, receiveResendEvent } from "../services/inbound.ts";
import { config } from "./http.ts";

export const inboundWebhooks = new Hono<AppEnv>();

const base = (c: Parameters<typeof config>[0]) => {
  const deps = c.get("deps");
  return { repos: deps.repos, ledger: deps.ledger, webhooks: deps.webhooks, now: deps.now, config: config(c), ports: deps.ports?.(c.env) ?? {} };
};

inboundWebhooks.post("/passport", async (c) => {
  const raw = await c.req.text();
  const queue = c.env.GMS_EVENTS;
  const r = await receivePassportEvent(base(c), c.req.raw.headers, raw, queue ? async (m) => void (await queue.send(m)) : undefined);
  return c.json({ status: r.status, message: r.outcome }, r.status);
});

inboundWebhooks.post("/resend", async (c) => {
  const r = await receiveResendEvent(base(c), c.req.raw.headers, await c.req.text());
  return c.json({ status: r.status, message: r.outcome }, r.status);
});

inboundWebhooks.all("*", () => {
  throw notFound("Webhook");
});
