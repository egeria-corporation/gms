// SPDX-License-Identifier: AGPL-3.0-only
// Where an application came from: a person who lands on an opportunity page from a shared social
// link (`?utm_source=social`, social posting's reach report), an open-call feed item
// (`?utm_source=feed`) or a Philanthropy News Digest listing (`?utm_source=pnd`, the "Share this
// call" panel) and then starts an application there is counted. The landing is remembered in this
// tab only (sessionStorage), per funder and opportunity, and sent once with the start; nothing else
// about the visit is kept. Storage can be missing or refuse (private windows, blocked site data):
// then nothing is counted and nothing breaks.

const KEY = "gms.socialLanding";
/** The social source; the feed and PND sources below are counted the same way. */
export const SOCIAL_SOURCE = "social" as const;
/** The only sources the GMS counts (services/apply.ts `START_SOURCES`). */
export const LANDING_SOURCES = [SOCIAL_SOURCE, "feed", "pnd"] as const;
export type LandingSource = (typeof LANDING_SOURCES)[number];
const isSource = (v: string | null): v is LandingSource => (LANDING_SOURCES as readonly (string | null)[]).includes(v);

/** Entries are `{source} {handle}/{slug}`; one written before sources other than social is social. */
const read = (): string[] => {
  try {
    const v = JSON.parse(window.sessionStorage.getItem(KEY) ?? "[]") as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(-20) : [];
  } catch {
    return [];
  }
};
const callOf = (entry: string) => entry.slice(entry.indexOf(" ") + 1);
const sourceOf = (entry: string): LandingSource => {
  const s = entry.includes(" ") ? entry.slice(0, entry.indexOf(" ")) : SOCIAL_SOURCE;
  return isSource(s) ? s : SOCIAL_SOURCE;
};

/** On an opportunity page: remember that this visit came from a counted link. */
export function rememberSocialLanding(handle: string, slug: string, search: string): void {
  const source = new URLSearchParams(search).get("utm_source");
  if (!isSource(source)) return;
  try {
    const call = `${handle}/${slug}`;
    window.sessionStorage.setItem(KEY, JSON.stringify([...read().filter((x) => callOf(x) !== call), `${source} ${call}`]));
  } catch {
    // No storage: not counted.
  }
}

/** When starting an application: the source this tab last landed on that opportunity from, if counted. */
export function socialSourceFor(handle: string | null | undefined, slug: string | null | undefined): LandingSource | undefined {
  if (!handle || !slug) return undefined;
  const entry = read()
    .reverse()
    .find((x) => callOf(x) === `${handle}/${slug}`);
  return entry ? sourceOf(entry) : undefined;
}
