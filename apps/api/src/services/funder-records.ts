// SPDX-License-Identifier: AGPL-3.0-only
// An applicant's light record of each funder (owner decision D6): contacts, notes, the funder's
// portal and who on the team holds its login. Not a CRM: no donor management, no outreach
// pipeline. Private to the applicant workspace, like outside applications.
import { cleanLine, cleanText } from "@gms/notify";
import { toMoney } from "@gms/protocol";
import { z } from "zod";
import { ApiError, notFound } from "../lib/errors.ts";
import { apiId } from "../lib/ids.ts";
import { guardWrite, type ServiceContext } from "./context.ts";
import { outsideWorkspace, stageLabel } from "./outside.ts";
import type { Row } from "./repos/types.ts";

type Record_ = Row<"funder_records">;

const contact = z
  .object({
    name: z.string().transform(cleanLine).pipe(z.string().min(1).max(200)),
    role: z.string().transform(cleanLine).pipe(z.string().max(200)).optional(),
    email: z.string().trim().max(320).pipe(z.email()).optional(),
    phone: z.string().trim().max(40).regex(/^[0-9+().\-\s x]{3,40}$/, "A phone number").optional(),
  })
  .strict();
/** A person's name. Never a password, a username or a code: the GMS keeps no portal credentials. */
const loginHolder = z
  .string()
  .transform(cleanLine)
  .pipe(z.string().min(1).max(200))
  .refine((v) => /\p{L}/u.test(v) && !/(pass(word|code)?\b|pwd|\bpin\b|login:|user(name)?:|[:=]\s*\S)/i.test(v), "Give the name of the person who holds the login, never the login itself");

const fields = {
  website: z.string().trim().max(500).pipe(z.url({ protocol: /^https?$/ })).nullable().optional(),
  notes: z.string().transform(cleanText).pipe(z.string().max(20_000)).nullable().optional(),
  contacts: z.array(contact).max(20).optional(),
  portalUrl: z.string().trim().max(2000).pipe(z.url({ protocol: /^https?$/ })).nullable().optional(),
  portalLoginHolder: loginHolder.nullable().optional(),
};
export const recordInput = z.object({ name: z.string().transform(cleanLine).pipe(z.string().min(1).max(200)), ...fields }).strict();
export const recordPatch = z.object({ name: z.string().transform(cleanLine).pipe(z.string().min(1).max(200)).optional(), ...fields }).strict();

const recordView = (r: Record_) => ({ id: r.id, name: r.name, website: r.website, notes: r.notes, contacts: r.contacts, portalUrl: r.portal_url, portalLoginHolder: r.portal_login_holder, createdAt: r.created_at, updatedAt: r.updated_at });

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

async function assertNameFree(ctx: ServiceContext, workspaceId: string, name: string, except?: string) {
  const clash = (await ctx.repos.table("funder_records").find({ workspace_id: workspaceId })).find((r) => r.id !== except && sameName(r.name, name));
  if (clash) throw new ApiError(409, "conflict", "There is already a record for a funder with this name", [{ code: "existing", detail: clash.id }]);
}

/**
 * The applications to a funder: the outside ones linked to the record, and built-in ones whose
 * funder workspace has exactly the record's name (labelled a name match: nothing else ties them).
 */
async function applicationsOf(ctx: ServiceContext, r: Record_) {
  const outside = await ctx.repos.table("outside_applications").find({ workspace_id: r.workspace_id, funder_record_id: r.id }, { orderBy: "created_at", ascending: false });
  const funders = (await ctx.repos.table("workspaces").find({ kind: "funder", display_name: r.name.trim() })).map((w) => w.id);
  const builtIn = funders.length ? await ctx.repos.table("applications").find({ applicant_workspace_id: r.workspace_id, workspace_id: funders }, { orderBy: "created_at", ascending: false }) : [];
  return [
    ...outside.map((a) => ({ kind: "outside_application" as const, id: a.id, title: a.title, stage: a.stage, stageLabel: stageLabel(a.stage), askAmount: a.ask_amount_minor === null ? null : toMoney(a.ask_amount_minor, a.currency), awardedAmount: a.awarded_amount_minor === null ? null : toMoney(a.awarded_amount_minor, a.currency), submittedAt: a.submitted_at, decidedAt: a.decided_at, archived: a.archived_at !== null, match: "linked" as const })),
    ...builtIn.map((a) => ({ kind: "gms_application" as const, id: apiId("application", a.id), title: a.title, status: a.status, askAmount: a.requested_amount_minor === null ? null : toMoney(a.requested_amount_minor, a.currency), submittedAt: a.submitted_at, match: "name" as const })),
  ];
}

export async function listRecords(ctx: ServiceContext) {
  const ws = await outsideWorkspace(ctx, "applications:read");
  const rows = (await ctx.repos.table("funder_records").find({ workspace_id: ws.id })).sort((a, b) => a.name.localeCompare(b.name));
  const out = [];
  for (const r of rows) {
    const apps = await applicationsOf(ctx, r);
    out.push({ ...recordView(r), applicationCount: apps.length });
  }
  return out;
}

export async function getRecord(ctx: ServiceContext, id: string) {
  const ws = await outsideWorkspace(ctx, "applications:read");
  const r = await ctx.repos.table("funder_records").one({ id, workspace_id: ws.id });
  if (!r) throw notFound("Funder record");
  return { ...recordView(r), applications: await applicationsOf(ctx, r) };
}

export async function createRecord(ctx: ServiceContext, input: z.output<typeof recordInput>) {
  const ws = await outsideWorkspace(ctx, "applications:write");
  await assertNameFree(ctx, ws.id, input.name);
  const r = await guardWrite("A record for this funder", () =>
    ctx.repos.table("funder_records").insert({ workspace_id: ws.id, name: input.name, website: input.website ?? null, notes: input.notes || null, contacts: (input.contacts ?? []) as Record_["contacts"], portal_url: input.portalUrl ?? null, portal_login_holder: input.portalLoginHolder ?? null, created_by: ctx.actor.userId }),
  );
  // Outside applications already naming this funder are linked to the new record.
  for (const a of await ctx.repos.table("outside_applications").find({ workspace_id: ws.id, funder_record_id: null })) {
    if (a.funder_name && sameName(a.funder_name, r.name)) await ctx.repos.table("outside_applications").update({ id: a.id, workspace_id: ws.id }, { funder_record_id: r.id });
  }
  return { ...recordView(r), applications: await applicationsOf(ctx, r) };
}

export async function patchRecord(ctx: ServiceContext, id: string, input: z.output<typeof recordPatch>) {
  const ws = await outsideWorkspace(ctx, "applications:write");
  const r = await ctx.repos.table("funder_records").one({ id, workspace_id: ws.id });
  if (!r) throw notFound("Funder record");
  if (input.name !== undefined) await assertNameFree(ctx, ws.id, input.name, r.id);
  const [saved] = await guardWrite("A record for this funder", () =>
    ctx.repos.table("funder_records").update(
      { id: r.id, workspace_id: ws.id },
      {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.website !== undefined ? { website: input.website } : {}),
        ...(input.notes !== undefined ? { notes: input.notes || null } : {}),
        ...(input.contacts !== undefined ? { contacts: input.contacts as Record_["contacts"] } : {}),
        ...(input.portalUrl !== undefined ? { portal_url: input.portalUrl } : {}),
        ...(input.portalLoginHolder !== undefined ? { portal_login_holder: input.portalLoginHolder } : {}),
      },
    ),
  );
  return { ...recordView(saved ?? r), applications: await applicationsOf(ctx, saved ?? r) };
}

/** Delete a record. Its outside applications stay, unlinked (they keep the funder's name). */
export async function deleteRecord(ctx: ServiceContext, id: string) {
  const ws = await outsideWorkspace(ctx, "applications:write");
  const r = await ctx.repos.table("funder_records").one({ id, workspace_id: ws.id });
  if (!r) throw notFound("Funder record");
  await ctx.repos.table("outside_applications").update({ workspace_id: ws.id, funder_record_id: r.id }, { funder_record_id: null });
  await ctx.repos.table("funder_records").remove({ id: r.id, workspace_id: ws.id });
  return { id: r.id, deleted: true };
}
