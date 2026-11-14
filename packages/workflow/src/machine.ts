// SPDX-License-Identifier: AGPL-3.0-only
// Generic state-machine engine. Every status change in the GMS runs through `transition()` here:
// guard → write → ledger → webhook, in that order, through injected ports. No route writes a status
// column directly (build spec §10.1).

export type SubjectType = "application" | "award" | "agreement" | "tranche" | "requirement" | "submission" | "outside_application";

export type ActorKind = "applicant" | "funder" | "system" | "passport";

export interface Actor {
  /** Ledger actor string: `user:<id>`, `client:<id>`, `user:<id>/client:<id>`, `system:<job>`, `passport`. */
  id: string;
  kind: ActorKind;
}

export interface StatusWrite {
  subjectType: SubjectType;
  subjectId: string;
  from: string;
  to: string;
  /** Extra columns written atomically with the status (timestamps, hold reason, …). */
  patch: Record<string, unknown>;
}

export interface LedgerEntry {
  actor: string;
  eventType: string;
  subjectType: SubjectType;
  subjectId: string;
  data: Record<string, unknown>;
}

export interface WebhookEvent {
  type: string;
  subjectType: SubjectType;
  subjectId: string;
  data: Record<string, unknown>;
}

export interface Ports {
  write(change: StatusWrite): Promise<void>;
  ledger(entry: LedgerEntry): Promise<void>;
  emit(event: WebhookEvent): Promise<void>;
}

export type RefusalCode = "unknown_action" | "invalid_from" | "actor_not_allowed" | "guard_failed";

export type Check<S extends string> =
  | { ok: true; from: S; to: S }
  | { ok: false; code: RefusalCode; reason: string };

export type TransitionResult<S extends string> =
  | { ok: true; from: S; to: S; patch: Record<string, unknown> }
  | { ok: false; code: RefusalCode; reason: string };

export interface TransitionDef<S extends string, C> {
  from: readonly S[];
  to: S;
  actors: readonly ActorKind[];
  /** Returns a human-readable refusal reason, or null when the transition may proceed. */
  guard?: (ctx: C, from: S) => string | null;
  /** Columns written with the status. */
  patch?: (ctx: C, actor: Actor) => Record<string, unknown>;
  /** Webhook event types to emit, in order. Defaults to `<subject>.status.changed`. */
  events?: readonly string[];
}

export interface MachineDef<S extends string, A extends string, C> {
  subjectType: SubjectType;
  statuses: readonly S[];
  terminal: readonly S[];
  transitions: Record<A, TransitionDef<S, C>>;
}

export interface Subject<S extends string> {
  id: string;
  status: S;
}

export interface Machine<S extends string, A extends string, C> {
  def: MachineDef<S, A, C>;
  isTerminal(status: S): boolean;
  /** Actions structurally possible from a status (ignores actor and guards). */
  actionsFrom(status: S): A[];
  check(from: S, action: A, actor: Actor, ctx: C): Check<S>;
  transition(subject: Subject<S>, action: A, actor: Actor, ctx: C, ports: Ports): Promise<TransitionResult<S>>;
}

const label = (s: string) => s.replace(/_/g, " ");

export function createMachine<S extends string, A extends string, C>(def: MachineDef<S, A, C>): Machine<S, A, C> {
  const check = (from: S, action: A, actor: Actor, ctx: C): Check<S> => {
    const t = def.transitions[action] as TransitionDef<S, C> | undefined;
    if (!t) return { ok: false, code: "unknown_action", reason: `Unknown ${def.subjectType} action "${action}".` };
    if (!t.from.includes(from)) {
      return {
        ok: false,
        code: "invalid_from",
        reason: `Cannot ${label(action)} a ${def.subjectType} that is ${label(from)}; it must be ${t.from.map(label).join(" or ")}.`,
      };
    }
    if (!t.actors.includes(actor.kind)) {
      return {
        ok: false,
        code: "actor_not_allowed",
        reason: `Only ${t.actors.join(" or ")} can ${label(action)} a ${def.subjectType}.`,
      };
    }
    const refusal = t.guard?.(ctx, from) ?? null;
    if (refusal) return { ok: false, code: "guard_failed", reason: refusal };
    return { ok: true, from, to: t.to };
  };

  return {
    def,
    isTerminal: (status) => def.terminal.includes(status),
    actionsFrom: (status) =>
      (Object.keys(def.transitions) as A[]).filter((a) => def.transitions[a].from.includes(status)),
    check,
    async transition(subject, action, actor, ctx, ports) {
      const c = check(subject.status, action, actor, ctx);
      if (!c.ok) return c;
      const t = def.transitions[action];
      const patch = t.patch?.(ctx, actor) ?? {};
      await ports.write({ subjectType: def.subjectType, subjectId: subject.id, from: c.from, to: c.to, patch });
      const data = { action, from: c.from, to: c.to, ...patch };
      await ports.ledger({
        actor: actor.id,
        eventType: `${def.subjectType}.${action}`,
        subjectType: def.subjectType,
        subjectId: subject.id,
        data,
      });
      for (const type of t.events ?? [`${def.subjectType}.status.changed`]) {
        await ports.emit({ type, subjectType: def.subjectType, subjectId: subject.id, data });
      }
      return { ok: true, from: c.from, to: c.to, patch };
    },
  };
}

/** CommonGrants status projection: a CG enum value, plus `customValue` when the value is `custom`
 *  or when the GMS status is finer-grained than the CG one. */
export interface CgStatus {
  value: string;
  customValue?: string;
}

export const camel = (s: string) => s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
