// @vitest-environment node
// SPDX-License-Identifier: AGPL-3.0-only
// The QuickBooks sync routes (api/accounting.ts), one scenario on two backends: the web HTTP client
// against the real API Worker in-process (with the QuickBooks fixture), and the in-browser mock. The
// assertions are the fields the Accounting screen and the "In QuickBooks" badge read, so a path,
// verb, body field or response shape that drifts fails here.
import { beforeAll, describe, expect, it } from "vitest";
import { createHttpAccountingApi, type AccountingApi } from "../src/api/accounting.ts";
import { createMockAccountingApi, seedAccountingStore } from "../src/mocks/accounting.ts";
import { createMockApi } from "../src/mocks/api.ts";
import { demoSession } from "../src/mocks/auth.ts";
import { seedStore } from "../src/mocks/store.ts";
import { loadApi } from "./api-harness.ts";

async function realBackend(): Promise<AccountingApi> {
  const helpers = await loadApi();
  const h = await helpers.harness();
  const { FixtureQuickBooksBooks } = (await import(/* @vite-ignore */ new URL("../../../packages/connectors/src/index.ts", import.meta.url).href)) as { FixtureQuickBooksBooks: new () => unknown };
  Object.assign((h as unknown as { extraPorts: Record<string, unknown> }).extraPorts, { quickbooks: new FixtureQuickBooksBooks() });
  await h.repos.table("programs").insert({ workspace_id: helpers.WS_FUNDER, name: "Community health" });
  return createHttpAccountingApi({
    baseUrl: helpers.BASE,
    token: async () => h.session(helpers.USER_ADMIN),
    workspaceId: () => helpers.WS_FUNDER,
    fetch: async (input, init) => {
      const req = input instanceof Request ? input : new Request(input, init);
      const u = new URL(req.url);
      const body = req.method === "GET" ? undefined : await req.text();
      return h.request(u.pathname + u.search, { method: req.method, headers: req.headers, ...(body !== undefined ? { body } : {}) });
    },
  });
}

async function mockBackend(): Promise<AccountingApi> {
  const api = createMockApi({ session: async () => demoSession(), store: seedStore() });
  const ws = await api.workspace("riverbend");
  return createMockAccountingApi({ store: seedAccountingStore(), workspace: () => ws.id, tranches: () => api.listTranches(), programs: () => api.listPrograms() });
}

describe.each([
  ["the real API", realBackend],
  ["the mock", mockBackend],
])("QuickBooks sync against %s", (_name, build) => {
  let api: AccountingApi;
  beforeAll(async () => {
    api = await build();
  });

  it("connects, lists QuickBooks' records, saves the mapping and turns the sync on", async () => {
    expect(await api.connect("/w/riverbend/settings/accounting")).toMatchObject({ connected: true });
    const sync = await api.sync();
    expect(sync).toMatchObject({ configured: true, connected: true, settings: { syncEnabled: false, tracking: "none", vendorPolicy: "create", currency: "USD" } });
    expect(sync.programs.length).toBeGreaterThan(0);
    const options = await api.options();
    expect(options.expenseAccounts[0]).toEqual({ id: expect.stringMatching(/^\d+$/), name: expect.any(String) });
    expect(options.bankAccounts.length).toBeGreaterThan(0);
    expect(options.classes.length).toBeGreaterThan(0);
    const program = sync.programs[0]!.programId;
    const saved = await api.saveSettings({ expenseId: options.expenseAccounts[0]!.id, paidFromId: options.bankAccounts[0]!.id, tracking: "class", programs: { [program]: options.classes[0]!.id }, vendorPolicy: "create", syncEnabled: true });
    expect(saved.settings).toMatchObject({ expense: options.expenseAccounts[0], paidFrom: options.bankAccounts[0], tracking: "class", syncEnabled: true, syncFrom: expect.any(String) });
    expect(saved.programs.find((p) => p.programId === program)?.ref).toEqual(options.classes[0]);
  });

  it("reads the vendors and the reconciliation view", async () => {
    const v = await api.vendors();
    expect(v).toMatchObject({ vendorPolicy: "create", vendors: expect.any(Array), grantees: expect.any(Array) });
    const entries = await api.entries();
    expect(entries).toMatchObject({ syncEnabled: true, items: expect.any(Array) });
    for (const i of entries.items) expect(["posting", "posted", "needs_attention", "failed", "handled", "waiting", "not_synced"]).toContain(i.quickbooks.status);
  });

  it("disconnects, which turns the sync off", async () => {
    expect(await api.disconnect()).toMatchObject({ connected: false });
    expect((await api.sync()).settings.syncEnabled).toBe(false);
  });
});
