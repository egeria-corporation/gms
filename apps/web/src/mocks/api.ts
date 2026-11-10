// SPDX-License-Identifier: AGPL-3.0-only
import { ApiError, type GmsApi, type Me, type MeWorkspace, type Workspace } from "../api/client.ts";
import type { Session } from "../auth/types.ts";
import { FIXTURE_WORKSPACES, MOCK_MEMBERSHIPS } from "./fixtures.ts";

export interface MockApiOptions {
  session: () => Promise<Session | null>;
  memberships?: MeWorkspace[];
  workspaces?: Workspace[];
}

/** In-browser implementation of the API port, backed by fixtures. */
export function createMockApi(opts: MockApiOptions): GmsApi {
  const memberships = opts.memberships ?? MOCK_MEMBERSHIPS;
  const workspaces = opts.workspaces ?? FIXTURE_WORKSPACES;
  const me = async (): Promise<Me> => {
    const session = await opts.session();
    if (!session) throw new ApiError(401, "Sign in to continue");
    return { userId: session.userId, email: session.email, mfaVerified: session.aal === "aal2", workspaces: memberships };
  };
  return {
    me,
    async workspace(handle) {
      const profile = await me();
      const ws = workspaces.find((w) => w.handle === handle);
      if (!ws || !profile.workspaces.some((m) => m.handle === handle)) throw new ApiError(404, "Workspace not found");
      return ws;
    },
  };
}
