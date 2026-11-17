// SPDX-License-Identifier: AGPL-3.0-only
// Test helper: reviewers who have signed a competition's conflict-of-interest policy (review
// parity). Since v1.8.0 nothing in a competition opens for a reviewer before they sign; tests about
// something else start from signed reviewers. Written straight to the repositories, as the API's
// service role would after a reviewer signed.
import { DEFAULT_COI_POLICY } from "@gms/review";
import type { Harness } from "./helpers.ts";

export async function signCoiPolicy(h: Pick<Harness, "repos">, workspaceId: string, competitionId: string, userIds: readonly string[]): Promise<void> {
  const [latest] = await h.repos.table("coi_policies").find({ competition_id: competitionId }, { orderBy: "version", ascending: false, limit: 1 });
  const version = latest?.version ?? (await h.repos.table("coi_policies").insert({ workspace_id: workspaceId, competition_id: competitionId, version: 1, policy_text: DEFAULT_COI_POLICY, is_default: true })).version;
  for (const userId of userIds) {
    if (await h.repos.table("coi_signatures").one({ competition_id: competitionId, reviewer_user_id: userId, policy_version: version })) continue;
    await h.repos.table("coi_signatures").insert({ workspace_id: workspaceId, competition_id: competitionId, reviewer_user_id: userId, policy_version: version, signed_name: "Signed Reviewer" });
  }
}
