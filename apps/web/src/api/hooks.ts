// SPDX-License-Identifier: AGPL-3.0-only
// Read and write through the API port with loading and error states.
import { useCallback, useEffect, useRef, useState, type DependencyList } from "react";
import type { GmsApi } from "./client.ts";
import { useServices } from "../app/services.tsx";

export type QueryState<T> = { status: "loading"; data?: undefined; error?: undefined } | { status: "error"; error: unknown; data?: undefined } | { status: "ready"; data: T; error?: undefined };

export type Query<T> = QueryState<T> & {
  reload: () => void;
  /** Replace the loaded value without a round trip (after a write that returned the new record). */
  set: (data: T) => void;
  /**
   * True while `reload()` fetches again with the current data still shown. Optional so the other
   * query hooks, which keep their data anyway, satisfy the same type.
   */
  refreshing?: boolean;
};

type Loaded<T> = QueryState<T> & { refreshing?: boolean };

/**
 * Runs `load` on mount and whenever `deps` change. A stale response never overwrites a newer one.
 * The first load and a change of `deps` show the loading state. `reload()` keeps the current data on
 * screen and sets `refreshing` until the new data arrives, so a list does not flash empty after a
 * write. A failed load shows the error, as before; a reload from the error state loads afresh.
 */
export function useApiQuery<T>(load: (api: GmsApi) => Promise<T>, deps: DependencyList): Query<T> {
  const { api } = useServices();
  const [state, setState] = useState<Loaded<T>>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const loader = useRef(load);
  loader.current = load;
  // The inputs of the last load: when only `attempt` moved, this run is a reload.
  const inputs = useRef<readonly unknown[] | null>(null);

  useEffect(() => {
    let live = true;
    const now = [api, ...deps];
    const prev = inputs.current;
    const sameInputs = prev !== null && prev.length === now.length && prev.every((v, i) => Object.is(v, now[i]));
    inputs.current = now;
    setState((s) => (sameInputs && s.status === "ready" ? { status: "ready", data: s.data, refreshing: true } : { status: "loading" }));
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
  return { ...state, refreshing: state.refreshing === true, reload, set };
}

export interface Mutation<A extends unknown[], R> {
  run: (...args: A) => Promise<R | undefined>;
  state: "idle" | "saving" | "saved";
  error: unknown;
  reset: () => void;
}

/**
 * Wraps a write. `run` resolves to the result, or `undefined` when the call failed (the error is
 * kept on `error` for an inline message, so callers do not need a try/catch).
 */
export function useApiMutation<A extends unknown[], R>(write: (api: GmsApi, ...args: A) => Promise<R>): Mutation<A, R> {
  const { api } = useServices();
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
