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
};

/** Runs `load` on mount and whenever `deps` change. A stale response never overwrites a newer one. */
export function useApiQuery<T>(load: (api: GmsApi) => Promise<T>, deps: DependencyList): Query<T> {
  const { api } = useServices();
  const [state, setState] = useState<QueryState<T>>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const loader = useRef(load);
  loader.current = load;

  useEffect(() => {
    let live = true;
    setState({ status: "loading" });
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
