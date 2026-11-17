// SPDX-License-Identifier: AGPL-3.0-only
// In-browser funder loops for mock mode and tests (E4), with the server's rules: an invitation is
// a funder admin's, previewed and sent once, five a week, never twice to one address; the "for
// funders" count is shown from ten and never names anyone; the onboarding link and the directory
// are for a workspace that runs two or more funds besides its default (read from the mock funds);
// a listing is public only once a moderator approves it, and leaves at once when withdrawn.
import { ApiError } from "../api/client.ts";
import type { GmsApi, Me } from "../api/client.ts";
import type { DirectoryListing, DirectoryQueueItem, ForFundersPage, LoopsApi, PartnerCard, PartnerSettings, PeerInvitation, ReusableProfile } from "../api/loops.ts";
import { LOGO_MAX_BYTES, PEER_INVITES_PER_WEEK } from "../api/loops.ts";
import type { Session } from "../auth/types.ts";
import { FIXTURE_WORKSPACES } from "./fixtures.ts";

export const REGION_COUNT_FLOOR = 10;
export const MIN_NAMED_FUNDS = 2;

interface MockInvitation extends PeerInvitation {
  emailKey: string;
  token: string;
}
interface MockLink {
  token: string;
  logo: { url: string; alt: string } | null;
  joined: number;
  createdAt: string;
}
interface MockListing extends DirectoryListing {
  id: string;
  workspaceId: string;
}

export interface LoopsStore {
  invitations: Record<string, MockInvitation[]>;
  links: Record<string, MockLink>;
  listings: Record<string, MockListing>;
  /** What each funder workspace was called and which named funds it ran, when last read. */
  partners: Record<string, { name: string; handle: string; funds: string[] }>;
  /** Package links: token → the applicant's region and how many organizations there keep applications here. */
  packages: Record<string, { region: string | null; organizations: number }>;
  claims: { workspaceId: string; source: string; token: string }[];
  /** Directory moderators by email; empty means the signed-in person moderates (the demo). */
  moderatorEmails: string[];
}

export const MOCK_PACKAGE_TOKENS = { oregon: "mockpkgoregon0000001", montana: "mockpkgmontana000002" } as const;
/** A demo intermediary, listed and with an onboarding link, so the directory and the co-branded page have something to show. */
export const MOCK_PARTNER = { id: "mock-partner-high-desert", token: "mockjoinhighdesert01" } as const;
export const seedLoopsStore = (): LoopsStore => ({
  invitations: {},
  links: { [MOCK_PARTNER.id]: { token: MOCK_PARTNER.token, logo: null, joined: 3, createdAt: "2026-10-01T16:00:00.000Z" } },
  listings: { [MOCK_PARTNER.id]: { id: "mock-listing-high-desert", workspaceId: MOCK_PARTNER.id, status: "approved", region: "Central Oregon", submittedAt: "2026-10-01T16:00:00.000Z", decidedAt: "2026-10-02T16:00:00.000Z", decisionReason: null, withdrawnAt: null } },
  partners: { [MOCK_PARTNER.id]: { name: "High Desert Community Fund", handle: "high-desert", funds: ["Rural Arts Fund", "Wildfire Recovery Fund", "Youth Futures Fund"] } },
  packages: { [MOCK_PACKAGE_TOKENS.oregon]: { region: "Oregon", organizations: 14 }, [MOCK_PACKAGE_TOKENS.montana]: { region: "Montana", organizations: 6 } },
  claims: [],
  moderatorEmails: [],
});

export interface MockLoopsOptions {
  session: () => Promise<Session | null>;
  api: Pick<GmsApi, "me" | "listFunds">;
  store?: LoopsStore;
  now?: () => Date;
}

const clone = <T>(v: T): T => structuredClone(v);
const mask = (email: string) => `${email.slice(0, 1)}…${email.slice(email.lastIndexOf("@"))}`;
const randomToken = (n: number, alphabet = "abcdefghijklmnopqrstuvwxyz0123456789") => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => alphabet[b % alphabet.length]).join("");
const hasLink = (s: string) => /https?:\/\/|www\.|[^\s@]+@[^\s@]+\.[a-z]{2,}|\b[a-z0-9-]+\.(org|com|net|io|edu|gov)\b/i.test(s);
const FIXTURE_IDS = new Set(FIXTURE_WORKSPACES.map((w) => w.id));

export function createMockLoopsApi(opts: MockLoopsOptions): LoopsApi & { store: LoopsStore } {
  const store = opts.store ?? seedLoopsStore();
  const now = () => (opts.now ?? (() => new Date()))();
  const iso = () => now().toISOString();

  async function person(): Promise<{ session: Session; me: Me }> {
    const session = await opts.session();
    if (!session) throw new ApiError(401, "Sign in to continue");
    return { session, me: await opts.api.me() };
  }
  async function funderAdmin(workspaceId: string) {
    const { session, me } = await person();
    const m = me.workspaces.find((w) => w.id === workspaceId);
    if (!m) throw new ApiError(403, "You are not a member of this workspace");
    if (m.kind !== "funder") throw new ApiError(403, "This action belongs to funder workspaces", [{ code: "wrong_workspace_kind" }]);
    if (m.role !== "admin") throw new ApiError(403, "This needs one of these roles: admin", [{ code: "insufficient_role" }]);
    return { session, me, m };
  }
  async function namedFunds(workspaceId: string, name: string, handle: string): Promise<string[]> {
    const list = await opts.api.listFunds().catch(() => ({ items: [] as { name: string; isDefault: boolean }[] }));
    const funds = list.items.filter((f) => !f.isDefault).map((f) => f.name).sort((a, b) => a.localeCompare(b));
    store.partners[workspaceId] = { name, handle, funds };
    return funds;
  }
  const remaining = (wsId: string) => {
    const since = now().getTime() - 7 * 24 * 3600 * 1000;
    return Math.max(0, PEER_INVITES_PER_WEEK - (store.invitations[wsId] ?? []).filter((i) => Date.parse(i.createdAt) > since).length);
  };
  const view = (i: MockInvitation): PeerInvitation => ({ id: i.id, to: i.to, status: i.status, sentAt: i.sentAt, joinedCount: i.joinedCount, firstJoinedAt: i.firstJoinedAt, createdAt: i.createdAt });
  const compose = async (workspaceId: string, input: { email: string; note?: string }, token: string) => {
    const { me, m } = await funderAdmin(workspaceId);
    const to = input.email.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(to)) throw new ApiError(400, "Enter a valid email address", [{ code: "invalid", field: "email" }]);
    const note = input.note?.trim() || null;
    if (note && hasLink(note)) throw new ApiError(422, "Take the link or email address out of your note. The invitation carries one link only, to set up a funder workspace", [{ code: "note_has_link", field: "note" }]);
    if (to === me.email.toLowerCase()) throw new ApiError(422, "Enter the address of the funder you are inviting, not your own", [{ code: "invite_yourself", field: "email" }]);
    const inviter = me.displayName ?? "Dana Ortiz";
    const joinUrl = `${window.location.origin}/for-funders?invite=${token}`;
    const text = [...(note ? [`A note from ${inviter}:\n\n${note}`] : []), `${inviter} at ${m.name} uses the OpenGrants Grant Management System to run their grants and invited you to try it.`, "It is free and open source, for funders and the organizations they fund: publish a call, take applications, review them with a panel, and keep track of awards and reports in one place.", `To set up your funder workspace, open this link:\n${joinUrl}`, `This is the only email you will get about this invitation: no reminders follow. To answer ${inviter}, reply to this email.`].join("\n\n");
    const email = { from: `"${inviter}" <notices@gms.opengrants.io>`, to, replyTo: me.email, subject: `${inviter} invited you to the OpenGrants Grant Management System`, text, html: text };
    return { email, digest: `mock-${to}-${note ?? ""}`, m, inviter };
  };

  return {
    store,
    async forFunders(q): Promise<ForFundersPage> {
      const pkg = q.ref ? store.packages[q.ref] : undefined;
      const inv = q.invite ? Object.entries(store.invitations).flatMap(([wsId, list]) => list.filter((i) => i.token === q.invite).map((i) => ({ wsId, i }))).at(0) : undefined;
      const funder = inv ? (FIXTURE_WORKSPACES.find((w) => w.id === inv.wsId) ?? null) : null;
      return clone({
        ref: pkg ? { region: pkg.region ? { name: pkg.region } : null, organizations: pkg.region && pkg.organizations >= REGION_COUNT_FLOOR ? pkg.organizations : null } : null,
        invitation: inv && funder ? { funder: { name: funder.name, handle: funder.handle }, inviter: funder.member.name } : null,
        floor: REGION_COUNT_FLOOR,
      });
    },
    async partners(): Promise<PartnerCard[]> {
      return Object.values(store.listings)
        .filter((l) => l.status === "approved" && (store.partners[l.workspaceId]?.funds.length ?? 0) >= MIN_NAMED_FUNDS)
        .map((l) => {
          const p = store.partners[l.workspaceId]!;
          return { name: p.name, handle: p.handle, region: l.region, funds: p.funds.length, page: `${window.location.origin}/f/${p.handle}`, verification: { source: "passport" as const, level: null } };
        })
        .sort((a, b) => a.name.localeCompare(b.name));
    },
    async onboardingPage(token) {
      const entry = Object.entries(store.links).find(([, l]) => l.token === token);
      const p = entry ? store.partners[entry[0]] : undefined;
      if (!entry || !p || p.funds.length < MIN_NAMED_FUNDS) throw new ApiError(404, "Onboarding link not found", [{ code: "not_found" }]);
      return clone({ intermediary: { name: p.name, handle: p.handle, verification: { source: "passport" as const, level: null } }, funds: p.funds, logo: entry[1].logo });
    },
    async claim(input) {
      const { me } = await person();
      const m = me.workspaces.find((w) => w.id === input.workspaceId);
      if (!m || m.role !== "admin" || FIXTURE_IDS.has(m.id)) throw new ApiError(422, "Name the workspace you just set up", [{ code: "not_your_new_workspace" }]);
      if (store.claims.some((c) => c.workspaceId === input.workspaceId)) return { counted: false, reason: "already_counted" as const };
      if (input.source !== "onboarding" && m.kind !== "funder") throw new ApiError(422, "This link brings funders. Set up a funder workspace to be counted", [{ code: "funders_only" }]);
      let found = false;
      if (input.source === "invite") {
        for (const list of Object.values(store.invitations)) {
          const i = list.find((x) => x.token === input.token);
          if (i) {
            found = true;
            i.joinedCount += 1;
            if (i.status === "sent") Object.assign(i, { status: "joined", firstJoinedAt: iso() });
          }
        }
      } else if (input.source === "onboarding") {
        const l = Object.values(store.links).find((x) => x.token === input.token);
        if (l) {
          found = true;
          l.joined += 1;
        }
      } else found = !!store.packages[input.token];
      if (!found) return { counted: false, reason: "unknown_link" as const };
      store.claims.push({ workspaceId: input.workspaceId, source: input.source, token: input.token });
      return { counted: true, reason: "counted" as const };
    },
    async peerInvitations(workspaceId) {
      const { session } = await person();
      const list = store.invitations[workspaceId] ?? [];
      return clone({ items: [...list].reverse().map(view), perWeek: PEER_INVITES_PER_WEEK, remainingThisWeek: remaining(workspaceId), joined: list.reduce((n, i) => n + i.joinedCount, 0), canInvite: !!session && remaining(workspaceId) > 0, reason: remaining(workspaceId) > 0 ? null : `This workspace invited ${PEER_INVITES_PER_WEEK} funders this week. Try again next week` });
    },
    async previewPeerInvite(workspaceId, input) {
      const token = `gms_pi_${randomToken(43, "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_")}`;
      const { email, digest } = await compose(workspaceId, input, token);
      const already = (store.invitations[workspaceId] ?? []).some((i) => i.emailKey === email.to);
      return clone({ ...email, token, digest, perWeek: PEER_INVITES_PER_WEEK, remainingThisWeek: remaining(workspaceId), alreadyInvited: already });
    },
    async sendPeerInvite(workspaceId, input) {
      const { email, digest } = await compose(workspaceId, input, input.token);
      if (digest !== input.digest) throw new ApiError(409, "The invitation changed since the preview. Look at the preview again before sending", [{ code: "preview_changed" }]);
      const list = (store.invitations[workspaceId] ??= []);
      if (list.some((i) => i.emailKey === email.to)) throw new ApiError(409, "This address was already invited from this workspace. Invitations are sent once, with no reminders", [{ code: "already_invited" }]);
      if (remaining(workspaceId) <= 0) throw new ApiError(429, `A workspace can invite ${PEER_INVITES_PER_WEEK} funders a week. Try again next week`, [{ code: "too_many_peer_invites" }]);
      const at = iso();
      const i: MockInvitation = { id: crypto.randomUUID(), to: mask(email.to), status: "sent", sentAt: at, joinedCount: 0, firstJoinedAt: null, createdAt: at, emailKey: email.to, token: input.token };
      list.push(i);
      return clone({ sent: true as const, invitation: view(i), remainingThisWeek: remaining(workspaceId) });
    },
    async partnerSettings(workspaceId): Promise<PartnerSettings> {
      const { me } = await person();
      const m = me.workspaces.find((w) => w.id === workspaceId);
      if (!m || m.kind !== "funder") throw new ApiError(403, "This action belongs to funder workspaces", [{ code: "wrong_workspace_kind" }]);
      if (m.role !== "admin") throw new ApiError(403, "This needs one of these roles: admin", [{ code: "insufficient_role" }]);
      const funds = await namedFunds(workspaceId, m.name, m.handle);
      const l = store.links[workspaceId];
      const listing = store.listings[workspaceId];
      return clone({
        eligible: funds.length >= MIN_NAMED_FUNDS,
        minFunds: MIN_NAMED_FUNDS,
        funds: funds.map((name) => ({ id: name, name })),
        link: l ? { token: l.token, url: `${window.location.origin}/join/${l.token}`, logo: l.logo, joined: l.joined, createdAt: l.createdAt } : null,
        listing: listing ? { status: listing.status, region: listing.region, submittedAt: listing.submittedAt, decidedAt: listing.decidedAt, decisionReason: listing.decisionReason, withdrawnAt: listing.withdrawnAt } : null,
        canChange: true,
      });
    },
    async createOnboardingLink(workspaceId) {
      const { m } = await funderAdmin(workspaceId);
      if ((await namedFunds(workspaceId, m.name, m.handle)).length < MIN_NAMED_FUNDS) throw new ApiError(409, `Onboarding links and the partner directory are for workspaces that run ${MIN_NAMED_FUNDS} or more funds. Add your funds in Settings, Funds`, [{ code: "not_an_intermediary" }]);
      store.links[workspaceId] ??= { token: randomToken(20), logo: null, joined: 0, createdAt: iso() };
      return this.partnerSettings(workspaceId);
    },
    async replaceOnboardingLink(workspaceId) {
      await funderAdmin(workspaceId);
      const l = store.links[workspaceId];
      if (!l) throw new ApiError(404, "Onboarding link not found");
      store.links[workspaceId] = { ...l, token: randomToken(20), joined: 0, createdAt: iso() };
      return this.partnerSettings(workspaceId);
    },
    async revokeOnboardingLink(workspaceId) {
      await funderAdmin(workspaceId);
      delete store.links[workspaceId];
      return this.partnerSettings(workspaceId);
    },
    async putLogo(workspaceId, input) {
      await funderAdmin(workspaceId);
      const l = store.links[workspaceId];
      if (!l) throw new ApiError(404, "Onboarding link not found");
      if (Math.floor((input.contentBase64.length * 3) / 4) > LOGO_MAX_BYTES) throw new ApiError(413, "A logo can be up to 256 KB", [{ code: "logo_too_large" }]);
      if (!input.alt.trim()) throw new ApiError(400, "Describe the logo", [{ code: "invalid", field: "alt" }]);
      l.logo = { url: `data:${input.mime};base64,${input.contentBase64}`, alt: input.alt.trim() };
      return this.partnerSettings(workspaceId);
    },
    async putLogoAlt(workspaceId, alt) {
      await funderAdmin(workspaceId);
      const l = store.links[workspaceId];
      if (!l?.logo) throw new ApiError(404, "Logo not found");
      l.logo.alt = alt.trim();
      return this.partnerSettings(workspaceId);
    },
    async removeLogo(workspaceId) {
      await funderAdmin(workspaceId);
      const l = store.links[workspaceId];
      if (l) l.logo = null;
      return this.partnerSettings(workspaceId);
    },
    async requestListing(workspaceId, region) {
      const { m } = await funderAdmin(workspaceId);
      if ((await namedFunds(workspaceId, m.name, m.handle)).length < MIN_NAMED_FUNDS) throw new ApiError(409, "Onboarding links and the partner directory are for workspaces that run 2 or more funds. Add your funds in Settings, Funds", [{ code: "not_an_intermediary" }]);
      const existing = store.listings[workspaceId];
      if (existing?.status === "pending") throw new ApiError(409, "Your request is waiting for a moderator. Withdraw it first to change it", [{ code: "listing_pending" }]);
      if (existing?.status === "approved") throw new ApiError(409, "You are listed already. Withdraw the listing first to change it", [{ code: "already_listed" }]);
      const l: MockListing = { id: existing?.id ?? crypto.randomUUID(), workspaceId, status: "pending", region: region.trim(), submittedAt: iso(), decidedAt: null, decisionReason: null, withdrawnAt: null };
      store.listings[workspaceId] = l;
      return clone({ status: l.status, region: l.region, submittedAt: l.submittedAt, decidedAt: null, decisionReason: null, withdrawnAt: null });
    },
    async withdrawListing(workspaceId) {
      await funderAdmin(workspaceId);
      const l = store.listings[workspaceId];
      if (!l || (l.status !== "pending" && l.status !== "approved")) throw new ApiError(409, "This listing is not in the directory or its queue", [{ code: "invalid_transition" }]);
      Object.assign(l, { status: "withdrawn", withdrawnAt: iso() });
      return clone({ status: l.status, region: l.region, submittedAt: l.submittedAt, decidedAt: l.decidedAt, decisionReason: null, withdrawnAt: l.withdrawnAt });
    },
    async isDirectoryModerator() {
      const { session } = await person();
      return store.moderatorEmails.length === 0 || store.moderatorEmails.includes(session.email.toLowerCase());
    },
    async directoryQueue(): Promise<DirectoryQueueItem[]> {
      if (!(await this.isDirectoryModerator())) throw new ApiError(403, "Only the partner directory's moderators can review listings", [{ code: "not_a_directory_moderator" }]);
      return Object.values(store.listings)
        .filter((l) => l.status === "pending")
        .map((l) => {
          const p = store.partners[l.workspaceId];
          return { id: l.id, status: l.status, region: l.region, submittedAt: l.submittedAt, decidedAt: null, decisionReason: null, withdrawnAt: null, partner: p ? { name: p.name, handle: p.handle, verification: { source: "passport" as const, level: null } } : null, funds: p?.funds.length ?? 0, eligible: (p?.funds.length ?? 0) >= MIN_NAMED_FUNDS };
        });
    },
    async approveListing(id) {
      if (!(await this.isDirectoryModerator())) throw new ApiError(403, "Only the partner directory's moderators can review listings", [{ code: "not_a_directory_moderator" }]);
      const l = Object.values(store.listings).find((x) => x.id === id);
      if (!l || l.status !== "pending") throw new ApiError(409, "This listing is not waiting for review", [{ code: "invalid_transition" }]);
      Object.assign(l, { status: "approved", decidedAt: iso() });
      return clone({ id: l.id, status: l.status, region: l.region, submittedAt: l.submittedAt, decidedAt: l.decidedAt, decisionReason: null, withdrawnAt: null });
    },
    async rejectListing(id, reason) {
      if (!(await this.isDirectoryModerator())) throw new ApiError(403, "Only the partner directory's moderators can review listings", [{ code: "not_a_directory_moderator" }]);
      const l = Object.values(store.listings).find((x) => x.id === id);
      if (!l || l.status !== "pending") throw new ApiError(409, "This listing is not waiting for review", [{ code: "invalid_transition" }]);
      Object.assign(l, { status: "rejected", decidedAt: iso(), decisionReason: reason.trim() });
      return clone({ id: l.id, status: l.status, region: l.region, submittedAt: l.submittedAt, decidedAt: l.decidedAt, decisionReason: l.decisionReason, withdrawnAt: null });
    },
    async reusableProfile(workspaceId): Promise<ReusableProfile> {
      const { me } = await person();
      const m = me.workspaces.find((w) => w.id === workspaceId);
      if (!m || m.kind !== "applicant") throw new ApiError(403, "This action belongs to applicant workspaces", [{ code: "wrong_workspace_kind" }]);
      // The fixture applicant is linked to Passport (as the mock organization record says); any other is self-declared.
      if (FIXTURE_IDS.has(m.id)) {
        return clone({
          source: "passport" as const,
          level: "L3" as const,
          verified: true,
          fields: [
            { key: "legalName" as const, value: "Alder Creek Family Services" },
            { key: "ein" as const, value: "930000418" },
            { key: "orgType" as const, value: "Nonprofits" },
            { key: "address" as const, value: "418 Mill Road, Alder Creek, OR, 97000, US" },
            { key: "email" as const, value: "info@aldercreekfs.example" },
            { key: "website" as const, value: "https://aldercreekfs.example" },
            { key: "mission" as const, value: "Health navigation and family support for rural households in the Alder Creek valley." },
          ],
          editUrl: "https://passport.opengrants.io/orgs/alder-creek",
          editPath: null,
          verifyPath: null,
          selfDeclared: false,
        });
      }
      return clone({
        source: "self_declared" as const,
        level: null,
        verified: false,
        fields: (["legalName", "ein", "orgType", "address", "email", "website", "mission"] as const).map((key) => ({ key, value: key === "legalName" ? m.name : null })),
        editUrl: null,
        editPath: `/w/${m.handle}/settings#organization-details`,
        verifyPath: "/onboarding/applicant",
        selfDeclared: true,
      });
    },
  };
}
