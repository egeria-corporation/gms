// SPDX-License-Identifier: AGPL-3.0-only
// Live co-editing with presence (docs/co-editing.md). Everyone writing one draft sees who else is
// in it and which question each is in; while someone types in a question the others see it
// read-only ("Being edited by …", a soft lock); and when someone saves, the others read the new
// answer again within seconds, without losing what they are typing.
//
// The live channel is a private Supabase Realtime channel (Realtime Authorization): the API issues
// a pass to the person's session after the same check that opens the draft (api/presence.ts), and
// Realtime admits the session to the draft's channel only while it holds one (migration 0050). The
// channel carries who is present, soft locks and "saved" nudges, never an answer: answers are read
// through the API, which checks again on every read. Without the channel (no pass, no connection,
// Realtime switched off) the editors work exactly as before and say live updates are paused.
//
// Three layers: a transport (Supabase here, an in-page hub in mock mode and tests), a room that
// keeps the presence and lock rules (`createDraftRoom`, no React), and `useDraftPresence` for the
// editors.
import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { mockApplicantStore } from "../api/applicantHooks.ts";
import { createHttpPresenceApi, type PresenceApi, type PresenceDraft } from "../api/presence.ts";
import { mockOutsideStore } from "../api/outsideHooks.ts";
import { useServices, type Services } from "../app/services.tsx";
import { env } from "../env.ts";
import { createMockPresenceApi, mockPresenceHub } from "../mocks/presence.ts";

/** A soft lock lets go after this long without a keystroke (brief F1: one constant). */
export const LOCK_IDLE_MS = 60_000;
/** While someone keeps typing, their lock is said again this often, so the others know it is still held. */
export const LOCK_REFRESH_MS = 20_000;
/** The others let a lock go when they have not heard of it for this long (the holder's tab closed or froze). */
export const LOCK_STALE_MS = LOCK_IDLE_MS + LOCK_REFRESH_MS;
/**
 * Supabase Realtime takes at most 5 presence calls per client in 30 seconds
 * (https://supabase.com/docs/guides/realtime/limits): moving between questions is said at most
 * once every 6.5 seconds, the latest place last. Locks and saves go by broadcast, not presence.
 */
export const PRESENCE_TRACK_EVERY_MS = 6_500;

// ------------------------------------------------------------------------------------ transport

/** What presence carries for one person: who, and where they are. Never an answer. */
export interface PresenceMeta {
  userId: string;
  name: string;
  /** The section they are in (the funder's own words, the key teammates share). */
  section?: string;
  /** The question or field they are in: a JSON pointer (`/need`) or an outside question's id. */
  field?: string;
}
/** `field` null lets the lock go. */
export interface LockMessage {
  by: string;
  field: string | null;
}
/** Someone saved `fields` of `target` (a form id or an outside question id): read it again. */
export interface SavedMessage {
  by: string;
  target: string;
  fields: string[];
}
export type LiveStatus = "connecting" | "live" | "paused";

export interface ChannelHandlers {
  /** Everyone else on the channel, each with their latest place. */
  presence(others: PresenceMeta[]): void;
  lock(message: LockMessage): void;
  saved(message: SavedMessage): void;
  status(status: LiveStatus): void;
}
export interface PresenceChannel {
  track(meta: PresenceMeta): void;
  send(event: "lock", payload: LockMessage): void;
  send(event: "saved", payload: SavedMessage): void;
  leave(): void;
}
export interface PresenceTransport {
  open(topic: string, me: PresenceMeta, handlers: ChannelHandlers): PresenceChannel;
}

/**
 * Private channels on Supabase Realtime. The client takes the person's access token from the app's
 * sign-in on connect and on every heartbeat, so Realtime checks the policies again whenever the
 * token is renewed, and closes the channel if it ever lapses.
 */
export function createSupabaseTransport(url: string, key: string, accessToken: () => Promise<string | null>): PresenceTransport {
  let client: SupabaseClient | null = null;
  const realtime = () => (client ??= createClient(url, key, { accessToken, auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }));
  return {
    open(topic, me, h) {
      const sb = realtime();
      const ch: RealtimeChannel = sb.channel(topic, { config: { private: true, presence: { key: me.userId, enabled: true }, broadcast: { self: false } } });
      let live = false;
      let closed = false;
      let latest = me;
      let lastTrack = 0;
      let timer: ReturnType<typeof setTimeout> | null = null;
      const flush = () => {
        timer = null;
        lastTrack = Date.now();
        if (live && !closed) void ch.track(latest).catch(() => undefined);
      };
      const track = (meta: PresenceMeta) => {
        latest = meta;
        if (!live || timer) return;
        const wait = lastTrack + PRESENCE_TRACK_EVERY_MS - Date.now();
        if (wait <= 0) flush();
        else timer = setTimeout(flush, wait);
      };
      ch.on("presence", { event: "sync" }, () => {
        const state = ch.presenceState<PresenceMeta>();
        h.presence(Object.values(state).flatMap((metas) => (metas.length ? [metas[metas.length - 1]!] : [])).filter((p) => p.userId !== me.userId));
      });
      ch.on("broadcast", { event: "lock" }, ({ payload }) => h.lock(payload as LockMessage));
      ch.on("broadcast", { event: "saved" }, ({ payload }) => h.saved(payload as SavedMessage));
      h.status("connecting");
      ch.subscribe((status) => {
        if (closed) return;
        if (status === "SUBSCRIBED") {
          live = true;
          h.status("live");
          flush();
        } else {
          // A refused join (no pass), a timeout or a dropped connection: the editor carries on without it.
          live = false;
          h.status("paused");
        }
      });
      return {
        track,
        send: (event: "lock" | "saved", payload: LockMessage | SavedMessage) => {
          if (live && !closed) void ch.send({ type: "broadcast", event, payload }).catch(() => undefined);
        },
        leave: () => {
          closed = true;
          if (timer) clearTimeout(timer);
          void sb.removeChannel(ch);
        },
      };
    },
  };
}

// ------------------------------------------------------------------------------------ the room

/** Someone else in the draft, where they are, and the question they hold, if any. */
export interface Peer {
  userId: string;
  name: string;
  section?: string;
  field?: string;
  /** The question they are typing in: read-only for everyone else until they let it go. */
  lock?: string;
}

export interface RoomSnapshot {
  status: LiveStatus;
  peers: Peer[];
}

export interface DraftRoom {
  /** Where this person is now (a section, a question). */
  focus(where: { section?: string; field?: string }): void;
  /** A keystroke in `field`: takes the soft lock, or keeps it. Readers never take one. */
  input(field: string): void;
  /** Focus left `field`: its lock goes. */
  blur(field: string): void;
  /** This person saved `fields` of `target`: the others read it again. */
  saved(target: string, fields: string[]): void;
  snapshot(): RoomSnapshot;
  leave(): void;
}

export interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
}
const realClock: Clock = { now: () => Date.now(), setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>) };

export interface RoomOptions {
  transport: PresenceTransport;
  topic: string;
  me: { userId: string; name: string };
  /** The pass says this session may write: only then does it take locks and announce saves. */
  canWrite: boolean;
  onChange(snapshot: RoomSnapshot): void;
  onSaved(message: SavedMessage, by: Peer | undefined): void;
  clock?: Clock;
}

/**
 * The presence and soft-lock rules over a transport. A lock is taken on the first keystroke in a
 * question, said again every LOCK_REFRESH_MS while typing goes on and to anyone who joins, and let
 * go on blur, after LOCK_IDLE_MS without a keystroke, or on leaving. The others drop a lock they
 * have not heard of for LOCK_STALE_MS, and every lock of someone who left. A lock is a courtesy, not
 * a guard: the API merges saves field by field whoever holds it.
 */
export function createDraftRoom(opts: RoomOptions): DraftRoom {
  const clock = opts.clock ?? realClock;
  let status: LiveStatus = "connecting";
  let others: PresenceMeta[] = [];
  const locks = new Map<string, { field: string; heard: number }>();
  let place: { section?: string; field?: string } = {};
  let mine: string | null = null;
  let lastSaid = 0;
  let idle: unknown = null;
  let closed = false;

  const meta = (): PresenceMeta => ({ ...opts.me, ...(place.section ? { section: place.section } : {}), ...(place.field ? { field: place.field } : {}) });
  const peers = (): Peer[] => {
    const now = clock.now();
    return others.map((o) => {
      const l = locks.get(o.userId);
      return { ...o, ...(l && now - l.heard < LOCK_STALE_MS ? { lock: l.field } : {}) };
    });
  };
  const changed = () => {
    if (!closed) opts.onChange({ status, peers: peers() });
  };
  const sayLock = () => {
    lastSaid = clock.now();
    channel.send("lock", { by: opts.me.userId, field: mine });
  };
  const release = () => {
    if (idle) clock.clearTimeout(idle);
    idle = null;
    if (mine === null) return;
    mine = null;
    sayLock();
  };
  // Drop locks gone quiet, so a closed tab never holds a question for good.
  let sweep: unknown = null;
  const sweepSoon = () => {
    if (sweep || closed || !locks.size) return;
    sweep = clock.setTimeout(() => {
      sweep = null;
      const now = clock.now();
      let dropped = false;
      for (const [who, l] of locks) if (now - l.heard >= LOCK_STALE_MS) dropped = locks.delete(who) || dropped;
      if (dropped) changed();
      sweepSoon();
    }, LOCK_REFRESH_MS);
  };

  const channel = opts.transport.open(opts.topic, meta(), {
    presence(next) {
      const before = new Set(others.map((o) => o.userId));
      others = next.filter((p) => p.userId !== opts.me.userId);
      const here = new Set(others.map((o) => o.userId));
      for (const who of [...locks.keys()]) if (!here.has(who)) locks.delete(who);
      // Someone new: tell them which question this person holds.
      if (mine && others.some((o) => !before.has(o.userId))) sayLock();
      changed();
    },
    lock(m) {
      if (!m || typeof m.by !== "string" || m.by === opts.me.userId) return;
      if (typeof m.field === "string" && m.field) locks.set(m.by, { field: m.field, heard: clock.now() });
      else locks.delete(m.by);
      sweepSoon();
      changed();
    },
    saved(m) {
      if (!m || typeof m.by !== "string" || m.by === opts.me.userId || typeof m.target !== "string") return;
      opts.onSaved({ by: m.by, target: m.target, fields: Array.isArray(m.fields) ? m.fields.filter((f): f is string => typeof f === "string") : [] }, peers().find((p) => p.userId === m.by));
    },
    status(s) {
      status = s;
      // Out of the channel nobody knows what this person holds; they keep typing as before.
      if (s === "paused") locks.clear();
      changed();
    },
  });

  return {
    focus(where) {
      if (where.section === place.section && where.field === place.field) return;
      place = where;
      channel.track(meta());
    },
    input(field) {
      if (!opts.canWrite || closed) return;
      if (mine !== field) {
        mine = field;
        sayLock();
      } else if (clock.now() - lastSaid >= LOCK_REFRESH_MS) sayLock();
      if (idle) clock.clearTimeout(idle);
      idle = clock.setTimeout(release, LOCK_IDLE_MS);
    },
    blur(field) {
      if (mine === field) release();
    },
    saved(target, fields) {
      if (opts.canWrite && !closed) channel.send("saved", { by: opts.me.userId, target, fields });
    },
    snapshot: () => ({ status, peers: peers() }),
    leave() {
      release();
      closed = true;
      if (sweep) clock.clearTimeout(sweep);
      channel.leave();
    },
  };
}

// ------------------------------------------------------------------------------------ the hook

const provided = new WeakMap<object, { api?: PresenceApi; transport?: PresenceTransport | null }>();
const defaults = new WeakMap<object, { api: PresenceApi; transport: PresenceTransport | null }>();

/** Replaces the pass port or the transport for a services object (tests). A null transport means no live channel. */
export function providePresence(services: Pick<Services, "auth">, ports: { api?: PresenceApi; transport?: PresenceTransport | null }): void {
  provided.set(services.auth, { ...provided.get(services.auth), ...ports });
}

function portsFor(services: Pick<Services, "auth" | "mock">): { api: PresenceApi; transport: PresenceTransport | null } {
  let d = defaults.get(services.auth);
  if (!d) {
    const token = async () => (await services.auth.getSession())?.accessToken ?? null;
    d = services.mock
      ? { api: createMockPresenceApi({ session: () => services.auth.getSession() }), transport: mockPresenceHub({ applicant: mockApplicantStore(services), outside: mockOutsideStore(services) }) }
      : { api: createHttpPresenceApi({ baseUrl: env.apiBaseUrl, token }), transport: env.supabaseUrl && env.supabaseAnonKey ? createSupabaseTransport(env.supabaseUrl, env.supabaseAnonKey, token) : null };
    defaults.set(services.auth, d);
  }
  const p = provided.get(services.auth);
  return { api: p?.api ?? d.api, transport: p && "transport" in p ? (p.transport ?? null) : d.transport };
}

/**
 * An API call for the draft answered with one of these: the person may no longer open it (removed
 * from the team, the draft submitted or deleted). The editor leaves the live channel at once instead
 * of waiting for Realtime's next check (a new token or the pass's renewal; docs/co-editing.md).
 */
export const LEAVE_CHANNEL_ON_STATUS: readonly number[] = [403, 404];

/** Whether an API error says this person may no longer open the draft. */
export const lostAccess = (e: unknown): boolean => {
  const status = (e as { status?: unknown } | null)?.status;
  return typeof status === "number" && LEAVE_CHANNEL_ON_STATUS.includes(status);
};

export interface DraftPresence extends RoomSnapshot {
  /** The person typing in `field`, when it is someone else. */
  lockOf(field: string): Peer | undefined;
  /** The others whose place is in `section`. */
  inSection(section: string): Peer[];
  /** The others whose place is `field`. */
  inField(field: string): Peer[];
  focus(where: { section?: string; field?: string }): void;
  input(field: string): void;
  blur(field: string): void;
  saved(target: string, fields: string[]): void;
  /**
   * Any API call for this draft failed with `error`: a 403 or 404 leaves the channel now and for as
   * long as this editor is open (LEAVE_CHANNEL_ON_STATUS). Anything else changes nothing.
   */
  apiFailed(error: unknown): void;
}

export interface DraftPresenceOptions {
  workspaceId: string;
  draft: PresenceDraft;
  me: { userId: string; name: string };
  /** Someone else saved: read `target` again. */
  onSaved(message: SavedMessage, by: Peer | undefined): void;
  /** False keeps the editor off the channel (it is read-only, say). */
  enabled?: boolean;
}

/**
 * Joins the draft's live channel for as long as the editor is open: asks the API for a pass, joins
 * the topic the pass names, renews the pass when it says to, and leaves the channel if a renewal is
 * refused (the person was removed from the team, the draft was submitted). Every failure leaves the
 * editor as it was, with `status` "paused".
 */
export function useDraftPresence(opts: DraftPresenceOptions): DraftPresence {
  const services = useServices();
  const { api, transport } = portsFor(services);
  const [snap, setSnap] = useState<RoomSnapshot>({ status: "connecting", peers: [] });
  const room = useRef<DraftRoom | null>(null);
  // The draft an API call said this person lost access to: its channel stays left.
  const [goneFrom, setGoneFrom] = useState<string | null>(null);
  const leaveNow = useRef<() => void>(() => undefined);
  const onSaved = useRef(opts.onSaved);
  onSaved.current = opts.onSaved;
  const enabled = opts.enabled ?? true;
  const { workspaceId } = opts;
  const { kind, id } = opts.draft;
  const { userId, name } = opts.me;
  const gone = goneFrom === `${kind}:${id}`;

  useEffect(() => {
    if (!enabled || !transport || gone) {
      room.current?.leave();
      room.current = null;
      setSnap({ status: "paused", peers: [] });
      return;
    }
    let live = true;
    let renew: ReturnType<typeof setTimeout> | null = null;
    const stop = () => {
      room.current?.leave();
      room.current = null;
    };
    const pause = () => {
      if (renew) clearTimeout(renew);
      renew = null;
      stop();
      if (live) setSnap({ status: "paused", peers: [] });
    };
    leaveNow.current = () => {
      live = false;
      pause();
      setSnap({ status: "paused", peers: [] });
    };
    const schedule = (seconds: number) => {
      renew = setTimeout(() => {
        api.pass(workspaceId, { kind, id }).then(
          (p) => live && schedule(p.renewAfterSeconds),
          // Refused (no longer allowed): leave the channel. A network hiccup: try again later.
          (e: unknown) => (isRefusal(e) ? pause() : live && schedule(Math.max(30, seconds / 2))),
        );
      }, Math.max(30, seconds) * 1000);
    };
    setSnap({ status: "connecting", peers: [] });
    api.pass(workspaceId, { kind, id }).then(
      (pass) => {
        if (!live) return;
        room.current = createDraftRoom({ transport, topic: pass.topic, me: { userId, name }, canWrite: pass.canWrite, onChange: (s) => live && setSnap(s), onSaved: (m, by) => live && onSaved.current(m, by) });
        schedule(pass.renewAfterSeconds);
      },
      () => pause(),
    );
    return () => {
      live = false;
      leaveNow.current = () => undefined;
      if (renew) clearTimeout(renew);
      stop();
    };
  }, [api, transport, enabled, gone, workspaceId, kind, id, userId, name]);

  const apiFailed = useCallback(
    (error: unknown) => {
      if (!lostAccess(error)) return;
      // Leave this moment, before React renders again, and stay out while this draft is open.
      leaveNow.current();
      setGoneFrom(`${kind}:${id}`);
    },
    [kind, id],
  );

  const focus = useCallback((where: { section?: string; field?: string }) => room.current?.focus(where), []);
  const input = useCallback((field: string) => room.current?.input(field), []);
  const blur = useCallback((field: string) => room.current?.blur(field), []);
  const saved = useCallback((target: string, fields: string[]) => room.current?.saved(target, fields), []);
  return useMemo(
    () => ({
      ...snap,
      lockOf: (field: string) => snap.peers.find((p) => p.lock === field),
      inSection: (section: string) => snap.peers.filter((p) => p.section === section),
      inField: (field: string) => snap.peers.filter((p) => p.field === field),
      focus,
      input,
      blur,
      saved,
      apiFailed,
    }),
    [snap, focus, input, blur, saved, apiFailed],
  );
}

/** A 4xx from the pass route: the person may not be in this draft (any more). */
const isRefusal = (e: unknown): boolean => {
  const status = (e as { status?: unknown } | null)?.status;
  return typeof status === "number" && status >= 400 && status < 500;
};
