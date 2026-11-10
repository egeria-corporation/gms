// SPDX-License-Identifier: AGPL-3.0-only
// The rest of the applicant port for the current workspace, with the loading and error states the
// other screens get from api/hooks.ts. Notifications, preferences and connected agents work in
// either kind of workspace, so screens outside `/w/:ws` name the workspace they act in.
import { useCallback, useEffect, useRef, useState, type DependencyList } from "react";
import { useServices, type Services } from "../app/services.tsx";
import { useCurrentWorkspace } from "../app/workspace.tsx";
import { env } from "../env.ts";
import { createMockApplicantMoreApi, seedMoreStore } from "../mocks/applicantMore.ts";
import { mockApplicantStore } from "./applicantHooks.ts";
import { createHttpApplicantMoreApi, type ApplicantMoreApi } from "./applicantMore.ts";
import type { Mutation, Query, QueryState } from "./hooks.ts";

const ports = new WeakMap<object, { api: ApplicantMoreApi; workspace: { id: string | null } }>();

/** Replaces the port for a services object (tests, the styleguide). */
export function provideApplicantMoreApi(services: Pick<Services, "auth">, api: ApplicantMoreApi): void {
  ports.set(services.auth, { api, workspace: { id: null } });
}

function portFor(services: Pick<Services, "auth" | "mock">) {
  let port = ports.get(services.auth);
  if (!port) {
    const workspace = { id: null as string | null };
    let api: ApplicantMoreApi;
    if (services.mock) {
      const store = mockApplicantStore(services);
      api = createMockApplicantMoreApi({ session: () => services.auth.getSession(), store, more: seedMoreStore(store) });
    } else {
      api = createHttpApplicantMoreApi({ baseUrl: env.apiBaseUrl, token: async () => (await services.auth.getSession())?.accessToken ?? null, workspaceId: () => workspace.id });
    }
    port = { api, workspace };
    ports.set(services.auth, port);
  }
  return port;
}

/** `workspaceId` names the workspace on screens outside `/w/:ws` (notifications, account). */
export function useMoreApi(workspaceId?: string | null): ApplicantMoreApi {
  const services = useServices();
  const workspace = useCurrentWorkspace();
  const port = portFor(services);
  if (workspaceId) port.workspace.id = workspaceId;
  else if (workspace) port.workspace.id = workspace.id;
  return port.api;
}

/** Runs `load` on mount and whenever `deps` change. A stale response never overwrites a newer one. */
export function useMoreQuery<T>(load: (api: ApplicantMoreApi) => Promise<T>, deps: DependencyList, workspaceId?: string | null): Query<T> {
  const api = useMoreApi(workspaceId);
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
export function useMoreMutation<A extends unknown[], R>(write: (api: ApplicantMoreApi, ...args: A) => Promise<R>, workspaceId?: string | null): Mutation<A, R> {
  const api = useMoreApi(workspaceId);
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
