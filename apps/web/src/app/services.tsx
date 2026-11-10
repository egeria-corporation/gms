// SPDX-License-Identifier: AGPL-3.0-only
// The app's two ports (auth, API) and the session state built on them.
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { createHttpApi, type GmsApi, type Me } from "../api/client.ts";
import { createSupabaseAuth } from "../auth/supabase.ts";
import type { AuthClient, Session } from "../auth/types.ts";
import { env } from "../env.ts";
import { createMockApi } from "../mocks/api.ts";
import { createMockAuth } from "../mocks/auth.ts";

export interface Services {
  auth: AuthClient;
  api: GmsApi;
  /** True when both ports are the in-browser mocks. */
  mock: boolean;
}

export function createServices(): Services {
  if (env.useMocks) {
    const auth = createMockAuth();
    return { auth, api: createMockApi({ session: () => auth.getSession() }), mock: true };
  }
  const auth = createSupabaseAuth(env.supabaseUrl, env.supabaseAnonKey);
  const api = createHttpApi({
    baseUrl: env.apiBaseUrl,
    token: async () => (await auth.getSession())?.accessToken ?? null,
    identity: async () => ({ email: (await auth.getSession())?.email ?? "" }),
  });
  return { auth, api, mock: false };
}

/** Mock services with a given starting session; used by tests and the styleguide. */
export function createMockServices(
  opts: Parameters<typeof createMockAuth>[0] & Omit<Parameters<typeof createMockApi>[0], "session"> = {},
): Services {
  const auth = createMockAuth(opts);
  return { auth, api: createMockApi({ ...opts, session: () => auth.getSession() }), mock: true };
}

type SessionState = { status: "loading" } | { status: "signedOut" } | { status: "signedIn"; session: Session };
export type MeState = { status: "loading" } | { status: "error"; error: unknown } | { status: "ready"; me: Me };

interface ServicesValue extends Services {
  sessionState: SessionState;
  meState: MeState;
  reloadMe: () => void;
}

const ServicesContext = createContext<ServicesValue | null>(null);

export function ServicesProvider({ services, children }: { services: Services; children: ReactNode }) {
  const [sessionState, setSessionState] = useState<SessionState>({ status: "loading" });
  const [meState, setMeState] = useState<MeState>({ status: "loading" });
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let live = true;
    const apply = (s: Session | null) => live && setSessionState(s ? { status: "signedIn", session: s } : { status: "signedOut" });
    services.auth.getSession().then(apply, () => apply(null));
    const off = services.auth.onChange(apply);
    return () => {
      live = false;
      off();
    };
  }, [services]);

  const sessionKey =
    sessionState.status === "signedIn" ? `${sessionState.session.userId}:${sessionState.session.aal}` : sessionState.status;
  useEffect(() => {
    if (sessionState.status !== "signedIn") return;
    let live = true;
    setMeState({ status: "loading" });
    services.api.me().then(
      (me) => live && setMeState({ status: "ready", me }),
      (error: unknown) => live && setMeState({ status: "error", error }),
    );
    return () => {
      live = false;
    };
  }, [services, sessionKey, reload]);

  const value = useMemo(
    () => ({ ...services, sessionState, meState, reloadMe: () => setReload((n) => n + 1) }),
    [services, sessionState, meState],
  );
  return <ServicesContext.Provider value={value}>{children}</ServicesContext.Provider>;
}

export function useServices(): ServicesValue {
  const value = useContext(ServicesContext);
  if (!value) throw new Error("ServicesProvider is missing");
  return value;
}
