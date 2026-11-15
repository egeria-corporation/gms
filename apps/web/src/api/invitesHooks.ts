// SPDX-License-Identifier: AGPL-3.0-only
// The draft-invitation port for the current applicant workspace, with the same loading and error
// states as the other ports. In mock mode it shares the applicant and outside-application stores,
// so an accepted invitation assigns the question or section the screens show.
import { useCallback, useEffect, useRef, useState, type DependencyList } from "react";
import { useServices, type Services } from "../app/services.tsx";
import { useCurrentWorkspace } from "../app/workspace.tsx";
import { env } from "../env.ts";
import { createMockInvitesApi, seedInvitesStore, type InvitesStore } from "../mocks/invites.ts";
import { mockApplicantStore } from "./applicantHooks.ts";
import type { Mutation, Query, QueryState } from "./hooks.ts";
import { createHttpInvitesApi, type InvitesApi } from "./invites.ts";
import { mockOutsideStore } from "./outsideHooks.ts";

const ports = new WeakMap<object, { api: InvitesApi; workspace: { id: string | null } }>();
const mockStores = new WeakMap<object, InvitesStore>();

/** Replaces the port for a services object (tests). */
export function provideInvitesApi(services: Pick<Services, "auth">, api: InvitesApi): void {
  ports.set(services.auth, { api, workspace: { id: null } });
}
/** Mock mode: the invitations store for a services object (tests read it). */
export function mockInvitesStore(services: Pick<Services, "auth">): InvitesStore {
  let store = mockStores.get(services.auth);
  if (!store) mockStores.set(services.auth, (store = seedInvitesStore()));
  return store;
}

function portFor(services: Pick<Services, "auth" | "mock">) {
  let port = ports.get(services.auth);
  if (!port) {
    const workspace = { id: null as string | null };
    const api = services.mock
      ? createMockInvitesApi({ session: () => services.auth.getSession(), applicant: mockApplicantStore(services), outside: mockOutsideStore(services), store: mockInvitesStore(services) })
      : createHttpInvitesApi({ baseUrl: env.apiBaseUrl, token: async () => (await services.auth.getSession())?.accessToken ?? null, workspaceId: () => workspace.id });
    port = { api, workspace };
    ports.set(services.auth, port);
  }
  return port;
}

export function useInvitesApi(): InvitesApi {
  const services = useServices();
  const workspace = useCurrentWorkspace();
  const port = portFor(services);
  if (workspace?.kind === "applicant") port.workspace.id = workspace.id;
  return port.api;
}

/** Runs `load` on mount and whenever `deps` change. A stale response never overwrites a newer one. */
export function useInvitesQuery<T>(load: (api: InvitesApi) => Promise<T>, deps: DependencyList): Query<T> {
  const api = useInvitesApi();
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
export function useInvitesMutation<A extends unknown[], R>(write: (api: InvitesApi, ...args: A) => Promise<R>): Mutation<A, R> {
  const api = useInvitesApi();
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
