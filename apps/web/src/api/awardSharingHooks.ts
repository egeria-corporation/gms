// SPDX-License-Identifier: AGPL-3.0-only
// The award sharing port for the current workspace (or none, on the public pages), with the same
// loading and error states as the other ports. In mock mode the funder's public record comes from
// the mock API's public funder page, so the award pages show the same brand.
import { useCallback, useEffect, useRef, useState, type DependencyList } from "react";
import { useServices, type Services } from "../app/services.tsx";
import { useCurrentWorkspace } from "../app/workspace.tsx";
import { env } from "../env.ts";
import { createMockAwardSharingApi, seedAwardSharingStore, type AwardSharingStore } from "../mocks/awardSharing.ts";
import { createHttpAwardSharingApi, type AwardSharingApi } from "./awardSharing.ts";
import type { Mutation, Query, QueryState } from "./hooks.ts";

type Current = { id: string; kind: "funder" | "applicant"; handle: string; role: string } | null;
const ports = new WeakMap<object, { api: AwardSharingApi; workspace: { current: Current } }>();
const mockStores = new WeakMap<object, AwardSharingStore>();

/** Replaces the port for a services object (tests). */
export function provideAwardSharingApi(services: Pick<Services, "auth">, api: AwardSharingApi): void {
  ports.set(services.auth, { api, workspace: { current: null } });
}
/** Mock mode: the award sharing store for a services object (tests and demos read it). */
export function mockAwardSharingStore(services: Pick<Services, "auth">): AwardSharingStore {
  let store = mockStores.get(services.auth);
  if (!store) mockStores.set(services.auth, (store = seedAwardSharingStore()));
  return store;
}

function portFor(services: Pick<Services, "auth" | "mock" | "api">) {
  let port = ports.get(services.auth);
  if (!port) {
    const workspace = { current: null as Current };
    const session = () => services.auth.getSession();
    const api = services.mock
      ? createMockAwardSharingApi({ store: mockAwardSharingStore(services), workspace: () => workspace.current, funder: async (handle) => (await services.api.publicFunder(handle)).funder })
      : createHttpAwardSharingApi({ baseUrl: env.apiBaseUrl, token: async () => (await session())?.accessToken ?? null, workspaceId: () => workspace.current?.id ?? null });
    port = { api, workspace };
    ports.set(services.auth, port);
  }
  return port;
}

/** Outside a workspace (the public pages) only the public reads work. */
export function useAwardSharingApi(): AwardSharingApi {
  const services = useServices();
  const ws = useCurrentWorkspace();
  const port = portFor(services);
  port.workspace.current = ws ? { id: ws.id, kind: ws.kind, handle: ws.handle, role: ws.member.role ?? "admin" } : null;
  return port.api;
}

/** Runs `load` on mount and whenever `deps` change. A stale response never overwrites a newer one. */
export function useAwardSharingQuery<T>(load: (api: AwardSharingApi) => Promise<T>, deps: DependencyList): Query<T> {
  const api = useAwardSharingApi();
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
export function useAwardSharingMutation<A extends unknown[], R>(write: (api: AwardSharingApi, ...args: A) => Promise<R>): Mutation<A, R> {
  const api = useAwardSharingApi();
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
