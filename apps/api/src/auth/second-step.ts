// SPDX-License-Identifier: AGPL-3.0-only
// The one rule for "has this session passed a second step?". Every check in the API goes through
// `secondStepVerified`; nothing compares `aal` on its own.
//
// A session has passed when
//   - Supabase Auth says so (`aal2`: the person verified this app's authenticator), or
//   - it signed in through Passport, Passport reported its own authenticator (`acr: aal2`), and
//     this session claimed that with the one-time sign-in token (services/passport-signin.ts).
//     The owner decided on 2026-11-11 that Passport's authenticator is enough.
import type { Context } from "hono";
import type { AppEnv } from "../app.ts";
import type { SessionUser } from "./session.ts";

export async function secondStepVerified(c: Context<AppEnv>, user: SessionUser): Promise<boolean> {
  if (user.aal === "aal2") return true;
  // Asked at most once per request, and only when a check actually needs the answer.
  if (user.passportStep !== undefined) return user.passportStep;
  const deps = c.get("deps");
  const store = deps.ports?.(c.env).secondSteps;
  let passed = false;
  if (store && user.sessionId) {
    try {
      passed = await store.verified(user.userId, user.sessionId, deps.now());
    } catch {
      // Unreadable is "not verified": the person is asked for this app's own second step.
      passed = false;
    }
  }
  user.passportStep = passed;
  return passed;
}
