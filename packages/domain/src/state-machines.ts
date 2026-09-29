// SPDX-License-Identifier: AGPL-3.0-or-later
// State machines for every status column. The action executor calls assertTransition()
// before writing a status change; the database CHECK constraints only guard the value set.
import { DomainError } from './errors';
import type {
  AgentActionStatus,
  ApplicationStatus,
  AwardStatus,
  BatchStatus,
  OpportunityStatus,
  PayeeStatus,
  PaymentStatus,
  ReportStatus,
  ReviewStatus,
} from './statuses';

export interface Machine<S extends string> {
  name: string;
  initial: S;
  transitions: Record<S, readonly S[]>;
}

function machine<S extends string>(name: string, initial: S, transitions: Record<S, readonly S[]>): Machine<S> {
  return { name, initial, transitions };
}

export const opportunityMachine = machine<OpportunityStatus>('opportunity', 'draft', {
  draft: ['forecasted', 'open', 'archived'],
  forecasted: ['open', 'draft', 'closed', 'archived'],
  open: ['closed'],
  closed: ['open', 'archived'],
  archived: [],
});

export const applicationMachine = machine<ApplicationStatus>('application', 'in_progress', {
  in_progress: ['submitted', 'withdrawn', 'ineligible'],
  submitted: ['under_review', 'invited_to_next_stage', 'awarded', 'declined', 'withdrawn', 'ineligible', 'in_progress'],
  under_review: ['invited_to_next_stage', 'awarded', 'declined', 'withdrawn', 'ineligible', 'in_progress'],
  invited_to_next_stage: ['awarded', 'declined', 'withdrawn', 'under_review'],
  awarded: [],
  declined: [],
  withdrawn: [],
  ineligible: ['under_review'],
});

export const reviewMachine = machine<ReviewStatus>('review', 'not_started', {
  not_started: ['in_progress', 'submitted', 'recused'],
  in_progress: ['submitted', 'recused'],
  submitted: ['in_progress'],
  recused: [],
});

export const awardMachine = machine<AwardStatus>('award', 'draft', {
  draft: ['active', 'cancelled'],
  active: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
});

export const payeeMachine = machine<PayeeStatus>('payee', 'invite_sent', {
  invite_sent: ['onboarding', 'ready', 'invite_expired'],
  onboarding: ['ready', 'invite_expired'],
  ready: [],
  invite_expired: ['invite_sent'],
});

export const paymentMachine = machine<PaymentStatus>('payment', 'scheduled', {
  scheduled: ['in_batch', 'held', 'cancelled', 'sent'],
  in_batch: ['awaiting_approval', 'scheduled', 'held', 'cancelled'],
  awaiting_approval: ['awaiting_bank_approval', 'scheduled', 'held', 'cancelled', 'sent'],
  awaiting_bank_approval: ['sent', 'failed', 'cancelled', 'exception'],
  sent: ['reconciled', 'failed', 'exception'],
  failed: ['scheduled', 'cancelled'],
  held: ['scheduled', 'cancelled'],
  reconciled: [],
  exception: ['reconciled', 'sent', 'failed'],
  cancelled: [],
});

export const batchMachine = machine<BatchStatus>('payment batch', 'draft', {
  draft: ['awaiting_approval', 'cancelled'],
  awaiting_approval: ['approved', 'rejected', 'draft', 'cancelled'],
  approved: ['submitting', 'cancelled'],
  submitting: ['submitted'],
  submitted: [],
  rejected: ['draft', 'cancelled'],
  cancelled: [],
});

export const reportMachine = machine<ReportStatus>('report', 'upcoming', {
  upcoming: ['due', 'overdue', 'submitted'],
  due: ['overdue', 'submitted'],
  overdue: ['submitted'],
  submitted: ['accepted', 'revisions_requested'],
  accepted: [],
  revisions_requested: ['submitted', 'overdue'],
});

export const agentActionMachine = machine<AgentActionStatus>('agent action', 'proposed', {
  proposed: ['awaiting_confirmation', 'rejected', 'expired'],
  awaiting_confirmation: ['confirmed', 'rejected', 'expired'],
  confirmed: ['failed'],
  rejected: [],
  expired: [],
  failed: [],
});

export function canTransition<S extends string>(m: Machine<S>, from: S, to: S): boolean {
  if (from === to) return false;
  return (m.transitions[from] ?? []).includes(to);
}

export function assertTransition<S extends string>(m: Machine<S>, from: S, to: S): void {
  if (!canTransition(m, from, to)) {
    throw new DomainError('invalid_transition', `A ${m.name} cannot move from "${from}" to "${to}".`, {
      machine: m.name,
      from,
      to,
      allowed: m.transitions[from] ?? [],
    });
  }
}

export function nextStates<S extends string>(m: Machine<S>, from: S): readonly S[] {
  return m.transitions[from] ?? [];
}
