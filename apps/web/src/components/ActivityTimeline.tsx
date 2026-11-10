// SPDX-License-Identifier: AGPL-3.0-only
// The workspace ledger as a timeline: who did what, and when. One entry per ledger event, marked
// by who acted (a person, an agent acting for a person, Passport, or a scheduled job) with an icon
// as well as a color, so the distinction never rests on color alone.
import { BadgeCheck, Bot, Clock, User } from "lucide-react";
import type { LedgerEvent } from "../api/funderMoney.ts";

export type ActorKind = "person" | "agent" | "passport" | "system";

export interface ActorView {
  kind: ActorKind;
  name: string;
}

/** `user:<id>`, `user:<id>/client:<name>`, `client:<name>`, `passport`, `system:<job>` → who to show. */
export function actorOf(actor: string | undefined, personName: (userId: string) => string | undefined): ActorView {
  if (!actor) return { kind: "system", name: "System" };
  if (actor === "passport" || actor.startsWith("passport")) return { kind: "passport", name: "Passport" };
  const client = /client:([^/]+)/.exec(actor)?.[1];
  const user = /user:([^/]+)/.exec(actor)?.[1];
  if (client) {
    const owner = user ? personName(user) : undefined;
    return { kind: "agent", name: owner ? `${client} (for ${owner})` : client };
  }
  if (user) return { kind: "person", name: personName(user) ?? "Someone" };
  return { kind: "system", name: actor.replace(/^system:/, "System · ") };
}

const SUBJECTS: Record<string, string> = {
  org_change: "organization change",
  mcp_connection: "agent connection",
  api_client: "API client",
};

const VERBS: Record<string, string> = {
  "tranche.release": "released a payment",
  "tranche.release_requested": "released a payment",
  "tranche.passport_hold": "put a payment on hold",
  "tranche.recorded_external": "recorded an external payment",
  "tranche.reconciled": "reconciled a payment with Passport",
  "decision.proposed": "proposed decisions",
  "decision.committed": "committed decisions",
  "review.submitted": "submitted a review",
  "review.assigned": "assigned a reviewer",
  "review.coi_declared": "declared a conflict of interest",
  "award.created": "created an award",
  "communication.sent": "sent a letter",
  "payee.destination.change_pending": "reported a pending destination change",
  "payee.destination.changed": "confirmed a destination change",
  "payee.level.changed": "reported a level change",
  "payee.organization.inactive": "reported an inactive organization",
  "disbursement.status.changed": "updated a disbursement",
  "requirement.reminder_sent": "sent a report reminder",
  "submission.received": "received a report",
  "schedule.replaced": "changed the payment schedule",
};

/** A readable sentence fragment for a ledger event type; unknown types read as their own words. */
export function describeEvent(eventType: string): string {
  const known = VERBS[eventType];
  if (known) return known;
  const [subject = "", ...rest] = eventType.split(".");
  const what = SUBJECTS[subject] ?? subject.replace(/_/g, " ");
  const verb = rest.join(" ").replace(/_/g, " ");
  return verb ? `${verb} · ${what}` : what;
}

const ICONS = { person: User, agent: Bot, passport: BadgeCheck, system: Clock } as const;
const CLASSES = { person: "tl-person", agent: "tl-agent", passport: "tl-passport", system: "" } as const;

function detailOf(data: Record<string, unknown>): string | null {
  const parts: string[] = [];
  if (typeof data.from === "string" && typeof data.to === "string") parts.push(`${data.from.replace(/_/g, " ")} → ${data.to.replace(/_/g, " ")}`);
  if (typeof data.outcome === "string") parts.push(typeof data.count === "number" ? `${data.count} × ${data.outcome}` : data.outcome);
  if (typeof data.reason === "string") parts.push(data.reason.replace(/_/g, " "));
  return parts.length ? parts.join(" · ") : null;
}

export function ActivityTimeline({
  events,
  personName,
  when,
  empty = "Nothing recorded yet.",
  compact = true,
}: {
  events: LedgerEvent[];
  personName: (userId: string) => string | undefined;
  /** How to show a timestamp (relative on a dashboard, absolute in an audit view). */
  when: (iso: string) => string;
  empty?: string;
  compact?: boolean;
}) {
  if (!events.length) return <p className="muted small">{empty}</p>;
  return (
    <div className={compact ? "tl tl-sm" : "tl"}>
      {events.map((e) => {
        const actor = actorOf(e.actor, personName);
        const Icon = ICONS[actor.kind];
        const detail = detailOf(e.data ?? {});
        return (
          <div key={e.id} className={`tl-i ${CLASSES[actor.kind]}`.trim()}>
            <span className="dot">
              <Icon className="ic" aria-hidden="true" />
            </span>
            <div>
              <div className="what">
                {actor.name} {describeEvent(e.eventType)}
              </div>
              <div className="who">
                {detail && (
                  <>
                    <span>{detail}</span>
                    <span>·</span>
                  </>
                )}
                <span>{when(e.occurredAt)}</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
