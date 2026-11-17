// SPDX-License-Identifier: AGPL-3.0-only
// QuickBooks sync (v1.13.0, api/accounting.tsp): the mapping, the switch and the reconciliation view of
// a funder workspace. Record-keeping only: nothing here pays, schedules or moves money. Connecting
// QuickBooks is `/gms/connectors/quickbooks` (a workspace admin). Every write is a signed-in person's;
// the server refuses agent and API-client tokens.
//
// `createHttpAccountingApi` calls the GMS Worker; `createMockAccountingApi` (mocks/accounting.ts)
// implements the same interface in the browser.
import { ApiError } from "./client.ts";
import type { components } from "./schema.d.ts";

type S = components["schemas"];
export type QuickBooksRef = S["Models.QuickBooksRef"];
export type AccountingSync = S["Models.AccountingSync"];
export type AccountingOptions = S["Models.AccountingOptions"];
export type AccountingSettingsInput = S["Models.AccountingSettingsInput"];
export type AccountingVendors = S["Models.AccountingVendors"];
export type AccountingVendorsInput = S["Models.AccountingVendorsInput"];
export type AccountingEntry = S["Models.AccountingEntry"];
export type AccountingEntries = S["Models.AccountingEntries"];
export type AccountingItem = AccountingEntries["items"][number];
export type QuickBooksStatus = AccountingItem["quickbooks"]["status"];

export interface QuickBooksConnection {
  connected: boolean;
  status: string;
  connectUrl?: string | null;
}

export interface AccountingApi {
  sync(): Promise<AccountingSync>;
  /** Start (or finish) connecting QuickBooks: a Composio-hosted sign-in until it is connected. */
  connect(returnTo: string): Promise<QuickBooksConnection>;
  disconnect(): Promise<QuickBooksConnection>;
  options(): Promise<AccountingOptions>;
  saveSettings(input: AccountingSettingsInput): Promise<AccountingSync>;
  vendors(): Promise<AccountingVendors>;
  saveVendors(input: AccountingVendorsInput): Promise<AccountingVendors>;
  entries(compare?: boolean): Promise<AccountingEntries>;
  handled(entryId: string): Promise<AccountingEntry>;
  retry(entryId: string): Promise<AccountingEntry>;
}

export interface HttpAccountingOptions {
  baseUrl: string;
  token: () => Promise<string | null>;
  workspaceId: () => string | null;
  fetch?: typeof fetch;
}

export function createHttpAccountingApi(opts: HttpAccountingOptions): AccountingApi {
  const doFetch = opts.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const token = await opts.token();
    const workspaceId = opts.workspaceId();
    const res = await doFetch(`${opts.baseUrl}${path}`, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(workspaceId ? { "X-GMS-Workspace": workspaceId } : {}),
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as { message?: string; errors?: unknown[] };
      throw new ApiError(res.status, json.message ?? `Request failed (${res.status})`, json.errors ?? []);
    }
    return ((await res.json()) as { data?: T }).data as T;
  }
  return {
    sync: () => call("GET", "/gms/accounting"),
    connect: (returnTo) => call("POST", "/gms/connectors/quickbooks", { returnTo }),
    disconnect: () => call("DELETE", "/gms/connectors/quickbooks"),
    options: () => call("GET", "/gms/accounting/options"),
    saveSettings: (input) => call("PUT", "/gms/accounting/settings", input),
    vendors: () => call("GET", "/gms/accounting/vendors"),
    saveVendors: (input) => call("PUT", "/gms/accounting/vendors", input),
    entries: (compare) => call("GET", `/gms/accounting/entries${compare ? "?compare=true" : ""}`),
    handled: (id) => call("POST", `/gms/accounting/entries/${encodeURIComponent(id)}/handled`),
    retry: (id) => call("POST", `/gms/accounting/entries/${encodeURIComponent(id)}/retry`),
  };
}
