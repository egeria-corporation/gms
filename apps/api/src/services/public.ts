// SPDX-License-Identifier: AGPL-3.0-only
// Public reads: what anyone may see without signing in. These functions take no actor and return
// published fields only — never drafts, settings, eligibility internals beyond the rule labels, or
// anything about applicants. The CommonGrants read routes and the funder pages are built on them.
import { ProjectionError, projectCompetition, projectForm, projectOpportunity, projectOpportunityDetails, unionStageForms, type CompetitionRow, type FormRow, type OpportunityRow, type StageJson } from "@gms/protocol";
import { parseRules, type Rule } from "@gms/rules";
import { notFound } from "../lib/errors.ts";
import type { ServiceContext } from "./context.ts";
import { funderOf } from "./opportunities.ts";
import { contactsOf } from "./workspaces.ts";
import type { Row } from "./repos/types.ts";

export type PublicContext = Pick<ServiceContext, "repos" | "config" | "now">;
/** A workspace whose drafts the caller may also read (a token for the owning funder), if any. */
export interface Viewer {
  workspaceId: string;
  canReadDrafts: { opportunities: boolean; competitions: boolean; forms: boolean };
}

type Opp = Row<"opportunities">;
type Comp = Row<"competitions">;
const opts = (ctx: PublicContext) => ({ baseUrl: ctx.config.baseUrl, webBaseUrl: ctx.config.webBaseUrl });
const stagesOf = (c: Comp): StageJson[] => (Array.isArray(c.stages) ? (c.stages as unknown as StageJson[]) : []);
const listed = (o: Opp) => o.published_at !== null;
const oppVisible = (o: Opp, v?: Viewer | null) => listed(o) || (!!v?.canReadDrafts.opportunities && v.workspaceId === o.workspace_id);
const compVisible = (c: Comp, v?: Viewer | null) => c.status !== "draft" || (!!v?.canReadDrafts.competitions && v.workspaceId === c.workspace_id);

async function funders(ctx: PublicContext, ids: string[]) {
  const rows = ids.length ? await ctx.repos.table("workspaces").find({ id: [...new Set(ids)] }) : [];
  return new Map(rows.map((w) => [w.id, w]));
}

async function competitionInputs(ctx: PublicContext, comps: Comp[]) {
  const out = [];
  for (const c of comps) {
    const forms: Row<"forms">[] = [];
    for (const [id, version] of Object.entries(unionStageForms(stagesOf(c), c.forms as Record<string, number>))) {
      const f = await ctx.repos.table("forms").one({ id, version });
      if (f) forms.push(f);
    }
    out.push({ competition: c as unknown as CompetitionRow, forms: forms as unknown as FormRow[] });
  }
  return out;
}

/** Published opportunities, newest first, as CommonGrants `OpportunityBase`. */
export async function cgListOpportunities(ctx: PublicContext, q: { status?: string; limit?: number; offset?: number } = {}) {
  const where = q.status ? { status: q.status } : {};
  const [rows, total] = await Promise.all([
    ctx.repos.table("opportunities").find(where, { notNull: ["published_at"], orderBy: "published_at", ascending: false, limit: q.limit, offset: q.offset }),
    ctx.repos.table("opportunities").count(where, { notNull: ["published_at"] }),
  ]);
  const byId = await funders(ctx, rows.map((r) => r.workspace_id));
  const items = rows.map((r) => projectOpportunity({ opportunity: r as unknown as OpportunityRow, funder: byId.has(r.workspace_id) ? funderOf(byId.get(r.workspace_id)!) : null }, opts(ctx)));
  return { items, total };
}

/** `OpportunityDetails`: the opportunity with the competitions the caller may see. */
export async function cgGetOpportunity(ctx: PublicContext, id: string, viewer?: Viewer | null) {
  const opp = await ctx.repos.table("opportunities").one({ id });
  if (!opp || !oppVisible(opp, viewer)) throw notFound("Opportunity");
  const funder = await ctx.repos.table("workspaces").one({ id: opp.workspace_id });
  const comps = (await ctx.repos.table("competitions").find({ opportunity_id: opp.id }, { orderBy: "created_at" })).filter((c) => compVisible(c, viewer));
  return projectOpportunityDetails({ opportunity: opp as unknown as OpportunityRow, funder: funder ? funderOf(funder) : null, competitions: await competitionInputs(ctx, comps) }, opts(ctx));
}

export async function cgGetCompetition(ctx: PublicContext, id: string, viewer?: Viewer | null) {
  const comp = await ctx.repos.table("competitions").one({ id });
  if (!comp || !compVisible(comp, viewer)) throw notFound("Competition");
  const opp = await ctx.repos.table("opportunities").one({ id: comp.opportunity_id });
  // A competition is public only under a published opportunity.
  if (!opp || !oppVisible(opp, viewer)) throw notFound("Competition");
  const [input] = await competitionInputs(ctx, [comp]);
  return projectCompetition({ ...input!, opportunity: { id: opp.id, title: opp.title } });
}

/** form id → pinned versions, across every competition that is open or closed under a published opportunity. */
async function publicFormPins(ctx: PublicContext): Promise<Map<string, Set<number>>> {
  const published = await ctx.repos.table("opportunities").find({}, { notNull: ["published_at"] });
  const pins = new Map<string, Set<number>>();
  if (!published.length) return pins;
  const comps = await ctx.repos.table("competitions").find({ opportunity_id: published.map((o) => o.id), status: ["open", "closed"] });
  for (const c of comps) {
    for (const [id, version] of Object.entries(unionStageForms(stagesOf(c), c.forms as Record<string, number>))) {
      if (!pins.has(id)) pins.set(id, new Set());
      pins.get(id)!.add(version);
    }
  }
  return pins;
}

/** Forms of published competitions, as CommonGrants `FormBase` (the highest pinned version of each). */
export async function cgListForms(ctx: PublicContext, q: { limit: number; offset: number }) {
  const pins = await publicFormPins(ctx);
  const ids = [...pins.keys()].sort();
  const items = [];
  for (const id of ids.slice(q.offset, q.offset + q.limit)) {
    const row = await ctx.repos.table("forms").one({ id, version: Math.max(...pins.get(id)!) });
    if (row) items.push(projectForm(row as unknown as FormRow));
  }
  return { items, total: ids.length };
}

export async function cgGetForm(ctx: PublicContext, id: string, version?: number, viewer?: Viewer | null) {
  const pins = (await publicFormPins(ctx)).get(id);
  if (viewer?.canReadDrafts.forms) {
    const rows = (await ctx.repos.table("forms").find({ id }, { orderBy: "version" })).filter((r) => r.workspace_id === viewer.workspaceId || r.workspace_id === null);
    const row = version === undefined ? rows.sort((a, b) => a.version - b.version)[rows.length - 1] : rows.find((r) => r.version === version);
    if (row) return projectForm(row as unknown as FormRow);
  }
  if (!pins || (version !== undefined && !pins.has(version))) {
    // A report form is pinned by a requirement, not a competition. The grantee who owes the report
    // and the funder who asked for it may read the pinned version; nobody else learns it exists.
    const pinned = viewer ? await requirementFormVersions(ctx, id, viewer.workspaceId) : new Set<number>();
    if (!pinned.size && !pins) throw notFound("Form");
    const all = new Set<number>([...(pins ?? []), ...pinned]);
    const want = version ?? Math.max(...all);
    if (!all.has(want)) throw notFound("Form");
    const report = await ctx.repos.table("forms").one({ id, version: want });
    if (!report) throw notFound("Form");
    return projectForm(report as unknown as FormRow);
  }
  const v = version ?? Math.max(...pins);
  const row = await ctx.repos.table("forms").one({ id, version: v });
  if (!row) throw notFound("Form");
  return projectForm(row as unknown as FormRow);
}

/** Versions of a form pinned by requirements on awards the workspace gave or received. */
async function requirementFormVersions(ctx: PublicContext, formId: string, workspaceId: string): Promise<Set<number>> {
  const out = new Set<number>();
  const reqs = await ctx.repos.table("requirements").find({ form_id: formId });
  if (reqs.length) {
    const awards = await ctx.repos.table("awards").find({ id: [...new Set(reqs.map((r) => r.award_id))] });
    const mine = new Set(awards.filter((a) => a.recipient_workspace_id === workspaceId || a.workspace_id === workspaceId).map((a) => a.id));
    for (const r of reqs) if (mine.has(r.award_id) && r.form_version !== null) out.add(r.form_version as number);
  }
  // A report a grantee shared with this funder: the funder reads the form its answers were given on.
  const shared = (await ctx.repos.table("submissions").find({ workspace_id: workspaceId })).filter((s) => s.shared_from_submission_id !== null);
  if (shared.length) {
    const responses = await ctx.repos.table("form_responses").find({ submission_id: shared.map((s) => s.id), form_id: formId });
    for (const r of responses) out.add(r.form_version);
  }
  return out;
}

const brandOf = (w: Row<"workspaces">) => {
  const b = (w.brand ?? {}) as Record<string, unknown>;
  return { logoUrl: (b.logoUrl as string | undefined) ?? null, accent: (b.accent as string | undefined) ?? null, onAccent: (b.onAccent as string | undefined) ?? null };
};

function publicFunder(w: Row<"workspaces">) {
  const org = (w.org_projection ?? {}) as { mission?: unknown; socials?: { website?: unknown }; emails?: { primary?: unknown } };
  const settings = (w.settings ?? {}) as { contactEmail?: unknown };
  // The funder's general address: the one it set, else the one on its published organization record.
  const contactEmail = typeof settings.contactEmail === "string" ? settings.contactEmail : typeof org.emails?.primary === "string" ? org.emails.primary : null;
  // Only contacts the funder marked public; the rest are for organizations it already works with.
  const contacts = contactsOf(w).filter((c) => c.public);
  return { contactEmail, contacts, handle: w.handle, name: w.display_name, brand: brandOf(w), mission: typeof org.mission === "string" ? org.mission : null, website: typeof org.socials?.website === "string" ? org.socials.website : null, verificationLevel: w.verification_level };
}

const publishFlag = (o: Opp, flag: "publicPage" | "sitemap" | "openGrantsIndex") => (o.publish as Record<string, unknown> | null)?.[flag] !== false;

const card = (o: Opp) => ({ id: o.id, slug: o.slug, title: o.title, description: o.description, status: o.status, funding: o.funding, keyDates: o.key_dates, acceptedApplicantTypes: o.accepted_applicant_types });

async function activeFunder(ctx: PublicContext, handle: string) {
  const w = await ctx.repos.table("workspaces").one({ handle, kind: "funder" });
  if (!w || w.status !== "active") throw notFound("Funder");
  return w;
}

/** Data for `/f/{handle}`: the funder's brand and its published opportunities. */
export async function funderPage(ctx: PublicContext, handle: string) {
  const w = await activeFunder(ctx, handle);
  const opps = (await ctx.repos.table("opportunities").find({ workspace_id: w.id }, { notNull: ["published_at"], orderBy: "published_at", ascending: false })).filter((o) => publishFlag(o, "publicPage"));
  const cards = opps.map(card);
  return {
    funder: publicFunder(w),
    opportunities: cards,
    open: cards.filter((o) => o.status === "open"),
    forecasted: cards.filter((o) => o.status === "forecasted"),
    closed: cards.filter((o) => o.status === "closed"),
    pastAwards: await pastAwards(ctx, w),
  };
}

/**
 * Awards a funder chose to publish (`settings.transparency`): recipient name, title, amount, year.
 * Null when the funder has not turned transparency on, so the page can omit the section.
 */
async function pastAwards(ctx: PublicContext, w: Row<"workspaces">) {
  if ((w.settings as { transparency?: unknown } | null)?.transparency !== true) return null;
  const awards = (await ctx.repos.table("awards").find({ workspace_id: w.id }, { orderBy: "created_at", ascending: false, limit: 200 })).filter((a) => ["active", "completed"].includes(a.status) && a.recipient_workspace_id);
  const names = await funders(ctx, awards.map((a) => a.recipient_workspace_id as string));
  return awards.map((a) => {
    const f = (a.funding ?? {}) as { awardedAmount?: { amount: string; currency: string } };
    const start = ((a.key_dates ?? {}) as { awardDate?: { date?: string } }).awardDate?.date ?? a.created_at;
    return { recipient: names.get(a.recipient_workspace_id as string)?.display_name ?? null, title: a.title, awardedAmount: f.awardedAmount ?? null, year: Number(start.slice(0, 4)) };
  });
}

const pageExtras = (o: Opp) => {
  const p = (o.publish ?? {}) as { faq?: unknown; documents?: unknown };
  return { faq: Array.isArray(p.faq) ? p.faq : [], documents: Array.isArray(p.documents) ? p.documents : [] };
};

function ruleLabels(rule: Rule | null): string[] {
  if (!rule) return [];
  if ("all" in rule) return rule.all.flatMap(ruleLabels);
  if ("any" in rule) return [rule.any.flatMap(ruleLabels).join(" or ")].filter(Boolean);
  return rule.label ? [rule.label] : [];
}

/** Data for `/f/{handle}/o/{slug}`, with the CommonGrants record the page links to as its JSON alternate. */
export async function opportunityPage(ctx: PublicContext, handle: string, slug: string) {
  const w = await activeFunder(ctx, handle);
  const opp = await ctx.repos.table("opportunities").one({ workspace_id: w.id, slug });
  if (!opp || !listed(opp) || !publishFlag(opp, "publicPage")) throw notFound("Opportunity");
  const comps = (await ctx.repos.table("competitions").find({ opportunity_id: opp.id }, { orderBy: "created_at" })).filter((c) => c.status !== "draft");
  const parsed = parseRules(opp.eligibility_rules);
  let commonGrants: unknown = opp.cg;
  try {
    commonGrants = projectOpportunity({ opportunity: opp as unknown as OpportunityRow, funder: funderOf(w) }, opts(ctx));
  } catch (e) {
    if (!(e instanceof ProjectionError)) throw e;
  }
  return {
    funder: publicFunder(w),
    opportunity: { ...card(opp), publishedAt: opp.published_at, eligibility: ruleLabels(parsed.ok ? parsed.rules : null), ...pageExtras(opp) },
    competitions: comps.map((c) => ({
      id: c.id,
      title: c.title,
      description: c.description,
      instructions: c.instructions,
      status: c.status,
      keyDates: c.key_dates,
      stages: stagesOf(c).map((s) => ({ key: s.key, label: s.label, opens: s.opens ?? null, closes: s.closes ?? null, requiresSubmission: s.requiresSubmission })),
    })),
    commonGrants,
    links: { json: `${ctx.config.baseUrl}/common-grants/opportunities/${opp.id}`, page: `${ctx.config.webBaseUrl}/f/${w.handle}/o/${opp.slug}` },
  };
}

/** Sitemap entries: active funder pages and their published opportunities that opted in. */
export async function sitemapEntries(ctx: PublicContext): Promise<{ loc: string; lastmod: string }[]> {
  const opps = (await ctx.repos.table("opportunities").find({}, { notNull: ["published_at"], orderBy: "published_at", ascending: false, limit: 5000 })).filter((o) => publishFlag(o, "sitemap") && publishFlag(o, "publicPage"));
  const byId = await funders(ctx, opps.map((o) => o.workspace_id));
  const out: { loc: string; lastmod: string }[] = [];
  for (const w of byId.values()) if (w.status === "active") out.push({ loc: `${ctx.config.webBaseUrl}/f/${w.handle}`, lastmod: w.updated_at });
  for (const o of opps) {
    const w = byId.get(o.workspace_id);
    if (w?.status === "active") out.push({ loc: `${ctx.config.webBaseUrl}/f/${w.handle}/o/${o.slug}`, lastmod: o.updated_at });
  }
  return out;
}
