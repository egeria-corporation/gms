// SPDX-License-Identifier: AGPL-3.0-only
// The guest reviewer port. Its screens sit outside a workspace (like the reviewer portal), so each
// call names the funder workspace; the person's memberships pick it. In mock mode the guest's
// memberships are the mock's own (an accepted invitation adds one).
import { useCallback, useEffect, useRef, useState, type DependencyList } from "react";
import { useServices, type Services } from "../app/services.tsx";
import { env } from "../env.ts";
import { createMockGuestReviewApi, seedGuestReviewStore, type GuestReviewStore } from "../mocks/guestReview.ts";
import type { MeWorkspace } from "./client.ts";
import { createHttpGuestReviewApi, type GuestReviewApi } from "./guestReview.ts";
import type { Query, QueryState } from "./hooks.ts";

const ports = new WeakMap<object, { api: GuestReviewApi; memberships: { list: MeWorkspace[] } }>();
const mockStores = new WeakMap<object, GuestReviewStore>();

/** Replaces the port for a services object (tests). */
export function provideGuestReviewApi(services: Pick<Services, "auth">, api: GuestReviewApi): void {
  ports.set(services.auth, { api, memberships: { list: [] } });
}
/** Mock mode: the guest reviewer store for a services object (tests read it). */
export function mockGuestReviewStore(services: Pick<Services, "auth">): GuestReviewStore {
  let store = mockStores.get(services.auth);
  if (!store) mockStores.set(services.auth, (store = seedGuestReviewStore()));
  return store;
}

export function useGuestReviewApi(): GuestReviewApi {
  const services = useServices();
  let port = ports.get(services.auth);
  if (!port) {
    const memberships = { list: [] as MeWorkspace[] };
    const api = services.mock
      ? createMockGuestReviewApi({ session: () => services.auth.getSession(), memberships: () => memberships.list, store: mockGuestReviewStore(services) })
      : createHttpGuestReviewApi({ baseUrl: env.apiBaseUrl, token: async () => (await services.auth.getSession())?.accessToken ?? null });
    port = { api, memberships };
    ports.set(services.auth, port);
  }
  if (services.meState.status === "ready") port.memberships.list = services.meState.me.workspaces;
  return port.api;
}

/** The guest's membership: the funder named by `?ws=` (its handle), else their first guest membership. */
export function useGuestMembership(handle: string | null): { status: "loading" } | { status: "ready"; membership: MeWorkspace | null } {
  const { meState } = useServices();
  if (meState.status !== "ready") return { status: "loading" };
  const guests = meState.me.workspaces.filter((w) => w.kind === "funder" && w.role === "external_reviewer");
  return { status: "ready", membership: guests.find((w) => w.handle === handle) ?? guests[0] ?? null };
}

/** Runs `load` on mount and whenever `deps` change. A stale response never overwrites a newer one. */
export function useGuestReviewQuery<T>(load: (api: GuestReviewApi) => Promise<T>, deps: DependencyList): Query<T> {
  const api = useGuestReviewApi();
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
