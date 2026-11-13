// SPDX-License-Identifier: AGPL-3.0-only
// The award invitation token, kept out of every URL a server sees. The email link carries it in the
// fragment (`/awards/claim#token=…`), which browsers never send; older links carry it as `?token=`.
// The claim page reads it once, keeps it in this tab's session storage and replaces the address with
// the plain `/awards/claim`, so a sign-in `next`, a Passport `returnTo` or an onboarding `next` built
// from this page never holds it. It is cleared when the invitation is used up or found invalid.
const KEY = "gms.claim.token";
export const CLAIM_PATH = "/awards/claim";
/** What a token looks like; anything else in the address is ignored. */
const SHAPE = /^[A-Za-z0-9_-]{20,200}$/;

function tokenIn(search: string, hash: string): string | null {
  for (const raw of [hash.replace(/^#/, ""), search.replace(/^\?/, "")]) {
    const t = new URLSearchParams(raw).get("token")?.trim();
    if (t && SHAPE.test(t)) return t;
  }
  return null;
}

/** Stores a token found in the fragment or query and returns whether the address carried one. Safe to call every render. */
export function captureClaimToken(search: string, hash: string): boolean {
  const t = tokenIn(search, hash);
  if (!t) return false;
  try {
    sessionStorage.setItem(KEY, t);
  } catch {
    // Storage can be unavailable (private mode); the token is then held by the page that read it.
    memory = t;
  }
  return true;
}

let memory: string | null = null;

export function getClaimToken(): string {
  try {
    return sessionStorage.getItem(KEY) ?? memory ?? "";
  } catch {
    return memory ?? "";
  }
}

export function clearClaimToken(): void {
  memory = null;
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // See captureClaimToken.
  }
}
