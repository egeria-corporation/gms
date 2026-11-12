// SPDX-License-Identifier: AGPL-3.0-only
// Where an organization's facts come from (owner decision 2026-11-12, docs/decisions.md).
// Passport is the source of verified identity. A workspace that has not linked Passport may keep a
// self-declared profile: what the organization said about itself, always shown as not verified,
// never presented as a verified CommonGrants organization, and replaced by the Passport record
// when the workspace links. Everything that reads an organization's facts (prefill, eligibility,
// letters, the `verification` a funder sees) goes through this module.
import type { JsonObject } from "@gms/forms";
import { profileToObject, type ProfileField } from "@gms/passport-client";
import { readPassportFields } from "@gms/protocol";
import { z } from "zod";
import { ApiError } from "../lib/errors.ts";
import { audit, authorize, required, type ServiceContext } from "./context.ts";
import { APPLICANT_TYPES } from "./opportunities.ts";
import type { Row } from "./repos/types.ts";

type Ws = Row<"workspaces">;

export const PROFILE_SOURCES = ["none", "self_declared", "passport"] as const;
export type ProfileSource = (typeof PROFILE_SOURCES)[number];
export type VerificationLevel = "L0" | "L1" | "L2" | "L3";

const text = (max: number) => z.string().trim().min(1).max(max);

/**
 * Two-digit prefixes the IRS never assigns to an EIN (its published list of valid prefixes leaves
 * these out). Kept in step with migration 0026, which refuses them too (review NP-11).
 */
export const INVALID_EIN_PREFIXES: readonly string[] = ["00", "07", "08", "09", "17", "18", "19", "28", "29", "49", "69", "70", "78", "79", "89", "96", "97"];
export const validEinPrefix = (ein: string): boolean => !INVALID_EIN_PREFIXES.includes(ein.slice(0, 2));

const addressInput = z
  .object({
    street: text(200).optional(),
    city: text(100).optional(),
    region: text(100).optional(),
    postalCode: text(20).optional(),
    /** ISO 3166-1 alpha-2. */
    country: z
      .string()
      .trim()
      .transform((s) => s.toUpperCase())
      .pipe(z.string().regex(/^[A-Z]{2}$/, "Use the two-letter country code, e.g. US"))
      .optional(),
  })
  .strict();

/**
 * The self-declared profile. Organization facts only: no person's identity numbers. The EIN is the
 * organization's employer identification number, digits only. Bounded again in SQL (0026).
 */
export const selfDeclaredProfileInput = z
  .object({
    legalName: text(200),
    displayName: text(200).optional(),
    website: z
      .url()
      .max(300)
      .refine((u) => u.startsWith("https://"), "Use an https link")
      .optional(),
    mission: text(2000).optional(),
    address: addressInput.optional(),
    contactEmail: z
      .email()
      .max(254)
      .transform((s) => s.toLowerCase())
      .optional(),
    orgType: z.enum(APPLICANT_TYPES).optional(),
    ein: z
      .string()
      .trim()
      .transform((s) => s.replace(/-/g, ""))
      .pipe(z.string().regex(/^\d{9}$/, "An EIN is nine digits").refine(validEinPrefix, "This is not an EIN the IRS issues. Enter the organization's EIN, never a person's own identity number"))
      .optional(),
  })
  .strict()
  // An individual has no organization tax number to give; nine digits from one would be a person's own number.
  .refine((p) => !(p.ein && p.orgType === "individual"), { path: ["ein"], message: "An EIN is for organizations. Leave it empty for an individual: never enter a person's own identity number" });
export type SelfDeclaredProfile = z.output<typeof selfDeclaredProfileInput>;

/** `PATCH /gms/workspaces/{id}/profile`: a merge patch. `null` removes an optional field. */
export const profilePatchInput = z
  .object({
    legalName: text(200).optional(),
    displayName: text(200).nullable().optional(),
    website: z.string().max(300).nullable().optional(),
    mission: z.string().max(2000).nullable().optional(),
    address: addressInput.nullable().optional(),
    contactEmail: z.string().max(254).nullable().optional(),
    orgType: z.string().max(60).nullable().optional(),
    ein: z.string().max(12).nullable().optional(),
  })
  .strict();

/** The stored profile, or null when there is none or it no longer reads as one. */
export function selfDeclaredOf(ws: Pick<Ws, "profile_source" | "self_declared_profile"> & Partial<Pick<Ws, "passport_org_id">>): SelfDeclaredProfile | null {
  // A Passport organization always wins: no local profile is shown beside it (review NP-13).
  if (ws.passport_org_id || ws.profile_source !== "self_declared" || !ws.self_declared_profile) return null;
  const r = selfDeclaredProfileInput.safeParse(ws.self_declared_profile);
  return r.success ? r.data : null;
}

/**
 * Where this workspace's organization facts come from. A Passport organization always wins: the
 * id is set only by Passport (a consent, a sign-in or a verified funder client, RT-006).
 */
export function profileSourceOf(ws: Pick<Ws, "passport_org_id" | "profile_source" | "self_declared_profile">): ProfileSource {
  if (ws.passport_org_id) return "passport";
  return selfDeclaredOf(ws) ? "self_declared" : "none";
}

const LEVEL = /^L[0-3]$/;

/** What a funder (or anyone) is told about how far this organization is verified. */
export interface Verification {
  source: ProfileSource;
  /** Passport's assurance level; null for anything not from Passport. */
  level: VerificationLevel | null;
}

export function verificationOf(ws: Pick<Ws, "passport_org_id" | "profile_source" | "self_declared_profile" | "verification_level"> | null | undefined): Verification {
  if (!ws) return { source: "none", level: null };
  const source = profileSourceOf(ws);
  const level = source === "passport" && ws.verification_level && LEVEL.test(ws.verification_level) ? (ws.verification_level as VerificationLevel) : null;
  return { source, level };
}

/**
 * Which of these applicant workspaces share their record with this funder: a live consent, given by
 * applying or by sharing a report. The one rule for everything a funder reads or is sent about an
 * organization from Passport (its Passport id and legal name, level, payee status, bank name and
 * last four, alerts and holds), for emailing it, and for telling Passport about it (review F-01).
 */
export async function sharingWith(ctx: Pick<ServiceContext, "repos">, funderId: string, applicantIds: readonly (string | null | undefined)[]): Promise<Set<string>> {
  const ids = [...new Set(applicantIds.filter((x): x is string => !!x))];
  if (!ids.length) return new Set();
  const rows = await ctx.repos.table("consents").find({ funder_workspace_id: funderId, applicant_workspace_id: ids, revoked_at: null });
  return new Set(rows.map((c) => c.applicant_workspace_id));
}
export const sharesWith = async (ctx: Pick<ServiceContext, "repos">, funderId: string, applicantId: string): Promise<boolean> => (await sharingWith(ctx, funderId, [applicantId])).has(applicantId);

/** How a funder names an organization: by its Passport legal name only while it shares its record, otherwise by the workspace's own name. */
export const namesShared = (ws: Parameters<typeof namesOf>[0], shared: boolean): { name: string; workspaceName: string | null } => (shared ? namesOf(ws) : { name: ws.display_name, workspaceName: null });

/**
 * Hold reasons that come from Passport's facts about the payee. A funder the organization does not
 * share its record with sees only that the tranche is held at Passport: which fact holds it is the
 * organization's to share.
 */
const PAYEE_HOLD_REASONS: readonly string[] = ["pending_destination_change", "freeze_window", "level_below_l3", "organization_inactive", "credential_version_stale"];
export const shownHoldReason = (reason: string | null, shared: boolean): string | null => (shared || !reason || !PAYEE_HOLD_REASONS.includes(reason) ? reason : "held_at_passport");

/** What a funder sees: the source always, the Passport level only while the organization shares its record. */
export const verificationShared = (ws: Parameters<typeof verificationOf>[0], shared: boolean): Verification => {
  const v = verificationOf(ws);
  return shared ? v : { source: v.source, level: null };
};

/**
 * The self-declared profile in the shape of a CommonGrants organization, for prefill mappings and
 * eligibility rules that read `org.*`. Internal only: it has no id and none of Passport's custom
 * fields, and it is never served as a CommonGrants organization.
 */
export function selfDeclaredOrg(p: SelfDeclaredProfile): JsonObject {
  const org: JsonObject = { name: p.legalName };
  if (p.contactEmail) org.emails = { primary: p.contactEmail };
  if (p.website) org.socials = { website: p.website };
  if (p.mission) org.mission = p.mission;
  if (p.orgType) org.orgType = { term: p.orgType };
  if (p.ein) org.identifiers = { "org:us:ein": { id: p.ein } };
  if (p.address) {
    const a = p.address;
    const primary: JsonObject = {};
    if (a.street) primary.street1 = a.street;
    if (a.city) primary.city = a.city;
    if (a.region) primary.stateOrProvince = a.region;
    if (a.postalCode) primary.postalCode = a.postalCode;
    if (a.country) primary.country = a.country;
    if (Object.keys(primary).length) org.addresses = { primary };
  }
  return org;
}

/**
 * The name shown beside an organization's verification badge (review NP-02). A Passport workspace
 * is named by its Passport record; the workspace's own display name, which any admin can change,
 * comes second as `workspaceName` (null when it is the same). Without Passport there is no other name.
 */
export function namesOf(ws: Pick<Ws, "display_name" | "legal_name" | "org_projection" | "passport_org_id" | "profile_source" | "self_declared_profile">): { name: string; workspaceName: string | null } {
  if (profileSourceOf(ws) !== "passport") return { name: ws.display_name, workspaceName: null };
  const projected = (ws.org_projection as { name?: unknown } | null)?.name;
  const name = (typeof projected === "string" && projected.trim() ? projected : null) ?? ws.legal_name ?? ws.display_name;
  return { name, workspaceName: ws.display_name !== name ? ws.display_name : null };
}

/** What prefill and eligibility read about an applicant, and where it came from. */
export interface OrgFacts {
  org: JsonObject;
  /** Passport's Common App profile; null without Passport. */
  profile: JsonObject | null;
  level: string | null;
  attestationUrl: string | null;
  source: ProfileSource;
}

/** The one reader of an organization's facts (replaces `passportFacts`). */
export function orgFacts(ws: Ws): OrgFacts {
  const source = profileSourceOf(ws);
  if (source === "self_declared") return { org: selfDeclaredOrg(selfDeclaredOf(ws)!), profile: null, level: null, attestationUrl: null, source };
  if (source === "none") return { org: {}, profile: null, level: null, attestationUrl: null, source };
  const org = (ws.org_projection as JsonObject | null) ?? {};
  const cached = ws.profile_projection as { fields?: ProfileField[] } | null;
  const profile = cached?.fields?.length ? (profileToObject(cached.fields) as JsonObject) : null;
  const fields = readPassportFields(org);
  return { org, profile, level: ws.verification_level ?? fields.verificationLevel ?? null, attestationUrl: fields.attestation ?? null, source };
}

export const primaryEmail = (org: JsonObject): string | null => {
  const emails = org.emails as { primary?: unknown } | undefined;
  return typeof emails?.primary === "string" ? emails.primary : null;
};

/** At most this many admins receive a letter for a workspace that has no Passport address. */
export const MAX_ADMIN_RECIPIENTS = 5;

/**
 * Where letters to an organization go: the Passport record's email, else the workspace's admins at
 * the addresses they sign in with (proved by signing in). A self-declared `contactEmail` is shown,
 * never emailed: nothing proves the organization controls it, and letters carry the funder's name
 * and text the applicant chose (review NP-01). Empty when no address is known.
 */
export async function recipientEmails(ctx: Pick<ServiceContext, "repos" | "ports" | "now">, ws: Ws | null | undefined): Promise<string[]> {
  if (!ws) return [];
  const facts = orgFacts(ws);
  const own = facts.source === "passport" ? primaryEmail(facts.org) : null;
  if (own) return [own];
  const nowMs = ctx.now().getTime();
  const admins = (await ctx.repos.table("workspace_members").find({ workspace_id: ws.id, role: "admin" }, { orderBy: "created_at" }))
    .filter((m) => !m.expires_at || Date.parse(m.expires_at) > nowMs)
    .slice(0, MAX_ADMIN_RECIPIENTS);
  if (!admins.length || !ctx.ports.directory) return [];
  const people = await ctx.ports.directory.lookup(admins.map((a) => a.user_id));
  return [...new Set(admins.flatMap((a) => (people.get(a.user_id)?.email ? [people.get(a.user_id)!.email!.toLowerCase()] : [])))];
}

/** A summary of the profile for the workspace view; null for a Passport workspace (its record is in Passport). */
export const profileView = (ws: Ws) => ({ source: profileSourceOf(ws), selfDeclared: profileSourceOf(ws) === "self_declared" ? selfDeclaredOf(ws) : null, verification: verificationOf(ws) });

const changedFields = (a: Record<string, unknown> | null, b: Record<string, unknown> | null): string[] =>
  [...new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])].filter((k) => JSON.stringify(a?.[k] ?? null) !== JSON.stringify(b?.[k] ?? null)).sort();

/**
 * The columns that store a new self-declared profile (workspace creation). Validated here so a
 * caller cannot reach the table with anything else.
 */
export function selfDeclaredColumns(input: SelfDeclaredProfile) {
  const parsed = selfDeclaredProfileInput.parse(input);
  return { profile_source: "self_declared" as const, self_declared_profile: parsed as unknown as Ws["self_declared_profile"] };
}

/** Workspace admins edit the self-declared profile. A Passport workspace edits its record in Passport. */
export async function updateProfile(ctx: ServiceContext, id: string, input: z.output<typeof profilePatchInput>) {
  await authorize(ctx, { scope: "workspace:admin", roles: ["admin"], owner: id, what: "Workspace" });
  const ws = required(await ctx.repos.table("workspaces").one({ id }), "Workspace");
  if (profileSourceOf(ws) === "passport") throw new ApiError(409, "profile_from_passport", "This organization's profile comes from OpenGrants Passport. Edit it in Passport");
  const current = selfDeclaredOf(ws);
  const merged = Object.fromEntries(Object.entries({ ...(current ?? {}), ...input }).filter(([, v]) => v !== null && v !== undefined));
  const parsed = selfDeclaredProfileInput.safeParse(merged);
  if (!parsed.success) {
    throw new ApiError(
      422,
      "invalid_profile",
      current ? "This profile is not valid" : "Enter the organization's legal name to start a profile",
      parsed.error.issues.map((i) => ({ code: i.code, field: i.path.join("."), detail: i.message })),
    );
  }
  const fields = changedFields(current as Record<string, unknown> | null, parsed.data as Record<string, unknown>);
  if (!fields.length) return { workspaceId: ws.id, ...profileView(ws) };
  // The compare-and-set on the source keeps a concurrent Passport link from being overwritten.
  const [row] = await ctx.repos.table("workspaces").update({ id, passport_org_id: null }, { ...selfDeclaredColumns(parsed.data), legal_name: parsed.data.legalName });
  if (!row) throw new ApiError(409, "profile_from_passport", "This organization's profile now comes from OpenGrants Passport. Edit it in Passport");
  await audit(ctx, "workspace.profile_updated", "workspace", id, { fields, source: "self_declared" }, id);
  return { workspaceId: row.id, ...profileView(row) };
}

/**
 * When a self-declared workspace links Passport, the Passport record replaces the profile. Returns
 * the columns to write with the link, and ledgers which fields differed (names, never values).
 */
/** Where each self-declared field sits in a CommonGrants organization, to compare it with Passport's record. */
const ORG_PATHS: Record<string, string> = {
  legalName: "name",
  website: "socials.website",
  mission: "mission",
  contactEmail: "emails.primary",
  orgType: "orgType.term",
  ein: "identifiers.org:us:ein.id",
  "address.street": "addresses.primary.street1",
  "address.city": "addresses.primary.city",
  "address.region": "addresses.primary.stateOrProvince",
  "address.postalCode": "addresses.primary.postalCode",
  "address.country": "addresses.primary.country",
};
const at = (o: unknown, path: string): unknown => path.split(".").reduce<unknown>((cur, key) => (cur && typeof cur === "object" ? (cur as Record<string, unknown>)[key] : undefined), o);

/**
 * When a self-declared workspace links Passport, the Passport record replaces the profile. Returns
 * the columns to write with the link, and ledgers which fields differed (names, never values).
 */
export async function replaceProfileWithPassport(ctx: ServiceContext, ws: Ws, passportOrg: JsonObject): Promise<{ profile_source: "passport"; self_declared_profile: null }> {
  const before = selfDeclaredOf(ws);
  if (before) {
    const flat: Record<string, unknown> = { ...before, ...Object.fromEntries(Object.entries(before.address ?? {}).map(([k, v]) => [`address.${k}`, v])) };
    const differed = Object.keys(ORG_PATHS).filter((f) => flat[f] !== undefined && String(flat[f]).toLowerCase() !== String(at(passportOrg, ORG_PATHS[f]!) ?? "").toLowerCase());
    await audit(ctx, "workspace.profile_replaced_by_passport", "workspace", ws.id, { fieldsDiffered: differed }, ws.id);
  }
  return { profile_source: "passport", self_declared_profile: null };
}
