// SPDX-License-Identifier: AGPL-3.0-only
// The self-declared profile: its limits (the same the API enforces) and the check the form and the
// mock share. The API remains the authority; this only saves a round trip.
import type { SelfDeclaredProfile, SelfDeclaredProfilePatch } from "../api/types.ts";

export const ORG_TYPES: { value: string; label: string }[] = [
  { value: "nonprofit", label: "Nonprofit" },
  { value: "government", label: "Government or tribal body" },
  { value: "educational", label: "School or university" },
  { value: "for_profit", label: "Business" },
  { value: "other", label: "Other" },
];

export interface ProfileProblem {
  path: string;
  message: string;
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function profileProblems(p: SelfDeclaredProfile): ProfileProblem[] {
  const out: ProfileProblem[] = [];
  const add = (path: string, message: string) => out.push({ path, message });
  if (!p.legalName?.trim()) add("legalName", "Enter your organization’s legal name");
  else if (p.legalName.length > 200) add("legalName", "Use 200 characters or fewer");
  if ((p.displayName?.length ?? 0) > 200) add("displayName", "Use 200 characters or fewer");
  if (!p.contactEmail?.trim()) add("contactEmail", "Enter an email address funders can write to");
  else if (!EMAIL.test(p.contactEmail) || p.contactEmail.length > 254) add("contactEmail", "Enter a full email address");
  if (p.website) {
    let ok = p.website.length <= 300;
    try {
      ok = ok && new URL(p.website).protocol === "https:";
    } catch {
      ok = false;
    }
    if (!ok) add("website", "Enter a web address that starts with https://");
  }
  if ((p.mission?.length ?? 0) > 2000) add("mission", "Use 2,000 characters or fewer");
  if (p.address?.country && !/^[A-Za-z]{2}$/.test(p.address.country)) add("address.country", "Use a two-letter country code, such as US");
  const ein = p.ein?.replace(/-/g, "").trim();
  if (ein && !/^\d{9}$/.test(ein)) add("ein", "An EIN has nine digits");
  else if (ein && INVALID_EIN_PREFIXES.includes(ein.slice(0, 2))) add("ein", "This is not an EIN the IRS issues. Enter the organization's EIN, never a Social Security number");
  else if (ein && p.orgType === "individual") add("ein", "An EIN is for organizations. Leave it empty for an individual");
  return out;
}

/** Drops empty optional fields and tidies what is left, ready to send. */
export function cleanProfile(p: SelfDeclaredProfile): SelfDeclaredProfile {
  const t = (v: string | undefined) => v?.trim() || undefined;
  const address = Object.fromEntries(Object.entries(p.address ?? {}).flatMap(([k, v]) => (t(v) ? [[k, k === "country" ? t(v)!.toUpperCase() : t(v)]] : [])));
  const out: SelfDeclaredProfile = { legalName: p.legalName.trim() };
  const put = <K extends keyof SelfDeclaredProfile>(k: K, v: SelfDeclaredProfile[K] | undefined) => {
    if (v !== undefined) out[k] = v;
  };
  put("displayName", t(p.displayName));
  put("website", t(p.website));
  put("mission", t(p.mission));
  put("contactEmail", t(p.contactEmail));
  put("orgType", t(p.orgType));
  put("ein", t(p.ein)?.replace(/-/g, ""));
  if (Object.keys(address).length) out.address = address;
  return out;
}

const OPTIONAL: (keyof SelfDeclaredProfile)[] = ["displayName", "website", "mission", "address", "contactEmail", "orgType", "ein"];

/** A merge patch that makes the stored profile equal to `p`: optional fields left empty are removed (null). */
export function toPatch(p: SelfDeclaredProfile): SelfDeclaredProfilePatch {
  const patch: Record<string, unknown> = { legalName: p.legalName };
  for (const k of OPTIONAL) patch[k] = p[k] ?? null;
  return patch as SelfDeclaredProfilePatch;
}

/** Prefixes the IRS never assigns to an EIN; the API refuses them too (review NP-11). */
export const INVALID_EIN_PREFIXES: readonly string[] = ["00", "07", "08", "09", "17", "18", "19", "28", "29", "49", "69", "70", "78", "79", "89", "96", "97"];
