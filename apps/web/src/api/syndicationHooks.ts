// SPDX-License-Identifier: AGPL-3.0-only
// The "Share this call" port for the current funder workspace, with the same loading and error
// states as the other ports. In mock mode it reads the opportunity from the main mock API, so the
// panel shows what the builder saved.
import { useCallback, useEffect, useRef, useState, type DependencyList } from "react";
import { useServices, type Services } from "../app/services.tsx";
import { useCurrentWorkspace } from "../app/workspace.tsx";
import { env } from "../env.ts";
import { createMockSyndicationApi, seedSyndicationStore, type SyndicationStore } from "../mocks/syndication.ts";
import type { Mutation, Query, QueryState } from "./hooks.ts";
import { createHttpSyndicationApi, type SyndicationApi } from "./syndication.ts";

type Current = { id: string; handle: string; name: string; role: string } | null;
const ports = new WeakMap<object, { api: SyndicationApi; workspace: { current: Current } }>();
const mockStores = new WeakMap<object, SyndicationStore>();

/** Replaces the port for a services object (tests). */
export function provideSyndicationApi(services: Pick<Services, "auth">, api: SyndicationApi): void {
  ports.set(services.auth, { api, workspace: { current: null } });
}

/** Mock mode: the syndication store for a services object (tests read it). */
export function mockSyndicationStore(services: Pick<Services, "auth">): SyndicationStore {
  let store = mockStores.get(services.auth);
  if (!store) mockStores.set(services.auth, (store = seedSyndicationStore()));
  return store;
}

function portFor(services: Pick<Services, "auth" | "mock" | "api">) {
  let port = ports.get(services.auth);
  if (!port) {
    const workspace = { current: null as Current };
    const session = () => services.auth.getSession();
    const api = services.mock
      ? createMockSyndicationApi({ session, store: mockSyndicationStore(services), workspace: () => workspace.current, getOpportunity: (id) => services.api.getOpportunity(id) })
      : createHttpSyndicationApi({ baseUrl: env.apiBaseUrl, token: async () => (await session())?.accessToken ?? null, workspaceId: () => workspace.current?.id ?? null });
    port = { api, workspace };
    ports.set(services.auth, port);
  }
  return port;
}

export function useSyndicationApi(): SyndicationApi {
  const services = useServices();
  const ws = useCurrentWorkspace();
  const port = portFor(services);
  if (ws?.kind === "funder") port.workspace.current = { id: ws.id, handle: ws.handle, name: ws.name, role: ws.member.role ?? "admin" };
  return port.api;
}

/** Runs `load` on mount and whenever `deps` change. A stale response never overwrites a newer one. */
export function useSyndicationQuery<T>(load: (api: SyndicationApi) => Promise<T>, deps: DependencyList): Query<T> {
  const api = useSyndicationApi();
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
export function useSyndicationMutation<A extends unknown[], R>(write: (api: SyndicationApi, ...args: A) => Promise<R>): Mutation<A, R> {
  const api = useSyndicationApi();
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
