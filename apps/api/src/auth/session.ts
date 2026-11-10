// SPDX-License-Identifier: AGPL-3.0-only
// Supabase Auth sessions. The web app sends the Supabase access token as a bearer; it is an HS256
// JWT signed with the project's JWT secret, audience `authenticated`. `aal` says whether the
// session passed TOTP (aal2).
import { jwtVerify } from "jose";
import { authError } from "./verify.ts";

export interface SessionUser {
  userId: string;
  email: string | null;
  aal: "aal1" | "aal2";
}

export async function verifySupabaseSession(token: string, jwtSecret: string | undefined, now: Date): Promise<SessionUser> {
  if (!jwtSecret) throw authError("sessions_unavailable", "Session sign-in is not configured on this server");
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(jwtSecret), { algorithms: ["HS256"], audience: "authenticated", currentDate: now, clockTolerance: 60 });
    if (typeof payload.sub !== "string" || !payload.sub) throw new Error("sub");
    return { userId: payload.sub, email: typeof payload.email === "string" ? payload.email : null, aal: payload.aal === "aal2" ? "aal2" : "aal1" };
  } catch {
    throw authError("invalid_session", "Session is invalid or has expired");
  }
}
