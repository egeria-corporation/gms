// SPDX-License-Identifier: AGPL-3.0-only
// The write-and-keep port for the current applicant workspace, with the same loading and error
// states as the other ports. In mock mode it shares the outside-applications store, the applicant
// store and the assistant's quota, so a draft, an award and the funding summary tell one story.
import { useCallback, useEffect, useRef, useState, type DependencyList } from "react";
import { useServices, type Services } from "../app/services.tsx";
import { useCurrentWorkspace } from "../app/workspace.tsx";
import { env } from "../env.ts";
import { fullStoreFor } from "../mocks/applicantFull.ts";
import { createMockWriteKeepApi, seedWriteKeepStore, type WriteKeepStore } from "../mocks/writeKeep.ts";
import { mockApplicantStore } from "./applicantHooks.ts";
import type { Mutation, Query, QueryState } from "./hooks.ts";
import { mockOutsideStore } from "./outsideHooks.ts";
import { createHttpWriteKeepApi, type WriteKeepApi } from "./writeKeep.ts";

const ports = new WeakMap<object, { api: WriteKeepApi; workspace: { id: string | null } }>();
const mockStores = new WeakMap<object, WriteKeepStore>();

/** Replaces the port for a services object (tests). */
export function provideWriteKeepApi(services: Pick<Services, "auth">, api: WriteKeepApi): void {
  ports.set(services.auth, { api, workspace: { id: null } });
}
/** Mock mode: the write-and-keep store for a services object (tests and demos read it). */
export function mockWriteKeepStore(services: Pick<Services, "auth">): WriteKeepStore {
  let store = mockStores.get(services.auth);
  if (!store) mockStores.set(services.auth, (store = seedWriteKeepStore()));
  return store;
}

function portFor(services: Pick<Services, "auth" | "mock">) {
  let port = ports.get(services.auth);
  if (!port) {
    const workspace = { id: null as string | null };
    const applicant = mockApplicantStore(services);
    const api = services.mock
      ? createMockWriteKeepApi({ session: () => services.auth.getSession(), applicant, outside: mockOutsideStore(services), full: fullStoreFor(applicant), store: mockWriteKeepStore(services) })
      : createHttpWriteKeepApi({ baseUrl: env.apiBaseUrl, token: async () => (await services.auth.getSession())?.accessToken ?? null, workspaceId: () => workspace.id });
    port = { api, workspace };
    ports.set(services.auth, port);
  }
  return port;
}

export function useWriteKeepApi(): WriteKeepApi {
  const services = useServices();
  const workspace = useCurrentWorkspace();
  const port = portFor(services);
  if (workspace?.kind === "applicant") port.workspace.id = workspace.id;
  return port.api;
}

/** Runs `load` on mount and whenever `deps` change. A stale response never overwrites a newer one. */
export function useWKQuery<T>(load: (api: WriteKeepApi) => Promise<T>, deps: DependencyList): Query<T> {
  const api = useWriteKeepApi();
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
export function useWKMutation<A extends unknown[], R>(write: (api: WriteKeepApi, ...args: A) => Promise<R>): Mutation<A, R> {
  const api = useWriteKeepApi();
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
