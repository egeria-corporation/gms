// SPDX-License-Identifier: AGPL-3.0-only
// The report builder's port for the current funder workspace, with the same loading and error
// states as the other ports. In mock mode the views, schedules and files live in the page.
import { useCallback, useEffect, useRef, useState, type DependencyList } from "react";
import { useServices, type Services } from "../app/services.tsx";
import { useCurrentWorkspace } from "../app/workspace.tsx";
import { env } from "../env.ts";
import { createMockReportsApi, seedReportsStore, type ReportsStore } from "../mocks/reports.ts";
import type { Mutation, Query, QueryState } from "./hooks.ts";
import { createHttpReportsApi, type ReportsApi } from "./reports.ts";

const ports = new WeakMap<object, { api: ReportsApi; workspace: { id: string | null } }>();
const mockStores = new WeakMap<object, ReportsStore>();

/** Replaces the port for a services object (tests). */
export function provideReportsApi(services: Pick<Services, "auth">, api: ReportsApi): void {
  ports.set(services.auth, { api, workspace: { id: null } });
}
/** Mock mode: the report builder's store for a services object (tests and demos read it). */
export function mockReportsStore(services: Pick<Services, "auth">): ReportsStore {
  let store = mockStores.get(services.auth);
  if (!store) mockStores.set(services.auth, (store = seedReportsStore()));
  return store;
}

function portFor(services: Pick<Services, "auth" | "mock">) {
  let port = ports.get(services.auth);
  if (!port) {
    const workspace = { id: null as string | null };
    const api = services.mock ? createMockReportsApi({ store: mockReportsStore(services) }) : createHttpReportsApi({ baseUrl: env.apiBaseUrl, token: async () => (await services.auth.getSession())?.accessToken ?? null, workspaceId: () => workspace.id });
    port = { api, workspace };
    ports.set(services.auth, port);
  }
  return port;
}

export function useReportsApi(): ReportsApi {
  const services = useServices();
  const workspace = useCurrentWorkspace();
  const port = portFor(services);
  if (workspace?.kind === "funder") port.workspace.id = workspace.id;
  return port.api;
}

/** Runs `load` on mount and whenever `deps` change. A stale response never overwrites a newer one. */
export function useReportsQuery<T>(load: (api: ReportsApi) => Promise<T>, deps: DependencyList): Query<T> {
  const api = useReportsApi();
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
export function useReportsMutation<A extends unknown[], R>(write: (api: ReportsApi, ...args: A) => Promise<R>): Mutation<A, R> {
  const api = useReportsApi();
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
