// SPDX-License-Identifier: AGPL-3.0-only
// The last part of the applicant port for the current workspace, with the same loading and error
// states the other screens get from api/hooks.ts.
import { useCallback, useEffect, useRef, useState, type DependencyList } from "react";
import { useServices, type Services } from "../app/services.tsx";
import { useCurrentWorkspace } from "../app/workspace.tsx";
import { env } from "../env.ts";
import { createMockApplicantFullApi, fullStoreFor } from "../mocks/applicantFull.ts";
import { createHttpApplicantFullApi, type ApplicantFullApi } from "./applicantFull.ts";
import { mockApplicantStore } from "./applicantHooks.ts";
import type { Mutation, Query, QueryState } from "./hooks.ts";

const ports = new WeakMap<object, { api: ApplicantFullApi; workspace: { id: string | null } }>();

/** Replaces the port for a services object (tests, the styleguide). */
export function provideApplicantFullApi(services: Pick<Services, "auth">, api: ApplicantFullApi): void {
  ports.set(services.auth, { api, workspace: { id: null } });
}

function portFor(services: Pick<Services, "auth" | "mock">) {
  let port = ports.get(services.auth);
  if (!port) {
    const workspace = { id: null as string | null };
    const api = services.mock
      ? createMockApplicantFullApi(((store) => ({ session: () => services.auth.getSession(), store, full: fullStoreFor(store) }))(mockApplicantStore(services)))
      : createHttpApplicantFullApi({ baseUrl: env.apiBaseUrl, token: async () => (await services.auth.getSession())?.accessToken ?? null, workspaceId: () => workspace.id });
    port = { api, workspace };
    ports.set(services.auth, port);
  }
  return port;
}

export function useFullApi(): ApplicantFullApi {
  const services = useServices();
  const workspace = useCurrentWorkspace();
  const port = portFor(services);
  if (workspace) port.workspace.id = workspace.id;
  return port.api;
}

/** Runs `load` on mount and whenever `deps` change. A stale response never overwrites a newer one. */
export function useFullQuery<T>(load: (api: ApplicantFullApi) => Promise<T>, deps: DependencyList): Query<T> {
  const api = useFullApi();
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
export function useFullMutation<A extends unknown[], R>(write: (api: ApplicantFullApi, ...args: A) => Promise<R>): Mutation<A, R> {
  const api = useFullApi();
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
