// @vitest-environment node
// SPDX-License-Identifier: AGPL-3.0-only
// problemsOf against the real API Worker in-process: a field the server refuses comes back with a
// reason the banner can list (problems.test.tsx covers the shapes and the banner).
import { describe, expect, it } from "vitest";
import { ApiError } from "../src/api/client.ts";
import { problemsOf } from "../src/components/ui.tsx";
import { httpApiFor, loadApi, type ApiHarness } from "./api-harness.ts";

describe("problemsOf on the API Worker", () => {
  it("lists what the real API Worker says about a field", async () => {
    const helpers = await loadApi();
    const { scenario } = (await import(/* @vite-ignore */ new URL("../../api/test/scenario.ts", import.meta.url).href)) as { scenario: (h: ApiHarness) => Promise<{ compId: string }> };
    const h = await helpers.harness();
    const s = await scenario(h);
    const api = httpApiFor(helpers, h, helpers.USER_ADMIN);
    await api.workspace("riverbend");
    const error = await api.putCoiPolicy(s.compId, { text: "Too short" }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ApiError);
    const problems = problemsOf(error);
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.every((p) => p.message.length > 0)).toBe(true);
  });
});
