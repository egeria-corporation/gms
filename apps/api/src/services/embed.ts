// SPDX-License-Identifier: AGPL-3.0-only
// The embeddable apply widget (`/embed/f/{handle}/o/{slug}` in the web app) and the funder's
// "Powered by" setting. Public reads only: the widget shows what the opportunity's public page
// shows, in fewer words, so it is built on `opportunityPage` and adds nothing that page hides.
import type { Row } from "./repos/types.ts";
import { opportunityPage, type PublicContext } from "./public.ts";

/** How many eligibility labels the widget lists before it says "and N more". */
export const EMBED_ELIGIBILITY_LIMIT = 3;

/**
 * Whether the funder's public pages, widget and application receipt email carry "Powered by
 * OpenGrants Grant Management System". On unless an admin turned it off (`settings.poweredBy`).
 */
export const poweredByOf = (w: Pick<Row<"workspaces">, "settings">): boolean => (w.settings as { poweredBy?: unknown } | null)?.poweredBy !== false;

/** Data for the widget: the call, its funder, whether it is taking applications, and the setting. */
export async function embedWidget(ctx: PublicContext, handle: string, slug: string) {
  // 404 for anything the public page would not show (unpublished, unlisted, inactive funder).
  const page = await opportunityPage(ctx, handle, slug);
  const w = (await ctx.repos.table("workspaces").one({ handle, kind: "funder" }))!;
  const o = page.opportunity;
  const keyDates = (o.keyDates ?? {}) as { closeDate?: { name?: string; date?: string }; postDate?: { date?: string } };
  return {
    funder: {
      handle: page.funder.handle,
      name: page.funder.name,
      brand: page.funder.brand,
      // A self-declared funder is never presented as verified.
      verified: page.funder.verification.source === "passport",
    },
    opportunity: {
      slug: o.slug,
      title: o.title,
      status: o.status,
      closeDate: keyDates.closeDate?.date ? { name: keyDates.closeDate.name ?? "Closes", date: keyDates.closeDate.date } : null,
      opensDate: keyDates.postDate?.date ?? null,
      acceptedApplicantTypes: o.acceptedApplicantTypes,
      eligibility: o.eligibility.slice(0, EMBED_ELIGIBILITY_LIMIT),
      moreEligibility: Math.max(0, o.eligibility.length - EMBED_ELIGIBILITY_LIMIT),
    },
    // The same test as the public page's Apply button: an open opportunity with an open competition.
    acceptingApplications: o.status === "open" && page.competitions.some((c) => c.status === "open"),
    poweredBy: poweredByOf(w),
    links: { page: page.links.page },
  };
}
