// SPDX-License-Identifier: AGPL-3.0-only
// Presence and "someone else saved" signals for the application editor. The port is small on
// purpose: who is here, and a nudge to re-read when another editor saves. Edits themselves travel
// through the API (field-level merge saves), never through this channel.
import { createClient, type RealtimeChannel } from "@supabase/supabase-js";

export interface Peer {
  userId: string;
  name: string;
  /** The section the person is working in, if they said. */
  section?: string;
}

export interface EditorRoom {
  /** Announce a save so other editors re-read the form. */
  saved(formId: string): void;
  /** Tell others which section this person is in. */
  focus(section: string | undefined): void;
  leave(): void;
}

export interface RoomHandlers {
  onPeers: (peers: Peer[]) => void;
  onSaved: (formId: string, by: Peer) => void;
}

export interface Realtime {
  join(applicationId: string, me: Peer, handlers: RoomHandlers): EditorRoom;
}

/** Rooms on Supabase Realtime: presence for who is here, broadcast for save nudges. */
export function createSupabaseRealtime(url: string, anonKey: string, accessToken: () => Promise<string | null>): Realtime {
  const client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  return {
    join(applicationId, me, handlers) {
      let channel: RealtimeChannel | null = client.channel(`application:${applicationId}`, { config: { presence: { key: me.userId } } });
      const ch = channel;
      ch.on("presence", { event: "sync" }, () => {
        const state = ch.presenceState<Peer>();
        handlers.onPeers(Object.values(state).flatMap((entries) => entries.slice(0, 1)).filter((p) => p.userId !== me.userId));
      });
      ch.on("broadcast", { event: "saved" }, ({ payload }) => {
        const p = payload as { formId?: string; by?: Peer };
        if (p.formId && p.by && p.by.userId !== me.userId) handlers.onSaved(p.formId, p.by);
      });
      void accessToken().then((token) => {
        if (token) void client.realtime.setAuth(token);
        ch.subscribe((status) => {
          if (status === "SUBSCRIBED") void ch.track(me);
        });
      });
      return {
        saved: (formId) => void ch.send({ type: "broadcast", event: "saved", payload: { formId, by: me } }),
        focus: (section) => void ch.track({ ...me, ...(section ? { section } : {}) }),
        leave: () => {
          if (channel) void client.removeChannel(channel);
          channel = null;
        },
      };
    },
  };
}

/** In-memory rooms: every editor created from the same hub sees the others. Used by mock mode and tests. */
export function createRealtimeHub() {
  const rooms = new Map<string, Set<{ me: Peer; handlers: RoomHandlers }>>();
  const sync = (applicationId: string) => {
    const members = rooms.get(applicationId) ?? new Set();
    for (const m of members) m.handlers.onPeers([...members].filter((o) => o !== m).map((o) => o.me));
  };
  const realtime: Realtime = {
    join(applicationId, me, handlers) {
      const member = { me: { ...me }, handlers };
      const set = rooms.get(applicationId) ?? new Set();
      rooms.set(applicationId, set);
      set.add(member);
      sync(applicationId);
      return {
        saved: (formId) => {
          for (const o of set) if (o !== member) o.handlers.onSaved(formId, member.me);
        },
        focus: (section) => {
          member.me = { ...me, ...(section ? { section } : {}) };
          sync(applicationId);
        },
        leave: () => {
          set.delete(member);
          sync(applicationId);
        },
      };
    },
  };
  return realtime;
}
