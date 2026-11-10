// SPDX-License-Identifier: AGPL-3.0-only
// Reminder plans for requirements (build spec §10.8). Offsets are whole days relative to the due
// date: negative before, zero on the day, positive after. Each (requirement, offset) sends once.

export const DEFAULT_REMINDER_PLAN: readonly number[] = [-30, -14, -7, 0, 3, 14];

const DAY_MS = 86_400_000;
const MAX_OFFSET_DAYS = 365;

/** Requirement statuses that still owe something; nothing is sent once it is submitted or waived. */
const REMINDABLE = new Set(["scheduled", "due", "overdue", "returned"]);

export class ReminderPlanError extends Error {}

/** Validates an edited plan: whole days within a year, de-duplicated and sorted. */
export function normalizePlan(plan: readonly number[] | null | undefined): number[] {
  if (plan === null || plan === undefined) return [...DEFAULT_REMINDER_PLAN];
  for (const offset of plan) {
    if (!Number.isInteger(offset) || Math.abs(offset) > MAX_OFFSET_DAYS) throw new ReminderPlanError(`Reminder offsets are whole days within ±${MAX_OFFSET_DAYS}; got ${String(offset)}.`);
  }
  return [...new Set(plan.map((o) => o + 0))].sort((a, b) => a - b);
}

export interface RemindableRequirement {
  id: string;
  dueAt: string | Date;
  status: string;
  graceDays?: number;
  /** Per-requirement plan; falls back to the program plan, then the default. */
  reminderPlan?: readonly number[] | null;
}

export interface ScheduledReminder {
  requirementId: string;
  offsetDays: number;
  sendAt: Date;
  /** Stable across job retries: the idempotency key for the send and the ledger. */
  idempotencyKey: string;
}

export function reminderKey(requirementId: string, offsetDays: number): string {
  return `reminder:${requirementId}:${offsetDays}`;
}

export function scheduleReminders(requirement: RemindableRequirement, programPlan?: readonly number[] | null): ScheduledReminder[] {
  const due = new Date(requirement.dueAt);
  if (Number.isNaN(due.getTime())) throw new ReminderPlanError(`Requirement ${requirement.id} has no valid due date.`);
  return normalizePlan(requirement.reminderPlan ?? programPlan).map((offsetDays) => ({
    requirementId: requirement.id,
    offsetDays,
    sendAt: new Date(due.getTime() + offsetDays * DAY_MS),
    idempotencyKey: reminderKey(requirement.id, offsetDays),
  }));
}

export interface DueReminders {
  /** The one reminder to send now: the latest whose time has come. */
  send: ScheduledReminder | null;
  /** Earlier reminders whose time also passed unsent (job outage, late-created requirement). They
   * are marked sent without an email so a grantee never receives a burst. */
  skip: ScheduledReminder[];
}

/** Which reminders are due at `now`, given the keys already sent or skipped. */
export function dueReminders(requirement: RemindableRequirement, now: Date, sentKeys: ReadonlySet<string>, programPlan?: readonly number[] | null): DueReminders {
  if (!REMINDABLE.has(requirement.status)) return { send: null, skip: [] };
  const graceDays = requirement.graceDays ?? 0;
  const pending = scheduleReminders(requirement, programPlan)
    // Overdue notices respect the grace period.
    .filter((r) => (r.offsetDays > 0 ? r.sendAt.getTime() + graceDays * DAY_MS <= now.getTime() : r.sendAt.getTime() <= now.getTime()))
    .filter((r) => !sentKeys.has(r.idempotencyKey));
  if (pending.length === 0) return { send: null, skip: [] };
  return { send: pending[pending.length - 1]!, skip: pending.slice(0, -1) };
}

/** Records which (requirement, offset) pairs were handled. `claim` must be atomic (a unique key). */
export interface ReminderLog {
  sentKeys(requirementId: string): Promise<ReadonlySet<string>>;
  /** Returns false when the key was already claimed. */
  claim(key: string, outcome: "sending" | "skipped"): Promise<boolean>;
  markSent(key: string, messageId: string): Promise<void>;
  /** Releases a claim after a failed send so the next run retries it. */
  release(key: string): Promise<void>;
}

export class MemoryReminderLog implements ReminderLog {
  readonly rows = new Map<string, { outcome: string; messageId?: string }>();
  async sentKeys(requirementId: string): Promise<ReadonlySet<string>> {
    return new Set([...this.rows.keys()].filter((k) => k.startsWith(`reminder:${requirementId}:`)));
  }
  async claim(key: string, outcome: "sending" | "skipped"): Promise<boolean> {
    if (this.rows.has(key)) return false;
    this.rows.set(key, { outcome });
    return true;
  }
  async markSent(key: string, messageId: string): Promise<void> {
    this.rows.set(key, { outcome: "sent", messageId });
  }
  async release(key: string): Promise<void> {
    this.rows.delete(key);
  }
}

export interface ReminderRunResult {
  requirementId: string;
  sent: { offsetDays: number; messageId: string } | null;
  skipped: number[];
}

/** Sends what is due for one requirement. Safe to run twice: the claim and the provider-side
 * idempotency key both stop a second email. */
export async function runReminders(
  requirement: RemindableRequirement,
  deps: {
    log: ReminderLog;
    now: Date;
    programPlan?: readonly number[] | null;
    /** Renders and sends the email; must pass `idempotencyKey` to the mailer. Returns the message id. */
    send: (reminder: ScheduledReminder) => Promise<string>;
    onSent?: (reminder: ScheduledReminder, messageId: string) => Promise<void>;
  },
): Promise<ReminderRunResult> {
  const { send, skip } = dueReminders(requirement, deps.now, await deps.log.sentKeys(requirement.id), deps.programPlan);
  const skipped: number[] = [];
  for (const r of skip) if (await deps.log.claim(r.idempotencyKey, "skipped")) skipped.push(r.offsetDays);
  if (!send || !(await deps.log.claim(send.idempotencyKey, "sending"))) return { requirementId: requirement.id, sent: null, skipped };
  let messageId: string;
  try {
    messageId = await deps.send(send);
  } catch (e) {
    await deps.log.release(send.idempotencyKey);
    throw e;
  }
  await deps.log.markSent(send.idempotencyKey, messageId);
  await deps.onSent?.(send, messageId);
  return { requirementId: requirement.id, sent: { offsetDays: send.offsetDays, messageId }, skipped };
}
