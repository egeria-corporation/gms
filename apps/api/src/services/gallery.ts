// SPDX-License-Identifier: AGPL-3.0-only
// The template gallery. Anyone reads approved items (public, no token); a funder
// workspace copies one into its own drafts through the same create paths as its screens; a
// funder workspace admin shares one of its own forms, rubrics or email templates; an operator
// listed in GALLERY_MODERATORS approves or declines it. Moderation moves run through
// `@gms/workflow` (galleryMove): guard → write → ledger. Submitting, withdrawing and moderating
// are human only on every surface; the MCP server offers the reads alone.
//
// What is shared is a snapshot taken at submission, never a link to the author's record. Before it
// is saved the snapshot loses every email address, phone number and web address other than the
// funder's own site (a field's default value or help text that holds one is dropped; any other
// text has it replaced), and the organization's own names become "[Your organization]".
import { GALLERY_SUBMITTED_EVENT, galleryMove, type GalleryAction, type GalleryActor } from "@gms/workflow";
import { z } from "zod";
import { ApiError } from "../lib/errors.ts";
import { apiId, bareUuid, uuidOf } from "../lib/ids.ts";
import { parse } from "../lib/input.ts";
import { STAFF_ROLES, humanOnly } from "./awards.ts";
import { audit, authorize, guardWrite, required, type Need, type ServiceContext } from "./context.ts";
import { createForm } from "./forms.ts";
import type { EmailSnap, FormSnap, GalleryKind, GalleryTags, RubricSnap, Snapshot } from "./gallery-starters.ts";
import { slugify } from "./opportunities.ts";
import { orgFacts, profileSourceOf } from "./profile.ts";
import { createRubric, rubricInput } from "./programs.ts";
import type { PublicContext } from "./public.ts";
import type { Row } from "./repos/types.ts";
import { createTemplate, splitSubject, templateInput } from "./templates.ts";

export type { GalleryKind, GalleryTags, Snapshot } from "./gallery-starters.ts";

type Item = Row<"gallery_items">;
type Submission = Row<"gallery_submissions">;
type Ws = Row<"workspaces">;

export const GALLERY_KINDS = ["application_form", "report_form", "rubric", "email_template", "program_kit"] as const;
/** What a workspace can share; a program kit is assembled by OpenGrants (the starter library). */
export const SUBMITTABLE_KINDS = ["application_form", "report_form", "rubric", "email_template"] as const;

/**
 * The tag vocabularies. Fixed lists so filters stay meaningful; one place to add a value (the
 * database checks only the shape).
 */
export const GALLERY_TAGS = {
  fieldOfWork: ["Any field", "Arts and culture", "Community development", "Education", "Environment", "Health", "Housing", "Human services", "Youth and families"],
  grantSize: ["Under $10,000", "$10,000 to $50,000", "$50,000 to $250,000", "Over $250,000", "Any size"],
  audience: ["Nonprofits", "Community groups", "Schools", "Small organizations", "Faith-based organizations"],
} as const satisfies Record<keyof GalleryTags, readonly string[]>;

/** Everything in the gallery is shared under CC BY 4.0, and the pages say so. */
export const GALLERY_LICENCE = { code: "CC-BY-4.0", name: "CC BY 4.0", url: "https://creativecommons.org/licenses/by/4.0/" } as const;
export const ORG_PLACEHOLDER = "[Your organization]";
export const REDACTED = { email: "[email address]", phone: "[phone number]", link: "[web address]" } as const;

// ------------------------------------------------------------------------------------ moderators

export interface Moderator {
  userId: string;
  email: string | null;
  /** Whether the session came through single sign-on (any `sso/saml` entry in `amr`). */
  viaSso: boolean;
}

/**
 * An email address in GALLERY_MODERATORS or DIRECTORY_MODERATORS matches only a session that did not
 * come through single sign-on: a workspace's identity provider can assert any address (docs/sso.md),
 * so its word never makes a moderator. A user id always matches. The same rule as the operators'
 * (OPERATOR_EMAIL_MATCHES_SSO_SESSIONS). Set true to let SSO sessions match by email too.
 */
export const MODERATOR_EMAIL_MATCHES_SSO_SESSIONS = false;

/** GALLERY_MODERATORS: comma-separated user ids or email addresses (a Wrangler secret, so the addresses are never published). */
export function moderatorsOf(raw: string | null | undefined): { ids: Set<string>; emails: Set<string> } {
  const ids = new Set<string>();
  const emails = new Set<string>();
  for (const part of (raw ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)) {
    if (part.includes("@")) emails.add(part);
    else if (/^[0-9a-f-]{36}$/.test(part)) ids.add(part);
  }
  return { ids, emails };
}

export function isModerator(raw: string | null | undefined, who: Moderator): boolean {
  const m = moderatorsOf(raw);
  if (m.ids.has(who.userId.toLowerCase())) return true;
  if (who.viaSso && !MODERATOR_EMAIL_MATCHES_SSO_SESSIONS) return false;
  return !!who.email && m.emails.has(who.email.trim().toLowerCase());
}

function assertModerator(ctx: ServiceContext, raw: string | null | undefined, who: Moderator) {
  if (ctx.actor.kind !== "user" || ctx.actor.userId !== who.userId) throw humanOnly("Moderating the gallery");
  if (!isModerator(raw, who)) throw new ApiError(403, "not_a_moderator", "Only the gallery's moderators can review submissions");
}

// ------------------------------------------------------------------------------------ stripping

export type StripWhat = "default" | "help" | "text" | "name";
export type StripFound = "email" | "phone" | "link" | "organization name";
/** One thing taken out of a snapshot. The value itself is never kept. */
export interface Stripped {
  path: string;
  /** Where a person finds it, e.g. "Contact email · help text". */
  where: string;
  what: StripWhat;
  found: StripFound[];
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const URL_LIKE = /\b(?:https?:\/\/|www\.)[^\s<>()"'\]]+|\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:org|com|net|edu|gov|io|us|info|co|uk|ca|example)\b(?:\/[^\s<>()"'\]]*)?/gi;
const PHONE_CANDIDATE = /\+?\(?\d[\d\s().-]{5,}\d/g;
const YEAR_RANGE = /^\d{4}\s*[-–]\s*\d{4}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isPhone(candidate: string): boolean {
  const s = candidate.trim();
  if (YEAR_RANGE.test(s) || ISO_DATE.test(s)) return false;
  const digits = s.replace(/\D/g, "").length;
  if (digits < 7 || digits > 15) return false;
  // Seven to nine digits only count with the separators a phone number is written with.
  return digits >= 10 || /[\s().-]/.test(s) || s.startsWith("+");
}

const hostOf = (raw: string): string | null => {
  try {
    return new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
};
/** A web address on the funder's own site (or one of its subdomains) stays. */
const ownSite = (raw: string, allowed: readonly string[]) => {
  const host = hostOf(raw);
  return !!host && allowed.some((a) => host === a || host.endsWith(`.${a}`));
};

/** Contact details in a text, by kind. Email addresses are found first so their domains are not read as web addresses. */
export function findContacts(text: string, allowedHosts: readonly string[] = []): StripFound[] {
  const found = new Set<StripFound>();
  const rest = text.replace(EMAIL, () => {
    found.add("email");
    return " ";
  });
  for (const m of rest.match(URL_LIKE) ?? []) if (!ownSite(m, allowedHosts)) found.add("link");
  const noLinks = rest.replace(URL_LIKE, " ");
  for (const m of noLinks.match(PHONE_CANDIDATE) ?? []) if (isPhone(m)) found.add("phone");
  return [...found];
}

/** The text with each contact detail replaced by a placeholder. */
export function redactContacts(text: string, allowedHosts: readonly string[] = []): { text: string; found: StripFound[] } {
  const found = new Set<StripFound>();
  let out = text.replace(EMAIL, () => {
    found.add("email");
    return REDACTED.email;
  });
  out = out.replace(URL_LIKE, (m) => {
    if (ownSite(m, allowedHosts)) return m;
    found.add("link");
    return REDACTED.link;
  });
  out = out.replace(PHONE_CANDIDATE, (m) => {
    if (!isPhone(m)) return m;
    found.add("phone");
    // Keep the space or punctuation the match swallowed at either end.
    return REDACTED.phone;
  });
  return { text: out, found: [...found] };
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Replace each name (longest first, whole words, any case) with the placeholder. */
export function replaceNames(text: string, names: readonly string[]): { text: string; replaced: boolean } {
  let out = text;
  let replaced = false;
  for (const name of [...names].sort((a, b) => b.length - a.length)) {
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(name)}(?![\\p{L}\\p{N}])`, "giu");
    out = out.replace(re, () => {
      replaced = true;
      return ORG_PLACEHOLDER;
    });
  }
  return { text: out, replaced };
}

export interface StripOptions {
  /** The organization's names (display, legal, Passport) plus any the person added. */
  names: string[];
  /** Hosts of the funder's own site; web addresses there are kept. */
  allowedHosts: string[];
}

type J = Record<string, unknown>;
const isObj = (v: unknown): v is J => !!v && typeof v === "object" && !Array.isArray(v);

class Stripper {
  readonly stripped: Stripped[] = [];
  constructor(private readonly opts: StripOptions) {}

  private note(path: string, where: string, what: StripWhat, found: StripFound[]) {
    if (found.length) this.stripped.push({ path, where, what, found });
  }

  /** Free text: contact details replaced in place, then the organization's names. */
  text(value: string, path: string, where: string): string {
    const r = redactContacts(value, this.opts.allowedHosts);
    if (r.found.length) this.note(path, where, "text", r.found);
    const n = replaceNames(r.text, this.opts.names);
    if (n.replaced) this.note(path, where, "name", ["organization name"]);
    return n.text;
  }

  /** A default value or help text: dropped whole when it holds a contact detail (returns undefined). */
  dropIfContact(value: unknown, path: string, where: string, what: "default" | "help"): unknown {
    const flat = typeof value === "string" ? value : JSON.stringify(value);
    const found = findContacts(flat, this.opts.allowedHosts);
    if (found.length) {
      this.note(path, where, what, found);
      return undefined;
    }
    return typeof value === "string" ? this.text(value, path, where) : this.deepNames(value, path, where);
  }

  private deepNames(value: unknown, path: string, where: string): unknown {
    if (typeof value === "string") return this.text(value, path, where);
    if (Array.isArray(value)) return value.map((v, i) => this.deepNames(v, `${path}[${i}]`, where));
    if (isObj(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, this.deepNames(v, `${path}.${k}`, where)]));
    return value;
  }

  schema(node: unknown, path: string, label: string): unknown {
    if (!isObj(node)) return node;
    const out: J = {};
    const name = typeof node.title === "string" && node.title.trim() ? node.title : label;
    for (const [k, v] of Object.entries(node)) {
      const p = `${path}.${k}`;
      if (k === "default" || k === "examples") {
        const kept = this.dropIfContact(v, p, `${name} · default value`, "default");
        if (kept !== undefined) out[k] = kept;
      } else if (k === "description" && typeof v === "string") {
        const kept = this.dropIfContact(v, p, `${name} · help text`, "help");
        if (kept !== undefined) out[k] = kept;
      } else if (k === "title" && typeof v === "string") {
        out[k] = this.text(v, p, `${name} · question`);
      } else if ((k === "properties" || k === "$defs") && isObj(v)) {
        out[k] = Object.fromEntries(Object.entries(v).map(([key, s]) => [key, this.schema(s, `${p}.${key}`, key)]));
      } else if ((k === "items" || k === "if" || k === "then" || k === "else") && isObj(v)) {
        out[k] = this.schema(v, p, name);
      } else {
        out[k] = v;
      }
    }
    return out;
  }

  ui(node: unknown, path: string, titles: Map<string, string>): unknown {
    if (Array.isArray(node)) return node.map((n, i) => this.ui(n, `${path}[${i}]`, titles));
    if (!isObj(node)) return node;
    const scope = typeof node.scope === "string" ? node.scope : null;
    const name = (typeof node.label === "string" && node.label) || (scope ? (titles.get(scope) ?? scope.split("/").pop()!) : "Section");
    const out: J = {};
    for (const [k, v] of Object.entries(node)) {
      const p = `${path}.${k}`;
      if (k === "label" && typeof v === "string") out[k] = this.text(v, p, `${name} · label`);
      else if (k === "elements") out[k] = this.ui(v, p, titles);
      else if (k === "options" && isObj(v)) {
        const opts: J = {};
        for (const [ok, ov] of Object.entries(v)) {
          if ((ok === "help" || ok === "placeholder" || ok === "description") && typeof ov === "string") {
            const kept = this.dropIfContact(ov, `${p}.${ok}`, `${name} · ${ok === "placeholder" ? "placeholder" : "help text"}`, "help");
            if (kept !== undefined) opts[ok] = kept;
          } else opts[ok] = ov;
        }
        out[k] = opts;
      } else out[k] = v;
    }
    return out;
  }

  /** Constant values in a mapping are text the form carries; field references are left alone. */
  mapping(node: unknown, path: string, where: string): unknown {
    if (Array.isArray(node)) return node.map((n, i) => this.mapping(n, `${path}[${i}]`, where));
    if (!isObj(node)) return node;
    return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, k === "const" && typeof v === "string" ? this.text(v, `${path}.${k}`, where) : this.mapping(v, `${path}.${k}`, where)]));
  }
}

function fieldTitles(schema: unknown): Map<string, string> {
  const titles = new Map<string, string>();
  const walk = (node: unknown, scope: string) => {
    if (!isObj(node) || !isObj(node.properties)) return;
    for (const [k, v] of Object.entries(node.properties)) {
      const s = `${scope}/properties/${k}`;
      if (isObj(v) && typeof v.title === "string") titles.set(s, v.title);
      walk(v, s);
    }
  };
  walk(schema, "#");
  return titles;
}

/** A snapshot with contact details and the organization's names taken out, and what was taken. */
export function stripSnapshot(snapshot: Snapshot, opts: StripOptions): { snapshot: Snapshot; stripped: Stripped[] } {
  const s = new Stripper({ names: opts.names.filter((n) => n.trim().length >= 3), allowedHosts: opts.allowedHosts });
  const forms = snapshot.forms.map((f, i): FormSnap => {
    const p = `forms[${i}]`;
    const titles = fieldTitles(f.jsonSchema);
    return {
      title: s.text(f.title, `${p}.title`, "Form title"),
      description: f.description === null ? null : s.text(f.description, `${p}.description`, "Form description"),
      instructions: f.instructions === null ? null : s.text(f.instructions, `${p}.instructions`, "Form instructions"),
      purpose: f.purpose,
      jsonSchema: s.schema(f.jsonSchema, `${p}.jsonSchema`, f.title) as J,
      uiSchema: s.ui(f.uiSchema, `${p}.uiSchema`, titles) as J,
      mappingFromCommonGrants: s.mapping(f.mappingFromCommonGrants, `${p}.mappingFromCommonGrants`, "Prefill mapping") as J,
      mappingToCommonGrants: s.mapping(f.mappingToCommonGrants, `${p}.mappingToCommonGrants`, "CommonGrants mapping") as J,
      fieldMeta: f.fieldMeta,
    };
  });
  const rubrics = snapshot.rubrics.map((r, i): RubricSnap => {
    const p = `rubrics[${i}]`;
    return {
      name: s.text(r.name, `${p}.name`, "Rubric name"),
      criteria: r.criteria.map((c, j) => {
        const cp = `${p}.criteria[${j}]`;
        const out = { ...c, label: s.text(c.label, `${cp}.label`, `${c.label} · criterion`) };
        for (const k of ["description", "guidance"] as const) {
          if (typeof c[k] !== "string") continue;
          const kept = s.dropIfContact(c[k], `${cp}.${k}`, `${c.label} · ${k === "guidance" ? "scoring guidance" : "description"}`, "help");
          if (kept === undefined) delete out[k];
          else out[k] = kept as string;
        }
        if (c.scale.type === "categorical") out.scale = { ...c.scale, options: c.scale.options.map((o, k) => (o.label ? { ...o, label: s.text(o.label, `${cp}.scale.options[${k}].label`, `${c.label} · option`) } : o)) };
        return out;
      }),
      overall: { ...r.overall, ...(r.overall.recommendations ? { recommendations: r.overall.recommendations.map((x, k) => s.text(x, `${p}.overall.recommendations[${k}]`, "Recommendation")) } : {}) },
    };
  });
  const emails = snapshot.emails.map((m, i): EmailSnap => ({
    name: s.text(m.name, `emails[${i}].name`, "Template name"),
    subject: s.text(m.subject, `emails[${i}].subject`, "Email subject"),
    body: s.text(m.body, `emails[${i}].body`, "Email body"),
  }));
  return { snapshot: { forms, rubrics, emails }, stripped: s.stripped };
}

// ------------------------------------------------------------------------------------ views

type ItemCtx = Pick<PublicContext, "repos">;

/** The author line: the workspace's display name, verified only when it is linked to Passport. */
async function authors(ctx: ItemCtx, ids: (string | null)[]) {
  const unique = [...new Set(ids.filter((x): x is string => !!x))];
  const rows = unique.length ? await ctx.repos.table("workspaces").find({ id: unique }) : [];
  return new Map(rows.map((w) => [w.id, w]));
}
const authorOf = (id: string | null, byId: Map<string, Ws>) => {
  if (!id) return { kind: "opengrants" as const, name: "OpenGrants starter library", verified: false };
  const w = byId.get(id);
  return { kind: "workspace" as const, name: w?.display_name ?? "A funder", verified: !!w && profileSourceOf(w) === "passport" };
};
const tagsOf = (t: unknown): GalleryTags => {
  const o = isObj(t) ? t : {};
  const list = (k: string) => (Array.isArray(o[k]) ? (o[k] as unknown[]).filter((x): x is string => typeof x === "string") : []);
  return { fieldOfWork: list("fieldOfWork"), grantSize: list("grantSize"), audience: list("audience") };
};
const snapshotOf = (s: unknown): Snapshot => {
  const o = isObj(s) ? s : {};
  return { forms: (Array.isArray(o.forms) ? o.forms : []) as FormSnap[], rubrics: (Array.isArray(o.rubrics) ? o.rubrics : []) as RubricSnap[], emails: (Array.isArray(o.emails) ? o.emails : []) as EmailSnap[] };
};
const contentsOf = (s: Snapshot) => ({ forms: s.forms.length, rubrics: s.rubrics.length, emails: s.emails.length, questions: s.forms.reduce((n, f) => n + Object.keys((f.jsonSchema.properties as J | undefined) ?? {}).length, 0) });

function card(i: Item, byId: Map<string, Ws>) {
  const snap = snapshotOf(i.snapshot);
  return { id: i.id, slug: i.slug, kind: i.kind as GalleryKind, title: i.title, summary: i.summary, tags: tagsOf(i.tags), author: authorOf(i.author_workspace_id, byId), licence: GALLERY_LICENCE, usesCount: i.uses_count, version: i.version, publishedAt: i.published_at, contents: contentsOf(snap) };
}

// ------------------------------------------------------------------------------------ public reads

export const listQuery = z
  .object({
    kind: z.enum(GALLERY_KINDS).optional(),
    tag: z.string().trim().min(1).max(60).optional(),
    q: z.string().trim().max(200).optional(),
  })
  .strict();

/** Approved items, most used first. Anyone may read them; no token. */
export async function listGallery(ctx: ItemCtx, filter: z.output<typeof listQuery>, page: { offset: number; pageSize: number }) {
  const rows = await ctx.repos.table("gallery_items").find({ status: "approved", ...(filter.kind ? { kind: filter.kind } : {}) });
  const tag = filter.tag?.toLowerCase();
  const words = (filter.q ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const hit = rows.filter((r) => {
    const tags = tagsOf(r.tags);
    const all = [...tags.fieldOfWork, ...tags.grantSize, ...tags.audience].map((t) => t.toLowerCase());
    if (tag && !all.includes(tag)) return false;
    if (!words.length) return true;
    const hay = `${r.title} ${r.summary} ${all.join(" ")} ${r.kind.replace(/_/g, " ")}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
  hit.sort((a, b) => b.uses_count - a.uses_count || a.title.localeCompare(b.title));
  const byId = await authors(ctx, hit.map((r) => r.author_workspace_id));
  return { items: hit.slice(page.offset, page.offset + page.pageSize).map((r) => card(r, byId)), total: hit.length, tags: GALLERY_TAGS };
}

/** One approved item with its full content, for the preview page. */
export async function getGalleryItem(ctx: ItemCtx, slug: string) {
  const row = await ctx.repos.table("gallery_items").one({ slug, status: "approved" });
  if (!row) throw new ApiError(404, "not_found", "Template not found");
  const byId = await authors(ctx, [row.author_workspace_id]);
  return { ...card(row, byId), snapshot: snapshotOf(row.snapshot) };
}

/** The same reads for a workspace member's agent (MCP `search_gallery`, `get_gallery_item`). */
export async function searchGalleryAsMember(ctx: ServiceContext, filter: z.output<typeof listQuery>, page: { offset: number; pageSize: number }) {
  await authorize(ctx, { scope: "forms:read", kind: "funder" });
  return listGallery(ctx, filter, page);
}
export async function getGalleryItemAsMember(ctx: ServiceContext, slug: string) {
  await authorize(ctx, { scope: "forms:read", kind: "funder" });
  return getGalleryItem(ctx, slug);
}

// ------------------------------------------------------------------------------------ copy to a workspace

const NEEDS: Record<"forms" | "rubrics" | "emails", Need> = {
  forms: { scope: "forms:write", kind: "funder" },
  rubrics: { scope: "reviews:write", kind: "funder" },
  emails: { scope: "communications:write", kind: "funder", roles: STAFF_ROLES },
};

/** A template name the workspace does not use yet, so a copy never becomes a new version of its own. */
async function freeTemplateName(ctx: ServiceContext, workspaceId: string, name: string): Promise<string> {
  const taken = new Set((await ctx.repos.table("templates").find({ workspace_id: workspaceId, kind: "email" })).map((t) => t.name.toLowerCase()));
  if (!taken.has(name.toLowerCase())) return name;
  for (let n = 1; n < 100; n++) {
    const candidate = `${name.slice(0, 180)} (from the gallery${n > 1 ? ` ${n}` : ""})`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return `${name.slice(0, 160)} (${crypto.randomUUID().slice(0, 8)})`;
}

async function countUse(ctx: ServiceContext, id: string): Promise<number> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const row = required(await ctx.repos.table("gallery_items").one({ id }), "Template");
    const [saved] = await ctx.repos.table("gallery_items").update({ id, uses_count: row.uses_count }, { uses_count: row.uses_count + 1 });
    if (saved) return saved.uses_count;
  }
  throw new ApiError(409, "conflict", "Too many copies at once. Try again");
}

/**
 * Copy an approved item into the caller's funder workspace: each form becomes a new draft form,
 * the rubric a new rubric and each email a new email template, through the same service functions
 * the screens use. Every permission is checked before anything is made. The copies are the
 * workspace's own: later changes to the gallery item never reach them.
 */
export async function copyGalleryItem(ctx: ServiceContext, slug: string) {
  const ws = await authorize(ctx, { scope: "forms:read", kind: "funder" });
  const row = await ctx.repos.table("gallery_items").one({ slug, status: "approved" });
  if (!row) throw new ApiError(404, "not_found", "Template not found");
  const snap = snapshotOf(row.snapshot);
  for (const part of ["forms", "rubrics", "emails"] as const) if (snap[part].length) await authorize(ctx, NEEDS[part]);
  // Everything is checked before the first record is made, so a copy is never left half done.
  const rubrics = snap.rubrics.map((r) => parse(rubricInput, { name: r.name, criteria: r.criteria, ...(Object.keys(r.overall ?? {}).length ? { overall: r.overall } : {}) }));
  const emails = [];
  for (const m of snap.emails) emails.push(parse(templateInput, { kind: "email", name: await freeTemplateName(ctx, ws.id, m.name), subject: m.subject, body: m.body }));
  const created: { type: "form" | "rubric" | "template"; id: string; title: string; purpose?: string }[] = [];
  for (const f of snap.forms) {
    const form = await createForm(ctx, { title: f.title, description: f.description, instructions: f.instructions, purpose: f.purpose, jsonSchema: f.jsonSchema, uiSchema: f.uiSchema, mappingFromCommonGrants: f.mappingFromCommonGrants, mappingToCommonGrants: f.mappingToCommonGrants, fieldMeta: f.fieldMeta });
    created.push({ type: "form", id: form.id, title: form.title, purpose: form.purpose });
  }
  for (const r of rubrics) {
    const rubric = await createRubric(ctx, r);
    created.push({ type: "rubric", id: rubric.id, title: rubric.name });
  }
  for (const m of emails) {
    const t = await createTemplate(ctx, m);
    created.push({ type: "template", id: t.id, title: t.name });
  }
  const usesCount = await countUse(ctx, row.id);
  await audit(ctx, "gallery.copied", "gallery_item", row.id, { slug: row.slug, version: row.version, created: created.map((c) => ({ type: c.type, id: c.id })) });
  return { item: { id: row.id, slug: row.slug, title: row.title, kind: row.kind as GalleryKind, usesCount }, created };
}

// ------------------------------------------------------------------------------------ sharing

const tagList = <T extends readonly string[]>(values: T) => z.array(z.enum(values as unknown as [string, ...string[]])).max(10).default([]);
export const tagsInput = z.object({ fieldOfWork: tagList(GALLERY_TAGS.fieldOfWork), grantSize: tagList(GALLERY_TAGS.grantSize), audience: tagList(GALLERY_TAGS.audience) }).strict();
const source = z.discriminatedUnion("type", [
  z.object({ type: z.literal("form"), id: z.string().min(1).max(100), version: z.number().int().min(1).optional() }).strict(),
  z.object({ type: z.literal("rubric"), id: z.string().min(1).max(100), version: z.number().int().min(1).optional() }).strict(),
  z.object({ type: z.literal("template"), id: z.string().min(1).max(100) }).strict(),
]);
const extraNames = z.array(z.string().trim().min(3).max(200)).max(10).default([]);
export const previewInput = z.object({ source, extraNames }).strict();
export const submissionInput = z
  .object({
    source,
    title: z.string().trim().min(3).max(200),
    summary: z.string().trim().min(10).max(1000),
    tags: tagsInput.default({ fieldOfWork: [], grantSize: [], audience: [] }),
    extraNames,
    /** The person agrees to share it under CC BY 4.0. */
    licence: z.literal(GALLERY_LICENCE.code),
  })
  .strict();

/** Sharing is for a funder workspace's admins, in person. */
async function sharer(ctx: ServiceContext) {
  const ws = await authorize(ctx, { scope: "workspace:admin", kind: "funder", roles: ["admin"], person: true });
  if (ctx.actor.kind !== "user") throw humanOnly("Sharing to the gallery");
  return ws;
}

/** The names that are this organization's own: what the workspace, its legal record and Passport call it. */
function orgNamesOf(w: Ws): string[] {
  const projected = (w.org_projection as { name?: unknown } | null)?.name;
  const self = (w.self_declared_profile as { legalName?: unknown; name?: unknown } | null) ?? {};
  return [...new Set([w.display_name, w.legal_name, typeof projected === "string" ? projected : null, typeof self.legalName === "string" ? self.legalName : null, typeof self.name === "string" ? self.name : null].filter((n): n is string => !!n && n.trim().length >= 3).map((n) => n.trim()))];
}
function siteHostsOf(w: Ws): string[] {
  const site = (orgFacts(w).org as { socials?: { website?: unknown } }).socials?.website;
  const host = typeof site === "string" ? hostOf(site) : null;
  return host ? [host] : [];
}

const KIND_OF_PURPOSE: Record<string, GalleryKind | undefined> = { application: "application_form", loi: "application_form", report: "report_form" };

/** The snapshot of one of the workspace's own records, before stripping. */
async function sourceSnapshot(ctx: ServiceContext, workspaceId: string, src: z.output<typeof source>): Promise<{ kind: GalleryKind; snapshot: Snapshot; sourceId: string; version: number; title: string }> {
  if (src.type === "form") {
    const id = uuidOf("form", src.id, "Form");
    const rows = (await ctx.repos.table("forms").find({ id, workspace_id: workspaceId })).filter((r) => r.published_at).sort((a, b) => a.version - b.version);
    if (!rows.length && !(await ctx.repos.table("forms").one({ id, workspace_id: workspaceId }))) required(null, "Form");
    const row = src.version ? rows.find((r) => r.version === src.version) : rows[rows.length - 1];
    if (!row) throw new ApiError(409, "form_not_published", src.version ? `Version ${src.version} of this form is not published` : "Publish the form before you share it: the gallery shares a published version");
    const kind = KIND_OF_PURPOSE[row.purpose];
    if (!kind) throw new ApiError(422, "not_shareable", "Only application, letter-of-intent and report forms can be shared to the gallery");
    const form: FormSnap = { title: row.title, description: row.description, instructions: row.instructions, purpose: row.purpose as FormSnap["purpose"], jsonSchema: row.json_schema as J, uiSchema: row.ui_schema as J, mappingFromCommonGrants: row.mapping_from_cg as J, mappingToCommonGrants: row.mapping_to_cg as J, fieldMeta: row.field_meta as J };
    return { kind, snapshot: { forms: [form], rubrics: [], emails: [] }, sourceId: id, version: row.version, title: row.title };
  }
  if (src.type === "rubric") {
    const id = bareUuid(src.id, "Rubric");
    const rows = (await ctx.repos.table("rubrics").find({ id, workspace_id: workspaceId })).sort((a, b) => a.version - b.version);
    const row = required(src.version ? rows.find((r) => r.version === src.version) : rows[rows.length - 1], "Rubric");
    const rubric: RubricSnap = { name: row.name, criteria: row.criteria as unknown as RubricSnap["criteria"], overall: (row.overall ?? {}) as RubricSnap["overall"] };
    return { kind: "rubric", snapshot: { forms: [], rubrics: [rubric], emails: [] }, sourceId: id, version: row.version, title: row.name };
  }
  const id = bareUuid(src.id, "Template");
  const row = required(await ctx.repos.table("templates").one({ id, workspace_id: workspaceId }), "Template");
  if (row.kind !== "email") throw new ApiError(422, "not_shareable", "Only email templates can be shared to the gallery; letters and agreements stay with the workspace");
  const s = splitSubject(row.body);
  return { kind: "email_template", snapshot: { forms: [], rubrics: [], emails: [{ name: row.name, subject: s.subject ?? row.name, body: s.body }] }, sourceId: id, version: row.version, title: row.name };
}

async function prepared(ctx: ServiceContext, input: z.output<typeof previewInput>) {
  const ws = await sharer(ctx);
  const w = required(await ctx.repos.table("workspaces").one({ id: ws.id }), "Workspace");
  const src = await sourceSnapshot(ctx, ws.id, input.source);
  const names = [...new Set([...orgNamesOf(w), ...input.extraNames])];
  const opts = { names, allowedHosts: siteHostsOf(w) };
  const { snapshot, stripped } = stripSnapshot(src.snapshot, opts);
  return { ws, w, src, opts, names, snapshot, stripped };
}

/**
 * What would be shared, without saving anything: the cleaned snapshot, what was taken out, and the
 * organization names that are replaced with "[Your organization]" (the person may add more).
 */
export async function previewSubmission(ctx: ServiceContext, input: z.output<typeof previewInput>) {
  const p = await prepared(ctx, input);
  return { kind: p.src.kind, source: { type: input.source.type, version: p.src.version }, suggestedTitle: replaceNames(redactContacts(p.src.title, p.opts.allowedHosts).text, p.names).text, names: p.names, placeholder: ORG_PLACEHOLDER, snapshot: p.snapshot, stripped: p.stripped, licence: GALLERY_LICENCE };
}

function submissionView(s: Submission, item: Pick<Item, "slug" | "status"> | null) {
  return {
    id: s.id,
    kind: s.kind as GalleryKind,
    title: s.title,
    summary: s.summary,
    tags: tagsOf(s.tags),
    status: s.status as "pending" | "approved" | "rejected" | "withdrawn",
    source: { type: s.source_type, id: s.source_type === "form" ? apiId("form", s.source_id) : s.source_id, version: s.source_version },
    stripped: s.stripped as unknown as Stripped[],
    decisionReason: s.decision_reason,
    decidedAt: s.decided_at,
    withdrawnAt: s.withdrawn_at,
    item: item ? { slug: item.slug, live: item.status === "approved" } : null,
    licence: GALLERY_LICENCE,
    createdAt: s.created_at,
  };
}

/** Share one of the workspace's own records. Nothing is public until a moderator approves it. */
export async function submitToGallery(ctx: ServiceContext, input: z.output<typeof submissionInput>) {
  const p = await prepared(ctx, input);
  const line = new Stripper(p.opts);
  const title = line.text(input.title, "title", "Gallery title");
  const summary = line.text(input.summary, "summary", "Gallery summary");
  const stripped = [...line.stripped, ...p.stripped];
  const pending = await ctx.repos.table("gallery_submissions").one({ workspace_id: p.ws.id, source_type: input.source.type, source_id: p.src.sourceId, status: "pending" });
  if (pending) throw new ApiError(409, "already_submitted", "This is already waiting for review. Withdraw it first to send a new version");
  const row = await guardWrite("A pending submission of this record", () =>
    ctx.repos.table("gallery_submissions").insert({
      workspace_id: p.ws.id,
      submitted_by: ctx.actor.userId!,
      kind: p.src.kind,
      title,
      summary,
      tags: input.tags as unknown as Submission["tags"],
      source_type: input.source.type,
      source_id: p.src.sourceId,
      source_version: p.src.version,
      snapshot: p.snapshot as unknown as Submission["snapshot"],
      stripped: stripped as unknown as Submission["stripped"],
      status: "pending",
      decided_by: null,
      decided_at: null,
      decision_reason: null,
      item_id: null,
      withdrawn_at: null,
    }),
  );
  await audit(ctx, GALLERY_SUBMITTED_EVENT, "gallery_submission", row.id, { kind: row.kind, source: { type: row.source_type, id: row.source_id, version: row.source_version }, stripped: stripped.length });
  return submissionView(row, null);
}

/** The workspace's submissions, newest first, with the moderator's decision and reason. */
export async function listSubmissions(ctx: ServiceContext) {
  const ws = await authorize(ctx, { scope: "forms:read", kind: "funder" });
  const rows = await ctx.repos.table("gallery_submissions").find({ workspace_id: ws.id }, { orderBy: "created_at", ascending: false });
  const itemIds = rows.map((r) => r.item_id).filter((x): x is string => !!x);
  const items = itemIds.length ? await ctx.repos.table("gallery_items").find({ id: itemIds }) : [];
  return rows.map((r) => submissionView(r, items.find((i) => i.id === r.item_id) ?? null));
}

/** One moderation move: guard (@gms/workflow) → write (only if the status is still the one read) → ledger. */
async function move(ctx: ServiceContext, row: Submission, action: GalleryAction, by: GalleryActor, input: { reason?: string | null; patch?: Partial<Submission> } = {}) {
  const m = galleryMove(row.status, action, by, { reason: input.reason ?? null });
  if (!m.ok) throw new ApiError(m.code === "actor_not_allowed" ? 403 : 409, m.code === "guard_failed" ? "guard_failed" : m.code === "actor_not_allowed" ? "actor_not_allowed" : "invalid_transition", m.reason);
  const now = ctx.now().toISOString();
  const patch: Partial<Submission> = {
    status: m.to,
    ...(action === "withdraw" ? { withdrawn_at: now } : { decided_at: now, decided_by: ctx.actor.userId! }),
    ...(action === "reject" ? { decision_reason: m.reason } : {}),
    ...(input.patch ?? {}),
  };
  const [saved] = await ctx.repos.table("gallery_submissions").update({ id: row.id, status: row.status }, patch);
  if (!saved) throw new ApiError(409, "conflict", "This submission changed while you were working on it. Reload it and try again");
  // Written in the author's workspace, so the author's team sees the decision in its ledger.
  await audit(ctx, m.event, "gallery_submission", row.id, { from: m.from, to: m.to, kind: row.kind, ...(saved.item_id ? { itemId: saved.item_id } : {}) }, row.workspace_id);
  return saved;
}

/** Take a submission back: a pending one leaves the queue; a published one leaves the gallery. Copies already made stay with whoever made them. */
export async function withdrawSubmission(ctx: ServiceContext, id: string) {
  const ws = await sharer(ctx);
  const row = required(await ctx.repos.table("gallery_submissions").one({ id, workspace_id: ws.id }), "Submission");
  const saved = await move(ctx, row, "withdraw", "author");
  let item: Item | null = null;
  if (saved.item_id) {
    const [taken] = await ctx.repos.table("gallery_items").update({ id: saved.item_id, status: "approved" }, { status: "withdrawn", withdrawn_at: ctx.now().toISOString() });
    item = taken ?? (await ctx.repos.table("gallery_items").one({ id: saved.item_id }));
  }
  return submissionView(saved, item);
}

// ------------------------------------------------------------------------------------ moderation

export const approveInput = z.object({ slug: z.string().trim().regex(/^[a-z0-9][a-z0-9-]{1,78}[a-z0-9]$/).optional() }).strict();
export const rejectInput = z.object({ reason: z.string().trim().min(3).max(2000) }).strict();

/** The queue: pending submissions, oldest first, with what was stripped and who sent them. */
export async function moderationQueue(ctx: ServiceContext, moderators: string | null | undefined, who: Moderator) {
  assertModerator(ctx, moderators, who);
  const rows = await ctx.repos.table("gallery_submissions").find({ status: "pending" }, { orderBy: "created_at" });
  const byId = await authors(ctx, rows.map((r) => r.workspace_id));
  return rows.map((r) => ({ ...submissionView(r, null), snapshot: snapshotOf(r.snapshot), author: authorOf(r.workspace_id, byId) }));
}

async function freeSlug(ctx: ServiceContext, wanted: string): Promise<string> {
  const base = (slugify(wanted).slice(0, 70).replace(/-+$/, "") || "template").replace(/^moderation$/, "moderation-template");
  const padded = base.length < 3 ? `${base}-template` : base;
  for (let n = 1; n < 200; n++) {
    const candidate = n === 1 ? padded : `${padded}-${n}`;
    if (!(await ctx.repos.table("gallery_items").one({ slug: candidate }))) return candidate;
  }
  return `${padded}-${crypto.randomUUID().slice(0, 8)}`;
}

/** Approve: the snapshot becomes a public gallery item, attributed to the author workspace. */
export async function approveSubmission(ctx: ServiceContext, moderators: string | null | undefined, who: Moderator, id: string, input: z.output<typeof approveInput>) {
  assertModerator(ctx, moderators, who);
  const row = required(await ctx.repos.table("gallery_submissions").one({ id }), "Submission");
  const check = galleryMove(row.status, "approve", "moderator");
  if (!check.ok) throw new ApiError(409, "invalid_transition", check.reason);
  if (input.slug && (await ctx.repos.table("gallery_items").one({ slug: input.slug }))) throw new ApiError(409, "slug_taken", "Another template already uses that address");
  const slug = input.slug ?? (await freeSlug(ctx, row.title));
  const item = await guardWrite("A template with this address", () =>
    ctx.repos.table("gallery_items").insert({ slug, kind: row.kind, title: row.title, summary: row.summary, tags: row.tags, author_workspace_id: row.workspace_id, licence: GALLERY_LICENCE.code, status: "approved", version: 1, snapshot: row.snapshot, uses_count: 0, published_at: ctx.now().toISOString(), withdrawn_at: null }),
  );
  try {
    const saved = await move(ctx, row, "approve", "moderator", { patch: { item_id: item.id } });
    return { submission: submissionView(saved, item), item: { slug: item.slug, id: item.id } };
  } catch (e) {
    // The submission moved meanwhile: nothing is published.
    await ctx.repos.table("gallery_items").remove({ id: item.id });
    throw e;
  }
}

/** Decline with a reason the author reads beside the submission. */
export async function rejectSubmission(ctx: ServiceContext, moderators: string | null | undefined, who: Moderator, id: string, input: z.output<typeof rejectInput>) {
  assertModerator(ctx, moderators, who);
  const row = required(await ctx.repos.table("gallery_submissions").one({ id }), "Submission");
  return submissionView(await move(ctx, row, "reject", "moderator", { reason: input.reason }), null);
}
