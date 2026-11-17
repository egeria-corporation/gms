// SPDX-License-Identifier: AGPL-3.0-only
// The template gallery port for a services object, with the same loading and error states as the
// other ports. Public pages use it signed out; in mock mode it shares the mock API, so a copied
// form opens in the form builder like any other.
import { useCallback, useEffect, useRef, useState, type DependencyList } from "react";
import { useServices, type Services } from "../app/services.tsx";
import { env } from "../env.ts";
import { createMockGalleryApi, seedGalleryStore, type GalleryStore } from "../mocks/gallery.ts";
import { createHttpGalleryApi, type GalleryApi } from "./gallery.ts";
import type { Mutation, Query, QueryState } from "./hooks.ts";

const ports = new WeakMap<object, GalleryApi>();
const mockStores = new WeakMap<object, GalleryStore>();

/** Replaces the port for a services object (tests). */
export function provideGalleryApi(services: Pick<Services, "auth">, api: GalleryApi): void {
  ports.set(services.auth, api);
}
/** Mock mode: the gallery store for a services object (tests and demos read it). */
export function mockGalleryStore(services: Pick<Services, "auth">): GalleryStore {
  let store = mockStores.get(services.auth);
  if (!store) mockStores.set(services.auth, (store = seedGalleryStore()));
  return store;
}

export function galleryApiFor(services: Pick<Services, "auth" | "mock" | "api">): GalleryApi {
  let api = ports.get(services.auth);
  if (!api) {
    api = services.mock
      ? createMockGalleryApi({ session: () => services.auth.getSession(), api: services.api, store: mockGalleryStore(services) })
      : createHttpGalleryApi({ baseUrl: env.apiBaseUrl, token: async () => (await services.auth.getSession())?.accessToken ?? null });
    ports.set(services.auth, api);
  }
  return api;
}

export function useGalleryApi(): GalleryApi {
  return galleryApiFor(useServices());
}

/** Runs `load` on mount and whenever `deps` change. A stale response never overwrites a newer one. */
export function useGalleryQuery<T>(load: (api: GalleryApi) => Promise<T>, deps: DependencyList): Query<T> {
  const api = useGalleryApi();
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

/** Wraps a write: `run` resolves to the result, or `undefined` when it failed (see `error`). */
export function useGalleryMutation<A extends unknown[], R>(write: (api: GalleryApi, ...args: A) => Promise<R>): Mutation<A, R> {
  const api = useGalleryApi();
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
