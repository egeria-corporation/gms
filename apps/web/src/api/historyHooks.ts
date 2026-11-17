// SPDX-License-Identifier: AGPL-3.0-only
// The imported history port for the current workspace. In mock mode it reads the import store
// (mocks/imports.ts), where a mock import writes its past applications, reviews and reports.
import { useCallback, useEffect, useRef, useState, type DependencyList } from "react";
import { useServices, type Services } from "../app/services.tsx";
import { useCurrentWorkspace } from "../app/workspace.tsx";
import { env } from "../env.ts";
import { createMockHistoryApi } from "../mocks/history.ts";
import { createHttpHistoryApi, type HistoryApi } from "./history.ts";
import type { Query, QueryState } from "./hooks.ts";
import { mockImportsStore } from "./importsHooks.ts";

type Current = { id: string; kind: "funder" | "applicant"; role: string } | null;
const ports = new WeakMap<object, { api: HistoryApi; workspace: { current: Current } }>();

function portFor(services: Pick<Services, "auth" | "mock">) {
  let port = ports.get(services.auth);
  if (!port) {
    const workspace = { current: null as Current };
    const session = () => services.auth.getSession();
    const api = services.mock
      ? createMockHistoryApi({ session, store: () => mockImportsStore(services).history, workspace: () => workspace.current })
      : createHttpHistoryApi({ baseUrl: env.apiBaseUrl, token: async () => (await session())?.accessToken ?? null, workspaceId: () => workspace.current?.id ?? null });
    port = { api, workspace };
    ports.set(services.auth, port);
  }
  return port;
}

export function useHistoryApi(): HistoryApi {
  const services = useServices();
  const ws = useCurrentWorkspace();
  const port = portFor(services);
  port.workspace.current = ws ? { id: ws.id, kind: ws.kind, role: ws.member.role ?? "admin" } : null;
  return port.api;
}

/** Runs `load` on mount and whenever `deps` change. A stale response never overwrites a newer one. */
export function useHistoryQuery<T>(load: (api: HistoryApi) => Promise<T>, deps: DependencyList): Query<T> {
  const api = useHistoryApi();
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
