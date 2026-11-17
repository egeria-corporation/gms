// SPDX-License-Identifier: AGPL-3.0-only
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";
import { loadCatalogs } from "@gms/i18n";
import { changeLocale } from "../src/i18n/current.ts";

// Every English catalog is ready before a test renders, so no screen suspends on its namespace;
// a test that switches to Spanish (`await changeLocale("es")`) is put back to English after it.
await loadCatalogs("en");
afterEach(async () => {
  cleanup();
  await changeLocale("en");
});

// jsdom has no matchMedia; tests set `phone` to pick the layout.
export const viewport = { phone: false };
vi.stubGlobal("matchMedia", (query: string) => ({
  matches: viewport.phone,
  media: query,
  addEventListener: () => {},
  removeEventListener: () => {},
}));
