// SPDX-License-Identifier: AGPL-3.0-only
// In-browser guest reviewer loop for mock mode and tests. A guest invited by Riverbend has three
// applications to review; one invited by Cascade County has submitted both of theirs, so its done
// screen shows the offer. The same rules as the server: an external reviewer's only, the offer
// once, a dismissal for good, nobody who already runs a funder workspace is offered one.
import { ApiError } from "../api/client.ts";
import type { MeWorkspace } from "../api/client.ts";
import type { GuestReviewApi, GuestWelcome, PanelOfferEvent, PanelSuggestion } from "../api/guestReview.ts";
import type { Session } from "../auth/types.ts";
import { IDS } from "./store.ts";

export const GUEST_ROLE = "external_reviewer";
export const PANEL_OFFER_SHOWS = 1;

interface Fixture {
  funder: { name: string; handle: string };
  competition: { id: string; title: string; opportunityTitle: string };
  assigned: number;
  submitted: number;
  dueAt: string;
}
const FIXTURES: Record<string, Fixture> = {
  [IDS.riverbend]: { funder: { name: "Riverbend Community Foundation", handle: "riverbend" }, competition: { id: "cmp_mock_guest_1", title: "Community Health Grants 2027: letters of intent", opportunityTitle: "Community Health Grants 2027" }, assigned: 3, submitted: 0, dueAt: "2026-12-04T23:59:00.000Z" },
  [IDS.cascade]: { funder: { name: "Cascade County Health Department", handle: "cascade-county" }, competition: { id: "cmp_mock_guest_2", title: "Clinic Capacity Fund 2026", opportunityTitle: "Clinic Capacity Fund 2026" }, assigned: 2, submitted: 2, dueAt: "2026-11-10T23:59:00.000Z" },
};

export interface GuestReviewStore {
  events: { event: PanelOfferEvent; at: string; workspaceId?: string }[];
}
export const seedGuestReviewStore = (): GuestReviewStore => ({ events: [] });

const SHARED = new Set(["gmail.com", "googlemail.com", "yahoo.com", "outlook.com", "hotmail.com", "live.com", "icloud.com", "me.com", "aol.com", "proton.me", "protonmail.com"]);
export function mockSuggestion(email: string): PanelSuggestion | null {
  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain || SHARED.has(domain)) return null;
  const label = domain.split(".").at(-2);
  if (!label) return null;
  return { domain, name: label.split("-").map((w) => w[0]!.toUpperCase() + w.slice(1)).join(" "), handle: label.length >= 3 ? label : `${label}-reviews` };
}

export interface MockGuestReviewOptions {
  session: () => Promise<Session | null>;
  memberships: () => MeWorkspace[];
  store?: GuestReviewStore;
  now?: () => Date;
}

export function createMockGuestReviewApi(opts: MockGuestReviewOptions): GuestReviewApi & { store: GuestReviewStore } {
  const store = opts.store ?? seedGuestReviewStore();
  const now = () => (opts.now ?? (() => new Date()))().toISOString();
  async function guest(workspaceId: string) {
    const session = await opts.session();
    if (!session) throw new ApiError(401, "Sign in to continue");
    const m = opts.memberships().find((x) => x.id === workspaceId);
    if (!m) throw new ApiError(403, "You are not a member of this workspace");
    if (m.role !== GUEST_ROLE) throw new ApiError(403, `This needs one of these roles: ${GUEST_ROLE}`);
    const f = FIXTURES[workspaceId];
    if (!f) throw new ApiError(404, "Workspace not found");
    return { session, f };
  }
  const count = (e: PanelOfferEvent) => store.events.filter((x) => x.event === e).length;
  return {
    store,
    async welcome(workspaceId) {
      const { f } = await guest(workspaceId);
      const open = f.assigned - f.submitted;
      const start = `/review/assignments?ws=${f.funder.handle}`;
      const w: GuestWelcome = {
        funder: f.funder,
        competitions: [{ ...f.competition, assigned: f.assigned, submitted: f.submitted, open, dueAt: f.dueAt }],
        assigned: f.assigned,
        submitted: f.submitted,
        open,
        dueAt: f.dueAt,
        coi: { note: "Before an application opens, you are asked whether you have a conflict of interest with the organization. If you do, you step aside from it and it never opens for you.", link: start },
        startUrl: start,
        done: open === 0 && f.submitted > 0,
      };
      return structuredClone(w);
    },
    async done(workspaceId) {
      const { session, f } = await guest(workspaceId);
      const done = f.assigned - f.submitted === 0 && f.submitted > 0;
      const spent = count("dismissed") > 0 || count("clicked") > 0 || count("created") > 0 || count("shown") >= PANEL_OFFER_SHOWS;
      const runs = opts.memberships().some((m) => m.kind === "funder" && (m.role === "admin" || m.role === "program_officer"));
      const show = done && !spent && !runs;
      return { funder: f.funder, done, submitted: f.submitted, assigned: f.assigned, open: f.assigned - f.submitted, offer: show ? { show: true, suggestion: mockSuggestion(session.email) } : { show: false, suggestion: null } };
    },
    async offer(workspaceId, event, createdWorkspaceId) {
      await guest(workspaceId);
      if (count(event) >= (event === "shown" ? PANEL_OFFER_SHOWS : 1)) return { event, counted: false };
      // The server checks the person admins the new funder workspace; the mock's memberships are read before it is made.
      if (event === "created" && !createdWorkspaceId) throw new ApiError(422, "That is not a funder workspace you just set up");
      store.events.push({ event, at: now(), ...(createdWorkspaceId ? { workspaceId: createdWorkspaceId } : {}) });
      return { event, counted: true };
    },
  };
}
