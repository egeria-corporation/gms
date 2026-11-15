// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment node
// The template gallery through the web client, against the real API Worker in-process and against
// the mock: the same public list, a copy that becomes the workspace's own draft, and sharing that
// strips the funder's name, waits for a moderator and can be withdrawn.
import { describe, expect, it } from "vitest";
import type { GmsApi } from "../src/api/client.ts";
import { createHttpGalleryApi, type GalleryApi } from "../src/api/gallery.ts";
import { createMockApi } from "../src/mocks/api.ts";
import { demoSession } from "../src/mocks/auth.ts";
import { createMockGalleryApi, seedGalleryStore } from "../src/mocks/gallery.ts";
import starters from "../src/mocks/galleryStarters.json";
import { seedStore } from "../src/mocks/store.ts";
import { httpApiFor, loadApi } from "./api-harness.ts";

interface Backend {
  api: GmsApi;
  gallery: GalleryApi;
  anonymous: GalleryApi;
  workspaceId: string;
}

async function realBackend(): Promise<Backend> {
  const helpers = await loadApi();
  const h = await helpers.harness();
  (h as unknown as { env: Record<string, string> }).env.GALLERY_MODERATORS = helpers.USER_ADMIN;
  for (const s of starters.items) await h.repos.table("gallery_items").insert({ ...s, author_workspace_id: null, licence: "CC-BY-4.0", status: "approved", version: 1, uses_count: 0, published_at: starters.publishedAt, withdrawn_at: null });
  const fetchInProcess: typeof fetch = async (input, init) => {
    const req = input instanceof Request ? input : new Request(input, init);
    const u = new URL(req.url);
    const body = req.method === "GET" || req.method === "HEAD" ? undefined : await req.text();
    return h.request(u.pathname + u.search, { method: req.method, headers: req.headers, ...(body !== undefined ? { body } : {}) });
  };
  const client = (userId: string | null) => createHttpGalleryApi({ baseUrl: helpers.BASE, token: async () => (userId ? h.session(userId) : null), fetch: fetchInProcess });
  return { api: httpApiFor(helpers, h, helpers.USER_ADMIN), gallery: client(helpers.USER_ADMIN), anonymous: client(null), workspaceId: helpers.WS_FUNDER };
}
async function mockBackend(): Promise<Backend> {
  const api = createMockApi({ session: async () => demoSession(), store: seedStore() });
  const store = seedGalleryStore();
  return { api, gallery: createMockGalleryApi({ session: async () => demoSession(), api, store }), anonymous: createMockGalleryApi({ session: async () => null, api, store }), workspaceId: "20000000-0000-7000-8000-000000000001" };
}

describe.each([
  ["the API Worker over HTTP", realBackend],
  ["the mock API", mockBackend],
])("template gallery: %s", (_name, make) => {
  it("lists and previews approved items for anyone, and copies one into an independent draft", { timeout: 30_000 }, async () => {
    const { api, gallery, anonymous, workspaceId } = await make();
    const all = await anonymous.list();
    expect(all.items.map((i) => i.slug)).toEqual(expect.arrayContaining(starters.items.map((s) => s.slug)));
    expect(all.tags.grantSize).toContain("Under $10,000");
    expect((await anonymous.list({ kind: "report_form" })).items.map((i) => i.slug).sort()).toEqual(["final-report", "interim-report"]);
    const item = await anonymous.item("common-application");
    expect(item).toMatchObject({ kind: "application_form", licence: { code: "CC-BY-4.0" }, author: { kind: "opengrants", verified: false } });
    const before = item.usesCount;

    const out = await gallery.copy(workspaceId, "common-application");
    expect(out.item.usesCount).toBe(before + 1);
    expect(out.created).toEqual([expect.objectContaining({ type: "form", title: "Common application", purpose: "application" })]);
    await api.workspace("riverbend");
    const form = await api.getForm(out.created[0]!.id);
    expect(form.status).toBe("draft");
    expect(Object.keys(form.jsonSchema.properties ?? {})).toEqual(Object.keys((item.snapshot.forms[0]!.jsonSchema as { properties: object }).properties));
    await api.updateForm(form.id, { title: "Our application" });
    expect((await anonymous.item("common-application")).snapshot.forms[0]!.title).toBe("Common application");
    await expect(anonymous.item("no-such-template")).rejects.toMatchObject({ status: 404 });
  });

  it("shares a published form without the funder's name, through a moderator, and withdraws it", { timeout: 30_000 }, async () => {
    const { api, gallery, anonymous, workspaceId } = await make();
    await api.workspace("riverbend");
    const form = await api.createForm({ title: "Riverbend Community Foundation quick form", purpose: "application", jsonSchema: { type: "object", required: ["q"], properties: { q: { type: "string", title: "Your question" } } }, uiSchema: { type: "VerticalLayout", elements: [{ type: "Control", scope: "#/properties/q", options: { help: "Ask jo@riverbendcf.example" } }] } });
    await api.publishForm(form.id);
    const preview = await gallery.preview(workspaceId, { source: { type: "form", id: form.id } });
    expect(preview.snapshot.forms[0]!.title).toBe("[Your organization] quick form");
    expect(preview.stripped.map((s) => s.what)).toEqual(expect.arrayContaining(["name", "help"]));

    const sent = await gallery.submit(workspaceId, { source: { type: "form", id: form.id }, title: "Quick form", summary: "A short form for small requests.", tags: { fieldOfWork: ["Any field"], grantSize: [], audience: [] }, licence: "CC-BY-4.0" });
    expect(sent.status).toBe("pending");
    expect((await anonymous.list({ q: "quick form" })).items).toEqual([]);
    expect(await gallery.isModerator()).toBe(true);
    expect((await gallery.queue()).map((q) => q.id)).toContain(sent.id);
    const { item } = await gallery.approve(sent.id);
    expect((await anonymous.item(item.slug)).author).toMatchObject({ kind: "workspace", name: "Riverbend Community Foundation", verified: true });
    expect((await gallery.submissions(workspaceId)).find((s) => s.id === sent.id)).toMatchObject({ status: "approved", item: { slug: item.slug, live: true } });
    expect(await gallery.withdraw(workspaceId, sent.id)).toMatchObject({ status: "withdrawn" });
    await expect(anonymous.item(item.slug)).rejects.toMatchObject({ status: 404 });
  });
});
