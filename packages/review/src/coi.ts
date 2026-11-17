// SPDX-License-Identifier: AGPL-3.0-only
// The competition-wide conflict-of-interest policy: the plain-language default, which signature
// counts, and matching the organizations a reviewer declares to the applicants the GMS holds.

/** Used when the funder has not written its own policy. Plain language; the funder can replace it. */
export const DEFAULT_COI_POLICY = [
  "Before you read any application in this competition, read this policy and sign it.",
  "You have a conflict of interest when you, someone in your household or a close business partner could gain or lose from an application's outcome, or when your relationship with an applicant would make it hard to judge it fairly. That includes being an employee, board member, volunteer leader, contractor or adviser of an applicant now or in the last three years, having a financial interest in an applicant or its project, and having helped write an application.",
  "If you know of a conflict now, list the organization when you sign. If you find one later, stop and choose \"I have a conflict\" on that application: you are recused and it does not open for you.",
  "Keep what you read confidential. Do not share, copy or discuss applications or scores outside this review, and do not contact applicants about their applications.",
].join("\n\n");

/**
 * A signature counts only for the policy version it was signed against: when the funder changes
 * the policy, reviewers sign again before more applications open. The one switch to relax.
 */
export const RESIGN_WHEN_POLICY_CHANGES = true;

export interface SignatureRef {
  policyVersion: number;
}

/** Has the reviewer signed the policy as it stands? */
export function hasSignedCurrent(currentVersion: number, signatures: readonly SignatureRef[]): boolean {
  return RESIGN_WHEN_POLICY_CHANGES ? signatures.some((s) => s.policyVersion === currentVersion) : signatures.length > 0;
}

const SUFFIXES = /\b(inc|incorporated|llc|ltd|limited|corp|corporation|co|company|pbc|nfp)\b/g;

/** An organization name reduced for comparison: case, punctuation, "the", "&" and legal suffixes do not matter. */
export function normalizeOrgName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(SUFFIXES, " ")
    .replace(/^\s*the\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

export interface DeclaredOrg {
  name: string;
  website?: string;
}

export interface OrgCandidate {
  id: string;
  names: readonly string[];
  /** Bare domains, e.g. "aldercreekfs.org". */
  domains: readonly string[];
}

const hostOf = (website: string): string | null => {
  const v = website.trim().toLowerCase();
  try {
    const host = new URL(/^[a-z][a-z0-9+.-]*:\/\//.test(v) ? v : `https://${v}`).hostname.replace(/^www\./, "");
    return host.includes(".") ? host : null;
  } catch {
    return null;
  }
};

/** Does a declared organization name this candidate? Same name once normalized, or the same website. */
export function declaredMatches(declared: DeclaredOrg, candidate: OrgCandidate): boolean {
  const n = normalizeOrgName(declared.name);
  if (n && candidate.names.some((x) => normalizeOrgName(x) === n)) return true;
  const host = declared.website ? hostOf(declared.website) : null;
  return !!host && candidate.domains.some((d) => d === host || host.endsWith(`.${d}`));
}

/** The candidates any of the declared organizations name, in candidate order. */
export function matchDeclaredOrgs(declared: readonly DeclaredOrg[], candidates: readonly OrgCandidate[]): string[] {
  return candidates.filter((c) => declared.some((d) => declaredMatches(d, c))).map((c) => c.id);
}
