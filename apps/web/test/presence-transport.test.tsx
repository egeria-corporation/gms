// SPDX-License-Identifier: AGPL-3.0-only
// The Supabase transport and the hook around it (lib/presence.ts), with supabase-js replaced by a
// stand-in that records what the client asks for: the draft's channel is private (Realtime
// Authorization), keyed by the person, takes the app's access token, stays within Realtime's 5
// presence calls per 30 seconds, and reports a refused join as paused. The hook renews its pass
// as told and leaves the channel when a renewal is refused.
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../src/api/client.ts";
import type { PresenceApi } from "../src/api/presence.ts";
import { createMockServices, ServicesProvider } from "../src/app/services.tsx";
import { createSupabaseTransport, PRESENCE_TRACK_EVERY_MS, providePresence, useDraftPresence, type LiveStatus, type PresenceMeta } from "../src/lib/presence.ts";
import { demoSession } from "../src/mocks/auth.ts";
import { createPresenceHub } from "../src/mocks/presence.ts";

interface FakeChannel {
  topic: string;
  config: unknown;
  handlers: { type: string; filter: { event: string }; cb: (p: { payload?: unknown }) => void }[];
  tracked: PresenceMeta[];
  sent: unknown[];
  subscribe?: (status: string) => void;
  state: Record<string, PresenceMeta[]>;
}
const made: { options: Record<string, unknown>; channels: FakeChannel[]; removed: FakeChannel[] } = { options: {}, channels: [], removed: [] };

vi.mock("@supabase/supabase-js", () => ({
  createClient: (_url: string, _key: string, options: Record<string, unknown>) => {
    made.options = options;
    return {
      channel(topic: string, opts: { config: unknown }) {
        const ch: FakeChannel = { topic, config: opts.config, handlers: [], tracked: [], sent: [], state: {} };
        made.channels.push(ch);
        const api = {
          on(type: string, filter: { event: string }, cb: (p: { payload?: unknown }) => void) {
            ch.handlers.push({ type, filter, cb });
            return api;
          },
          subscribe(cb: (status: string) => void) {
            ch.subscribe = cb;
            return api;
          },
          track: async (meta: PresenceMeta) => void ch.tracked.push(meta),
          send: async (m: unknown) => void ch.sent.push(m),
          presenceState: () => ch.state,
        };
        return api;
      },
      removeChannel: async (ch: unknown) => void made.removed.push(ch as FakeChannel),
    };
  },
}));

afterEach(() => {
  vi.useRealTimers();
  made.channels = [];
  made.removed = [];
});

describe("the Supabase transport", () => {
  it("joins a private channel keyed by the person, with the app's access token", async () => {
    const token = vi.fn(async () => "session-access-token");
    const statuses: LiveStatus[] = [];
    const others: PresenceMeta[][] = [];
    const t = createSupabaseTransport("https://project.supabase.test", "anon-key", token);
    const ch = t.open("draft:application:90000000-0000-7000-8000-000000000001", { userId: "u1", name: "Maria Santos" }, { presence: (o) => others.push(o), lock: () => undefined, saved: () => undefined, status: (s) => statuses.push(s) });
    const fake = made.channels[0]!;
    expect(fake.topic).toBe("draft:application:90000000-0000-7000-8000-000000000001");
    expect(fake.config).toMatchObject({ private: true, presence: { key: "u1" }, broadcast: { self: false } });
    expect(made.options.accessToken).toBe(token);
    expect(statuses).toEqual(["connecting"]);

    // Before the join nothing is sent.
    ch.send("lock", { by: "u1", field: "/need" });
    expect(fake.sent).toEqual([]);
    fake.subscribe!("SUBSCRIBED");
    expect(statuses.at(-1)).toBe("live");
    await Promise.resolve();
    expect(fake.tracked).toEqual([{ userId: "u1", name: "Maria Santos" }]);
    ch.send("lock", { by: "u1", field: "/need" });
    expect(fake.sent).toEqual([{ type: "broadcast", event: "lock", payload: { by: "u1", field: "/need" } }]);

    // Presence from the channel: everyone but this person, each with their latest place.
    fake.state = { u1: [{ userId: "u1", name: "Maria Santos" }], u2: [{ userId: "u2", name: "Lena Fischer" }, { userId: "u2", name: "Lena Fischer", field: "/need" }] };
    fake.handlers.find((h) => h.type === "presence")!.cb({});
    expect(others.at(-1)).toEqual([{ userId: "u2", name: "Lena Fischer", field: "/need" }]);

    // A refused join (no pass), a timeout or a drop: paused.
    fake.subscribe!("CHANNEL_ERROR");
    expect(statuses.at(-1)).toBe("paused");
    ch.leave();
    expect(made.removed).toHaveLength(1);
  });

  it("says where the person is at most once every 6.5 seconds, the latest place last", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const t = createSupabaseTransport("https://project.supabase.test", "anon-key", async () => "token");
    const ch = t.open("draft:outside:d1000000-0000-7000-8000-000000000001", { userId: "u1", name: "Maria Santos" }, { presence: () => undefined, lock: () => undefined, saved: () => undefined, status: () => undefined });
    const fake = made.channels[0]!;
    fake.subscribe!("SUBSCRIBED");
    expect(fake.tracked).toHaveLength(1);
    for (const field of ["q1", "q2", "q3", "q4"]) ch.track({ userId: "u1", name: "Maria Santos", field });
    expect(fake.tracked).toHaveLength(1);
    vi.advanceTimersByTime(PRESENCE_TRACK_EVERY_MS);
    expect(fake.tracked.map((m) => m.field ?? null)).toEqual([null, "q4"]);
    // Five calls in any 30 seconds at most (Supabase Realtime's limit).
    for (let i = 0; i < 20; i++) {
      ch.track({ userId: "u1", name: "Maria Santos", field: `q${i}` });
      vi.advanceTimersByTime(1000);
    }
    expect(fake.tracked.length).toBeLessThanOrEqual(2 + Math.ceil(20_000 / PRESENCE_TRACK_EVERY_MS));
    expect(30_000 / PRESENCE_TRACK_EVERY_MS).toBeLessThan(5);
    ch.leave();
  });
});

describe("the hook's pass", () => {
  it("is renewed when the pass says, and a refused renewal leaves the channel", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const services = createMockServices({ session: demoSession() });
    const hub = createPresenceHub();
    let refuse = false;
    const calls: string[] = [];
    const api: PresenceApi = {
      pass: async (_ws, draft) => {
        calls.push(draft.id);
        if (refuse) throw new ApiError(404, "Application not found");
        return { topic: "draft:application:90000000-0000-7000-8000-000000000001", expiresAt: "", renewAfterSeconds: 240, canWrite: true };
      },
    };
    providePresence(services, { api, transport: hub });
    const wrapper = ({ children }: { children: ReactNode }) => <ServicesProvider services={services}>{children}</ServicesProvider>;
    const { result, unmount } = renderHook(() => useDraftPresence({ workspaceId: "ws", draft: { kind: "application", id: "app_90000000-0000-7000-8000-000000000001" }, me: { userId: "u1", name: "Maria Santos" }, onSaved: () => undefined }), { wrapper });
    // Timers are the test's; promises and the hub's deliveries run as they come.
    const run = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));
    await run(0);
    expect(result.current.status).toBe("live");
    expect(hub.members("draft:application:90000000-0000-7000-8000-000000000001").map((m) => m.name)).toEqual(["Maria Santos"]);
    expect(calls).toHaveLength(1);

    await run(239_000);
    expect(calls).toHaveLength(1);
    await run(1_000);
    expect(calls).toHaveLength(2);
    expect(result.current.status).toBe("live");

    refuse = true;
    await run(240_000);
    expect(calls).toHaveLength(3);
    expect(result.current.status).toBe("paused");
    expect(hub.members("draft:application:90000000-0000-7000-8000-000000000001")).toEqual([]);
    unmount();
  });
});
