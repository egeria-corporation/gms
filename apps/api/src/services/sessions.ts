// SPDX-License-Identifier: AGPL-3.0-only
// A person's own sign-in sessions (Account settings). Supabase Auth owns the sessions; the GMS
// reads and ends them through two database functions that only ever touch the named person's rows
// (supabase/migrations/0015_launch_prep.sql). No workspace is involved: these are about the person.
import { ApiError, notFound } from "../lib/errors.ts";
import { audit, authorize, type ServiceContext } from "./context.ts";

export interface AuthSession {
  id: string;
  createdAt: string;
  lastActiveAt: string | null;
  userAgent: string | null;
  ip: string | null;
  /** `aal2` when the session passed two-step verification. */
  aal: string | null;
}

export interface SessionsPort {
  list(userId: string): Promise<AuthSession[]>;
  /** True when a session of that person was ended. */
  end(userId: string, sessionId: string): Promise<boolean>;
}

/** "Chrome on macOS" from a user-agent string; null when nothing is recognizable. */
export function describeDevice(userAgent: string | null): string | null {
  if (!userAgent) return null;
  const browser = /Edg\//.test(userAgent) ? "Edge" : /Firefox\//.test(userAgent) ? "Firefox" : /Chrome\//.test(userAgent) ? "Chrome" : /Safari\//.test(userAgent) ? "Safari" : null;
  const os = /iPhone|iPad/.test(userAgent) ? "iOS" : /Android/.test(userAgent) ? "Android" : /Mac OS X/.test(userAgent) ? "macOS" : /Windows/.test(userAgent) ? "Windows" : /Linux/.test(userAgent) ? "Linux" : null;
  return browser && os ? `${browser} on ${os}` : (browser ?? os);
}

const unavailable = () => new ApiError(501, "sessions_unavailable", "Session management is not available on this server");

/** The caller's own sessions, newest activity first. `current` marks the one making this request. */
export async function listMySessions(ctx: ServiceContext, currentSessionId: string | null) {
  await authorize(ctx, { person: true });
  if (!ctx.ports.sessions) throw unavailable();
  const rows = await ctx.ports.sessions.list(ctx.actor.userId!);
  return rows.map((s) => ({ id: s.id, createdAt: s.createdAt, lastActiveAt: s.lastActiveAt, userAgent: s.userAgent, device: describeDevice(s.userAgent), ip: s.ip, aal: s.aal, mfa: s.aal === "aal2", current: s.id === currentSessionId }));
}

/** End one of the caller's other sessions. The current one ends by signing out. */
export async function endMySession(ctx: ServiceContext, sessionId: string, currentSessionId: string | null) {
  await authorize(ctx, { person: true });
  if (!ctx.ports.sessions) throw unavailable();
  if (sessionId === currentSessionId) throw new ApiError(409, "current_session", "This is the session you are using. Sign out to end it");
  // Another person's session is indistinguishable from one that does not exist.
  if (!(await ctx.ports.sessions.end(ctx.actor.userId!, sessionId))) throw notFound("Session");
  await audit(ctx, "session.ended", "user", ctx.actor.userId!, { sessionId });
  return { ended: true, id: sessionId };
}
