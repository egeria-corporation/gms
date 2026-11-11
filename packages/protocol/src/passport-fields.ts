// SPDX-License-Identifier: AGPL-3.0-only
// Reads the three OpenGrants Passport custom fields from a CommonGrants organization. Local stand-in
// for `@opengrants/cg-plugin-passport` until it is published; shapes match the plugin.
import { z } from "zod";

export const VERIFICATION_LEVELS = ["L0", "L1", "L2", "L3"] as const;
export type VerificationLevel = (typeof VERIFICATION_LEVELS)[number];

export interface PassportFields {
  /** `L0` when the organization carries no level. */
  verificationLevel: VerificationLevel;
  verifiedAt: string | null;
  /** URL of the signed attestation (JWS). */
  attestation: string | null;
}

const level = z.enum(VERIFICATION_LEVELS);
const instant = z.iso.datetime({ offset: true });
const link = z.url();

function fieldValue(customFields: unknown, name: string): unknown {
  if (!customFields || typeof customFields !== "object") return undefined;
  const field = (customFields as Record<string, unknown>)[name];
  return field && typeof field === "object" ? (field as { value?: unknown }).value : undefined;
}

/** Tolerant by design: a malformed field reads as absent, never as a higher level. */
export function readPassportFields(org: { customFields?: unknown } | null | undefined): PassportFields {
  const cf = org?.customFields;
  const lvl = level.safeParse(fieldValue(cf, "verificationLevel"));
  const at = instant.safeParse(fieldValue(cf, "verifiedAt"));
  const att = link.safeParse(fieldValue(cf, "attestation"));
  return {
    verificationLevel: lvl.success ? lvl.data : "L0",
    verifiedAt: at.success ? at.data : null,
    attestation: att.success ? att.data : null,
  };
}

export const ORGANIZATION_KINDS = ["nonprofit", "funder", "both"] as const;
export type OrganizationKind = (typeof ORGANIZATION_KINDS)[number];
const orgKind = z.enum(ORGANIZATION_KINDS);

/**
 * Passport's `organizationKind` custom field: whether the organization receives grants, makes them,
 * or both. Null when the record does not say (records cached before Passport published the field).
 */
export function readOrganizationKind(org: { customFields?: unknown } | null | undefined): OrganizationKind | null {
  const k = orgKind.safeParse(fieldValue(org?.customFields, "organizationKind"));
  return k.success ? k.data : null;
}

export const levelRank = (value: VerificationLevel): number => VERIFICATION_LEVELS.indexOf(value);

export const meetsLevel = (actual: VerificationLevel, required: VerificationLevel): boolean => levelRank(actual) >= levelRank(required);

/** The custom fields the GMS stamps on a submitted application. */
export function passportCustomFields(input: { verificationLevel?: VerificationLevel | null; attestationUrl?: string | null }) {
  const out: Record<string, { name: string; fieldType: "string"; value: string; description: string }> = {};
  if (input.verificationLevel) {
    out.verificationLevel = {
      name: "verificationLevel",
      fieldType: "string",
      value: input.verificationLevel,
      description: "OpenGrants Passport assurance level at submission",
    };
  }
  if (input.attestationUrl) {
    out.attestation = { name: "attestation", fieldType: "string", value: input.attestationUrl, description: "Signed attestation (JWS)" };
  }
  return out;
}
