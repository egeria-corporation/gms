// SPDX-License-Identifier: AGPL-3.0-only
// Mock mode and tests for live co-editing (lib/presence.ts): the pass port, answered in the page,
// and an in-page hub that behaves like the draft's private Realtime channel. Every editor opened
// from the same hub sees the others; a hub can refuse a join, as Realtime refuses a session without
// a pass, and can go offline, as a dropped connection does.
//
// End-to-end tests run two browser contexts, which share nothing. When the page has a relay
// (`window.__gmsPresenceRelay`, put there by the test before the app loads), the hub mirrors its
// channels through it, and, because each page keeps its own mock data, a saved nudge carries a copy
// of the saved answer for the other page's mock store. Only the mock does that: the real channel
// carries no answers, and the real editor reads them through the API.
import type { ApplicantStore } from "./applicant.ts";
import type { OutsideStore } from "./outside.ts";
import type { PresenceApi, PresencePass } from "../api/presence.ts";
import { ApiError } from "../api/client.ts";
import type { Session } from "../auth/types.ts";
import type { ChannelHandlers, LiveStatus, LockMessage, PresenceChannel, PresenceMeta, PresenceTransport, SavedMessage } from "../lib/presence.ts";

const bare = (id: string) => id.replace(/^(app|oap)_/, "");

/** Passes for any draft id while someone is signed in; `refuse` names drafts (or a rule) that are refused with a 404. */
export function createMockPresenceApi(opts: { session: () => Promise<Session | null>; refuse?: (draftId: string) => boolean; canWrite?: boolean; renewAfterSeconds?: number }): PresenceApi {
  return {
    async pass(_workspaceId, draft): Promise<PresencePass> {
      if (!(await opts.session())) throw new ApiError(401, "Sign in to continue", [{ code: "missing_token" }]);
      if (opts.refuse?.(draft.id)) throw new ApiError(404, "Application not found", [{ code: "not_found" }]);
      return {
        topic: `draft:${draft.kind === "application" ? "application" : "outside"}:${bare(draft.id)}`,
        expiresAt: new Date(Date.now() + 600_000).toISOString(),
        renewAfterSeconds: opts.renewAfterSeconds ?? 240,
        canWrite: opts.canWrite ?? true,
      };
    },
  };
}

// ------------------------------------------------------------------------------------ the hub

interface Member {
  key: string;
  meta: PresenceMeta;
  /** Local members only; a member mirrored from another page has none. */
  handlers: ChannelHandlers | null;
  online: boolean;
}
type Wire =
  | { t: "hello" | "here" | "track"; topic: string; from: string; meta: PresenceMeta }
  | { t: "bye"; topic: string; from: string }
  | { t: "send"; topic: string; from: string; event: "lock" | "saved"; payload: LockMessage | SavedMessage; copy?: unknown };
export interface PresenceRelay {
  send(message: string): void;
  listen(receive: (message: string) => void): void;
}
interface StoreSync {
  copy(topic: string, saved: SavedMessage): unknown;
  apply(topic: string, saved: SavedMessage, copy: unknown): void;
}

export interface PresenceHub extends PresenceTransport {
  /** Refuse joins the way Realtime refuses a session without a pass. */
  authorize: (topic: string, me: PresenceMeta) => boolean;
  /** Take the hub offline (every channel reports "paused" and delivers nothing) or back. */
  setOnline(online: boolean): void;
  /** Who is on a topic (tests). */
  members(topic: string): PresenceMeta[];
}

let seq = 0;

/** An in-page hub. Delivery is asynchronous (a microtask), as over the network. */
export function createPresenceHub(opts: { authorize?: (topic: string, me: PresenceMeta) => boolean; relay?: PresenceRelay | null; sync?: StoreSync | null } = {}): PresenceHub {
  const page = `p${Math.random().toString(36).slice(2, 8)}`;
  const rooms = new Map<string, Map<string, Member>>();
  let online = true;
  const later = (fn: () => void) => queueMicrotask(fn);
  const room = (topic: string) => {
    let r = rooms.get(topic);
    if (!r) rooms.set(topic, (r = new Map()));
    return r;
  };
  const sync = (topic: string) => {
    const r = room(topic);
    for (const m of r.values()) {
      if (!m.handlers || !m.online || !online) continue;
      const others = [...r.values()].filter((o) => o !== m && (o.online || !o.handlers)).map((o) => ({ ...o.meta }));
      m.handlers.presence(others);
    }
  };
  const deliver = (topic: string, fromKey: string, event: "lock" | "saved", payload: LockMessage | SavedMessage) => {
    for (const m of room(topic).values()) {
      if (m.key === fromKey || !m.handlers || !m.online || !online) continue;
      if (event === "lock") m.handlers.lock({ ...(payload as LockMessage) });
      else m.handlers.saved({ ...(payload as SavedMessage) });
    }
  };
  const wire = (w: Wire) => opts.relay?.send(JSON.stringify(w));
  opts.relay?.listen((text) => {
    let w: Wire;
    try {
      w = JSON.parse(text) as Wire;
    } catch {
      return;
    }
    const r = room(w.topic);
    const key = `${w.from}`;
    if (w.t === "hello" || w.t === "here" || w.t === "track") {
      r.set(key, { key, meta: w.meta, handlers: null, online: true });
      // A page that just opened the channel learns who is already here.
      if (w.t === "hello") for (const m of r.values()) if (m.handlers && m.online) wire({ t: "here", topic: w.topic, from: m.key, meta: m.meta });
      later(() => sync(w.topic));
    } else if (w.t === "bye") {
      r.delete(key);
      later(() => sync(w.topic));
    } else if (w.t === "send") {
      if (w.event === "saved" && w.copy !== undefined) opts.sync?.apply(w.topic, w.payload as SavedMessage, w.copy);
      later(() => deliver(w.topic, key, w.event, w.payload));
    }
  });

  const hub: PresenceHub = {
    authorize: opts.authorize ?? (() => true),
    setOnline(next) {
      online = next;
      for (const [topic, r] of rooms) {
        for (const m of r.values()) if (m.handlers && m.online) m.handlers.status(next ? "live" : "paused");
        if (next) sync(topic);
      }
    },
    members: (topic) => [...room(topic).values()].map((m) => ({ ...m.meta })),
    open(topic, me, handlers): PresenceChannel {
      const key = `${page}-${++seq}`;
      const allowed = hub.authorize(topic, me);
      const member: Member = { key, meta: { ...me }, handlers, online: allowed };
      later(() => handlers.status("connecting"));
      if (!allowed) {
        // Refused: nothing joins and nothing is ever delivered to this channel.
        later(() => handlers.status("paused"));
        return { track: () => undefined, send: () => undefined, leave: () => undefined };
      }
      const r = room(topic);
      r.set(key, member);
      wire({ t: "hello", topic, from: key, meta: member.meta });
      later(() => {
        if (!r.has(key)) return;
        handlers.status(online ? "live" : ("paused" satisfies LiveStatus));
        sync(topic);
      });
      return {
        track(meta) {
          if (!r.has(key)) return;
          member.meta = { ...meta };
          wire({ t: "track", topic, from: key, meta: member.meta });
          later(() => sync(topic));
        },
        send(event: "lock" | "saved", payload: LockMessage | SavedMessage) {
          if (!r.has(key) || !online) return;
          const copy = event === "saved" && opts.relay ? opts.sync?.copy(topic, payload as SavedMessage) : undefined;
          wire({ t: "send", topic, from: key, event, payload, ...(copy !== undefined ? { copy } : {}) });
          later(() => deliver(topic, key, event, payload));
        },
        leave() {
          if (!r.delete(key)) return;
          wire({ t: "bye", topic, from: key });
          later(() => sync(topic));
        },
      };
    },
  };
  return hub;
}

// ------------------------------------------------------------------------------------ mock mode

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/**
 * Copies a saved answer between two pages' mock stores (end-to-end tests only; see the top of the
 * file): the saved questions of a form, as the API merges a save field by field, or an outside
 * question's versions.
 */
export function mockStoreSync(stores: { applicant: ApplicantStore; outside: OutsideStore }): StoreSync {
  const find = (topic: string, target: string) => {
    const [, kind, id] = topic.split(":");
    if (kind === "application") {
      const form = stores.applicant.applications.find((a) => a.uuid === id)?.forms.find((f) => f.formId === target);
      return form ? { form } : null;
    }
    const q = stores.outside.applications.find((a) => bare(a.id) === id)?.questions.find((x) => x.id === target);
    return q ? { q } : null;
  };
  const keyOf = (field: string) => field.replace(/^\//, "").split("/")[0] ?? "";
  return {
    copy(topic, saved) {
      const f = find(topic, saved.target);
      if (f?.form) return { response: Object.fromEntries(saved.fields.map(keyOf).filter(Boolean).map((k) => [k, f.form.response[k] ?? null])), lastModifiedAt: f.form.lastModifiedAt };
      if (f?.q) return clone({ versions: f.q.versions, status: f.q.status });
      return undefined;
    },
    apply(topic, saved, copy) {
      const f = find(topic, saved.target);
      if (!copy || typeof copy !== "object") return;
      if (f?.form) {
        const c = copy as { response?: Record<string, unknown>; lastModifiedAt?: string };
        const response = { ...f.form.response } as Record<string, unknown>;
        for (const [k, v] of Object.entries(c.response ?? {})) {
          if (v === null) delete response[k];
          else response[k] = clone(v);
        }
        f.form.response = response as typeof f.form.response;
        if (c.lastModifiedAt) f.form.lastModifiedAt = c.lastModifiedAt;
      } else if (f?.q) Object.assign(f.q, clone(copy));
    },
  };
}

declare global {
  interface Window {
    /** End-to-end tests only: carries one page's channel messages to another browser context. */
    __gmsPresenceRelay?: PresenceRelay;
  }
}

let pageHub: PresenceHub | null = null;
/** Mock mode: one hub for the page (two editors in one page see each other), relayed when a test asks for it. */
export function mockPresenceHub(stores: { applicant: ApplicantStore; outside: OutsideStore }): PresenceHub {
  const relay = typeof window !== "undefined" ? (window.__gmsPresenceRelay ?? null) : null;
  return (pageHub ??= createPresenceHub({ relay, sync: relay ? mockStoreSync(stores) : null }));
}
