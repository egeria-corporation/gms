// SPDX-License-Identifier: AGPL-3.0-only
// The reusable profile, made visible to applicants (E4). "Your organization profile is reused by
// every funder you apply to here": the panel on the applicant dashboard and at the start of
// applying shows the organization facts a funder sees when the organization applies (the same
// record inbox.ts gives a funder under a live consent: the Passport record, or the self-declared
// profile), whether they are verified through Passport or self-declared, where to edit them and
// where to verify with Passport. Nothing a funder does not see is listed: no representatives, no
// payout destination, no Common App financials (those reach a funder only as form answers).
import type { JsonObject } from "@gms/forms";
import { authorize, required, type ServiceContext } from "./context.ts";
import { passportOrgUrl } from "./organization.ts";
import { orgFacts, selfDeclaredOf, verificationOf } from "./profile.ts";

/** The fields funders see, in the order the panel lists them. */
export const FUNDER_SEEN_FIELDS = ["legalName", "ein", "orgType", "address", "email", "website", "mission"] as const;
export type FunderSeenField = (typeof FUNDER_SEEN_FIELDS)[number];

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : null);
const at = (o: unknown, path: string): unknown => path.split(".").reduce<unknown>((cur, k) => (cur && typeof cur === "object" ? (cur as Record<string, unknown>)[k] : undefined), o);

/** The organization's facts as a funder reads them, field by field; null where it gives none. */
export function fieldsFundersSee(org: JsonObject): Record<FunderSeenField, string | null> {
  const address = ["street1", "city", "stateOrProvince", "postalCode", "country"].map((k) => text(at(org, `addresses.primary.${k}`))).filter(Boolean).join(", ") || null;
  return {
    legalName: text(org.name),
    ein: text(at(org, "identifiers.org:us:ein.id")),
    orgType: text(at(org, "orgType.term")),
    address,
    email: text(at(org, "emails.primary")),
    website: text(at(org, "socials.website")),
    mission: text(org.mission),
  };
}

/** The panel: what funders see, how far it is verified, and where to edit or verify it. */
export async function profileForFunders(ctx: ServiceContext) {
  const ws = await authorize(ctx, { scope: "org:read", kind: "applicant" });
  const row = required(await ctx.repos.table("workspaces").one({ id: ws.id }), "Workspace");
  const facts = orgFacts(row);
  const verification = verificationOf(row);
  const values = facts.source === "none" ? null : fieldsFundersSee(facts.org);
  return {
    source: facts.source,
    level: verification.level,
    verified: facts.source === "passport",
    fields: FUNDER_SEEN_FIELDS.map((key) => ({ key, value: values?.[key] ?? null })),
    // A Passport record is edited in Passport; a self-declared profile in the workspace's settings.
    editUrl: facts.source === "passport" ? passportOrgUrl(ctx, row) : null,
    editPath: facts.source === "passport" ? null : `/w/${row.handle}/settings#organization-details`,
    // Verifying links the workspace to its Passport record, which then replaces the self-declared profile.
    verifyPath: facts.source === "passport" ? null : "/onboarding/applicant",
    selfDeclared: facts.source === "self_declared" && !!selfDeclaredOf(row),
  };
}
