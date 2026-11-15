// SPDX-License-Identifier: AGPL-3.0-only
// In-browser template gallery for mock mode. The nine starter items are the same JSON the server's
// migration inserts (galleryStarters.json, kept equal by an API test); a funder's published item,
// a submission waiting for review and a declined one mirror supabase/seed.sql. Copying goes
// through the mock API's own create calls, so the copy opens in the form builder like any form.
// The demo person moderates the gallery, so the queue can be tried.
import { ApiError, type GmsApi } from "../api/client.ts";
import type { GalleryApi, GalleryCard, GalleryItem, GalleryKind, GalleryPreview, GalleryQueueItem, GallerySnapshot, GalleryStripped, GallerySubmission, GalleryTags } from "../api/gallery.ts";
import { LICENCE } from "../api/gallery.ts";
import type { Session } from "../auth/types.ts";
import starters from "./galleryStarters.json";

const clone = <T>(v: T): T => structuredClone(v);
const VOCABULARY = {
  fieldOfWork: ["Any field", "Arts and culture", "Community development", "Education", "Environment", "Health", "Housing", "Human services", "Youth and families"],
  grantSize: ["Under $10,000", "$10,000 to $50,000", "$50,000 to $250,000", "Over $250,000", "Any size"],
  audience: ["Nonprofits", "Community groups", "Schools", "Small organizations", "Faith-based organizations"],
};
const PLACEHOLDER = "[Your organization]";

interface StoredItem extends Omit<GalleryItem, "author" | "contents" | "licence"> {
  authorWorkspaceId: string | null;
  status: "approved" | "withdrawn";
}
interface StoredSubmission extends GallerySubmission {
  workspaceId: string;
  snapshot: GallerySnapshot;
}
export interface GalleryStore {
  items: StoredItem[];
  submissions: StoredSubmission[];
  /** Who moderates in the mock: the demo person, unless a test says otherwise. */
  moderatorEmails: string[];
}

const WORKSPACE_NAMES: Record<string, { name: string; verified: boolean }> = {
  "20000000-0000-7000-8000-000000000001": { name: "Riverbend Community Foundation", verified: true },
  "20000000-0000-7000-8000-000000000002": { name: "Cascade County Health Department", verified: true },
  "20000000-0000-7000-8000-000000000003": { name: "Summitline Corporate Giving", verified: true },
};

const noTags = (): GalleryTags => ({ fieldOfWork: [], grantSize: [], audience: [] });

export function seedGalleryStore(): GalleryStore {
  const items: StoredItem[] = (starters.items as unknown as (Omit<StoredItem, "authorWorkspaceId" | "status" | "usesCount" | "version" | "publishedAt">)[]).map((s, i) => ({
    ...clone(s),
    authorWorkspaceId: null,
    status: "approved",
    usesCount: [41, 17, 12, 33, 9, 14, 21, 19, 8][i] ?? 0,
    version: 1,
    publishedAt: starters.publishedAt,
  }));
  const health: GallerySnapshot = {
    forms: [
      {
        title: "Community health mini-grant application",
        description: "A short application for neighborhood health projects.",
        instructions: `Tell us about your idea in your own words. ${PLACEHOLDER} staff are glad to talk it through before you apply.`,
        purpose: "application",
        jsonSchema: { type: "object", required: ["projectTitle", "idea", "requestedAmount"], properties: { projectTitle: { type: "string", title: "Project name", maxLength: 200 }, idea: { type: "string", title: "Your idea", "x-wordCount": { max: 200 } }, neighbors: { type: "string", title: "Who in the neighborhood it helps", "x-wordCount": { max: 100 } }, requestedAmount: { type: "object", title: "Amount requested" } } },
        uiSchema: { type: "VerticalLayout", elements: [{ type: "Control", scope: "#/properties/projectTitle" }, { type: "Control", scope: "#/properties/idea", options: { help: "What you will do and why it matters to your neighbors." } }, { type: "Control", scope: "#/properties/neighbors" }, { type: "Control", scope: "#/properties/requestedAmount", options: { widget: "money", widgetOptions: { currency: "USD" } } }] },
        mappingFromCommonGrants: {},
        mappingToCommonGrants: { title: { field: "projectTitle" }, requestedAmount: { field: "requestedAmount" } },
        fieldMeta: {},
      },
    ],
    rubrics: [],
    emails: [],
  };
  items.push({ id: "36100000-0000-7000-8000-000000000001", slug: "community-health-mini-grant", kind: "application_form", title: "Community health mini-grant application", summary: "A one-page application for mini-grants of up to $5,000 for neighborhood health projects.", tags: { fieldOfWork: ["Health"], grantSize: ["Under $10,000"], audience: ["Community groups", "Nonprofits"] }, authorWorkspaceId: "20000000-0000-7000-8000-000000000002", status: "approved", usesCount: 4, version: 1, publishedAt: "2027-01-20T17:00:00Z", snapshot: health });
  const pending: StoredSubmission = {
    id: "36200000-0000-7000-8000-000000000002",
    workspaceId: "20000000-0000-7000-8000-000000000001",
    kind: "rubric",
    title: "Letter of inquiry screen",
    summary: "A two-criterion screen for letters of inquiry: fit and readiness.",
    tags: { fieldOfWork: ["Any field"], grantSize: ["Any size"], audience: ["Nonprofits"] },
    status: "pending",
    source: { type: "rubric", id: "41000000-0000-7000-8000-000000000002", version: 1 },
    stripped: [{ path: "rubrics[0].name", where: "Rubric name", what: "name", found: ["organization name"] }],
    decisionReason: null,
    decidedAt: null,
    withdrawnAt: null,
    item: null,
    licence: LICENCE,
    createdAt: "2027-04-10T16:00:00Z",
    snapshot: { forms: [], rubrics: [{ name: `${PLACEHOLDER} LOI screen`, criteria: [{ key: "fit", label: "Fit with program goals", weight: 0.6, scale: { type: "numeric", min: 1, max: 5 } }, { key: "readiness", label: "Readiness", weight: 0.4, scale: { type: "numeric", min: 1, max: 5 } }], overall: { recommendations: ["invite", "decline"] } }], emails: [] },
  };
  return { items, submissions: [pending], moderatorEmails: [] };
}

// ---------------------------------------------------------------- stripping (as the server does)

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const URL_LIKE = /\b(?:https?:\/\/|www\.)[^\s<>()"'\]]+|\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:org|com|net|edu|gov|io|us|info|co|uk|ca|example)\b(?:\/[^\s<>()"'\]]*)?/gi;
const PHONE = /\+?\(?\d[\d\s().-]{5,}\d/g;
const isPhone = (s: string) => {
  const t = s.trim();
  if (/^\d{4}\s*[-–]\s*\d{4}$/.test(t) || /^\d{4}-\d{2}-\d{2}$/.test(t)) return false;
  const digits = t.replace(/\D/g, "").length;
  return digits >= 7 && digits <= 15 && (digits >= 10 || /[\s().-]/.test(t) || t.startsWith("+"));
};
type Found = GalleryStripped["found"][number];
function redact(text: string): { text: string; found: Found[] } {
  const found = new Set<Found>();
  let out = text.replace(EMAIL, () => (found.add("email"), "[email address]"));
  out = out.replace(URL_LIKE, () => (found.add("link"), "[web address]"));
  out = out.replace(PHONE, (m) => (isPhone(m) ? (found.add("phone"), "[phone number]") : m));
  return { text: out, found: [...found] };
}
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function stripAll(snapshot: GallerySnapshot, names: string[]): { snapshot: GallerySnapshot; stripped: GalleryStripped[] } {
  const stripped: GalleryStripped[] = [];
  const sorted = names.filter((n) => n.trim().length >= 3).sort((a, b) => b.length - a.length);
  const text = (value: string, path: string, where: string) => {
    const r = redact(value);
    if (r.found.length) stripped.push({ path, where, what: "text", found: r.found });
    let out = r.text;
    let named = false;
    for (const n of sorted) out = out.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(n)}(?![\\p{L}\\p{N}])`, "giu"), () => ((named = true), PLACEHOLDER));
    if (named) stripped.push({ path, where, what: "name", found: ["organization name"] });
    return out;
  };
  const help = (value: string, path: string, where: string): string | undefined => {
    const r = redact(value);
    if (r.found.length) {
      stripped.push({ path, where, what: "help", found: r.found });
      return undefined;
    }
    return text(value, path, where);
  };
  const walk = (node: unknown, path: string, where: string): unknown => {
    if (Array.isArray(node)) return node.map((n, i) => walk(n, `${path}[${i}]`, where));
    if (!node || typeof node !== "object") return node;
    const out: Record<string, unknown> = {};
    const o = node as Record<string, unknown>;
    const name = typeof o.title === "string" ? o.title : typeof o.label === "string" ? o.label : where;
    for (const [k, v] of Object.entries(o)) {
      const p = `${path}.${k}`;
      if ((k === "default" || k === "examples") && redact(JSON.stringify(v)).found.length) stripped.push({ path: p, where: `${name} · default value`, what: "default", found: redact(JSON.stringify(v)).found });
      else if ((k === "description" || k === "help" || k === "placeholder" || k === "guidance") && typeof v === "string") {
        const kept = help(v, p, `${name} · help text`);
        if (kept !== undefined) out[k] = kept;
      } else if ((k === "title" || k === "label" || k === "name" || k === "subject" || k === "body" || k === "instructions" || k === "const") && typeof v === "string") out[k] = text(v, p, name);
      else if (k === "scope" || k === "type" || k === "key" || k === "field" || k === "purpose") out[k] = v;
      else out[k] = walk(v, p, name);
    }
    return out;
  };
  return { snapshot: walk(snapshot, "", "Content") as GallerySnapshot, stripped };
}

// ---------------------------------------------------------------- the mock port

export interface MockGalleryDeps {
  session: () => Promise<Session | null>;
  api: GmsApi;
  store: GalleryStore;
}

export function createMockGalleryApi(deps: MockGalleryDeps): GalleryApi {
  const { store, api } = deps;
  const authorOf = (id: string | null) => (id ? { kind: "workspace" as const, ...(WORKSPACE_NAMES[id] ?? { name: "A funder", verified: false }) } : { kind: "opengrants" as const, name: "OpenGrants starter library", verified: false });
  const contents = (s: GallerySnapshot) => ({ forms: s.forms.length, rubrics: s.rubrics.length, emails: s.emails.length, questions: s.forms.reduce((n, f) => n + Object.keys((f.jsonSchema.properties as Record<string, unknown> | undefined) ?? {}).length, 0) });
  const card = (i: StoredItem): GalleryCard => {
    const { authorWorkspaceId, status: _s, snapshot, ...rest } = i;
    return clone({ ...rest, author: authorOf(authorWorkspaceId), licence: LICENCE, contents: contents(snapshot) });
  };
  const signedIn = async () => {
    const s = await deps.session();
    if (!s) throw new ApiError(401, "Sign in to continue");
    return s;
  };
  const membership = async (workspaceId: string) => {
    await signedIn();
    const me = await api.me();
    const m = me.workspaces.find((w) => w.id === workspaceId);
    if (!m) throw new ApiError(403, "You are not a member of this workspace");
    if (m.kind !== "funder") throw new ApiError(403, "This action belongs to funder workspaces");
    // Opening the workspace points the mock API's create calls at it.
    await api.workspace(m.handle);
    return m;
  };
  const moderator = async () => {
    const s = await signedIn();
    return store.moderatorEmails.length === 0 || store.moderatorEmails.includes(s.email.toLowerCase());
  };
  const view = (s: StoredSubmission): GallerySubmission => {
    const { workspaceId: _w, snapshot: _s, ...rest } = s;
    const item = s.item ? store.items.find((i) => i.slug === s.item!.slug) : null;
    return clone({ ...rest, item: item ? { slug: item.slug, live: item.status === "approved" } : null });
  };
  const live = (slug: string) => {
    const item = store.items.find((i) => i.slug === slug && i.status === "approved");
    if (!item) throw new ApiError(404, "Template not found");
    return item;
  };

  async function source(workspaceId: string, src: { type: string; id: string; version?: number }): Promise<{ kind: GalleryKind; snapshot: GallerySnapshot; version: number; title: string }> {
    if (src.type === "form") {
      // The latest published version, as the server shares, unless one is named.
      let f = await api.getForm(src.id, src.version);
      for (let v = f.version - 1; !src.version && f.status !== "published" && v >= 1; v--) f = await api.getForm(src.id, v);
      if (f.status !== "published") throw new ApiError(409, "Publish the form before you share it: the gallery shares a published version");
      const kind: GalleryKind | null = f.purpose === "report" ? "report_form" : f.purpose === "application" || f.purpose === "loi" ? "application_form" : null;
      if (!kind) throw new ApiError(422, "Only application, letter-of-intent and report forms can be shared to the gallery");
      return { kind, version: f.version, title: f.title, snapshot: { forms: [{ title: f.title, description: f.description, instructions: f.instructions, purpose: f.purpose, jsonSchema: f.jsonSchema as unknown as Record<string, unknown>, uiSchema: f.uiSchema as unknown as Record<string, unknown>, mappingFromCommonGrants: f.mappingFromCommonGrants, mappingToCommonGrants: f.mappingToCommonGrants, fieldMeta: f.fieldMeta }], rubrics: [], emails: [] } };
    }
    if (src.type === "rubric") {
      const r = (await api.listRubrics()).find((x) => x.id === src.id && !x.shared);
      if (!r) throw new ApiError(404, "Rubric not found");
      return { kind: "rubric", version: r.version, title: r.name, snapshot: { forms: [], rubrics: [{ name: r.name, criteria: clone(r.criteria) as unknown as Record<string, unknown>[], overall: clone(r.overall ?? {}) }], emails: [] } };
    }
    const t = (await api.listTemplates()).items.find((x) => x.id === src.id);
    if (!t) throw new ApiError(404, "Template not found");
    if (t.kind !== "email") throw new ApiError(422, "Only email templates can be shared to the gallery; letters and agreements stay with the workspace");
    void workspaceId;
    return { kind: "email_template", version: t.version, title: t.name, snapshot: { forms: [], rubrics: [], emails: [{ name: t.name, subject: t.subject ?? t.name, body: t.body }] } };
  }
  const namesFor = (workspaceId: string, extra: string[] = []) => [...new Set([WORKSPACE_NAMES[workspaceId]?.name, ...extra].filter((n): n is string => !!n))];

  return {
    async list(filter = {}) {
      const tag = filter.tag?.toLowerCase();
      const words = (filter.q ?? "").toLowerCase().split(/\s+/).filter(Boolean);
      const hit = store.items.filter((i) => {
        if (i.status !== "approved" || (filter.kind && i.kind !== filter.kind)) return false;
        const tags = [...i.tags.fieldOfWork, ...i.tags.grantSize, ...i.tags.audience].map((t) => t.toLowerCase());
        if (tag && !tags.includes(tag)) return false;
        const hay = `${i.title} ${i.summary} ${tags.join(" ")} ${i.kind.replace(/_/g, " ")}`.toLowerCase();
        return words.every((w) => hay.includes(w));
      });
      hit.sort((a, b) => b.usesCount - a.usesCount || a.title.localeCompare(b.title));
      return { items: hit.map(card), total: hit.length, tags: clone(VOCABULARY) };
    },
    async item(slug) {
      const i = live(slug);
      return { ...card(i), snapshot: clone(i.snapshot) };
    },
    async copy(workspaceId, slug) {
      const m = await membership(workspaceId);
      const item = live(slug);
      if (!["admin", "program_officer"].includes(m.role)) throw new ApiError(403, "Your role cannot create forms in this workspace");
      const created: GalleryCopyCreated[] = [];
      const taken = new Set((await api.listTemplates("email")).items.map((t) => t.name.toLowerCase()));
      for (const f of item.snapshot.forms) {
        const form = await api.createForm({ title: f.title, description: f.description, instructions: f.instructions, purpose: f.purpose, jsonSchema: clone(f.jsonSchema), uiSchema: clone(f.uiSchema), mappingFromCommonGrants: clone(f.mappingFromCommonGrants), mappingToCommonGrants: clone(f.mappingToCommonGrants), fieldMeta: clone(f.fieldMeta) } as unknown as Parameters<GmsApi["createForm"]>[0]);
        created.push({ type: "form", id: form.id, title: form.title, purpose: form.purpose });
      }
      for (const r of item.snapshot.rubrics) {
        const rubric = await api.createRubric({ name: r.name, criteria: clone(r.criteria) as never, overall: clone(r.overall) as never });
        created.push({ type: "rubric", id: rubric.id, title: rubric.name });
      }
      for (const e of item.snapshot.emails) {
        const name = taken.has(e.name.toLowerCase()) ? `${e.name} (from the gallery)` : e.name;
        const t = await api.createTemplate({ kind: "email", name, subject: e.subject, body: e.body });
        created.push({ type: "template", id: t.id, title: t.name });
      }
      item.usesCount += 1;
      return { item: { id: item.id, slug: item.slug, title: item.title, kind: item.kind, usesCount: item.usesCount }, created };
    },
    async preview(workspaceId, input): Promise<GalleryPreview> {
      const m = await membership(workspaceId);
      if (m.role !== "admin") throw new ApiError(403, "Only a workspace admin shares to the gallery");
      const src = await source(workspaceId, input.source);
      const names = namesFor(workspaceId, input.extraNames);
      const { snapshot, stripped } = stripAll(src.snapshot, names);
      return { kind: src.kind, source: { type: input.source.type, version: src.version }, suggestedTitle: stripAll({ forms: [], rubrics: [], emails: [{ name: src.title, subject: "", body: "" }] }, names).snapshot.emails[0]!.name, names, placeholder: PLACEHOLDER, snapshot, stripped, licence: LICENCE };
    },
    async submissions(workspaceId) {
      await membership(workspaceId);
      return store.submissions.filter((s) => s.workspaceId === workspaceId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(view);
    },
    async submit(workspaceId, input) {
      const m = await membership(workspaceId);
      if (m.role !== "admin") throw new ApiError(403, "Only a workspace admin shares to the gallery");
      if (input.licence !== "CC-BY-4.0") throw new ApiError(400, "Agree to share under CC BY 4.0");
      const src = await source(workspaceId, input.source);
      if (store.submissions.some((s) => s.workspaceId === workspaceId && s.status === "pending" && s.source.id === input.source.id)) throw new ApiError(409, "This is already waiting for review. Withdraw it first to send a new version");
      const names = namesFor(workspaceId, input.extraNames);
      const { snapshot, stripped } = stripAll(src.snapshot, names);
      const line = stripAll({ forms: [], rubrics: [], emails: [{ name: input.title, subject: input.summary, body: "" }] }, names).snapshot.emails[0]!;
      const row: StoredSubmission = { id: crypto.randomUUID(), workspaceId, kind: src.kind, title: line.name, summary: line.subject, tags: clone(input.tags ?? noTags()), status: "pending", source: { type: input.source.type, id: input.source.id, version: src.version }, stripped, decisionReason: null, decidedAt: null, withdrawnAt: null, item: null, licence: LICENCE, createdAt: new Date().toISOString(), snapshot };
      store.submissions.push(row);
      return view(row);
    },
    async withdraw(workspaceId, id) {
      const m = await membership(workspaceId);
      if (m.role !== "admin") throw new ApiError(403, "Only a workspace admin withdraws from the gallery");
      const row = store.submissions.find((s) => s.id === id && s.workspaceId === workspaceId);
      if (!row) throw new ApiError(404, "Submission not found");
      if (row.status !== "pending" && row.status !== "approved") throw new ApiError(409, `This submission is ${row.status === "rejected" ? "declined" : row.status}; it can no longer be withdrawn.`);
      row.status = "withdrawn";
      row.withdrawnAt = new Date().toISOString();
      const item = row.item ? store.items.find((i) => i.slug === row.item!.slug) : null;
      if (item) item.status = "withdrawn";
      return view(row);
    },
    async isModerator() {
      return moderator();
    },
    async queue(): Promise<GalleryQueueItem[]> {
      if (!(await moderator())) throw new ApiError(403, "Only the gallery's moderators can review submissions");
      return store.submissions.filter((s) => s.status === "pending").sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map((s) => ({ ...view(s), snapshot: clone(s.snapshot), author: authorOf(s.workspaceId) }));
    },
    async approve(id, input = {}) {
      if (!(await moderator())) throw new ApiError(403, "Only the gallery's moderators can review submissions");
      const row = store.submissions.find((s) => s.id === id);
      if (!row) throw new ApiError(404, "Submission not found");
      if (row.status !== "pending") throw new ApiError(409, "This submission is no longer waiting for review.");
      const base = (input.slug ?? row.title).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 70) || "template";
      let slug = base;
      for (let n = 2; store.items.some((i) => i.slug === slug); n++) slug = `${base}-${n}`;
      const item: StoredItem = { id: crypto.randomUUID(), slug, kind: row.kind, title: row.title, summary: row.summary, tags: clone(row.tags), authorWorkspaceId: row.workspaceId, status: "approved", usesCount: 0, version: 1, publishedAt: new Date().toISOString(), snapshot: clone(row.snapshot) };
      store.items.push(item);
      Object.assign(row, { status: "approved", decidedAt: new Date().toISOString(), item: { slug, live: true } });
      return { submission: view(row), item: { slug, id: item.id } };
    },
    async reject(id, reason) {
      if (!(await moderator())) throw new ApiError(403, "Only the gallery's moderators can review submissions");
      const row = store.submissions.find((s) => s.id === id);
      if (!row) throw new ApiError(404, "Submission not found");
      if (row.status !== "pending") throw new ApiError(409, "This submission is no longer waiting for review.");
      if (reason.trim().length < 3) throw new ApiError(400, "Say why it is declined, so the author can fix it.");
      Object.assign(row, { status: "rejected", decidedAt: new Date().toISOString(), decisionReason: reason.trim() });
      return view(row);
    },
  };
}

type GalleryCopyCreated = Awaited<ReturnType<GalleryApi["copy"]>>["created"][number];
