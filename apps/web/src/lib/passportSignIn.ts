// SPDX-License-Identifier: AGPL-3.0-only
// Sign in with Passport, from the web app's side: where the button sends the browser, and what the
// sign-in page says when Passport sends the person back without a session.
import { env } from "../env.ts";

/** Leaving the app is a full navigation; tests replace `go`. */
export const passportBrowser = { go: (url: string) => window.location.assign(url) };

/** The token the mock auth client accepts on `/auth/passport`. */
export const MOCK_PASSPORT_TOKEN = "mock-passport";

/** Only same-origin paths are honored as a destination. */
export function safeNext(next: string | null | undefined): string | null {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.includes("\\") ? next : null;
}

/**
 * Where "Continue with Passport" goes. With an API configured it is the API's start route, which
 * redirects to Passport; in mock mode it is the return page with a token the mock accepts, so the
 * whole path can be walked without Passport.
 */
export function passportSignInUrl(returnTo: string | null, mock: boolean): string {
  const next = safeNext(returnTo);
  if (mock) return `/auth/passport#${new URLSearchParams({ token_hash: MOCK_PASSPORT_TOKEN, type: "magiclink", ...(next ? { next } : {}) })}`;
  return `${env.apiBaseUrl}/gms/passport/signin/start${next ? `?returnTo=${encodeURIComponent(next)}` : ""}`;
}

export type PassportErrorCode = "cancelled" | "no_organization" | "email_unverified" | "expired" | "state_mismatch" | "unavailable" | "not_configured";

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
    case "unavailable":
      return { tone: "warn", title: "Passport did not answer", detail: "This is usually brief. Try again in a moment, or sign in with your email below." };
    case "not_configured":
      return { tone: "info", title: "Passport sign-in is not set up here", detail: "This GMS has not been connected to Passport. Sign in with your email below." };
    default:
      return { tone: "warn", title: "Passport sign-in did not finish", detail: "Continue with Passport again, or sign in with your email below." };
  }
}
