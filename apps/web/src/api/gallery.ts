// SPDX-License-Identifier: AGPL-3.0-only
// The template gallery: public reads (no sign-in), copying an item into a funder
// workspace, sharing one of the workspace's own forms, rubrics or email templates, and the
// moderators' queue. Shapes come from the generated schema (api/gallery.tsp).
//
// `createHttpGalleryApi` calls the GMS Worker; `createMockGalleryApi` (mocks/gallery.ts) answers
// the same interface in the browser.
import { ApiError } from "./client.ts";
import type { components } from "./schema.d.ts";
import { translate } from "../i18n/current.ts";

type S = components["schemas"];
export type GalleryKind = S["Models.GalleryKind"];
export type GalleryTags = S["Models.GalleryTags"];
export type GalleryTagVocabulary = S["Models.GalleryTagVocabulary"];
export type GalleryAuthor = S["Models.GalleryAuthor"];
export type GalleryCard = S["Models.GalleryCard"];
export type GalleryItem = S["Models.GalleryItemDetail"];
export type GallerySnapshot = S["Models.GallerySnapshot"];
export type GalleryForm = S["Models.GalleryForm"];
export type GalleryRubric = S["Models.GalleryRubric"];
export type GalleryEmail = S["Models.GalleryEmail"];
export type GalleryCopyResult = S["Models.GalleryCopyResult"];
export type GallerySource = S["Models.GallerySource"];
export type GalleryPreview = S["Models.GalleryPreview"];
export type GalleryStripped = S["Models.GalleryStripped"];
export type GallerySubmission = S["Models.GallerySubmission"];
export type GallerySubmissionInput = S["Models.GallerySubmissionInput"];
export type GalleryQueueItem = S["Models.GalleryQueueItem"];
export type GalleryApproved = S["Models.GalleryApproved"];

export interface GalleryFilter {
  kind?: GalleryKind;
  tag?: string;
  q?: string;
}
export interface GalleryList {
  items: GalleryCard[];
  total: number;
  tags: GalleryTagVocabulary;
}

export interface GalleryApi {
  // ---- public: no sign-in ----
  list(filter?: GalleryFilter): Promise<GalleryList>;
  item(slug: string): Promise<GalleryItem>;

  // ---- a funder workspace (by id) ----
  copy(workspaceId: string, slug: string): Promise<GalleryCopyResult>;
  preview(workspaceId: string, input: { source: GallerySource; extraNames?: string[] }): Promise<GalleryPreview>;
  submissions(workspaceId: string): Promise<GallerySubmission[]>;
  submit(workspaceId: string, input: GallerySubmissionInput): Promise<GallerySubmission>;
  withdraw(workspaceId: string, submissionId: string): Promise<GallerySubmission>;

  // ---- the moderators ----
  isModerator(): Promise<boolean>;
  queue(): Promise<GalleryQueueItem[]>;
  approve(submissionId: string, input?: { slug?: string }): Promise<GalleryApproved>;
  reject(submissionId: string, reason: string): Promise<GallerySubmission>;
}

/** What each kind is called on screen, in the page's language (read each time; the public catalog loads with the gallery's screens). */
export const KIND_LABEL: Record<GalleryKind, string> = {
  get application_form() { return translate("public", "gallery.kind.application_form"); },
  get report_form() { return translate("public", "gallery.kind.report_form"); },
  get rubric() { return translate("public", "gallery.kind.rubric"); },
  get email_template() { return translate("public", "gallery.kind.email_template"); },
  get program_kit() { return translate("public", "gallery.kind.program_kit"); },
};
export const KIND_PLURAL: Record<GalleryKind, string> = {
  get application_form() { return translate("public", "gallery.kinds.application_form"); },
  get report_form() { return translate("public", "gallery.kinds.report_form"); },
  get rubric() { return translate("public", "gallery.kinds.rubric"); },
  get email_template() { return translate("public", "gallery.kinds.email_template"); },
  get program_kit() { return translate("public", "gallery.kinds.program_kit"); },
};
export const GALLERY_KINDS = Object.keys(KIND_LABEL) as GalleryKind[];
export const LICENCE = { code: "CC-BY-4.0", name: "CC BY 4.0", url: "https://creativecommons.org/licenses/by/4.0/" } as const;

export interface HttpGalleryOptions {
  baseUrl: string;
  token: () => Promise<string | null>;
  fetch?: typeof fetch;
}

export function createHttpGalleryApi(opts: HttpGalleryOptions): GalleryApi {
  const e = encodeURIComponent;
  async function call<T>(method: string, path: string, body?: unknown, withToken = true): Promise<{ data?: T; items?: T; [k: string]: unknown }> {
    const token = withToken ? await opts.token() : null;
    const res = await (opts.fetch ?? fetch)(`${opts.baseUrl}${path}`, {
      method,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const json = (await res.json().catch(() => ({}))) as { message?: string; errors?: unknown[]; data?: T; items?: T };
    if (!res.ok) throw new ApiError(res.status, json.message ?? `Request failed (${res.status})`, json.errors ?? []);
    return json;
  }
  const data = async <T>(method: string, path: string, body?: unknown, withToken = true) => (await call<T>(method, path, body, withToken)).data as T;
  const items = async <T>(path: string) => ((await call<T[]>("GET", path)).items ?? []) as T[];
  const ws = (id: string) => `/gms/workspaces/${e(id)}/gallery`;
  const query = (f: GalleryFilter) => {
    const p = new URLSearchParams({ pageSize: "100" });
    for (const [k, v] of Object.entries(f)) if (v) p.set(k, String(v));
    return `?${p.toString()}`;
  };
  return {
    async list(filter = {}) {
      const json = await call<GalleryCard[]>("GET", `/gms/gallery${query(filter)}`, undefined, false);
      const info = json.paginationInfo as { totalItems?: number } | undefined;
      return { items: (json.items ?? []) as GalleryCard[], total: info?.totalItems ?? (json.items?.length ?? 0), tags: json.tags as GalleryTagVocabulary };
    },
    item: (slug) => data("GET", `/gms/gallery/${e(slug)}`, undefined, false),
    copy: (workspaceId, slug) => data("POST", `${ws(workspaceId)}/items/${e(slug)}/copy`, {}),
    preview: (workspaceId, input) => data("POST", `${ws(workspaceId)}/preview`, input),
    submissions: (workspaceId) => items(`${ws(workspaceId)}/submissions`),
    submit: (workspaceId, input) => data("POST", `${ws(workspaceId)}/submissions`, input),
    withdraw: (workspaceId, id) => data("POST", `${ws(workspaceId)}/submissions/${e(id)}/withdraw`, {}),
    isModerator: async () => (await data<{ moderator: boolean }>("GET", "/gms/gallery/moderation/me")).moderator,
    queue: () => items("/gms/gallery/moderation/queue"),
    approve: (id, input = {}) => data("POST", `/gms/gallery/moderation/submissions/${e(id)}/approve`, input),
    reject: (id, reason) => data("POST", `/gms/gallery/moderation/submissions/${e(id)}/reject`, { reason }),
  };
}
