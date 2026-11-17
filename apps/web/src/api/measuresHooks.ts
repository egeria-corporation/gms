// SPDX-License-Identifier: AGPL-3.0-only
// The operators' measures port for a services object, with the same loading and error states as
// the other ports. In mock mode it keeps its own store for the services object.
import type { DependencyList } from "react";
import { useServices, type Services } from "../app/services.tsx";
import { env } from "../env.ts";
import { createMockMeasuresApi, seedMeasuresStore, type MeasuresStore } from "../mocks/measures.ts";
import { useApiMutation, useApiQuery, type Mutation, type Query } from "./hooks.ts";
import { createHttpMeasuresApi, type MeasuresApi } from "./measures.ts";

const ports = new WeakMap<object, MeasuresApi>();
const mockStores = new WeakMap<object, MeasuresStore>();

/** Replaces the port for a services object (tests). */
export function provideMeasuresApi(services: Pick<Services, "auth">, api: MeasuresApi): void {
  ports.set(services.auth, api);
}
/** Mock mode: the measures store for a services object (tests read it). */
export function mockMeasuresStore(services: Pick<Services, "auth">): MeasuresStore {
  let store = mockStores.get(services.auth);
  if (!store) mockStores.set(services.auth, (store = seedMeasuresStore()));
  return store;
}

function portFor(services: Services): MeasuresApi {
  let api = ports.get(services.auth);
  if (!api) {
    api = services.mock
      ? createMockMeasuresApi({ store: mockMeasuresStore(services), email: async () => (await services.auth.getSession())?.email ?? null })
      : createHttpMeasuresApi({ baseUrl: env.apiBaseUrl, token: async () => (await services.auth.getSession())?.accessToken ?? null });
    ports.set(services.auth, api);
  }
  return api;
}

export function useMeasuresApi(): MeasuresApi {
  return portFor(useServices());
}

/** Runs `load` on mount and whenever `deps` change, with the loading and error states of `useApiQuery`. */
export function useMeasuresQuery<T>(load: (api: MeasuresApi) => Promise<T>, deps: DependencyList): Query<T> {
  const api = useMeasuresApi();
  return useApiQuery(() => load(api), [api, ...deps]);
}

/** Wraps a write: `run` resolves to the result, or `undefined` when it failed (see `error`). */
export function useMeasuresMutation<A extends unknown[], R>(write: (api: MeasuresApi, ...args: A) => Promise<R>): Mutation<A, R> {
  const api = useMeasuresApi();
  return useApiMutation((_gms, ...args: A) => write(api, ...args));
}
