// SPDX-License-Identifier: AGPL-3.0-only
// Mock implementation of api/digests.ts. Choices live in the page, per workspace, every digest off
// to start, as on the server. The preview is next Monday's email for the fixture workspaces, built
// from the same listings and deadlines the mock Find funding and pipeline screens show. The mock
// unsubscribe page accepts `mock_unsubscribe_<digest>` (as if from an email) and refuses anything else.
import { ApiError } from "../api/client.ts";
import type { DigestChoice, DigestKey, DigestPreview, DigestsApi, DigestSettings, DigestSettingsInput } from "../api/digests.ts";
import type { Session } from "../auth/types.ts";
import { FIXTURE_WORKSPACES, MOCK_MEMBERSHIPS } from "./fixtures.ts";

const LABEL: Record<DigestKey, string> = { new_matches: "New matches", deadlines: "Deadlines", funder_activity: "This week's activity" };
const DESCRIPTION: Record<DigestKey, string> = {
  new_matches: "Up to 10 new funding opportunities that fit your organization, from OpenGrants and from funders on this site. Never one you were already sent or saved.",
  deadlines: "Your deadlines in the next 3 weeks: applications you track here, application stages and reports due to funders.",
  funder_activity: "New applications, reviews due, payments due and reports overdue this week, as counts with links. Never an applicant's answers.",
};
/** As DIGEST_ROLES on the server. */
const ROLES: Record<DigestKey, { kind: "funder" | "applicant"; roles: string[] }> = {
  new_matches: { kind: "applicant", roles: ["admin", "editor", "finance", "viewer"] },
  deadlines: { kind: "applicant", roles: ["admin", "editor", "finance", "viewer"] },
  funder_activity: { kind: "funder", roles: ["admin", "program_officer", "finance"] },
};
const KEYS: DigestKey[] = ["new_matches", "deadlines", "funder_activity"];

export interface DigestsStore {
  /** Workspace id → the digests turned on and whether the prompt was dismissed. */
  byWorkspace: Record<string, { on: Partial<Record<DigestKey, boolean>>; promptDismissed: boolean }>;
}
export const seedDigestsStore = (): DigestsStore => ({ byWorkspace: {} });

/** The next Monday at 15:10 UTC, as the server says it. */
function nextMonday(now: Date): string {
  const ahead = (1 - now.getUTCDay() + 7) % 7;
  const before = now.getUTCHours() * 60 + now.getUTCMinutes() < 15 * 60 + 10;
  return new Date(now.getTime() + (ahead === 0 && !before ? 7 : ahead) * 86_400_000).toISOString().slice(0, 10);
}

const WEB = "https://gms.opengrants.io";
const footer = (label: string, workspace: string) =>
  [`Change which emails you get: ${WEB}/notifications`, `Stop getting this email: ${WEB}/digests/unsubscribe`, `You get this because you turned on "${label}" for ${workspace}. It comes on Mondays, and only when there is something new.`].join("\n\n");

function previewText(digest: DigestKey, workspace: string, handle: string): { subject: string; text: string } {
  if (digest === "new_matches") {
    const items = [
      `1. Rural Health Network Development Planning (Health Resources and Services Administration)\n   Deadline 2027-06-12 · Up to $100,000 · From the OpenGrants index\n   ${WEB}/w/${handle}/find`,
      `2. Family Navigation Fund (Northwind Family Foundation)\n   Deadline 2027-07-01 · $25,000 – $75,000 · From the OpenGrants index\n   ${WEB}/w/${handle}/find`,
    ];
    return { subject: `2 new funding matches for ${workspace}`, text: ["Hello,", `Here are 2 new funding opportunities that fit ${workspace}. None of them was in an earlier email or is saved yet.`, items.join("\n\n"), footer(LABEL.new_matches, workspace)].join("\n\n") };
  }
  if (digest === "deadlines") {
    const items = [`- 2027-04-30 (in 11 days): Application stage closes, Community Health Grants 2027 (Riverbend Community Foundation)\n  ${WEB}/w/${handle}/applications`, `- 2027-05-03 (in 14 days): Application due, Family Navigation Expansion (Northwind Family Foundation)\n  ${WEB}/w/${handle}/pipeline`];
    return { subject: `2 deadlines in the next 3 weeks: ${workspace}`, text: ["Hello,", `2 deadlines are coming up for ${workspace} in the next 3 weeks.`, items.join("\n"), footer(LABEL.deadlines, workspace)].join("\n\n") };
  }
  const items = [`- 4 new applications\n  Open applications: ${WEB}/w/${handle}/applications`, `- 2 reviews due\n  Open review assignments: ${WEB}/w/${handle}/reviews/assign`, `- 1 payment due\n  Open payments due: ${WEB}/w/${handle}/payments/due`];
  return { subject: `${workspace} this week: 4 new applications, 2 reviews due, 1 payment due`, text: ["Hello,", `Here is what needs your attention at ${workspace} this week.`, items.join("\n"), footer(LABEL.funder_activity, workspace)].join("\n\n") };
}

export interface MockDigestsOptions {
  session: () => Promise<Session | null>;
  store: DigestsStore;
  now?: () => Date;
}

export function createMockDigestsApi(opts: MockDigestsOptions): DigestsApi {
  const { store } = opts;
  const now = opts.now ?? (() => new Date());
  async function membership(workspaceId: string) {
    if (!(await opts.session())) throw new ApiError(401, "Sign in to continue");
    const m = MOCK_MEMBERSHIPS.find((x) => x.id === workspaceId);
    const ws = FIXTURE_WORKSPACES.find((x) => x.id === workspaceId);
    if (!m || !ws) throw new ApiError(403, "You are not a member of this workspace");
    return { m, ws, state: (store.byWorkspace[workspaceId] ??= { on: {}, promptDismissed: false }) };
  }
  const offered = (kind: string, role: string) => KEYS.filter((k) => ROLES[k].kind === kind && ROLES[k].roles.includes(role));
  const view = (kind: string, role: string, state: DigestsStore["byWorkspace"][string]): DigestSettings => ({
    digests: offered(kind, role).map((key): DigestChoice => ({ key, label: LABEL[key], description: DESCRIPTION[key], on: !!state.on[key] })),
    promptDismissed: state.promptDismissed,
    nextSendOn: nextMonday(now()),
    emailAvailable: true,
  });
  return {
    async settings(workspaceId) {
      const { m, state } = await membership(workspaceId);
      return view(m.kind, m.role, state);
    },
    async save(workspaceId, input: DigestSettingsInput) {
      const { m, state } = await membership(workspaceId);
      for (const k of KEYS) {
        const v = input[k];
        if (v === undefined) continue;
        if (v && !offered(m.kind, m.role).includes(k)) throw new ApiError(422, `"${LABEL[k]}" is not offered to you in this workspace`);
        state.on[k] = v;
      }
      if (input.promptDismissed) state.promptDismissed = true;
      return view(m.kind, m.role, state);
    },
    async preview(workspaceId, digest): Promise<DigestPreview> {
      const { m, ws, state } = await membership(workspaceId);
      if (!offered(m.kind, m.role).includes(digest)) throw new ApiError(422, `"${LABEL[digest]}" is not offered to you in this workspace`);
      const made = previewText(digest, ws.name, ws.handle);
      return { digest, label: LABEL[digest], on: !!state.on[digest], sendsOn: nextMonday(now()), willSend: true, ...made };
    },
    async unsubscribe(token) {
      const m = /^mock_unsubscribe_(new_matches|deadlines|funder_activity)$/.exec(token);
      if (!m) throw new ApiError(400, "This unsubscribe link is not valid. Sign in to change which emails you get.");
      const digest = m[1] as DigestKey;
      const ws = FIXTURE_WORKSPACES.find((w) => w.kind === ROLES[digest].kind)!;
      (store.byWorkspace[ws.id] ??= { on: {}, promptDismissed: false }).on[digest] = false;
      return { digest, label: LABEL[digest], workspace: ws.name, on: false };
    },
  };
}
