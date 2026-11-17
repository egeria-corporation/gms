// SPDX-License-Identifier: AGPL-3.0-only
// "Applications from social" (social posting's reach report): a person who lands on an opportunity
// page from a shared link (`?utm_source=social`) and then starts an application there is counted.
// The landing is remembered in this tab only (sessionStorage), per funder and opportunity, and sent
// once with the start; nothing else about the visit is kept. Storage can be missing or refuse
// (private windows, blocked site data): then nothing is counted and nothing breaks.

const KEY = "gms.socialLanding";
/** The only source the GMS counts. */
export const SOCIAL_SOURCE = "social" as const;

const read = (): string[] => {
  try {
    const v = JSON.parse(window.sessionStorage.getItem(KEY) ?? "[]") as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(-20) : [];
  } catch {
    return [];
  }
};

/** On an opportunity page: remember that this visit came from a shared social link. */
export function rememberSocialLanding(handle: string, slug: string, search: string): void {
  if (new URLSearchParams(search).get("utm_source") !== SOCIAL_SOURCE) return;
  try {
    const key = `${handle}/${slug}`;
    window.sessionStorage.setItem(KEY, JSON.stringify([...read().filter((x) => x !== key), key]));
  } catch {
    // No storage: not counted.
  }
}

/** When starting an application: "social" if this tab landed on that opportunity from a shared link. */
export function socialSourceFor(handle: string | null | undefined, slug: string | null | undefined): typeof SOCIAL_SOURCE | undefined {
  if (!handle || !slug) return undefined;
  return read().includes(`${handle}/${slug}`) ? SOCIAL_SOURCE : undefined;
}
