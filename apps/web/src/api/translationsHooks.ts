// SPDX-License-Identifier: AGPL-3.0-only
// The translation-drafting port (api/translations.ts) for a services object: the in-browser mock
// in mock mode (it reads the mock API's forms and opportunities), the API otherwise.
import { useServices, type Services } from "../app/services.tsx";
import { env } from "../env.ts";
import { createMockTranslationsApi } from "../mocks/translations.ts";
import { createHttpTranslationsApi, type TranslationsApi } from "./translations.ts";

const ports = new WeakMap<object, TranslationsApi>();

/** Replaces the port for a services object (tests). */
export function provideTranslationsApi(services: Pick<Services, "auth">, api: TranslationsApi): void {
  ports.set(services.auth, api);
}

export function translationsApiFor(services: Pick<Services, "auth" | "api" | "mock">): TranslationsApi {
  let api = ports.get(services.auth);
  if (!api) {
    api = services.mock ? createMockTranslationsApi({ api: services.api }) : createHttpTranslationsApi({ baseUrl: env.apiBaseUrl, token: async () => (await services.auth.getSession())?.accessToken ?? null });
    ports.set(services.auth, api);
  }
  return api;
}

export function useTranslationsApi(): TranslationsApi {
  return translationsApiFor(useServices());
}
