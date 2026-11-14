// SPDX-License-Identifier: AGPL-3.0-only
// The outside-applications port for the current applicant workspace, with the same loading and
// error states the other screens get from api/hooks.ts. In mock mode it shares the applicant
// mock's store, so the pipeline lists the built-in applications beside the outside ones.
import { useCallback, useEffect, useRef, useState, type DependencyList } from "react";
import { useServices, type Services } from "../app/services.tsx";
import { useCurrentWorkspace } from "../app/workspace.tsx";
import { env } from "../env.ts";
import { createMockOutsideApi, seedOutsideStore, type OutsideStore } from "../mocks/outside.ts";
import { mockApplicantStore } from "./applicantHooks.ts";
import type { Mutation, Query, QueryState } from "./hooks.ts";
import { createHttpOutsideApi, type OutsideApi } from "./outside.ts";

const ports = new WeakMap<object, { api: OutsideApi; workspace: { id: string | null } }>();
const mockStores = new WeakMap<object, OutsideStore>();

/** Replaces the port for a services object (tests). */
export function provideOutsideApi(services: Pick<Services, "auth">, api: OutsideApi): void {
  ports.set(services.auth, { api, workspace: { id: null } });
}
/** Mock mode: the outside store for a services object (tests and demos read it). */
export function mockOutsideStore(services: Pick<Services, "auth">): OutsideStore {
  let store = mockStores.get(services.auth);
  if (!store) mockStores.set(services.auth, (store = seedOutsideStore()));
  return store;
}

function portFor(services: Pick<Services, "auth" | "mock">) {
  let port = ports.get(services.auth);
  if (!port) {
    const workspace = { id: null as string | null };
    const api = services.mock
      ? createMockOutsideApi({ session: () => services.auth.getSession(), applicant: mockApplicantStore(services), store: mockOutsideStore(services) })
      : createHttpOutsideApi({ baseUrl: env.apiBaseUrl, token: async () => (await services.auth.getSession())?.accessToken ?? null, workspaceId: () => workspace.id });
    port = { api, workspace };
    ports.set(services.auth, port);
  }
  return port;
}

export function useOutsideApi(): OutsideApi {
  const services = useServices();
  const workspace = useCurrentWorkspace();
  const port = portFor(services);
  if (workspace?.kind === "applicant") port.workspace.id = workspace.id;
  return port.api;
}

/** Runs `load` on mount and whenever `deps` change. A stale response never overwrites a newer one. */
export function useOutsideQuery<T>(load: (api: OutsideApi) => Promise<T>, deps: DependencyList): Query<T> {
  const api = useOutsideApi();
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
export function useOutsideMutation<A extends unknown[], R>(write: (api: OutsideApi, ...args: A) => Promise<R>): Mutation<A, R> {
  const api = useOutsideApi();
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
        const result = await writer.current(api, ...args);
        if (live.current) setState("saved");
        return result;
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
