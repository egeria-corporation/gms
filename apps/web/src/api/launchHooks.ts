// SPDX-License-Identifier: AGPL-3.0-only
// The launch port (api/launch.ts) for the current workspace, with the same loading and error
// states the other screens get from api/hooks.ts.
import { useCallback, useEffect, useRef, useState, type DependencyList } from "react";
import { useServices, type Services } from "../app/services.tsx";
import { useCurrentWorkspace } from "../app/workspace.tsx";
import { env } from "../env.ts";
import { createMockLaunchApi, seedLaunchStore, type LaunchStore } from "../mocks/launch.ts";
import type { Mutation, Query, QueryState } from "./hooks.ts";
import { createHttpLaunchApi, PASSPORT_OFF, type AppConfig, type LaunchApi, type PassportFlags } from "./launch.ts";

interface Port {
  api: LaunchApi;
  workspace: { id: string | null };
  /** The mock's data, when the port is the mock (tests reach in to set a scene). */
  store: LaunchStore | null;
}
const ports = new WeakMap<object, Port>();

/** Replaces the port for a services object (tests, the styleguide). */
export function provideLaunchApi(services: Pick<Services, "auth">, api: LaunchApi, store: LaunchStore | null = null): void {
  ports.set(services.auth, { api, workspace: { id: null }, store });
}

function portFor(services: Pick<Services, "auth" | "mock">): Port {
  let port = ports.get(services.auth);
  if (!port) {
    const workspace = { id: null as string | null };
    if (services.mock) {
      const store = seedLaunchStore();
      port = { api: createMockLaunchApi({ session: () => services.auth.getSession(), store }), workspace, store };
    } else {
      port = { api: createHttpLaunchApi({ baseUrl: env.apiBaseUrl, token: async () => (await services.auth.getSession())?.accessToken ?? null, workspaceId: () => workspace.id }), workspace, store: null };
    }
    ports.set(services.auth, port);
  }
  return port;
}

/** The mock launch data behind a services object; null when the port is the real API. */
export function mockLaunchStore(services: Pick<Services, "auth" | "mock">): LaunchStore | null {
  return portFor(services).store;
}

export function useLaunchApi(): LaunchApi {
  const services = useServices();
  const workspace = useCurrentWorkspace();
  const port = portFor(services);
  if (workspace) port.workspace.id = workspace.id;
  return port.api;
}

/** Runs `load` on mount and whenever `deps` change. A stale response never overwrites a newer one. */
export function useLaunchQuery<T>(load: (api: LaunchApi) => Promise<T>, deps: DependencyList): Query<T> {
  const api = useLaunchApi();
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
export function useLaunchMutation<A extends unknown[], R>(write: (api: LaunchApi, ...args: A) => Promise<R>): Mutation<A, R> {
  const api = useLaunchApi();
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

/**
 * Install-wide switches. While loading, and if the read fails, payments through Passport count
 * as off: the screens then offer only what is always safe (recording a payment made elsewhere).
 */
export function useAppConfig(): AppConfig {
  const q = useLaunchQuery((api) => api.config(), []);
  return q.status === "ready" ? q.data : { facilitatedPayments: false };
}

/** Passport switches. All off until the server has answered, so nothing flashes up and vanishes. */
export function usePassportFlags(): PassportFlags & { ready: boolean } {
  const q = useLaunchQuery((api) => api.config(), []);
  if (q.status !== "ready") return { ...PASSPORT_OFF, ready: q.status === "error" };
  return { ...(q.data.passport ?? PASSPORT_OFF), ready: true };
}
