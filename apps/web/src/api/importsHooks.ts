// SPDX-License-Identifier: AGPL-3.0-only
// The import port for the current workspace, with the same loading and error states as the other
// ports. In mock mode imported applications land in the outside-applications store, so the
// Applications list shows them.
import { useCallback, useEffect, useRef, useState, type DependencyList } from "react";
import { useServices, type Services } from "../app/services.tsx";
import { useCurrentWorkspace } from "../app/workspace.tsx";
import { env } from "../env.ts";
import { createMockImportsApi, seedImportsStore, type ImportsStore } from "../mocks/imports.ts";
import { createMockOutsideApi } from "../mocks/outside.ts";
import { mockApplicantStore } from "./applicantHooks.ts";
import type { Mutation, Query, QueryState } from "./hooks.ts";
import { createHttpImportsApi, type ImportsApi } from "./imports.ts";
import { mockOutsideStore } from "./outsideHooks.ts";

type Current = { id: string; kind: "funder" | "applicant"; handle: string; role: string } | null;
const ports = new WeakMap<object, { api: ImportsApi; workspace: { current: Current } }>();
const mockStores = new WeakMap<object, ImportsStore>();

/** Replaces the port for a services object (tests). */
export function provideImportsApi(services: Pick<Services, "auth">, api: ImportsApi): void {
  ports.set(services.auth, { api, workspace: { current: null } });
}
/** Mock mode: the import store for a services object (tests and demos read it). */
export function mockImportsStore(services: Pick<Services, "auth">): ImportsStore {
  let store = mockStores.get(services.auth);
  if (!store) mockStores.set(services.auth, (store = seedImportsStore()));
  return store;
}

function portFor(services: Pick<Services, "auth" | "mock">) {
  let port = ports.get(services.auth);
  if (!port) {
    const workspace = { current: null as Current };
    const session = () => services.auth.getSession();
    const api = services.mock
      ? createMockImportsApi({ session, store: mockImportsStore(services), workspace: () => workspace.current, outside: createMockOutsideApi({ session, applicant: mockApplicantStore(services), store: mockOutsideStore(services) }), outsideStore: mockOutsideStore(services) })
      : createHttpImportsApi({ baseUrl: env.apiBaseUrl, token: async () => (await session())?.accessToken ?? null, workspaceId: () => workspace.current?.id ?? null });
    port = { api, workspace };
    ports.set(services.auth, port);
  }
  return port;
}

export function useImportsApi(): ImportsApi {
  const services = useServices();
  const ws = useCurrentWorkspace();
  const port = portFor(services);
  port.workspace.current = ws ? { id: ws.id, kind: ws.kind, handle: ws.handle, role: ws.member.role ?? "admin" } : null;
  return port.api;
}

/** Runs `load` on mount and whenever `deps` change. A stale response never overwrites a newer one. */
export function useImportsQuery<T>(load: (api: ImportsApi) => Promise<T>, deps: DependencyList): Query<T> {
  const api = useImportsApi();
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
export function useImportsMutation<A extends unknown[], R>(write: (api: ImportsApi, ...args: A) => Promise<R>): Mutation<A, R> {
  const api = useImportsApi();
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
