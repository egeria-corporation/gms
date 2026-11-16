// SPDX-License-Identifier: AGPL-3.0-only
// The workspace ledger as a timeline: who did what, and when. One entry per ledger event, marked
// by who acted (a person, an agent acting for a person, Passport, or a scheduled job) with an icon
// as well as a color, so the distinction never rests on color alone.
import { BadgeCheck, Bot, Clock, User } from "lucide-react";
import type { LedgerEvent } from "../api/funderMoney.ts";

import { translator } from "../i18n/index.tsx";

const t = translator("shared");
export type ActorKind = "person" | "agent" | "passport" | "system";

export interface ActorView {
  kind: ActorKind;
  name: string;
}

/** `user:<id>`, `user:<id>/client:<name>`, `client:<name>`, `passport`, `system:<job>` → who to show. */
export function actorOf(actor: string | undefined, personName: (userId: string) => string | undefined): ActorView {
  if (!actor) return { kind: "system", name: t("activityTimeline.system") };
  if (actor === "passport" || actor.startsWith("passport")) return { kind: "passport", name: "Passport" };
  const client = /client:([^/]+)/.exec(actor)?.[1];
  const user = /user:([^/]+)/.exec(actor)?.[1];
  if (client) {
    const owner = user ? personName(user) : undefined;
    return { kind: "agent", name: owner ? t("activityTimeline.agentFor", { client, owner }) : client };
  }
  if (user) return { kind: "person", name: personName(user) ?? t("activityTimeline.someone") };
  return { kind: "system", name: actor.startsWith("system:") ? t("activityTimeline.systemJob", { job: actor.slice("system:".length) }) : actor };
}

const SUBJECTS: Record<string, string> = {
  get org_change() {
    return t("activityTimeline.subjects.org_change");
  },
  get mcp_connection() {
    return t("activityTimeline.subjects.mcp_connection");
  },
  get api_client() {
    return t("activityTimeline.subjects.api_client");
  },
};

const VERBS: Record<string, string> = {
  get "tranche.release"() {
    return t("activityTimeline.verbs.tranche_release");
  },
  get "tranche.release_requested"() {
    return t("activityTimeline.verbs.tranche_release_requested");
  },
  get "tranche.passport_hold"() {
    return t("activityTimeline.verbs.tranche_passport_hold");
  },
  get "tranche.recorded_external"() {
    return t("activityTimeline.verbs.tranche_recorded_external");
  },
  get "tranche.reconciled"() {
    return t("activityTimeline.verbs.tranche_reconciled");
  },
  get "decision.proposed"() {
    return t("activityTimeline.verbs.decision_proposed");
  },
  get "decision.committed"() {
    return t("activityTimeline.verbs.decision_committed");
  },
  get "review.submitted"() {
    return t("activityTimeline.verbs.review_submitted");
  },
  get "review.assigned"() {
    return t("activityTimeline.verbs.review_assigned");
  },
  get "review.coi_declared"() {
    return t("activityTimeline.verbs.review_coi_declared");
  },
  get "award.created"() {
    return t("activityTimeline.verbs.award_created");
  },
  get "communication.sent"() {
    return t("activityTimeline.verbs.communication_sent");
  },
  get "payee.destination.change_pending"() {
    return t("activityTimeline.verbs.payee_destination_change_pending");
  },
  get "payee.destination.changed"() {
    return t("activityTimeline.verbs.payee_destination_changed");
  },
  get "payee.level.changed"() {
    return t("activityTimeline.verbs.payee_level_changed");
  },
  get "payee.organization.inactive"() {
    return t("activityTimeline.verbs.payee_organization_inactive");
  },
  get "disbursement.status.changed"() {
    return t("activityTimeline.verbs.disbursement_status_changed");
  },
  get "requirement.reminder_sent"() {
    return t("activityTimeline.verbs.requirement_reminder_sent");
  },
  get "submission.received"() {
    return t("activityTimeline.verbs.submission_received");
  },
  get "schedule.replaced"() {
    return t("activityTimeline.verbs.schedule_replaced");
  },
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
  empty = t("activityTimeline.nothingRecordedYet"),
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
                {t("activityTimeline.entry", { who: actor.name, what: describeEvent(e.eventType) })}
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
