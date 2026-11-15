// SPDX-License-Identifier: AGPL-3.0-only
// The seam between social posting (./social.ts) and award sharing (./award-sharing.ts): an award is
// offered for posting only when award sharing's one public rule says it may be public (not
// confidential, to an organization, accepted or later, the funder lists awards, the grantee has not
// hidden it), and its posts, link and card come from award sharing's share kit, built from the
// award's public fields only. Social posting calls nothing else of award sharing's.
import { awardIsPubliclyListable, shareKit as awardShareKit } from "./award-sharing.ts";
import type { ServiceContext } from "./context.ts";
import type { Row } from "./repos/types.ts";

export type ShareAudience = "grantee" | "funder";

/** The share kit as the composer uses it: ready-to-edit posts, the award's public page and its card. */
export interface ShareKit {
  posts: { kind: "linkedin" | "short" | "newsletter"; label: string; text: string }[];
  /** The award's public page. */
  link: string;
  /** The award's share card (a public PNG), or null. */
  imageUrl: string | null;
}

/** Whether an award may appear on any public surface (award sharing's `isPubliclyListable`). */
export function isPubliclyListable(ctx: ServiceContext, award: Row<"awards">): Promise<boolean> {
  return awardIsPubliclyListable(ctx, award.id);
}

/** The share kit for an award that is publicly listable, from the side asking; null otherwise. */
export async function shareKit(ctx: ServiceContext, awardId: string, audience: ShareAudience): Promise<ShareKit | null> {
  const kit = await awardShareKit(ctx, awardId, audience);
  if (!kit) return null;
  return {
    posts: [
      { kind: "linkedin", label: "LinkedIn post", text: kit.posts.linkedin },
      { kind: "short", label: "Short post", text: kit.posts.short },
      { kind: "newsletter", label: "Newsletter paragraph", text: kit.posts.newsletter },
    ],
    link: kit.links.page,
    imageUrl: kit.links.image,
  };
}
