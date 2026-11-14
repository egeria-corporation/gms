// SPDX-License-Identifier: AGPL-3.0-only
// Whether an opportunity is taking applications, said honestly on the funder screens. Publishing
// makes an opportunity findable; applicants can apply only once one of its competitions is open.
import { CirclePause } from "lucide-react";
import type { Competition, Opportunity } from "../../api/types.ts";
import { StatusBadge } from "../../components/status.tsx";

/** The competition the Applications step works on: the open one, else the newest draft, else the newest. */
export function competitionOf(opportunityId: string, competitions: readonly Competition[]): Competition | undefined {
  const mine = competitions.filter((c) => c.opportunityId === opportunityId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return mine.find((c) => c.status === "open") ?? mine.find((c) => c.status === "draft") ?? mine[0];
}

export const takingApplications = (opportunityId: string, competitions: readonly Competition[]) => competitions.some((c) => c.opportunityId === opportunityId && c.status === "open");

/**
 * Whether the public page offers Apply, by its own rule (public/OpportunityPage `takingApplications`
 * with APPLY_NEEDS_OPEN_OPPORTUNITY): published, open (not forecasted, not closed), and a
 * competition open. The builder's preview card follows it, so it never shows Apply the page lacks.
 */
export const offersApply = (o: Pick<Opportunity, "id" | "published" | "status"> | undefined, competitions: readonly Competition[] | undefined) =>
  !!o && !!competitions && o.published && o.status === "open" && takingApplications(o.id, competitions);

/** Published as open, but no competition is open: applicants can find it and cannot apply. */
export const publishedNotTaking = (o: Opportunity, competitions: readonly Competition[]) => o.published && o.status === "open" && !takingApplications(o.id, competitions);

export const NOT_TAKING_LABEL = "Published, not taking applications";
/** A forecasted opportunity is published to show what is coming; it takes no applications by design. */
export const FORECASTED_LABEL = "Forecasted, not taking applications yet";

/**
 * The opportunity's status badge, icon and label. `competitions` undefined (still loading) shows
 * the plain status rather than guess.
 */
export function OpportunityStatusBadge({ opportunity, competitions }: { opportunity: Opportunity; competitions: readonly Competition[] | undefined }) {
  if (competitions && publishedNotTaking(opportunity, competitions)) {
    return (
      <span className="bdg bdg-warn">
        <CirclePause className="ic" aria-hidden="true" />
        {NOT_TAKING_LABEL}
      </span>
    );
  }
  return <StatusBadge kind="opportunity" status={opportunity.status} label={opportunity.published ? undefined : "Draft"} />;
}
