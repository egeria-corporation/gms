// SPDX-License-Identifier: AGPL-3.0-only
// The QuickBooks sync port for the current workspace, with the same loading and error states as the
// other ports. In mock mode it keeps its own store for the services object and reads the mock's
// payments and programs, so a payment recorded in the Payments center is "posted" at once.
import type { DependencyList } from "react";
import { useServices, type Services } from "../app/services.tsx";
import { useCurrentWorkspace } from "../app/workspace.tsx";
import { env } from "../env.ts";
import { createMockAccountingApi, seedAccountingStore, type AccountingStore } from "../mocks/accounting.ts";
import { createHttpAccountingApi, type AccountingApi, type QuickBooksStatus } from "./accounting.ts";
import { useApiMutation, useApiQuery, type Mutation, type Query } from "./hooks.ts";

type Current = { id: string | null; role: string };
const ports = new WeakMap<object, { api: AccountingApi; workspace: Current }>();
const mockStores = new WeakMap<object, AccountingStore>();

/** Mock mode: the accounting store for a services object (tests read it). */
export function mockAccountingStore(services: Pick<Services, "auth">): AccountingStore {
  let store = mockStores.get(services.auth);
  if (!store) mockStores.set(services.auth, (store = seedAccountingStore()));
  return store;
}

function portFor(services: Services) {
  let port = ports.get(services.auth);
  if (!port) {
    const workspace: Current = { id: null, role: "admin" };
    const api = services.mock
      ? createMockAccountingApi({ store: mockAccountingStore(services), workspace: () => workspace.id, tranches: () => services.api.listTranches(), programs: () => services.api.listPrograms() })
      : createHttpAccountingApi({ baseUrl: env.apiBaseUrl, token: async () => (await services.auth.getSession())?.accessToken ?? null, workspaceId: () => workspace.id });
    port = { api, workspace };
    ports.set(services.auth, port);
  }
  return port;
}

export function useAccountingApi(): AccountingApi {
  const services = useServices();
  const current = useCurrentWorkspace();
  const port = portFor(services);
  if (current) {
    port.workspace.id = current.id;
    port.workspace.role = current.member.role ?? "admin";
  }
  return port.api;
}

export function useAccountingQuery<T>(load: (api: AccountingApi) => Promise<T>, deps: DependencyList): Query<T> {
  const api = useAccountingApi();
  return useApiQuery(() => load(api), [api, ...deps]);
}

export function useAccountingMutation<A extends unknown[], R>(write: (api: AccountingApi, ...args: A) => Promise<R>): Mutation<A, R> {
  const api = useAccountingApi();
  return useApiMutation((_gms, ...args: A) => write(api, ...args));
}

/**
 * Each payment's QuickBooks status, by tranche id, for the "In QuickBooks" badges. One request per
 * page however many badges it shows: the answer is shared for a few seconds.
 */
const shared = new WeakMap<AccountingApi, { at: number; key: string; value: Promise<Map<string, QuickBooksStatus>> }>();
export function quickBooksStatuses(api: AccountingApi, key: string): Promise<Map<string, QuickBooksStatus>> {
  const hit = shared.get(api);
  if (hit && hit.key === key && Date.now() - hit.at < 3000) return hit.value;
  const value = api.entries().then((r) => new Map(r.items.flatMap((i) => (i.payment ? [[i.payment.trancheId, i.quickbooks.status] as const] : []))));
  shared.set(api, { at: Date.now(), key, value });
  return value;
}
