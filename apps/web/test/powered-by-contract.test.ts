// @vitest-environment node
// SPDX-License-Identifier: AGPL-3.0-only
// The funder's "Powered by" setting on two backends: the web HTTP client against the real API
// Worker in-process, and the in-browser mock. The public pages' footers and the apply widget read
// it from the public data (`showsPoweredBy` for the footers, `poweredBy` for the widget), so these
// assertions on that data, with the mock-mode screen tests in embed.test.tsx, prove what a real
// install shows: the line by default, and nowhere once a funder admin turns it off.
import { beforeAll, describe, expect, it } from "vitest";
import type { GmsApi } from "../src/api/client.ts";
import { createMockApi } from "../src/mocks/api.ts";
import { demoSession } from "../src/mocks/auth.ts";
import { IDS, seedStore } from "../src/mocks/store.ts";
import { showsPoweredBy } from "../src/screens/public/PublicFrame.tsx";
import { httpApiFor, loadApi, type ApiHarness } from "./api-harness.ts";

interface Backend {
  /** Signed in as the funder's admin. */
  admin: GmsApi;
  /** Nobody signed in, as a visitor to the public pages. */
  visitor: GmsApi;
  workspaceId: string;
  slug: string;
}

async function realBackend(): Promise<Backend> {
  const helpers = await loadApi();
  const h: ApiHarness = await helpers.harness();
  await ((await import(/* @vite-ignore */ new URL("../../api/test/scenario.ts", import.meta.url).href)) as { scenario(h: ApiHarness): Promise<unknown> }).scenario(h);
  return { admin: httpApiFor(helpers, h, helpers.USER_ADMIN), visitor: httpApiFor(helpers, h, null), workspaceId: helpers.WS_FUNDER, slug: "community-health-grants-2027" };
}

async function mockBackend(): Promise<Backend> {
  const store = seedStore();
  return { admin: createMockApi({ session: async () => demoSession(), store }), visitor: createMockApi({ session: async () => null, store }), workspaceId: IDS.riverbend, slug: "community-health-2027" };
}

describe.each([
  ["real API", realBackend],
  ["mock", mockBackend],
])("Powered by on the %s", (_name, make) => {
  let b: Backend;
  beforeAll(async () => {
    b = await make();
  });

  const shown = async () => ({
    funderPage: showsPoweredBy((await b.visitor.publicFunder("riverbend")).funder),
    opportunityPage: showsPoweredBy((await b.visitor.publicOpportunity("riverbend", b.slug)).funder),
    widget: (await b.visitor.publicEmbed("riverbend", b.slug)).poweredBy,
  });

  it("is on by default, and the public data says so", async () => {
    expect((await b.visitor.publicFunder("riverbend")).funder.poweredBy).toBe(true);
    expect(await shown()).toEqual({ funderPage: true, opportunityPage: true, widget: true });
  });

  it("is off everywhere once an admin turns it off, and back when they turn it on", async () => {
    await b.admin.updateWorkspace(b.workspaceId, { settings: { poweredBy: false } });
    expect((await b.visitor.publicFunder("riverbend")).funder.poweredBy).toBe(false);
    expect(await shown()).toEqual({ funderPage: false, opportunityPage: false, widget: false });
    await b.admin.updateWorkspace(b.workspaceId, { settings: { poweredBy: null } });
    expect(await shown()).toEqual({ funderPage: true, opportunityPage: true, widget: true });
  });
});
