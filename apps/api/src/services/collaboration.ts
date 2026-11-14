// SPDX-License-Identifier: AGPL-3.0-only
// Message threads and tasks. A thread hangs off an application (awards and requirements later) and
// is either shared between the funder and the applicant or internal to one side. An internal
// thread is never returned to the other side.
import { z } from "zod";
import { ApiError } from "../lib/errors.ts";
import { apiId } from "../lib/ids.ts";
import { access } from "./apply.ts";
import { audit, authorize, required, type ServiceContext, type ServiceWorkspace } from "./context.ts";
import { mailMembers } from "./member-mail.ts";
import { loadOutside } from "./outside.ts";
import type { Row } from "./repos/types.ts";

type Thread = Row<"threads">;

const messageView = (m: Row<"messages">) => ({ id: m.id, body: m.body, author: m.author, authorUserId: m.author_user_id, createdAt: m.created_at });
const threadView = (t: Thread, messages: Row<"messages">[]) => ({
  id: t.id,
  subjectType: t.subject_type,
  subjectId: t.subject_id,
  visibility: t.visibility,
  title: t.title,
  funderWorkspaceId: t.funder_workspace_id,
  applicantWorkspaceId: t.applicant_workspace_id,
  messages: messages.map(messageView),
  updatedAt: t.updated_at,
});

/** May this workspace see the thread? Shared: either party. Internal: the side that owns it. */
function canSee(t: Thread, ws: ServiceWorkspace): boolean {
  if (ws.kind === "funder") return t.funder_workspace_id === ws.id && (t.visibility === "shared" || t.visibility === "funder_internal");
  return t.applicant_workspace_id === ws.id && (t.visibility === "shared" || t.visibility === "applicant_internal");
}

export const threadQuery = z.object({ subjectType: z.literal("application"), subjectId: z.uuid() }).strict();

/** Threads on one application that the caller's side may read, oldest message first. Field comments are listed with the application, not here. */
export async function listThreads(ctx: ServiceContext, q: z.output<typeof threadQuery>) {
  await authorize(ctx, { scope: "messages:read" });
  const { app, ws } = await access(ctx, q.subjectId, "applications:read");
  const threads = (await ctx.repos.table("threads").find({ subject_type: "application", subject_id: app.id }, { orderBy: "created_at" })).filter((t) => canSee(t, ws) && t.title !== "Team comments");
  const out = [];
  for (const t of threads) out.push(threadView(t, await ctx.repos.table("messages").find({ thread_id: t.id }, { orderBy: "created_at" })));
  return out;
}

export const threadInput = z.object({ subjectType: z.literal("application"), subjectId: z.uuid(), visibility: z.enum(["shared", "internal"]).default("shared") }).strict();

/** Get or create the shared (or this side's internal) thread of an application. */
export async function openThread(ctx: ServiceContext, input: z.output<typeof threadInput>) {
  await authorize(ctx, { scope: "messages:write" });
  const { app, ws } = await access(ctx, input.subjectId, "applications:read");
  const visibility = input.visibility === "shared" ? "shared" : ws.kind === "funder" ? "funder_internal" : "applicant_internal";
  const parties = { funder_workspace_id: visibility === "applicant_internal" ? null : app.workspace_id, applicant_workspace_id: visibility === "funder_internal" ? null : app.applicant_workspace_id };
  const existing = (await ctx.repos.table("threads").find({ subject_type: "application", subject_id: app.id, visibility })).find((t) => t.title !== "Team comments");
  const thread = existing ?? (await ctx.repos.table("threads").insert({ workspace_id: ws.id, subject_type: "application", subject_id: app.id, visibility, ...parties }));
  return threadView(thread, await ctx.repos.table("messages").find({ thread_id: thread.id }, { orderBy: "created_at" }));
}

/**
 * Email the people who should hear about a new message: on a shared thread, both workspaces (the
 * author aside); on an internal thread, the author's own team. Each member's preferences decide
 * whether they get it now, in a digest, or not by email. Replies to the email come back into the
 * thread (`thread+<id>@…`, handled by the Resend inbound webhook).
 */
async function notifyThread(ctx: ServiceContext, thread: Thread, ws: ServiceWorkspace, message: Row<"messages">) {
  const targets = [...new Set(thread.visibility === "shared" ? [thread.funder_workspace_id, thread.applicant_workspace_id] : [ws.id])].filter((id): id is string => !!id);
  const sender = await ctx.repos.table("workspaces").one({ id: ws.id });
  const app = thread.subject_type === "application" ? await ctx.repos.table("applications").one({ id: thread.subject_id }) : null;
  const replyTo = ctx.config.inboundDomain ? `thread+${thread.id}@${ctx.config.inboundDomain}` : undefined;
  for (const workspaceId of targets) {
    const target = workspaceId === ws.id ? sender : await ctx.repos.table("workspaces").one({ id: workspaceId });
    if (!target) continue;
    const link = app ? `${ctx.config.webBaseUrl}/w/${target.handle}/applications/${apiId("application", app.id)}` : `${ctx.config.webBaseUrl}/w/${target.handle}`;
    await mailMembers(ctx, {
      workspaceId,
      category: "application",
      subject: `New message${app?.title ? ` about ${app.title}` : ""} from ${sender?.display_name ?? "a collaborator"}`,
      text: message.body.slice(0, 2000),
      link,
      exceptUserId: ctx.actor.userId,
      ...(replyTo ? { replyTo } : {}),
      idempotencyKey: `message:${message.id}`,
    });
  }
}

export const messageInput = z.object({ body: z.string().trim().min(1).max(10_000) }).strict();

export async function postMessage(ctx: ServiceContext, threadId: string, input: z.output<typeof messageInput>) {
  const ws = await authorize(ctx, { scope: "messages:write" });
  const thread = await ctx.repos.table("threads").one({ id: threadId });
  // Same answer for "no such thread" and "the other side's internal thread".
  if (!thread || !canSee(thread, ws)) throw new ApiError(404, "not_found", "Thread not found");
  const row = await ctx.repos.table("messages").insert({ thread_id: thread.id, author: ctx.actor.id, author_user_id: ctx.actor.userId, body: input.body });
  await ctx.repos.table("threads").update({ id: thread.id }, {});
  await audit(ctx, "message.posted", thread.subject_type, thread.subject_id, { threadId: thread.id, visibility: thread.visibility, messageId: row.id });
  await notifyThread(ctx, thread, ws, row);
  return messageView(row);
}

// ------------------------------------------------------------------------------------ tasks

const taskView = (t: Row<"tasks">) => ({ id: t.id, title: t.title, subjectType: t.subject_type, subjectId: t.subject_id, assigneeUserId: t.assignee_user_id, dueAt: t.due_at, doneAt: t.done_at, createdAt: t.created_at });

export async function listTasks(ctx: ServiceContext, filter: { open?: boolean; mine?: boolean } = {}) {
  const ws = await authorize(ctx, { scope: "messages:read" });
  const rows = await ctx.repos.table("tasks").find({ workspace_id: ws.id, ...(filter.mine && ctx.actor.userId ? { assignee_user_id: ctx.actor.userId } : {}) }, { orderBy: "created_at", ascending: false, limit: 500 });
  return rows.filter((t) => !filter.open || !t.done_at).map(taskView);
}

export const taskInput = z.object({ title: z.string().trim().min(1).max(300), subjectType: z.enum(["application", "award", "requirement", "outside_application"]).optional(), subjectId: z.uuid().optional(), assigneeUserId: z.uuid().nullable().optional(), dueAt: z.iso.datetime().nullable().optional() }).strict();
export const taskPatch = z.object({ title: z.string().trim().min(1).max(300).optional(), assigneeUserId: z.uuid().nullable().optional(), dueAt: z.iso.datetime().nullable().optional(), done: z.boolean().optional() }).strict();

async function assertAssignee(ctx: ServiceContext, workspaceId: string, userId: string | null | undefined) {
  if (userId && !(await ctx.repos.table("workspace_members").one({ workspace_id: workspaceId, user_id: userId }))) throw new ApiError(422, "not_a_member", "That person is not a member of this workspace");
}

export async function createTask(ctx: ServiceContext, input: z.output<typeof taskInput>) {
  const ws = await authorize(ctx, { scope: "messages:write" });
  await assertAssignee(ctx, ws.id, input.assigneeUserId);
  // A task on an outside application is the applicant's own: the application must be in this workspace, and visible to the caller.
  if (input.subjectType === "outside_application") {
    if (!input.subjectId) throw new ApiError(400, "bad_request", "Name the outside application", [{ code: "invalid_field", field: "subjectId" }]);
    await loadOutside(ctx, input.subjectId, "applications:write");
  }
  return taskView(await ctx.repos.table("tasks").insert({ workspace_id: ws.id, title: input.title, subject_type: input.subjectType ?? null, subject_id: input.subjectId ?? null, assignee_user_id: input.assigneeUserId ?? null, due_at: input.dueAt ?? null, created_by: ctx.actor.userId }));
}

export async function updateTask(ctx: ServiceContext, taskId: string, input: z.output<typeof taskPatch>) {
  const ws = await authorize(ctx, { scope: "messages:write" });
  const current = required(await ctx.repos.table("tasks").one({ id: taskId, workspace_id: ws.id }), "Task");
  await assertAssignee(ctx, ws.id, input.assigneeUserId);
  const [row] = await ctx.repos.table("tasks").update(
    { id: current.id },
    {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.assigneeUserId !== undefined ? { assignee_user_id: input.assigneeUserId } : {}),
      ...(input.dueAt !== undefined ? { due_at: input.dueAt } : {}),
      ...(input.done !== undefined ? { done_at: input.done ? (current.done_at ?? ctx.now().toISOString()) : null } : {}),
    },
  );
  return taskView(row!);
}
