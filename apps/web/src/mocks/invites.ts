// SPDX-License-Identifier: AGPL-3.0-only
// Mock implementation of api/invites.ts. Invitations live in the page, next to the applicant and
// outside-application stores, so an accepted invitation assigns a real question or section. One
// invitation is seeded for the demo person (token `gms_inv_mock_cowriter`), into the Northwind
// application's third question, so the landing can be seen: open /invitations/draft?token=gms_inv_mock_cowriter.
import type { Session } from "../auth/types.ts";
import { ApiError } from "../api/client.ts";
import { INVITE_TEAMMATE_NOTE, type DraftInvitationList, type DraftLocation, type DraftRef, type InvitesApi, type NoteKey } from "../api/invites.ts";
import { maskEmail } from "../lib/directAward.ts";
import { APPLICANT_IDS, type ApplicantStore } from "./applicant.ts";
import { MOCK_USER } from "./fixtures.ts";
import { OUTSIDE_IDS, type OutsideStore } from "./outside.ts";

/** As on the server (INVITATIONS_PER_DAY). */
const PER_DAY = 20;
const DAY_MS = 86_400_000;

interface MockInvitation {
  id: string;
  token: string;
  email: string;
  draft: DraftLocation;
  createdAt: string;
  expiresAt: string;
  acceptedAt: string | null;
}

export interface InvitesStore {
  invitations: MockInvitation[];
  dismissed: NoteKey[];
}

export const MOCK_COWRITER_TOKEN = "gms_inv_mock_cowriter";

export function seedInvitesStore(now = new Date()): InvitesStore {
  return {
    invitations: [
      {
        id: "inv_m0000000-0000-7000-8000-000000000001",
        token: MOCK_COWRITER_TOKEN,
        email: MOCK_USER.email,
        draft: { kind: "outside_application", id: OUTSIDE_IDS.northwind, questionId: "oqn_d3000000-0000-7000-8000-000000000003", formId: null, section: null },
        // Older than a day, so it does not count against today's twenty.
        createdAt: new Date(now.getTime() - 2 * DAY_MS).toISOString(),
        expiresAt: new Date(now.getTime() + 12 * DAY_MS).toISOString(),
        acceptedAt: null,
      },
    ],
    dismissed: [],
  };
}

export interface MockInvitesOptions {
  session: () => Promise<Session | null>;
  applicant: ApplicantStore;
  outside: OutsideStore;
  store: InvitesStore;
  now?: () => Date;
  /** The acting person in the applicant workspace. */
  actor?: { userId: string };
}

const fail = (status: number, message: string, field?: string) => new ApiError(status, message, field ? [{ field, detail: message }] : []);

export function createMockInvitesApi(opts: MockInvitesOptions): InvitesApi {
  const { store } = opts;
  const now = () => (opts.now ?? (() => new Date()))();
  const actor = opts.actor ?? { userId: APPLICANT_IDS.maria };
  async function signedIn(): Promise<Session> {
    const s = await opts.session();
    if (!s) throw new ApiError(401, "Sign in to continue");
    return s;
  }
  const pending = (i: MockInvitation) => !i.acceptedAt && Date.parse(i.expiresAt) > now().getTime();
  const bareApp = (id: string) => id.replace(/^app_/, "");
  const location = (d: DraftRef): DraftLocation => ({ kind: d.kind, id: d.kind === "application" ? `app_${bareApp(d.id)}` : d.id, questionId: d.questionId ?? null, formId: d.formId ?? null, section: d.section ?? null });
  const sameDraft = (a: DraftLocation, kind: string, id: string) => a.kind === kind && (a.kind === "application" ? bareApp(a.id) === bareApp(id) : a.id === id);

  function checkDraft(d: DraftRef) {
    if (d.kind === "outside_application") {
      const app = opts.outside.applications.find((a) => a.id === d.id);
      if (!app) throw fail(404, "Outside application not found");
      if (app.archivedAt) throw fail(409, "This application is archived. Unarchive it to change it");
      if (d.questionId && !app.questions.some((q) => q.id === d.questionId)) throw fail(404, "Question not found");
      return;
    }
    const app = opts.applicant.applications.find((a) => a.uuid === bareApp(d.id));
    if (!app) throw fail(404, "Application not found");
    if (app.status !== "draft" && app.status !== "revision_requested") throw fail(409, `This application is ${app.status.replace(/_/g, " ")}; invite someone while it is being written`);
  }

  return {
    async inviteToDraft(input) {
      await signedIn();
      const email = input.email.trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw fail(422, "Enter an email address, like name@example.org", "email");
      checkDraft(input.draft);
      if (opts.applicant.members.some((m) => m.email?.toLowerCase() === email)) throw fail(409, "That person is already on your team. Choose them from the list instead", "email");
      const open = store.invitations.find((i) => i.email === email && pending(i));
      if (open) throw fail(409, `${maskEmail(email)} already has an invitation waiting. It works until ${open.expiresAt.slice(0, 10)}; nothing more is sent`, "email");
      const since = now().getTime() - DAY_MS;
      if (store.invitations.filter((i) => Date.parse(i.createdAt) > since).length >= PER_DAY) throw fail(429, `Your workspace has sent ${PER_DAY} invitations in the last 24 hours, the most allowed in a day. Try again tomorrow`);
      const at = now();
      const inv: MockInvitation = { id: crypto.randomUUID(), token: `gms_inv_${crypto.randomUUID().replace(/-/g, "")}`, email, draft: location(input.draft), createdAt: at.toISOString(), expiresAt: new Date(at.getTime() + 14 * DAY_MS).toISOString(), acceptedAt: null };
      store.invitations.push(inv);
      return { id: inv.id, email: maskEmail(email), role: "consultant", draft: inv.draft, expiresAt: inv.expiresAt, emailed: true, acceptUrl: null };
    },
    async draftInvitations(kind, id): Promise<DraftInvitationList> {
      await signedIn();
      const since = now().getTime() - DAY_MS;
      const used = store.invitations.filter((i) => Date.parse(i.createdAt) > since).length;
      return {
        invitations: store.invitations.filter((i) => pending(i) && sameDraft(i.draft, kind, id)).map((i) => ({ id: i.id, email: maskEmail(i.email), draft: i.draft, expiresAt: i.expiresAt, createdAt: i.createdAt })),
        canInvite: true,
        perDay: PER_DAY,
        remainingToday: Math.max(0, PER_DAY - used),
      };
    },
    async acceptDraftInvitation(token) {
      const session = await signedIn();
      const inv = store.invitations.find((i) => i.token === token);
      if (!inv || !pending(inv)) throw fail(404, "Invitation not found");
      if (session.email.toLowerCase() !== inv.email) throw fail(403, `Sign in with the address the invitation was sent to: ${maskEmail(inv.email)}`);
      inv.acceptedAt = now().toISOString();
      let assigned = false;
      if (inv.draft.kind === "outside_application") {
        const q = opts.outside.applications.find((a) => a.id === inv.draft.id)?.questions.find((x) => x.id === inv.draft.questionId);
        if (q && !q.assigneeUserId) {
          q.assigneeUserId = actor.userId;
          assigned = true;
        }
      } else if (inv.draft.formId && inv.draft.section) {
        const app = opts.applicant.applications.find((a) => a.uuid === bareApp(inv.draft.id));
        const owners = app ? (app.sections[inv.draft.formId.replace(/^frm_/, "")] ??= {}) : null;
        if (owners && !owners[inv.draft.section]) {
          owners[inv.draft.section] = actor.userId;
          assigned = true;
        }
      }
      return { workspace: { handle: "alder-creek", kind: "applicant", name: "Alder Creek Family Services" }, role: "admin", draft: { ...inv.draft, assigned } };
    },
    async dismissedNotes() {
      await signedIn();
      return [...store.dismissed];
    },
    async dismissNote(note) {
      await signedIn();
      if (note !== INVITE_TEAMMATE_NOTE) throw fail(400, "Unknown note");
      if (!store.dismissed.includes(note)) store.dismissed.push(note);
      return [...store.dismissed];
    },
  };
}
