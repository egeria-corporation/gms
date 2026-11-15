// SPDX-License-Identifier: AGPL-3.0-only
// The opt-in content digests (new matches, deadlines, funder activity) on the jobs Worker's one
// cron tick: Mondays at 15:10 UTC, five minutes after `digest-weekly`. The work itself is
// `sendContentDigests` in the API's service layer (apps/api/src/services/content-digests.ts), so
// the Monday email reads exactly what the person would see in the app.
import { CONTENT_DIGEST_SCHEDULE, RestOpenGrantsClient, sendContentDigests, type BaseContext } from "@gms/api/jobs";

export const CONTENT_DIGESTS_JOB = "content-digests" as const;

/** True at the one tick of the week the content digests go out. */
export function contentDigestsDue(at: Date): boolean {
  const { weekday, hour, minute } = CONTENT_DIGEST_SCHEDULE;
  return at.getUTCDay() === weekday && at.getUTCHours() === hour && at.getUTCMinutes() === minute;
}

/** New matches ask OpenGrants through the same REST client and key as the API Worker; without a key, matches come from this site only. */
export function openGrantsPort(env: { OPENGRANTS_API_KEY?: string; OPENGRANTS_API_URL?: string }): { openGrants?: RestOpenGrantsClient } {
  return env.OPENGRANTS_API_KEY ? { openGrants: new RestOpenGrantsClient(env.OPENGRANTS_API_URL ?? "https://ops.opengrants.io/functions/v1", env.OPENGRANTS_API_KEY) } : {};
}

export async function runContentDigests(base: BaseContext): Promise<Record<string, unknown>> {
  return { ...(await sendContentDigests(base)) };
}
