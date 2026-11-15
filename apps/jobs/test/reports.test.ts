// SPDX-License-Identifier: AGPL-3.0-only
// The scheduled reports hook of the jobs Worker: it writes a due view's CSV to EXPORTS and mails
// its recipients, logs counts only, and never throws into the rest of the tick.
import { MemoryRepos, type BaseContext } from "@gms/api/jobs";
import { MemoryLedgerStore } from "@gms/ledger";
import { MemoryMailer } from "@gms/notify";
import { MemoryWebhookStore } from "@gms/webhooks";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runScheduledReports } from "../src/reports.ts";

const FUNDER = "11111111-1111-4111-8111-111111111111";
const OWNER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function bucket() {
  const objects = new Map<string, string>();
  return { objects, put: async (k: string, v: string) => void objects.set(k, v), get: async (k: string) => (objects.has(k) ? { body: new Response(objects.get(k)!).body! } : null), delete: async (k: string) => void objects.delete(k) };
}

const logs = () => {
  const lines: Record<string, unknown>[] = [];
  vi.spyOn(console, "warn").mockImplementation((l: string) => void lines.push(JSON.parse(l)));
  vi.spyOn(console, "error").mockImplementation((l: string) => void lines.push(JSON.parse(l)));
  return lines;
};
afterEach(() => vi.restoreAllMocks());

async function seeded(now: Date) {
  const repos = new MemoryRepos(() => now);
  await repos.table("workspaces").insert({ id: FUNDER, kind: "funder", handle: "riverbend", display_name: "Riverbend Community Foundation" });
  await repos.table("workspace_members").insert({ workspace_id: FUNDER, user_id: OWNER, role: "program_officer" });
  await repos.table("awards").insert({ workspace_id: FUNDER, title: "Clinic navigators", status: "active", funding: { awardedAmount: { amount: "1500.00", currency: "USD" } } });
  const view = await repos.table("report_views").insert({ workspace_id: FUNDER, name: "Awards", description: null, data_set: "awards", definition: { dataSet: "awards", columns: ["title", "amount"], filters: [], groupBy: [], aggregates: [], sort: [] }, visibility: "workspace", owner_user_id: OWNER });
  await repos.table("report_schedules").insert({ workspace_id: FUNDER, view_id: view.id, cadence: "monthly", weekday: null, day_of_month: 1, recipient_user_ids: [OWNER], created_by: OWNER, starts_at: "2027-04-16T17:00:00Z", active: true, stopped_reason: null, last_period: null, last_sent_at: null });
  return repos;
}

describe("scheduled reports hook", () => {
  it("writes the file to EXPORTS and mails a link", async () => {
    const lines = logs();
    const now = new Date("2027-05-01T13:05:00Z");
    const mailer = new MemoryMailer();
    const base: BaseContext = { repos: await seeded(now), ledger: new MemoryLedgerStore(), webhooks: new MemoryWebhookStore(), now: () => now, config: { baseUrl: "https://gms.test", webBaseUrl: "https://app.gms.test", passportBaseUrl: null, credentialsKey: null, passportClient: null, mailFrom: "OpenGrants GMS <notices@gms.test>" }, ports: { mailer, directory: { lookup: async (ids) => new Map(ids.map((id) => [id, { email: "dana@riverbend.example", name: "Dana" }])) } } };
    const exports = bucket();
    await runScheduledReports(base, { EXPORTS: exports as unknown as R2Bucket });
    expect([...exports.objects.keys()]).toEqual([expect.stringMatching(new RegExp(`^exports/${FUNDER}/reports/[0-9a-f-]{36}/2027-05\\.csv$`))]);
    expect(mailer.sent.map((m) => m.to)).toEqual([["dana@riverbend.example"]]);
    expect(lines).toEqual([expect.objectContaining({ msg: "job.done", job: "reports", sent: 1, emails: 1 })]);
    // Counts only in the log line.
    expect(JSON.stringify(lines)).not.toContain("dana@riverbend.example");
    // The next tick of the same period sends nothing.
    await runScheduledReports(base, { EXPORTS: exports as unknown as R2Bucket });
    expect(mailer.sent.length).toBe(1);
  });

  it("says why it did nothing, and never throws into the tick", async () => {
    const lines = logs();
    const now = new Date("2027-05-01T13:05:00Z");
    const base: BaseContext = { repos: await seeded(now), ledger: new MemoryLedgerStore(), webhooks: new MemoryWebhookStore(), now: () => now, config: { baseUrl: "https://gms.test", webBaseUrl: "https://app.gms.test", passportBaseUrl: null, credentialsKey: null, passportClient: null, mailFrom: null }, ports: {} };
    await runScheduledReports(base, {});
    expect(lines[0]).toMatchObject({ msg: "job.done", reason: "EXPORTS is not bound" });
    const broken = { ...base, repos: { table: () => { throw new Error("database down"); } } } as unknown as BaseContext;
    await expect(runScheduledReports(broken, { EXPORTS: bucket() as unknown as R2Bucket })).resolves.toBeUndefined();
    expect(lines[1]).toMatchObject({ msg: "job.failed", job: "reports", error: "Error" });
  });
});
