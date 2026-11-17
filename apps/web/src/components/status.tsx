// SPDX-License-Identifier: AGPL-3.0-only
// The status vocabulary: one badge per lifecycle state, always an icon plus a label so state is
// never carried by color alone. The map covers every status in `@gms/workflow` plus the Phase 1
// design objects (opportunity, competition, form version).
import {
  Award,
  BadgeCheck,
  Ban,
  Bookmark,
  Calendar,
  Check,
  CircleCheck,
  CircleDashed,
  CircleMinus,
  CirclePause,
  CircleQuestionMark,
  CircleX,
  ClipboardCheck,
  Clock,
  Eye,
  Hourglass,
  Loader,
  Lock,
  LogOut,
  Mail,
  MailOpen,
  PenLine,
  Pencil,
  RotateCcw,
  Search,
  Send,
  Shield,
  ShieldCheck,
  ShieldOff,
  Star,
  TriangleExclamationPoint,
  type LucideIcon,
} from "lucide-react";
import type { Verification } from "../api/types.ts";
import type { InvitationStatus } from "../api/directAwards.ts";
import type { AgreementStatus, ApplicationStatus, AwardStatus, RequirementStatus, SubmissionStatus, TrancheStatus } from "@gms/workflow";

import { translator, type Key } from "../i18n/index.tsx";

const t = translator("shared");
export type Tone = "neutral" | "info" | "prog" | "ok" | "warn" | "dng" | "done" | "agent";
export interface StatusLook {
  icon: LucideIcon;
  label: string;
  tone: Tone;
}

/** A status's look; the label is read in the current language each time (shared catalog, `status.*`). */
const look = (icon: LucideIcon, key: Key<"shared">, tone: Tone): StatusLook => ({
  icon,
  get label() {
    return t(key);
  },
  tone,
});

export const STATUS = {
  application: {
    draft: look(Pencil, "status.application.draft", "neutral"),
    submitted: look(Send, "status.application.submitted", "info"),
    screening: look(Search, "status.application.screening", "info"),
    under_review: look(Eye, "status.application.under_review", "prog"),
    revision_requested: look(RotateCcw, "status.application.revision_requested", "warn"),
    interview: look(Calendar, "status.application.interview", "info"),
    recommended: look(Star, "status.application.recommended", "prog"),
    accepted: look(CircleCheck, "status.application.accepted", "ok"),
    declined: look(CircleX, "status.application.declined", "dng"),
    waitlisted: look(Hourglass, "status.application.waitlisted", "neutral"),
    withdrawn: look(LogOut, "status.application.withdrawn", "neutral"),
  } satisfies Record<ApplicationStatus, StatusLook>,
  award: {
    offered: look(Mail, "status.award.offered", "info"),
    accepted: look(Check, "status.award.accepted", "prog"),
    active: look(BadgeCheck, "status.award.active", "ok"),
    suspended: look(CirclePause, "status.award.suspended", "warn"),
    completed: look(CircleCheck, "status.award.completed", "done"),
    cancelled: look(Ban, "status.award.cancelled", "dng"),
  } satisfies Record<AwardStatus, StatusLook>,
  // The invitation on an award given directly: where the organization's answer stands.
  invitation: {
    sent: look(Mail, "status.invitation.sent", "info"),
    accepted: look(CircleCheck, "status.invitation.accepted", "ok"),
    declined: look(CircleX, "status.invitation.declined", "dng"),
    expired: look(Clock, "status.invitation.expired", "warn"),
    revoked: look(Ban, "status.invitation.revoked", "neutral"),
  } satisfies Record<InvitationStatus, StatusLook>,
  agreement: {
    draft: look(Pencil, "status.agreement.draft", "neutral"),
    sent: look(Send, "status.agreement.sent", "info"),
    signed_by_grantee: look(PenLine, "status.agreement.signed_by_grantee", "prog"),
    countersigned: look(ClipboardCheck, "status.agreement.countersigned", "prog"),
    executed: look(ShieldCheck, "status.agreement.executed", "ok"),
    voided: look(Ban, "status.agreement.voided", "dng"),
  } satisfies Record<AgreementStatus, StatusLook>,
  tranche: {
    scheduled: look(Calendar, "status.tranche.scheduled", "neutral"),
    due: look(Clock, "status.tranche.due", "warn"),
    ready: look(CircleCheck, "status.tranche.ready", "ok"),
    held: look(Lock, "status.tranche.held", "warn"),
    releasing: look(Loader, "status.tranche.releasing", "prog"),
    initiated: look(Send, "status.tranche.initiated", "info"),
    settled: look(BadgeCheck, "status.tranche.settled", "ok"),
    failed: look(CircleX, "status.tranche.failed", "dng"),
    returned: look(RotateCcw, "status.tranche.returned", "dng"),
    cancelled: look(Ban, "status.tranche.cancelled", "neutral"),
  } satisfies Record<TrancheStatus, StatusLook>,
  requirement: {
    scheduled: look(Calendar, "status.requirement.scheduled", "neutral"),
    due: look(Clock, "status.requirement.due", "warn"),
    overdue: look(TriangleExclamationPoint, "status.requirement.overdue", "dng"),
    submitted: look(Send, "status.requirement.submitted", "info"),
    under_review: look(Eye, "status.requirement.under_review", "prog"),
    accepted: look(CircleCheck, "status.requirement.accepted", "ok"),
    returned: look(RotateCcw, "status.requirement.returned", "warn"),
    waived: look(CircleMinus, "status.requirement.waived", "neutral"),
  } satisfies Record<RequirementStatus, StatusLook>,
  submission: {
    draft: look(Pencil, "status.submission.draft", "neutral"),
    submitted: look(Send, "status.submission.submitted", "info"),
    under_review: look(Eye, "status.submission.under_review", "prog"),
    accepted: look(CircleCheck, "status.submission.accepted", "ok"),
    returned: look(RotateCcw, "status.submission.returned", "warn"),
  } satisfies Record<SubmissionStatus, StatusLook>,
  opportunity: {
    forecasted: look(Calendar, "status.opportunity.forecasted", "neutral"),
    open: look(CircleCheck, "status.opportunity.open", "ok"),
    closed: look(CircleMinus, "status.opportunity.closed", "done"),
  },
  competition: {
    draft: look(Pencil, "status.competition.draft", "neutral"),
    open: look(CircleCheck, "status.competition.open", "ok"),
    closed: look(CircleMinus, "status.competition.closed", "done"),
  },
  form: {
    draft: look(Pencil, "status.form.draft", "neutral"),
    published: look(Lock, "status.form.published", "ok"),
  },
  // An application to a funder outside this GMS: the applicant's own record of where it stands.
  outside: {
    prospect: look(Bookmark, "status.outside.prospect", "neutral"),
    deciding: look(CircleQuestionMark, "status.outside.deciding", "neutral"),
    loi: look(Mail, "status.outside.loi", "info"),
    invited: look(MailOpen, "status.outside.invited", "prog"),
    drafting: look(Pencil, "status.outside.drafting", "info"),
    submitted: look(Send, "status.outside.submitted", "prog"),
    awarded: look(Award, "status.outside.awarded", "ok"),
    declined: look(CircleX, "status.outside.declined", "dng"),
    withdrawn: look(LogOut, "status.outside.withdrawn", "neutral"),
    not_pursuing: look(CircleMinus, "status.outside.not_pursuing", "neutral"),
  },
  outsideQuestion: {
    empty: look(CircleDashed, "status.outsideQuestion.empty", "neutral"),
    draft: look(Pencil, "status.outsideQuestion.draft", "info"),
    ready: look(Eye, "status.outsideQuestion.ready", "prog"),
    approved: look(CircleCheck, "status.outsideQuestion.approved", "ok"),
  },
  // A document the funder asks for, on an outside application's checklist.
  requiredDocument: {
    needed: look(CircleDashed, "status.requiredDocument.needed", "warn"),
    attached: look(CircleCheck, "status.requiredDocument.attached", "ok"),
    not_needed: look(CircleMinus, "status.requiredDocument.not_needed", "neutral"),
  },
  // What an outside award asks of the organization: reports, conditions, payments.
  obligation: {
    upcoming: look(Clock, "status.obligation.upcoming", "neutral"),
    due: look(Hourglass, "status.obligation.due", "warn"),
    submitted: look(Send, "status.obligation.submitted", "prog"),
    received: look(CircleCheck, "status.obligation.received", "ok"),
    done: look(Check, "status.obligation.done", "done"),
    missed: look(TriangleExclamationPoint, "status.obligation.missed", "dng"),
  },
} as const;

export type StatusKind = keyof typeof STATUS;

export function statusLook(kind: StatusKind, status: string): StatusLook {
  const found = (STATUS[kind] as Record<string, StatusLook>)[status];
  // An unknown value is shown as written, neutrally, never dropped.
  return found ?? { icon: CircleMinus, label: status.replace(/_/g, " "), tone: "neutral" };
}

export function StatusBadge({ kind, status, large = false, label }: { kind: StatusKind; status: string; large?: boolean; label?: string }) {
  const { icon: Icon, label: text, tone } = statusLook(kind, status);
  return (
    <span className={`bdg bdg-${tone}${large ? " bdg-lg" : ""}`}>
      <Icon className="ic" aria-hidden="true" />
      {label ?? text}
    </span>
  );
}

/** Passport verification level. `null` means the level is not known (no Passport record, or Passport unreachable). */
export function LevelBadge({ level }: { level: string | null | undefined }) {
  const n = level && /^L[0-3]$/.test(level) ? level.slice(1) : null;
  if (n === null) {
    return (
      <span className="lvl lvl-na" title={t("status.passportLevelNotAvailable")}>
        {t("status.l")}
      </span>
    );
  }
  return (
    <span className={`lvl lvl-${n}`} title={t("status.passportVerificationLevel", { n })}>
      <Shield className="ic" aria-hidden="true" />{t("status.l2", { n })}
    </span>
  );
}

/** Marks a rule result that rested on details the organization entered itself. */
export function SelfReportedTag({ result }: { result: unknown }) {
  if (!result || typeof result !== "object" || (result as { selfReported?: unknown }).selfReported !== true) return null;
  return (
    <span className="prov prov-entered" title={t("status.thisRuleWasCheckedAgainst")}>
      <Pencil className="ic" aria-hidden="true" />
      {t("status.selfReported")}
    </span>
  );
}

/**
 * What a funder sees next to an organization's name: the Passport level when its details come from
 * Passport, otherwise "Not verified". `verification` is absent only from an older server; the level
 * then stands on its own.
 */
export function VerificationBadge({ verification, level }: { verification?: Verification | null | undefined; level?: string | null | undefined }) {
  if (!verification) return <LevelBadge level={level} />;
  if (verification.source === "passport") return <LevelBadge level={verification.level ?? level} />;
  return (
    <span className="lvl lvl-na" title={t("status.thisOrganizationHasNotBeen")}>
      <ShieldOff className="ic" aria-hidden="true" />
      {t("status.notVerified")}
    </span>
  );
}

/**
 * A workspace's own display name, shown second to the Passport legal name beside the badge
 * (review NP-02). Nothing when the names are the same.
 */
export function WorkspaceName({ name }: { name?: string | null | undefined }) {
  if (!name) return null;
  return <span className="small muted">{t("status.workspaceName", { name })}</span>;
}
