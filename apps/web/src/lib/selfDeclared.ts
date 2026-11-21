// SPDX-License-Identifier: AGPL-3.0-only
// The profile an organization typed itself, shown as entered by them and never as a Passport record.
import type { SelfDeclaredProfile } from "../api/types.ts";

export interface DeclaredFacts {
  legalName: string | null;
  ein: string | null;
  address: string | null;
  website: string | null;
  mission: string | null;
}

const filled = (v: string | null | undefined): string | null => {
  const t = v?.trim();
  return t ? t : null;
};

/** Identity and mission from a self-declared profile. Null when there is no profile. */
export function declaredFacts(profile: SelfDeclaredProfile | null | undefined): DeclaredFacts | null {
  if (!profile) return null;
  const address = profile.address;
  const line = [address?.street, address?.city, address?.region, address?.postalCode].map(filled).filter((p): p is string => !!p).join(", ");
  const ein = filled(profile.ein)?.replace(/^(\d{2})(\d{7})$/, "$1-$2") ?? null;
  return {
    legalName: filled(profile.legalName),
    ein,
    address: line || null,
    website: filled(profile.website)?.replace(/^https?:\/\//, "") ?? null,
    mission: filled(profile.mission),
  };
}
