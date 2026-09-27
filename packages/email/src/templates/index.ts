// SPDX-License-Identifier: AGPL-3.0-only
import { agentConfirmationRequest, collaboratorInvite, magicLink, staffInvite } from './account';
import { deadlineReminder, revisionsRequested, statusChange, submissionReceipt } from './applications';
import {
  agreementReady,
  approvalNeeded,
  awardNotice,
  paymentSent,
  payeeOnboarding,
  reportDue,
  reportOverdue,
} from './awards';
import { bulkMessage, messageNotification } from './messages';
import type { EmailTemplate } from './shared';

/** Every transactional email, keyed by the id used in preview routes and the outbox. */
export const templates = {
  collaborator_invite: collaboratorInvite,
  magic_link: magicLink,
  submission_receipt: submissionReceipt,
  status_change: statusChange,
  deadline_reminder: deadlineReminder,
  award_notice: awardNotice,
  agreement_ready: agreementReady,
  payee_onboarding: payeeOnboarding,
  payment_sent: paymentSent,
  agent_confirmation_request: agentConfirmationRequest,
  report_due: reportDue,
  report_overdue: reportOverdue,
  revisions_requested: revisionsRequested,
  message_notification: messageNotification,
  bulk_message: bulkMessage,
  staff_invite: staffInvite,
  approval_needed: approvalNeeded,
} as const;

export type TemplateKey = keyof typeof templates;
export type TemplateProps<K extends TemplateKey> =
  (typeof templates)[K] extends EmailTemplate<infer P> ? P : never;
export type TemplatePropsMap = { [K in TemplateKey]: TemplateProps<K> };

export const TEMPLATE_KEYS = Object.keys(templates) as TemplateKey[];

/** Sample props for every template (fictional data), for preview routes and tests. */
export const previewProps: TemplatePropsMap = Object.fromEntries(
  TEMPLATE_KEYS.map((k) => [k, templates[k].previewProps]),
) as TemplatePropsMap;

export type { EmailTemplate } from './shared';
export type {
  AgentConfirmationRequestProps,
  CollaboratorInviteProps,
  MagicLinkProps,
  StaffInviteProps,
} from './account';
export type {
  DeadlineReminderProps,
  RevisionsRequestedProps,
  StatusChangeProps,
  StatusChangeStatus,
  SubmissionReceiptProps,
} from './applications';
export type {
  AgreementReadyProps,
  ApprovalNeededProps,
  AwardNoticeProps,
  PaymentSentProps,
  PayeeOnboardingProps,
  ReportDueProps,
  ReportOverdueProps,
} from './awards';
export type { BulkMessageProps, MessageNotificationProps } from './messages';
