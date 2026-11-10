// SPDX-License-Identifier: AGPL-3.0-only
// GMS statuses → CommonGrants enums (build spec §10.1). Never invent a CG enum value: anything the
// protocol has no word for is `custom` with the GMS status in `customValue`.

export type GmsApplicationStatus =
  | "draft"
  | "submitted"
  | "screening"
  | "under_review"
  | "recommended"
  | "accepted"
  | "declined"
  | "waitlisted"
  | "revision_requested"
  | "interview"
  | "withdrawn";

export type GmsAwardStatus = "offered" | "accepted" | "active" | "suspended" | "completed" | "cancelled";
export type GmsCompetitionStatus = "draft" | "open" | "closed";
export type GmsOpportunityStatus = "forecasted" | "open" | "closed";
export type GmsFormResponseStatus = "notStarted" | "inProgress" | "complete";

export interface CgStatus<V extends string> {
  value: V;
  customValue?: string;
  description?: string;
}

type AppValue = "inProgress" | "submitted" | "accepted" | "rejected" | "custom";

export const APPLICATION_STATUS_MAP: Record<GmsApplicationStatus, CgStatus<AppValue>> = {
  draft: { value: "inProgress" },
  submitted: { value: "submitted" },
  screening: { value: "custom", customValue: "screening" },
  under_review: { value: "custom", customValue: "underReview" },
  recommended: { value: "custom", customValue: "recommended" },
  accepted: { value: "accepted" },
  declined: { value: "rejected" },
  waitlisted: { value: "custom", customValue: "waitlisted" },
  revision_requested: { value: "custom", customValue: "revisionRequested" },
  interview: { value: "custom", customValue: "interview" },
  withdrawn: { value: "custom", customValue: "withdrawn" },
};

type AwdValue = "awarded" | "completed" | "cancelled" | "custom";

/** `customValue` carries the GMS lifecycle status; `AwardBase` has no `customFields` to put it in. */
export const AWARD_STATUS_MAP: Record<GmsAwardStatus, CgStatus<AwdValue>> = {
  offered: { value: "awarded", customValue: "offered" },
  accepted: { value: "awarded", customValue: "accepted" },
  active: { value: "awarded", customValue: "active" },
  suspended: { value: "awarded", customValue: "suspended" },
  completed: { value: "completed", customValue: "completed" },
  cancelled: { value: "cancelled", customValue: "cancelled" },
};

export const COMPETITION_STATUS_MAP: Record<GmsCompetitionStatus, CgStatus<"open" | "closed" | "custom">> = {
  draft: { value: "custom", customValue: "draft" },
  open: { value: "open" },
  closed: { value: "closed" },
};

function lookup<K extends string, V extends string>(map: Record<K, CgStatus<V>>, status: string, kind: string): CgStatus<V> {
  if (!Object.hasOwn(map, status)) throw new RangeError(`unknown ${kind} status: ${status}`);
  return { ...map[status as K] };
}

export const applicationStatusToCg = (status: string) => lookup(APPLICATION_STATUS_MAP, status, "application");
export const awardStatusToCg = (status: string) => lookup(AWARD_STATUS_MAP, status, "award");
export const competitionStatusToCg = (status: string) => lookup(COMPETITION_STATUS_MAP, status, "competition");

/** The GMS statuses a CommonGrants `status` filter value selects (accepts CG values and custom values). */
export function applicationStatusesForCg(value: string): GmsApplicationStatus[] {
  return (Object.keys(APPLICATION_STATUS_MAP) as GmsApplicationStatus[]).filter((s) => {
    const cg = APPLICATION_STATUS_MAP[s];
    return cg.customValue ? cg.customValue === value || value === "custom" : cg.value === value;
  });
}

export function awardStatusesForCg(value: string): GmsAwardStatus[] {
  return (Object.keys(AWARD_STATUS_MAP) as GmsAwardStatus[]).filter((s) => AWARD_STATUS_MAP[s].value === value || AWARD_STATUS_MAP[s].customValue === value);
}
