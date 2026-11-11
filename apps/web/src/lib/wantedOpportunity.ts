// SPDX-License-Identifier: AGPL-3.0-only
// "Apply" on a public opportunity page often passes through sign-in, Passport and onboarding
// before the person reaches Find funding. The opportunity they chose is kept in this tab's session
// storage for that trip, so it can be shown to them when they arrive. Not sensitive: both values
// are the public handle and slug from the page address.
const KEY = "gms.apply.wanted";
const PART = /^[A-Za-z0-9_-]{1,120}$/;

export interface WantedOpportunity {
  funder: string;
  opportunity: string;
}

const valid = (w: Partial<WantedOpportunity> | null): w is WantedOpportunity => !!w && PART.test(w.funder ?? "") && PART.test(w.opportunity ?? "");

function store(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function rememberWanted(w: WantedOpportunity): void {
  if (!valid(w)) return;
  try {
    store()?.setItem(KEY, JSON.stringify(w));
  } catch {
    // A browser without session storage: the person lands on the list without a highlight.
  }
}

/** The opportunity named in the address, else the one remembered for this trip. */
export function wantedFrom(params: URLSearchParams): WantedOpportunity | null {
  const fromUrl = { funder: params.get("funder") ?? "", opportunity: params.get("opportunity") ?? "" };
  if (valid(fromUrl)) return fromUrl;
  try {
    const raw = store()?.getItem(KEY);
    const kept = raw ? (JSON.parse(raw) as Partial<WantedOpportunity>) : null;
    return valid(kept) ? kept : null;
  } catch {
    return null;
  }
}

export function forgetWanted(): void {
  try {
    store()?.removeItem(KEY);
  } catch {
    // Nothing to forget.
  }
}

export const wantedQuery = (w: WantedOpportunity): string => `funder=${encodeURIComponent(w.funder)}&opportunity=${encodeURIComponent(w.opportunity)}`;
