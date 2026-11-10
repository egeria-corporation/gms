// SPDX-License-Identifier: AGPL-3.0-only
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

afterEach(cleanup);

// jsdom has no matchMedia; tests set `phone` to pick the layout.
export const viewport = { phone: false };
vi.stubGlobal("matchMedia", (query: string) => ({
  matches: viewport.phone,
  media: query,
  addEventListener: () => {},
  removeEventListener: () => {},
}));
