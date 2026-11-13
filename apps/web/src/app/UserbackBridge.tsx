// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useRef } from "react";
import { env } from "../env.ts";
import { createUserback, type FeedbackUser } from "../lib/userback.ts";
import { useServices } from "./services.tsx";

/**
 * Starts the Userback widget once the session state is known and tells it who signed in or out.
 * Renders nothing, and does nothing unless a token is configured outside mock mode.
 */
export function UserbackBridge() {
  const { sessionState, meState } = useServices();
  const widget = useRef<ReturnType<typeof createUserback> | undefined>(undefined);
  if (widget.current === undefined) widget.current = createUserback({ token: env.userbackToken, useMocks: env.useMocks });

  const signedIn = sessionState.status === "signedIn" ? sessionState.session : null;
  const displayName = meState.status === "ready" ? meState.me.displayName : null;
  // Wait until the person's name is known (or could not be fetched) before the first load.
  const ready = sessionState.status === "signedOut" || (signedIn !== null && meState.status !== "loading");
  const userId = signedIn?.userId ?? null;
  const email = signedIn?.email ?? "";

  useEffect(() => {
    if (!ready) return;
    const user: FeedbackUser | null = userId ? { id: userId, email, name: displayName?.trim() || email.split("@")[0] || email } : null;
    widget.current?.sync(user);
  }, [ready, userId, email, displayName]);
  return null;
}
