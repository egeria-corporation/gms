// SPDX-License-Identifier: AGPL-3.0-only
// Mock implementation of api/launch.ts. Payments through Passport start switched off, as they do
// on an install whose Passport is not yet taking live payments; tests flip `store.config`.
import { ApiError } from "../api/client.ts";
import type { AccountSession, AppConfig, BudgetCategoryMapping, FunderContact, InterviewState, LaunchApi, MemberActivity, ProgramOutcomes, ProgramOwner, Representatives, SignatureRecord } from "../api/launch.ts";
import type { Session } from "../auth/types.ts";
import { IDS } from "./store.ts";

export interface LaunchStore {
  config: AppConfig;
  sessions: AccountSession[];
  owners: Record<string, ProgramOwner>;
  outcomes: Record<string, ProgramOutcomes>;
  budgetCategories: Record<string, string[]>;
  representatives: Representatives;
  interviews: Record<string, InterviewState>;
  mappings: Record<string, BudgetCategoryMapping[]>;
  activity: MemberActivity[];
  /** Keyed by funder handle. */
  contacts: Record<string, FunderContact[]>;
  /** The handle whose contacts the signed-in funder edits. */
  ownHandle: string;
  /** People in the funder's Google directory. */
  directory: { name: string; email: string }[];
  /** Signature rows per award id; an award without an entry has none recorded here. */
  signatures: Record<string, SignatureRecord[]>;
  exports: { kind: string; id: string; folderId: string }[];
}

/** The demo people, as the fixture workspaces name them. */
export const LAUNCH_PEOPLE = {
  dana: { userId: "10000000-0000-4000-8000-000000000001", name: "Dana Ortiz" },
  marcus: { userId: "10000000-0000-4000-8000-000000000002", name: "Marcus Lee" },
  priya: { userId: "10000000-0000-4000-8000-000000000003", name: "Priya Natarajan" },
};

const DEFAULT_CATEGORIES = ["Personnel", "Travel & vehicle", "Supplies", "Indirect (10% cap)"];

export function seedLaunchStore(): LaunchStore {
  return {
    config: { facilitatedPayments: false, passport: { signIn: true, linking: true, payments: false }, available: { openGrants: true, assistant: true, googleWorkspace: true, mercury: true, customMcp: true } },
    sessions: [
      { id: "5e000000-0000-7000-8000-000000000001", createdAt: "2027-04-20T15:02:00Z", lastActiveAt: "2027-04-20T16:40:00Z", device: "Chrome on macOS", ip: "203.0.113.24", mfa: true, current: true },
      { id: "5e000000-0000-7000-8000-000000000002", createdAt: "2027-04-18T02:11:00Z", lastActiveAt: "2027-04-19T21:05:00Z", device: "Safari on iPhone", ip: "198.51.100.7", mfa: true, current: false },
    ],
    owners: {
      [IDS.programHealth27]: { ...LAUNCH_PEOPLE.dana },
      [IDS.programHealth26]: { ...LAUNCH_PEOPLE.priya },
    },
    outcomes: {
      [IDS.programHealth26]: {
        reportsAccepted: 4,
        totals: [
          { key: "families_served", label: "Families served", total: 1284, unit: null },
          { key: "appointments_kept", label: "Appointments kept", total: 3960, unit: null },
          { key: "miles_travelled", label: "Transport provided", total: 41200, unit: "miles" },
        ],
      },
    },
    budgetCategories: { [IDS.programHealth27]: [...DEFAULT_CATEGORIES] },
    representatives: {
      state: "ok",
      items: [
        { name: "Maria Santos", title: "Executive Director", verified: true, verifiedAt: "2027-01-12T17:00:00Z" },
        { name: "Jamal Reed", title: "Board Treasurer", verified: true, verifiedAt: "2027-01-12T17:00:00Z" },
        { name: "Lena Fischer", title: "Finance consultant", verified: false, verifiedAt: null },
      ],
      manageUrl: "https://app.passport.opengrants.io/",
    },
    interviews: {
      // The demo application: Riverbend has offered three times for the week of May 3.
      "app_90000000-0000-7000-8000-000000000001": {
        proposed: { slots: ["2027-05-04T17:00:00Z", "2027-05-05T20:30:00Z", "2027-05-06T16:00:00Z"], note: "Thanks for the revised budget. We would like 45 minutes with you and your program lead.", location: "Video call; the link arrives with the confirmation.", at: "2027-04-20T15:00:00Z" },
        confirmed: null,
      },
    },
    mappings: {},
    // Keyed to the demo applicant workspace's people (mocks/applicant.ts).
    activity: [
      { userId: "10000000-0000-4000-8000-000000000001", lastActiveAt: "2027-04-20T16:35:00Z", organization: null },
      { userId: "10000000-0000-4000-8000-000000000012", lastActiveAt: "2027-04-19T22:10:00Z", organization: null },
      { userId: "10000000-0000-4000-8000-000000000013", lastActiveAt: "2027-04-17T18:00:00Z", organization: "Fischer Grants Consulting" },
    ],
    contacts: {
      riverbend: [
        { name: "Dana Ortiz", title: "Program officer", email: "grants@riverbendcf.example", phone: null, public: true },
        { name: "Marcus Lee", title: "Finance", email: "finance@riverbendcf.example", phone: null, public: false },
      ],
      "cascade-county": [{ name: "Grants Office", title: null, email: "grants@cascadecounty.example", phone: null, public: true }],
    },
    ownHandle: "riverbend",
    directory: [
      { name: "Priya Natarajan", email: "priya.natarajan@riverbendcf.example" },
      { name: "Marcus Lee", email: "marcus.lee@riverbendcf.example" },
      { name: "Helen Park", email: "helen.park@riverbendcf.example" },
    ],
    signatures: {},
    exports: [],
  };
}

export interface MockLaunchOptions {
  session: () => Promise<Session | null>;
  store?: LaunchStore;
  now?: () => Date;
}

const clone = <T>(v: T): T => structuredClone(v);

export function createMockLaunchApi(opts: MockLaunchOptions): LaunchApi {
  const store = opts.store ?? seedLaunchStore();
  const now = () => (opts.now ?? (() => new Date()))().toISOString();
  const me = async () => {
    const s = await opts.session();
    if (!s) throw new ApiError(401, "Sign in to continue");
    return s;
  };
  const interviewOf = (id: string): InterviewState => store.interviews[id] ?? { proposed: null, confirmed: null };

  return {
    async config() {
      return clone(store.config);
    },

    async sessions() {
      await me();
      return clone(store.sessions);
    },
    async signOutSession(id) {
      await me();
      const s = store.sessions.find((x) => x.id === id);
      if (!s) throw new ApiError(404, "Session not found");
      if (s.current) throw new ApiError(409, "Sign out to end this session");
      store.sessions = store.sessions.filter((x) => x.id !== id);
      return { ended: true };
    },

    async programOwners() {
      await me();
      return clone(store.owners);
    },
    async setProgramOwner(programId, userId) {
      await me();
      if (!userId) {
        delete store.owners[programId];
        return null;
      }
      const person = Object.values(LAUNCH_PEOPLE).find((p) => p.userId === userId);
      store.owners[programId] = { userId, name: person?.name ?? "Team member" };
      return clone(store.owners[programId]!);
    },
    async programOutcomes(programId) {
      await me();
      return clone(store.outcomes[programId] ?? { reportsAccepted: 0, totals: [] });
    },
    async budgetCategories(programId) {
      await me();
      return clone(store.budgetCategories[programId] ?? []);
    },
    async putBudgetCategories(programId, categories) {
      await me();
      const cleaned = [...new Set(categories.map((c) => c.trim()).filter(Boolean))];
      store.budgetCategories[programId] = cleaned;
      return clone(cleaned);
    },

    async representatives() {
      await me();
      return clone(store.representatives);
    },

    async interview(applicationId) {
      await me();
      return clone(interviewOf(applicationId));
    },
    async proposeInterview(applicationId, proposal) {
      await me();
      if (proposal.slots.length < 1 || proposal.slots.length > 10) throw new ApiError(400, "Offer between one and ten times");
      store.interviews[applicationId] = { proposed: { slots: [...proposal.slots], note: proposal.note?.trim() || null, location: proposal.location?.trim() || null, at: now() }, confirmed: null };
      return clone(interviewOf(applicationId));
    },
    async confirmInterview(applicationId, slot) {
      await me();
      const state = interviewOf(applicationId);
      if (!state.proposed) throw new ApiError(409, "No interview times have been offered yet");
      if (!state.proposed.slots.includes(slot)) throw new ApiError(422, "Choose one of the times the funder offered");
      store.interviews[applicationId] = { ...state, confirmed: { slot, at: now() } };
      return clone(interviewOf(applicationId));
    },

    async budgetMapping(awardId) {
      await me();
      return clone(store.mappings[awardId] ?? []);
    },
    async putBudgetMapping(awardId, mapping) {
      await me();
      store.mappings[awardId] = mapping.map((m) => ({ category: m.category, ownCategory: m.ownCategory.trim() })).filter((m) => m.ownCategory);
      return clone(store.mappings[awardId]!);
    },

    async memberActivity() {
      await me();
      return clone(store.activity);
    },
    async contacts() {
      await me();
      return clone(store.contacts[store.ownHandle] ?? []);
    },
    async putContacts(contacts) {
      await me();
      for (const c of contacts) {
        if (!c.name.trim()) throw new ApiError(400, "Each contact needs a name", [{ field: "name", message: "Enter a name" }]);
        if (!/^\S+@\S+\.\S+$/.test(c.email)) throw new ApiError(400, "Each contact needs an email address", [{ field: "email", message: "Enter an email address" }]);
      }
      store.contacts[store.ownHandle] = contacts.map((c) => ({ ...c, name: c.name.trim(), email: c.email.trim(), title: c.title?.trim() || null, phone: c.phone?.trim() || null }));
      return clone(store.contacts[store.ownHandle]!);
    },
    async funderContacts(funderHandle) {
      await me();
      return clone(store.contacts[funderHandle] ?? []);
    },
    async publicContacts(funderHandle) {
      // The public page shows only the contacts the funder marked public.
      return clone((store.contacts[funderHandle] ?? []).filter((c) => c.public));
    },

    async signatures(awardId) {
      await me();
      return clone(store.signatures[awardId] ?? []);
    },

    async exportToDrive(kind, id, folderId) {
      await me();
      if (!folderId) throw new ApiError(400, "Choose a Drive folder");
      store.exports.push({ kind, id, folderId });
      const fileName = kind === "agreement" ? "Grant agreement.pdf" : "Award letter.pdf";
      return { fileName, url: `https://drive.google.com/drive/folders/${encodeURIComponent(folderId)}` };
    },
    async directorySuggest(query) {
      await me();
      const q = query.trim().toLowerCase();
      if (q.length < 2) return [];
      return clone(store.directory.filter((p) => p.name.toLowerCase().includes(q) || p.email.toLowerCase().includes(q)));
    },
  };
}
