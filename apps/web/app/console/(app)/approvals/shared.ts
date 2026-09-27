// SPDX-License-Identifier: AGPL-3.0-only
// Shared shaping of approval_requests rows for the inbox (S-05) and the detail page.
import type { RiskTier } from '@gms/domain';

export interface ApprovalView {
  id: string;
  actionId: string;
  title: string;
  summary: string;
  requesterName: string;
  onBehalfOfName: string | null;
  onBehalfOfMe: boolean;
  audience: string;
  requestedAt: string;
  expiresAt: string;
  risk: RiskTier;
  changes: { field: string; after: string }[];
  applicantSupplied: { label: string; text: string }[];
  attestation: string | null;
  status: 'awaiting_confirmation' | 'confirmed' | 'rejected' | 'expired' | 'failed';
  decidedAt: string | null;
  decidedByName: string | null;
  resultError: string | null;
  entityHref: string | null;
  canDecide: boolean;
}

export interface ApprovalRow {
  id: string;
  action_id: string;
  preview: unknown;
  risk_tier: string;
  requester_name: string;
  status: string;
  audience: string;
  expires_at: string;
  created_at: string;
  decided_at: string | null;
  entity_type: string | null;
  entity_id: string | null;
  on_behalf_of: string;
  result: unknown;
  client_name: string | null;
  on_behalf_name: string | null;
  decided_by_name: string | null;
}

const ENTITY_HREF: Record<string, (id: string) => string> = {
  application: (id) => `/console/applications/${id}`,
  award: (id) => `/console/awards/${id}`,
  payment_batch: (id) => `/console/payments/batches/${id}`,
  bulk_message: () => '/console/comms/compose',
  opportunity: (id) => `/console/opportunities/${id}`,
  report_submission: (id) => `/console/reports/${id}`,
};

export function toApprovalView(r: ApprovalRow, viewer: { userId: string; role: string | null }, now = new Date()): ApprovalView {
  const p = (r.preview ?? {}) as { title?: string; summary?: string; fields?: { label: string; value: string }[]; quotedContent?: { label: string; text: string }[]; attestation?: string };
  const expired = r.status === 'awaiting_confirmation' && new Date(r.expires_at) < now;
  const status = (expired ? 'expired' : r.status) as ApprovalView['status'];
  const onBehalfOfMe = r.on_behalf_of === viewer.userId;
  const result = (r.result ?? {}) as { error?: string };
  return {
    id: r.id,
    actionId: r.action_id,
    title: p.title ?? r.action_id,
    summary: p.summary ?? '',
    requesterName: r.client_name ?? r.requester_name,
    onBehalfOfName: r.on_behalf_name,
    onBehalfOfMe,
    audience: r.audience,
    requestedAt: r.created_at,
    expiresAt: r.expires_at,
    risk: (['R0', 'R1', 'R2', 'R3'].includes(r.risk_tier) ? r.risk_tier : 'R2') as RiskTier,
    changes: (p.fields ?? []).map((f) => ({ field: f.label, after: f.value })),
    applicantSupplied: p.quotedContent ?? [],
    attestation: p.attestation ?? null,
    status,
    decidedAt: r.decided_at,
    decidedByName: r.decided_by_name,
    resultError: r.status === 'failed' ? (result.error ?? null) : null,
    entityHref: r.entity_type && r.entity_id && ENTITY_HREF[r.entity_type] ? ENTITY_HREF[r.entity_type]!(r.entity_id) : null,
    canDecide: onBehalfOfMe || (r.audience === 'staff' && (viewer.role === 'owner' || viewer.role === 'admin')),
  };
}
