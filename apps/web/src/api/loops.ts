// SPDX-License-Identifier: AGPL-3.0-only
// The funder loops (E4, api/loops.tsp): inviting a peer funder, the "for funders" page, an
// intermediary's co-branded onboarding link and the partner directory, counting a new workspace
// for the link it came from, and the applicant's reusable profile.
//
// `createHttpLoopsApi` calls the GMS Worker; `createMockLoopsApi` (mocks/loops.ts) answers the same
// interface in the browser.
import { ApiError } from "./client.ts";
import type { components } from "./schema.d.ts";

type S = components["schemas"];
export type ForFundersPage = S["Models.ForFundersPage"];
export type PeerInvitation = S["Models.PeerInvitation"];
export type PeerInvitationList = S["Models.PeerInvitationList"];
export type PeerInvitePreview = S["Models.PeerInvitePreview"];
export type PeerInviteSent = S["Models.PeerInviteSent"];
export type PartnerSettings = S["Models.PartnerSettings"];
export type DirectoryListing = S["Models.DirectoryListing"];
export type OnboardingPage = S["Models.OnboardingPage"];
export type PartnerCard = S["Models.PartnerCard"];
export type DirectoryQueueItem = S["Models.DirectoryQueueItem"];
export type ReusableProfile = S["Models.ReusableProfile"];
export type FunderSeenField = S["Models.FunderSeenField"];
export type ReferralSource = "invite" | "package" | "onboarding";
export type ClaimResult = S["Models.ReferralClaimResult"];

/** Invitations a workspace sends per week; the server's PEER_INVITES_PER_WEEK. */
export const PEER_INVITES_PER_WEEK = 5;
/** The admin's note, at most this long (the server's PEER_INVITE_NOTE_MAX). */
export const PEER_INVITE_NOTE_MAX = 500;
/** The largest logo, and the kinds of image (the server's LOGO_MAX_BYTES and LOGO_TYPES). */
export const LOGO_MAX_BYTES = 256 * 1024;
export const LOGO_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export type LogoType = (typeof LOGO_TYPES)[number];

export interface LoopsApi {
  // ---- public pages ----
  forFunders(q: { ref?: string | null; invite?: string | null }): Promise<ForFundersPage>;
  partners(): Promise<PartnerCard[]>;
  onboardingPage(token: string): Promise<OnboardingPage>;
  // ---- the person ----
  claim(input: { workspaceId: string; source: ReferralSource; token: string }): Promise<ClaimResult>;
  // ---- a funder workspace's admins ----
  peerInvitations(workspaceId: string): Promise<PeerInvitationList>;
  previewPeerInvite(workspaceId: string, input: { email: string; note?: string }): Promise<PeerInvitePreview>;
  sendPeerInvite(workspaceId: string, input: { email: string; note?: string; token: string; digest: string }): Promise<PeerInviteSent>;
  partnerSettings(workspaceId: string): Promise<PartnerSettings>;
  createOnboardingLink(workspaceId: string): Promise<PartnerSettings>;
  replaceOnboardingLink(workspaceId: string): Promise<PartnerSettings>;
  revokeOnboardingLink(workspaceId: string): Promise<PartnerSettings>;
  putLogo(workspaceId: string, input: { mime: LogoType; contentBase64: string; alt: string }): Promise<PartnerSettings>;
  putLogoAlt(workspaceId: string, alt: string): Promise<PartnerSettings>;
  removeLogo(workspaceId: string): Promise<PartnerSettings>;
  requestListing(workspaceId: string, region: string): Promise<DirectoryListing>;
  withdrawListing(workspaceId: string): Promise<DirectoryListing>;
  // ---- directory moderators ----
  isDirectoryModerator(): Promise<boolean>;
  directoryQueue(): Promise<DirectoryQueueItem[]>;
  approveListing(id: string): Promise<DirectoryListing & { id: string }>;
  rejectListing(id: string, reason: string): Promise<DirectoryListing & { id: string }>;
  // ---- an applicant workspace ----
  reusableProfile(workspaceId: string): Promise<ReusableProfile>;
}

export interface HttpLoopsOptions {
  baseUrl: string;
  token: () => Promise<string | null>;
  fetch?: typeof fetch;
}

export function createHttpLoopsApi(opts: HttpLoopsOptions): LoopsApi {
  const e = encodeURIComponent;
  async function call<T>(method: string, path: string, o: { body?: unknown; workspaceId?: string; token?: boolean } = {}): Promise<{ data?: T; items?: T }> {
    const token = o.token === false ? null : await opts.token();
    const res = await (opts.fetch ?? fetch)(`${opts.baseUrl}${path}`, {
      method,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(o.workspaceId ? { "X-GMS-Workspace": o.workspaceId } : {}), ...(o.body !== undefined ? { "Content-Type": "application/json" } : {}) },
      ...(o.body !== undefined ? { body: JSON.stringify(o.body) } : {}),
    });
    const json = (await res.json().catch(() => ({}))) as { message?: string; errors?: unknown[]; data?: T; items?: T };
    if (!res.ok) throw new ApiError(res.status, json.message ?? `Request failed (${res.status})`, json.errors ?? []);
    return json;
  }
  const data = async <T>(method: string, path: string, o: Parameters<typeof call>[2] = {}) => (await call<T>(method, path, o)).data as T;
  const items = async <T>(path: string, token = true) => ((await call<T[]>("GET", path, { token })).items ?? []) as T[];
  const query = (q: Record<string, string | null | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(q)) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `?${s}` : "";
  };
  const inWs = (workspaceId: string, body?: unknown) => ({ workspaceId, ...(body !== undefined ? { body } : {}) });
  return {
    forFunders: (q) => data("GET", `/gms/public/for-funders${query({ ref: q.ref, invite: q.invite })}`, { token: false }),
    partners: () => items("/gms/public/partners", false),
    onboardingPage: (token) => data("GET", `/gms/public/join/${e(token)}`, { token: false }),
    claim: (input) => data("POST", "/gms/referrals/claim", { body: input }),
    peerInvitations: (ws) => data("GET", "/gms/peer-invitations", inWs(ws)),
    previewPeerInvite: (ws, input) => data("POST", "/gms/peer-invitations/preview", inWs(ws, input)),
    sendPeerInvite: (ws, input) => data("POST", "/gms/peer-invitations", inWs(ws, input)),
    partnerSettings: (ws) => data("GET", "/gms/partner-settings", inWs(ws)),
    createOnboardingLink: (ws) => data("POST", "/gms/partner-settings/onboarding-link", inWs(ws, {})),
    replaceOnboardingLink: (ws) => data("POST", "/gms/partner-settings/onboarding-link/replace", inWs(ws, {})),
    revokeOnboardingLink: (ws) => data("DELETE", "/gms/partner-settings/onboarding-link", inWs(ws)),
    putLogo: (ws, input) => data("PUT", "/gms/partner-settings/onboarding-link/logo", inWs(ws, input)),
    putLogoAlt: (ws, alt) => data("PATCH", "/gms/partner-settings/onboarding-link/logo", inWs(ws, { alt })),
    removeLogo: (ws) => data("DELETE", "/gms/partner-settings/onboarding-link/logo", inWs(ws)),
    requestListing: (ws, region) => data("PUT", "/gms/partner-settings/listing", inWs(ws, { region })),
    withdrawListing: (ws) => data("POST", "/gms/partner-settings/listing/withdraw", inWs(ws, {})),
    isDirectoryModerator: async () => (await data<{ moderator: boolean }>("GET", "/gms/partners/moderation/me")).moderator,
    directoryQueue: () => items("/gms/partners/moderation/queue"),
    approveListing: (id) => data("POST", `/gms/partners/moderation/listings/${e(id)}/approve`, { body: {} }),
    rejectListing: (id, reason) => data("POST", `/gms/partners/moderation/listings/${e(id)}/reject`, { body: { reason } }),
    reusableProfile: (ws) => data("GET", "/gms/reusable-profile", inWs(ws)),
  };
}

// ---- the pending referral: kept from the page a person came from until their new workspace is counted ----

/** One link the person came from, for one hour (the server's REFERRAL_CLAIM_WINDOW_MS). */
export interface PendingReferral {
  source: ReferralSource;
  token: string;
  /** Who the link is from, to name them during setup. */
  name: string | null;
  at: number;
}
const PENDING_KEY = "gms.referral";
export const PENDING_REFERRAL_MS = 60 * 60 * 1000;

export function rememberReferral(r: Omit<PendingReferral, "at">): void {
  try {
    window.localStorage.setItem(PENDING_KEY, JSON.stringify({ ...r, at: Date.now() }));
  } catch {
    // No storage: the page that made the workspace still claims it directly.
  }
}
export function pendingReferral(): PendingReferral | null {
  try {
    const raw = window.localStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    const r = JSON.parse(raw) as PendingReferral;
    if (!r || typeof r.token !== "string" || !["invite", "package", "onboarding"].includes(r.source) || Date.now() - r.at > PENDING_REFERRAL_MS) {
      window.localStorage.removeItem(PENDING_KEY);
      return null;
    }
    return r;
  } catch {
    return null;
  }
}
export function forgetReferral(): void {
  try {
    window.localStorage.removeItem(PENDING_KEY);
  } catch {
    // Nothing to forget.
  }
}
