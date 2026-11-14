// SPDX-License-Identifier: AGPL-3.0-only
import { MemoryRepos, type BaseContext } from "@gms/api/jobs";
import { MemoryLedgerStore } from "@gms/ledger";
import { MemoryWebhookStore } from "@gms/webhooks";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import worker, { CRON, baseFor, jobsDue, runJob, type JobName } from "../src/index.ts";

const base = (): BaseContext => ({ repos: new MemoryRepos(), ledger: new MemoryLedgerStore(), webhooks: new MemoryWebhookStore(), now: () => new Date("2027-04-17T02:30:00Z"), ports: {}, config: { baseUrl: "https://gms.test", webBaseUrl: "https://app.gms.test", passportBaseUrl: null, credentialsKey: null, passportClient: null, mailFrom: null } });

describe("jobs worker", () => {
  it("declares exactly one cron, in every environment", () => {
    const toml = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");
    const declared = [...toml.matchAll(/^crons = \[(.*)\]$/gm)].map((m) => m[1]!.split(",").map((c) => c.trim().replace(/"/g, "")));
    expect(declared.length).toBe(3);
    for (const crons of declared) expect(crons).toEqual([CRON]);
  });

  const at = (iso: string) => jobsDue(new Date(iso));
  const EVERY = ["webhooks"];
  const QUARTER = ["tranches", "tranche-reconcile", "requirements"];

  it("runs the right jobs at each moment of the old seven schedules", () => {
    expect(at("2027-04-14T10:05:00Z")).toEqual(EVERY); // an ordinary tick
    expect(at("2027-04-14T10:15:00Z")).toEqual([...EVERY, ...QUARTER]);
    expect(at("2027-04-14T10:45:00Z")).toEqual([...EVERY, ...QUARTER]);
    expect(at("2027-04-14T10:00:00Z")).toEqual([...EVERY, ...QUARTER, "passport"]); // top of the hour
    expect(at("2027-04-14T12:00:00Z")).toEqual([...EVERY, ...QUARTER, "passport", "mercury"]); // every 6 hours
    expect(at("2027-04-14T00:00:00Z")).toEqual([...EVERY, ...QUARTER, "passport", "mercury"]);
    expect(at("2027-04-14T18:00:00Z")).toContain("mercury");
    expect(at("2027-04-14T09:00:00Z")).not.toContain("mercury");
    expect(at("2027-04-14T02:30:00Z")).toEqual([...EVERY, ...QUARTER, "org-changes", "ledger-archive"]);
    expect(at("2027-04-14T03:30:00Z")).not.toContain("ledger-archive");
    expect(at("2027-04-14T14:30:00Z")).toEqual([...EVERY, ...QUARTER, "outside-deadlines"]);
    expect(at("2027-04-14T14:35:00Z")).toEqual([...EVERY, "keep-reminders"]);
    expect(at("2027-04-14T15:00:00Z")).toEqual([...EVERY, ...QUARTER, "passport", "digest-daily"]);
    expect(at("2027-04-14T16:00:00Z")).not.toContain("digest-daily");
    expect(at("2027-04-19T15:05:00Z")).toEqual([...EVERY, "digest-weekly"]); // a Monday
    expect(at("2027-04-20T15:05:00Z")).toEqual(EVERY); // not a Monday
    expect(at("2027-04-19T16:05:00Z")).toEqual(EVERY);
  });

  it("ignores seconds, runs nothing twice in a tick, and covers a week with every job on its own schedule", () => {
    expect(at("2027-04-14T10:15:42Z")).toEqual(at("2027-04-14T10:15:00Z"));
    const counts = new Map<JobName, number>();
    for (let t = Date.UTC(2027, 3, 12); t < Date.UTC(2027, 3, 19); t += 5 * 60_000) {
      const due = jobsDue(new Date(t));
      expect(new Set(due).size).toBe(due.length);
      for (const j of due) counts.set(j, (counts.get(j) ?? 0) + 1);
    }
    // 2027-04-12 is a Monday through Sunday the 18th: 7 days.
    expect(Object.fromEntries(counts)).toEqual({ webhooks: 7 * 288, tranches: 7 * 96, "tranche-reconcile": 7 * 96, requirements: 7 * 96, passport: 7 * 24, mercury: 7 * 4, "org-changes": 7, "ledger-archive": 7, "digest-daily": 7, "digest-weekly": 1, "outside-deadlines": 7, "keep-reminders": 7 });
  });

  it("runs every job against an empty database without failing", async () => {
    const b = base();
    const all = new Set<JobName>();
    for (let t = Date.UTC(2027, 3, 19); t < Date.UTC(2027, 3, 20); t += 5 * 60_000) for (const j of jobsDue(new Date(t))) all.add(j);
    expect(all.size).toBe(12);
    for (const name of all) {
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
