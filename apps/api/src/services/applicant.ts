// SPDX-License-Identifier: AGPL-3.0-only
// Applicant workflow beyond the protocol routes: the applications list and status timeline,
// section assignments, field comments, attachments, withdrawing, the answer library, and finding
// funding (open competitions here, and OpenGrants through its hosted MCP).
import { parsePointer, setAt, type JsonObject } from "@gms/forms";
import { readPath } from "@gms/protocol";
import { z } from "zod";
import { ApiError, notFound } from "../lib/errors.ts";
import { apiId } from "../lib/ids.ts";
import { type App, access, responsesOf, revisionOf, runRules, stageForms, stagesOf, transitionApp, writeFormResponse } from "./apply.ts";
import { audit, authorize, guardWrite, required, type ServiceContext } from "./context.ts";
import { cleanLine, cleanText } from "@gms/notify";
import { listMyDocuments } from "./organization.ts";
import { OUTSIDE_ROLES, createOutside } from "./outside.ts";
import { orgFacts } from "./profile.ts";
import { OpenGrantsProfileError, OpenGrantsUnavailableError, OpenGrantsUnsupportedError, sha256Hex, type OpenGrantsListing, type OpenGrantsTool, type OrgSearchContext } from "./ports.ts";
import type { Row } from "./repos/types.ts";

type Ws = Row<"workspaces">;
const MAX_UPLOAD = 25 * 1024 * 1024;

async function applicantApp(ctx: ServiceContext, appId: string, scope: "applications:read" | "applications:write") {
  const found = await access(ctx, appId, scope);
  if (found.side !== "applicant") throw new ApiError(403, "wrong_workspace_kind", "This action belongs to applicant workspaces");
  return found;
}

// ------------------------------------------------------------------------------------ my applications

export async function listMyApplications(ctx: ServiceContext) {
  const ws = await authorize(ctx, { scope: "applications:read", kind: "applicant" });
  let apps = await ctx.repos.table("applications").find({ applicant_workspace_id: ws.id }, { orderBy: "updated_at", ascending: false });
  if (ws.role === "consultant") apps = apps.filter((a) => ((ws.memberScope?.applicationIds as string[] | undefined) ?? []).includes(a.id));
  if (!apps.length) return [];
  const funders = await ctx.repos.table("workspaces").find({ id: [...new Set(apps.map((a) => a.workspace_id))] });
  const competitions = await ctx.repos.table("competitions").find({ id: [...new Set(apps.map((a) => a.competition_id))] });
  const opportunities = await ctx.repos.table("opportunities").find({ id: [...new Set(apps.map((a) => a.opportunity_id))] });
  const out = [];
  for (const a of apps) {
    const funder = funders.find((f) => f.id === a.workspace_id);
    const competition = competitions.find((c) => c.id === a.competition_id);
    const stage = competition ? stagesOf(competition).find((s) => s.key === a.stage) : undefined;
    const current = (await responsesOf(ctx, a.id)).filter((r) => r.stage === a.stage);
    out.push({
      id: apiId("application", a.id),
      title: a.title,
      status: a.status,
      stage: { key: a.stage, label: stage?.label ?? a.stage, closes: stage?.closes ?? null },
      funder: { workspaceId: a.workspace_id, name: funder?.display_name ?? null, handle: funder?.handle ?? null, brand: funder?.brand ?? {} },
      opportunity: { id: apiId("opportunity", a.opportunity_id), title: opportunities.find((o) => o.id === a.opportunity_id)?.title ?? null },
      forms: { total: current.length, complete: current.filter((r) => r.status === "complete").length },
      submittedAt: a.submitted_at,
      updatedAt: a.updated_at,
    });
  }
  return out;
}

/** The status page: where the application is in the competition's stages, and what has happened. */
export async function getMyApplicationStatus(ctx: ServiceContext, appId: string) {
  const { app } = await applicantApp(ctx, appId, "applications:read");
  const competition = required(await ctx.repos.table("competitions").one({ id: app.competition_id }), "Competition");
  const events = await ctx.repos.table("application_events").find({ application_id: app.id }, { orderBy: "created_at" });
  const stages = stagesOf(competition);
  const at = stages.findIndex((s) => s.key === app.stage);
  return {
    id: apiId("application", app.id),
    title: app.title,
    status: app.status,
    stage: app.stage,
    submittedAt: app.submitted_at,
    stages: stages.map((s, i) => ({ key: s.key, label: s.label, opens: s.opens ?? null, closes: s.closes ?? null, state: i < at ? "done" : i === at ? "current" : "upcoming" })),
    // The applicant sees what happened, not the funder's working notes.
    timeline: events.map((e) => ({ id: e.id, type: e.type, fromStatus: e.from_status, toStatus: e.to_status, fromStage: e.from_stage, toStage: e.to_stage, at: e.created_at, message: e.type === "request_revision" ? ((e.payload as { message?: string }).message ?? null) : null, revision: revisionOf(e) })),
  };
}

export async function withdrawApplication(ctx: ServiceContext, appId: string) {
  const { app } = await applicantApp(ctx, appId, "applications:write");
  await authorize(ctx, { scope: "applications:write", kind: "applicant", roles: ["admin", "editor"] });
  const updated = await transitionApp(ctx, app, "withdraw", "applicant", {});
  return { id: apiId("application", app.id), status: updated.status };
}

// ------------------------------------------------------------------------------------ sections, comments

/** Section key → the teammate who owns it; null clears the assignment. */
export const sectionAssignInput = z.object({ formId: z.string(), sections: z.record(z.string().trim().min(1).max(200), z.uuid().nullable()) }).strict();

export async function assignSection(ctx: ServiceContext, appId: string, formUuid: string, input: z.output<typeof sectionAssignInput>) {
  const { app, ws } = await applicantApp(ctx, appId, "applications:write");
  const row = required(await ctx.repos.table("form_responses").one({ application_id: app.id, form_id: formUuid }), "Form response");
  const assignments = { ...(row.section_assignments as Record<string, string>) };
  for (const [section, userId] of Object.entries(input.sections)) {
    if (userId && !(await ctx.repos.table("workspace_members").one({ workspace_id: ws.id, user_id: userId }))) throw new ApiError(422, "not_a_member", "That person is not a member of this workspace");
    if (userId) assignments[section] = userId;
    else delete assignments[section];
  }
  await ctx.repos.table("form_responses").update({ id: row.id }, { section_assignments: assignments });
  return { formId: apiId("form", formUuid), sections: assignments };
}

/** Who owns which section, per form of the application. Both sides can read it; only the applicant sets it. */
export async function listSectionAssignments(ctx: ServiceContext, appId: string) {
  const { app, ws, side } = await access(ctx, appId, "applications:read");
  // Reviewers see the answers they score, not how the applicant's team divided the work.
  if (side === "funder" && ws.role && ["reviewer", "external_reviewer"].includes(ws.role)) throw new ApiError(403, "insufficient_role", "Reviewers cannot see section assignments");
  return (await responsesOf(ctx, app.id)).map((r) => ({ formId: apiId("form", r.form_id), stage: r.stage, sections: r.section_assignments as Record<string, string> }));
}

async function commentThread(ctx: ServiceContext, app: App, create: boolean) {
  const where = { subject_type: "application", subject_id: app.id, visibility: "applicant_internal", applicant_workspace_id: app.applicant_workspace_id };
  const existing = await ctx.repos.table("threads").one(where);
  if (existing || !create) return existing;
  return ctx.repos.table("threads").insert({ ...where, workspace_id: app.applicant_workspace_id, title: "Team comments" });
}

const commentView = (m: Row<"messages">) => {
  const ref = m.field_ref as { formId?: string; path?: string } | null;
  return { id: m.id, body: m.body, author: m.author, authorUserId: m.author_user_id, formId: ref?.formId ? apiId("form", ref.formId) : null, fieldPath: ref?.path ?? null, resolvedAt: m.resolved_at, createdAt: m.created_at };
};

export async function listComments(ctx: ServiceContext, appId: string) {
  const { app } = await applicantApp(ctx, appId, "applications:read");
  const thread = await commentThread(ctx, app, false);
  return thread ? (await ctx.repos.table("messages").find({ thread_id: thread.id }, { orderBy: "created_at" })).map(commentView) : [];
}

export const commentInput = z.object({ body: z.string().trim().min(1).max(5000), formId: z.string().optional(), fieldPath: z.string().max(500).optional() }).strict();

export async function addComment(ctx: ServiceContext, appId: string, input: z.output<typeof commentInput>, formUuid?: string) {
  const { app } = await applicantApp(ctx, appId, "applications:write");
  const thread = (await commentThread(ctx, app, true))!;
  const row = await ctx.repos.table("messages").insert({ thread_id: thread.id, author: ctx.actor.id, author_user_id: ctx.actor.userId, body: input.body, field_ref: formUuid ? { formId: formUuid, path: input.fieldPath ?? "" } : null });
  return commentView(row);
}

export async function resolveComment(ctx: ServiceContext, appId: string, commentId: string) {
  const { app } = await applicantApp(ctx, appId, "applications:write");
  const thread = required(await commentThread(ctx, app, false), "Comment");
  const [row] = await ctx.repos.table("messages").update({ id: commentId, thread_id: thread.id }, { resolved_at: ctx.now().toISOString(), resolved_by: ctx.actor.userId });
  return commentView(required(row, "Comment"));
}

// ------------------------------------------------------------------------------------ attachments

const docView = (d: Row<"documents">) => ({ id: d.id, name: d.name, mime: d.mime, size: d.size, sha256: d.sha256, source: d.passport_document_id ? "passport_locker" : "upload", passportDocumentId: d.passport_document_id, scanStatus: d.scan_status, uploadedAt: d.created_at });

export const attachmentInput = z.union([
  z.object({ name: z.string().trim().min(1).max(300), mime: z.string().min(3).max(120), contentBase64: z.string().min(1) }).strict(),
  // A file already in the Passport locker is referenced by id; the GMS keeps no copy.
  z.object({ name: z.string().trim().min(1).max(300), mime: z.string().min(3).max(120), passportDocumentId: z.string().min(1).max(200), size: z.number().int().min(0), sha256: z.string().regex(/^[0-9a-f]{64}$/) }).strict(),
  // By id alone: the name, type and hash are read from the Passport locker, not taken from the caller.
  z.object({ passportDocumentId: z.string().min(1).max(200) }).strict(),
]);

export async function listAttachments(ctx: ServiceContext, appId: string) {
  const { app } = await access(ctx, appId, "applications:read");
  return (await ctx.repos.table("documents").find({ subject_type: "application", subject_id: app.id }, { orderBy: "created_at" })).map(docView);
}

export async function attachDocument(ctx: ServiceContext, appId: string, input: z.output<typeof attachmentInput>) {
  const { app } = await applicantApp(ctx, appId, "applications:write");
  if (app.status !== "draft" && app.status !== "revision_requested") throw new ApiError(409, "application_locked", "Attachments can be added while the application is a draft or a revision is requested");
  const base = { workspace_id: app.workspace_id, owner_workspace_id: app.applicant_workspace_id, subject_type: "application", subject_id: app.id, uploaded_by: ctx.actor.userId };
  let row: Row<"documents">;
  if (!("name" in input)) {
    const doc = (await listMyDocuments(ctx)).find((d) => d.id === input.passportDocumentId);
    if (!doc) throw notFound("Passport locker document");
    if (!doc.sha256) throw new ApiError(422, "document_not_attachable", "This locker document has no recorded hash, so it cannot be pinned to an application. Upload the file to the Passport locker first");
    // Passport records no size for locker documents; 0 marks "not held here".
    row = await ctx.repos.table("documents").insert({ ...base, name: doc.name ?? doc.kind, mime: doc.mimeType ?? "application/octet-stream", size: 0, sha256: doc.sha256, storage: "supabase", path: `passport:${doc.id}`, passport_document_id: doc.id });
    await audit(ctx, "document.attached", "application", app.id, { documentId: row.id, sha256: row.sha256, source: "passport_locker" }, app.workspace_id);
    return docView(row);
  }
  const common = { ...base, name: input.name, mime: input.mime };
  if ("passportDocumentId" in input) {
    row = await ctx.repos.table("documents").insert({ ...common, size: input.size, sha256: input.sha256, storage: "supabase", path: `passport:${input.passportDocumentId}`, passport_document_id: input.passportDocumentId });
  } else {
    if (!ctx.ports.storage) throw new ApiError(503, "storage_unavailable", "File storage is not configured on this server");
    let bytes: Uint8Array;
    try {
      bytes = Uint8Array.from(atob(input.contentBase64), (c) => c.charCodeAt(0));
    } catch {
      throw new ApiError(400, "bad_request", "contentBase64 is not valid base64");
    }
    if (bytes.byteLength > MAX_UPLOAD) throw new ApiError(413, "too_large", "Files up to 25 MB can be attached");
    const sha256 = await sha256Hex(bytes);
    const stored = await ctx.ports.storage.put(`applications/${app.id}/${sha256}`, bytes, input.mime);
    row = await ctx.repos.table("documents").insert({ ...common, size: bytes.byteLength, sha256, storage: stored.storage, path: stored.path });
  }
  await audit(ctx, "document.attached", "application", app.id, { documentId: row.id, sha256: row.sha256, source: row.passport_document_id ? "passport_locker" : "upload" }, app.workspace_id);
  return docView(row);
}

// ------------------------------------------------------------------------------------ answer library

const answerView = (a: Row<"answers">) => ({ id: a.id, key: a.key, title: a.title, body: a.body, version: a.version, usedIn: a.used_in, words: a.body.trim() ? a.body.trim().split(/\s+/).length : 0, updatedAt: a.updated_at });
const KEY = /^[a-z0-9][a-z0-9_.-]{0,98}$/;
export const answerInput = z.object({ key: z.string().regex(KEY).optional(), title: z.string().trim().min(1).max(300), body: z.string().max(50_000).default("") }).strict();
export const answerPatch = z.object({ title: z.string().trim().min(1).max(300).optional(), body: z.string().max(50_000).optional() }).strict();

/**
 * Answers as the library shows them: each use names the application and the funder, so a person
 * can tell where an answer went without opening anything.
 */
async function answerViews(ctx: ServiceContext, rows: Row<"answers">[]) {
  const appIds = [...new Set(rows.flatMap((r) => ((r.used_in as unknown as { applicationId?: string }[] | null) ?? []).map((u) => u.applicationId).filter((x): x is string => typeof x === "string")))];
  const apps = appIds.length ? await ctx.repos.table("applications").find({ id: appIds }) : [];
  const funders = apps.length ? await ctx.repos.table("workspaces").find({ id: [...new Set(apps.map((a) => a.workspace_id))] }) : [];
  // Uses in outside applications (apply anywhere), read in the answers' own workspace only.
  const outsideIds = [...new Set(rows.flatMap((r) => ((r.used_in as unknown as { outsideApplicationId?: string }[] | null) ?? []).map((u) => u.outsideApplicationId).filter((x): x is string => typeof x === "string")))];
  const outsideApps = outsideIds.length && rows[0] ? await ctx.repos.table("outside_applications").find({ id: outsideIds, workspace_id: rows[0].workspace_id }) : [];
  return rows.map((r) => {
    const v = answerView(r);
    const usedIn = ((r.used_in as unknown as Record<string, unknown>[] | null) ?? []).map((u) => {
      const outside = typeof u.outsideApplicationId === "string" ? outsideApps.find((a) => a.id === u.outsideApplicationId) : undefined;
      if (outside) return { ...u, applicationTitle: outside.title, funderName: outside.funder_name };
      const app = apps.find((a) => a.id === u.applicationId);
      return { ...u, applicationTitle: app?.title ?? null, funderName: (app && funders.find((f) => f.id === app.workspace_id)?.display_name) ?? null };
    });
    return { ...v, usedIn };
  });
}

/** The latest version of each answer. */
export async function listAnswers(ctx: ServiceContext) {
  const ws = await authorize(ctx, { scope: "library:read", kind: "applicant" });
  const rows = await ctx.repos.table("answers").find({ workspace_id: ws.id }, { orderBy: "version", ascending: false });
  const latest = new Map<string, Row<"answers">>();
  for (const r of rows) if (!latest.has(r.key)) latest.set(r.key, r);
  return answerViews(ctx, [...latest.values()].sort((a, b) => a.title.localeCompare(b.title)));
}

export async function createAnswer(ctx: ServiceContext, input: z.output<typeof answerInput>) {
  const ws = await authorize(ctx, { scope: "library:write", kind: "applicant" });
  const key = input.key ?? (input.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "answer");
  const row = await guardWrite("An answer with this key", () => ctx.repos.table("answers").insert({ workspace_id: ws.id, key, title: input.title, body: input.body }));
  return answerView(row);
}

/** Editing an answer saves a new version; applications that used the old one keep what they inserted. */
export async function updateAnswer(ctx: ServiceContext, answerId: string, input: z.output<typeof answerPatch>) {
  const ws = await authorize(ctx, { scope: "library:write", kind: "applicant" });
  const current = required(await ctx.repos.table("answers").one({ id: answerId, workspace_id: ws.id }), "Answer");
  const versions = await ctx.repos.table("answers").find({ workspace_id: ws.id, key: current.key }, { orderBy: "version", ascending: false, limit: 1 });
  const next = await ctx.repos.table("answers").insert({ workspace_id: ws.id, key: current.key, title: input.title ?? current.title, body: input.body ?? current.body, version: (versions[0]?.version ?? current.version) + 1, used_in: current.used_in });
  return (await answerViews(ctx, [next]))[0]!;
}

type Use = { applicationId: string; formId: string; path: string; version: number; insertedAt: string };
export const insertAnswerInput = z.object({ answerId: z.uuid(), path: z.string().regex(/^(\/[^/]+)+$/).max(500) }).strict();

/**
 * Put a library answer into one field of a form. The field's provenance becomes `library`, and the
 * answer records where it was used (application, form, field, version), which is how the answer id
 * is kept: provenance values are a fixed vocabulary and carry no ids.
 */
export async function insertAnswer(ctx: ServiceContext, appId: string, formUuid: string, input: z.output<typeof insertAnswerInput>) {
  const { app, ws } = await applicantApp(ctx, appId, "applications:write");
  if (!ctx.scopes.includes("library:read")) throw new ApiError(403, "insufficient_scope", "This action needs the library:read scope");
  const answer = required(await ctx.repos.table("answers").one({ id: input.answerId, workspace_id: ws.id }), "Answer");
  const segs = parsePointer(input.path);
  const patch: JsonObject = {};
  setAt(patch, segs, answer.body);
  const { formResponse, changed, rejected } = await writeFormResponse(ctx, app, formUuid, patch, "library");
  if (rejected.length) throw new ApiError(422, "field_follows_passport", "This field follows Passport and cannot be edited here");
  const use: Use = { applicationId: app.id, formId: formUuid, path: input.path, version: answer.version, insertedAt: ctx.now().toISOString() };
  const uses = [...(answer.used_in as unknown as Use[]).filter((u) => !(u.applicationId === app.id && u.formId === formUuid && u.path === input.path)), use];
  // The same field can hold only one answer: drop it from any other answer that was there before.
  for (const other of await ctx.repos.table("answers").find({ workspace_id: ws.id })) {
    if (other.id === answer.id) continue;
    const kept = (other.used_in as unknown as Use[]).filter((u) => !(u.applicationId === app.id && u.formId === formUuid && u.path === input.path));
    if (kept.length !== (other.used_in as unknown[]).length) await ctx.repos.table("answers").update({ id: other.id }, { used_in: kept as unknown as Row<"answers">["used_in"] });
  }
  const [saved] = await ctx.repos.table("answers").update({ id: answer.id }, { used_in: uses as unknown as Row<"answers">["used_in"] });
  return { formResponse, path: input.path, provenance: "library" as const, changed: changed.length > 0, answer: (await answerViews(ctx, [saved ?? answer]))[0]! };
}

// ------------------------------------------------------------------------------------ discovery

function orgContext(ws: Ws): OrgSearchContext {
  const { org, profile } = orgFacts(ws);
  const revenue = Number(readPath(profile, "commonApp.financials.totalRevenue") ?? readPath(profile, "commonApp.financials.budget"));
  const band = !Number.isFinite(revenue) || revenue <= 0 ? undefined : revenue < 250_000 ? "under_250k" : revenue < 1_000_000 ? "250k_1m" : revenue < 5_000_000 ? "1m_5m" : "over_5m";
  const text = (v: unknown) => (typeof v === "string" && v ? v : undefined);
  return { orgType: text(readPath(org, "orgType.code")), region: text(readPath(org, "addresses.primary.stateOrProvince")), mission: text(org.mission)?.slice(0, 500), revenueBand: band };
}

/** Competitions open on this GMS, each with the caller's eligibility. `unknown` is shown as such. */
export async function discoverCompetitions(ctx: ServiceContext) {
  const ws = await authorize(ctx, { scope: "discovery", kind: "applicant" });
  const me = required(await ctx.repos.table("workspaces").one({ id: ws.id }), "Workspace");
  const open = await ctx.repos.table("competitions").find({ status: "open" }, { orderBy: "created_at", ascending: false, limit: 500 });
  const mine = await ctx.repos.table("applications").find({ applicant_workspace_id: ws.id });
  const out = [];
  for (const c of open) {
    const opp = await ctx.repos.table("opportunities").one({ id: c.opportunity_id });
    if (!opp?.published_at) continue;
    const funder = await ctx.repos.table("workspaces").one({ id: c.workspace_id });
    const eligibility = await runRules(ctx, opp.id, me, []);
    const first = stagesOf(c)[0];
    const started = mine.find((a) => a.competition_id === c.id && a.status !== "withdrawn");
    out.push({
      competitionId: c.id,
      opportunity: { id: apiId("opportunity", opp.id), slug: opp.slug, title: opp.title, description: opp.description, funding: opp.funding },
      funder: { name: funder?.display_name ?? null, handle: funder?.handle ?? null, brand: funder?.brand ?? {} },
      stage: first ? { key: first.key, label: first.label, closes: first.closes ?? null } : null,
      forms: Object.keys(stageForms(c, first?.key ?? "application")).length,
      eligibility: { eligible: eligibility.eligible, results: eligibility.results },
      application: started ? { id: apiId("application", started.id), status: started.status } : null,
      url: funder ? `${ctx.config.webBaseUrl}/f/${funder.handle}/o/${opp.slug}` : null,
      acceptingApplications: true,
    });
  }
  // Published, listed opportunities with no open competition (owner decision D10): shown so they
  // can be saved, labelled as not taking applications yet. No eligibility is run for them.
  const openOpportunities = new Set(open.map((c) => c.opportunity_id));
  const published = (await ctx.repos.table("opportunities").find({}, { notNull: ["published_at"], orderBy: "published_at", ascending: false, limit: 500 })).filter((o) => !openOpportunities.has(o.id) && (o.publish as Record<string, unknown> | null)?.publicPage !== false);
  const funders = published.length ? await ctx.repos.table("workspaces").find({ id: [...new Set(published.map((o) => o.workspace_id))] }) : [];
  for (const opp of published) {
    const funder = funders.find((f) => f.id === opp.workspace_id);
    out.push({
      competitionId: null,
      opportunity: { id: apiId("opportunity", opp.id), slug: opp.slug, title: opp.title, description: opp.description, funding: opp.funding },
      funder: { name: funder?.display_name ?? null, handle: funder?.handle ?? null, brand: funder?.brand ?? {} },
      stage: null,
      forms: 0,
      eligibility: null,
      application: null,
      url: funder ? `${ctx.config.webBaseUrl}/f/${funder.handle}/o/${opp.slug}` : null,
      acceptingApplications: false,
    });
  }
  return out;
}

const CACHE_TTL_MS = 15 * 60 * 1000;
/** Per-isolate result cache: OpenGrants answers for one org and query are reused for 15 minutes. */
const cache = new Map<string, { at: number; value: { items: OpenGrantsListing[] } }>();
export const clearDiscoveryCache = () => {
  cache.clear();
  listingCache.clear();
};

export const openGrantsInput = z.record(z.string(), z.unknown());

export async function openGrants(ctx: ServiceContext, tool: OpenGrantsTool, args: z.output<typeof openGrantsInput>) {
  const ws = await authorize(ctx, { scope: "discovery", kind: "applicant" });
  if (!ctx.ports.openGrants) throw new ApiError(503, "opengrants_not_configured", "OpenGrants discovery is not configured on this server");
  const me = required(await ctx.repos.table("workspaces").one({ id: ws.id }), "Workspace");
  const key = `${ws.id}|${tool}|${JSON.stringify(args)}`;
  const now = ctx.now().getTime();
  const hit = tool === "alerts" ? undefined : cache.get(key);
  let value = hit && now - hit.at < CACHE_TTL_MS ? hit.value : undefined;
  const cached = !!value;
  if (!value) {
    try {
      const r = await ctx.ports.openGrants.call(tool, args, orgContext(me));
      value = { items: r.items };
    } catch (e) {
      if (e instanceof OpenGrantsUnavailableError) throw new ApiError(503, "opengrants_unavailable", "OpenGrants can't be reached right now");
      if (e instanceof OpenGrantsUnsupportedError) throw new ApiError(501, "opengrants_not_supported", tool === "alerts" ? "Funding alerts are set up on opengrants.io; they are not available from here yet" : "That OpenGrants feature is not available from here yet");
      if (e instanceof OpenGrantsProfileError) throw new ApiError(422, "opengrants_profile_incomplete", "Matching needs to know what your organization does. Add a mission statement in Passport, then refresh.");
      throw e;
    }
    if (tool !== "alerts") cache.set(key, { at: now, value });
  }
  // A listing that points back at a GMS opportunity can be applied to here.
  const results = [];
  for (const l of value.items) results.push({ ...l, gms: await matchGmsOpportunity(ctx, l) });
  return { results, cached };
}

/** A listing that points back at a GMS opportunity: its id, and its open competition if any. */
export async function matchGmsOpportunity(ctx: Pick<ServiceContext, "repos" | "config">, l: OpenGrantsListing) {
  for (const candidate of [l.source, l.url]) {
    if (typeof candidate !== "string") continue;
    const page = new RegExp(`^${ctx.config.webBaseUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/f/([a-z0-9-]+)/o/([a-z0-9-]+)`).exec(candidate);
    const api = /\/common-grants\/opportunities\/([0-9a-f-]{36})/i.exec(candidate);
    let opp = api ? await ctx.repos.table("opportunities").one({ id: api[1]!.toLowerCase() }) : null;
    if (!opp && page) {
      const funder = await ctx.repos.table("workspaces").one({ handle: page[1]!, kind: "funder" });
      opp = funder ? await ctx.repos.table("opportunities").one({ workspace_id: funder.id, slug: page[2]! }) : null;
    }
    if (opp?.published_at) {
      const competition = (await ctx.repos.table("competitions").find({ opportunity_id: opp.id, status: "open" }, { limit: 1 }))[0];
      return { opportunityId: apiId("opportunity", opp.id), competitionId: competition?.id ?? null };
    }
  }
  return null;
}

const listingCache = new Map<string, { at: number; value: OpenGrantsListing | null }>();

/**
 * One OpenGrants listing for the Details dialog, through the REST port's `GET /grants-api/{id}`.
 * 404 `not_found` when OpenGrants has no such listing; 404 `not_available` when this server's
 * OpenGrants connection cannot read one listing (the web then shows the search result it holds).
 */
export async function openGrantsListing(ctx: ServiceContext, listingId: string) {
  await authorize(ctx, { scope: "discovery", kind: "applicant" });
  const port = ctx.ports.openGrants;
  if (!port?.get) throw new ApiError(404, "not_available", "Listing details are not available from this server");
  const now = ctx.now().getTime();
  const hit = listingCache.get(listingId);
  let listing = hit && now - hit.at < CACHE_TTL_MS ? hit.value : undefined;
  if (listing === undefined) {
    try {
      listing = await port.get(listingId);
    } catch (e) {
      if (e instanceof OpenGrantsUnavailableError) throw new ApiError(503, "opengrants_unavailable", "OpenGrants can't be reached right now");
      throw e;
    }
    listingCache.set(listingId, { at: now, value: listing });
  }
  if (!listing) throw notFound("Listing");
  return { ...listing, gms: await matchGmsOpportunity(ctx, listing) };
}

export const saveListingInput = z.object({ source: z.enum(["gms", "opengrants"]), externalId: z.string().min(1).max(300), title: z.string().trim().min(1).max(500), url: z.url().optional(), listing: z.record(z.string(), z.unknown()).default({}) }).strict();

export async function saveListing(ctx: ServiceContext, input: z.output<typeof saveListingInput>) {
  const ws = await authorize(ctx, { scope: "discovery", kind: "applicant" });
  const gms = await matchGmsOpportunity(ctx, { id: input.externalId, title: input.title, url: input.url, source: typeof input.listing.source === "string" ? input.listing.source : undefined });
  const existing = await ctx.repos.table("discover_saved").one({ workspace_id: ws.id, source: input.source, external_id: input.externalId });
  const row = existing ?? (await ctx.repos.table("discover_saved").insert({ workspace_id: ws.id, source: input.source, external_id: input.externalId, title: input.title, url: input.url ?? null, listing: input.listing as Row<"discover_saved">["listing"], gms_opportunity_id: gms ? gms.opportunityId.replace(/^opp_/, "") : null, saved_by: ctx.actor.userId }));
  // A saved OpenGrants listing is a prospect (apply anywhere), as migration 0029 made of the ones saved before.
  // A funding alert kept as a saved row by older clients (`alert:<query>`) is not a listing.
  const prospect = input.source === "opengrants" && !input.externalId.startsWith("alert:") ? await savedProspect(ctx, ws.id, input) : null;
  return { id: row.id, source: row.source, externalId: row.external_id, title: row.title, url: row.url, gms, savedAt: row.created_at, outsideApplicationId: prospect };
}

/** The prospect tracking an OpenGrants listing, made when the listing is first saved; its id. */
async function savedProspect(ctx: ServiceContext, workspaceId: string, input: z.output<typeof saveListingInput>): Promise<string | null> {
  const found = await ctx.repos.table("outside_applications").one({ workspace_id: workspaceId, source: "opengrants", source_ref: input.externalId });
  if (found) return found.id;
  // Only people who may write applications start tracking one; others still save the listing.
  if (!ctx.scopes.includes("applications:write") || (ctx.workspace?.role && !OUTSIDE_ROLES.includes(ctx.workspace.role))) return null;
  const text = (v: unknown, n: number) => (typeof v === "string" && v.trim() ? cleanLine(v).slice(0, n) : undefined);
  const listing = { funder: text(input.listing.funder, 200), amount: text(input.listing.amount, 200), deadline: text(input.listing.deadline, 100), summary: typeof input.listing.summary === "string" ? cleanText(input.listing.summary).slice(0, 2000) || undefined : undefined, url: input.url };
  const made = await createOutside(ctx, {
    source: "opengrants",
    sourceRef: input.externalId,
    listing: Object.fromEntries(Object.entries(listing).filter(([, v]) => v !== undefined)),
    title: cleanLine(input.title).slice(0, 300) || "Saved listing",
    funderName: listing.funder ?? "Funder not named",
    ...(input.url ? { listingUrl: input.url } : {}),
    ...(listing.deadline && /^\d{4}-\d{2}-\d{2}$/.test(listing.deadline) ? { fullDue: listing.deadline } : {}),
    stage: "prospect",
  });
  return made.application.id;
}

export async function listSaved(ctx: ServiceContext) {
  const ws = await authorize(ctx, { scope: "discovery", kind: "applicant" });
  // Funding alerts are kept in the same table with their own listing (`/discover/alerts`); they are not saved listings.
  return (await ctx.repos.table("discover_saved").find({ workspace_id: ws.id, source: ["gms", "opengrants"] }, { orderBy: "created_at", ascending: false })).map((r) => ({ id: r.id, source: r.source, externalId: r.external_id, title: r.title, url: r.url, gmsOpportunityId: r.gms_opportunity_id ? apiId("opportunity", r.gms_opportunity_id) : null, savedAt: r.created_at }));
}
