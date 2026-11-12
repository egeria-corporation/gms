// SPDX-License-Identifier: AGPL-3.0-only
// The status vocabulary: one badge per lifecycle state, always an icon plus a label so state is
// never carried by color alone. The map covers every status in `@gms/workflow` plus the Phase 1
// design objects (opportunity, competition, form version).
import {
  BadgeCheck,
  Ban,
  Calendar,
  Check,
  CircleCheck,
  CircleMinus,
  CirclePause,
  CircleX,
  ClipboardCheck,
  Clock,
  Eye,
  Hourglass,
  Loader,
  Lock,
  LogOut,
  Mail,
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
import type { AgreementStatus, ApplicationStatus, AwardStatus, RequirementStatus, SubmissionStatus, TrancheStatus } from "@gms/workflow";

export type Tone = "neutral" | "info" | "prog" | "ok" | "warn" | "dng" | "done" | "agent";
export interface StatusLook {
  icon: LucideIcon;
  label: string;
  tone: Tone;
}

const look = (icon: LucideIcon, label: string, tone: Tone): StatusLook => ({ icon, label, tone });

export const STATUS = {
  application: {
    draft: look(Pencil, "Draft", "neutral"),
    submitted: look(Send, "Submitted", "info"),
    screening: look(Search, "Screening", "info"),
    under_review: look(Eye, "Under review", "prog"),
    revision_requested: look(RotateCcw, "Revision requested", "warn"),
    interview: look(Calendar, "Interview", "info"),
    recommended: look(Star, "Recommended", "prog"),
    accepted: look(CircleCheck, "Accepted", "ok"),
    declined: look(CircleX, "Declined", "dng"),
    waitlisted: look(Hourglass, "Waitlisted", "neutral"),
    withdrawn: look(LogOut, "Withdrawn", "neutral"),
  } satisfies Record<ApplicationStatus, StatusLook>,
  award: {
    offered: look(Mail, "Offered", "info"),
    accepted: look(Check, "Accepted", "prog"),
    active: look(BadgeCheck, "Active", "ok"),
    suspended: look(CirclePause, "Suspended", "warn"),
    completed: look(CircleCheck, "Completed", "done"),
    cancelled: look(Ban, "Cancelled", "dng"),
  } satisfies Record<AwardStatus, StatusLook>,
  agreement: {
    draft: look(Pencil, "Draft", "neutral"),
    sent: look(Send, "Sent", "info"),
    signed_by_grantee: look(PenLine, "Signed by grantee", "prog"),
    countersigned: look(ClipboardCheck, "Countersigned", "prog"),
    executed: look(ShieldCheck, "Executed", "ok"),
    voided: look(Ban, "Voided", "dng"),
  } satisfies Record<AgreementStatus, StatusLook>,
  tranche: {
    scheduled: look(Calendar, "Scheduled", "neutral"),
    due: look(Clock, "Due", "warn"),
    ready: look(CircleCheck, "Ready", "ok"),
    held: look(Lock, "Held", "warn"),
    releasing: look(Loader, "Releasing", "prog"),
    initiated: look(Send, "Initiated", "info"),
    settled: look(BadgeCheck, "Settled", "ok"),
    failed: look(CircleX, "Failed", "dng"),
    returned: look(RotateCcw, "Returned", "dng"),
    cancelled: look(Ban, "Cancelled", "neutral"),
  } satisfies Record<TrancheStatus, StatusLook>,
  requirement: {
    scheduled: look(Calendar, "Scheduled", "neutral"),
    due: look(Clock, "Due", "warn"),
    overdue: look(TriangleExclamationPoint, "Overdue", "dng"),
    submitted: look(Send, "Submitted", "info"),
    under_review: look(Eye, "Under review", "prog"),
    accepted: look(CircleCheck, "Accepted", "ok"),
    returned: look(RotateCcw, "Returned", "warn"),
    waived: look(CircleMinus, "Waived", "neutral"),
  } satisfies Record<RequirementStatus, StatusLook>,
  submission: {
    draft: look(Pencil, "Draft", "neutral"),
    submitted: look(Send, "Submitted", "info"),
    under_review: look(Eye, "Under review", "prog"),
    accepted: look(CircleCheck, "Accepted", "ok"),
    returned: look(RotateCcw, "Returned", "warn"),
  } satisfies Record<SubmissionStatus, StatusLook>,
  opportunity: {
    forecasted: look(Calendar, "Forecasted", "neutral"),
    open: look(CircleCheck, "Open", "ok"),
    closed: look(CircleMinus, "Closed", "done"),
  },
  competition: {
    draft: look(Pencil, "Draft", "neutral"),
    open: look(CircleCheck, "Open", "ok"),
    closed: look(CircleMinus, "Closed", "done"),
  },
  form: {
    draft: look(Pencil, "Draft", "neutral"),
    published: look(Lock, "Published", "ok"),
  },
} as const;

export type StatusKind = keyof typeof STATUS;

export function statusLook(kind: StatusKind, status: string): StatusLook {
  const found = (STATUS[kind] as Record<string, StatusLook>)[status];
  // An unknown value is shown as written, neutrally, never dropped.
  return found ?? look(CircleMinus, status.replace(/_/g, " "), "neutral");
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
      <span className="lvl lvl-na" title="Passport level not available">
        L?
      </span>
    );
  }
  return (
    <span className={`lvl lvl-${n}`} title={`Passport verification level ${n}`}>
      <Shield className="ic" aria-hidden="true" />L{n}
    </span>
  );
}

/** Marks a rule result that rested on details the organization entered itself. */
export function SelfReportedTag({ result }: { result: unknown }) {
  if (!result || typeof result !== "object" || (result as { selfReported?: unknown }).selfReported !== true) return null;
  return (
    <span className="prov prov-entered" title="This rule was checked against details the organization entered itself">
      <Pencil className="ic" aria-hidden="true" />
      Self-reported
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
    <span className="lvl lvl-na" title="This organization has not been verified with OpenGrants Passport">
      <ShieldOff className="ic" aria-hidden="true" />
      Not verified
    </span>
  );
}

/**
 * A workspace's own display name, shown second to the Passport legal name beside the badge
 * (review NP-02). Nothing when the names are the same.
 */
export function WorkspaceName({ name }: { name?: string | null | undefined }) {
  if (!name) return null;
  return <span className="small muted">Workspace name: {name}</span>;
}
