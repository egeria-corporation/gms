// SPDX-License-Identifier: AGPL-3.0-only
// The digests port: the HTTP client names the workspace on every call and sends no sign-in with the
// unsubscribe token; the mock keeps every digest off until turned on and offers each by role.
import { describe, expect, it } from "vitest";
import { createHttpDigestsApi, mondayLabel, unsubscribeTokenFrom } from "../src/api/digests.ts";
import { createMockDigestsApi, seedDigestsStore } from "../src/mocks/digests.ts";
import { FIXTURE_WORKSPACES, MOCK_USER } from "../src/mocks/fixtures.ts";

const session = async () => ({ accessToken: "t", email: MOCK_USER.email, userId: MOCK_USER.userId }) as never;

describe("digests port", () => {
  it("names the workspace, and unsubscribes without a sign-in", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ data: {} }), { status: 200 });
    }) as unknown as typeof globalThis.fetch;
    const api = createHttpDigestsApi({ baseUrl: "https://gms.test", token: async () => "session-token", fetch });
    await api.save("ws-1", { new_matches: true });
    await api.preview("ws-1", "deadlines");
    await api.unsubscribe("v1.abc");
    expect(calls.map((c) => [c.init.method, c.url])).toEqual([
      ["PUT", "https://gms.test/gms/digests"],
      ["GET", "https://gms.test/gms/digests/preview?digest=deadlines"],
      ["POST", "https://gms.test/gms/digests/unsubscribe"],
    ]);
    expect(calls[0]!.init.headers).toMatchObject({ Authorization: "Bearer session-token", "X-GMS-Workspace": "ws-1" });
    expect(calls[2]!.init.headers).not.toHaveProperty("Authorization");
    expect(calls[2]!.init.headers).not.toHaveProperty("X-GMS-Workspace");
  });

  it("reads the token from the fragment first", () => {
    expect(unsubscribeTokenFrom("#token=v1.a.b", "?token=other")).toBe("v1.a.b");
    expect(unsubscribeTokenFrom("", "?token=v1.c")).toBe("v1.c");
    expect(unsubscribeTokenFrom("", "")).toBeNull();
    expect(mondayLabel("2027-04-19")).toBe("Monday, April 19");
  });

  it("mock: every digest starts off, and each is offered by workspace kind and role", async () => {
    const api = createMockDigestsApi({ session, store: seedDigestsStore(), now: () => new Date("2027-04-16T17:00:00Z") });
    const applicant = FIXTURE_WORKSPACES[2]!.id;
    const settings = await api.settings(applicant);
    expect(settings.digests.map((d) => [d.key, d.on])).toEqual([
      ["new_matches", false],
      ["deadlines", false],
    ]);
    expect(settings.nextSendOn).toBe("2027-04-19");
    await expect(api.save(applicant, { funder_activity: true })).rejects.toThrow(/not offered/);
    expect((await api.settings(FIXTURE_WORKSPACES[1]!.id)).digests).toEqual([]);
    expect((await api.save(applicant, { new_matches: true, promptDismissed: true })).promptDismissed).toBe(true);
    expect((await api.preview(applicant, "new_matches")).subject).toBe("2 new funding matches for Alder Creek Family Services");
  });
});
