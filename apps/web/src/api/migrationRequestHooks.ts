// SPDX-License-Identifier: AGPL-3.0-only
// The migration request port for a services object: the in-browser mock in mock mode, the API
// otherwise. It never takes the session's token (see api/migrationRequest.ts).
import { useServices, type Services } from "../app/services.tsx";
import { env } from "../env.ts";
import { createMockMigrationRequestApi } from "../mocks/migrationRequest.ts";
import { createHttpMigrationRequestApi, type MigrationRequestApi } from "./migrationRequest.ts";

const ports = new WeakMap<object, MigrationRequestApi>();

/** Replaces the port for a services object (tests). */
export function provideMigrationRequestApi(services: Pick<Services, "auth">, api: MigrationRequestApi): void {
  ports.set(services.auth, api);
}

export function migrationRequestApiFor(services: Pick<Services, "auth" | "mock">): MigrationRequestApi {
  let api = ports.get(services.auth);
  if (!api) {
    api = services.mock ? createMockMigrationRequestApi() : createHttpMigrationRequestApi({ baseUrl: env.apiBaseUrl });
    ports.set(services.auth, api);
  }
  return api;
}

export function useMigrationRequestApi(): MigrationRequestApi {
  return migrationRequestApiFor(useServices());
}
