// SPDX-License-Identifier: AGPL-3.0-only
// Whether a published open date is still ahead. The open day itself counts as open. Compared as
// calendar days in UTC, the same way the API decides `acceptingApplications`.

/** True when `value` is a date after `now`'s UTC calendar day. A missing or unreadable value is not ahead. */
export function isAfterToday(value: string | null | undefined, now: Date): boolean {
  if (!value) return false;
  const day = /^(\d{4}-\d{2}-\d{2})/.exec(value)?.[1];
  if (!day) return false;
  return day > now.toISOString().slice(0, 10);
}

/** The first stage that takes a submission, else the first stage, and its open instant. */
export function firstSubmissionOpens(stages: readonly { opens?: string | null; requiresSubmission?: boolean }[] | null | undefined): string | null {
  if (!stages?.length) return null;
  const first = stages.find((s) => s.requiresSubmission === true) ?? stages[0];
  return typeof first?.opens === "string" && first.opens ? first.opens : null;
}
