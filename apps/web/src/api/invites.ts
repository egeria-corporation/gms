// SPDX-License-Identifier: AGPL-3.0-only
// Invite someone into a draft (v1.7.0), for an applicant workspace: from the assignee picker of an
// outside application's question or a built-in application's section, an admin types an address
// and clicks "Send invitation". The person joins as a consultant who can open that one draft and
// write its answers, and is assigned on accepting. One email, never a reminder, no address book.
// Also the one-time notes a member dismisses ("Writing with others? Invite a teammate").
//
// `createHttpInvitesApi` calls the GMS Worker (api/invites.tsp); `createMockInvitesApi`
// (mocks/invites.ts) implements the same interface in the browser.
import { ApiError } from "./client.ts";

export type DraftKind = "outside_application" | "application";

/** The draft an invitation is for. Built-in applications name a form and section; outside ones a question. */
export interface DraftRef {
  kind: DraftKind;
  id: string;
  questionId?: string;
  formId?: string;
  section?: string;
}
export interface DraftLocation {
  kind: DraftKind;
  id: string;
  questionId: string | null;
  formId: string | null;
  section: string | null;
}
export interface DraftInvitation {
  id: string;
  /** Masked: the first character and the domain, e.g. "l…@fischergrants.example". */
  email: string;
  role: string;
  draft: DraftLocation;
  expiresAt: string;
  /** False when the email could not be sent; `acceptUrl` is then the link to pass on. */
  emailed: boolean;
  acceptUrl: string | null;
}
export interface PendingDraftInvitation {
  id: string;
  email: string;
  draft: DraftLocation;
  expiresAt: string;
  createdAt: string;
}
export interface DraftInvitationList {
  invitations: PendingDraftInvitation[];
  /** The signed-in person may invite (workspace admins). */
  canInvite: boolean;
  perDay: number;
  remainingToday: number;
}
export interface DraftLanding extends DraftLocation {
  assigned: boolean;
}
export interface InvitationAccepted {
  workspace: { handle: string; kind: "funder" | "applicant"; name: string };
  role: string;
  draft: DraftLanding | null;
}

export const INVITE_TEAMMATE_NOTE = "invite_teammate";
export type NoteKey = typeof INVITE_TEAMMATE_NOTE;

export interface InvitesApi {
  inviteToDraft(input: { email: string; draft: DraftRef }): Promise<DraftInvitation>;
  draftInvitations(kind: DraftKind, id: string): Promise<DraftInvitationList>;
  /** Redeem the link from an invitation email (`/invitations/draft?token=…`). */
  acceptDraftInvitation(token: string): Promise<InvitationAccepted>;
  dismissedNotes(): Promise<NoteKey[]>;
  dismissNote(note: NoteKey): Promise<NoteKey[]>;
}

/** Where an accepted invitation opens: the draft, with the question or section to go to. */
export function landingPath(handle: string, draft: DraftLocation | null): string {
  const base = `/w/${handle}`;
  if (!draft) return base;
  if (draft.kind === "outside_application") return `${base}/outside/${encodeURIComponent(draft.id)}?tab=questions${draft.questionId ? `&question=${encodeURIComponent(draft.questionId)}` : ""}`;
  const id = draft.id.startsWith("app_") ? draft.id : `app_${draft.id}`;
  return `${base}/applications/${encodeURIComponent(id)}/edit${draft.section ? `?section=${encodeURIComponent(draft.section)}` : ""}`;
}

const location = (raw: unknown): DraftLocation => {
  const d = (raw ?? {}) as Partial<DraftLocation>;
  return { kind: d.kind === "application" ? "application" : "outside_application", id: String(d.id ?? ""), questionId: d.questionId ?? null, formId: d.formId ?? null, section: d.section ?? null };
};

export interface HttpInvitesOptions {
  baseUrl: string;
  token: () => Promise<string | null>;
  /** The applicant workspace the calls act in (sent as `X-GMS-Workspace`). */
  workspaceId: () => string | null;
  fetch?: typeof fetch;
}

export function createHttpInvitesApi(opts: HttpInvitesOptions): InvitesApi {
  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const token = await opts.token();
    const workspaceId = opts.workspaceId();
    const res = await (opts.fetch ?? fetch)(`${opts.baseUrl}${path}`, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(workspaceId ? { "X-GMS-Workspace": workspaceId } : {}),
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const json = (await res.json().catch(() => ({}))) as { data?: T; message?: string; errors?: unknown[] };
    if (!res.ok) throw new ApiError(res.status, json.message ?? `Request failed (${res.status})`, json.errors ?? []);
    return json.data as T;
  }
  const e = encodeURIComponent;
  return {
    async inviteToDraft(input) {
      const r = await call<DraftInvitation>("POST", "/gms/draft-invitations", { email: input.email.trim(), draft: input.draft });
      return { ...r, draft: location(r.draft) };
    },
    async draftInvitations(kind, id) {
      const r = await call<DraftInvitationList>("GET", `/gms/draft-invitations?kind=${e(kind)}&id=${e(id)}`);
      return { invitations: (r.invitations ?? []).map((i) => ({ ...i, draft: location(i.draft) })), canInvite: r.canInvite === true, perDay: r.perDay, remainingToday: r.remainingToday };
    },
    async acceptDraftInvitation(token) {
      const r = await call<InvitationAccepted>("POST", "/gms/invitations/accept", { token });
      return { workspace: r.workspace, role: r.role, draft: r.draft ? { ...location(r.draft), assigned: r.draft.assigned === true } : null };
    },
    async dismissedNotes() {
      return (await call<{ dismissed: NoteKey[] }>("GET", "/gms/me/notes")).dismissed ?? [];
    },
    async dismissNote(note) {
      return (await call<{ dismissed: NoteKey[] }>("POST", "/gms/me/notes/dismiss", { note })).dismissed ?? [];
    },
  };
}
