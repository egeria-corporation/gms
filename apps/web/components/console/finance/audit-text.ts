// SPDX-License-Identifier: AGPL-3.0-only
// Plain-language descriptions of audit entries for finance timelines.
import type { Actor, Tone } from '@gms/domain';

export interface AuditRow {
  id: string;
  occurred_at: string;
  actor_type: string;
  actor_name: string | null;
  on_behalf_of_name: string | null;
  action: string;
  after: unknown;
}

const TEXT: Record<string, string> = {
  'payments.propose_batch': 'added it to a draft payment batch',
  'payments.submit_batch_for_approval': 'sent the batch for approval',
  'payments.reject_batch': 'rejected the batch',
  'payments.cancel_batch': 'cancelled the batch',
  'system.submit_batch': 'asked Mercury to send the payments',
  'system.poll_bank_requests': 'checked the request in Mercury',
  'system.process_rail_event': 'applied a bank update',
  'system.reconcile': 'reconciled it against the bank transaction',
  'payments.retry': 'retried the payment (its installment can be batched again)',
  'payments.record_manual': 'recorded a payment made outside GMS',
  'payments.import_csv': 'imported it from a CSV file',
  'payments.resolve_exception': 'resolved a reconciliation exception',
  'awards.activate': 'activated the award',
  'awards.set_hold': 'changed the payment hold',
  'awards.close': 'closed the award',
  'awards.set_schedule': 'changed the payment schedule',
  'awards.approve_amendment': 'approved an amendment',
  'awards.reject_amendment': 'rejected an amendment',
  'awards.amend': 'drafted an amendment',
  'awards.draft': 'drafted the award',
  'agreements.generate': 'generated the agreement',
  'agreements.send': 'sent the agreement for signature',
  'agreements.sign': 'signed the agreement for the grantee',
  'agreements.countersign': 'countersigned the agreement',
  'diligence.set_flags': 'changed the diligence flags',
  'reports.review': 'reviewed a report',
  'reports.set_hold': 'changed a report’s payment hold',
};

function record(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

export function describeAudit(a: AuditRow): { text: string; tone: Tone } {
  const after = record(a.after);
  if (a.action === 'payments.approve_batch') {
    return after.approval === 1 ? { text: 'gave the first of two approvals', tone: 'success' } : { text: 'approved the batch', tone: 'success' };
  }
  if (a.action === 'awards.set_hold') {
    return after.onHold ? { text: `put the award on hold${after.reason ? `: “${String(after.reason)}”` : ''}`, tone: 'danger' } : { text: 'released the payment hold', tone: 'success' };
  }
  if (typeof after.status === 'string' && !TEXT[a.action]) {
    return { text: `changed the status to ${after.status.replace(/_/g, ' ')}`, tone: after.status === 'failed' ? 'danger' : 'info' };
  }
  const text = TEXT[a.action] ?? a.action.replace(/[._]/g, ' ');
  const tone: Tone = /reject|cancel|fail/.test(a.action) ? 'danger' : /approve|countersign|record|reconcile/.test(a.action) ? 'success' : 'info';
  return { text: typeof after.status === 'string' && a.action.startsWith('system.') ? `${text} (now ${after.status.replace(/_/g, ' ')})` : text, tone };
}

export function auditActor(a: AuditRow): Pick<Actor, 'type' | 'name' | 'onBehalfOfName'> {
  const type = a.actor_type === 'agent' || a.actor_type === 'system' ? a.actor_type : 'human';
  return { type, name: a.actor_name ?? (type === 'system' ? 'GMS' : 'Someone'), onBehalfOfName: a.on_behalf_of_name };
}
