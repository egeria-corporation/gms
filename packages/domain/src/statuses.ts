// SPDX-License-Identifier: AGPL-3.0-or-later
// Canonical statuses, exact UI labels, and tones. Status is always shown as icon + text + color.

export type Tone = 'neutral' | 'info' | 'progress' | 'success' | 'warning' | 'danger' | 'muted' | 'agent';

export interface StatusMeta {
  label: string;
  tone: Tone;
  /** lucide icon name */
  icon: string;
  description?: string;
}

function def<const K extends string>(m: Record<K, StatusMeta>): Record<K, StatusMeta> {
  return m;
}

export const OPPORTUNITY_STATUS = def({
  draft: { label: 'Draft', tone: 'muted', icon: 'pencil-line' },
  forecasted: { label: 'Forecasted', tone: 'info', icon: 'calendar-clock' },
  open: { label: 'Open', tone: 'success', icon: 'circle-dot' },
  closed: { label: 'Closed', tone: 'neutral', icon: 'circle-slash' },
  archived: { label: 'Archived', tone: 'muted', icon: 'archive' },
});
export type OpportunityStatus = keyof typeof OPPORTUNITY_STATUS;

export const APPLICATION_STATUS = def({
  in_progress: { label: 'In progress', tone: 'progress', icon: 'pencil-line', description: 'Not submitted yet' },
  submitted: { label: 'Submitted', tone: 'info', icon: 'send', description: 'Received by the foundation' },
  under_review: { label: 'Under review', tone: 'info', icon: 'scan-search', description: 'Reviewers are reading it' },
  invited_to_next_stage: { label: 'Invited to next stage', tone: 'success', icon: 'arrow-right-circle' },
  awarded: { label: 'Awarded', tone: 'success', icon: 'badge-check' },
  declined: { label: 'Declined', tone: 'neutral', icon: 'circle-x' },
  withdrawn: { label: 'Withdrawn', tone: 'muted', icon: 'undo-2' },
  ineligible: { label: 'Ineligible', tone: 'warning', icon: 'ban' },
});
export type ApplicationStatus = keyof typeof APPLICATION_STATUS;

export const REVIEW_STATUS = def({
  not_started: { label: 'Not started', tone: 'muted', icon: 'circle' },
  in_progress: { label: 'In progress', tone: 'progress', icon: 'circle-dashed' },
  submitted: { label: 'Submitted', tone: 'success', icon: 'circle-check' },
  recused: { label: 'Recused', tone: 'warning', icon: 'user-x' },
});
export type ReviewStatus = keyof typeof REVIEW_STATUS;

export const AWARD_STATUS = def({
  draft: { label: 'Draft', tone: 'muted', icon: 'pencil-line' },
  active: { label: 'Active', tone: 'success', icon: 'badge-check' },
  completed: { label: 'Completed', tone: 'neutral', icon: 'flag' },
  cancelled: { label: 'Cancelled', tone: 'danger', icon: 'circle-x' },
});
export type AwardStatus = keyof typeof AWARD_STATUS;

export const AWARD_FLAGS = def({
  agreement_pending: { label: 'Agreement pending', tone: 'warning', icon: 'file-signature' },
  on_hold: { label: 'On hold', tone: 'danger', icon: 'pause-circle' },
  report_overdue: { label: 'Report overdue', tone: 'danger', icon: 'alarm-clock' },
});
export type AwardFlag = keyof typeof AWARD_FLAGS;

export const AGREEMENT_STATUS = def({
  draft: { label: 'Draft', tone: 'muted', icon: 'file-pen-line' },
  sent: { label: 'Awaiting signature', tone: 'info', icon: 'file-signature' },
  signed: { label: 'Signed by grantee', tone: 'progress', icon: 'user-check' },
  countersigned: { label: 'Fully signed', tone: 'success', icon: 'badge-check' },
  void: { label: 'Void', tone: 'muted', icon: 'circle-slash' },
});
export type AgreementStatus = keyof typeof AGREEMENT_STATUS;

export const PAYEE_STATUS = def({
  invite_sent: { label: 'Invite sent', tone: 'info', icon: 'mail' },
  onboarding: { label: 'Onboarding', tone: 'progress', icon: 'loader' },
  ready: { label: 'Ready', tone: 'success', icon: 'circle-check' },
  invite_expired: { label: 'Invite expired', tone: 'warning', icon: 'clock-alert' },
});
export type PayeeStatus = keyof typeof PAYEE_STATUS;

export const PAYMENT_STATUS = def({
  scheduled: { label: 'Scheduled', tone: 'muted', icon: 'calendar' },
  in_batch: { label: 'In batch', tone: 'info', icon: 'layers' },
  awaiting_approval: { label: 'Awaiting approval (GMS)', tone: 'warning', icon: 'user-check' },
  awaiting_bank_approval: { label: 'Awaiting bank approval (Mercury)', tone: 'warning', icon: 'landmark' },
  sent: { label: 'Sent', tone: 'success', icon: 'send' },
  failed: { label: 'Failed', tone: 'danger', icon: 'triangle-alert' },
  held: { label: 'Held', tone: 'danger', icon: 'pause-circle' },
  reconciled: { label: 'Reconciled', tone: 'success', icon: 'check-check' },
  exception: { label: 'Exception', tone: 'danger', icon: 'circle-alert' },
  cancelled: { label: 'Cancelled', tone: 'muted', icon: 'circle-x' },
});
export type PaymentStatus = keyof typeof PAYMENT_STATUS;

export const BATCH_STATUS = def({
  draft: { label: 'Draft', tone: 'muted', icon: 'pencil-line' },
  awaiting_approval: { label: 'Awaiting approval (GMS)', tone: 'warning', icon: 'user-check' },
  approved: { label: 'Approved', tone: 'success', icon: 'circle-check' },
  submitting: { label: 'Submitting to bank', tone: 'progress', icon: 'loader' },
  submitted: { label: 'Submitted to bank', tone: 'info', icon: 'landmark' },
  rejected: { label: 'Rejected', tone: 'danger', icon: 'circle-x' },
  cancelled: { label: 'Cancelled', tone: 'muted', icon: 'circle-x' },
});
export type BatchStatus = keyof typeof BATCH_STATUS;

export const REPORT_STATUS = def({
  upcoming: { label: 'Upcoming', tone: 'muted', icon: 'calendar' },
  due: { label: 'Due', tone: 'warning', icon: 'calendar-clock' },
  overdue: { label: 'Overdue', tone: 'danger', icon: 'alarm-clock' },
  submitted: { label: 'Submitted', tone: 'info', icon: 'send' },
  accepted: { label: 'Accepted', tone: 'success', icon: 'circle-check' },
  revisions_requested: { label: 'Revisions requested', tone: 'warning', icon: 'message-square-warning' },
});
export type ReportStatus = keyof typeof REPORT_STATUS;

export const AGENT_ACTION_STATUS = def({
  proposed: { label: 'Proposed', tone: 'agent', icon: 'bot' },
  awaiting_confirmation: { label: 'Awaiting your confirmation', tone: 'warning', icon: 'hand' },
  confirmed: { label: 'Confirmed', tone: 'success', icon: 'circle-check' },
  rejected: { label: 'Rejected', tone: 'neutral', icon: 'circle-x' },
  expired: { label: 'Expired', tone: 'muted', icon: 'clock' },
  failed: { label: 'Failed', tone: 'danger', icon: 'triangle-alert' },
});
export type AgentActionStatus = keyof typeof AGENT_ACTION_STATUS;

export const DILIGENCE_STATUS = def({
  pending: { label: 'Pending', tone: 'muted', icon: 'loader' },
  pass: { label: 'Passed', tone: 'success', icon: 'shield-check' },
  review: { label: 'Needs review', tone: 'warning', icon: 'shield-alert' },
  fail: { label: 'Failed', tone: 'danger', icon: 'shield-x' },
});
export type DiligenceStatus = keyof typeof DILIGENCE_STATUS;

export const SCREENING_STATUS = def({
  clear: { label: 'Clear', tone: 'success', icon: 'shield-check' },
  potential_match: { label: 'Match needs review', tone: 'warning', icon: 'shield-alert' },
  confirmed_match: { label: 'Confirmed match', tone: 'danger', icon: 'shield-x' },
  false_positive: { label: 'Cleared (false positive)', tone: 'success', icon: 'shield-check' },
});
export type ScreeningStatus = keyof typeof SCREENING_STATUS;

export const STATUS_SETS = {
  opportunity: OPPORTUNITY_STATUS,
  application: APPLICATION_STATUS,
  review: REVIEW_STATUS,
  award: AWARD_STATUS,
  awardFlag: AWARD_FLAGS,
  agreement: AGREEMENT_STATUS,
  payee: PAYEE_STATUS,
  payment: PAYMENT_STATUS,
  batch: BATCH_STATUS,
  report: REPORT_STATUS,
  agentAction: AGENT_ACTION_STATUS,
  diligence: DILIGENCE_STATUS,
  screening: SCREENING_STATUS,
} as const;
export type StatusKind = keyof typeof STATUS_SETS;

export function statusMeta(kind: StatusKind, value: string): StatusMeta {
  const set = STATUS_SETS[kind] as Record<string, StatusMeta>;
  return set[value] ?? { label: value.replace(/_/g, ' '), tone: 'neutral', icon: 'circle' };
}
