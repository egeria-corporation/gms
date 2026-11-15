// SPDX-License-Identifier: AGPL-3.0-only
// Open data exports of a funder's grantmaking (docs/open-data.md): its awards in the 360Giving
// Data Standard (JSON and CSV, schema 1.4.3) and its published opportunities and awards as
// CommonGrants v0.5.0. One rule decides which awards go out, and the downloads, the summary the
// Reporting screen and the MCP tool show, and the public feed all use it:
//
// - only accepted, active, suspended and completed awards; never offers or cancelled awards;
// - never an award to an individual, or to a recipient the GMS cannot name as an organization;
// - never an award the funder marked confidential (`settings.openData.excludedAwardIds`);
// - a recipient is named with its Passport record (legal name, EIN, address) only while it is
//   verified with Passport and shares its record with this funder; any other recipient goes out by
//   name only, under a local identifier, with no address and no tax number.
//
// Nothing here moves money or reads bank data. The EIN is an organization's public tax number; no
// person's identifiers are ever exported.
import { projectAward, projectOpportunity, ProjectionError, type AwardBase, type AwardRow, type Money, type OpportunityBase, type OpportunityRow } from "@gms/protocol";
import { toCsv } from "@gms/importers";
import { z } from "zod";
import { ApiError, badRequest, notFound } from "../lib/errors.ts";
import { apiId } from "../lib/ids.ts";
import { log } from "../lib/log.ts";
import { fundingOf, humanOnly, keyDatesOf } from "./awards.ts";
import { audit, authorize, required, type ServiceContext } from "./context.ts";
import { funderOf } from "./opportunities.ts";
import { namesOf, namesShared, orgFacts, profileSourceOf, selfDeclaredOf, sharingWith } from "./profile.ts";
import type { PublicContext } from "./public.ts";
import type { Row } from "./repos/types.ts";

type Ws = Row<"workspaces">;
type Award = Row<"awards">;

// ------------------------------------------------------------------------------------ constants

/** Award statuses that are open data: the funder has committed the grant (accepted and later). Cancelled awards stay out. */
export const OPEN_DATA_STATUSES: readonly string[] = ["accepted", "active", "suspended", "completed"];
/** The most awards one export reads (the newest by creation). */
export const EXPORT_LIMIT = 5000;
/** The most awards a funder can mark confidential. */
export const MAX_EXCLUDED = 5000;
/** The 360Giving package `version` (major.minor of the schema the export follows: 1.4.3). */
export const SCHEMA_VERSION = "1.4";
/** The licence the published data carries; the switch that turns on the public feed names it. */
export const OPEN_DATA_LICENSE = { name: "Creative Commons Attribution 4.0 International (CC BY 4.0)", url: "https://creativecommons.org/licenses/by/4.0/" } as const;
/** Where a funder registers as a 360Giving publisher and gets its prefix. */
export const REGISTER_URL = "https://www.360giving.org/publish/guidance/plan/register/";
/**
 * A self-declared EIN is not exported, even for the recipient that declared it: only a Passport
 * record shared with the funder names an organization by its tax number. One constant to relax.
 */
export const EXPORT_SELF_DECLARED_RECIPIENT_EIN = false;
/** The awards list in the summary (the panel's table) shows at most this many rows; the counts cover them all. */
export const SUMMARY_ROWS = 500;

/** A registered 360Giving prefix: `360G-` and the publisher's code (360Giving identifier guidance). */
export const PREFIX_PATTERN = /^360G-[A-Za-z0-9](?:[A-Za-z0-9_-]{0,58}[A-Za-z0-9])?$/;

export const EXCLUSION_REASONS = ["not_accepted", "cancelled", "individual", "no_organization", "confidential", "no_amount"] as const;
export type ExclusionReason = (typeof EXCLUSION_REASONS)[number];
export const REASON_LABELS: Record<ExclusionReason, string> = {
  not_accepted: "Not accepted yet",
  cancelled: "Cancelled",
  individual: "Awarded to an individual",
  no_organization: "Recipient is not a linked organization",
  confidential: "Marked confidential",
  no_amount: "No amount awarded",
};

// ------------------------------------------------------------------------------------ settings

/** `settings.openData`, as stored. Every key optional; `readSettings` gives the defaults. */
export interface OpenDataSettings {
  /** The funder's registered 360Giving publisher prefix, e.g. `360G-riverbend`; null until it registers. */
  threeSixtyGivingPrefix: string | null;
  /** "Publish my awards as open data": the public feed. Off by default. */
  publishFeed: boolean;
  /** Awards marked confidential: never exported. */
  excludedAwardIds: string[];
}

export function readSettings(w: Pick<Ws, "settings">): OpenDataSettings {
  const raw = ((w.settings as Record<string, unknown> | null)?.openData ?? {}) as Record<string, unknown>;
  const prefix = typeof raw.threeSixtyGivingPrefix === "string" && PREFIX_PATTERN.test(raw.threeSixtyGivingPrefix) ? raw.threeSixtyGivingPrefix : null;
  const excluded = Array.isArray(raw.excludedAwardIds) ? raw.excludedAwardIds.filter((x): x is string => typeof x === "string") : [];
  return { threeSixtyGivingPrefix: prefix, publishFeed: raw.publishFeed === true, excludedAwardIds: [...new Set(excluded)] };
}

async function writeSettings(ctx: ServiceContext, w: Ws, next: OpenDataSettings): Promise<Ws> {
  const settings = { ...((w.settings as Record<string, unknown> | null) ?? {}), openData: { threeSixtyGivingPrefix: next.threeSixtyGivingPrefix, publishFeed: next.publishFeed, excludedAwardIds: next.excludedAwardIds } };
  const [row] = await ctx.repos.table("workspaces").update({ id: w.id }, { settings: settings as Ws["settings"] });
  return required(row, "Workspace");
}

// ------------------------------------------------------------------------------------ dates

export interface DateRange {
  /** YYYY-MM-DD, inclusive; null for no lower bound. */
  from: string | null;
  /** YYYY-MM-DD, inclusive; null for no upper bound. */
  to: string | null;
}

const DAY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
/** A real calendar day written YYYY-MM-DD (2027-02-30 is not one). */
const isDay = (s: unknown): s is string => typeof s === "string" && DAY.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

/** `?year=` or `?from=&to=` (award dates, inclusive). Anything else is a 400. */
export function rangeOf(q: { year?: string | number | undefined; from?: string | undefined; to?: string | undefined }): DateRange {
  if (q.year !== undefined && q.year !== "") {
    const y = String(q.year);
    if (!/^\d{4}$/.test(y) || Number(y) < 1900 || Number(y) > 2100) throw badRequest("year must be a four-digit year", [{ code: "invalid_parameter", field: "year" }]);
    if (q.from || q.to) throw badRequest("Give a year or a date range, not both", [{ code: "invalid_parameter", field: "year" }]);
    return { from: `${y}-01-01`, to: `${y}-12-31` };
  }
  const day = (k: "from" | "to") => {
    const v = q[k];
    if (v === undefined || v === "") return null;
    if (!isDay(v)) throw badRequest(`${k} must be a date written YYYY-MM-DD`, [{ code: "invalid_parameter", field: k }]);
    return v;
  };
  const range = { from: day("from"), to: day("to") };
  if (range.from && range.to && range.from > range.to) throw badRequest("from must be on or before to", [{ code: "invalid_parameter", field: "from" }]);
  return range;
}

const within = (day: string, r: DateRange) => (!r.from || day >= r.from) && (!r.to || day <= r.to);
const rangeLabel = (r: DateRange) => (r.from && r.to && r.from.slice(0, 4) === r.to.slice(0, 4) && r.from.endsWith("-01-01") && r.to.endsWith("-12-31") ? r.from.slice(0, 4) : r.from || r.to ? `${r.from ?? "start"} to ${r.to ?? "today"}` : "all years");

/** When the decision to award was made: the award date the funder recorded, else the day the award was created. */
export function awardDateOf(a: Award): string {
  const d = keyDatesOf(a).awardDate?.date;
  return isDay(d) ? d : a.created_at.slice(0, 10);
}

const iso = (s: string) => new Date(s).toISOString();

// ------------------------------------------------------------------------------------ the rule

interface Item {
  award: Award;
  recipient: Ws | null;
  /** Verified with Passport and shared with this funder: the recipient's Passport record may be published. */
  verified: boolean;
  /** Null when the award is exported. */
  reason: ExclusionReason | null;
}

const isIndividualOrg = (w: Ws): boolean => {
  if (selfDeclaredOf(w)?.orgType === "individual") return true;
  const t = (w.org_projection as { orgType?: { value?: unknown; term?: unknown } } | null)?.orgType;
  return [t?.value, t?.term].some((v) => typeof v === "string" && v.trim().toLowerCase() === "individual");
};

const amountOf = (a: Award): Money | null => {
  const m = fundingOf(a).awardedAmount;
  return m && typeof m.amount === "string" && /^[A-Z]{3}$/.test(m.currency ?? "") && Number(m.amount) > 0 ? m : null;
};

function reasonFor(a: Award, w: Ws | null, confidential: ReadonlySet<string>): ExclusionReason | null {
  if (a.status === "cancelled") return "cancelled";
  if (!OPEN_DATA_STATUSES.includes(a.status)) return "not_accepted";
  if (!a.recipient_workspace_id) {
    // A historical import keeps the recipient's name only; it may be an organization or a person,
    // so it is never published under that name.
    const individual = a.recipient_individual as { imported?: unknown } | null;
    return individual && individual.imported !== true ? "individual" : "no_organization";
  }
  if (!w || w.kind !== "applicant") return "no_organization";
  if (isIndividualOrg(w)) return "individual";
  if (confidential.has(a.id)) return "confidential";
  if (!amountOf(a)) return "no_amount";
  return null;
}

/** The funder's awards in the range, each with the rule's answer; `years` lists every award year the funder has, newest first. */
async function collectWithYears(ctx: PublicContext, funder: Ws, range: DateRange): Promise<{ items: Item[]; years: number[] }> {
  // Newest first, so a funder over the limit loses its oldest awards, never its recent years.
  const all = await ctx.repos.table("awards").find({ workspace_id: funder.id }, { orderBy: "created_at", ascending: false, limit: EXPORT_LIMIT });
  const years = [...new Set(all.map((a) => Number(awardDateOf(a).slice(0, 4))))].sort((x, y) => y - x);
  return { items: await judge(ctx, funder, all.filter((a) => within(awardDateOf(a), range))), years };
}

const collect = async (ctx: PublicContext, funder: Ws, range: DateRange): Promise<Item[]> => (await collectWithYears(ctx, funder, range)).items;

async function judge(ctx: PublicContext, funder: Ws, awards: Award[]): Promise<Item[]> {
  const settings = readSettings(funder);
  const ids = [...new Set(awards.map((a) => a.recipient_workspace_id).filter((x): x is string => !!x))];
  const recipients = ids.length ? await ctx.repos.table("workspaces").find({ id: ids }) : [];
  const byId = new Map(recipients.map((w) => [w.id, w]));
  const shared = await sharingWith(ctx, funder.id, ids);
  const confidential = new Set(settings.excludedAwardIds);
  return awards
    .map((award) => {
      const recipient = award.recipient_workspace_id ? (byId.get(award.recipient_workspace_id) ?? null) : null;
      const verified = !!recipient && profileSourceOf(recipient) === "passport" && shared.has(recipient.id);
      return { award, recipient, verified, reason: reasonFor(award, recipient, confidential) };
    })
    .sort((x, y) => awardDateOf(x.award).localeCompare(awardDateOf(y.award)) || x.award.created_at.localeCompare(y.award.created_at));
}

// ------------------------------------------------------------------------------------ 360Giving

/** `US-EIN-12-3456789`, the form org-id.guide gives for the IRS list (https://org-id.guide/list/US-EIN). */
export function einIdentifier(ein: string | null | undefined): string | null {
  const digits = (ein ?? "").replace(/\D/g, "");
  return digits.length === 9 ? `US-EIN-${digits.slice(0, 2)}-${digits.slice(2)}` : null;
}

/** Characters 360Giving advises against in an identifier (slashes, spaces) become underscores. */
const idPart = (s: string) => s.replace(/[^A-Za-z0-9_-]+/g, "_");

/** The identifier prefix of this export: the registered one, or a draft marker that 360Giving's checker will refuse. */
const prefixOf = (funder: Ws, s: OpenDataSettings) => s.threeSixtyGivingPrefix ?? `DRAFT-${idPart(funder.handle)}`;

const https = (v: unknown): string | null => (typeof v === "string" && /^https:\/\/[^\s]+$/.test(v) && v.length <= 500 ? v : null);

/** The funder as a 360Giving organization: its EIN when it has one (its own record, Passport or self-declared), else a local identifier. */
function fundingOrg(funder: Ws, prefix: string) {
  const own = selfDeclaredOf(funder);
  const id = einIdentifier(funder.ein) ?? einIdentifier(own?.ein) ?? `${prefix}-${funder.id}`;
  const name = profileSourceOf(funder) === "passport" ? namesOf(funder).name : (own?.legalName ?? funder.display_name);
  return { id, name };
}

type Address = { street1?: unknown; street2?: unknown; city?: unknown; stateOrProvince?: unknown; postalCode?: unknown; country?: unknown };
const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);

/** A recipient as a 360Giving organization. Address, EIN and website only from a verified, shared Passport record. */
function recipientOrg(item: Item, prefix: string) {
  const w = item.recipient!;
  const local = `${prefix}-${w.id}`;
  if (!item.verified) {
    const declared = EXPORT_SELF_DECLARED_RECIPIENT_EIN ? einIdentifier(selfDeclaredOf(w)?.ein) : null;
    return { id: declared ?? local, name: namesShared(w, false).name };
  }
  const org = orgFacts(w).org as { addresses?: { primary?: Address }; socials?: { website?: unknown } };
  const a = org.addresses?.primary ?? {};
  const street = [str(a.street1), str(a.street2)].filter(Boolean).join(", ");
  const out: Record<string, string> = { id: einIdentifier(w.ein) ?? local, name: namesOf(w).name };
  if (street) out.streetAddress = street;
  const fields: [string, string | undefined][] = [
    ["addressLocality", str(a.city)],
    ["addressRegion", str(a.stateOrProvince)],
    ["postalCode", str(a.postalCode)],
    ["addressCountry", str(a.country)],
  ];
  for (const [k, v] of fields) if (v) out[k] = v;
  const site = https(org.socials?.website);
  if (site) out.url = site;
  return out;
}

export type ThreeSixtyGivingGrant = Record<string, unknown> & { id: string; title: string; description: string; currency: string; amountAwarded: number; awardDate: string };

function grantOf(item: Item, funderOrg: { id: string; name: string }, prefix: string, programs: Map<string, Row<"programs">>): ThreeSixtyGivingGrant {
  const a = item.award;
  const amount = amountOf(a)!;
  const grant: ThreeSixtyGivingGrant = {
    id: `${prefix}-${a.id}`,
    title: a.title,
    description: a.description?.trim() || a.title,
    currency: amount.currency,
    amountAwarded: Number(amount.amount),
    awardDate: awardDateOf(a),
    recipientOrganization: [recipientOrg(item, prefix)],
    fundingOrganization: [funderOrg],
  };
  const period = keyDatesOf(a).periodOfPerformance;
  if (isDay(period?.startDate)) grant.plannedDates = [{ startDate: period.startDate, ...(isDay(period?.endDate) ? { endDate: period.endDate } : {}) }];
  const program = a.program_id ? programs.get(a.program_id) : undefined;
  if (program) grant.grantProgramme = [{ code: `${prefix}-${program.id}`, title: program.name }];
  grant.dateModified = iso(a.updated_at);
  return grant;
}

async function programsOf(ctx: PublicContext, items: Item[]): Promise<Map<string, Row<"programs">>> {
  const ids = [...new Set(items.map((i) => i.award.program_id).filter((x): x is string => !!x))];
  const rows = ids.length ? await ctx.repos.table("programs").find({ id: ids }) : [];
  return new Map(rows.map((p) => [p.id, p]));
}

export interface ThreeSixtyGivingPackage {
  version: string;
  title: string;
  description: string;
  modified: string;
  identifier: string;
  publisher: { name: string; identifier: string; website?: string; logo?: string };
  license: string;
  accessURL?: string;
  downloadURL?: string;
  grants: ThreeSixtyGivingGrant[];
}

const feedUrlOf = (ctx: PublicContext, funder: Ws) => `${ctx.config.baseUrl}/gms/open-data/${encodeURIComponent(funder.handle)}/360giving.json`;
const feedOn = (s: OpenDataSettings) => s.publishFeed && !!s.threeSixtyGivingPrefix;

async function buildPackage(ctx: PublicContext, funder: Ws, items: Item[], range: DateRange): Promise<{ pkg: ThreeSixtyGivingPackage; draft: boolean }> {
  const settings = readSettings(funder);
  const draft = !settings.threeSixtyGivingPrefix;
  const prefix = prefixOf(funder, settings);
  const funderOrg = fundingOrg(funder, prefix);
  const programs = await programsOf(ctx, items);
  const grants = items.filter((i) => i.reason === null).map((i) => grantOf(i, funderOrg, prefix, programs));
  const facts = orgFacts(funder).org as { socials?: { website?: unknown } };
  const website = https(facts.socials?.website) ?? https(selfDeclaredOf(funder)?.website);
  const logo = https((funder.brand as { logoUrl?: unknown } | null)?.logoUrl);
  const label = rangeLabel(range);
  const pkg: ThreeSixtyGivingPackage = {
    version: SCHEMA_VERSION,
    title: `${draft ? "DRAFT: " : ""}${funderOrg.name} grants, ${label}`.slice(0, 200),
    description: draft
      ? `A draft of the grants ${funderOrg.name} awarded (${label}), from OpenGrants GMS. Not for publication: the identifiers start with DRAFT until the funder registers a 360Giving publisher prefix.`
      : `Grants awarded by ${funderOrg.name} (${label}), exported from OpenGrants GMS in the 360Giving Data Standard.`,
    modified: ctx.now().toISOString(),
    identifier: `${prefix}-grants-${range.from ?? "start"}-${range.to ?? "latest"}`,
    publisher: { name: funderOrg.name, identifier: funderOrg.id, ...(website ? { website } : {}), ...(logo ? { logo } : {}) },
    license: OPEN_DATA_LICENSE.url,
    accessURL: `${ctx.config.webBaseUrl}/f/${encodeURIComponent(funder.handle)}`,
    ...(feedOn(settings) ? { downloadURL: feedUrlOf(ctx, funder) } : {}),
    grants,
  };
  return { pkg, draft };
}

/**
 * The CSV columns, in the 360Giving spreadsheet titles (derived from the schema's `title`s; the
 * tests check each against the bundled schema), and the JSON path each one reads.
 */
export const CSV_COLUMNS: readonly (readonly [string, (g: ThreeSixtyGivingGrant) => unknown])[] = [
  ["Identifier", (g) => g.id],
  ["Title", (g) => g.title],
  ["Description", (g) => g.description],
  ["Currency", (g) => g.currency],
  ["Amount Awarded", (g) => g.amountAwarded],
  ["Award Date", (g) => g.awardDate],
  ["Planned Dates:Start Date", (g) => first(g.plannedDates)?.startDate],
  ["Planned Dates:End Date", (g) => first(g.plannedDates)?.endDate],
  ["Recipient Org:Identifier", (g) => first(g.recipientOrganization)?.id],
  ["Recipient Org:Name", (g) => first(g.recipientOrganization)?.name],
  ["Recipient Org:Street Address", (g) => first(g.recipientOrganization)?.streetAddress],
  ["Recipient Org:City", (g) => first(g.recipientOrganization)?.addressLocality],
  ["Recipient Org:County", (g) => first(g.recipientOrganization)?.addressRegion],
  ["Recipient Org:Postal Code", (g) => first(g.recipientOrganization)?.postalCode],
  ["Recipient Org:Country", (g) => first(g.recipientOrganization)?.addressCountry],
  ["Recipient Org:Web Address", (g) => first(g.recipientOrganization)?.url],
  ["Funding Org:Identifier", (g) => first(g.fundingOrganization)?.id],
  ["Funding Org:Name", (g) => first(g.fundingOrganization)?.name],
  ["Grant Programme:Code", (g) => first(g.grantProgramme)?.code],
  ["Grant Programme:Title", (g) => first(g.grantProgramme)?.title],
  ["Last Modified", (g) => g.dateModified],
];
const first = (v: unknown): Record<string, unknown> | undefined => (Array.isArray(v) ? (v[0] as Record<string, unknown> | undefined) : undefined);

export const toThreeSixtyGivingCsv = (grants: readonly ThreeSixtyGivingGrant[]): string =>
  toCsv(
    CSV_COLUMNS.map(([title]) => title),
    grants.map((g) => CSV_COLUMNS.map(([, read]) => read(g) ?? "")),
  );

// ------------------------------------------------------------------------------------ CommonGrants

export interface CommonGrantsExport {
  /** The CommonGrants version every record follows. The records themselves are CommonGrants models, validated with `@common-grants/sdk`. */
  commonGrants: "0.5.0";
  generatedAt: string;
  range: DateRange;
  opportunities: OpportunityBase[];
  awards: AwardBase[];
}

async function buildCommonGrants(ctx: PublicContext, funder: Ws, items: Item[], range: DateRange): Promise<CommonGrantsExport> {
  const opts = { baseUrl: ctx.config.baseUrl, webBaseUrl: ctx.config.webBaseUrl };
  // Published opportunities only, by the day they were published.
  const opps = (await ctx.repos.table("opportunities").find({ workspace_id: funder.id }, { notNull: ["published_at"], orderBy: "published_at", ascending: true, limit: EXPORT_LIMIT })).filter((o) => within(o.published_at!.slice(0, 10), range));
  const opportunities: OpportunityBase[] = [];
  for (const o of opps) {
    try {
      opportunities.push(projectOpportunity({ opportunity: o as unknown as OpportunityRow, funder: funderOf(funder) }, opts));
    } catch (e) {
      if (!(e instanceof ProjectionError)) throw e;
      log("warn", "open_data_projection_failed", { workspaceId: funder.id, opportunityId: o.id, issues: e.issues.map((i) => i.path) });
    }
  }
  const exported = items.filter((i) => i.reason === null);
  const refs = async <T extends "opportunities" | "applications" | "awards">(table: T, ids: (string | null)[]) => {
    const want = [...new Set(ids.filter((x): x is string => !!x))];
    const rows = want.length ? ((await ctx.repos.table(table).find({ id: want } as never)) as unknown as { id: string; title: string }[]) : [];
    return new Map(rows.map((r) => [r.id, { id: r.id, title: r.title }]));
  };
  const [oppRefs, appRefs, parentRefs] = await Promise.all([refs("opportunities", exported.map((i) => i.award.opportunity_id)), refs("applications", exported.map((i) => i.award.application_id)), refs("awards", exported.map((i) => i.award.parent_award_id))]);
  const awards: AwardBase[] = [];
  for (const { award: a, recipient, verified } of exported) {
    const row: AwardRow = { id: a.id, title: a.title, description: a.description, status: a.status as AwardRow["status"], funding: fundingOf(a), key_dates: a.key_dates as AwardRow["key_dates"], recipient_individual: null, parent_award_id: a.parent_award_id, created_at: a.created_at, updated_at: a.updated_at };
    try {
      awards.push(
        projectAward(
          {
            award: row,
            funder: funderOf(funder),
            // A CommonGrants organization reference is a Passport organization; a recipient that is not verified and shared is left unnamed.
            recipient: verified && recipient?.passport_org_id ? { id: recipient.passport_org_id, name: namesOf(recipient).name, ein: recipient.ein } : null,
            opportunity: a.opportunity_id ? (oppRefs.get(a.opportunity_id) ?? null) : null,
            application: a.application_id ? (appRefs.get(a.application_id) ?? null) : null,
            parent: a.parent_award_id ? (parentRefs.get(a.parent_award_id) ?? null) : null,
          },
          opts,
        ),
      );
    } catch (e) {
      if (!(e instanceof ProjectionError)) throw e;
      log("warn", "open_data_projection_failed", { workspaceId: funder.id, awardId: a.id, issues: e.issues.map((i) => i.path) });
    }
  }
  return { commonGrants: "0.5.0", generatedAt: ctx.now().toISOString(), range, opportunities, awards };
}

// ------------------------------------------------------------------------------------ service functions

/** Who may export: the people who may read the 990-PF grant list. */
const EXPORT_ROLES = ["admin", "program_officer", "finance", "auditor"] as const;

async function funderFor(ctx: ServiceContext): Promise<Ws> {
  const ws = await authorize(ctx, { scope: "analytics:read", kind: "funder", roles: EXPORT_ROLES });
  return required(await ctx.repos.table("workspaces").one({ id: ws.id }), "Workspace");
}

export interface SummaryRow {
  awardId: string;
  title: string;
  /** "An individual" for an award to a person: this feature never shows a person's name. */
  recipientName: string;
  awardedAmount: Money | null;
  awardDate: string;
  status: string;
  exported: boolean;
  reason: ExclusionReason | null;
  reasonLabel: string | null;
  /** Exported, but by name only: the recipient is not verified with Passport or does not share its record. */
  nameOnly: boolean;
  confidential: boolean;
}

function summaryRow(item: Item, confidential: ReadonlySet<string>): SummaryRow {
  const a = item.award;
  const w = item.recipient;
  // A name typed for a recipient with no workspace (an import, an unclaimed offer) is never shown here: it may be a person's.
  const name = w ? (isIndividualOrg(w) ? "An individual" : namesShared(w, item.verified).name) : item.reason === "individual" ? "An individual" : "Not linked to an organization";
  return {
    awardId: apiId("award", a.id),
    title: a.title,
    recipientName: name,
    awardedAmount: fundingOf(a).awardedAmount ?? null,
    awardDate: awardDateOf(a),
    status: a.status,
    exported: item.reason === null,
    reason: item.reason,
    reasonLabel: item.reason ? REASON_LABELS[item.reason] : null,
    nameOnly: item.reason === null && !item.verified,
    confidential: confidential.has(a.id),
  };
}

/** What an export of this range would hold, and what it leaves out and why. The Reporting panel and the MCP tool. */
export async function openDataSummary(ctx: ServiceContext, range: DateRange) {
  const funder = await funderFor(ctx);
  const settings = readSettings(funder);
  const { items, years } = await collectWithYears(ctx, funder, range);
  const cg = await buildCommonGrants(ctx, funder, items, range);
  const confidential = new Set(settings.excludedAwardIds);
  const exported = items.filter((i) => i.reason === null);
  return {
    range,
    /** Every year the funder has awards in (by award date), newest first: the panel's choices. */
    years,
    settings: { threeSixtyGivingPrefix: settings.threeSixtyGivingPrefix, publishFeed: settings.publishFeed },
    draft: !settings.threeSixtyGivingPrefix,
    registerUrl: REGISTER_URL,
    feedUrl: feedOn(settings) ? feedUrlOf(ctx, funder) : null,
    license: OPEN_DATA_LICENSE,
    counts: { inRange: items.length, exported: exported.length, leftOut: items.length - exported.length, nameOnly: exported.filter((i) => !i.verified).length },
    leftOut: EXCLUSION_REASONS.map((reason) => ({ reason, label: REASON_LABELS[reason], count: items.filter((i) => i.reason === reason).length })).filter((r) => r.count > 0),
    commonGrants: { opportunities: cg.opportunities.length, awards: cg.awards.length },
    awards: items.slice(0, SUMMARY_ROWS).map((i) => summaryRow(i, confidential)),
    awardsShown: Math.min(items.length, SUMMARY_ROWS),
  };
}
export type OpenDataSummary = Awaited<ReturnType<typeof openDataSummary>>;

const fileStem = (funder: Ws, range: DateRange) => `${idPart(funder.handle)}-${range.from || range.to ? `${range.from ?? "start"}-to-${range.to ?? "latest"}` : "all"}`;

export interface ExportFile {
  body: string;
  contentType: string;
  filename: string;
  draft: boolean;
}

const nothing = () => new ApiError(409, "nothing_to_export", "No awards in this period can be exported as open data. The summary says why each one is left out");

/** The 360Giving file, JSON or CSV. Without a registered prefix it is a draft: identifiers start with DRAFT and the file says so. */
export async function threeSixtyGivingExport(ctx: ServiceContext, range: DateRange, format: "json" | "csv"): Promise<ExportFile> {
  const funder = await funderFor(ctx);
  const { pkg, draft } = await buildPackage(ctx, funder, await collect(ctx, funder, range), range);
  // 360Giving requires at least one grant in a file.
  if (!pkg.grants.length) throw nothing();
  const name = `360giving-${fileStem(funder, range)}${draft ? "-DRAFT" : ""}`;
  return format === "csv" ? { body: toThreeSixtyGivingCsv(pkg.grants), contentType: "text/csv; charset=utf-8", filename: `${name}.csv`, draft } : { body: JSON.stringify(pkg, null, 2), contentType: "application/json; charset=utf-8", filename: `${name}.json`, draft };
}

/** The funder's published opportunities and exported awards as CommonGrants v0.5.0 records. */
export async function commonGrantsExport(ctx: ServiceContext, range: DateRange): Promise<ExportFile> {
  const funder = await funderFor(ctx);
  const out = await buildCommonGrants(ctx, funder, await collect(ctx, funder, range), range);
  if (!out.opportunities.length && !out.awards.length) throw nothing();
  return { body: JSON.stringify(out, null, 2), contentType: "application/json; charset=utf-8", filename: `commongrants-${fileStem(funder, range)}.json`, draft: false };
}

/**
 * The public feed at `/gms/open-data/{handle}/360giving.json`: every award the export would hold,
 * all years, in 360Giving JSON. Only while the funder has a registered prefix and has switched
 * "Publish my awards as open data" on; otherwise, and when there is nothing to publish, 404.
 */
export async function publicFeed(ctx: PublicContext, handle: string): Promise<ThreeSixtyGivingPackage> {
  const funder = await ctx.repos.table("workspaces").one({ handle, kind: "funder" });
  if (!funder || funder.status !== "active" || !feedOn(readSettings(funder))) throw notFound("Open data feed");
  const range = { from: null, to: null };
  const { pkg } = await buildPackage(ctx, funder, await collect(ctx, funder, range), range);
  if (!pkg.grants.length) throw notFound("Open data feed");
  return pkg;
}

// ------------------------------------------------------------------------------------ writes (people only)

export const settingsInput = z
  .object({
    threeSixtyGivingPrefix: z.string().trim().regex(PREFIX_PATTERN, "A 360Giving prefix starts with 360G- followed by letters, numbers, hyphens or underscores, e.g. 360G-riverbend").nullable().optional(),
    publishFeed: z.boolean().optional(),
  })
  .strict();

/**
 * The prefix and the public feed switch. A person, a workspace admin, in the GMS: publishing the
 * funder's awards to anyone is never an agent's or API client's call (no MCP tool).
 */
export async function updateOpenDataSettings(ctx: ServiceContext, input: z.output<typeof settingsInput>) {
  const ws = await authorize(ctx, { scope: "workspace:admin", kind: "funder", roles: ["admin"] });
  if (ctx.actor.kind !== "user") throw humanOnly("Changing what a funder publishes as open data");
  const funder = required(await ctx.repos.table("workspaces").one({ id: ws.id }), "Workspace");
  const current = readSettings(funder);
  const next: OpenDataSettings = {
    ...current,
    ...(input.threeSixtyGivingPrefix !== undefined ? { threeSixtyGivingPrefix: input.threeSixtyGivingPrefix } : {}),
    ...(input.publishFeed !== undefined ? { publishFeed: input.publishFeed } : {}),
  };
  if (next.publishFeed && !next.threeSixtyGivingPrefix) {
    throw new ApiError(409, "prefix_required", current.publishFeed ? "Turn off “Publish my awards as open data” before removing the 360Giving prefix" : "Add your registered 360Giving prefix before publishing your awards as open data");
  }
  const row = await writeSettings(ctx, funder, next);
  const changed = (["threeSixtyGivingPrefix", "publishFeed"] as const).filter((k) => current[k] !== next[k]);
  if (changed.length) await audit(ctx, "open_data.settings_updated", "workspace", ws.id, { fields: changed, publishFeed: next.publishFeed, prefixSet: !!next.threeSixtyGivingPrefix });
  const settings = readSettings(row);
  return { threeSixtyGivingPrefix: settings.threeSixtyGivingPrefix, publishFeed: settings.publishFeed, feedUrl: feedOn(settings) ? feedUrlOf(ctx, row) : null };
}

export const confidentialInput = z.object({ confidential: z.boolean() }).strict();

/** Mark one award confidential (never exported) or clear the mark. A person who may change awards. */
export async function setAwardConfidential(ctx: ServiceContext, awardId: string, input: z.output<typeof confidentialInput>) {
  const ws = await authorize(ctx, { scope: "awards:write", kind: "funder", roles: ["admin", "program_officer"] });
  if (ctx.actor.kind !== "user") throw humanOnly("Changing what a funder publishes as open data");
  const award = await ctx.repos.table("awards").one({ id: awardId });
  await authorize(ctx, { scope: "awards:write", owner: award?.workspace_id ?? null, what: "Award" });
  const funder = required(await ctx.repos.table("workspaces").one({ id: ws.id }), "Workspace");
  const current = readSettings(funder);
  const has = current.excludedAwardIds.includes(awardId);
  if (input.confidential && !has && current.excludedAwardIds.length >= MAX_EXCLUDED) throw new ApiError(409, "too_many_confidential", `At most ${MAX_EXCLUDED} awards can be marked confidential`);
  if (input.confidential !== has) {
    const excludedAwardIds = input.confidential ? [...current.excludedAwardIds, awardId] : current.excludedAwardIds.filter((x) => x !== awardId);
    await writeSettings(ctx, funder, { ...current, excludedAwardIds });
    await audit(ctx, input.confidential ? "open_data.award_marked_confidential" : "open_data.award_unmarked_confidential", "award", awardId, {});
  }
  return { awardId: apiId("award", awardId), confidential: input.confidential };
}
