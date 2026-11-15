// SPDX-License-Identifier: AGPL-3.0-only
// The template gallery's moderation (v1.8.0). A workspace admin submits a form, rubric or email
// template; an operator approves or declines it with a reason; the author can withdraw it, before
// or after it is published. Nothing is public until it is approved. The service runs every move as
// guard → write → ledger; this module is the guard. No webhook: a gallery item is not a record any
// subscriber follows (`GALLERY_WEBHOOK_EVENTS`, one place to add one later).

export const GALLERY_SUBMISSION_STATUSES = ["pending", "approved", "rejected", "withdrawn"] as const;
export type GallerySubmissionStatus = (typeof GALLERY_SUBMISSION_STATUSES)[number];
/** A gallery item exists only once its submission is approved; withdrawing it takes it down. */
export const GALLERY_ITEM_STATUSES = ["approved", "withdrawn"] as const;
export type GalleryItemStatus = (typeof GALLERY_ITEM_STATUSES)[number];

export const GALLERY_ACTIONS = ["approve", "reject", "withdraw"] as const;
export type GalleryAction = (typeof GALLERY_ACTIONS)[number];
/** Who moves a submission: the author's workspace admin, or one of the gallery's moderators. */
export type GalleryActor = "author" | "moderator";

/** A declined submission says why, in at least this many characters and at most the second. */
export const GALLERY_REASON_MIN = 3;
export const GALLERY_REASON_MAX = 2000;

/** Webhook event types for the gallery: none in this release. */
export const GALLERY_WEBHOOK_EVENTS: readonly string[] = [];

interface Rule {
  from: readonly GallerySubmissionStatus[];
  to: GallerySubmissionStatus;
  by: GalleryActor;
  /** The ledger event, written in the author's workspace (`gallery.<event>`). */
  event: string;
}

export const GALLERY_RULES: Readonly<Record<GalleryAction, Rule>> = {
  approve: { from: ["pending"], to: "approved", by: "moderator", event: "gallery.item_approved" },
  reject: { from: ["pending"], to: "rejected", by: "moderator", event: "gallery.item_declined" },
  withdraw: { from: ["pending", "approved"], to: "withdrawn", by: "author", event: "gallery.item_withdrawn" },
};

/** The ledger event of a new submission (in the author's workspace). */
export const GALLERY_SUBMITTED_EVENT = "gallery.submitted";

export type GalleryMove =
  | { ok: true; from: GallerySubmissionStatus; to: GallerySubmissionStatus; event: string; reason: string | null }
  | { ok: false; code: "unknown_action" | "invalid_from" | "actor_not_allowed" | "guard_failed"; reason: string };

const isStatus = (s: unknown): s is GallerySubmissionStatus => typeof s === "string" && (GALLERY_SUBMISSION_STATUSES as readonly string[]).includes(s);
const said = (s: string) => (s === "rejected" ? "declined" : s);

/**
 * Whether `action` may move a submission that is `from`, by `by`. A decline needs a reason, which
 * comes back trimmed; the other moves carry none.
 */
export function galleryMove(from: string, action: string, by: GalleryActor, input: { reason?: string | null } = {}): GalleryMove {
  const rule = GALLERY_RULES[action as GalleryAction] as Rule | undefined;
  if (!rule) return { ok: false, code: "unknown_action", reason: `Unknown gallery action "${action}".` };
  if (!isStatus(from)) return { ok: false, code: "invalid_from", reason: `Unknown submission status "${String(from)}".` };
  if (rule.by !== by) return { ok: false, code: "actor_not_allowed", reason: rule.by === "moderator" ? "Only a gallery moderator can do that." : "Only the workspace that shared it can withdraw it." };
  if (!rule.from.includes(from)) {
    return { ok: false, code: "invalid_from", reason: from === "pending" ? "This submission is waiting for review." : `This submission is ${said(from)}; it can no longer be ${action === "withdraw" ? "withdrawn" : action === "approve" ? "approved" : "declined"}.` };
  }
  if (action === "reject") {
    const reason = (input.reason ?? "").trim();
    if (reason.length < GALLERY_REASON_MIN) return { ok: false, code: "guard_failed", reason: "Say why it is declined, so the author can fix it." };
    if (reason.length > GALLERY_REASON_MAX) return { ok: false, code: "guard_failed", reason: `Keep the reason under ${GALLERY_REASON_MAX} characters.` };
    return { ok: true, from, to: rule.to, event: rule.event, reason };
  }
  return { ok: true, from, to: rule.to, event: rule.event, reason: null };
}

/** The item status that goes with a submission status, or null while there is no item. */
export function galleryItemStatusFor(submission: GallerySubmissionStatus, hadItem: boolean): GalleryItemStatus | null {
  if (submission === "approved") return "approved";
  if (submission === "withdrawn" && hadItem) return "withdrawn";
  return null;
}
