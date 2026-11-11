// SPDX-License-Identifier: AGPL-3.0-only
// Read models for the applicant workspace: who can see the organization's record, what each
// funder is waiting on, a grant's documents and messages, and saved funding alerts.
import { z } from "zod";
import { ApiError } from "../lib/errors.ts";
import { apiId } from "../lib/ids.ts";
import { primaryEmail } from "./apply.ts";
import { audit, authorize, required, type ServiceContext, type ServiceWorkspace } from "./context.ts";
import type { JsonObject } from "@gms/forms";
import type { Row } from "./repos/types.ts";
import { contactsOf } from "./workspaces.ts";

/** One answer to "who can see our record": funders by consent, connected agents, and the team. */
export async function whoHasAccess(ctx: ServiceContext) {
  const ws = await authorize(ctx, { scope: "org:read", kind: "applicant" });
  const [consents, agents, members] = await Promise.all([
    ctx.repos.table("consents").find({ applicant_workspace_id: ws.id, revoked_at: null }, { orderBy: "granted_at" }),
    ctx.repos.table("mcp_connections").find({ workspace_id: ws.id, revoked_at: null }),
    ctx.repos.table("workspace_members").find({ workspace_id: ws.id }),
  ]);
  const funders = consents.length ? await ctx.repos.table("workspaces").find({ id: [...new Set(consents.map((c) => c.funder_workspace_id))] }) : [];
  const people = (await ctx.ports.directory?.lookup([...new Set([...members.map((m) => m.user_id), ...agents.map((a) => a.user_id)])])) ?? new Map<string, { email: string | null; name: string | null }>();
  // Members see the list; only admins see teammates' emails.
  const admin = ws.role === "admin";
  return {
    funders: consents.map((c) => {
      const f = funders.find((w) => w.id === c.funder_workspace_id);
      return { consentId: c.id, funder: { workspaceId: c.funder_workspace_id, name: f?.display_name ?? null, handle: f?.handle ?? null, brand: f?.brand ?? null }, basis: c.basis, scopes: c.scopes, grantedAt: c.granted_at, sees: c.basis === "shared_submission" ? "A report you shared" : "Your organization record and verification level" };
    }),
    agents: agents.map((a) => ({ id: a.id, clientId: a.client_id, userId: a.user_id, connectedBy: people.get(a.user_id)?.name ?? null, scopes: a.scopes, lastUsedAt: a.last_used_at, connectedAt: a.created_at })),
    team: members.map((m) => ({ userId: m.user_id, name: people.get(m.user_id)?.name ?? null, email: admin ? (people.get(m.user_id)?.email ?? null) : null, role: m.role, expiresAt: m.expires_at, mfaEnrolled: m.mfa_enrolled_at !== null })),
  };
}

/** Each funder the organization has dealt with: what is open, what they sent, who to contact. */
export async function myFundersDetail(ctx: ServiceContext) {
  const ws = await authorize(ctx, { scope: "applications:read", kind: "applicant" });
  const [apps, awards] = await Promise.all([ctx.repos.table("applications").find({ applicant_workspace_id: ws.id }), ctx.repos.table("awards").find({ recipient_workspace_id: ws.id })]);
  const ids = [...new Set([...apps.map((a) => a.workspace_id), ...awards.map((a) => a.workspace_id)])];
  if (!ids.length) return [];
  const [funders, requirements, agreements] = await Promise.all([
    ctx.repos.table("workspaces").find({ id: ids }, { orderBy: "display_name" }),
    awards.length ? ctx.repos.table("requirements").find({ award_id: awards.map((a) => a.id) }).then((rows) => rows.filter((r) => awards.some((a) => a.id === r.award_id && a.workspace_id === r.workspace_id))) : Promise.resolve([]),
    awards.length ? ctx.repos.table("agreements").find({ award_id: awards.map((a) => a.id) }).then((rows) => rows.filter((g) => awards.some((a) => a.id === g.award_id && a.workspace_id === g.workspace_id))) : Promise.resolve([]),
  ]);
  return funders.map((f) => {
    const theirAwards = awards.filter((a) => a.workspace_id === f.id);
    const awardIds = new Set(theirAwards.map((a) => a.id));
    const openItems = [
      ...apps.filter((a) => a.workspace_id === f.id && a.status === "revision_requested").map((a) => ({ kind: "revision_requested", label: `Revision requested: ${a.title}`, applicationId: apiId("application", a.id) })),
      ...theirAwards.filter((a) => a.status === "offered").map((a) => ({ kind: "offer", label: `Award offered: ${a.title}`, awardId: apiId("award", a.id) })),
      ...agreements.filter((g) => awardIds.has(g.award_id) && g.status === "sent").map((g) => ({ kind: "agreement_to_sign", label: "Agreement waiting for your signature", awardId: apiId("award", g.award_id), agreementId: apiId("agreement", g.id) })),
      ...requirements.filter((r) => awardIds.has(r.award_id) && ["due", "overdue", "returned"].includes(r.status)).map((r) => ({ kind: `report_${r.status}`, label: `${r.title} · ${r.status}`, requirementId: apiId("requirement", r.id), dueAt: r.due_at })),
    ];
    const org = (f.org_projection ?? {}) as JsonObject;
    return {
      workspaceId: f.id,
      name: f.display_name,
      handle: f.handle,
      brand: f.brand,
      applications: apps.filter((a) => a.workspace_id === f.id).length,
      awards: theirAwards.length,
      openItems,
      documents: agreements.filter((g) => awardIds.has(g.award_id) && g.status !== "draft").map((g) => ({ kind: "agreement", name: `Grant agreement v${g.version}${g.status === "executed" ? " (executed)" : ""}`, awardId: apiId("award", g.award_id), agreementId: apiId("agreement", g.id), sha256: g.document_sha256, at: g.executed_at ?? g.updated_at })),
      // The funder's public contact, from its own published record. Never a person's private address.
      // The people the funder named for the organizations it works with.
      contacts: contactsOf(f),
      contactEmail: typeof (f.settings as { contactEmail?: unknown } | null)?.contactEmail === "string" ? (f.settings as { contactEmail: string }).contactEmail : primaryEmail(org),
      contact: { email: primaryEmail(org), website: typeof (org.socials as { website?: unknown } | undefined)?.website === "string" ? ((org.socials as { website: string }).website) : null, page: `${ctx.config.webBaseUrl}/f/${f.handle}` },
    };
  });
}

async function awardParty(ctx: ServiceContext, awardId: string, scope: "awards:read" | "messages:read" | "messages:write"): Promise<{ ws: ServiceWorkspace; award: Row<"awards"> }> {
  const ws = await authorize(ctx, { scope });
  const award = await ctx.repos.table("awards").one({ id: awardId });
  if (!award || (award.workspace_id !== ws.id && award.recipient_workspace_id !== ws.id)) required(null, "Award");
  return { ws, award: award! };
}

/** A grant's documents as either party may see them: agreements and files attached to the award. */
export async function awardDocuments(ctx: ServiceContext, awardId: string) {
  const { award } = await awardParty(ctx, awardId, "awards:read");
  const [agreements, docs] = await Promise.all([ctx.repos.table("agreements").find({ award_id: award.id, workspace_id: award.workspace_id }, { orderBy: "version" }), ctx.repos.table("documents").find({ subject_type: "award", subject_id: award.id }, { orderBy: "created_at" })]);
  return [
    ...agreements.filter((g) => g.status !== "draft").map((g) => ({ kind: "agreement", id: apiId("agreement", g.id), name: `Grant agreement v${g.version}`, status: g.status, sha256: g.document_sha256, at: g.executed_at ?? g.updated_at, href: `${ctx.config.baseUrl}/gms/agreements/${apiId("agreement", g.id)}/pdf` })),
    ...docs.map((d) => ({ kind: "file", id: d.id, name: d.name, status: d.scan_status, sha256: d.sha256, at: d.created_at, href: null })),
  ];
}

export const awardMessageInput = z.object({ body: z.string().trim().min(1).max(10_000) }).strict();

async function awardThread(ctx: ServiceContext, award: Row<"awards">, create: boolean) {
  const found = await ctx.repos.table("threads").one({ subject_type: "award", subject_id: award.id, visibility: "shared" });
  if (found || !create) return found;
  return ctx.repos.table("threads").insert({ workspace_id: award.workspace_id, subject_type: "award", subject_id: award.id, visibility: "shared", funder_workspace_id: award.workspace_id, applicant_workspace_id: award.recipient_workspace_id, title: award.title });
}

const messageView = (m: Row<"messages">, mine: (userId: string | null) => boolean) => ({ id: m.id, body: m.body, authorUserId: m.author_user_id, own: mine(m.author_user_id), at: m.created_at });

/** The shared thread between funder and grantee on one award. */
export async function listAwardMessages(ctx: ServiceContext, awardId: string) {
  const { award } = await awardParty(ctx, awardId, "messages:read");
  const thread = await awardThread(ctx, award, false);
  const messages = thread ? await ctx.repos.table("messages").find({ thread_id: thread.id }, { orderBy: "created_at" }) : [];
  return messages.map((m) => messageView(m, (u) => u !== null && u === ctx.actor.userId));
}

export async function postAwardMessage(ctx: ServiceContext, awardId: string, input: z.output<typeof awardMessageInput>) {
  const { ws, award } = await awardParty(ctx, awardId, "messages:write");
  const thread = (await awardThread(ctx, award, true))!;
  const m = await ctx.repos.table("messages").insert({ thread_id: thread.id, author: ctx.actor.id, author_user_id: ctx.actor.userId, body: input.body });
  await audit(ctx, "message.posted", "award", award.id, { threadId: thread.id, messageId: m.id, side: ws.kind }, award.workspace_id);
  return messageView(m, () => true);
}

// ------------------------------------------------------------------------------------------ alerts

export const alertInput = z
  .object({
    name: z.string().trim().min(1).max(120),
    query: z.string().trim().max(300).optional(),
    filters: z.record(z.string(), z.unknown()).optional(),
    frequency: z.enum(["daily", "weekly"]).default("weekly"),
  })
  .strict();

const alertView = (a: Row<"discover_saved">) => {
  const l = (a.listing ?? {}) as { query?: string; filters?: Record<string, unknown>; frequency?: string };
  return { id: a.id, name: a.title, query: l.query ?? null, filters: l.filters ?? {}, frequency: l.frequency ?? "weekly", createdAt: a.created_at };
};

/** Saved funding searches. Matching and sending run through the OpenGrants connector when configured. */
export async function listAlerts(ctx: ServiceContext) {
  const ws = await authorize(ctx, { scope: "discovery", kind: "applicant" });
  return (await ctx.repos.table("discover_saved").find({ workspace_id: ws.id, source: "alert" }, { orderBy: "created_at" })).map(alertView);
}

export async function createAlert(ctx: ServiceContext, input: z.output<typeof alertInput>) {
  const ws = await authorize(ctx, { scope: "discovery", kind: "applicant" });
  if ((await ctx.repos.table("discover_saved").count({ workspace_id: ws.id, source: "alert" })) >= 25) throw new ApiError(422, "too_many_alerts", "A workspace can keep up to 25 funding alerts");
  const row = await ctx.repos.table("discover_saved").insert({ workspace_id: ws.id, source: "alert", external_id: crypto.randomUUID(), title: input.name, listing: { query: input.query ?? null, filters: input.filters ?? {}, frequency: input.frequency } as Row<"discover_saved">["listing"], saved_by: ctx.actor.userId });
  await audit(ctx, "discovery.alert_created", "workspace", ws.id, { alertId: row.id });
  return alertView(row);
}

export async function deleteAlert(ctx: ServiceContext, alertId: string) {
  const ws = await authorize(ctx, { scope: "discovery", kind: "applicant" });
  const removed = await ctx.repos.table("discover_saved").remove({ id: alertId, workspace_id: ws.id, source: "alert" });
  if (!removed) required(null, "Alert");
  await audit(ctx, "discovery.alert_deleted", "workspace", ws.id, { alertId });
  return { deleted: true };
}
