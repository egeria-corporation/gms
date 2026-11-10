// SPDX-License-Identifier: AGPL-3.0-only
import type { Actor, Machine, Ports } from "../src/index.ts";

export const funder: Actor = { id: "user:f1", kind: "funder" };
export const applicant: Actor = { id: "user:a1", kind: "applicant" };
export const system: Actor = { id: "system:test", kind: "system" };
export const passport: Actor = { id: "passport", kind: "passport" };

export function recorder() {
  const calls: string[] = [];
  const events: string[] = [];
  const writes: { id: string; from: string; to: string; patch: Record<string, unknown> }[] = [];
  const ports: Ports = {
    async write(w) {
      calls.push("write");
      writes.push({ id: w.subjectId, from: w.from, to: w.to, patch: w.patch });
    },
    async ledger(e) {
      calls.push(`ledger:${e.eventType}:${e.actor}`);
    },
    async emit(e) {
      calls.push(`emit:${e.type}`);
      events.push(e.type);
    },
  };
  return { ports, calls, events, writes };
}

/** Every (from, action) pair of a machine as "from>action>to", with a permissive actor and context. */
export function edges<S extends string, A extends string, C>(m: Machine<S, A, C>): string[] {
  const out: string[] = [];
  for (const [action, t] of Object.entries(m.def.transitions) as [A, { from: readonly S[]; to: S }][]) {
    for (const from of t.from) out.push(`${from}>${action}>${t.to}`);
  }
  return out.sort();
}
