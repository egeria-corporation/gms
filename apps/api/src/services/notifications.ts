// SPDX-License-Identifier: AGPL-3.0-only
// A member's notifications. Nothing is stored per notification: the list is derived from the
// workspace's ledger and, for applicants, from the events on their applications (which the funder's
// ledger holds, not theirs). The member's own state (what is read, which categories they want) is
// kept on their membership row.
import { z } from "zod";
import { ApiError } from "../lib/errors.ts";
import { apiId } from "../lib/ids.ts";
import { authorize, type ServiceContext, type ServiceWorkspace } from "./context.ts";
import type { Row } from "./repos/types.ts";

const WINDOW = 200;
const MAX_READ_IDS = 500;
/** Ledger events worth a person's attention, by first segment. Routine bookkeeping stays in the ledger. */
export const CATEGORIES = ["application", "decision", "award", "agreement", "payment", "requirement", "submission", "organization", "approval", "review", "agent"] as const;
export type Category = (typeof CATEGORIES)[number];
const CATEGORY_OF: Record<string, Category> = {
  application: "application", decision: "decision", award: "award", agreement: "agreement", amendment: "award",
  tranche: "payment", payment: "payment", payee: "payment", requirement: "requirement", submission: "submission",
  org_change: "organization", organization: "organization", consent: "organization", approval: "approval",
  review: "review", mcp_connection: "agent", api_client: "agent",
};
const SUBJECT_PREFIX: Record<string, Parameters<typeof apiId>[0]> = { application: "application", award: "award" } as Record<string, Parameters<typeof apiId>[0]>;

export interface Notification {
  id: string;
  type: string;
  category: Category;
  title: string;
  subjectType: string | null;
  subjectId: string | null;
  message: string | null;
  at: string;
  read: boolean;
}

const sentence = (type: string) => {
  const s = type.replace(/[._]/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
};
const subjectRef = (type: string | null, id: string | null) => (type && id && SUBJECT_PREFIX[type] && /^[0-9a-f-]{36}$/.test(id) ? apiId(SUBJECT_PREFIX[type], id) : id);

async function member(ctx: ServiceContext): Promise<{ ws: ServiceWorkspace; row: Row<"workspace_members"> }> {
  // Notifications belong to a person in a workspace; an agent acting for them reads the same list.
  const ws = await authorize(ctx, { person: true });
  if (!ws) throw new ApiError(403, "workspace_required", "Name a workspace for this action");
  const row = await ctx.repos.table("workspace_members").one({ workspace_id: ws.id, user_id: ctx.actor.userId! });
  if (!row) throw new ApiError(403, "not_a_member", "You are not a member of this workspace");
  return { ws, row };
}

const prefsOf = (row: Row<"workspace_members">) => normalize(row.notification_preferences as Partial<Preferences>);
/** A membership's stored preferences with every category filled in. */
export const normalizePreferences = (stored: Partial<Preferences> | null | undefined) => normalize(stored ?? {});
const channel = z.object({ inApp: z.boolean().default(true), email: z.boolean().default(true) }).strict();
export const preferencesInput = z.object({ digest: z.enum(["immediate", "daily", "weekly", "off"]).default("immediate"), channels: z.partialRecord(z.enum(CATEGORIES), channel).default({}) }).strict();
type Preferences = z.output<typeof preferencesInput>;

function normalize(p: Partial<Preferences>) {
  const channels = Object.fromEntries(CATEGORIES.map((c) => [c, { inApp: p.channels?.[c]?.inApp ?? true, email: p.channels?.[c]?.email ?? true }])) as Record<Category, { inApp: boolean; email: boolean }>;
  return { digest: p.digest ?? "immediate", channels };
}

export async function getPreferences(ctx: ServiceContext) {
  return prefsOf((await member(ctx)).row);
}

export async function putPreferences(ctx: ServiceContext, input: Preferences) {
  if (ctx.actor.kind !== "user") throw new ApiError(403, "person_required", "Notification preferences are set by the person they belong to");
  const { row } = await member(ctx);
  const [saved] = await ctx.repos.table("workspace_members").update({ id: row.id }, { notification_preferences: input as unknown as Row<"workspace_members">["notification_preferences"] });
  return prefsOf(saved ?? row);
}

async function derive(ctx: ServiceContext, ws: ServiceWorkspace): Promise<Omit<Notification, "read">[]> {
  const mine = `user:${ctx.actor.userId}`;
  const own = (actor: string) => actor === mine || actor.startsWith(`${mine}/`);
  const out: Omit<Notification, "read">[] = [];
  for (const e of await ctx.ledger.list({ workspaceId: ws.id, limit: WINDOW })) {
    const category = CATEGORY_OF[e.eventType.split(".")[0]!];
    // What the member did themselves is not news to them (an agent acting for them is).
    if (!category || e.actor === mine) continue;
    out.push({ id: e.id, type: e.eventType, category, title: sentence(e.eventType), subjectType: e.subjectType ?? null, subjectId: subjectRef(e.subjectType ?? null, e.subjectId ?? null), message: null, at: e.occurredAt });
  }
  if (ws.kind === "applicant") {
    let apps = await ctx.repos.table("applications").find({ applicant_workspace_id: ws.id }, { limit: WINDOW });
    if (ws.role === "consultant") apps = apps.filter((a) => ((ws.memberScope?.applicationIds as string[] | undefined) ?? []).includes(a.id));
    const events = apps.length ? await ctx.repos.table("application_events").find({ application_id: apps.map((a) => a.id) }, { orderBy: "created_at", ascending: false, limit: WINDOW }) : [];
    for (const e of events) {
      if (own(e.actor ?? "") || e.type === "started") continue;
      const app = apps.find((a) => a.id === e.application_id);
      const type = `application.${e.type}`;
      out.push({ id: e.id, type, category: "application", title: `${sentence(type)}${app?.title ? `: ${app.title}` : ""}`, subjectType: "application", subjectId: apiId("application", e.application_id), message: e.type === "request_revision" ? ((e.payload as { message?: string }).message ?? null) : null, at: e.created_at });
    }
  }
  return out.sort((a, b) => b.at.localeCompare(a.at)).slice(0, WINDOW);
}

/**
 * A member's notifications without a request: the digest job reads them as that member would see
 * them (same derivation, same consultant scoping), newest first.
 */
export async function deriveFor(base: Pick<ServiceContext, "repos" | "ledger" | "webhooks" | "now" | "config" | "ports">, m: Row<"workspace_members">, ws: Row<"workspaces">) {
  const actor = { kind: "user" as const, userId: m.user_id, clientId: null, ledger: { kind: "user" as const, userId: m.user_id }, id: `user:${m.user_id}` };
  const workspace: ServiceWorkspace = { id: ws.id, kind: ws.kind as ServiceWorkspace["kind"], role: m.role, memberScope: (m.scope as Record<string, unknown> | null) ?? null };
  return derive({ ...base, actor, workspace, scopes: [] }, workspace);
}

export async function listNotifications(ctx: ServiceContext, opts: { unread?: boolean } = {}) {
  const { ws, row } = await member(ctx);
  const prefs = prefsOf(row);
  const readIds = new Set(row.notifications_read_ids as unknown as string[]);
  const readAt = row.notifications_read_at;
  const all = (await derive(ctx, ws)).filter((n) => prefs.channels[n.category].inApp).map((n): Notification => ({ ...n, read: (!!readAt && n.at <= readAt) || readIds.has(n.id) }));
  return { unread: all.filter((n) => !n.read).length, items: opts.unread ? all.filter((n) => !n.read) : all };
}

export const readInput = z.union([z.object({ ids: z.array(z.uuid()).min(1).max(200) }).strict(), z.object({ all: z.literal(true) }).strict()]);

export async function markRead(ctx: ServiceContext, input: z.output<typeof readInput>) {
  const { row } = await member(ctx);
  const patch = "all" in input ? { notifications_read_at: ctx.now().toISOString(), notifications_read_ids: [] } : { notifications_read_ids: [...new Set([...input.ids, ...(row.notifications_read_ids as unknown as string[])])].slice(0, MAX_READ_IDS) };
  await ctx.repos.table("workspace_members").update({ id: row.id }, patch as Partial<Row<"workspace_members">>);
  return { unread: (await listNotifications(ctx)).unread };
}
