// SPDX-License-Identifier: AGPL-3.0-only
// The content digests port (api/digests.ts) for the app, with the same loading and error states as
// the other ports. Every call names its workspace, so the Notifications page can switch workspace
// without leaving the screen. In mock mode the choices live in the page.
import { useCallback, useEffect, useRef, useState, type DependencyList } from "react";
import { useServices, type Services } from "../app/services.tsx";
import { env } from "../env.ts";
import { createMockDigestsApi, seedDigestsStore } from "../mocks/digests.ts";
import { createHttpDigestsApi, type DigestsApi } from "./digests.ts";
import type { Query, QueryState } from "./hooks.ts";

const ports = new WeakMap<object, DigestsApi>();

/** Replaces the port for a services object (tests). */
export function provideDigestsApi(services: Pick<Services, "auth">, api: DigestsApi): void {
  ports.set(services.auth, api);
}

function portFor(services: Pick<Services, "auth" | "mock">): DigestsApi {
  let api = ports.get(services.auth);
  if (!api) {
    api = services.mock ? createMockDigestsApi({ session: () => services.auth.getSession(), store: seedDigestsStore() }) : createHttpDigestsApi({ baseUrl: env.apiBaseUrl, token: async () => (await services.auth.getSession())?.accessToken ?? null });
    ports.set(services.auth, api);
  }
  return api;
}

export function useDigestsApi(): DigestsApi {
  return portFor(useServices());
}

/** Runs `load` on mount and whenever `deps` change. A stale response never overwrites a newer one. */
export function useDigestsQuery<T>(load: (api: DigestsApi) => Promise<T>, deps: DependencyList): Query<T> {
  const api = useDigestsApi();
  const [state, setState] = useState<QueryState<T>>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const loader = useRef(load);
  loader.current = load;

  useEffect(() => {
    let live = true;
    setState({ status: "loading" });
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
