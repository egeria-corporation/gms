// SPDX-License-Identifier: AGPL-3.0-only
// Presence passes for live co-editing (docs/co-editing.md). The editors' live channel is a private
// Supabase Realtime channel; Realtime admits a session to it only while that session holds a pass
// for the draft (migration 0050, policies on realtime.messages). This is where a pass is issued,
// and it is issued by the same check that decides who may open the draft: `access()` for a
// built-in application (the applicant's own team and the consultants it names; never the funder,
// whose side sees an application only once it is submitted, and never a reviewer) and
// `loadOutside()` for an outside application (the team and the cowriter invited into it). So the
// channel has the reach reading has, no more.
//
// A pass is for one person's browser session (the token's `session_id`), never an agent or an API
// client: the channel tells people who else is writing. It carries no answer text; answers are read
// through the API, which checks again on every read.
import { z } from "zod";
import { forbidden } from "../auth/verify.ts";
import { ApiError, notFound } from "../lib/errors.ts";
import { bareUuid, uuidOf } from "../lib/ids.ts";
import { parse } from "../lib/input.ts";
import { access } from "./apply.ts";
import { guardWrite, type BaseContext, type ServiceContext } from "./context.ts";
import { loadOutside } from "./outside.ts";
import { RepoError } from "./repos/types.ts";

/** How long a pass opens the channel. The editor renews it well before (`PRESENCE_PASS_RENEW_MS`); the database caps any pass at 30 minutes. */
export const PRESENCE_PASS_TTL_MS = 10 * 60_000;
/** When the editor asks again: each renewal runs the access check again, so a person removed from the draft is let go within this. */
export const PRESENCE_PASS_RENEW_MS = 4 * 60_000;
/** The built-in application states the editor opens for writing; a submitted application has no live channel. */
export const PRESENCE_APPLICATION_STATUSES: readonly string[] = ["draft", "revision_requested"];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const presencePassInput = z
  .object({ draft: z.object({ kind: z.enum(["application", "outside_application"]), id: z.string().trim().min(1).max(100) }).strict() })
  .strict();

export interface PresencePass {
  /** The private channel to join: `draft:application:<uuid>` or `draft:outside:<uuid>`. */
  topic: string;
  expiresAt: string;
  /** Ask again after this many seconds while the editor stays open. */
  renewAfterSeconds: number;
  /** The session may write answers here, so it may send soft locks and saved nudges. */
  canWrite: boolean;
}

/**
 * A pass to the draft's live channel for the signed-in person's session. 403 `person_required` for
 * an agent or an API client; 404 for a draft the caller may not open (another workspace's, a funder
 * or reviewer asking for an applicant's draft, a consultant it does not name); 409 `not_a_draft` once
 * a built-in application has been submitted; 403 `session_required` for a sign-in without a session.
 */
export async function issuePresencePass(ctx: ServiceContext, session: { sessionId: string | null | undefined }, body: unknown): Promise<PresencePass> {
  if (ctx.actor.kind !== "user" || !ctx.actor.userId) throw forbidden("person_required", "Seeing who else is writing is for people signed in to the GMS, not agents or API clients");
  const input = parse(presencePassInput, body);
  let workspaceId: string;
  let topic: string;
  let canWrite: boolean;
  if (input.draft.kind === "application") {
    const { app, side, ws } = await access(ctx, uuidOf("application", input.draft.id, "Application"), "applications:read");
    if (side !== "applicant") throw notFound("Application");
    if (!PRESENCE_APPLICATION_STATUSES.includes(app.status)) throw new ApiError(409, "not_a_draft", "This application has been submitted; there is no draft to write together");
    workspaceId = ws.id;
    topic = `draft:application:${app.id}`;
    canWrite = ctx.scopes.includes("applications:write");
  } else {
    const { ws, row } = await loadOutside(ctx, bareUuid(input.draft.id, "Outside application"), "applications:read", { cowriter: true });
    workspaceId = ws.id;
    topic = `draft:outside:${row.id}`;
    canWrite = ctx.scopes.includes("applications:write") && !row.archived_at;
  }
  const sessionId = session.sessionId ?? "";
  if (!UUID.test(sessionId)) throw forbidden("session_required", "Sign in again to see who else is writing");

  const now = ctx.now();
  const expiresAt = new Date(now.getTime() + PRESENCE_PASS_TTL_MS).toISOString();
  const passes = ctx.repos.table("presence_passes");
  const userId = ctx.actor.userId;
  // This person's expired passes open nothing; they go now, which keeps the table to live passes.
  const mine = await passes.find({ user_id: userId });
  const stale = mine.filter((p) => Date.parse(p.expires_at) <= now.getTime()).map((p) => p.id);
  if (stale.length) await passes.remove({ id: stale });
  const renew = () => passes.update({ user_id: userId, session_id: sessionId.toLowerCase(), topic }, { expires_at: expiresAt, can_write: canWrite, workspace_id: workspaceId });
  const existing = mine.find((p) => p.session_id === sessionId.toLowerCase() && p.topic === topic && !stale.includes(p.id));
  await guardWrite("Presence pass", async () => {
    if (existing) return void (await renew());
    try {
      await passes.insert({ workspace_id: workspaceId, user_id: userId, session_id: sessionId.toLowerCase(), topic, can_write: canWrite, expires_at: expiresAt });
    } catch (e) {
      // Two tabs of the same session asked at once: the pass the other one wrote is renewed instead.
      if (!(e instanceof RepoError && e.kind === "conflict")) throw e;
      await renew();
    }
  });
  return { topic, expiresAt, renewAfterSeconds: PRESENCE_PASS_RENEW_MS / 1000, canWrite };
}

/** Expired passes removed by the nightly sweep, at most this many a night (the API clears a person's own whenever it issues one). */
export const PRESENCE_SWEEP_MAX = 5_000;

/**
 * The nightly sweep (jobs: presence-sweep): remove every pass that has expired. An expired pass
 * already admits no one (migration 0050 checks `expires_at`); this only keeps the table small.
 */
export async function sweepPresencePasses(base: BaseContext): Promise<{ removed: number }> {
  const now = base.now().getTime();
  const passes = base.repos.table("presence_passes");
  const stale = (await passes.find({}, { orderBy: "expires_at", limit: PRESENCE_SWEEP_MAX })).filter((p) => Date.parse(p.expires_at) <= now).map((p) => p.id);
  for (let i = 0; i < stale.length; i += 200) await passes.remove({ id: stale.slice(i, i + 200) });
  return { removed: stale.length };
}
