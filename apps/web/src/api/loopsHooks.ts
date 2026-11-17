// SPDX-License-Identifier: AGPL-3.0-only
// The funder loops port for a services object, with the same loading and error states as the other
// ports. Public pages use it signed out; in mock mode it reads the mock API's memberships and funds.
import { useCallback, useEffect, useRef, useState, type DependencyList } from "react";
import { useServices, type Services } from "../app/services.tsx";
import { env } from "../env.ts";
import { createMockLoopsApi, seedLoopsStore, type LoopsStore } from "../mocks/loops.ts";
import type { Mutation, Query, QueryState } from "./hooks.ts";
import { createHttpLoopsApi, type LoopsApi } from "./loops.ts";

const ports = new WeakMap<object, LoopsApi>();
const mockStores = new WeakMap<object, LoopsStore>();

/** Replaces the port for a services object (tests). */
export function provideLoopsApi(services: Pick<Services, "auth">, api: LoopsApi): void {
  ports.set(services.auth, api);
}
/** Mock mode: the loops store for a services object (tests read it). */
export function mockLoopsStore(services: Pick<Services, "auth">): LoopsStore {
  let store = mockStores.get(services.auth);
  if (!store) mockStores.set(services.auth, (store = seedLoopsStore()));
  return store;
}

export function loopsApiFor(services: Pick<Services, "auth" | "mock" | "api">): LoopsApi {
  let api = ports.get(services.auth);
  if (!api) {
    api = services.mock
      ? createMockLoopsApi({ session: () => services.auth.getSession(), api: services.api, store: mockLoopsStore(services) })
      : createHttpLoopsApi({ baseUrl: env.apiBaseUrl, token: async () => (await services.auth.getSession())?.accessToken ?? null });
    ports.set(services.auth, api);
  }
  return api;
}

export function useLoopsApi(): LoopsApi {
  return loopsApiFor(useServices());
}

/** Runs `load` on mount and whenever `deps` change. A stale response never overwrites a newer one. */
export function useLoopsQuery<T>(load: (api: LoopsApi) => Promise<T>, deps: DependencyList): Query<T> {
  const api = useLoopsApi();
  const [state, setState] = useState<QueryState<T>>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const loader = useRef(load);
  loader.current = load;
  useEffect(() => {
    let live = true;
    setState((prev) => (prev.status === "ready" ? prev : { status: "loading" }));
    loader.current(api).then(
      (data) => live && setState({ status: "ready", data }),
      (error: unknown) => live && setState({ status: "error", error }),
    );
    return () => {
      live = false;
    };
  }, [api, attempt, ...deps]);
  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  const set = useCallback((data: T) => setState({ status: "ready", data }), []);
  return { ...state, reload, set };
}

/** Wraps a write: `run` resolves to the result, or `undefined` when it failed (the error is kept on `error`). */
export function useLoopsMutation<A extends unknown[], R>(write: (api: LoopsApi, ...args: A) => Promise<R>): Mutation<A, R> {
  const api = useLoopsApi();
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<unknown>(null);
  const writer = useRef(write);
  writer.current = write;
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const run = useCallback(
    async (...args: A) => {
      setState("saving");
      setError(null);
      try {
        const out = await writer.current(api, ...args);
        if (live.current) setState("saved");
        return out;
      } catch (e) {
        if (live.current) {
          setError(e);
          setState("idle");
        }
        return undefined;
      }
    },
    [api],
  );
  const reset = useCallback(() => {
    setState("idle");
    setError(null);
  }, []);
  return { run, state, error, reset };
}
