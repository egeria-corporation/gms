// SPDX-License-Identifier: AGPL-3.0-only
// Award sharing (v1.9.0): the port behind the grants-awarded pages, the "Share this award" panel
// and the listing settings. `createHttpAwardSharingApi` calls the GMS Worker (api/award-sharing.tsp);
// `createMockAwardSharingApi` (mocks/awardSharing.ts) implements the same interface in the browser.
// The public reads are sent without a token, whoever is signed in.
import { ApiError } from "./client.ts";
import type { components } from "./schema.d.ts";

type S = components["schemas"];

export type PublicAward = S["Models.PublicAward"];
export type FunderAwardsPage = S["Models.FunderAwardsPage"];
export type AwardPublicPage = S["Models.AwardPublicPage"];
export type AwardShareKit = S["Models.AwardShareKit"];
export type AwardSharing = S["Models.AwardSharing"];
export type AwardNotListedReason = S["Models.AwardNotListedReason"];
export type AwardListingSettings = S["Models.AwardListingSettings"];
export type ShareSide = "funder" | "grantee";
// The kit, plus (v1.12.0, api/award-kit.tsp).
export type FederalFundingInput = S["Models.FederalFundingInput"];
export type AwardFederalFunding = S["Models.AwardFederalFunding"];
export type ShareKitProfile = S["Models.ShareKitProfile"];
export type ShareKitProfileInput = S["Models.ShareKitProfileInput"];
export type SocialTag = S["Models.SocialTag"];
export type CreditWording = S["Models.CreditWording"];

export interface AwardSharingApi {
  // ---- public: no sign-in ----
  funderAwards(handle: string): Promise<FunderAwardsPage>;
  awardPage(handle: string, slug: string): Promise<AwardPublicPage>;
  // ---- the workspace last opened ----
  /** The "Share this award" panel, from the funder's side or the grantee's. */
  sharing(awardId: string, side: ShareSide): Promise<AwardSharing>;
  /** Funder admins and program officers. */
  setConfidential(awardId: string, confidential: boolean): Promise<AwardSharing>;
  /** Grantee admins: "Don't list us publicly". */
  setUnlisted(awardId: string, unlisted: boolean): Promise<AwardSharing>;
  settings(): Promise<AwardListingSettings>;
  /** Workspace admins. */
  updateSettings(patch: { listAwards?: boolean; showAmounts?: boolean }): Promise<AwardListingSettings>;
  setProgramDefault(programId: string, awardsConfidential: boolean): Promise<AwardListingSettings>;
  /** Funder admins and program officers: the federal share on an award. */
  setFederalFunding(awardId: string, input: FederalFundingInput): Promise<AwardSharing>;
  /** The carousel PDF at the kit's `carousel.path` (the download is counted as a use of the kit). */
  carouselPdf(path: string): Promise<Blob>;
  /** Say that the person copied the press release or saved the portrait card: a count only, for the operators' measures. */
  kitUse(awardId: string, side: ShareSide, kind: "press_release" | "portrait"): Promise<void>;
  /** This workspace's share-kit settings. */
  shareProfile(): Promise<ShareKitProfile>;
  /** Workspace admins. */
  updateShareProfile(patch: ShareKitProfileInput): Promise<ShareKitProfile>;
}

export interface HttpAwardSharingOptions {
  baseUrl: string;
  token: () => Promise<string | null>;
  workspaceId: () => string | null;
  fetch?: typeof fetch;
}

export function createHttpAwardSharingApi(opts: HttpAwardSharingOptions): AwardSharingApi {
  async function send(method: string, path: string, body?: unknown, open = false): Promise<Response> {
    const token = open ? null : await opts.token();
    const workspaceId = open ? null : opts.workspaceId();
    return (opts.fetch ?? fetch)(`${opts.baseUrl}${path}`, {
      method,
      ...(open ? { credentials: "omit" as const } : {}),
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(workspaceId ? { "X-GMS-Workspace": workspaceId } : {}),
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  }
  async function call<T>(method: string, path: string, body?: unknown, open = false): Promise<T> {
    const res = await send(method, path, body, open);
    const json = (await res.json().catch(() => ({}))) as { data?: T; message?: string; errors?: unknown[] };
    if (!res.ok) throw new ApiError(res.status, json.message ?? `Request failed (${res.status})`, (json.errors ?? []) as never);
    return json.data as T;
  }
  const e = encodeURIComponent;
  return {
    funderAwards: (handle) => call("GET", `/gms/public/funders/${e(handle)}/awards`, undefined, true),
    awardPage: (handle, slug) => call("GET", `/gms/public/funders/${e(handle)}/awards/${e(slug)}`, undefined, true),
    sharing: (awardId, side) => call("GET", side === "funder" ? `/gms/awards/${e(awardId)}/sharing` : `/gms/my/awards/${e(awardId)}/sharing`),
    setConfidential: (awardId, confidential) => call("PUT", `/gms/awards/${e(awardId)}/confidential`, { confidential }),
    setUnlisted: (awardId, unlisted) => call("PUT", `/gms/my/awards/${e(awardId)}/listing`, { unlisted }),
    settings: () => call("GET", "/gms/award-sharing/settings"),
    updateSettings: (patch) => call("PUT", "/gms/award-sharing/settings", patch),
    setProgramDefault: (programId, awardsConfidential) => call("PUT", `/gms/programs/${e(programId)}/award-sharing`, { awardsConfidential }),
    setFederalFunding: (awardId, input) => call("PUT", `/gms/awards/${e(awardId)}/federal-funding`, input),
    carouselPdf: async (path) => {
      // Only the API's own carousel addresses.
      if (!/^\/gms\/(my\/)?awards\/[A-Za-z0-9_-]+\/sharing\/carousel\.pdf$/.test(path)) throw new ApiError(400, "Not a carousel address");
      const res = await send("GET", path);
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { message?: string; errors?: unknown[] };
        throw new ApiError(res.status, json.message ?? `Request failed (${res.status})`, (json.errors ?? []) as never);
      }
      return res.blob();
    },
    kitUse: async (awardId, side, kind) => void (await call("POST", side === "funder" ? `/gms/awards/${e(awardId)}/sharing/uses` : `/gms/my/awards/${e(awardId)}/sharing/uses`, { kind })),
    shareProfile: () => call("GET", "/gms/share-kit/profile"),
    updateShareProfile: (patch) => call("PUT", "/gms/share-kit/profile", patch),
  };
}

/** Why an award is not on the public page, in plain words, for the side reading it. */
export function notListedText(reason: AwardNotListedReason | null | undefined, side: ShareSide, funderName = "The funder"): string {
  switch (reason) {
    case "confidential":
      return side === "funder" ? "This award is confidential, so it is never shown publicly." : `${funderName} keeps this award confidential, so it is never shown publicly.`;
    case "individual":
      return "Awards to individuals are never shown publicly.";
    case "not_accepted":
      return "Only accepted, active and completed awards are listed.";
    case "funder_unavailable":
      return "The funder's public page is not available.";
    case "listing_off":
      return side === "funder" ? "Your public page does not list awards. Turn on “List awards on my public page” in Settings › Public page." : `${funderName} does not list its awards publicly.`;
    case "recipient_unlisted":
      return side === "funder" ? "The grantee asked not to be listed publicly." : "You chose not to be listed publicly.";
    default:
      return "This award is not shown publicly.";
  }
}

/** The badge as an image address that loads nothing: the SVG the badge route serves, inline. */
export const badgeDataUrl = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
