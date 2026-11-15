// SPDX-License-Identifier: AGPL-3.0-only
// The seam between social posting (./social.ts) and award sharing (C1, ./award-sharing.ts).
//
// Until the integrator wires C1's service here, no award is offered for posting: an award is shown
// publicly only when C1 says so (not confidential, the funder lists awards, the grantee has not
// hidden it, an organization, accepted or later), and this stub says no. To wire it, replace the
// two bodies below with:
//
//   export { isPubliclyListable, shareKit } from "./award-sharing.ts";
//
// adapting the signatures if C1's differ. Social posting calls nothing else of C1's.
import type { ServiceContext } from "./context.ts";
import type { Row } from "./repos/types.ts";

export type ShareAudience = "grantee" | "funder";

/** What C1's share kit gives: ready-to-edit posts from the award's public fields only, its page and its card. */
export interface ShareKit {
  posts: { kind: "linkedin" | "short" | "newsletter"; label: string; text: string }[];
  /** The award's public page. */
  link: string;
  /** The award's share card (a public PNG), or null. */
  imageUrl: string | null;
}

/** Whether an award may appear on any public surface. The stub: never, until C1 is wired. */
export async function isPubliclyListable(_ctx: ServiceContext, _award: Row<"awards">): Promise<boolean> {
  return false;
}

/** The share kit for an award that is publicly listable. The stub: none. */
export async function shareKit(_ctx: ServiceContext, _awardId: string, _audience: ShareAudience): Promise<ShareKit | null> {
  return null;
}
