// SPDX-License-Identifier: AGPL-3.0-only
import { MemoryRepos, type BaseContext } from "@gms/api/jobs";
import { MemoryLedgerStore } from "@gms/ledger";
import { MemoryWebhookStore } from "@gms/webhooks";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import worker, { SCHEDULES, baseFor, runJob } from "../src/index.ts";

const base = (): BaseContext => ({ repos: new MemoryRepos(), ledger: new MemoryLedgerStore(), webhooks: new MemoryWebhookStore(), now: () => new Date("2027-04-17T02:30:00Z"), ports: {}, config: { baseUrl: "https://gms.test", webBaseUrl: "https://app.gms.test", passportBaseUrl: null, credentialsKey: null, passportClient: null, mailFrom: null } });

describe("jobs worker", () => {
  it("declares in wrangler.toml exactly the crons it handles", () => {
    const toml = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");
    const declared = [...toml.matchAll(/^crons = \[(.*)\]$/gm)].map((m) => m[1]!.split(",").map((c) => c.trim().replace(/"/g, "")));
    expect(declared.length).toBe(3);
    for (const crons of declared) expect([...crons].sort()).toEqual(Object.keys(SCHEDULES).sort());
  });

  it("runs every job against an empty database without failing", async () => {
    const b = base();
    for (const name of new Set(Object.values(SCHEDULES).flat())) {
      const out = await runJob(name, b, {});
      expect(out, name).toBeTypeOf("object");
    }
    expect(await runJob("ledger-archive", b, {})).toEqual({ skipped: "LEDGER_ARCHIVE is not bound" });
  });

  it("is a no-op, not a crash, when the database is not configured", async () => {
    expect(baseFor({ GMS_BASE_URL: "https://gms.test", WEB_BASE_URL: "https://app.gms.test" })).toBeNull();
    await expect(worker.scheduled({ cron: "*/5 * * * *", scheduledTime: 0, noRetry() {} } as ScheduledController, { GMS_BASE_URL: "https://gms.test", WEB_BASE_URL: "https://app.gms.test" })).resolves.toBeUndefined();
    let retried = 0;
    await worker.queue({ messages: [{ body: { kind: "webhook_delivery" }, ack() {}, retry: () => void retried++ }] } as never, { GMS_BASE_URL: "https://gms.test", WEB_BASE_URL: "https://app.gms.test" });
    expect(retried).toBe(1);
  });
});
