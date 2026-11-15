// SPDX-License-Identifier: AGPL-3.0-only
// The single sign-on port for a services object: the Worker in production, the mock in mock mode.
// One port per services object, so a test's mock store is its own.
import { useServices, type Services } from "../app/services.tsx";
import { useCurrentWorkspace } from "../app/workspace.tsx";
import { env } from "../env.ts";
import { createMockSsoApi } from "../mocks/sso.ts";
import { createHttpSsoApi, type SsoApi } from "./sso.ts";

const ports = new WeakMap<object, { api: SsoApi; workspace: { id: string | null; handle: string | null } }>();

/** Replaces the port for a services object (tests). */
export function provideSsoApi(services: Pick<Services, "auth">, api: SsoApi): void {
  ports.set(services.auth, { api, workspace: { id: null, handle: null } });
}

export function ssoPortFor(services: Pick<Services, "auth" | "mock">) {
  let port = ports.get(services.auth);
  if (!port) {
    const workspace = { id: null as string | null, handle: null as string | null };
    const api = services.mock
      ? createMockSsoApi({ session: () => services.auth.getSession(), workspaceHandle: () => workspace.handle })
      : createHttpSsoApi({ baseUrl: env.apiBaseUrl, token: async () => (await services.auth.getSession())?.accessToken ?? null, workspaceId: () => workspace.id });
    port = { api, workspace };
    ports.set(services.auth, port);
  }
  return port;
}

/** The SSO port, acting in the current workspace when there is one. */
export function useSsoApi(): SsoApi {
  const services = useServices();
  const current = useCurrentWorkspace();
  const port = ssoPortFor(services);
  if (current) {
    port.workspace.id = current.id;
    port.workspace.handle = current.handle;
  }
  return port.api;
}
