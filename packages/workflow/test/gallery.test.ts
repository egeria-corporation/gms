// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { GALLERY_REASON_MAX, GALLERY_RULES, GALLERY_SUBMISSION_STATUSES, galleryItemStatusFor, galleryMove } from "../src/index.ts";

describe("gallery moderation", () => {
  it("a moderator approves or declines a pending submission; nothing else", () => {
    expect(galleryMove("pending", "approve", "moderator")).toMatchObject({ ok: true, to: "approved", event: "gallery.item_approved" });
    expect(galleryMove("pending", "reject", "moderator", { reason: "  It names a real person.  " })).toMatchObject({ ok: true, to: "rejected", reason: "It names a real person." });
    expect(galleryMove("approved", "approve", "moderator")).toMatchObject({ ok: false, code: "invalid_from" });
    expect(galleryMove("rejected", "approve", "moderator")).toMatchObject({ ok: false, code: "invalid_from" });
    expect(galleryMove("withdrawn", "reject", "moderator", { reason: "late" })).toMatchObject({ ok: false, code: "invalid_from" });
  });

  it("only a moderator moderates, and only the author withdraws", () => {
    expect(galleryMove("pending", "approve", "author")).toMatchObject({ ok: false, code: "actor_not_allowed" });
    expect(galleryMove("pending", "reject", "author", { reason: "mine" })).toMatchObject({ ok: false, code: "actor_not_allowed" });
    expect(galleryMove("pending", "withdraw", "moderator")).toMatchObject({ ok: false, code: "actor_not_allowed" });
  });

  it("a decline needs a reason the author can act on", () => {
    expect(galleryMove("pending", "reject", "moderator")).toMatchObject({ ok: false, code: "guard_failed" });
    expect(galleryMove("pending", "reject", "moderator", { reason: "  " })).toMatchObject({ ok: false, code: "guard_failed" });
    expect(galleryMove("pending", "reject", "moderator", { reason: "x".repeat(GALLERY_REASON_MAX + 1) })).toMatchObject({ ok: false, code: "guard_failed" });
  });

  it("the author withdraws a pending or a published item, once", () => {
    expect(galleryMove("pending", "withdraw", "author")).toMatchObject({ ok: true, to: "withdrawn", event: "gallery.item_withdrawn" });
    expect(galleryMove("approved", "withdraw", "author")).toMatchObject({ ok: true, to: "withdrawn" });
    expect(galleryMove("withdrawn", "withdraw", "author")).toMatchObject({ ok: false, code: "invalid_from" });
    expect(galleryMove("rejected", "withdraw", "author")).toMatchObject({ ok: false, code: "invalid_from" });
  });

  it("refuses unknown actions and statuses", () => {
    expect(galleryMove("pending", "publish", "moderator")).toMatchObject({ ok: false, code: "unknown_action" });
    expect(galleryMove("draft", "approve", "moderator")).toMatchObject({ ok: false, code: "invalid_from" });
  });

  it("every rule moves between known statuses, and the item follows its submission", () => {
    for (const r of Object.values(GALLERY_RULES)) for (const s of [...r.from, r.to]) expect(GALLERY_SUBMISSION_STATUSES).toContain(s);
    expect(galleryItemStatusFor("approved", false)).toBe("approved");
    expect(galleryItemStatusFor("withdrawn", true)).toBe("withdrawn");
    expect(galleryItemStatusFor("withdrawn", false)).toBeNull();
    expect(galleryItemStatusFor("pending", false)).toBeNull();
    expect(galleryItemStatusFor("rejected", false)).toBeNull();
  });
});
