// SPDX-License-Identifier: AGPL-3.0-only
// Small pieces the funder work screens share: people's names, eligibility marks, relative times.
import { useMemo } from "react";
import { CircleCheck, CircleDashed, CircleX } from "lucide-react";
import { initialsOf } from "../../api/client.ts";
import { useApiQuery } from "../../api/hooks.ts";
import type { FormPurpose } from "../../api/types.ts";
import { useWorkspace } from "../../app/workspace.tsx";
import { intlLocale } from "../../i18n/index.tsx";
import { formatDateAs } from "../../lib/format.ts";
import { t } from "./i18n.ts";

export interface Person {
  userId: string;
  name: string;
  initials: string;
  role: string;
}

const nameOf = (m: { name?: string | null; email?: string | null; userId: string }) =>
  m.name?.trim() ||
  (m.email
    ? m.email
        .replace(/@.*$/, "")
        .split(/[._-]+/)
        .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
        .join(" ")
    : t("funderShared.member", { id: m.userId.slice(0, 4) }));

/** The workspace's members, and a lookup that never fails: an unknown id reads as "Someone". */
export function usePeople(): { people: Person[]; person: (userId: string | null | undefined) => Person | null } {
  const ws = useWorkspace("funder");
  const members = useApiQuery((api) => api.listMembers(ws.id), [ws.id]);
  return useMemo(() => {
    const people = (members.data ?? []).map((m) => {
      const name = nameOf(m as { name?: string | null; email?: string | null; userId: string });
      return { userId: m.userId, name, initials: initialsOf(name), role: m.role };
    });
    const byId = new Map(people.map((p) => [p.userId, p]));
    return { people, person: (id) => (id ? (byId.get(id) ?? { userId: id, name: t("funderShared.someone"), initials: "?", role: "" }) : null) };
  }, [members.data]);
}

/** A form's purpose as people read it (form builder and forms list). */
export const PURPOSE_LABEL: Record<FormPurpose, () => string> = {
  application: () => t("formBuilder.purpose.application"),
  loi: () => t("formBuilder.purpose.loi"),
  report: () => t("formBuilder.purpose.report"),
  amendment: () => t("formBuilder.purpose.amendment"),
  site_visit: () => t("formBuilder.purpose.siteVisit"),
  other: () => t("formBuilder.purpose.other"),
};

export function Avatar({ person, size = "sm" }: { person: Person | null; size?: "sm" | "md" }) {
  if (!person) return <span className="muted">—</span>;
  return (
    <span className={size === "sm" ? "av av-sm" : "av"} title={person.name}>
      <span aria-hidden="true">{person.initials}</span>
      <span className="sr">{person.name}</span>
    </span>
  );
}

const ELIGIBILITY = {
  true: { icon: CircleCheck, get label() { return t("funderShared.eligibility.pass"); }, color: "#0B5E47" },
  false: { icon: CircleX, get label() { return t("funderShared.eligibility.fail"); }, color: "#9B1C1C" },
  unknown: { icon: CircleDashed, get label() { return t("funderShared.eligibility.unknown"); }, color: "#4A5C5A" },
} as const;

/** Eligibility is three-valued: unknown is shown as unknown, never as pass or fail. */
export function EligibilityMark({ value }: { value: boolean | "unknown" | null | undefined }) {
  const look = ELIGIBILITY[String(value ?? "unknown") as keyof typeof ELIGIBILITY] ?? ELIGIBILITY.unknown;
  const Icon = look.icon;
  return (
    <span className="row" style={{ gap: "5px", color: look.color, fontWeight: 700 }}>
      <Icon className="ic" aria-hidden="true" />
      {look.label}
    </span>
  );
}

export function timeAgo(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return "";
  const s = Math.max(0, (now.getTime() - Date.parse(iso)) / 1000);
  if (s < 90) return t("funderShared.timeAgo.justNow");
  if (s < 3600) return t("funderShared.timeAgo.minutes", { count: Math.round(s / 60) });
  if (s < 86400) return t("funderShared.timeAgo.hours", { count: Math.round(s / 3600) });
  if (s < 86400 * 14) return t("funderShared.timeAgo.days", { count: Math.round(s / 86400) });
  return formatDateAs(iso, "short");
}

export const dateTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString(intlLocale(), { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC" }) : "—";

/** `user:<id>`, `user:<id>/client:<name>`, `client:<name>`, `system:<job>` → who to show. */
export function actorLabel(actor: string | undefined, person: (id: string) => Person | null): { name: string; agent: boolean } {
  if (!actor) return { name: t("funderShared.system"), agent: false };
  const client = /client:([^/]+)/.exec(actor)?.[1];
  const user = /user:([^/]+)/.exec(actor)?.[1];
  if (client) return { name: client, agent: true };
  if (user === "applicant") return { name: t("funderShared.applicant"), agent: false };
  if (user) return { name: person(user)?.name ?? t("funderShared.someone"), agent: false };
  const job = /^system:(.*)$/.exec(actor)?.[1];
  return { name: job !== undefined ? t("funderShared.systemJob", { job }) : actor, agent: false };
}

/** Ids of the applications an approval request would act on. */
export function approvalTargets(input: unknown): string[] {
  const i = (input ?? {}) as { applicationIds?: unknown; applicationId?: unknown };
  if (Array.isArray(i.applicationIds)) return i.applicationIds.filter((x): x is string => typeof x === "string");
  return typeof i.applicationId === "string" ? [i.applicationId] : [];
}
