// SPDX-License-Identifier: AGPL-3.0-only
// The Userback feedback widget. Off unless VITE_USERBACK_TOKEN (Userback's public access token) is
// set at build time, and never in mock mode. The only person data sent is user id, name and email.
// Elements with the class `userback-block` are left out of screenshots and replays, and typing in
// elements with `userback-ignore` is not recorded (see the privacy markers on secrets, sign-in
// codes and payout facts).

export const USERBACK_SCRIPT = "https://static.userback.io/widget/v1.js";
export const USERBACK_SCRIPT_ID = "userback-widget";

/** The disclosure sentence, shown on the landing page only when the widget is active. */
export const USERBACK_DISCLOSURE =
  "If you use the Feedback button, your note and a screenshot of the page go to Userback, the tool we use to collect feedback; sign-in codes, security keys and bank details are left out of screenshots.";

export interface FeedbackUser {
  id: string;
  name: string;
  email: string;
}

interface UserbackApi {
  access_token: string;
  user_data?: { id: string; info: { name: string; email: string } };
  identify?: (id: string, info: { name: string; email: string }) => void;
  destroy?: () => void;
}
type UserbackWindow = { Userback?: UserbackApi };

/** The widget loads only with a token and outside mock mode. */
export const userbackActive = (cfg: { token: string; useMocks: boolean }): boolean => cfg.token.trim() !== "" && !cfg.useMocks;

/** The landing page answer, with the disclosure appended only when the widget is active. */
export const whoCanSeeAnswer = (active: boolean): string =>
  `Only funders you apply to or accept an award from.${active ? ` ${USERBACK_DISCLOSURE}` : ""}`;

const userData = (u: FeedbackUser) => ({ id: u.id, info: { name: u.name, email: u.email } });

/**
 * Starts the widget once and keeps it in step with who is signed in. `sync(user)` is called with
 * the person (or null) whenever that is known or changes. Returns null when the widget is off.
 */
export function createUserback(
  cfg: { token: string; useMocks: boolean },
  win: Window & UserbackWindow = window,
  doc: Document = document,
): { sync(user: FeedbackUser | null): void } | null {
  if (!userbackActive(cfg)) return null;
  const token = cfg.token.trim();
  let started = false;
  let currentId: string | null = null;

  const load = (user: FeedbackUser | null) => {
    win.Userback = { access_token: token, ...(user ? { user_data: userData(user) } : {}) };
    doc.getElementById(USERBACK_SCRIPT_ID)?.remove();
    const s = doc.createElement("script");
    s.id = USERBACK_SCRIPT_ID;
    s.src = USERBACK_SCRIPT;
    s.async = true;
    doc.head.appendChild(s);
  };

  return {
    sync(user) {
      const id = user?.id ?? null;
      if (!started) {
        started = true;
        currentId = id;
        load(user);
        return;
      }
      if (id === currentId) return;
      currentId = id;
      const ub = win.Userback;
      // Sign-in: `identify` (Userback's Business plan) updates the open widget in place.
      if (user && typeof ub?.identify === "function") {
        ub.identify(user.id, { name: user.name, email: user.email });
        ub.user_data = userData(user);
        return;
      }
      // Sign-out, or no `identify` on this plan: tear down and load again with the right person.
      ub?.destroy?.();
      load(user);
    },
  };
}
