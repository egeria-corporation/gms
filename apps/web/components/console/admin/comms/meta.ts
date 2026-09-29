// SPDX-License-Identifier: AGPL-3.0-or-later
// Labels, tones and icons for communications screens (bulk messages, deliveries, notification rules).
import type { Tone } from '@gms/domain';
import { CircleCheck, Clock, Flag, Loader, MailX, PencilLine, Send, TriangleAlert, type LucideIcon } from 'lucide-react';

export interface ChipMeta {
  label: string;
  tone: Tone;
  icon: LucideIcon;
}

export const BULK_STATUS: Record<string, ChipMeta> = {
  draft: { label: 'Draft', tone: 'muted', icon: PencilLine },
  sending: { label: 'Sending', tone: 'progress', icon: Loader },
  sent: { label: 'Sent', tone: 'success', icon: Send },
};

export const DELIVERY_STATUS: Record<string, ChipMeta> = {
  queued: { label: 'Queued', tone: 'muted', icon: Clock },
  sent: { label: 'Sent', tone: 'info', icon: Send },
  delivered: { label: 'Delivered', tone: 'success', icon: CircleCheck },
  bounced: { label: 'Bounced', tone: 'danger', icon: MailX },
  complained: { label: 'Marked as spam', tone: 'warning', icon: Flag },
  failed: { label: 'Failed', tone: 'danger', icon: TriangleAlert },
};

export const DELIVERY_ORDER = ['queued', 'sent', 'delivered', 'bounced', 'complained', 'failed'] as const;
export type DeliveryCounts = Partial<Record<string, number>>;

export function chipMeta(map: Record<string, ChipMeta>, value: string): ChipMeta {
  return map[value] ?? { label: value.replace(/_/g, ' '), tone: 'neutral', icon: Clock };
}

export const EVENT_TYPES: { value: string; label: string; hint?: string }[] = [
  { value: 'application.submitted', label: 'Application submitted' },
  { value: 'application.status_changed', label: 'Application status changed' },
  { value: 'report.due', label: 'Report due', hint: 'Use a negative offset to remind people before the due date, e.g. −14.' },
  { value: 'report.overdue', label: 'Report overdue', hint: 'Use a positive offset to follow up after the due date.' },
  { value: 'payment.sent', label: 'Payment sent' },
  { value: 'award.created', label: 'Award created' },
  { value: 'agreement.sent', label: 'Agreement sent for signature' },
  { value: 'message.received', label: 'Message received' },
  { value: 'opportunity.published', label: 'Opportunity published' },
];

export function eventLabel(value: string): string {
  return EVENT_TYPES.find((e) => e.value === value)?.label ?? value;
}

export const AUDIENCES = [
  { value: 'applicant', label: 'Applicants and grantees' },
  { value: 'program_officer', label: 'Program officers' },
  { value: 'finance', label: 'Finance team' },
  { value: 'admins', label: 'Owners and admins' },
  { value: 'reviewers', label: 'Reviewers' },
  { value: 'board', label: 'Board members' },
] as const;
export type Audience = (typeof AUDIENCES)[number]['value'];

export const CHANNELS = [
  { value: 'email', label: 'Email' },
  { value: 'in_app', label: 'In-app' },
] as const;
export type Channel = (typeof CHANNELS)[number]['value'];

export function audienceLabel(value: string): string {
  return AUDIENCES.find((a) => a.value === value)?.label ?? value;
}

export function channelLabel(value: string): string {
  return CHANNELS.find((c) => c.value === value)?.label ?? value;
}

/** Date + time in the workspace time zone. */
export function formatDateTime(iso: string | null | undefined, timeZone: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(d);
}

export function formatDate(iso: string | null | undefined, timeZone: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone }).format(d);
}

export function offsetLabel(days: number | null): string {
  if (days === null || days === 0) return 'On the day';
  const n = Math.abs(days);
  return `${n} day${n === 1 ? '' : 's'} ${days < 0 ? 'before' : 'after'}`;
}
