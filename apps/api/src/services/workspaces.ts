// SPDX-License-Identifier: AGPL-3.0-only
// Workspaces, members and invitations (build spec §9.2, workspace & team).
import { z } from "zod";
import { randomToken, sha256b64url } from "../auth/crypto.ts";
import { APPLICANT_ROLES, FUNDER_ROLES, roleRequiresMfa, type WorkspaceKind } from "../auth/scopes.ts";
import { ApiError, notFound } from "../lib/errors.ts";
import { audit, authorize, guardWrite, required, type ServiceContext } from "./context.ts";
import type { Row } from "./repos/types.ts";

const HEX = /^#[0-9a-fA-F]{6}$/;
/** System accent used when a tenant accent fails contrast (theme tokens: --og-teal-dark on white). */
export const SYSTEM_BRAND = { accent: "#145450", onAccent: "#FFFFFF" } as const;

const brandInput = z
  .object({ logoUrl: z.url().max(2000).optional(), accent: z.string().regex(HEX).optional(), onAccent: z.string().regex(HEX).optional(), fontPreference: z.string().max(60).optional() })
  .strict();

export const createWorkspaceInput = z
  .object({
    kind: z.enum(["funder", "applicant"]),
    handle: z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/, "Use 3 to 64 lowercase letters, digits and hyphens"),
    displayName: z.string().trim().min(1).max(200),
    legalName: z.string().trim().min(1).max(300).optional(),
    passportOrgId: z.uuid().optional(),
    brand: brandInput.optional(),
  })
  .strict();

export const updateWorkspaceInput = z.object({ displayName: z.string().trim().min(1).max(200).optional(), brand: brandInput.optional(), settings: z.record(z.string(), z.unknown()).optional() }).strict();

const luminance = (hex: string): number => {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** WCAG 2.x contrast ratio between two `#rrggbb` colors. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Text on the accent must meet WCAG AA (4.5:1); otherwise the system accent is used and a warning returned. */
export function resolveBrand(brand: z.output<typeof brandInput> | undefined): { brand: Record<string, string>; warnings: string[] } {
  const out: Record<string, string> = {};
  const warnings: string[] = [];
  if (brand?.logoUrl) out.logoUrl = brand.logoUrl;
  if (brand?.fontPreference) out.fontPreference = brand.fontPreference;
  const accent = brand?.accent ?? SYSTEM_BRAND.accent;
  const onAccent = brand?.onAccent ?? (contrastRatio(accent, "#FFFFFF") >= contrastRatio(accent, "#0D2A43") ? "#FFFFFF" : "#0D2A43");
  if (contrastRatio(accent, onAccent) >= 4.5) {
    out.accent = accent;
    out.onAccent = onAccent;
  } else {
    out.accent = SYSTEM_BRAND.accent;
    out.onAccent = SYSTEM_BRAND.onAccent;
    warnings.push(`Text on ${accent} does not reach a 4.5:1 contrast ratio, so the OpenGrants accent is used instead.`);
  }
  return { brand: out, warnings };
}

export const workspaceView = (w: Row<"workspaces">) => ({
  id: w.id,
  kind: w.kind as WorkspaceKind,
  handle: w.handle,
  displayName: w.display_name,
  legalName: w.legal_name,
  passportOrgId: w.passport_org_id,
  verificationLevel: w.verification_level,
  brand: w.brand,
  settings: w.settings,
  status: w.status,
  createdAt: w.created_at,
  updatedAt: w.updated_at,
});

const memberView = (m: Row<"workspace_members">, kind: WorkspaceKind, who?: { email: string | null; name: string | null }) => {
  const scope = (m.scope as { email?: unknown; name?: unknown } | null) ?? {};
  return {
    userId: m.user_id,
    // The auth account's address and name; an invited member carries the invited address until then.
    email: who?.email ?? (typeof scope.email === "string" ? scope.email : null),
    name: who?.name ?? (typeof scope.name === "string" ? scope.name : null),
    role: m.role,
    scope: m.scope,
    expiresAt: m.expires_at,
    mfaEnrolledAt: m.mfa_enrolled_at,
    requiresMfa: roleRequiresMfa(kind, m.role),
    invitedBy: m.invited_by,
    createdAt: m.created_at,
  };
};

const rolesFor = (kind: WorkspaceKind): readonly string[] => (kind === "funder" ? FUNDER_ROLES : APPLICANT_ROLES);

function assertRole(kind: WorkspaceKind, role: string) {
  if (!rolesFor(kind).includes(role)) throw new ApiError(422, "invalid_role", `${role} is not a role in ${kind} workspaces. Use one of: ${rolesFor(kind).join(", ")}`);
}

/** The workspaces the signed-in person can open, for the switcher. */
export async function listMyWorkspaces(ctx: ServiceContext) {
  await authorize(ctx, { person: true });
  const nowMs = ctx.now().getTime();
  const memberships = (await ctx.repos.table("workspace_members").find({ user_id: ctx.actor.userId! })).filter((m) => !m.expires_at || Date.parse(m.expires_at) > nowMs);
  if (!memberships.length) return [];
  const workspaces = await ctx.repos.table("workspaces").find({ id: memberships.map((m) => m.workspace_id) }, { orderBy: "display_name" });
  return workspaces.map((w) => {
    const role = memberships.find((m) => m.workspace_id === w.id)!.role;
    return { ...workspaceView(w), role, requiresMfa: roleRequiresMfa(w.kind as WorkspaceKind, role) };
  });
}

/** A signed-in person creates a workspace and becomes its first admin. */
export async function createWorkspace(ctx: ServiceContext, input: z.output<typeof createWorkspaceInput>) {
  await authorize(ctx, { person: true });
  const { brand, warnings } = resolveBrand(input.brand);
  const workspace = await guardWrite("A workspace with this handle", () =>
    ctx.repos.table("workspaces").insert({
      kind: input.kind,
      handle: input.handle,
      display_name: input.displayName,
      legal_name: input.legalName ?? null,
      passport_org_id: input.passportOrgId ?? null,
      brand,
      status: "active",
    }),
  );
  await ctx.repos.table("workspace_members").insert({ workspace_id: workspace.id, user_id: ctx.actor.userId!, role: "admin" });
  await audit(ctx, "workspace.created", "workspace", workspace.id, { kind: workspace.kind, handle: workspace.handle }, workspace.id);
  await audit(ctx, "member.added", "workspace", workspace.id, { userId: ctx.actor.userId, role: "admin" }, workspace.id);
  return { workspace: workspaceView(workspace), warnings };
}

export async function getWorkspace(ctx: ServiceContext, id: string) {
  await authorize(ctx, { owner: id, what: "Workspace", ...(ctx.actor.userId ? {} : { scope: "workspace:admin" as const }) });
  return workspaceView(required(await ctx.repos.table("workspaces").one({ id }), "Workspace"));
}

export async function updateWorkspace(ctx: ServiceContext, id: string, input: z.output<typeof updateWorkspaceInput>) {
  await authorize(ctx, { scope: "workspace:admin", roles: ["admin"], owner: id, what: "Workspace" });
  // `brand` and `settings` are merge patches: a key that is not sent keeps its value and `null`
  // removes it, so two admins changing different settings do not overwrite each other.
  const current = required(await ctx.repos.table("workspaces").one({ id }), "Workspace");
  const merge = (base: unknown, patch: Record<string, unknown>) => Object.fromEntries(Object.entries({ ...((base as Record<string, unknown> | null) ?? {}), ...patch }).filter(([, v]) => v !== null && v !== undefined));
  const resolved = input.brand ? resolveBrand(merge(current.brand, input.brand) as z.output<typeof brandInput>) : null;
  const [row] = await ctx.repos.table("workspaces").update(
    { id },
    {
      ...(input.displayName ? { display_name: input.displayName } : {}),
      ...(resolved ? { brand: resolved.brand } : {}),
      ...(input.settings ? { settings: merge(current.settings, input.settings) as Row<"workspaces">["settings"] } : {}),
    },
  );
  await audit(ctx, "workspace.updated", "workspace", id, { fields: Object.keys(input) });
  return { workspace: workspaceView(required(row, "Workspace")), warnings: resolved?.warnings ?? [] };
}

export async function listMembers(ctx: ServiceContext, workspaceId: string) {
  const ws = await authorize(ctx, { scope: "workspace:admin", owner: workspaceId, what: "Workspace" });
  const rows = await ctx.repos.table("workspace_members").find({ workspace_id: workspaceId }, { orderBy: "created_at" });
  const people = (await ctx.ports.directory?.lookup(rows.map((m) => m.user_id))) ?? new Map<string, { email: string | null; name: string | null }>();
  return rows.map((m) => memberView(m, ws.kind, people.get(m.user_id)));
}

export const memberInput = z.object({ userId: z.uuid(), role: z.string(), scope: z.record(z.string(), z.unknown()).optional(), expiresAt: z.iso.datetime().optional() }).strict();
export const memberPatch = z.object({ role: z.string().optional(), scope: z.record(z.string(), z.unknown()).optional(), expiresAt: z.iso.datetime().nullable().optional() }).strict();

export async function addMember(ctx: ServiceContext, workspaceId: string, input: z.output<typeof memberInput>) {
  const ws = await authorize(ctx, { scope: "workspace:admin", roles: ["admin"], owner: workspaceId, what: "Workspace" });
  assertRole(ws.kind, input.role);
  const row = await guardWrite("This member", () =>
    ctx.repos.table("workspace_members").insert({ workspace_id: workspaceId, user_id: input.userId, role: input.role, scope: (input.scope ?? {}) as Row<"workspace_members">["scope"], expires_at: input.expiresAt ?? null, invited_by: ctx.actor.userId }),
  );
  await audit(ctx, "member.added", "workspace", workspaceId, { userId: input.userId, role: input.role });
  return memberView(row, ws.kind);
}

async function assertAnotherAdmin(ctx: ServiceContext, workspaceId: string, userId: string) {
  const admins = await ctx.repos.table("workspace_members").find({ workspace_id: workspaceId, role: "admin" });
  if (!admins.some((a) => a.user_id !== userId)) throw new ApiError(409, "last_admin", "A workspace needs at least one admin. Make someone else an admin first");
}

export async function updateMember(ctx: ServiceContext, workspaceId: string, userId: string, input: z.output<typeof memberPatch>) {
  const ws = await authorize(ctx, { scope: "workspace:admin", roles: ["admin"], owner: workspaceId, what: "Workspace" });
  const current = required(await ctx.repos.table("workspace_members").one({ workspace_id: workspaceId, user_id: userId }), "Member");
  if (input.role) assertRole(ws.kind, input.role);
  if (current.role === "admin" && input.role && input.role !== "admin") await assertAnotherAdmin(ctx, workspaceId, userId);
  const [row] = await ctx.repos.table("workspace_members").update(
    { workspace_id: workspaceId, user_id: userId },
    { ...(input.role ? { role: input.role } : {}), ...(input.scope ? { scope: input.scope as Row<"workspace_members">["scope"] } : {}), ...(input.expiresAt !== undefined ? { expires_at: input.expiresAt } : {}) },
  );
  await audit(ctx, "member.updated", "workspace", workspaceId, { userId, from: current.role, to: input.role ?? current.role });
  return memberView(row!, ws.kind);
}

export async function removeMember(ctx: ServiceContext, workspaceId: string, userId: string) {
  await authorize(ctx, { scope: "workspace:admin", roles: ["admin"], owner: workspaceId, what: "Workspace" });
  const current = required(await ctx.repos.table("workspace_members").one({ workspace_id: workspaceId, user_id: userId }), "Member");
  if (current.role === "admin") await assertAnotherAdmin(ctx, workspaceId, userId);
  await ctx.repos.table("workspace_members").remove({ workspace_id: workspaceId, user_id: userId });
  await audit(ctx, "member.removed", "workspace", workspaceId, { userId, role: current.role });
}

export const invitationInput = z
  .object({ email: z.email().max(320), role: z.string(), scope: z.record(z.string(), z.unknown()).optional(), expiresInDays: z.number().int().min(1).max(90).optional() })
  .strict();

/** Create an invitation. The token is returned once, for the invitation link; only its hash is stored. */
export async function createInvitation(ctx: ServiceContext, workspaceId: string, input: z.output<typeof invitationInput>) {
  const ws = await authorize(ctx, { scope: "workspace:admin", roles: ["admin"], owner: workspaceId, what: "Workspace" });
  assertRole(ws.kind, input.role);
  const token = randomToken("gms_inv_");
  const expiresAt = new Date(ctx.now().getTime() + (input.expiresInDays ?? 14) * 86_400_000).toISOString();
  const row = await ctx.repos.table("invitations").insert({
    workspace_id: workspaceId,
    email: input.email.toLowerCase(),
    role: input.role,
    scope: (input.scope ?? {}) as Row<"invitations">["scope"],
    token_hash: await sha256b64url(token),
    invited_by: ctx.actor.userId,
    expires_at: expiresAt,
  });
  await audit(ctx, "invitation.created", "workspace", workspaceId, { invitationId: row.id, role: input.role });
  return { id: row.id, email: row.email, role: row.role, expiresAt, token, acceptUrl: `${ctx.config.webBaseUrl}/invitations/accept?token=${encodeURIComponent(token)}` };
}

/** A signed-in person redeems an invitation and joins the workspace. */
export async function acceptInvitation(ctx: ServiceContext, token: string) {
  await authorize(ctx, { person: true });
  const inv = await ctx.repos.table("invitations").one({ token_hash: await sha256b64url(token) });
  if (!inv || inv.accepted_at || Date.parse(inv.expires_at) <= ctx.now().getTime()) throw notFound("Invitation");
  const userId = ctx.actor.userId!;
  const existing = await ctx.repos.table("workspace_members").one({ workspace_id: inv.workspace_id, user_id: userId });
  // The invited address labels the member in lists (the directory replaces it with the account's own).
  if (!existing) await ctx.repos.table("workspace_members").insert({ workspace_id: inv.workspace_id, user_id: userId, role: inv.role, scope: { ...((inv.scope as Record<string, unknown> | null) ?? {}), email: inv.email } as Row<"workspace_members">["scope"], invited_by: inv.invited_by });
  await ctx.repos.table("invitations").update({ id: inv.id }, { accepted_at: ctx.now().toISOString() });
  await audit(ctx, "invitation.accepted", "workspace", inv.workspace_id, { invitationId: inv.id, userId, role: inv.role }, inv.workspace_id);
  const workspace = required(await ctx.repos.table("workspaces").one({ id: inv.workspace_id }), "Workspace");
  return { workspace: workspaceView(workspace), role: existing?.role ?? inv.role };
}
