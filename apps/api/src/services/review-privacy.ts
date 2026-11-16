// SPDX-License-Identifier: AGPL-3.0-only
// What a reviewer may see, beyond masking (review parity, v1.8.0). Two rules, applied in the
// service layer so REST, the CommonGrants routes and MCP give the same answer:
//
//  * Anonymized review. In a stage the funder marks `anonymized`, a reviewer never learns who
//    applied: no organization name, EIN, website, address or contacts; no field the form marks
//    `identifying`; attachments under neutral names; free text with the organization's names and
//    website replaced by "[applicant]". The application goes by a stable short code ("Applicant
//    A-1042"). Staff always see everything.
//  * The conflict-of-interest policy. A reviewer signs a competition's policy before any
//    application in it opens for them (`signedOnly`), and the conflicts declared at signing feed
//    the assignment exclusion.
//
// Every read of an application a reviewer can reach calls in here: apply.ts (`reviewerResponse`,
// `project`, `reviewerApplicationIds`), inbox.ts (list and detail) and reviews.ts. Anything built
// on those (the assistant's context, MCP tools and resources) inherits the same view.
import { anonymizeResponse, anonymousName, applicantCode, DEFAULT_COI_POLICY, hasSignedCurrent, identityTerms, redactText, redactValue, type DeclaredOrg, type IdentityTerms, type OrgCandidate, type ReviewVisibilityMode } from "@gms/review";
import { identifyingFields, type FormDefinition, type JsonObject } from "@gms/forms";
import type { StageJson } from "@gms/protocol";
import { FUNDER_ROLES } from "../auth/scopes.ts";
import type { ServiceContext, ServiceWorkspace } from "./context.ts";
import { DEFAULT_LOCALE } from "@gms/i18n";
import { serverTranslator } from "@gms/i18n/server";
import { orgFacts } from "./profile.ts";
import type { Row } from "./repos/types.ts";

type App = Row<"applications">;
type Comp = Row<"competitions">;
type Ws = Row<"workspaces">;

/** A competition stage with its review settings, as stored in `competitions.stages`. */
export type ReviewStage = StageJson & { rubricId?: string | null; reviewMode?: ReviewVisibilityMode; panelOpen?: boolean; anonymized?: boolean };

export const reviewStagesOf = (c: Pick<Comp, "stages">): ReviewStage[] => (Array.isArray(c.stages) ? (c.stages as unknown as ReviewStage[]) : []);
export const isAnonymizedStage = (c: Pick<Comp, "stages">, key: string): boolean => reviewStagesOf(c).some((s) => s.key === key && s.anonymized === true);

const REVIEWER_ROLES: readonly string[] = ["reviewer", "external_reviewer"];
/** Funder roles that are not reviewers: who an internal funder notice (a thread message) may reach. */
export const NON_REVIEWER_ROLES: readonly string[] = FUNDER_ROLES.filter((r) => !REVIEWER_ROLES.includes(r));

/** Reviewers (internal and external) get the anonymized and policy-gated view; staff and API clients never do. */
export const isReviewerRole = (ws: ServiceWorkspace | null | undefined): boolean => !!ws && ws.kind === "funder" && !!ws.role && REVIEWER_ROLES.includes(ws.role);

// ------------------------------------------------------------------------------------ identity

/** Everything the GMS holds that would say who an applicant is, as terms to hide. */
export function identityOf(applicant: Ws | null | undefined): IdentityTerms {
  if (!applicant) return identityTerms({});
  const facts = orgFacts(applicant);
  const org = facts.org as { name?: unknown; emails?: Record<string, unknown>; socials?: Record<string, unknown>; identifiers?: Record<string, { id?: unknown } | undefined> };
  // The raw self-declared profile too, whatever the source: what the organization once typed about itself.
  const sd = (applicant.self_declared_profile ?? {}) as { legalName?: unknown; displayName?: unknown; website?: unknown; contactEmail?: unknown; ein?: unknown };
  const str = (v: unknown) => (typeof v === "string" ? v : null);
  return identityTerms({
    // The handle too, and read with spaces ("alder-creek" as "alder creek"): often the short name people use.
    names: [applicant.display_name, applicant.legal_name, applicant.handle, applicant.handle.replace(/-+/g, " "), str(org.name), str(sd.legalName), str(sd.displayName)],
    websites: [str(org.socials?.website), str(sd.website)],
    emails: [...Object.values(org.emails ?? {}).map(str), str(sd.contactEmail)],
    numbers: [applicant.ein, str(org.identifiers?.["org:us:ein"]?.id), str(sd.ein)],
  });
}

/** An applicant as a candidate for a reviewer's declared conflicts: its names and web domains. */
export function candidateOf(applicant: Ws): OrgCandidate {
  const terms = identityOf(applicant);
  return { id: applicant.id, names: terms.names, domains: terms.domains };
}

// ------------------------------------------------------------------------------------ anonymity

export interface Anonymity {
  /** The stable short code, e.g. "A-1042". */
  code: string;
  /** "Applicant A-1042". */
  name: string;
  terms: IdentityTerms;
}

/** Codes per competition: 1-based position by when each application was started. Applications are never deleted, so a code never changes. */
async function codesOf(ctx: ServiceContext, competitionId: string): Promise<Map<string, string>> {
  const all = await ctx.repos.table("applications").find({ competition_id: competitionId }, { limit: 20_000 });
  all.sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return new Map(all.map((a, i) => [a.id, applicantCode(i + 1)]));
}

/** The application's short code in its competition (staff see it too, to talk about an application the way the panel does). */
export async function applicationCode(ctx: ServiceContext, app: Pick<App, "id" | "competition_id">): Promise<string> {
  return (await memoized(ctx, `codes:${app.competition_id}`, () => codesOf(ctx, app.competition_id))).get(app.id) ?? applicantCode(1);
}

const memo = new WeakMap<object, Map<string, Promise<unknown>>>();
/** One answer per request: a list view asks about the same application or competition many times. */
function memoized<T>(ctx: ServiceContext, key: string, load: () => Promise<T>): Promise<T> {
  let m = memo.get(ctx);
  if (!m) memo.set(ctx, (m = new Map()));
  let p = m.get(key) as Promise<T> | undefined;
  if (!p) m.set(key, (p = load()));
  return p;
}

/**
 * The anonymized view for this caller and application, or null when the caller sees who applied.
 * A reviewer is anonymized when the application's current stage, or the stage of any of their own
 * assignments on it, has anonymized review.
 */
export function anonymityFor(ctx: ServiceContext, appId: string): Promise<Anonymity | null> {
  const ws = ctx.workspace;
  if (!isReviewerRole(ws)) return Promise.resolve(null);
  return memoized(ctx, `anon:${appId}`, async () => {
    const app = await ctx.repos.table("applications").one({ id: appId, workspace_id: ws!.id });
    if (!app) return null;
    const competition = await memoized(ctx, `comp:${app.competition_id}`, () => ctx.repos.table("competitions").one({ id: app.competition_id }));
    if (!competition) return null;
    const mine = ctx.actor.userId ? await ctx.repos.table("review_assignments").find({ workspace_id: ws!.id, application_id: app.id, reviewer_user_id: ctx.actor.userId }) : [];
    if (!isAnonymizedStage(competition, app.stage) && !mine.some((a) => isAnonymizedStage(competition, a.stage))) return null;
    const code = await applicationCode(ctx, app);
    const applicant = await ctx.repos.table("workspaces").one({ id: app.applicant_workspace_id });
    // The replacements in the reviewer's language ("[solicitante]", "Solicitante A-1042"); English otherwise.
    const locale = ctx.locale ?? DEFAULT_LOCALE;
    if (locale === DEFAULT_LOCALE) return { code, name: anonymousName(code), terms: identityOf(applicant) };
    const t = serverTranslator(locale, "email");
    return { code, name: t("review.anonymous.name", { code }), terms: { ...identityOf(applicant), words: { placeholder: t("review.anonymous.placeholder"), attachment: t("review.anonymous.attachment") } } };
  });
}

/** A form response as an anonymized reviewer reads it, or null when the caller is not anonymized for this application. */
export async function anonymizedResponseFor(ctx: ServiceContext, appId: string | null, form: FormDefinition | null, response: JsonObject): Promise<{ response: JsonObject; hidden: string[] } | null> {
  const anon = appId ? await anonymityFor(ctx, appId) : null;
  if (!anon) return null;
  const out = anonymizeResponse(response, { identifying: form ? identifyingFields(form) : [], terms: anon.terms });
  return { response: out.response as JsonObject, hidden: out.hidden };
}

/** The application's title as this caller may read it. */
export async function titleFor(ctx: ServiceContext, app: Pick<App, "id" | "title">): Promise<string> {
  const anon = await anonymityFor(ctx, app.id);
  return anon ? redactText(app.title, anon.terms) : app.title;
}

/** Applications with their titles as this caller may read them, so a search or sort on the title never reveals a hidden name. */
export async function rowsAsSeen<T extends Pick<App, "id" | "title">>(ctx: ServiceContext, rows: T[]): Promise<T[]> {
  if (!isReviewerRole(ctx.workspace)) return rows;
  const out: T[] = [];
  for (const r of rows) out.push({ ...r, title: await titleFor(ctx, r) });
  return out;
}

/** What eligibility decided, without the raw values the rules read; the explanation kept, redacted. */
const outcomesOnly = (e: unknown, terms: IdentityTerms): unknown => {
  const v = e as { results?: unknown[] } | null;
  if (!v || !Array.isArray(v.results)) return e === null || e === undefined ? e : redactValue(e, terms);
  return redactValue({ ...v, results: v.results.map((r) => (r && typeof r === "object" ? Object.fromEntries(Object.entries(r as Record<string, unknown>).filter(([k]) => k !== "actual")) : r)) }, terms);
};

interface InboxShape {
  id: string;
  title: string;
  applicant: { workspaceId: string | null; name: string | null; workspaceName?: string | null; handle: string | null };
}

/** An inbox row (list or detail) for an anonymized reviewer: no workspace, name or handle, and the code in their place. */
async function anonymizeShape<T extends InboxShape>(ctx: ServiceContext, appUuid: string, item: T): Promise<T & { anonymized?: { code: string } | null }> {
  const anon = await anonymityFor(ctx, appUuid);
  if (!anon) return item;
  const out: T & { anonymized?: { code: string } | null } = { ...item, title: redactText(item.title, anon.terms), applicant: { ...item.applicant, workspaceId: null, name: anon.name, workspaceName: null, handle: null }, anonymized: { code: anon.code } };
  const detail = out as unknown as Record<string, unknown>;
  // Detail-only fields that would say who applied.
  if ("organization" in detail) detail.organization = null;
  if ("attestationUrl" in detail) detail.attestationUrl = null;
  if ("eligibilityResults" in detail) detail.eligibilityResults = outcomesOnly(detail.eligibilityResults, anon.terms);
  if (Array.isArray(detail.timeline)) detail.timeline = (detail.timeline as Record<string, unknown>[]).map(({ actor: _actor, ...e }) => e);
  return out;
}

const bare = (id: string) => id.replace(/^app_/, "");

/** The application detail as this caller may read it (inbox.getApplicationDetail). */
export const anonymizeDetail = <T extends InboxShape>(ctx: ServiceContext, detail: T) => anonymizeShape(ctx, bare(detail.id), detail);

/** Inbox rows as this caller may read them (inbox.listApplications). */
export async function anonymizeItems<T extends InboxShape>(ctx: ServiceContext, items: T[]): Promise<(T & { anonymized?: { code: string } | null })[]> {
  if (!isReviewerRole(ctx.workspace)) return items;
  const out = [];
  for (const it of items) out.push(await anonymizeShape(ctx, bare(it.id), it));
  return out;
}

/** Free text a reviewer reads about an application (another reviewer's narrative, comments), redacted when anonymized. */
export async function redactFor(ctx: ServiceContext, appId: string, value: unknown): Promise<unknown> {
  const anon = await anonymityFor(ctx, appId);
  return anon ? redactValue(value, anon.terms) : value;
}

// ------------------------------------------------------------------------------------ COI policy

export interface CurrentPolicy {
  version: number;
  text: string;
  isDefault: boolean;
  /** False while the default has not been written down yet (no reviewer has signed and the funder wrote none). */
  stored: boolean;
  updatedAt: string | null;
}

/** The policy a competition's reviewers sign now: its latest version, or the plain-language default as version 1. */
export async function currentPolicy(ctx: ServiceContext, competitionId: string): Promise<CurrentPolicy> {
  const [latest] = await ctx.repos.table("coi_policies").find({ competition_id: competitionId }, { orderBy: "version", ascending: false, limit: 1 });
  return latest ? { version: latest.version, text: latest.policy_text, isDefault: latest.is_default, stored: true, updatedAt: latest.created_at } : { version: 1, text: DEFAULT_COI_POLICY, isDefault: true, stored: false, updatedAt: null };
}

/** The competitions (of those named) whose current policy this person has signed. */
export async function signedCompetitions(ctx: ServiceContext, workspaceId: string, userId: string, competitionIds: readonly string[]): Promise<Set<string>> {
  const ids = [...new Set(competitionIds)];
  if (!ids.length) return new Set();
  const [signatures, policies] = await Promise.all([ctx.repos.table("coi_signatures").find({ workspace_id: workspaceId, reviewer_user_id: userId, competition_id: ids }), ctx.repos.table("coi_policies").find({ competition_id: ids })]);
  const out = new Set<string>();
  for (const c of ids) {
    const current = policies.filter((p) => p.competition_id === c).reduce((m, p) => Math.max(m, p.version), 1);
    if (hasSignedCurrent(current, signatures.filter((s) => s.competition_id === c).map((s) => ({ policyVersion: s.policy_version })))) out.add(c);
  }
  return out;
}

/**
 * The competitions (of those named) that are open to this person's review: those that do not require
 * the policy (`coi_policy_required` false: competitions that existed before migration 0033, until the
 * funder turns it on) and those whose current policy the person has signed.
 */
export async function clearedCompetitions(ctx: ServiceContext, workspaceId: string, userId: string, competitionIds: readonly string[]): Promise<Set<string>> {
  const ids = [...new Set(competitionIds)];
  if (!ids.length) return new Set();
  const comps = await ctx.repos.table("competitions").find({ id: ids, workspace_id: workspaceId });
  const optional = new Set(comps.filter((c) => !c.coi_policy_required).map((c) => c.id));
  const signed = await signedCompetitions(ctx, workspaceId, userId, ids.filter((c) => !optional.has(c)));
  return new Set([...optional, ...signed]);
}

/** Of these applications, the ones in competitions open to the reviewer's review (apply.reviewerApplicationIds). */
export async function signedOnly(ctx: ServiceContext, ws: ServiceWorkspace, ids: Set<string>): Promise<Set<string>> {
  if (!ids.size || !ctx.actor.userId) return ids;
  const apps = await ctx.repos.table("applications").find({ id: [...ids], workspace_id: ws.id });
  const cleared = await clearedCompetitions(ctx, ws.id, ctx.actor.userId, apps.map((a) => a.competition_id));
  return new Set(apps.filter((a) => cleared.has(a.competition_id)).map((a) => a.id));
}

/** What a reviewer declared at signing, across the workspace: the matched applicant workspaces and what they typed. */
export async function declaredAtSigning(ctx: ServiceContext, workspaceId: string, reviewerId: string): Promise<{ orgIds: string[]; declared: DeclaredOrg[] }> {
  const rows = await ctx.repos.table("coi_signatures").find({ workspace_id: workspaceId, reviewer_user_id: reviewerId });
  return { orgIds: [...new Set(rows.flatMap((r) => r.declared_org_ids))], declared: rows.flatMap((r) => (Array.isArray(r.declared_orgs) ? (r.declared_orgs as unknown as DeclaredOrg[]) : [])) };
}
