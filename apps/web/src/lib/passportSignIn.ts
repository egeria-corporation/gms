// SPDX-License-Identifier: AGPL-3.0-only
// Sign in with Passport, from the web app's side: where the button sends the browser, and what the
// sign-in page says when Passport sends the person back without a session.
import { env } from "../env.ts";

/** Leaving the app is a full navigation; tests replace `go`. */
export const passportBrowser = { go: (url: string) => window.location.assign(url) };

/** The token the mock auth client accepts on `/auth/passport`. */
export const MOCK_PASSPORT_TOKEN = "mock-passport";

/**
 * A destination inside this app: letters, digits, `_`, `-` and single slashes. The same allow-list
 * as the API's `RETURN_TO` (apps/api/src/services/passport-signin.ts; a test holds the two equal),
 * so nothing a browser could read as another site gets through: no `//`, backslash, scheme, tab,
 * newline or other control character.
 */
export const RETURN_TO = /^\/(?!\/)[A-Za-z0-9_\-/]{0,200}$/;

/** Only plain paths in this app are honored as a destination. */
export function safeNext(next: string | null | undefined): string | null {
  return next && RETURN_TO.test(next) && !next.includes("//") ? next : null;
}

// ---- the last hop -----------------------------------------------------------------------------
// The sign-in comes back as a one-time token in the address. Anyone can put such an address in
// front of someone else, so the token is redeemed only in the tab that started the trip: the
// button makes a random value, keeps it in this tab's session storage and sends it with the
// request; the API seals it and returns it next to the token; the return page compares the two.
const HOP_KEY = "gms.passport.hop";
const HOP = /^[A-Za-z0-9_-]{22,128}$/;

function tabStorage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/** Make and remember this tab's value for one trip to Passport. Null when the browser offers no session storage. */
export function beginPassportHop(): string | null {
  const store = tabStorage();
  if (!store) return null;
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let raw = "";
  for (const b of bytes) raw += String.fromCharCode(b);
  const hop = btoa(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  try {
    store.setItem(HOP_KEY, hop);
  } catch {
    return null;
  }
  return hop;
}

/** True only when `hop` is the value this tab started with. The value is used up either way. */
export function endPassportHop(hop: string | null): boolean {
  const store = tabStorage();
  if (!store) return false;
  let mine: string | null = null;
  try {
    mine = store.getItem(HOP_KEY);
    store.removeItem(HOP_KEY);
  } catch {
    return false;
  }
  return !!hop && !!mine && HOP.test(hop) && hop === mine;
}

/**
 * Where "Continue with Passport" goes. With an API configured it is the API's start route, which
 * redirects to Passport; in mock mode it is the return page with a token the mock accepts, so the
 * whole path can be walked without Passport.
 */
export function passportSignInUrl(returnTo: string | null, mock: boolean, hop: string): string {
  const next = safeNext(returnTo);
  if (mock) return `/auth/passport#${new URLSearchParams({ token_hash: MOCK_PASSPORT_TOKEN, type: "magiclink", hop, ...(next ? { next } : {}) })}`;
  return `${env.apiBaseUrl}/gms/passport/signin/start?${new URLSearchParams({ hop, ...(next ? { returnTo: next } : {}) })}`;
}

export type PassportErrorCode = "cancelled" | "no_organization" | "email_unverified" | "expired" | "state_mismatch" | "unavailable" | "not_configured" | "account_mismatch";

export interface PassportProblem {
  tone: "warn" | "dng" | "info";
  title: string;
  detail: string;
  /** A next step outside the sign-in form, when there is one. */
  action?: { label: string; href: string };
}

/** What each `?passport_error=` code means to the person, and what to do next. */
export function passportProblem(code: string | null): PassportProblem | null {
  const passport = env.passportBaseUrl.replace("//passport.", "//app.passport.");
  switch (code as PassportErrorCode | null) {
    case null:
      return null;
    case "cancelled":
      return { tone: "info", title: "You cancelled at Passport", detail: "Nothing was shared. Continue with Passport again when you are ready, or sign in with your email below." };
    case "no_organization":
      return {
        tone: "warn",
        title: "Your Passport has no organization yet",
        detail: "Applying starts from an organization's Passport record. Claim your organization in Passport, then continue with Passport again.",
        action: { label: "Claim your organization in Passport", href: `${passport}/claim` },
      };
    case "email_unverified":
      return { tone: "warn", title: "Your Passport email is not confirmed", detail: "Confirm your email address in Passport, then continue with Passport again.", action: { label: "Open Passport", href: passport } };
    case "expired":
      return { tone: "warn", title: "That sign-in ran out of time", detail: "A Passport sign-in has to finish within ten minutes and can be used once. Continue with Passport again." };
    case "state_mismatch":
      return { tone: "dng", title: "That sign-in could not be confirmed", detail: "It did not start in this browser, or it was changed on the way back. Nothing was signed in. Start again from this page." };
    case "account_mismatch":
      return {
        tone: "dng",
        title: "This email is linked to a different Passport account",
        detail: "An account here already uses this email with another Passport sign-in, so nobody was signed in. Sign in with your email below; if you did not expect this, contact support.",
      };
    case "unavailable":
      return { tone: "warn", title: "Passport did not answer", detail: "This is usually brief. Try again in a moment, or sign in with your email below." };
    case "not_configured":
      return { tone: "info", title: "Passport sign-in is not set up here", detail: "This GMS has not been connected to Passport. Sign in with your email below." };
    default:
      return { tone: "warn", title: "Passport sign-in did not finish", detail: "Continue with Passport again, or sign in with your email below." };
  }
}
