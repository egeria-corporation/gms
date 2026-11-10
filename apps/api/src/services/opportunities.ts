// SPDX-License-Identifier: AGPL-3.0-only
// Opportunities: CommonGrants `OpportunityBase` plus the GMS fields a funder edits (build spec
// §9.2, §11.3). Publishing validates the CommonGrants projection and stores it; nothing here
// writes to the OpenGrants index, which pulls from the public protocol routes.
import { ProjectionError, projectOpportunity, type FunderRow, type OpportunityBase, type OpportunityRow } from "@gms/protocol";
import { parseRules } from "@gms/rules";
import { z } from "zod";
import { apiId } from "../lib/ids.ts";
import { unprocessable } from "../lib/input.ts";
import { audit, authorize, changeStatus, guardWrite, required, type ServiceContext } from "./context.ts";
import type { PageRequest } from "./programs.ts";
import type { Row } from "./repos/types.ts";

const json = z.record(z.string(), z.unknown());
/** CommonGrants v0.5.0 `ApplicantTypeOptions`. */
export const APPLICANT_TYPES = [
  "individual",
  "organization",
  "government_state",
  "government_county",
  "government_municipal",
  "government_special_district",
  "government_tribal",
  "organization_tribal_other",
  "school_district_independent",
  "higher_education_public",
  "higher_education_private",
  "non_profit_with_501c3",
  "nonprofit_without_501c3",
  "for_profit_small_business",
  "for_profit_not_small_business",
  "unrestricted",
  "custom",
] as const;

export const opportunityInput = z
  .object({
    title: z.string().trim().min(1).max(300),
    slug: z
      .string()
      .regex(/^[a-z0-9][a-z0-9-]{0,98}[a-z0-9]$/, "Use lowercase letters, digits and hyphens")
      .optional(),
    description: z.string().max(50_000).optional(),
    programId: z.uuid().nullable().optional(),
    /** CommonGrants OppFunding and OppTimeline. */
    funding: json.optional(),
    keyDates: json.optional(),
    acceptedApplicantTypes: z.array(z.enum(APPLICANT_TYPES)).optional(),
    eligibilityRules: z.unknown().optional(),
    publish: z
      .object({
        publicPage: z.boolean().optional(),
        openGrantsIndex: z.boolean().optional(),
        sitemap: z.boolean().optional(),
        /** Shown on the public opportunity page only; never part of the CommonGrants record. */
        faq: z.array(z.object({ question: z.string().trim().min(1).max(300), answer: z.string().trim().min(1).max(5000) }).strict()).max(50).optional(),
        documents: z.array(z.object({ name: z.string().trim().min(1).max(200), url: z.url().refine((u) => u.startsWith("https://"), "Use an https link") }).strict()).max(20).optional(),
      })
      .strict()
      .optional(),
    customFields: json.optional(),
  })
  .strict();
export const opportunityPatch = opportunityInput.partial();
export const publishInput = z.object({ status: z.enum(["forecasted", "open"]).optional() }).strict();

type Opp = Row<"opportunities">;
type J = Opp["funding"];

export const slugify = (title: string): string =>
  title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100)
    .replace(/-+$/, "") || "opportunity";

export const opportunityView = (o: Opp) => ({
  id: apiId("opportunity", o.id),
  programId: o.program_id,
  slug: o.slug,
  title: o.title,
  description: o.description,
  status: o.status,
  funding: o.funding,
  keyDates: o.key_dates,
  acceptedApplicantTypes: o.accepted_applicant_types,
  eligibilityRules: o.eligibility_rules,
  publish: o.publish,
  customFields: o.custom_fields,
  published: o.published_at !== null,
  publishedAt: o.published_at,
  createdAt: o.created_at,
  updatedAt: o.updated_at,
});

function assertRules(rules: unknown) {
  const parsed = parseRules(rules);
  if (!parsed.ok) throw unprocessable("These eligibility rules are not valid", parsed.errors.map((e) => ({ path: `eligibilityRules${e.at}`, message: e.message })));
}

function columns(i: z.output<typeof opportunityPatch>) {
  return {
    ...(i.title !== undefined ? { title: i.title } : {}),
    ...(i.slug !== undefined ? { slug: i.slug } : {}),
    ...(i.description !== undefined ? { description: i.description } : {}),
    ...(i.programId !== undefined ? { program_id: i.programId } : {}),
    ...(i.funding !== undefined ? { funding: i.funding as J } : {}),
    ...(i.keyDates !== undefined ? { key_dates: i.keyDates as J } : {}),
    ...(i.acceptedApplicantTypes !== undefined ? { accepted_applicant_types: i.acceptedApplicantTypes } : {}),
    ...(i.eligibilityRules !== undefined ? { eligibility_rules: i.eligibilityRules as J } : {}),
    ...(i.customFields !== undefined ? { custom_fields: i.customFields as J } : {}),
  };
}

export const funderOf = (w: Row<"workspaces">): FunderRow => ({ passport_org_id: w.passport_org_id, handle: w.handle, display_name: w.display_name, legal_name: w.legal_name, ein: w.ein });

/** Project and validate; a row that is not a valid CommonGrants record is a 422 naming each problem. */
export function projectOrThrow(ctx: Pick<ServiceContext, "config">, opp: Opp, funder: Row<"workspaces">): OpportunityBase {
  try {
    return projectOpportunity({ opportunity: opp as unknown as OpportunityRow, funder: funderOf(funder) }, { baseUrl: ctx.config.baseUrl, webBaseUrl: ctx.config.webBaseUrl });
  } catch (e) {
    if (e instanceof ProjectionError) throw unprocessable("This opportunity is not a valid CommonGrants record yet", e.issues);
    throw e;
  }
}

async function assertProgram(ctx: ServiceContext, workspaceId: string, programId: string | null | undefined) {
  if (programId) required(await ctx.repos.table("programs").one({ id: programId, workspace_id: workspaceId }), "Program");
}

export async function listOpportunities(ctx: ServiceContext, page: PageRequest, filter: { status?: string; programId?: string } = {}) {
  const ws = await authorize(ctx, { scope: "opportunities:read", kind: "funder" });
  const where = { workspace_id: ws.id, ...(filter.status ? { status: filter.status } : {}), ...(filter.programId ? { program_id: filter.programId } : {}) };
  const [rows, total] = await Promise.all([ctx.repos.table("opportunities").find(where, { orderBy: "created_at", ascending: false, limit: page.pageSize, offset: page.offset }), ctx.repos.table("opportunities").count(where)]);
  return { items: rows.map(opportunityView), total };
}

export async function getOpportunity(ctx: ServiceContext, id: string) {
  const ws = await authorize(ctx, { scope: "opportunities:read", kind: "funder" });
  return opportunityView(required(await ctx.repos.table("opportunities").one({ id, workspace_id: ws.id }), "Opportunity"));
}

export async function createOpportunity(ctx: ServiceContext, input: z.output<typeof opportunityInput>) {
  const ws = await authorize(ctx, { scope: "opportunities:write", kind: "funder" });
  if (input.eligibilityRules !== undefined) assertRules(input.eligibilityRules);
  await assertProgram(ctx, ws.id, input.programId);
  const row = await guardWrite("An opportunity with this slug", () =>
    ctx.repos.table("opportunities").insert({
      workspace_id: ws.id,
      ...columns(input),
      title: input.title,
      slug: input.slug ?? slugify(input.title),
      ...(input.publish ? { publish: { publicPage: true, openGrantsIndex: true, sitemap: true, ...input.publish } } : {}),
    }),
  );
  await audit(ctx, "opportunity.created", "opportunity", row.id, { title: row.title, slug: row.slug });
  return opportunityView(row);
}

export async function updateOpportunity(ctx: ServiceContext, id: string, input: z.output<typeof opportunityPatch>) {
  const ws = await authorize(ctx, { scope: "opportunities:write", kind: "funder" });
  const current = required(await ctx.repos.table("opportunities").one({ id, workspace_id: ws.id }), "Opportunity");
  if (input.eligibilityRules !== undefined) assertRules(input.eligibilityRules);
  await assertProgram(ctx, ws.id, input.programId);
  const patch = { ...columns(input), ...(input.publish ? { publish: { ...(current.publish as object), ...input.publish } as J } : {}) };
  let cg: J | undefined;
  if (current.published_at) {
    // A published opportunity must stay a valid CommonGrants record: validate before anything is written.
    const funder = required(await ctx.repos.table("workspaces").one({ id: ws.id }), "Workspace");
    cg = projectOrThrow(ctx, { ...current, ...patch, updated_at: ctx.now().toISOString() } as Opp, funder) as unknown as J;
  }
  const [row] = await guardWrite("An opportunity with this slug", () => ctx.repos.table("opportunities").update({ id, workspace_id: ws.id }, { ...patch, ...(cg ? { cg } : {}) }));
  await audit(ctx, "opportunity.updated", "opportunity", id, { fields: Object.keys(input) });
  return opportunityView(row!);
}

/** What the public page and the CommonGrants record would be, without saving anything. */
export async function previewOpportunity(ctx: ServiceContext, id: string) {
  const ws = await authorize(ctx, { scope: "opportunities:read", kind: "funder" });
  const opp = required(await ctx.repos.table("opportunities").one({ id, workspace_id: ws.id }), "Opportunity");
  const funder = required(await ctx.repos.table("workspaces").one({ id: ws.id }), "Workspace");
  return { commonGrants: projectOrThrow(ctx, opp, funder), publicUrl: `${ctx.config.webBaseUrl}/f/${funder.handle}/o/${opp.slug}`, brand: funder.brand, publish: opp.publish };
}

export async function publishOpportunity(ctx: ServiceContext, id: string, input: z.output<typeof publishInput> = {}) {
  const ws = await authorize(ctx, { scope: "opportunities:write", kind: "funder" });
  const opp = required(await ctx.repos.table("opportunities").one({ id, workspace_id: ws.id }), "Opportunity");
  const funder = required(await ctx.repos.table("workspaces").one({ id: ws.id }), "Workspace");
  const to = input.status ?? "open";
  const at = ctx.now().toISOString();
  const next = { ...opp, status: to, published_at: opp.published_at ?? at, updated_at: at } as Opp;
  let saved: Opp | undefined;
  await changeStatus(ctx, {
    event: "opportunity.published",
    subjectType: "opportunity",
    subjectId: id,
    current: opp.status,
    from: ["forecasted", "open"],
    to,
    guard: () => (opp.description.trim() ? null : "Add a description before publishing; the public page and the CommonGrants record both need one"),
    write: async () => {
      const cg = projectOrThrow(ctx, next, funder) as unknown as J;
      [saved] = await ctx.repos.table("opportunities").update({ id, workspace_id: ws.id }, { status: to, published_at: next.published_at, cg });
    },
    webhook: "opportunity.published",
    data: { slug: opp.slug, publicUrl: `${ctx.config.webBaseUrl}/f/${funder.handle}/o/${opp.slug}` },
  });
  return opportunityView(saved!);
}

export async function closeOpportunity(ctx: ServiceContext, id: string) {
  const ws = await authorize(ctx, { scope: "opportunities:write", kind: "funder" });
  const opp = required(await ctx.repos.table("opportunities").one({ id, workspace_id: ws.id }), "Opportunity");
  const funder = required(await ctx.repos.table("workspaces").one({ id: ws.id }), "Workspace");
  let saved: Opp | undefined;
  await changeStatus(ctx, {
    event: "opportunity.closed",
    subjectType: "opportunity",
    subjectId: id,
    current: opp.status,
    from: ["forecasted", "open"],
    to: "closed",
    write: async () => {
      const cg = opp.published_at ? (projectOrThrow(ctx, { ...opp, status: "closed", updated_at: ctx.now().toISOString() } as Opp, funder) as unknown as J) : null;
      [saved] = await ctx.repos.table("opportunities").update({ id, workspace_id: ws.id }, { status: "closed", ...(cg ? { cg } : {}) });
    },
  });
  return opportunityView(saved!);
}
