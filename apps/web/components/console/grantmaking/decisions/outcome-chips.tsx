// SPDX-License-Identifier: AGPL-3.0-or-later
// Icon + text + color chips for decision outcomes, docket statuses, board votes and docket outcomes.
// Shared by the decisions (R-05..R-07), dockets (E-01) and board (E-02) screens.
import { ToneChip } from '@gms/ui';
import type { Tone } from '@gms/domain';
import {
  Ban,
  CircleCheck,
  CircleDot,
  CircleMinus,
  CirclePause,
  CircleSlash,
  CircleX,
  Clock,
  FileCheck,
  Gavel,
  Lock,
  PencilLine,
  Send,
  UserX,
  Users,
  type LucideIcon,
} from 'lucide-react';

interface ChipDef {
  label: string;
  tone: Tone;
  icon: LucideIcon;
}

function Chip({ def, size }: { def: ChipDef; size?: 'sm' | 'default' }) {
  return <ToneChip tone={def.tone} icon={def.icon} label={def.label} size={size} />;
}

export const DECISION_OUTCOMES: Record<string, ChipDef> = {
  approve: { label: 'Approve', tone: 'success', icon: CircleCheck },
  decline: { label: 'Decline', tone: 'neutral', icon: CircleX },
  defer: { label: 'Defer', tone: 'warning', icon: CirclePause },
};

export function DecisionOutcomeChip({ outcome, final = false, size = 'sm' }: { outcome: string; final?: boolean; size?: 'sm' | 'default' }) {
  const base = DECISION_OUTCOMES[outcome] ?? { label: outcome, tone: 'neutral' as Tone, icon: CircleDot };
  const def = final ? { ...base, label: outcome === 'approve' ? 'Approved' : outcome === 'decline' ? 'Declined' : 'Deferred' } : base;
  return <Chip def={def} size={size} />;
}

export const DOCKET_STATUSES: Record<string, ChipDef> = {
  draft: { label: 'Draft', tone: 'muted', icon: PencilLine },
  published: { label: 'Published to board', tone: 'info', icon: Send },
  in_session: { label: 'In session (voting open)', tone: 'progress', icon: Gavel },
  closed: { label: 'Closed', tone: 'neutral', icon: Lock },
};

export function DocketStatusChip({ status, size }: { status: string; size?: 'sm' | 'default' }) {
  return <Chip def={DOCKET_STATUSES[status] ?? { label: status, tone: 'neutral', icon: CircleDot }} size={size} />;
}

export const VOTES: Record<string, ChipDef> = {
  approve: { label: 'Approve', tone: 'success', icon: CircleCheck },
  decline: { label: 'Decline', tone: 'danger', icon: CircleX },
  abstain: { label: 'Abstain', tone: 'muted', icon: CircleMinus },
  recuse: { label: 'Recuse', tone: 'warning', icon: UserX },
};

export function VoteChip({ vote, size = 'sm' }: { vote: string; size?: 'sm' | 'default' }) {
  return <Chip def={VOTES[vote] ?? { label: vote, tone: 'neutral', icon: CircleDot }} size={size} />;
}

export const DOCKET_OUTCOMES: Record<string, ChipDef> = {
  approved: { label: 'Approved', tone: 'success', icon: FileCheck },
  declined: { label: 'Declined', tone: 'neutral', icon: Ban },
  deferred: { label: 'Deferred (tie)', tone: 'warning', icon: Clock },
  no_quorum: { label: 'No quorum', tone: 'danger', icon: Users },
};

export function DocketOutcomeChip({ outcome, size }: { outcome: string; size?: 'sm' | 'default' }) {
  return <Chip def={DOCKET_OUTCOMES[outcome] ?? { label: outcome, tone: 'neutral', icon: CircleSlash }} size={size} />;
}

export const AMENDMENT_STATUSES: Record<string, ChipDef> = {
  draft: { label: 'Awaiting approval', tone: 'warning', icon: Clock },
  approved: { label: 'Approved', tone: 'success', icon: CircleCheck },
  rejected: { label: 'Rejected', tone: 'neutral', icon: CircleX },
};

export function AmendmentStatusChip({ status, size = 'sm' }: { status: string | null; size?: 'sm' | 'default' }) {
  return <Chip def={AMENDMENT_STATUSES[status ?? 'draft'] ?? { label: String(status), tone: 'neutral', icon: CircleDot }} size={size} />;
}

export const AGREEMENT_STATUSES: Record<string, ChipDef> = {
  draft: { label: 'Draft', tone: 'muted', icon: PencilLine },
  sent: { label: 'Sent for signature', tone: 'info', icon: Send },
  signed: { label: 'Signed by grantee', tone: 'progress', icon: FileCheck },
  countersigned: { label: 'Countersigned', tone: 'success', icon: CircleCheck },
  void: { label: 'Void', tone: 'muted', icon: Ban },
};

export function AgreementStatusChip({ status, size }: { status: string; size?: 'sm' | 'default' }) {
  return <Chip def={AGREEMENT_STATUSES[status] ?? { label: status, tone: 'neutral', icon: CircleDot }} size={size} />;
}
