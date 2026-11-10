// SPDX-License-Identifier: AGPL-3.0-only
// The applicant API port for the current workspace, with the same loading and error states the
// funder screens get from api/hooks.ts.
import { useCallback, useEffect, useRef, useState, type DependencyList } from "react";
import { useServices, type Services } from "../app/services.tsx";
import { useCurrentWorkspace } from "../app/workspace.tsx";
import { env } from "../env.ts";
import { createMockApplicantApi, seedApplicantStore, type ApplicantStore } from "../mocks/applicant.ts";
import { createHttpApplicantApi, type ApplicantApi } from "./applicant.ts";
import { createRealtimeHub, createSupabaseRealtime, type Realtime } from "./applicantRealtime.ts";
import type { Mutation, Query, QueryState } from "./hooks.ts";

// One port per services object. `workspace` is read at call time so the HTTP port always names
// the workspace currently open.
const ports = new WeakMap<object, { api: ApplicantApi; workspace: { id: string | null } }>();

/** Replaces the applicant port for a services object (tests, the styleguide). */
export function provideApplicantApi(services: Pick<Services, "auth">, api: ApplicantApi): void {
  ports.set(services.auth, { api, workspace: { id: null } });
}

// Mock mode: one store per services object, shared with the rest of the applicant port
// (api/applicantMoreHooks.ts) so a grant, its schedule and its reports are one story.
const mockStores = new WeakMap<object, ApplicantStore>();
export function mockApplicantStore(services: Pick<Services, "auth">): ApplicantStore {
  let store = mockStores.get(services.auth);
  if (!store) mockStores.set(services.auth, (store = seedApplicantStore()));
  return store;
}

function portFor(services: Pick<Services, "auth" | "mock">) {
  let port = ports.get(services.auth);
  if (!port) {
    const workspace = { id: null as string | null };
    const api = services.mock
      ? createMockApplicantApi({ session: () => services.auth.getSession(), store: mockApplicantStore(services) })
      : createHttpApplicantApi({
          baseUrl: env.apiBaseUrl,
          token: async () => (await services.auth.getSession())?.accessToken ?? null,
          workspaceId: () => workspace.id,
        });
    port = { api, workspace };
    ports.set(services.auth, port);
  }
  return port;
}

/** `workspaceId` names the workspace on screens outside `/w/:ws` (onboarding). */
export function useApplicantApi(workspaceId?: string | null): ApplicantApi {
  const services = useServices();
  const workspace = useCurrentWorkspace();
  const port = portFor(services);
  if (workspaceId) port.workspace.id = workspaceId;
  else if (workspace?.kind === "applicant") port.workspace.id = workspace.id;
  return port.api;
}

/** Runs `load` on mount and whenever `deps` change. A stale response never overwrites a newer one. */
export function useApplicantQuery<T>(load: (api: ApplicantApi) => Promise<T>, deps: DependencyList): Query<T> {
  const api = useApplicantApi();
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
export function useApplicantMutation<A extends unknown[], R>(write: (api: ApplicantApi, ...args: A) => Promise<R>): Mutation<A, R> {
  const api = useApplicantApi();
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

// ---- presence and save nudges for the editor ----

const realtimes = new WeakMap<object, Realtime>();
// Mock mode: one hub per page, so two editors in the same page (or test) see each other.
const mockHub = createRealtimeHub();

/** Replaces the realtime port for a services object (tests). */
export function provideRealtime(services: Pick<Services, "auth">, realtime: Realtime): void {
  realtimes.set(services.auth, realtime);
}

export function useRealtime(): Realtime {
  const services = useServices();
  let rt = realtimes.get(services.auth);
  if (!rt) {
    rt = services.mock ? mockHub : createSupabaseRealtime(env.supabaseUrl, env.supabaseAnonKey, async () => (await services.auth.getSession())?.accessToken ?? null);
    realtimes.set(services.auth, rt);
  }
  return rt;
}
