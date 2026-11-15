// SPDX-License-Identifier: AGPL-3.0-only
// The social platforms the GMS offers through Zernio, with what a person needs to know before
// posting: the name to show, the length limit, and whether a post there needs an image.

/** Zernio's platform names (X is `twitter` in Zernio's API). */
export const PLATFORMS = ["linkedin", "facebook", "instagram", "twitter", "bluesky", "threads"] as const;
export type Platform = (typeof PLATFORMS)[number];

export const isPlatform = (v: unknown): v is Platform => typeof v === "string" && (PLATFORMS as readonly string[]).includes(v);

export const PLATFORM_LABEL: Record<Platform, string> = {
  linkedin: "LinkedIn",
  facebook: "Facebook",
  instagram: "Instagram",
  twitter: "X",
  bluesky: "Bluesky",
  threads: "Threads",
};

/**
 * The longest post each platform takes, in the unit it counts: characters, with every link on X
 * counted as 23 (its link shortener), and Bluesky counting what a reader sees as one character.
 */
export const PLATFORM_LIMIT: Record<Platform, number> = {
  linkedin: 3000,
  facebook: 63206,
  instagram: 2200,
  twitter: 280,
  bluesky: 300,
  threads: 500,
};

/** Instagram takes no post without a picture. */
export const NEEDS_IMAGE: Record<Platform, boolean> = { linkedin: false, facebook: false, instagram: true, twitter: false, bluesky: false, threads: false };

/** What X counts a link as, whatever its length. */
export const X_LINK_LENGTH = 23;
const URL_RE = /https?:\/\/[^\s<>"']+/g;

function graphemes(text: string): number {
  const Seg = (Intl as unknown as { Segmenter?: new (l?: string, o?: { granularity: "grapheme" }) => { segment(s: string): Iterable<unknown> } }).Segmenter;
  if (!Seg) return Array.from(text).length;
  let n = 0;
  for (const _ of new Seg(undefined, { granularity: "grapheme" }).segment(text)) n++;
  return n;
}

/** The length of `text` as `platform` counts it. */
export function textLength(platform: Platform, text: string): number {
  if (platform === "twitter") return Array.from(text.replace(URL_RE, "x".repeat(X_LINK_LENGTH))).length;
  if (platform === "bluesky") return graphemes(text);
  return Array.from(text).length;
}

export interface LengthCheck {
  platform: Platform;
  label: string;
  length: number;
  limit: number;
  over: boolean;
}

export const lengthCheck = (platform: Platform, text: string): LengthCheck => {
  const length = textLength(platform, text);
  return { platform, label: PLATFORM_LABEL[platform], length, limit: PLATFORM_LIMIT[platform], over: length > PLATFORM_LIMIT[platform] };
};
