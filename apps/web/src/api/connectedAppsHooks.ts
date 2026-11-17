// SPDX-License-Identifier: AGPL-3.0-only
// The connected-apps port for the current workspace, with the same loading and error states as the
// other ports. In mock mode it keeps its own store for the services object.
import type { DependencyList } from "react";
import { useServices, type Services } from "../app/services.tsx";
import { useCurrentWorkspace } from "../app/workspace.tsx";
import { env } from "../env.ts";
import { createMockConnectedAppsApi, seedConnectedAppsStore, type ConnectedAppsStore } from "../mocks/connectedApps.ts";
import { createHttpConnectedAppsApi, type ConnectedAppsApi } from "./connectedApps.ts";
import { useApiMutation, useApiQuery, type Mutation, type Query } from "./hooks.ts";

type Current = { id: string | null; kind: "funder" | "applicant"; role: string };
const ports = new WeakMap<object, { api: ConnectedAppsApi; workspace: Current }>();
const mockStores = new WeakMap<object, ConnectedAppsStore>();

/** Replaces the port for a services object (tests). */
export function provideConnectedAppsApi(services: Pick<Services, "auth">, api: ConnectedAppsApi): void {
  ports.set(services.auth, { api, workspace: { id: null, kind: "funder", role: "admin" } });
}
/** Mock mode: the connected-apps store for a services object (tests read it). */
export function mockConnectedAppsStore(services: Pick<Services, "auth">): ConnectedAppsStore {
  let store = mockStores.get(services.auth);
  if (!store) mockStores.set(services.auth, (store = seedConnectedAppsStore()));
  return store;
}

function portFor(services: Services) {
  let port = ports.get(services.auth);
  if (!port) {
    const workspace: Current = { id: null, kind: "funder", role: "admin" };
    const api = services.mock
      ? createMockConnectedAppsApi({
          store: mockConnectedAppsStore(services),
          workspace: () => (workspace.id ? { id: workspace.id, kind: workspace.kind, role: workspace.role } : null),
          person: async () => (await services.auth.getSession())?.email ?? null,
        })
      : createHttpConnectedAppsApi({ baseUrl: env.apiBaseUrl, token: async () => (await services.auth.getSession())?.accessToken ?? null, workspaceId: () => workspace.id });
    port = { api, workspace };
    ports.set(services.auth, port);
  }
  return port;
}

export function useConnectedAppsApi(): ConnectedAppsApi {
  const services = useServices();
  const current = useCurrentWorkspace();
  const port = portFor(services);
  if (current) {
    port.workspace.id = current.id;
    port.workspace.kind = current.kind;
    port.workspace.role = current.member.role ?? "admin";
  }
  return port.api;
}

/** Runs `load` on mount and whenever `deps` change, with the loading and error states of `useApiQuery`. */
export function useConnectedAppsQuery<T>(load: (api: ConnectedAppsApi) => Promise<T>, deps: DependencyList): Query<T> {
  const api = useConnectedAppsApi();
  return useApiQuery(() => load(api), [api, ...deps]);
}

/** Wraps a write: `run` resolves to the result, or `undefined` when it failed (see `error`). */
export function useConnectedAppsMutation<A extends unknown[], R>(write: (api: ConnectedAppsApi, ...args: A) => Promise<R>): Mutation<A, R> {
  const api = useConnectedAppsApi();
  return useApiMutation((_gms, ...args: A) => write(api, ...args));
}
