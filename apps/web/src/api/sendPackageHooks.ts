// SPDX-License-Identifier: AGPL-3.0-only
// The send-to-funder port for the current applicant workspace, with the same loading and error
// states as the other ports. In mock mode it reads the outside-application and vault stores the
// other mocks share, so the package lists what the screens show.
import { useCallback, useEffect, useRef, useState, type DependencyList } from "react";
import { useServices, type Services } from "../app/services.tsx";
import { useCurrentWorkspace } from "../app/workspace.tsx";
import { env } from "../env.ts";
import { createMockSendPackageApi, seedSendPackageStore, type SendPackageStore } from "../mocks/sendPackage.ts";
import type { Mutation, Query, QueryState } from "./hooks.ts";
import { mockOutsideStore } from "./outsideHooks.ts";
import { createHttpSendPackageApi, type SendPackageApi } from "./sendPackage.ts";
import { mockWriteKeepStore } from "./writeKeepHooks.ts";

const ports = new WeakMap<object, { api: SendPackageApi; workspace: { id: string | null; name: string } }>();
const mockStores = new WeakMap<object, SendPackageStore>();

/** Replaces the port for a services object (tests). */
export function provideSendPackageApi(services: Pick<Services, "auth">, api: SendPackageApi): void {
  ports.set(services.auth, { api, workspace: { id: null, name: "" } });
}
/** Mock mode: the send-to-funder store for a services object (tests read it). */
export function mockSendPackageStore(services: Pick<Services, "auth">): SendPackageStore {
  let store = mockStores.get(services.auth);
  if (!store) mockStores.set(services.auth, (store = seedSendPackageStore()));
  return store;
}

const nameOf = (email: string) =>
  email
    .split("@")[0]!
    .replace(/[._+-]+/g, " ")
    .trim()
    .replace(/\b\p{L}/gu, (ch) => ch.toUpperCase());

function portFor(services: Services) {
  let port = ports.get(services.auth);
  if (!port) {
    const workspace = { id: null as string | null, name: "" };
    const api = services.mock
      ? createMockSendPackageApi({
          session: () => services.auth.getSession(),
          outside: mockOutsideStore(services),
          vault: () => mockWriteKeepStore(services).vault,
          organization: () => workspace.name,
          person: async () => {
            const s = await services.auth.getSession();
            return s ? { name: nameOf(s.email), email: s.email } : null;
          },
          store: mockSendPackageStore(services),
        })
      : createHttpSendPackageApi({ baseUrl: env.apiBaseUrl, token: async () => (await services.auth.getSession())?.accessToken ?? null, workspaceId: () => workspace.id });
    port = { api, workspace };
    ports.set(services.auth, port);
  }
  return port;
}

export function useSendPackageApi(): SendPackageApi {
  const services = useServices();
  const workspace = useCurrentWorkspace();
  const port = portFor(services);
  if (workspace?.kind === "applicant") {
    port.workspace.id = workspace.id;
    port.workspace.name = workspace.name;
  }
  return port.api;
}

/** Runs `load` on mount and whenever `deps` change. A stale response never overwrites a newer one. */
export function useSendPackageQuery<T>(load: (api: SendPackageApi) => Promise<T>, deps: DependencyList): Query<T> {
  const api = useSendPackageApi();
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
export function useSendPackageMutation<A extends unknown[], R>(write: (api: SendPackageApi, ...args: A) => Promise<R>): Mutation<A, R> {
  const api = useSendPackageApi();
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
