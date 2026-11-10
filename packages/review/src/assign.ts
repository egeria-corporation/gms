// SPDX-License-Identifier: AGPL-3.0-only
// Reviewer assignment (build spec §10.5): by capacity and expertise tags, with COI exclusion.

export interface ReviewerProfile {
  id: string;
  email: string;
  /** Maximum assignments in this stage. */
  capacity: number;
  /** Assignments the reviewer already holds in this stage. */
  load?: number;
  tags?: readonly string[];
  /** Conflicts the reviewer declared. */
  conflicts?: { orgIds?: readonly string[]; programIds?: readonly string[] };
}

export interface AssignableApplication {
  id: string;
  applicantOrgId?: string | null;
  /** Email domains of the applicant organization and its contacts. */
  applicantDomains?: readonly string[];
  programId?: string | null;
  tags?: readonly string[];
  /** Reviewers already assigned (never assigned twice). */
  assignedReviewerIds?: readonly string[];
}

export type CoiReason = "declared_org" | "declared_program" | "same_email_domain";

export interface CoiFlag {
  applicationId: string;
  reviewerId: string;
  reason: CoiReason;
  detail: string;
}

/** Shared mailbox providers never imply an affiliation. */
const PUBLIC_DOMAINS = new Set(["gmail.com", "googlemail.com", "yahoo.com", "icloud.com", "proton.me", "protonmail.com", "aol.com", "fastmail.com"]);

export const emailDomain = (email: string): string => email.slice(email.lastIndexOf("@") + 1).trim().toLowerCase();

/** Why this reviewer must not review this application, or null. */
export function detectCoi(reviewer: ReviewerProfile, app: AssignableApplication): CoiFlag | null {
  const flag = (reason: CoiReason, detail: string): CoiFlag => ({ applicationId: app.id, reviewerId: reviewer.id, reason, detail });
  if (app.applicantOrgId && reviewer.conflicts?.orgIds?.includes(app.applicantOrgId)) return flag("declared_org", "Reviewer declared a conflict with the applicant organization.");
  if (app.programId && reviewer.conflicts?.programIds?.includes(app.programId)) return flag("declared_program", "Reviewer declared a conflict with this program.");
  const d = emailDomain(reviewer.email);
  if (d && !PUBLIC_DOMAINS.has(d) && app.applicantDomains?.some((x) => x.toLowerCase() === d)) {
    return flag("same_email_domain", `Reviewer's email domain (${d}) matches the applicant's.`);
  }
  return null;
}

export interface AutoAssignInput {
  applications: readonly AssignableApplication[];
  reviewers: readonly ReviewerProfile[];
  reviewersPerApplication: number;
}

export interface AutoAssignResult {
  assignments: { applicationId: string; reviewerId: string; matchedTags: string[] }[];
  /** Applications that could not get their full complement. */
  unfilled: { applicationId: string; missing: number }[];
  /** Every reviewer/application pair excluded for a conflict of interest. */
  coiFlags: CoiFlag[];
}

/** Deterministic greedy assignment: best expertise overlap first, then the least-loaded reviewer.
 *  Applications with the fewest eligible reviewers are placed first so scarce reviewers are not
 *  spent on applications anyone could review. */
export function autoAssign(input: AutoAssignInput): AutoAssignResult {
  const load = new Map(input.reviewers.map((r) => [r.id, r.load ?? 0]));
  const coiFlags: CoiFlag[] = [];
  const candidates = new Map<string, ReviewerProfile[]>();
  for (const app of input.applications) {
    const ok: ReviewerProfile[] = [];
    for (const r of input.reviewers) {
      if (app.assignedReviewerIds?.includes(r.id)) continue;
      const coi = detectCoi(r, app);
      if (coi) coiFlags.push(coi);
      else ok.push(r);
    }
    candidates.set(app.id, ok);
  }
  const order = [...input.applications].sort((a, b) => candidates.get(a.id)!.length - candidates.get(b.id)!.length || a.id.localeCompare(b.id));
  const assignments: AutoAssignResult["assignments"] = [];
  const unfilled: AutoAssignResult["unfilled"] = [];
  for (const app of order) {
    const need = Math.max(0, input.reviewersPerApplication - (app.assignedReviewerIds?.length ?? 0));
    const overlap = (r: ReviewerProfile) => (r.tags ?? []).filter((t) => app.tags?.includes(t));
    const pool = candidates
      .get(app.id)!
      .filter((r) => load.get(r.id)! < r.capacity)
      .sort((a, b) => overlap(b).length - overlap(a).length || load.get(a.id)! - load.get(b.id)! || a.id.localeCompare(b.id));
    const chosen = pool.slice(0, need);
    for (const r of chosen) {
      load.set(r.id, load.get(r.id)! + 1);
      assignments.push({ applicationId: app.id, reviewerId: r.id, matchedTags: overlap(r) });
    }
    if (chosen.length < need) unfilled.push({ applicationId: app.id, missing: need - chosen.length });
  }
  assignments.sort((a, b) => a.applicationId.localeCompare(b.applicationId) || a.reviewerId.localeCompare(b.reviewerId));
  unfilled.sort((a, b) => a.applicationId.localeCompare(b.applicationId));
  return { assignments, unfilled, coiFlags };
}
